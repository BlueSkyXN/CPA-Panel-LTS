#!/usr/bin/env python3
"""Exercise replacement editors against synthetic local Core instances.

Run after building dist: python3 scripts/guard-config-replacements.py
No production connections or credentials are used.
"""
from __future__ import annotations
import importlib.util
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright
from panel_browser import PanelBrowser, launch_chromium

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('replacement_smoke', ROOT / 'scripts/smoke-lts-panel.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def yaml_json(value, encode=False):
    operation = 'stringify(JSON.parse(s))' if encode else 'JSON.stringify(parse(s))'
    code = "import {parse,stringify} from 'yaml';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(" + operation + ');'
    output = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                            input=json.dumps(value) if encode else value, text=True,
                            capture_output=True, check=True).stdout
    return output if encode else json.loads(output)


class Handler(smoke.MockCoreHandler):
    def _v8_config_payload(self):
        value = super()._v8_config_payload()
        if hasattr(self.state, 'claude_groups'):
            value['api-keys']['claude'] = self.state.claude_groups
        return value

    def do_PUT(self):
        if urlparse(self.path).path == '/v8/management/config/api-keys/claude':
            self.state.record('PUT', self.path)
            body = self._read_body_text()
            self.state.record_body('PUT', self.path, body)
            if not self._check_config_revision('PUT', self.path):
                return
            self.state.claude_groups = json.loads(body)
            self.state.config_revision += 1
            self._send_json({'status': 'ok'}, headers={'ETag': self.state.etag()})
            return
        super().do_PUT()


def fixture(marker):
    state = smoke.MockCoreState()
    value = yaml_json(state.config_yaml)
    value.setdefault('oauth', {}).setdefault('providers', {}).setdefault('antigravity', {}).update({
        'sensitive-words-replace': {marker: 'original'},
        'sensitive-patterns-replace': [{'pattern': '(?P<name>secret)', 'replacement': ' ${name} ', 'future-rule': 'antigravity-original'}],
        'future-replacement-option': {'preserve': True},
    })
    value['oauth']['providers'].setdefault('devin', {})['sensitive-patterns-replace'] = [
        {'pattern': '^devin$', 'replacement': '', 'future-rule': 'devin-original'},
    ]
    value.setdefault('requests', {}).setdefault('payload', {}).pop('replace', None)
    state.config_yaml = '# replacement-root-comment\n' + yaml_json(value, True)
    state.config_yaml = state.config_yaml.replace(
        '- pattern: (?P<name>secret)', '# antigravity-regex-comment\n        - pattern: (?P<name>secret)', 1,
    ).replace('- pattern: ^devin$', '# devin-regex-comment\n        - pattern: ^devin$', 1)
    return state


def main():
    app_port, a_port, b_port = [smoke.find_free_port() for _ in range(3)]
    a, b = fixture('core-a'), fixture('core-b')
    passed = []

    def check(name, condition):
        assert condition, name
        passed.append(name)
        print('PASS ' + name, flush=True)

    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(Handler, a_port, a), smoke.run_server(Handler, b_port, b), sync_playwright() as pw:
        browser = launch_chromium(pw, headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.add_init_script("localStorage.setItem('cli-proxy-language',JSON.stringify({state:{language:'en'},version:0}));")
        raw = context.new_page()
        raw.set_default_timeout(15000)
        errors = []
        raw.on('pageerror', lambda error: errors.append(str(error)))
        page = PanelBrowser(raw)
        app = f'http://127.0.0.1:{app_port}/management.html'
        page.goto(app + '#/login')
        raw.get_by_role('button', name='Saved instance connections', exact=True).click()
        for name, port in [('Core A', a_port), ('Core B', b_port)]:
            raw.get_by_role('button', name='Add connection', exact=True).click()
            raw.get_by_label('Name', exact=True).fill(name)
            raw.get_by_label('Address', exact=True).fill(f'http://127.0.0.1:{port}')
            raw.get_by_label('Environment', exact=True).fill('Test')
            raw.locator('[role="dialog"] input[type=password]').fill('synthetic-replacements')
            raw.locator('[role="dialog"] label').filter(has=raw.locator('input[type=checkbox]')).first.click()
            raw.get_by_role('button', name='Save profile', exact=True).click()
        multi = raw.get_by_role('checkbox', name='Multi-instance', exact=True)
        if not multi.is_checked():
            raw.locator('label').filter(has=multi).click()

        def choose(name):
            raw.get_by_role('dialog').get_by_role('button', name=re.compile('^' + name)).click()
            expect(raw.locator('iframe[data-active=true]')).to_have_attribute('title', name)
            page.locator('.app-shell').wait_for()

        def open_connections():
            page.get_by_role('button', name='Switch instance', exact=True).click()
            expect(raw.get_by_role('dialog')).to_be_visible()

        def config():
            page.evaluate("location.hash = '#/config'")
            page.get_by_role('searchbox').wait_for()

        def field(name, key):
            smoke.locate_config_field(page, name, key)
            return page.locator(f'[data-config-field="{name}"]')

        def save():
            before = len(a.config_yaml_puts)
            page.locator('button[aria-label="Save"]').click()
            with page.expect_response(lambda response: response.request.method == 'PUT' and response.url.endswith('/v8/management/config.yaml')) as saved:
                page.get_by_role('button', name='Confirm Save', exact=True).click()
            assert saved.value.status == 200, 'Core rejected the config save'
            expect(page.get_by_role('button', name='Confirm Save', exact=True)).not_to_be_visible()
            expect(page.locator('button[aria-label="Save"]')).to_be_disabled()
            check('config write reached Core exactly once', len(a.config_yaml_puts) == before + 1)

        choose('Core A')
        config()
        literal = field('antigravitySensitiveWordsReplace', 'sensitive-words-replace')
        literal.get_by_role('button', name='Add literal replacement').click()
        expect(page.locator('button[aria-label="Save"]')).to_be_disabled()
        check('incomplete literal draft blocks save', literal.get_by_role('textbox').count() == 4)
        literal.get_by_label('Literal text, row 2', exact=True).fill('   ')
        literal.get_by_label('Literal text, row 2', exact=True).press('Tab')
        expect(literal.get_by_text('Enter a non-empty, unique match.').first).to_be_visible()
        check('whitespace-only literal key blocks save', page.locator('button[aria-label="Save"]').is_disabled())
        literal.get_by_label('Literal text, row 2', exact=True).fill(' core-a ')
        literal.get_by_label('Literal text, row 2', exact=True).press('Tab')
        expect(literal.get_by_text('Enter a non-empty, unique match.').first).to_be_visible()
        check('trimmed-duplicate literal keys block save', page.locator('button[aria-label="Save"]').is_disabled())
        literal.get_by_label('Literal text, row 2', exact=True).fill(' remove ')
        literal.get_by_label('Literal replacement, row 2', exact=True).fill('  keep  ')
        save()
        ag = yaml_json(a.config_yaml)['oauth']['providers']['antigravity']
        check('trimmed literal key and replacement whitespace survive', ag['sensitive-words-replace'].get('remove') == '  keep  ' and ' remove ' not in ag['sensitive-words-replace'])
        literal.get_by_label('Literal replacement, row 2', exact=True).fill('')
        save()
        ag = yaml_json(a.config_yaml)['oauth']['providers']['antigravity']
        check('empty literal replacement survives after key trim', ag['sensitive-words-replace'].get('remove') == '')
        check('unmanaged YAML and root comment survive', ag['future-replacement-option'] == {'preserve': True} and '# replacement-root-comment' in a.config_yaml)

        regex = field('antigravitySensitivePatternsReplace', 'sensitive-patterns-replace')
        regex.get_by_label('Regex pattern, row 1', exact=True).fill('(?P<name>renamed)')
        save()
        original = yaml_json(a.config_yaml)['oauth']['providers']['antigravity']['sensitive-patterns-replace'][0]
        check('antigravity regex rename preserves original fields and comment',
              original == {'pattern': '(?P<name>renamed)', 'replacement': ' ${name} ', 'future-rule': 'antigravity-original'}
              and '# antigravity-regex-comment' in a.config_yaml)
        regex.get_by_role('button', name='Add regex rule').click()
        regex.get_by_label('Regex pattern, row 2', exact=True).fill('^private$')
        regex.get_by_role('button', name='Move regex row 2 up', exact=True).click()
        save()
        rules = yaml_json(a.config_yaml)['oauth']['providers']['antigravity']['sensitive-patterns-replace']
        check('regex order, RE2 syntax and blank replacement persist', rules == [{'pattern': '^private$', 'replacement': ''}, {'pattern': '(?P<name>renamed)', 'replacement': ' ${name} ', 'future-rule': 'antigravity-original'}])
        devin = field('devinSensitivePatternsReplace', 'sensitive-patterns-replace')
        devin.get_by_label('Regex pattern, row 1', exact=True).fill('^devin-renamed$')
        save()
        original = yaml_json(a.config_yaml)['oauth']['providers']['devin']['sensitive-patterns-replace'][0]
        check('devin regex rename preserves original fields and comment',
              original == {'pattern': '^devin-renamed$', 'replacement': '', 'future-rule': 'devin-original'}
              and '# devin-regex-comment' in a.config_yaml)

        payload = field('payloadReplaceRules', 'requests.payload.replace')
        payload.get_by_role('button', name='Add Rule', exact=True).click()
        payload.get_by_role('button', name='Add Model', exact=True).click()
        payload.get_by_label('Model Name', exact=True).fill('*')
        payload.get_by_label('Source text', exact=True).fill('needle')
        payload.get_by_role('textbox', name='Message positions', exact=True).fill('1.5')
        payload.get_by_role('textbox', name='Message positions', exact=True).press('Tab')
        check('fractional position blocks save', page.locator('button[aria-label="Save"]').is_disabled())
        payload.get_by_role('textbox', name='Message positions', exact=True).fill('1, 3')
        payload.get_by_role('button', name='Add replacement', exact=True).click()
        payload.get_by_label('Source text', exact=True).nth(1).fill('next')
        payload.get_by_label('Replacement text (empty deletes)', exact=True).nth(1).fill('  value  ')
        payload.get_by_role('button', name='Move up', exact=True).last.click()
        save()
        rule = yaml_json(a.config_yaml)['requests']['payload']['replace'][0]
        check('payload order and literal values survive save', rule['replacements'] == [{'next': '  value  '}, {'needle': ''}] and rule['target']['positions'] == [1, 3])
        page.reload()
        config()
        payload = field('payloadReplaceRules', 'requests.payload.replace')
        check('saved replacement fields reload from Core', payload.get_by_label('Source text', exact=True).first.input_value() == 'next')
        raw.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_function('innerWidth <= 390')
        if page.locator('.sidebar.open').count():
            page.locator('button.mobile-menu-btn').click()
        payload.scroll_into_view_if_needed()
        page.evaluate("async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); }")
        rect = payload.bounding_box()
        check('replacement editor fits a mobile viewport', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1') and rect['x'] >= 0 and rect['x'] + rect['width'] <= 391)
        output = ROOT / 'local/config-replacements-browser'
        output.mkdir(parents=True, exist_ok=True)
        raw.screenshot(path=str(output / 'mobile.png'))
        raw.set_viewport_size({'width': 1440, 'height': 1000})
        payload.get_by_role('radio', name='All messages of this role', exact=True).check()
        save()
        target = yaml_json(a.config_yaml)['requests']['payload']['replace'][0]['target']
        check('all-messages mode removes positions', target.get('all') is True and 'positions' not in target)
        payload.get_by_role('button', name='Target type', exact=True).click()
        page.get_by_role('option', name='JSON paths', exact=True).click()
        payload.get_by_label('JSON paths', exact=True).fill('metadata.description')
        payload.get_by_role('button', name='Replacement type', exact=True).first.click()
        page.get_by_role('option', name='Regex (RE2)', exact=True).click()
        payload.get_by_label('RE2 pattern', exact=True).fill('(?i)next')
        save()
        changed = yaml_json(a.config_yaml)['requests']['payload']['replace'][0]
        check('path target and ordered RE2 replacement reach the config API',
              changed['target'] == {'paths': ['metadata.description']}
              and changed['replacements'][0] == {'pattern': '(?i)next', 'replacement': '  value  '})
        payload.get_by_role('button', name='Delete', exact=True).first.click()
        save()
        check('clearing replacement rules removes only their section', 'replace' not in yaml_json(a.config_yaml).get('requests', {}).get('payload', {}))

        literal = field('antigravitySensitiveWordsReplace', 'sensitive-words-replace')
        literal.get_by_label('Literal replacement, row 1', exact=True).fill('A-only draft')
        open_connections()
        choose('Core B')
        config()
        other = field('antigravitySensitiveWordsReplace', 'sensitive-words-replace')
        check('connection B shows its own values', other.get_by_label('Literal text, row 1', exact=True).input_value() == 'core-b' and other.get_by_label('Literal replacement, row 1', exact=True).input_value() == 'original')
        check('draft did not write to either Core', len(b.config_yaml_puts) == 0 and 'A-only draft' not in a.config_yaml)
        open_connections()
        choose('Core A')
        literal = field('antigravitySensitiveWordsReplace', 'sensitive-words-replace')
        check('returning to A preserves its draft', literal.get_by_label('Literal replacement, row 1', exact=True).input_value() == 'A-only draft')
        literal.get_by_label('Literal replacement, row 1', exact=True).fill('original')
        expect(page.locator('button[aria-label="Save"]')).to_be_disabled()

        page.evaluate("location.hash = '#/ai-providers'")
        page.get_by_role('button', name=re.compile(r'^Claude(?:\s|$)', re.I)).click()
        page.get_by_role('heading', name='Claude', exact=True).wait_for()
        page.get_by_role('button', name='Edit', exact=True).first.click()
        sheet = page.get_by_role('dialog').last
        sheet.get_by_text('Cloak settings', exact=True).click()
        editor = sheet.get_by_role('group', name='Literal replacements', exact=True)
        editor.get_by_role('button', name='Add literal replacement').click()
        writes = len(a.request_bodies.get('PUT /v8/management/config/api-keys/claude', []))
        sheet.get_by_role('button', name='Save', exact=True).click()
        expect(sheet.get_by_text(re.compile('Check replacement rules'))).to_be_visible()
        check('Claude form rejects incomplete replacement without a write', len(a.request_bodies.get('PUT /v8/management/config/api-keys/claude', [])) == writes)
        editor.get_by_label('Literal text, row 1', exact=True).fill('profile-secret')
        sheet.get_by_role('button', name='Save', exact=True).click()
        expect(sheet).not_to_be_visible()
        cloak = a.claude_groups[0]['keys'][0]['cloak']
        check('Claude form persists an empty replacement through native API', cloak['sensitive-words-replace'] == {'profile-secret': ''})
        page.get_by_role('button', name='Edit', exact=True).first.click()
        sheet = page.get_by_role('dialog').last
        sheet.get_by_text('Cloak settings', exact=True).click()
        check('Claude native API readback repopulates the editor', sheet.get_by_label('Literal text, row 1', exact=True).input_value() == 'profile-secret')
        sheet.get_by_role('button', name='Cancel', exact=True).click()
        check('no browser runtime errors', not errors)
        browser.close()
    print(f'{len(passed)} PASS; 0 FAIL', flush=True)


if __name__ == '__main__':
    main()

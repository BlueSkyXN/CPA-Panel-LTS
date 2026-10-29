#!/usr/bin/env python3
"""验证推理强度表单、旧 Core 能力门禁和临时真实 Core 的配置往返。"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from panel_browser import PanelBrowser, launch_chromium

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "local/reasoning-effort-smoke"


def module(name, filename):
    import sys
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


config_smoke = module("effort_config_smoke", "smoke-config-editor.py")
base = config_smoke.base


class EffortCore(config_smoke.ConfigCore):
    def send_header(self, name, value):
        if name.lower() == 'access-control-expose-headers':
            value += ',x-cpa-reasoning-effort-policy'
        super().send_header(name, value)

    def _send_cors_headers(self, plugin_support_override=None):
        super()._send_cors_headers(plugin_support_override)
        if self.state.effort_supported:
            self.send_header('x-cpa-reasoning-effort-policy', '1')


def policy_source(source):
    policy = ('  reasoning-effort:\n'
              '    - models: ["glm-*"]\n'
              '      mode: follow # effort-policy\n'
              '      future-policy-field: preserve\n')
    if re.search(r'^requests:\s*$', source, re.M):
        return re.sub(r'^requests:\s*\n', 'requests:\n' + policy, source, count=1, flags=re.M)
    return source + '\nrequests:\n' + policy


def browser_check(app_url, api_url, read_source, downgrade=None):
    errors = []
    with sync_playwright() as pw:
        browser = launch_chromium(pw, headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
        page = PanelBrowser(context.new_page())
        page.set_default_timeout(15000)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(app_url + '#/login')
        page.get_by_label('Custom Connection URL:').check(force=True)
        page.get_by_placeholder('Eg: https://example.com:8317').fill(api_url)
        page.locator('input[name="cpa-management-key"]').fill('smoke-management-key')
        page.get_by_label('Remember password').check(force=True)
        page.get_by_role('button', name=re.compile(r'^(Login|Connect)$', re.I)).click()
        page.wait_for_url(re.compile(r'#/$'))
        page.goto(app_url + '#/config')
        page = config_smoke.ConfigSurface(page)

        def load():
            page.reload()
            page.get_by_role('button', name='Visual Editor', exact=True).click()
            base.locate_config_field(page, 'reasoningEffortRules', 'reasoning-effort')
            return page.get_by_test_id('reasoning-effort-rules')

        def choose(field, label, option, index=0):
            field.get_by_role('button', name=label, exact=True).nth(index).click()
            page.get_by_role('option', name=option, exact=True).click()

        def save():
            page.locator('button[aria-label="Save"]').click()
            with page.page.expect_response(lambda response: response.request.method == 'PUT' and response.url.endswith('/config.yaml')) as saved:
                page.get_by_role('button', name='Confirm Save', exact=True).click()
            assert saved.value.status == 200, saved.value.status
            page.wait_for_function("!document.querySelector('button[aria-label=\"Save\"]:not([disabled])')")

        field = load()
        assert field.get_by_role('button', name='Add effort rule', exact=True).is_enabled()
        for label, mode in [('Fill when unspecified', 'default'), ('Force override', 'force'), ('Follow client', 'follow')]:
            choose(field, 'Policy', label)
            if mode != 'follow':
                choose(field, 'Effort', 'max')
            save()
            source = read_source()
            assert re.search(r'mode: ' + mode + r'\b', source), f'Expected saved mode {mode}'
            assert 'future-policy-field: preserve' in source and '# effort-policy' in source
            assert 'models:' in source and 'glm-*' in source
            if mode != 'follow':
                assert 'effort: max' in source
            else:
                assert not re.search(r'^\s+effort:', source, re.M)
            field = load()
            assert field.get_by_role('button', name='Policy', exact=True).inner_text() == label
        field.get_by_role('button', name='Add effort rule', exact=True).click()
        field.get_by_label('Models', exact=True).last.fill('glm-special')
        save()
        field = load()
        field.get_by_role('button', name='Move up', exact=True).last.click()
        save()
        assert read_source().index('glm-special') < read_source().index('glm-*')
        field = load()
        field.get_by_role('button', name='Remove rule', exact=True).first.click()
        save()
        field = load()
        for width in [1440, 390]:
            page.set_viewport_size({'width': width, 'height': 900})
            config_smoke.check_layout(page)
            page.screenshot(path=str(OUTPUT / f'effort-{width}.png'))
        if downgrade:
            # A Core downgrade between editing and the save preflight must also
            # refuse the visual write, even while the existing draft is dirty.
            choose(field, 'Policy', 'Force override')
            original = read_source()
            downgrade()
            page.locator('button[aria-label="Save"]').click()
            page.get_by_text('Unable to convert the visual draft to YAML.', exact=False).wait_for()
            assert read_source() == original
            field = load()
            field.get_by_role('status').wait_for()
            assert field.get_by_role('button', name='Add effort rule', exact=True).is_disabled()
            assert field.get_by_role('button', name='Policy', exact=True).is_disabled()
        assert not errors, errors
        browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--core-dir', type=Path)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    state = base.MockCoreState()
    state.effort_supported = True
    state.config_yaml = policy_source(state.config_yaml)
    app_port, api_port = base.find_free_port(), base.find_free_port()
    with base.run_server(base.StaticPanelHandler, app_port), base.run_server(EffortCore, api_port, state):
        browser_check(f'http://127.0.0.1:{app_port}/management.html', f'http://127.0.0.1:{api_port}',
                      lambda: state.config_yaml, lambda: setattr(state, 'effort_supported', False))
    print('PASS mock: follow/default/force, native V8 save/readback, unknown YAML, reorder/delete, mobile layout, older Core gate')
    if args.core_dir:
        core = module('effort_real_core', 'smoke-lts-panel-core.py')
        with tempfile.TemporaryDirectory(prefix='cpa-effort-smoke-') as tmp:
            with core.run_core(args.core_dir.resolve(), Path(tmp)) as runtime, base.run_server(base.StaticPanelHandler, app_port):
                source, revision = core.read_config_yaml(runtime.api_url)
                status, _, response = core.http_request(runtime.api_url, core.V8 + '/config.yaml', method='PUT',
                    body=policy_source(source).replace('      future-policy-field:', '      # future-policy-field:').encode(), headers={'If-Match': revision, 'Content-Type': 'application/yaml'})
                assert status == 200, response.decode()[:400]
                browser_check(f'http://127.0.0.1:{app_port}/management.html', runtime.api_url,
                              lambda: core.read_config_yaml(runtime.api_url)[0])
        print('PASS real Core: capability header/CORS, all three policies saved and read back through the browser')
    (OUTPUT / 'result.json').write_text(json.dumps({'mock': 'passed', 'real_core': bool(args.core_dir)}, indent=2))


if __name__ == '__main__':
    main()

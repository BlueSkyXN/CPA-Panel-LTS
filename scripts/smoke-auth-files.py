#!/usr/bin/env python3
"""Auth-file display, sorting and menu regression against synthetic mock Core data."""
import importlib.util
import json
from pathlib import Path
import re
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
from panel_browser import PanelBrowser

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('panel_smoke', ROOT / 'scripts/smoke-lts-panel.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
FILES = [
    {'name': 'account-10.json', 'label': 'Account 2', 'type': 'zcode-coding-plan', 'priority': 10, 'modtime': '2026-10-07T12:00:00Z'},
    {'name': 'account-2.json', 'label': 'Account 10', 'type': 'zcode-coding-plan', 'priority': 3, 'modtime': '2026-10-08T12:00:00Z'},
    {'name': 'codebuddy.json', 'label': 'Buddy', 'type': 'codebuddy', 'disabled': True},
    {'name': 'codex.json', 'type': 'codex', 'priority': 10},
    {'name': 'copilot.json', 'type': 'copilot', 'priority': -1, 'modtime': '2026-09-01T12:00:00Z'},
    {'name': 'qoder.json', 'type': 'qoder', 'unavailable': True, 'status_message': 'Fixture unavailable'},
    {'name': 'xai.json', 'type': 'xai', 'modtime': '2026-10-06T12:00:00Z'},
]


def main():
    app_port, api_port = smoke.find_free_port(), smoke.find_free_port()
    state = smoke.MockCoreState()
    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(smoke.MockCoreHandler, api_port, state), sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.add_init_script("""
            if (!localStorage.getItem('cli-proxy-language')) localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));
        """)
        page = PanelBrowser(context.new_page())
        page.set_default_timeout(10000)
        errors = []
        page.raw.on('pageerror', lambda error: errors.append(str(error)))
        base = f'http://127.0.0.1:{app_port}/management.html'
        page.goto(base + '#/login')
        page.get_by_label('Custom Connection URL:', exact=True).check(force=True)
        page.get_by_role('textbox', name='Custom Connection URL:', exact=True).fill(f'http://127.0.0.1:{api_port}')
        page.locator('input[name="cpa-management-key"]').fill('smoke-management-key')
        page.get_by_label('Remember password').check(force=True)
        page.get_by_role('button', name='Login', exact=True).click()
        page.wait_for_url(re.compile(r'.*#/$'))
        smoke.run_auth_file_using_api_smoke(page, base)

        reads = []
        writes = []
        def api(route):
            path = urlparse(route.request.url).path
            if route.request.method != 'GET':
                writes.append(path)
            else:
                reads.append(path)
            if path == '/v0/management/auth-files':
                payload = {'files': [dict(size=197, success=3, failed=3, auth_index=f'fixture-{i}', **file) for i, file in enumerate(FILES)]}
                route.fulfill(status=200, content_type='application/json', body=json.dumps(payload))
            elif path == '/v0/management/auth-files/models':
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'models': [{'id': 'fixture-model'}]}))
            else:
                route.continue_()
        context.route('**/v0/management/**', api)
        page.evaluate('localStorage.setItem("authFilesPage.uiState", JSON.stringify({sortMode:"priority", problemOnly:true, disabledOnly:true}))')
        page.goto(base + '#/auth-files')
        cards = page.get_by_test_id('auth-file-card')
        def choose(label, value):
            page.get_by_role('button', name=label, exact=True).click()
            page.get_by_role('option', name=value, exact=True).click()
        def titles():
            return cards.locator('[class*="fileName"]').all_text_contents()
        def expect_titles(expected):
            page.wait_for_function('(expected) => JSON.stringify([...document.querySelectorAll(\'[data-testid="auth-file-card"] [class*="fileName"]\')].map(e=>e.textContent)) === JSON.stringify(expected)', arg=expected)
        expect_titles(['Buddy'])
        assert page.get_by_role('button', name='Status', exact=True).inner_text() == 'Disabled only'
        assert page.get_by_role('button', name=re.compile('Sort direction: Highest first')).count() == 1
        choose('Status', 'All statuses')
        expect_titles(['Account 2', 'codex.json', 'Account 10', 'Buddy', 'qoder.json', 'xai.json', 'copilot.json'])
        tags = page.locator('[class*="filterTags"] button').all_text_contents()
        choose('Sort', 'File name')
        expect_titles(['Account 10', 'Account 2', 'Buddy', 'codex.json', 'copilot.json', 'qoder.json', 'xai.json'])
        page.get_by_role('button', name=re.compile('Sort direction: A')).click()
        assert titles()[0] == 'xai.json'
        choose('Sort', 'Account name')
        assert titles()[:2] == ['Account 2', 'Account 10']
        choose('Sort', 'Modified time')
        assert titles()[:3] == ['Account 10', 'Account 2', 'xai.json']
        page.get_by_role('spinbutton', name='Per page').fill('3')
        page.get_by_role('spinbutton', name='Per page').press('Tab')
        expect_titles(['Account 10', 'Account 2', 'xai.json'])
        page.get_by_role('button', name='Next', exact=True).click()
        expect_titles(['copilot.json', 'Buddy', 'codex.json'])
        choose('Sort', 'Routing priority')
        expect_titles(['Account 2', 'codex.json', 'Account 10'])
        cards.filter(has_text='account-10.json').get_by_role('checkbox').first.check(force=True)
        choose('Sort', 'File name')
        assert cards.filter(has_text='account-10.json').get_by_role('checkbox').first.is_checked()
        assert page.locator('[class*="filterTags"] button').all_text_contents() == tags
        search = page.get_by_role('textbox', name='Search configs')
        search.fill('Account *0')
        expect_titles(['Account 10'])
        search.fill('')
        page.get_by_role('button', name='ZCode 2', exact=True).click()
        assert page.locator('[class*="filterTags"] button').all_text_contents() == tags
        expect_titles(['Account 10', 'Account 2'])
        page.reload()
        expect_titles(['Account 10', 'Account 2'])
        assert page.get_by_role('button', name='Sort', exact=True).inner_text() == 'File name'
        card = cards.filter(has_text='account-10.json')
        trigger = card.get_by_role('button', name='More', exact=True)
        trigger.click()
        menu = page.get_by_role('menu', name='More')
        assert menu.get_by_role('menuitem').count() == 3
        page.keyboard.press('Escape')
        assert trigger.get_attribute('aria-expanded') == 'false'
        trigger.press('ArrowDown')
        page.get_by_role('menuitem', name='Download', exact=True).wait_for()
        page.keyboard.press('End')
        assert page.get_by_role('menuitem', name='Delete', exact=True).evaluate('el=>el===document.activeElement')
        page.keyboard.press('Escape')
        trigger.click()
        page.get_by_role('heading', name='Auth Files Management').click()
        assert page.get_by_role('menu').count() == 0
        card.get_by_role('button', name='Models', exact=True).click()
        page.get_by_role('dialog').get_by_text('fixture-model', exact=True).wait_for()
        page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).last.click()
        assert not writes, 'Sort/filter/menu display must not mutate credentials'

        for language in ('en', 'zh-CN', 'zh-TW', 'ru'):
            catalog = json.loads((ROOT / f'src/i18n/locales/{language}.json').read_text())['auth_files']
            page.evaluate('(language)=>localStorage.setItem("cli-proxy-language", JSON.stringify({state:{language},version:0}))', language)
            page.reload()
            cards.first.wait_for()
            choose(catalog['sort_label'], catalog['sort_priority'])
            compact = page.get_by_role('checkbox', name=catalog['compact_mode_label'], exact=True)
            if not compact.is_checked():
                page.get_by_text(catalog['compact_mode_label'], exact=True).click()
            assert compact.is_checked()
            for width in (1440, 1024, 390):
                page.set_viewport_size({'width': width, 'height': 1000})
                assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), (language, width)
                geometry = cards.evaluate_all("""cards => cards.every(card => {
                  const r = card.getBoundingClientRect();
                  const buttons = [...card.querySelectorAll('button')].filter(el => el.getClientRects().length);
                  return buttons.every(el => {
                    const b = el.getBoundingClientRect();
                    return b.left >= r.left && b.right <= r.right + 1 && el.scrollWidth <= el.clientWidth + 1;
                  }) && buttons.every((a, i) => buttons.slice(i + 1).every(b => {
                    const x=a.getBoundingClientRect(), y=b.getBoundingClientRect();
                    return Math.min(x.right,y.right)-Math.max(x.left,y.left)<=1 || Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)<=1;
                  }));
                })""")
                assert geometry, f'Card actions clipped/overlapping: {language}, {width}'
        assert not errors, errors
        browser.close()
    print('PASS: auth-file editor, legacy preferences, five sorts, direction, pagination, selection, label search, stable tabs, menu keyboard/close, model dialog, four-locale responsive layout; no display-triggered writes (mock Core)')


if __name__ == '__main__':
    main()

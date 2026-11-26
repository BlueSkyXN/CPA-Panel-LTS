#!/usr/bin/env python3
"""Real-page behavior gate for draft-safe provider switching (PR #155).

Drives the actual mounted auth-files edit pages against the repo mock Core.
Unlike the unit contract file, this gate exercises the REAL page wiring:
typing, mouse selection, keyboard Enter, blur commit, Stay/Leave on the
unsaved-changes dialog, same-provider commits, and the router navigation
side effects. It fails (non-zero) when the production wiring regresses:

- the dba6c341 wiring (keystrokes feed the edited provider) fails the
  typing cases: the draft is reset to another provider's empty entry;
- the a525cc43 wiring (same-value commit calls allowNextNavigation) fails
  the same-value navigation case: Back slips through without confirming.

Run: python3 scripts/guard-provider-switch.py [dist-dir]   (default: dist)
"""
import importlib.util
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'dist'
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('panel_smoke', ROOT / 'scripts/smoke-lts-panel.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
smoke.DIST = DIST
smoke.INDEX_HTML = DIST / 'index.html'
from panel_browser import PanelBrowser, launch_chromium  # noqa: E402


class Handler(smoke.MockCoreHandler):
    def do_GET(self):
        if urlparse(self.path).path == '/v0/management/oauth-model-policy':
            self._send_json({'items': {}})
            return
        return super().do_GET()


PAGES = [
    ('policy', '/auth-files/model-policy', '#model-policy-provider', '#model-policy-allow', 'Save'),
    ('alias', '/auth-files/oauth-model-alias', '#oauth-model-alias-provider', 'input[class*=mappingAliasInput]', 'Save/Update'),
    ('excluded', '/auth-files/oauth-excluded', '#oauth-excluded-provider', '#oauth-excluded-custom-rule', 'Save/Update'),
]


def main():
    app_port, api_port = smoke.find_free_port(), smoke.find_free_port()
    mock_state = smoke.MockCoreState()
    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(Handler, api_port, mock_state), sync_playwright() as p:
        # reuse the repo-wide launcher: Playwright Chromium by default,
        # CPA_SMOKE_BROWSER_CHANNEL=chrome opts into a local Chrome
        browser = launch_chromium(p, headless=True)
        ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_init_script("localStorage.setItem('cli-proxy-language',JSON.stringify({state:{language:'en'},version:0}));")
        page = PanelBrowser(ctx.new_page())
        page.set_default_timeout(15000)
        base = f'http://127.0.0.1:{app_port}/management.html'
        page.goto(base + '#/login')
        page.get_by_label('Custom Connection URL:', exact=True).check(force=True)
        page.get_by_role('textbox', name='Custom Connection URL:', exact=True).fill(f'http://127.0.0.1:{api_port}')
        page.locator('input[name="cpa-management-key"]').fill('smoke-management-key')
        page.get_by_label('Remember password').check(force=True)
        page.get_by_role('button', name='Login', exact=True).click()
        page.wait_for_url(re.compile(r'.*#/$'))

        def open_page(route, draft_sel):
            page.goto(base + '#/')
            page.wait_for_timeout(150)
            page.goto(base + '#' + route + '?provider=codex')
            draft = page.locator(draft_sel).first
            draft.wait_for(state='visible', timeout=10000)
            page.wait_for_timeout(1200)
            draft.fill('unsaved-sentinel')
            page.wait_for_timeout(250)
            return draft

        failures = []

        def check(label, cond, detail=''):
            status = 'PASS' if cond else 'FAIL'
            print(f'{status} {label}' + (f' :: {detail}' if detail and not cond else ''), flush=True)
            if not cond:
                failures.append(label)

        for name, route, provider_sel, draft_sel, save_label in PAGES:
            # 1. typing must not touch the edit target
            draft = open_page(route, draft_sel)
            field = page.locator(provider_sel)
            field.fill('xa')
            page.wait_for_timeout(400)
            check(f'[{name}] typing keeps draft',
                  draft.input_value() == 'unsaved-sentinel', f'draft={draft.input_value()!r}')
            check(f'[{name}] typing keeps URL',
                  'provider=codex' in page.evaluate('location.hash'))

            # 2. keyboard: type to filter + ArrowDown + Enter commits a different provider
            draft = open_page(route, draft_sel)
            field = page.locator(provider_sel)
            field.click(); page.wait_for_timeout(300)
            for ch in 'kimi':
                field.press(ch); page.wait_for_timeout(80)
            page.wait_for_timeout(250)
            field.press('ArrowDown'); page.wait_for_timeout(150)
            field.press('Enter')
            page.wait_for_timeout(500)
            dlg = page.get_by_role('dialog', name='Unsaved changes')
            check(f'[{name}] Enter-commit of a different provider confirms',
                  dlg.count() == 1, f'dialogs={dlg.count()}')
            if dlg.count() == 1:
                dlg.get_by_role('button', name='Stay', exact=True).click()
                page.wait_for_timeout(400)
                check(f'[{name}] Stay after Enter restores input to codex',
                      field.input_value().strip() == 'codex', f'input={field.input_value()!r}')
                check(f'[{name}] Stay keeps draft',
                      draft.input_value() == 'unsaved-sentinel', f'draft={draft.input_value()!r}')
                check(f'[{name}] Stay keeps URL',
                      'provider=codex' in page.evaluate('location.hash'))

            # 3. blur commit of a DIFFERENT typed provider also confirms
            draft = open_page(route, draft_sel)
            field = page.locator(provider_sel)
            field.click()
            for ch in 'xai':
                field.press(ch); page.wait_for_timeout(80)
            page.locator(draft_sel).first.click()  # blur the provider field
            page.wait_for_timeout(500)
            dlg = page.get_by_role('dialog', name='Unsaved changes')
            check(f'[{name}] blur-commit of a different provider confirms',
                  dlg.count() == 1, f'dialogs={dlg.count()}')
            if dlg.count() == 1:
                dlg.get_by_role('button', name='Stay', exact=True).click()
                page.wait_for_timeout(400)
                check(f'[{name}] Stay after blur keeps draft and URL',
                      draft.input_value() == 'unsaved-sentinel' and 'provider=codex' in page.evaluate('location.hash'),
                      f'draft={draft.input_value()!r}')

            # 4. same-provider mouse selection: no dialog, no reset, and the
            #    router guard stays armed (Back must still confirm)
            draft = open_page(route, draft_sel)
            field = page.locator(provider_sel)
            field.click(); page.wait_for_timeout(300)
            page.get_by_role('option', name='codex', exact=True).first.click()
            page.wait_for_timeout(350)
            dlg = page.get_by_role('dialog', name='Unsaved changes')
            check(f'[{name}] same-provider commit does not confirm',
                  dlg.count() == 0, f'dialogs={dlg.count()}')
            check(f'[{name}] same-provider commit keeps draft',
                  draft.input_value() == 'unsaved-sentinel', f'draft={draft.input_value()!r}')
            back = page.get_by_role('button', name='Back', exact=True)
            if back.count():
                back.first.click()
                page.wait_for_timeout(500)
                dlg = page.get_by_role('dialog', name='Unsaved changes')
                check(f'[{name}] Back right after a same-value commit still confirms',
                      dlg.count() == 1, 'the navigation window was silently opened')
                if dlg.count() == 1:
                    dlg.get_by_role('button', name='Stay', exact=True).click()
                    page.wait_for_timeout(300)
            else:
                # alias/excluded pages use the shell Back affordance; the
                # navigation arm is asserted via history hash instead
                page.evaluate("() => window.location.hash = '#/auth-files'")
                page.wait_for_timeout(500)
                dlg = page.get_by_role('dialog', name='Unsaved changes')
                check(f'[{name}] hash navigation after same-value commit still confirms',
                      dlg.count() == 1, 'the navigation window was silently opened')
                if dlg.count() == 1:
                    dlg.get_by_role('button', name='Stay', exact=True).click()
                    page.wait_for_timeout(300)

            # 5. P2-14: Escape with open dropdown closes dropdown without leaving page
            if name in ('alias', 'excluded'):
                draft = open_page(route, draft_sel)
                field = page.locator(provider_sel)
                field.click()
                page.wait_for_timeout(300)
                dropdown = page.locator('.autocomplete-dropdown')
                check(f'[{name}] provider dropdown opens on click',
                      dropdown.count() == 1, f'dropdowns={dropdown.count()}')
                field.press('Escape')
                page.wait_for_timeout(300)
                dlg = page.get_by_role('dialog', name='Unsaved changes')
                check(f'[{name}] Escape with open dropdown closes dropdown without navigating/confirming',
                      dropdown.count() == 0 and dlg.count() == 0 and route in page.evaluate('location.hash'),
                      f'dropdowns={dropdown.count()} dialogs={dlg.count()} hash={page.evaluate("location.hash")}')
                field.press('Escape')
                page.wait_for_timeout(400)
                dlg = page.get_by_role('dialog', name='Unsaved changes')
                check(f'[{name}] second Escape with closed dropdown triggers unsaved-changes guard',
                      dlg.count() == 1, f'dialogs={dlg.count()}')
                if dlg.count() == 1:
                    dlg.get_by_role('button', name='Stay', exact=True).click()
                    page.wait_for_timeout(300)

                if name == 'alias':
                    model_input = page.get_by_placeholder('Source model name').first
                    model_input.click()
                    page.wait_for_timeout(300)
                    if page.locator('.autocomplete-dropdown').count() == 1:
                        model_input.press('Escape')
                        page.wait_for_timeout(300)
                        dlg = page.get_by_role('dialog', name='Unsaved changes')
                        check('[alias] Escape on open model-row dropdown keeps page open',
                              page.locator('.autocomplete-dropdown').count() == 0 and dlg.count() == 0 and route in page.evaluate('location.hash'),
                              f'dropdowns={page.locator(".autocomplete-dropdown").count()} dialogs={dlg.count()}')

            # 6. P2-14: quick-tag click after typing filter does not trigger stale blur commit
            draft = open_page(route, draft_sel)
            field = page.locator(provider_sel)
            field.click()
            for ch in 'xai':
                field.press(ch); page.wait_for_timeout(60)
            page.locator('[class*="tagList"] button').filter(has_text='Codex').first.click()
            page.wait_for_timeout(400)
            dlg = page.get_by_role('dialog', name='Unsaved changes')
            check(f'[{name}] same-provider quick-tag after typing does not open dialog',
                  dlg.count() == 0 and draft.input_value() == 'unsaved-sentinel' and 'provider=codex' in page.evaluate('location.hash'),
                  f'dialogs={dlg.count()} draft={draft.input_value()!r}')

            field.click()
            field.fill('')
            for ch in 'xai':
                field.press(ch); page.wait_for_timeout(60)
            page.locator('[class*="tagList"] button').filter(has_text='Claude').first.click()
            page.wait_for_timeout(400)
            dlg = page.get_by_role('dialog', name='Unsaved changes')
            check(f'[{name}] different-provider quick-tag opens single confirmation',
                  dlg.count() == 1, f'dialogs={dlg.count()}')
            if dlg.count() == 1:
                dlg.get_by_role('button', name='Stay', exact=True).click()
                page.wait_for_timeout(400)
                check(f'[{name}] Stay after quick-tag restores codex and draft',
                      field.input_value().strip() == 'codex' and draft.input_value() == 'unsaved-sentinel' and 'provider=codex' in page.evaluate('location.hash'),
                      f'input={field.input_value()!r} draft={draft.input_value()!r}')

            # 7. P2-14: Save click after typing filter does not trigger stale blur commit
            draft = open_page(route, draft_sel)
            if name == 'alias':
                page.get_by_placeholder('Source model name').first.fill('gpt-5')
                page.wait_for_timeout(150)
            field = page.locator(provider_sel)
            field.click()
            field.fill('')
            field.press('x'); page.wait_for_timeout(150)
            put_count_before = len(mock_state.requests)
            page.get_by_role('button', name=save_label, exact=True).click()
            page.wait_for_timeout(700)
            dlg = page.get_by_role('dialog', name='Unsaved changes')
            check(f'[{name}] Save after typing filter navigates without switch dialog',
                  dlg.count() == 0 and page.evaluate('location.hash').endswith('#/auth-files'),
                  f'dialogs={dlg.count()} hash={page.evaluate("location.hash")}')
            expected_put_path = (
                '/v8/management/config.yaml' if name == 'policy'
                else '/v8/management/config/oauth/model-alias' if name == 'alias'
                else '/v8/management/config/oauth/excluded-models'
            )
            saved_bodies = mock_state.request_bodies.get(f'PUT {expected_put_path}', [])
            check(f'[{name}] Save after typing filter persists codex not typed filter',
                  len(mock_state.requests) > put_count_before and bool(saved_bodies) and 'codex' in saved_bodies[-1],
                  f'bodies={saved_bodies[-1:]!r}')

        # 8. P2-14: ModelPolicy provider switch uses scoped allowNavigationTo (not wildcard allowNextNavigation)
        draft = open_page('/auth-files/model-policy', '#model-policy-allow')
        field = page.locator('#model-policy-provider')
        field.click(); page.wait_for_timeout(250)
        field.fill('')
        for ch in 'kimi':
            field.press(ch); page.wait_for_timeout(60)
        field.press('ArrowDown'); page.wait_for_timeout(100)
        field.press('Enter'); page.wait_for_timeout(400)
        dlg = page.get_by_role('dialog', name='Unsaved changes')
        if dlg.count() == 1:
            dlg.get_by_role('button', name='Leave', exact=True).click()
        page.wait_for_timeout(300)
        check('[policy] Leave switched URL to provider=kimi',
              'provider=kimi' in page.evaluate('location.hash'),
              f'hash={page.evaluate("location.hash")}')
        page.locator('#model-policy-allow').fill('scoped-draft')
        page.wait_for_timeout(150)
        page.get_by_role('button', name='Back', exact=True).first.click()
        page.wait_for_timeout(400)
        dlg = page.get_by_role('dialog', name='Unsaved changes')
        check('[policy] Back immediately after provider switch still confirms',
              dlg.count() == 1, f'dialogs={dlg.count()}')
        if dlg.count() == 1:
            dlg.get_by_role('button', name='Stay', exact=True).click()

        browser.close()

    if failures:
        print(f'guard-provider-switch: {len(failures)} failure(s):')
        for f in failures:
            print(f'  - {f}')
        sys.exit(1)
    print('guard-provider-switch: all real-page behavior checks passed')


if __name__ == '__main__':
    main()

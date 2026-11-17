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
    ('policy', '/auth-files/model-policy', '#model-policy-provider', '#model-policy-allow'),
    ('alias', '/auth-files/oauth-model-alias', '#oauth-model-alias-provider', 'input[class*=mappingAliasInput]'),
    ('excluded', '/auth-files/oauth-excluded', '#oauth-excluded-provider', '#oauth-excluded-custom-rule'),
]


def main():
    app_port, api_port = smoke.find_free_port(), smoke.find_free_port()
    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(Handler, api_port, smoke.MockCoreState()), sync_playwright() as p:
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

        for name, route, provider_sel, draft_sel in PAGES:
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

        browser.close()

    if failures:
        print(f'guard-provider-switch: {len(failures)} failure(s):')
        for f in failures:
            print(f'  - {f}')
        sys.exit(1)
    print('guard-provider-switch: all real-page behavior checks passed')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Model policy editor regression using synthetic Core responses."""

import argparse
import importlib.util
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright
from panel_browser import PanelBrowser

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('panel_smoke', ROOT / 'scripts/smoke-lts-panel.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser-channel', default=None)
    args = parser.parse_args()
    app_port, api_port = smoke.find_free_port(), smoke.find_free_port()
    state = smoke.MockCoreState()
    policies = {}
    legacy = {'claude': ['legacy-*']}
    writes = []
    policy_status = 200
    artifacts = ROOT / 'output/playwright'
    artifacts.mkdir(parents=True, exist_ok=True)

    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(smoke.MockCoreHandler, api_port, state), sync_playwright() as p:
        browser = p.chromium.launch(channel=args.browser_channel)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.add_init_script('localStorage.setItem("cli-proxy-language", JSON.stringify({state:{language:"en"},version:0}));')
        errors = []
        page = PanelBrowser(context.new_page())
        page.raw.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(10000)

        def api(route):
            parsed = urlparse(route.request.url)
            path, method = parsed.path, route.request.method
            if path == '/v0/management/oauth-model-policy':
                if policy_status != 200:
                    route.fulfill(status=policy_status, json={'error': 'fixture unavailable'})
                    return
                if method == 'PATCH':
                    body = route.request.post_data_json
                    writes.append((method, path, body))
                    if body['policy']:
                        policies[body['provider']] = body['policy']
                    else:
                        policies.pop(body['provider'], None)
                    route.fulfill(json={'status': 'ok'})
                else:
                    route.fulfill(json={'oauth-model-policy': policies})
            elif path == '/v0/management/oauth-excluded-models':
                if method == 'DELETE':
                    writes.append((method, path, None))
                    legacy.pop(parse_qs(parsed.query)['provider'][0], None)
                    route.fulfill(json={'status': 'ok'})
                else:
                    route.fulfill(json={'oauth-excluded-models': legacy})
            elif path == '/v0/management/auth-files':
                route.fulfill(json={'files': [{'name': 'policy-fixture.json', 'type': 'codex', 'auth_index': 'fixture', 'size': 32}]})
            elif path == '/v0/management/auth-files/download':
                route.fulfill(json={'type': 'codex', 'model_policy': {'allowlist': {'enabled': False, 'models': ['kept-model']}}})
            else:
                route.continue_()

        context.route('**/v0/management/**', api)
        base = f'http://127.0.0.1:{app_port}/management.html'
        page.goto(base + '#/login')
        page.get_by_label('Custom Connection URL:', exact=True).check(force=True)
        page.get_by_role('textbox', name='Custom Connection URL:', exact=True).fill(f'http://127.0.0.1:{api_port}')
        page.locator('input[name="cpa-management-key"]').fill('smoke-management-key')
        page.get_by_role('button', name='Login', exact=True).click()
        page.wait_for_url(re.compile(r'.*#/$'))

        page.goto(base + '#/auth-files/model-policy?provider=codex')
        allow = page.get_by_role('textbox', name='Allowlist', exact=True)
        deny = page.get_by_role('textbox', name='Denylist', exact=True)
        save = page.get_by_role('button', name='Save', exact=True)
        expect(allow).to_have_value('')
        expect(save).to_be_disabled()
        allow.fill('gpt-*')
        page.get_by_role('button', name='Claude', exact=True).click()
        page.get_by_role('button', name='Stay', exact=True).click()
        expect(allow).to_have_value('gpt-*')
        expect(page.locator('#model-policy-provider')).to_have_value('codex')
        page.get_by_role('button', name='Claude', exact=True).click()
        page.get_by_role('button', name='Leave', exact=True).click()
        expect(allow).to_have_value('')
        expect(page.locator('#model-policy-provider')).to_have_value('claude')
        page.get_by_role('checkbox', name='Denylist', exact=True).locator('..').click()
        warning = page.get_by_text(re.compile('Allowlist is enabled with an empty list'))
        expect(warning).to_have_count(0)
        page.get_by_role('checkbox', name='Allowlist', exact=True).locator('..').click()
        expect(warning).to_be_visible()
        save.click()
        page.wait_for_url(re.compile(r'.*#/auth-files$'))
        assert policies['claude']['allowlist'] == {'enabled': True, 'models': []}

        page.goto(base + '#/auth-files/model-policy?provider=claude')
        expect(save).to_be_disabled()
        page.get_by_role('button', name='Migrate to denylist', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='Confirm', exact=True).click()
        expect(deny).to_have_value('legacy-*')
        assert legacy == {}
        assert [row[0] for row in writes[-2:]] == ['PATCH', 'DELETE']
        page.raw.wait_for_timeout(500)
        page.screenshot(path=str(artifacts / 'model-policy-desktop.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.raw.wait_for_timeout(500)
        expect(allow).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        page.screenshot(path=str(artifacts / 'model-policy-mobile.png'), full_page=True)

        page.goto(base + '#/auth-files')
        card = page.get_by_test_id('auth-file-card').filter(has_text='policy-fixture.json')
        card.get_by_role('button', name='More', exact=True).click()
        page.get_by_role('menuitem', name='Auth File Details / Edit', exact=True).click()
        expect(page.get_by_role('dialog').get_by_role('textbox', name='Allowlist', exact=True)).to_have_value('kept-model')
        page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).last.click()

        policy_status = 404
        page.goto(base + '#/auth-files/model-policy?provider=codex')
        expect(page.get_by_text('This Core version does not support oauth-model-policy. Upgrade Core to use model policy.', exact=True)).to_be_visible()
        expect(save).to_be_disabled()
        page.goto(base + '#/auth-files')
        card.get_by_role('button', name='More', exact=True).click()
        page.get_by_role('menuitem', name='Auth File Details / Edit', exact=True).click()
        expect(page.get_by_role('dialog').get_by_role('textbox', name='Allowlist', exact=True)).to_have_count(0)
        assert not errors, errors
        browser.close()
    print('PASS: empty draft, cancel/confirm provider switch, empty lists, save, migration order, account editing, old-Core gate, desktop/mobile layout')


if __name__ == '__main__':
    main()

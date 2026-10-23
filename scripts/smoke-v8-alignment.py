#!/usr/bin/env python3
"""V8 feature alignment: synthetic localhost mutations, quota and OAuth flows."""
import json
import re
import runpy
import tempfile
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect
from panel_browser import PanelBrowser, launch_chromium

base = runpy.run_path(str(Path(__file__).with_name('smoke-lts-panel.py')))


def run():
    app_port, api_port = base['find_free_port'](), base['find_free_port']()
    api = f'http://127.0.0.1:{api_port}'
    app = f'http://127.0.0.1:{app_port}/management.html'
    base['V8_PROVIDER_FAMILIES']['meta-api-key'] = 'meta'
    state = base['MockCoreState']()
    files = [dict(name=f'{provider}-alignment.json', type=provider,
                  auth_index=f'synthetic-{provider}', source='file')
             for provider in ['codex', 'claude', 'devin', 'meta']]
    calls, claims = [], []
    mode = {'claimed': False}

    def intercept(route):
        req = route.request
        path, method = urlparse(req.url).path, req.method
        body = req.post_data_json if method in ['POST', 'PATCH'] else None
        calls.append((method, path, body))
        def send(payload, status=200):
            route.fulfill(status=status, json=payload, headers={'x-cpa-support-plugin': 'true', 'Access-Control-Allow-Origin': '*'})
        if path.endswith('/credentials') and method == 'GET':
            return send({'files': files})
        if path.endswith('/credentials/refresh'):
            if body.get('all'):
                return send({'ok': True, 'results': [{'id': 'codex-alignment.json', 'success': True}, {'id': 'claude-alignment.json', 'success': False, 'error': 'synthetic-not-for-display'}]})
            assert body == {'name': 'codex-alignment.json', 'auth_index': 'synthetic-codex'}
            return send({'ok': True, 'auth': {'access_token': 'synthetic-not-for-display'}})
        if path.endswith('/routing/cooldown/reset'):
            assert body == {'auth_index': 'synthetic-codex'}
            return send({'status': 'ok', 'auth_index': body['auth_index'], 'models': []})
        if path.endswith('/credentials/download'):
            route.fulfill(json={'dca_token': 'dca:synthetic-not-for-display'}, headers={'Access-Control-Allow-Origin': '*'}); return
        if path.endswith('/oauth/auth-url'):
            provider = parse_qs(urlparse(req.url).query)['provider'][0]
            return send({'status': 'ok', 'url': 'https://auth.example.test/authorize', 'state': f'{provider}-state', 'user_code': 'SYNTHETIC-DEVICE' if provider == 'meta' else None})
        if path.endswith('/oauth/status'):
            return send({'status': 'wait'})
        if path.endswith('/oauth/session'):
            return send({'status': 'ok'})
        if path.endswith('/oauth/callback'):
            return send({'status': 'ok'})
        if path.endswith('/api-call'):
            url = body.get('url', '')
            if 'GetUserStatus' in url:
                return send(base['build_api_call_result']({'userStatus': {'planStatus': {'dailyQuotaRemainingPercent': 60, 'weeklyQuotaRemainingPercent': 20, 'planInfo': {'planName': 'Synthetic Devin'}}}}))
            if 'api.meta.ai/muse-code/key' in url:
                assert body['header']['Authorization'] == 'Bearer dca:synthetic-not-for-display'
                return send(base['build_api_call_result']({'api_key': 'synthetic-not-for-display', 'subs_tier_name': 'Synthetic Meta', 'is_subs_active': True, 'subs_usage': {'window': {'used_percent': 25, 'window_duration_mins': 300}, 'weekly': {'used_percent': 40}}}))
            if 'cedar_ember' in url:
                return send(base['build_api_call_result']({'cedar_ember': {'eligible': True, 'at_limit': True, 'grants': [{'id': 'sample', 'label': 'Synthetic grant', 'resets_total': 2, 'resets_left': 1 if mode['claimed'] else 2, 'usable_now': True, 'clears': ['five_hour']}]}}))
            if url.endswith('/api/oauth/profile'):
                return send(base['build_api_call_result']({'organization': {'uuid': '11111111-1111-1111-1111-111111111111'}}))
            if url.endswith('/reset_rate_limits'):
                claims.append(json.loads(body['data']))
                if len(claims) == 1:
                    return send({'error': 'synthetic unknown outcome'}, 504)
                mode['claimed'] = True
                return send(base['build_api_call_result']({'result': 'already_used'}))
        route.continue_()

    with base['run_server'](base['StaticPanelHandler'], app_port), base['run_server'](base['MockCoreHandler'], api_port, state), sync_playwright() as pw:
        browser = launch_chromium(pw, headless=True)
        context = browser.new_context(locale='en-US', viewport={'width': 1440, 'height': 1000})
        context.add_init_script("localStorage.setItem('cli-proxy-language',JSON.stringify({state:{language:'en'},version:0}));")
        context.route(api + '/v8/management/**', intercept)
        page = PanelBrowser(context.new_page()); page.set_default_timeout(10000)
        errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(app + '/#/login')
        page.locator('input[type=checkbox]').first.check(force=True)
        page.locator('input.input').first.fill(api)
        page.locator('input[name=cpa-management-key]').fill('synthetic-management')
        page.get_by_role('button', name=re.compile(r'^(Connect|Login)$')).click()
        page.wait_for_url(re.compile(r'.*/#/$'))
        page.goto(app + '/#/auth-files')
        def open_action(label, provider='codex'):
            card = page.get_by_test_id('auth-file-card').filter(has=page.get_by_text(f'{provider}-alignment.json', exact=True))
            card.get_by_role('button', name=re.compile('More', re.I)).click()
            page.get_by_text(label, exact=True).click()
            return page.get_by_role('dialog').last
        dialog = open_action('Refresh tokens')
        assert not any(path.endswith('/credentials/refresh') for _, path, _ in calls)
        dialog.get_by_role('button', name='Close', exact=True).last.click()
        dialog = open_action('Refresh tokens')
        dialog.get_by_role('button', name='Confirm', exact=True).click()
        expect(dialog).to_contain_text('Succeeded')
        assert 'synthetic-not-for-display' not in dialog.inner_text()
        dialog.get_by_role('button', name='Close', exact=True).last.click()
        dialog = open_action('Clear cooldown')
        dialog.get_by_role('button', name='Confirm', exact=True).click()
        expect(dialog).to_contain_text('Succeeded')
        dialog.get_by_role('button', name='Close', exact=True).last.click()
        page.get_by_role('button', name=re.compile('More', re.I)).first.click()
        page.get_by_text('Refresh all tokens', exact=True).click()
        dialog = page.get_by_role('dialog').last
        dialog.get_by_role('button', name='Confirm', exact=True).click()
        expect(dialog).to_contain_text('Failed')
        assert 'synthetic-not-for-display' not in dialog.inner_text()
        dialog.get_by_role('button', name='Close', exact=True).last.click()
        print('PASS refresh confirmation, identity, batch partial results, cooldown and response redaction')

        for provider, plan in [('devin', 'Synthetic Devin'), ('meta', 'Synthetic Meta')]:
            page.goto(app + f'/#/quota?provider={provider}')
            card = page.get_by_role('article').filter(has=page.get_by_text(f'{provider}-alignment.json', exact=True))
            card.get_by_role('button').first.click()
            expect(card).to_contain_text(plan)
            assert 'synthetic-not-for-display' not in page.locator('body').inner_text()
            for width in [1440, 390]:
                page.set_viewport_size({'width': width, 'height': 950})
                page.wait_for_timeout(500)
                assert card.evaluate('(node) => node.getBoundingClientRect().width <= innerWidth')
                card.screenshot(path=str(Path(tempfile.gettempdir()) / f'cpa-alignment-{provider}-{width}.png'))
            page.set_viewport_size({'width': 1440, 'height': 1000})
        print('PASS Devin/Meta quota, DCA isolation and responsive cards')

        page.goto(app + '/#/oauth?provider=devin')
        card = page.locator('[data-focused=true]')
        card.get_by_role('button').first.click()
        expect(card).to_contain_text('https://auth.example.test/authorize')
        callback = card.get_by_role('textbox')
        callback.fill('http://localhost:1234/callback?state=wrong&code=synthetic')
        before = sum(path.endswith('/oauth/callback') for _, path, _ in calls)
        card.get_by_role('button', name='Submit Callback URL', exact=True).click()
        assert sum(path.endswith('/oauth/callback') for _, path, _ in calls) == before
        callback.fill('http://localhost:1234/callback?state=devin-state&code=synthetic')
        card.get_by_role('button', name='Submit Callback URL', exact=True).click()
        page.wait_for_timeout(100)
        assert sum(path.endswith('/oauth/callback') for _, path, _ in calls) == before + 1
        card.get_by_role('button', name='Cancel', exact=True).click()
        page.goto(app + '/#/oauth?provider=meta')
        card = page.locator('[data-focused=true]')
        card.get_by_role('button').first.click()
        expect(card).to_contain_text('SYNTHETIC-DEVICE')
        card.get_by_role('button', name='Cancel', exact=True).click()
        print('PASS Devin callback state validation, Meta device code and session cancellation')

        page.goto(app + '/#/auth-files')
        labels = json.loads((Path(__file__).parent.parent / 'src/i18n/locales/en.json').read_text())['claude_reset']
        dialog = open_action(labels['title'], 'claude')
        expect(dialog).to_contain_text('Synthetic grant')
        assert not claims
        dialog.get_by_role('button', name=labels['use'], exact=True).click()
        page.get_by_role('dialog').last.get_by_role('button', name=labels['confirm'], exact=True).click()
        expect(dialog).to_contain_text(labels['unknown'])
        dialog.get_by_role('button', name=labels['retry'], exact=True).click()
        page.get_by_role('dialog').last.get_by_role('button', name=labels['retry'], exact=True).click()
        page.wait_for_timeout(100)
        assert len(claims) == 2 and claims[0]['request_id'] == claims[1]['request_id']
        assert not any(path.endswith('/routing/cooldown/reset') and body.get('auth_index') == 'synthetic-claude' for _, path, body in calls if body)
        dialog.get_by_role('button', name='Close', exact=True).click()
        print('PASS Claude explicit confirmation and same-id ambiguous retry without unrelated cooldown reset')

        page.goto(app + '/#/ai-providers?provider=meta')
        page.get_by_role('button', name='New', exact=True).first.click()
        sheet = page.get_by_role('dialog').last
        sheet.get_by_role('textbox', name='API key', exact=True).fill('synthetic-meta-created')
        expect(sheet.get_by_label('Base URL', exact=True)).to_have_value('https://api.meta.ai/v1')
        with page.expect_response(lambda response: response.request.method == 'PUT' and response.url.endswith('/v8/management/config/api-keys/meta')) as saved:
            sheet.get_by_role('button', name='Create', exact=True).click()
        assert saved.value.status == 200
        print('PASS Meta native provider create and canonical group route')

        page.goto(app + '/#/config')
        base['locate_config_field'](page, 'githubToken', 'server.github-token')
        field = page.get_by_label('GitHub access token', exact=True)
        assert field.get_attribute('type') == 'password'
        field.fill('synthetic-config-token')
        page.locator('button[aria-label="Save"]').click()
        with page.expect_response(lambda response: response.request.method == 'PUT' and response.url.endswith('/v8/management/config.yaml')):
            page.get_by_role('button', name='Confirm Save', exact=True).click()
        page.wait_for_function("!document.querySelector('button[aria-label=\"Save\"]:not([disabled])')")
        assert 'github-token: synthetic-config-token' in state.config_yaml
        print('PASS GitHub token canonical visual save and password input')
        assert not errors, errors
        print('PASS page errors=0; all requests stayed in synthetic localhost fixtures')
        context.close(); browser.close()


if __name__ == '__main__':
    run()

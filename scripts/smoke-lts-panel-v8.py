#!/usr/bin/env python3
"""Focused SIWC and plugin/Claude quota UI checks using synthetic local data."""
from __future__ import annotations
import json, re, runpy, sys, tempfile
from pathlib import Path
from urllib.parse import urlparse
from panel_browser import PanelBrowser, launch_chromium
from playwright.sync_api import sync_playwright, expect

base = runpy.run_path(str(Path(__file__).with_name('smoke-lts-panel.py')))

def run():
    app_port, api_port = base['find_free_port'](), base['find_free_port']()
    api = f'http://127.0.0.1:{api_port}'
    app = f'http://127.0.0.1:{app_port}/management.html'
    state = base['MockCoreState']()
    files = [
        {'name':'siwc-ui.json','type':'codex','auth_index':'synthetic-siwc','source':'file','siwc_bind_supported':True,'siwc_bound':False,'use_siwc':False},
        {'name':'plugin-ui.json','type':'custom-quota','auth_index':'synthetic-plugin','source':'file','supports_quota':True,'quota_provider':'custom','quota_plugin_id':'selected-plugin'},
        {'name':'claude-ui.json','type':'claude','auth_index':'synthetic-claude','source':'file'},
    ]
    calls=[]; pending=[]; mode={'delay':False,'callback':False,'poll_error':True}
    def intercept(route):
        req=route.request; path=urlparse(req.url).path; method=req.method
        calls.append((method,path))
        def send(body,status=200): route.fulfill(status=status,json=body,headers={'x-cpa-support-plugin':'true','Access-Control-Allow-Origin':'*'})
        if path.endswith('/credentials') and method=='GET': return send({'files':files})
        if path.endswith('/credentials/fields') and method=='PATCH':
            body=req.post_data_json; files[0]['use_siwc']=body['use_siwc']; return send({'status':'ok'})
        if path.endswith('/oauth/siwc/bind'):
            payload={'status':'ok','flow':'siwc_bind','url':'https://auth.example.test/authorize','state':'synthetic-siwc-state','expires_in':600}
            if mode['delay']: pending.append((route,payload)); return
            return send(payload)
        if path.endswith('/oauth/status'):
            if mode['poll_error']:
                mode['poll_error']=False;return send({'error':'synthetic transient error'},503)
            if mode['callback']:
                files[0].update(siwc_bound=True,use_siwc=True);return send({'status':'ok'})
            return send({'status':'wait'})
        if path.endswith('/oauth/callback'): mode['callback']=True;return send({'status':'ok'})
        if path.endswith('/oauth/session') and method=='DELETE':return send({'status':'ok'})
        if path.endswith('/plugins/selected-plugin/quota'):
            assert req.post_data_json=={'auth_index':'synthetic-plugin'}
            return send({'groups':[],'summary':[{'key':'balance','label':'Synthetic credit balance','value':12.5,'format':'currency','currency':'USD'}]})
        if path.endswith('/api-call') and 'api.anthropic.com/api/oauth/usage' in str(req.post_data_json.get('url')):
            return send(base['build_api_call_result']({'five_hour':{'utilization':25,'resets_at':'2026-10-24T00:00:00Z'},'extra_usage':{'is_enabled':True,'used_credits':125,'monthly_limit':1000,'utilization':12.5,'currency':'USD'},'iguana_necktie':{'used_dollars':15,'limit_dollars':20,'remaining_dollars':5,'utilization':75,'resets_at':'2026-10-24T00:00:00Z'}}))
        route.continue_()
    with base['run_server'](base['StaticPanelHandler'],app_port), base['run_server'](base['MockCoreHandler'],api_port,state), sync_playwright() as pw:
        browser=launch_chromium(pw,headless=True)
        context=browser.new_context(locale='en-US',viewport={'width':1440,'height':1000})
        context.add_init_script("localStorage.setItem('cli-proxy-language',JSON.stringify({state:{language:'en'},version:0}));")
        context.route(api+'/v8/management/**',intercept)
        page=PanelBrowser(context.new_page());page.set_default_timeout(10000)
        errors=[];page.on('pageerror',lambda err: errors.append(str(err)))
        page.goto(app+'/#/login')
        page.locator('input[type=checkbox]').first.check(force=True)
        page.locator('input.input').first.fill(api)
        page.locator('input[name=cpa-management-key]').fill('synthetic-management')
        page.get_by_role('button',name=re.compile(r'^(Connect|Login)$')).click()
        page.wait_for_url(re.compile(r'.*/#/$'))
        page.goto(app+'/#/config')
        page.get_by_role('searchbox').wait_for()
        for cycle in range(10):
            for field,key in [('transientErrorCooldownSeconds','transient-error-cooldown-seconds'),('disableImageGeneration','disable-image-generation'),('codexOutboundRequestCompression','outbound.request-compression')]:
                page.evaluate("window.__configSearchNode = document.querySelector('input[type=search]')")
                try:
                    base['locate_config_field'](page,field,key)
                    if field=='transientErrorCooldownSeconds':page.get_by_label('Transient Error Cooldown (seconds)',exact=True).fill(str(cycle))
                except Exception:
                    print('SEARCH DIAGNOSTIC',page.evaluate("({same:window.__configSearchNode===document.querySelector('input[type=search]'),value:document.querySelector('input[type=search]')?.value,hash:location.hash})"))
                    raise
        print('PASS repeated config field navigation')
        page.goto(app+'/#/auth-files')
        def open_siwc():
            card=page.get_by_test_id('auth-file-card').filter(has=page.get_by_text('siwc-ui.json',exact=True))
            card.wait_for()
            card.get_by_role('button',name=re.compile('More',re.I)).click()
            page.get_by_text('Bind SIWC',exact=True).click()
            return page.get_by_role('dialog')
        dialog=open_siwc()
        dialog.get_by_role('button',name='Start authorization',exact=True).click()
        expect(dialog.get_by_role('status')).to_contain_text('failed')
        for width in (1440,390):
            page.set_viewport_size({'width':width,'height':950})
            expect(dialog).to_be_visible()
            assert dialog.evaluate('(node) => node.getBoundingClientRect().width <= innerWidth'),f'SIWC overflow at {width}'
            shot=Path(tempfile.gettempdir())/f'cpa-v8-siwc-{width}.png'
            dialog.screenshot(path=str(shot))
            print('SCREENSHOT',shot)
        page.set_viewport_size({'width':1440,'height':950})
        callback=dialog.get_by_role('textbox')
        callback.fill('http://127.0.0.1:1455/auth/callback?state=wrong&code=synthetic&client_id=synthetic')
        before=sum(p.endswith('/oauth/callback') for _,p in calls)
        dialog.get_by_role('button',name='Submit',exact=True).click()
        expect(dialog.get_by_role('alert')).to_be_visible()
        assert before==sum(p.endswith('/oauth/callback') for _,p in calls)
        callback.fill('http://127.0.0.1:1455/auth/callback?state=synthetic-siwc-state&code=synthetic&client_id=synthetic')
        dialog.get_by_role('button',name='Submit',exact=True).click()
        expect(dialog.get_by_role('status').first).to_contain_text('bound')
        dialog.get_by_role('button',name='Done',exact=True).click()
        dialog=open_siwc()
        dialog.get_by_text('Use SIWC',exact=True).click()
        expect(dialog.get_by_role('checkbox')).not_to_be_checked()
        assert files[0]['use_siwc'] is False
        dialog.get_by_role('button',name='Close',exact=True).last.click()
        mode['delay']=True;mode['callback']=False
        dialog=open_siwc();dialog.get_by_role('button',name='Start authorization',exact=True).click()
        page.wait_for_function('() => document.querySelector("[role=dialog]")?.textContent.includes("Generating")')
        dialog.get_by_role('button',name='Close',exact=True).last.click()
        assert pending
        route,payload=pending.pop()
        # Observe the late response's compensating DELETE, not just an unmounted modal.
        with page.expect_response(lambda r:r.request.method=='DELETE' and '/oauth/session' in r.url):
            route.fulfill(json=payload,headers={'x-cpa-support-plugin':'true','Access-Control-Allow-Origin':'*'})
        print('PASS SIWC invalid callback, failed-poll recovery, toggle readback, late-start cancellation')
        page.goto(app+'/#/quota')
        for title in ('Claude Quota','Plugin Quota'):
            page.locator('div.card').filter(has=page.get_by_text(title,exact=True)).get_by_role('button',name=re.compile('Refresh all',re.I)).click()
        page.get_by_text('Synthetic credit balance',exact=True).wait_for()
        expect(page.get_by_text('$12.50',exact=False).first).to_be_visible()
        expect(page.get_by_text('$1.25',exact=False).first).to_be_visible()
        expect(page.get_by_text('$15.00',exact=False).first).to_be_visible()
        assert not any('/plugins/selected-plugin/quota' not in p and p.endswith('/quota') for m,p in calls if m=='POST')
        for width in (1440,390):
            page.set_viewport_size({'width':width,'height':950})
            page.wait_for_timeout(250)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),f'overflow at {width}'
            shot=Path(tempfile.gettempdir())/f'cpa-v8-quota-{width}.png'
            page.screenshot(path=str(shot),full_page=True)
            print('SCREENSHOT',shot)
            plugin=page.locator('div.card').filter(has=page.get_by_text('Plugin Quota',exact=True))
            plugin.scroll_into_view_if_needed()
            shot=Path(tempfile.gettempdir())/f'cpa-v8-plugin-{width}.png'
            plugin.screenshot(path=str(shot))
            print('SCREENSHOT',shot)
        assert not errors,errors
        print('PASS plugin native quota route, Claude separate currency units, desktop/mobile layout; page errors=0')
        browser.close()

if __name__=='__main__':
    try:run()
    except Exception as exc:
        print(type(exc).__name__+': '+str(exc),file=sys.stderr);raise

#!/usr/bin/env python3
"""Verify default login and both API scopes behind a reverse proxy prefix."""
from pathlib import Path
import re,runpy
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
from panel_browser import PanelBrowser,launch_chromium
base=runpy.run_path(str(Path(__file__).with_name('smoke-lts-panel.py')))
requests=[]
class PrefixCore(base['MockCoreHandler']):
    def dispatch(self,method):
        path=urlparse(self.path).path
        if method=='do_GET' and path=='/uat/management.html':
            return self._send_bytes(base['INDEX_HTML'].read_bytes(),content_type='text/html; charset=utf-8')
        requests.append((method,self.path))
        if path.startswith('/uat/'):
            self.path=self.path[4:]
            return getattr(super(),method)()
        return self._send_json({'error':'prefix_required'},status=404)
    def do_GET(self):return self.dispatch('do_GET')
    def do_POST(self):return self.dispatch('do_POST')
    def do_PUT(self):return self.dispatch('do_PUT')
    def do_PATCH(self):return self.dispatch('do_PATCH')
    def do_DELETE(self):return self.dispatch('do_DELETE')

def run():
    port=base['find_free_port']();origin=f'http://127.0.0.1:{port}'
    with base['run_server'](PrefixCore,port,base['MockCoreState']()),sync_playwright() as pw:
        browser=launch_chromium(pw,headless=True)
        context=browser.new_context(locale='en-US')
        context.add_init_script("localStorage.setItem('cli-proxy-language',JSON.stringify({state:{language:'en'},version:0}));")
        page=PanelBrowser(context.new_page());page.set_default_timeout(15000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(origin+'/uat/management.html#/login')
        expect(page.get_by_text(origin+'/uat',exact=True)).to_be_visible()
        page.locator('input[name=cpa-management-key]').fill('synthetic-prefix-management')
        page.get_by_role('button',name=re.compile(r'^(Login|Connect)$')).click()
        page.wait_for_url(re.compile(r'#/$'))
        page.get_by_role('link',name='Config Panel',exact=True).click()
        expect(page.get_by_role('searchbox')).to_be_visible()
        with page.expect_response(lambda response:'/uat/v0/management/usage' in response.url):
            page.evaluate("location.hash='/usage'")
        paths=[path for _,path in requests]
        assert any(p.startswith('/uat/v8/management/config.yaml') for p in paths)
        assert any(p.startswith('/uat/v0/management/usage') for p in paths)
        assert all(p.startswith('/uat/') for p in paths if '/management/' in p),paths
        assert not errors,errors
        print('PASS default prefixed login, V8 config and LTS usage routes; page errors=0')
        browser.close()
if __name__=='__main__':run()

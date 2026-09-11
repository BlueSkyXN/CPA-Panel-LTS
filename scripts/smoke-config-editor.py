#!/usr/bin/env python3
"""Configuration editor browser regression, using only the local mock Core."""
from __future__ import annotations
from panel_browser import PanelBrowser

import importlib.util
import json
import re
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_smoke", ROOT / "scripts/smoke-lts-panel.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
OUTPUT = ROOT / "local/config-editor-redesign"
STOP = threading.Event()


class ConfigSurface:
    """Keep browser operations on the page and editor operations in the active workspace."""

    def __init__(self, page):
        self.page = page

    def __getattr__(self, name):
        if name in {'goto', 'reload', 'screenshot', 'set_viewport_size'}:
            return getattr(self.page, name)
        self.page.wait_for_function('''() =>
          document.querySelector('iframe[data-connection-frame][data-active="true"]') ||
          document.querySelector('input[type="search"]')
        ''')
        frame = self.page.locator('iframe[data-connection-frame][data-active="true"]')
        if frame.count():
            return getattr(frame.element_handle().content_frame(), name)
        return getattr(self.page, name)


def flow_payload():
    state = {"enabled": False, "active-requests": 0, "active-attempts": 0,
             "waiting": 0, "queued-bytes": 0, "buckets": [], "admitted": 0,
             "rejected": 0, "timed-out": 0, "canceled": 0, "waited": 0,
             "sampled-at": "2026-09-11T00:00:00Z", "process-id": "config-smoke",
             "policy-revision": 1, "policy": {"version": 3, "enabled": False, "rules": []}}
    return {"schema-version": 3, "supported": True, "state": state,
            "keys": [], "accounts": [], "models": [], "model-options": [],
            "events-supported": True, "events-enabled": True, "events-interval-ms": 500}


class ConfigCore(base.MockCoreHandler):
    def do_GET(self):
        if self.path == "/v0/management/flow-control":
            self.state.record("GET", self.path)
            self._send_json(flow_payload())
        elif self.path == "/v0/management/flow-control/events":
            self.state.record("GET", self.path)
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                while not STOP.is_set():
                    self.wfile.write(("data: " + json.dumps(flow_payload()) + "\n\n").encode())
                    self.wfile.flush()
                    STOP.wait(0.25)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            super().do_GET()


def locate(page, field, key):
    base.locate_config_field(page, field, key)
    assert page.get_by_role("dialog").count() == 0, "Internal navigation must not open a leave dialog"


def check_layout(page):
    page.evaluate("""async () => {
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    }""")
    result = page.locator('[data-config-page]:visible').evaluate("""node => {
      const root = node.closest('[class*="editorContent"]');
      return { width: root.clientWidth, scroll: root.scrollWidth };
    }""")
    assert result["scroll"] <= result["width"] + 1, result
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    if page.locator('[data-config-field]:visible input').count():
        field = page.locator('[data-config-field]:visible input').last
        field.focus()
        field.evaluate("node => node.scrollIntoView({block:'center'})")
        rect = field.bounding_box()
        footer = page.locator('[class*="actionBar_"]').first.bounding_box()
        assert rect and footer and rect['y'] + rect['height'] <= footer['y'] + 1, (rect, footer)


def check_contrast(page):
    failures = page.evaluate("""() => {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const p=[...ctx.getImageData(0,0,1,1).data];return [p[0],p[1],p[2],p[3]/255];};
      const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
      const background=node=>{const parents=[];for(let n=node;n;n=n.parentElement)parents.unshift(n);let bg=[255,255,255];for(const n of parents)bg=blend(rgba(getComputedStyle(n).backgroundColor),bg);return bg;};
      const lum=c=>c.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
      const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
      const failures=[];
      for(const n of document.querySelectorAll('[data-config-page] label,[data-config-page] legend,[class*="choiceDescription"],[data-config-page] input:not([type=checkbox]):not([type=radio]),[data-config-page] button[aria-haspopup=listbox],[class*="directoryPages"] button[aria-current=page],[data-testid="config-page-introduction"],[class*="configHelp"] summary,[class*="configHelp"] p,[data-testid="config-buffer-warning"],[data-testid="config-hedging-condition"],[data-config-default-reference]')) {
        if(!n.getClientRects().length || n.disabled)continue;
        const s=getComputedStyle(n),bg=background(n),ratio=contrast(blend(rgba(s.color),bg),bg);
        if(ratio<4.5)failures.push({kind:'text',tag:n.tagName,ratio,color:s.color});
        if(n.matches('input:not([type=checkbox]),button[aria-haspopup=listbox]')){
          const border=contrast(blend(rgba(s.borderTopColor),bg),bg);
          if(border<3)failures.push({kind:'control border',tag:n.tagName,ratio:border,color:s.borderTopColor});
        }
      }
      return failures;
    }""")
    assert not failures, failures


def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    app_port, api_port = base.find_free_port(), base.find_free_port()
    state = base.MockCoreState()
    state.config_yaml += '\nflow-control:\n  version: 3\n  enabled: false\n  rules: []\n'
    errors = []
    with base.run_server(base.StaticPanelHandler, app_port), base.run_server(ConfigCore, api_port, state), sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        context.add_init_script("""
          if (!localStorage.getItem('cli-proxy-language')) localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));
          window.configSSE={started:0,aborted:0};
          const fetchOriginal=window.fetch;
          window.fetch=(url,options)=>{
            if(String(url).includes('/flow-control/events')) {
              window.configSSE.started++;
              options.signal.addEventListener('abort',()=>window.configSSE.aborted++,{once:true});
            }
            return fetchOriginal(url,options);
          };
        """)
        page = PanelBrowser(context.new_page())
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        app_url = f"http://127.0.0.1:{app_port}/management.html"
        page.goto(app_url + '#/login')
        page.locator('input[type="checkbox"]').first.check(force=True)
        page.locator('input.input').first.fill(f'http://127.0.0.1:{api_port}')
        page.locator('input[name="cpa-management-key"]').fill('smoke-management-key')
        page.get_by_label('Remember password').check(force=True)
        page.get_by_role('button', name=re.compile('Login|Connect', re.I)).click()
        page.wait_for_url(re.compile(r'#/$'))
        page.goto(app_url + '#/config')
        page = ConfigSurface(page)
        page.get_by_role('searchbox').wait_for()
        assert not any('/flow-control' in request for request in state.requests), 'Hidden flow module fetched status'

        locate(page, 'codexAbnormalReasoningRetryAction', 'abnormal-reasoning-retry.action')
        modes = page.get_by_role('group', name='Retry action', exact=True)
        assert modes.get_by_role('radio').count() == 3
        modes.get_by_role('radio', name='Disabled', exact=True).check()
        modes.get_by_role('radio', name='Disabled', exact=True).press('ArrowDown')
        assert modes.get_by_role('radio', name='Observe only', exact=True).is_checked()
        modes.get_by_role('radio', name='Observe only', exact=True).press('ArrowDown')
        assert modes.get_by_role('radio', name='Retry', exact=True).is_checked()
        page.get_by_test_id('config-editor-help').locator('summary').click()
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', '对冲延迟')
        assert page.get_by_test_id('config-editor-help').get_attribute('open') is not None
        page.get_by_test_id('config-editor-help').locator('summary').click()
        assert page.get_by_test_id('config-page-introduction').inner_text()
        assert 'Hedging is off' in page.get_by_test_id('config-hedging-condition').inner_text()
        hedging_modes = page.get_by_role('group', name='Hedged retry mode', exact=True)
        assert hedging_modes.get_by_role('radio').count() == 2
        assert page.locator('[data-config-page]:visible [data-testid="codex-draft-summary"]').count() == 0
        hedging_modes.get_by_role('radio', name='Speed', exact=True).check()
        hedging_modes.get_by_role('radio', name='Quality (default)', exact=True).check()
        assert '1000 ms' in page.locator('[data-config-default-reference="codexAbnormalReasoningRetryHedgeDelayMs"]').inner_text()
        page.get_by_label('Hedge delay (ms)').fill('250')
        locate(page, 'codexAbnormalReasoningRetryAction', 'abnormal-reasoning-retry.action')
        modes.get_by_role('radio', name='Observe only', exact=True).check()
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
        page.get_by_role('button', name='Go to mode and scope', exact=True).click()
        assert modes.is_visible()
        assert page.get_by_role('dialog').count() == 0
        modes.get_by_role('radio', name='Retry', exact=True).check()
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
        assert page.get_by_label('Hedge delay (ms)').input_value() == '250'
        locate(page, 'codexAbnormalReasoningRetryStreamBuffer', 'abnormal-reasoning-retry.stream-buffer')
        buffer_switch = page.locator('[data-config-field="codexAbnormalReasoningRetryStreamBuffer"] input[type="checkbox"]')
        was_buffered = buffer_switch.is_checked()
        if was_buffered:
            buffer_switch.press('Space')
        assert page.get_by_test_id('config-buffer-warning').is_visible()
        for theme in ['white', 'aurora-dawn', 'aurora-nebula']:
            page.evaluate('(theme)=>document.documentElement.setAttribute("data-theme",theme)', theme)
            check_contrast(page)
        if buffer_switch.is_checked() != was_buffered:
            buffer_switch.press('Space')
        locate(page, 'redisUsageQueueRetentionSeconds', 'Redis 保留时间')
        page.get_by_label('Redis Usage Queue Retention (seconds)').fill('0')
        locate(page, 'disableImageGeneration', '图像生成')
        assert page.locator('[class*="errorSummary"] button').count() == 1
        page.locator('[class*="errorSummary"] button').click()
        page.get_by_label('Redis Usage Queue Retention (seconds)').fill('60')
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
        assert page.get_by_label('Hedge delay (ms)').input_value() == '250'
        assert page.locator('[data-config-domain="codex-policy"]').get_attribute('aria-label').endswith('Unsaved changes')

        state.config_yaml += '\nconcurrent-editor-marker: preserve-me\n'
        page.locator('button[aria-label="Save"]').click()
        assert page.get_by_test_id('config-diff-target').inner_text() == page.get_by_test_id('config-save-target').inner_text()
        page.get_by_role('button', name='Confirm Save').click()
        page.get_by_text('Configuration saved successfully', exact=False).first.wait_for()
        assert 'hedge-delay-ms: 250' in state.config_yaml
        assert 'unmanaged-lts-smoke: keep-me' in state.config_yaml
        assert 'concurrent-editor-marker: preserve-me' in state.config_yaml
        assert 'action: retry' in state.config_yaml
        assert not page.locator('[data-config-domain="codex-policy"]').get_attribute('aria-label').endswith('Unsaved changes')

        locate(page, 'flowControlRulesText', 'flow-control.rules')
        assert any(request == 'GET /v0/management/flow-control' for request in state.requests)
        assert not any('/flow-control/events' in request for request in state.requests)
        flow_rules = page.locator('[data-config-field="flowControlRulesText"]')
        flow_rules.get_by_role('button', name='Add rule', exact=True).click()
        flow_rules.get_by_role('button', name='Add rule', exact=True).click()
        disclosures = flow_rules.locator('details[class*="ruleDisclosure"]')
        assert disclosures.count() == 2
        second_id = disclosures.nth(1).get_by_label('Rule ID (stable IDs preserve rate history)', exact=True)
        second_id.fill('renamed')
        second_id.press('End')
        second_id.press_sequentially('-rule')
        assert second_id.input_value() == 'renamed-rule'
        assert second_id.evaluate('node => node === document.activeElement')
        disclosures.nth(1).locator(':scope > summary').click()
        disclosures.first.get_by_role('button', name='Remove rule', exact=True).click()
        assert disclosures.count() == 1
        assert disclosures.first.get_attribute('open') is None, 'Remaining rule inherited removed rule expansion'
        disclosures.first.locator(':scope > summary').click()
        assert disclosures.first.get_by_label('Rule ID (stable IDs preserve rate history)', exact=True).input_value() == 'renamed-rule'
        disclosures.first.get_by_role('button', name='Remove rule', exact=True).click()
        locate(page, 'flowControlIntervalMs', 'flow-control.observation.interval-ms')
        page.get_by_role('button', name='Observe live', exact=True).click()
        page.wait_for_function('window.configSSE.started === 1')
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
        page.wait_for_function('window.configSSE.aborted === window.configSSE.started')
        locate(page, 'flowControlIntervalMs', 'flow-control.observation.interval-ms')
        page.wait_for_function('window.configSSE.started === 2')
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
        page.wait_for_function('window.configSSE.aborted === 2')

        # A hidden Raw rule error remains reachable without discarding another page's draft.
        locate(page, 'payloadDefaultRawRules', 'payload.default-raw')
        raw = page.locator('[data-config-field="payloadDefaultRawRules"]')
        raw.get_by_role('button', name='Add Rule', exact=True).click()
        raw.get_by_role('button', name='Add Parameter', exact=True).click()
        raw.locator('textarea').fill('{')
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
        page.locator('[class*="errorSummary"] button').click()
        assert raw.locator('textarea').is_visible()
        raw.locator('textarea').fill('1')
        assert page.locator('[class*="errorSummary"]').count() == 0
        # Search must scroll the focused control, not the centre of a tall rule group.
        for _ in range(3):
            raw.get_by_role('button', name='Add Rule', exact=True).click()
        locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
        locate(page, 'payloadDefaultRawRules', 'payload.default-raw')
        page.wait_for_function("document.activeElement?.closest('[data-config-field]')?.dataset.configField === 'payloadDefaultRawRules'")
        focus = page.evaluate("""() => {
          const r=document.activeElement.getBoundingClientRect();
          const footer=document.querySelector('[class*="actionBar_"]').getBoundingClientRect();
          return {top:r.top,bottom:r.bottom,footer:footer.top,header:document.querySelector('.main-header').getBoundingClientRect().bottom};
        }""")
        assert focus['top'] >= focus['header'] and focus['bottom'] <= focus['footer'], focus
        page.locator('button[aria-label="Reload"]').click()
        page.get_by_role('dialog').get_by_role('button', name='Reload', exact=True).click()
        page.wait_for_function("!document.querySelector('button[aria-label=\"Save\"]:not([disabled])')")

        for width, height in [(1440,900),(1280,800),(1024,768),(768,1024),(390,844),(320,844)]:
            page.set_viewport_size({'width':width,'height':height})
            locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
            check_layout(page)
            page.screenshot(path=str(OUTPUT / f'codex-{width}.png'))

        page.set_viewport_size({'width':1440,'height':900})
        for theme in ['white','aurora-dawn','aurora-nebula']:
            page.evaluate('(theme)=>document.documentElement.setAttribute("data-theme",theme)',theme)
            check_layout(page)
            check_contrast(page)
            page.screenshot(path=str(OUTPUT / f'codex-{theme}.png'))
        for language in ['zh-CN','en','zh-TW','ru']:
            page.evaluate("language => localStorage.setItem('cli-proxy-language',JSON.stringify({state:{language},version:0}))",language)
            page.reload()
            page.get_by_role('searchbox').wait_for()
            locate(page, 'codexAbnormalReasoningRetryHedgeDelayMs', 'hedge-delay-ms')
            check_layout(page)
            check_contrast(page)
            page.screenshot(path=str(OUTPUT / f'codex-{language}.png'))
            page.set_viewport_size({'width':320,'height':844})
            check_layout(page)
            page.screenshot(path=str(OUTPUT / f'codex-help-{language}-320.png'))
            locate(page, 'codexAbnormalReasoningRetryAction', 'abnormal-reasoning-retry.action')
            check_layout(page)
            check_contrast(page)
            page.locator('#config-page-heading').evaluate("node => node.scrollIntoView({block:'start'})")
            page.screenshot(path=str(OUTPUT / f'codex-scope-{language}-320.png'))
            page.set_viewport_size({'width':1440,'height':900})
            check_layout(page)
            check_contrast(page)
            page.locator('#config-page-heading').evaluate("node => node.scrollIntoView({block:'start'})")
            page.screenshot(path=str(OUTPUT / f'codex-scope-{language}.png'))
        # Check every second-level page, not only the Codex examples (last language is Russian).
        visited_pages = []
        domains = page.locator('[data-config-domain]').evaluate_all("nodes => nodes.map(n => n.dataset.configDomain)")
        for domain in domains:
            page.locator(f'[data-config-domain="{domain}"]').click()
            paths = page.locator(f'[data-config-nav^="{domain}/"]').evaluate_all("nodes => nodes.map(n => n.dataset.configNav)")
            for path in paths:
                page.locator(f'[data-config-nav="{path}"]').click()
                page.locator(f'[data-config-page="{path}"]:visible').wait_for()
                assert page.get_by_test_id('config-page-introduction').inner_text().strip()
                check_layout(page)
                visited_pages.append(path)
        assert len(visited_pages) == len(set(visited_pages)) == 29
        assert not errors, errors
        context.close()
        browser.close()
    STOP.set()
    print('Configuration editor browser regression passed: native mode choices, keyboard navigation, inline prerequisites, rule identity on rename/delete, shared drafts, hidden Raw errors, YAML roundtrip, SSE visibility, 6 viewports, 3 themes, 4 languages and rendered contrast.')
    print(f'Screenshots: {OUTPUT}')


if __name__ == '__main__':
    try:
        run()
    finally:
        STOP.set()

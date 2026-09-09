"""Two independent mock Cores; never connects to a live deployment."""
import importlib.util
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('baseline', ROOT / 'scripts/smoke-lts-panel.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class AuthenticatedCore(baseline.MockCoreHandler):
    def do_GET(self):
        if self.headers.get('Authorization') != 'Bearer synthetic-connection-test':
            self._send_json({'error': 'unauthorized'}, status=401)
            return
        if urlparse(self.path).path == '/v0/management/config' and getattr(self.state, 'reject_config', False):
            self._send_json({'error': 'temporarily unavailable'}, status=503)
            return
        if urlparse(self.path).path == '/v0/management/usage/query/capabilities' and getattr(self.state, 'query_mode', False):
            self._send_json({'version': 1, 'bound': 'synthetic-query-bound', 'now_ms': int(time.time() * 1000), 'models': [], 'max_page_size': 200})
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if getattr(self.state, 'query_mode', False) and path in ['/v0/management/usage/query/summary', '/v0/management/usage/query/pricing']:
            self._read_body_text()
            if path.endswith('/summary'):
                self.state.query_started.set()
                self.state.query_release.wait(timeout=20)
            metrics = {key: 0 for key in ['requests', 'success', 'failure', 'tokens', 'input', 'output', 'reasoning', 'cache_read', 'cache_write', 'prompt', 'latency_ms', 'latency_samples', 'ttfb_samples']}
            metrics.update({key: {'numerator': 0, 'denominator': 0, 'samples': 0} for key in ['output_tps', 'average_tps', 'visible_tps', 'reasoning_ratio']})
            try:
                self._send_json({'version': 1, 'bound': 'synthetic-query-bound', 'now_ms': int(time.time() * 1000), 'totals': metrics, 'groups': {}})
            except (BrokenPipeError, ConnectionResetError):
                pass  # The old page was deliberately destroyed by the switch.
            return
        super().do_POST()


def run():
    app_port, a_port, b_port = (baseline.find_free_port() for _ in range(3))
    app = f'http://127.0.0.1:{app_port}/management.html'
    a, b = baseline.MockCoreState(), baseline.MockCoreState()
    b.supports_plugin = False
    b.plugin_endpoint_available = False
    b.plugins_config_enabled = False
    with baseline.run_server(baseline.StaticPanelHandler, app_port), baseline.run_server(AuthenticatedCore, a_port, a), baseline.run_server(AuthenticatedCore, b_port, b), sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(locale='en-US', viewport={'width': 1440, 'height': 1000})
        context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.goto(app + '#/login')

        def open_connections(target=page):
            target.get_by_role('button', name='Switch instance', exact=True).click()
            expect(target.get_by_role('dialog')).to_be_visible()

        def add(name, port, remember=True):
            page.get_by_role('button', name='Add connection', exact=True).click()
            page.get_by_label('Name', exact=True).fill(name)
            page.get_by_label('Address', exact=True).fill(f'http://127.0.0.1:{port}')
            page.get_by_label('Environment', exact=True).fill('Test')
            page.locator('[role="dialog"] input[type=password]').fill('synthetic-connection-test')
            if remember:
                page.locator('[role="dialog"] label').filter(has=page.locator('input[type=checkbox]')).click()
            page.get_by_role('button', name='Save profile', exact=True).click()

        def choose(name, target=page):
            target.get_by_role('dialog').get_by_role('button', name=re.compile('^' + name + r' · Test')).click()

        def current(name, target=page):
            expect(target.get_by_role('button', name='Switch instance', exact=True)).to_contain_text(name)
            expect(target.locator('.app-shell')).to_be_visible(timeout=20000)

        open_connections()
        add('Core A', a_port)
        add('Core B', b_port)
        choose('Core A')
        current('Core A')
        page.goto(app + '#/usage')
        expect(page.get_by_text('Usage Statistics', exact=True).first).to_be_visible()
        open_connections()
        b.reject_config = True
        choose('Core B')
        expect(page.get_by_role('alert')).to_contain_text('Core B')
        current('Core A')
        b.reject_config = False
        b.arm_delayed_config_response()
        choose('Core B')
        expect(page.get_by_role('status')).to_contain_text('Testing target')
        page.get_by_role('button', name='Cancel', exact=True).click()
        b.release_delayed_config.set()
        current('Core A')
        open_connections()
        choose('Core B')
        current('Core B')
        assert page.url.endswith('#/usage')
        assert page.evaluate("sessionStorage.getItem('cpa-connection-handoff-v1')") is None
        assert 'synthetic-connection-test' not in page.evaluate("sessionStorage.getItem('cpa-tab-session-v1')")

        second = context.new_page()
        second.goto(app + '#/login')
        open_connections(second)
        choose('Core A', second)
        current('Core A', second)
        page.reload()
        current('Core B')
        second.reload()
        current('Core A', second)

        open_connections()
        choose('Core A')
        current('Core A')

        # Hold a real Panel read-only POST while switching. Deliver an old
        # response event after reload begins, before the new document commits.
        a.query_mode = True
        a.query_started, a.query_release = threading.Event(), threading.Event()
        try:
            page.goto(app + '#/usage', wait_until='domcontentloaded')
            page.reload(wait_until='domcontentloaded')
            assert a.query_started.wait(timeout=10), 'Panel did not issue the held summary POST'
            open_connections()
            page.evaluate("""window.addEventListener('beforeunload', () => {
              window.dispatchEvent(new CustomEvent('server-version-update', {detail:{version:'old-A-late'}}));
              sessionStorage.setItem('cpa-smoke-late-callback', 'ran');
            }, {once:true})""")
            choose('Core B')
            current('Core B')
            assert page.evaluate("sessionStorage.getItem('cpa-smoke-late-callback')") == 'ran', 'late response was not delivered during reload'
            page.evaluate("sessionStorage.removeItem('cpa-smoke-late-callback')")
            assert page.url.endswith('#/usage')
            assert page.evaluate("sessionStorage.getItem('cpa-connection-handoff-v1')") is None
        finally:
            a.query_release.set()
            a.query_mode = False

        open_connections()
        choose('Core A')
        current('Core A')
        page.goto(app + '#/config')
        page.get_by_role('button', name=re.compile('Source')).first.click()
        editor = page.locator('.cm-content').first
        expect(editor).to_be_visible()
        editor.click()
        page.keyboard.press('ControlOrMeta+End')
        page.keyboard.type('\n# unsaved-instance-test')
        open_connections()
        dialogs = []
        def accept(dialog):
            dialogs.append(dialog.message)
            dialog.accept()
        page.on('dialog', accept)
        b.reject_config = True
        choose('Core B')
        expect(page.get_by_role('alert')).to_contain_text('Core B')
        assert dialogs, 'dirty edit was not guarded'
        page.get_by_role('button', name='Close', exact=True).click()
        expect(editor).to_contain_text('unsaved-instance-test')
        open_connections()
        b.reject_config = False
        choose('Core B')
        current('Core B')
        expect(page.locator('.cm-content').first).not_to_contain_text('unsaved-instance-test')

        output = ROOT / 'local/connections-smoke'
        output.mkdir(parents=True, exist_ok=True)
        page.goto(app + '#/core')
        current('Core B')
        page.wait_for_timeout(800)  # Allow the existing route transition to finish before visual QA.
        page.screenshot(path=str(output / 'desktop.png'))
        page.set_viewport_size({'width': 390, 'height': 844})
        open_connections()
        page.wait_for_timeout(800)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow'
        page.screenshot(path=str(output / 'mobile.png'))
        page.get_by_role('button', name='Close', exact=True).click()
        page.set_viewport_size({'width': 1440, 'height': 1000})
        open_connections()
        page.get_by_role('button', name='Add connection', exact=True).click()
        page.get_by_label('Name', exact=True).fill('Temporary')
        page.get_by_label('Address', exact=True).fill(f'http://127.0.0.1:{a_port}')
        page.locator('[role="dialog"] input[type=password]').fill('wrong-synthetic-key')
        page.get_by_role('button', name='Connect', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Temporary')
        current('Core B')
        page.locator('[role="dialog"] input[type=password]').fill('synthetic-connection-test')
        page.get_by_role('button', name='Connect', exact=True).click()
        current('Temporary')
        assert page.evaluate("sessionStorage.getItem('cpa-connection-handoff-v1')") is None
        page.reload()
        expect(page.locator('input[name="cpa-management-key"]')).to_be_visible()
        expect(page.get_by_role('button', name='Switch instance', exact=True)).to_be_visible()
        assert not errors, errors
        browser.close()
    print('Connections smoke passed: cross-origin auth, failed target, A-B-A, tab isolation, dirty edits, pending read-only POST, late response during reload, desktop/mobile.')


if __name__ == '__main__':
    run()

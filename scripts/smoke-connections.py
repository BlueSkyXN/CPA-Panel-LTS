"""Two independent mock Cores; never connects to a live deployment."""
import importlib.util
import argparse
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
flow_spec = importlib.util.spec_from_file_location('config_smoke', ROOT / 'scripts/smoke-config-editor.py')
config_smoke = importlib.util.module_from_spec(flow_spec)
flow_spec.loader.exec_module(config_smoke)


class AuthenticatedCore(baseline.MockCoreHandler):
    def do_GET(self):
        if self.headers.get('Authorization') != 'Bearer ' + self.state.expected_key:
            self._send_json({'error': 'unauthorized'}, status=401)
            return
        if self.path in ['/v0/management/flow-control', '/v0/management/flow-control/events']:
            config_smoke.ConfigCore.do_GET(self)
            return
        if urlparse(self.path).path == '/v0/management/config' and getattr(self.state, 'reject_config', False):
            self._send_json({'error': 'temporarily unavailable'}, status=503)
            return
        if urlparse(self.path).path == '/v0/management/usage/query/capabilities' and getattr(self.state, 'query_mode', False):
            self._send_json({'version': 1, 'bound': 'synthetic-query-bound', 'now_ms': int(time.time() * 1000), 'models': [], 'max_page_size': 200})
            return
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass  # Disconnecting a runtime deliberately cancels pending reads.

    def do_PUT(self):
        if self.headers.get('Authorization') != 'Bearer ' + self.state.expected_key:
            self._send_json({'error': 'unauthorized'}, status=401)
            return
        if urlparse(self.path).path == '/v0/management/config.yaml' and getattr(self.state, 'hold_write', False):
            self.state.write_started.set()
            self.state.write_release.wait(timeout=20)
        super().do_PUT()

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


def run(file_mode=False, flow_only=False):
    app_port, a_port, b_port = (baseline.find_free_port() for _ in range(3))
    app = f'http://127.0.0.1:{app_port}/management.html'
    if file_mode:
        app = (ROOT / 'dist/index.html').as_uri()
    a, b = baseline.MockCoreState(), baseline.MockCoreState()
    a.expected_key, b.expected_key = 'synthetic-a', 'synthetic-b'
    b.supports_plugin = False
    b.plugin_endpoint_available = False
    b.plugins_config_enabled = False
    with baseline.run_server(baseline.StaticPanelHandler, app_port), baseline.run_server(AuthenticatedCore, a_port, a), baseline.run_server(AuthenticatedCore, b_port, b), sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(locale='en-US', viewport={'width': 1440, 'height': 1000})
        context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
        context.add_init_script("""
          window.flowConnections = {started: 0, aborted: 0};
          const originalFetch = window.fetch;
          window.fetch = (url, options) => {
            if (String(url).includes('/flow-control/events')) {
              window.flowConnections.started++;
              options.signal.addEventListener('abort', () => window.flowConnections.aborted++, {once: true});
            }
            return originalFetch(url, options);
          };
        """)
        page = context.new_page()
        page.set_default_timeout(15000)
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.goto(app + '#/login')

        def frame(name, target=page):
            return target.locator(f'iframe[title="{name}"]').element_handle().content_frame()

        def active(target=page):
            element = target.locator('iframe[data-active=true]')
            return element.element_handle().content_frame() if element.count() else target

        def open_connections(target=page):
            scope = active(target)
            trigger = scope.get_by_role('button', name='Switch instance', exact=True)
            if scope != target and target.viewport_size['width'] <= 768 and not scope.locator('.sidebar.open').count():
                scope.locator('button.mobile-menu-btn').click()
            trigger.click()
            expect(target.get_by_role('dialog')).to_be_visible()

        def close_connections(target=page):
            target.get_by_role('dialog').get_by_role('button', name='Close', exact=True).click()

        def add(name, port, remember=True):
            page.get_by_role('button', name='Add connection', exact=True).click()
            page.get_by_label('Name', exact=True).fill(name)
            page.get_by_label('Address', exact=True).fill(f'http://127.0.0.1:{port}')
            page.get_by_label('Environment', exact=True).fill('Test')
            page.locator('[role="dialog"] input[type=password]').fill('synthetic-a' if port == a_port else 'synthetic-b')
            if remember:
                page.locator('[role="dialog"] label').filter(has=page.locator('input[type=checkbox]')).click()
            page.get_by_role('button', name='Save profile', exact=True).click()

        def choose(name, target=page):
            target.get_by_role('dialog').get_by_role('button', name=re.compile('^' + name)).click()

        def toggle(name, target=page):
            checkbox = target.get_by_role('checkbox', name=f'Keep {name} connected', exact=True)
            target.locator('label').filter(has=checkbox).click()

        def current(name, target=page):
            expect(target.locator('iframe[data-active=true]')).to_have_attribute('title', name)
            expect(frame(name, target).locator('.app-shell')).to_be_visible(timeout=25000)

        def ready(name):
            frame(name).locator('.app-shell').wait_for(state='attached', timeout=25000)

        open_connections()
        add('Core A', a_port)
        add('Core B', b_port)
        choose('Core A')
        current('Core A')
        expect(frame('Core A').get_by_role('button', name='Switch instance', exact=True)).to_contain_text('Connected')
        expect(frame('Core A').get_by_role('button', name='Switch instance', exact=True)).to_contain_text('Test')
        root_origin = page.evaluate('performance.timeOrigin')
        a_origin = frame('Core A').evaluate('performance.timeOrigin')

        # A failed or cancelled B cannot replace A or clear its caches.
        open_connections()
        b.reject_config = True
        choose('Core B')
        expect(page.get_by_role('alert')).to_contain_text('Connection unavailable')
        current('Core A')
        toggle('Core B')
        b.reject_config = False
        b.arm_delayed_config_response()
        toggle('Core B')
        expect(page.get_by_role('checkbox', name='Keep Core B connected')).to_be_checked()
        toggle('Core B')
        b.release_delayed_config.set()
        expect(page.locator('iframe[title="Core B"]')).to_have_count(0)

        # Independent on/off is not selection. B connects in the background.
        toggle('Core B')
        ready('Core B')
        current('Core A')
        b_origin = frame('Core B').evaluate('performance.timeOrigin')
        expect(page.get_by_role('checkbox', name='Keep Core A connected')).to_be_checked()
        expect(page.get_by_role('checkbox', name='Keep Core B connected')).to_be_checked()
        choose('Core B')
        current('Core B')
        open_connections()
        choose('Core A')
        current('Core A')
        assert page.evaluate('performance.timeOrigin') == root_origin
        assert frame('Core A').evaluate('performance.timeOrigin') == a_origin
        assert frame('Core B').evaluate('performance.timeOrigin') == b_origin

        # Keeping a session connected must not keep a hidden observation stream running.
        fa = frame('Core A')
        fa.evaluate("location.hash = '#/config?section=flow-control&subsection=monitoring'")
        fa.get_by_role('button', name='Observe live', exact=True).click()
        fa.wait_for_function('flowConnections.started === 1')
        for resume_count in [2, 3]:
            open_connections()
            choose('Core B')
            current('Core B')
            fa.wait_for_function('flowConnections.aborted === flowConnections.started', timeout=5000)
            assert fa.evaluate('document.hidden') is False, 'Test must distinguish iframe activity from tab visibility'
            assert frame('Core B').evaluate('flowConnections.started') == 0
            expect(fa.locator('[data-state="paused"]')).to_be_attached()
            open_connections()
            choose('Core A')
            current('Core A')
            fa.wait_for_function('(count) => flowConnections.started === count', arg=resume_count)
        fa.get_by_role('button', name='Stop live updates', exact=True).click()
        fa.wait_for_function('flowConnections.aborted === 3')
        open_connections()
        choose('Core B')
        open_connections()
        choose('Core A')
        assert fa.evaluate('flowConnections.started') == 3
        expect(fa.get_by_role('button', name='Observe live', exact=True)).to_be_visible()
        assert fa.evaluate('performance.timeOrigin') == a_origin
        fa.evaluate("location.hash = '#/'")
        expect(fa.get_by_test_id('flow-control-settings')).to_have_count(0)
        if flow_only:
            assert not errors, errors
            browser.close()
            print(f'Flow connection lifecycle passed ({"file" if file_mode else "HTTP"}): pause, resume, explicit stop, no reload.')
            return

        if file_mode:
            sources = page.locator('iframe').evaluate_all("elements => elements.map(element => ({ inherited: Boolean(element.srcdoc), leaked: element.srcdoc.includes('synthetic-a') || element.srcdoc.includes('synthetic-b') }))")
            assert all(source['inherited'] and not source['leaked'] for source in sources), 'file runtime must inherit origin without serializing credentials'

        # The exact runtime, route, and unsaved editor survive A-B-A.
        fa = frame('Core A')
        fa.evaluate("window.location.hash = '#/config'")
        expect(fa.get_by_test_id('config-save-target')).to_contain_text('Core A')
        fa.get_by_role('button', name=re.compile('Source')).first.click()
        editor = fa.locator('.cm-content').first
        expect(editor).to_be_visible()
        editor.click()
        page.keyboard.press('ControlOrMeta+End')
        page.keyboard.type('\n# unsaved-instance-test')
        open_connections()
        choose('Core B')
        current('Core B')
        frame('Core B').evaluate("window.location.hash = '#/config'")
        expect(frame('Core B').get_by_test_id('config-save-target')).to_contain_text('Core B')
        open_connections()
        choose('Core A')
        current('Core A')
        expect(editor).to_contain_text('unsaved-instance-test')
        expect(fa.get_by_test_id('config-save-target')).to_contain_text('Core A')
        assert fa.evaluate('window.location.hash') == '#/config'

        # A real delayed write cannot be disconnected, even after viewing B.
        a.hold_write = True
        a.write_started, a.write_release = threading.Event(), threading.Event()
        try:
            fa.locator('button[aria-label="Save"]').click()
            expect(fa.get_by_test_id('config-diff-target')).to_contain_text('Core A')
            fa.get_by_role('button', name='Confirm Save', exact=True).click()
            assert a.write_started.wait(timeout=10), 'config write did not start'
            fa.evaluate("window.dispatchEvent(new Event('cpa-open-connections'))")
            toggle('Core A')
            expect(page.get_by_role('alert')).to_contain_text('operation in progress')
            expect(page.get_by_role('checkbox', name='Keep Core A connected')).to_be_checked()
            choose('Core B')
            current('Core B')
            open_connections()
            toggle('Core A')
            expect(page.get_by_role('alert')).to_contain_text('operation in progress')
            a.write_release.set()
            fa.get_by_text('Configuration saved successfully', exact=False).first.wait_for(state='attached')
            choose('Core A')
            current('Core A')
            editor.click()
            page.keyboard.press('ControlOrMeta+End')
            page.keyboard.type('\n# another-unsaved-instance-edit')
        finally:
            a.write_release.set()
            a.hold_write = False

        # Disconnect guards inspect the target even while it is hidden.
        open_connections()
        choose('Core B')
        current('Core B')
        open_connections()
        page.once('dialog', lambda dialog: dialog.dismiss())
        toggle('Core A')
        expect(page.get_by_role('checkbox', name='Keep Core A connected')).to_be_checked()
        page.once('dialog', lambda dialog: dialog.accept())
        toggle('Core A')
        expect(page.locator('iframe[title="Core A"]')).to_have_count(0)
        current('Core B')
        toggle('Core A')
        ready('Core A')
        current('Core B')
        choose('Core A')
        current('Core A')
        fa = frame('Core A')

        # An old read-only POST is allowed to finish in A, never in B.
        a.query_mode = True
        a.query_started, a.query_release = threading.Event(), threading.Event()
        try:
            fa.evaluate("window.location.hash = '#/usage'")
            assert a.query_started.wait(timeout=10), 'Panel did not issue held summary POST'
            open_connections()
            choose('Core B')
            current('Core B')
            a.query_release.set()
            expect(frame('Core B').get_by_role('button', name='Switch instance', exact=True)).to_contain_text('Core B')
            assert frame('Core B').evaluate('performance.timeOrigin') == b_origin
        finally:
            a.query_release.set()
            a.query_mode = False

        # Invalidation is local to the failing runtime, not the whole Panel.
        fa.evaluate("window.dispatchEvent(new Event('unauthorized'))")
        current('Core B')
        open_connections()
        row_a = page.get_by_role('dialog').get_by_role('button', name=re.compile('^Core A'))
        expect(row_a).to_contain_text('Connection error')
        toggle('Core A')
        toggle('Core A')
        ready('Core A')
        close_connections()

        # Tab-local enabled/selected sets survive refresh independently.
        second = context.new_page()
        second.goto(app + '#/login')
        open_connections(second)
        choose('Core A', second)
        current('Core A', second)
        page.reload()
        current('Core B')
        ready('Core A')
        second.reload()
        current('Core A', second)
        assert second.locator('iframe').count() == 1
        assert page.locator('iframe').count() == 2

        # Cached switching requires no network and no new document.
        times = []
        for name in ['Core A', 'Core B', 'Core A', 'Core B']:
            open_connections()
            ms = page.get_by_role('dialog').get_by_role('button', name=re.compile('^' + name)).evaluate("""async button => {
                const start = performance.now();
                button.click();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return performance.now() - start;
            }""")
            times.append(ms)
            current(name)
        print('Warm switch click-to-two-paints (ms):', ', '.join(f'{value:.1f}' for value in times))

        output = ROOT / 'local/connections-smoke'
        output.mkdir(parents=True, exist_ok=True)
        open_connections()
        page.screenshot(path=str(output / 'desktop.png'))
        close_connections()
        fb = frame('Core B')
        trigger = fb.get_by_role('button', name='Switch instance', exact=True)
        box = trigger.bounding_box()
        assert box['x'] < 300 and box['y'] > 800, 'switcher is not bottom-left'
        page.set_viewport_size({'width': 390, 'height': 844})
        open_connections()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'host horizontal overflow'
        assert fb.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'workspace horizontal overflow'
        page.screenshot(path=str(output / 'mobile.png'))
        close_connections()
        page.set_viewport_size({'width': 1440, 'height': 1000})

        # Non-remembered keys never enter storage and are not restored on reload.
        open_connections()
        add('Temporary', a_port, remember=False)
        choose('Temporary')
        page.locator('[role="dialog"] input[type=password]').fill('synthetic-a')
        page.get_by_role('button', name='Connect', exact=True).click()
        current('Temporary')
        assert 'synthetic-a' not in page.evaluate('JSON.stringify({...sessionStorage})')
        assert 'synthetic-a' not in frame('Temporary').evaluate('JSON.stringify({...sessionStorage})')
        page.reload()
        expect(page.locator('iframe[title="Temporary"]')).to_have_count(0)
        expect(page.get_by_text('This instance is disconnected.', exact=False)).to_be_visible()
        assert not errors, errors
        browser.close()
    mode = 'file' if file_mode else 'HTTP'
    print(f'Connections smoke passed ({mode}): concurrent sessions, distinct credentials, independent toggles, failed/cancelled target, warm A-B-A, drafts, inactive disconnect guard, in-flight write protection, pending read-only POST, 401 isolation, tab restore, transient credentials, desktop/mobile.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', action='store_true', help='Exercise direct opening of the built single-file Panel.')
    parser.add_argument('--flow-only', action='store_true', help='Run the focused cross-instance flow observation regression.')
    args = parser.parse_args()
    if not args.file:
        run(flow_only=args.flow_only)
    run(file_mode=True, flow_only=args.flow_only)

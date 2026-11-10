#!/usr/bin/env python3
"""On-demand Flow observation regression with synthetic Core responses only."""
from __future__ import annotations

import copy
import importlib.util
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from panel_browser import PanelBrowser, launch_chromium
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_smoke", ROOT / "scripts/smoke-lts-panel.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
FIXTURE = json.loads((ROOT / "src/lts/flowControl/fixtures/grouped-summary.json").read_text())
OUTPUT = ROOT / "local/flow-grouping-smoke"


def flow_payload(state, view="total"):
    payload = copy.deepcopy(FIXTURE)
    payload.update({"events-supported": True, "events-enabled": True, "events-interval-ms": 500})
    payload["policy"] = {"version": 3, "enabled": True, "rules": []}
    sample = payload["state"]
    sample["sampled-at"] = datetime.now(timezone.utc).isoformat()
    sample["process-id"] = state.flow_process
    if not state.flow_grouping:
        payload["features"] = ["grouped-summary"]  # Old draft capability must not enable new views.
    if view == "total" or not state.flow_grouping:
        sample.pop("breakdown", None)
    else:
        breakdown = sample["breakdown"]
        if view != "model":
            # Preserve the shared fixture's stage totals; only the chosen identity is emitted.
            first = FIXTURE["accounts" if view == "account" else "keys"][0]["ref"] if view != "provider" else "p"
            breakdown["view"] = view
            breakdown["groups"] = [
                {"stage": "attempt", view: first, "active": 4, "waiting": 2},
                {"stage": "request", **({view: first} if view == "key" else {}), "active": 2, "waiting": 0},
            ]
        if state.flow_partial:
            sample["active-attempts"] += 1
            breakdown["omitted"]["active-attempts"] = 1
            breakdown["truncated"] = True
    return payload


class GroupedCore(base.MockCoreHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/v0/management/flow-control":
            self.state.record("GET", parsed.path, parsed.query)
            payload = flow_payload(self.state)
            assert "breakdown" not in payload["state"]
            self._send_json(payload)
        elif parsed.path == "/v0/management/flow-control/events":
            view = parse_qs(parsed.query).get("view", ["total"])[0]
            self.state.record("GET", parsed.path, parsed.query)
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            with self.state.flow_lock:
                self.state.flow_open += 1
            try:
                while not self.state.flow_stop.is_set():
                    payload = flow_payload(self.state, "model" if self.state.flow_wrong_view and view == "account" else view)
                    frame = {"schema-version": 3, "state": payload["state"]}
                    self.wfile.write(("event: snapshot\ndata: " + json.dumps(frame) + "\n\n").encode())
                    self.wfile.flush()
                    self.state.flow_stop.wait(0.2)
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                with self.state.flow_lock:
                    self.state.flow_open -= 1
        else:
            super().do_GET()


def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    state = base.MockCoreState()
    state.flow_grouping, state.flow_partial, state.flow_wrong_view = True, False, False
    state.flow_process, state.flow_open = "grouped-fixture", 0
    state.flow_lock, state.flow_stop = threading.Lock(), threading.Event()
    app_port, api_port = base.find_free_port(), base.find_free_port()
    app_url, api_url = f"http://127.0.0.1:{app_port}/management.html", f"http://127.0.0.1:{api_port}"
    errors = []
    with base.run_server(base.StaticPanelHandler, app_port), base.run_server(GroupedCore, api_port, state), sync_playwright() as p:
        browser = launch_chromium(p)
        context = browser.new_context(locale="en-US", viewport={"width": 1440, "height": 1100})
        context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
        page = PanelBrowser(context.new_page())
        page.set_default_timeout(15000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        events = lambda: [request for request in state.requests if "/flow-control/events" in request]
        try:
            page.goto(app_url + "#/login")
            page.get_by_label("Custom Connection URL:").check(force=True)
            page.get_by_placeholder("Eg: https://example.com:8317").fill(api_url)
            page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
            page.get_by_role("button", name=re.compile(r"^(Login|Connect)$", re.I)).click()
            page.wait_for_url(re.compile(r".*#/$"))
            page.goto(app_url + "#/analytics/flow")
            monitor = page.get_by_role("region", name="Runtime status", exact=True)
            trend = page.get_by_test_id("flow-trend")
            expect(trend).to_have_attribute("data-view", "total")
            expect(trend).to_have_attribute("data-samples", "0")
            page.wait_for_timeout(700)
            assert not events(), events()
            # Choosing a view while stopped does not begin observation.
            trend.get_by_role("combobox", name="Observation view", exact=True).select_option("model")
            trend.get_by_role("combobox", name="Observation view", exact=True).select_option("total")
            trend.get_by_role("combobox", name="Metric", exact=True).select_option("overview")
            page.wait_for_timeout(300)
            assert not events(), events()
            monitor.get_by_role("button", name="Observe live", exact=True).click()
            expect(trend.locator("polyline")).to_have_count(3)
            assert events()[-1].endswith("/events"), events()
            trend.get_by_role("combobox", name="Observation view", exact=True).select_option("model")
            expect(trend.locator("g[data-series-label]")).to_have_count(2)
            assert events()[-1].endswith("?view=model"), events()
            assert sorted(trend.locator("g[data-series-label]").evaluate_all("nodes => nodes.map(n => n.dataset.seriesLabel)")) == ["p · alpha", "p · beta"]
            before = len(events())
            trend.get_by_role("combobox", name="Metric", exact=True).select_option("requests")
            expect(trend.locator("g[data-series-label] title").last).to_contain_text("public-alpha: 2")
            trend.get_by_role("combobox", name="Metric", exact=True).select_option("attempts")
            trend.locator("summary").filter(has_text="Choose lines").click()
            trend.get_by_role("button", name="Clear selection", exact=True).click()
            expect(trend.locator("g[data-series-label]")).to_have_count(0)
            trend.get_by_label("Search lines", exact=True).fill("alpha")
            trend.get_by_role("checkbox", name="p · alpha", exact=True).check()
            expect(trend.locator("g[data-series-label]")).to_have_count(1)
            page.wait_for_timeout(400)
            assert len(events()) == before, events()

            # Keep sending old-view frames after the new subscription: none may enter history.
            state.flow_wrong_view = True
            trend.get_by_role("combobox", name="Observation view", exact=True).select_option("account")
            expect(trend).to_have_attribute("data-samples", "0")
            page.wait_for_timeout(600)
            expect(trend).to_have_attribute("data-samples", "0")
            assert events()[-1].endswith("?view=account"), events()
            state.flow_wrong_view = False
            expect(trend.locator('g[data-series-label="Credential A"]')).to_have_count(1)
            expect(trend.get_by_role("option", name="Active requests", exact=True)).to_have_attribute("disabled", "")

            # Exercise late failures and disabled frames even when a transport ignores abort.
            # The real stream's abort behavior cannot prove the hook's generation guard alone.
            for failure in ["http", "disabled"]:
                page.evaluate("""kind => {
                  const original = window.fetch;
                  window.__flowRaceDelivered = false;
                  window.__flowRaceStarted = false;
                  window.fetch = (url, options) => {
                    if (!String(url).includes('/flow-control/events?view=provider')) return original(url, options);
                    window.fetch = original;
                    window.__flowRaceStarted = true;
                    if (kind === 'http') return new Promise(resolve => setTimeout(() => {
                      window.__flowRaceDelivered = true;
                      resolve(new Response('', {status:409}));
                    }, 700));
                    return Promise.resolve(new Response(new ReadableStream({ start(controller) {
                      setTimeout(() => {
                        controller.enqueue(new TextEncoder().encode('event: snapshot\\ndata: {"realtime-disabled":true}\\n\\n'));
                        window.__flowRaceDelivered = true;
                        controller.close();
                      }, 700);
                    }}), {headers:{'Content-Type':'text/event-stream'}}));
                  };
                }""", failure)
                trend.get_by_role("combobox", name="Observation view", exact=True).select_option("provider")
                page.wait_for_function("window.__flowRaceStarted === true")
                trend.get_by_role("combobox", name="Observation view", exact=True).select_option("account")
                page.wait_for_function("window.__flowRaceDelivered === true")
                expect(monitor.locator('[data-state="live"]')).to_be_visible()
                expect(trend.locator('g[data-series-label="Credential A"]')).to_have_count(1)

            # Each other dimension uses only its own explicit subscription query.
            for dimension, label in [("key", "Caller A"), ("provider", "p"), ("account", "Credential A")]:
                trend.get_by_role("combobox", name="Observation view", exact=True).select_option(dimension)
                expect(trend.locator(f'g[data-series-label="{label}"]')).to_have_count(1)
                assert events()[-1].endswith(f"?view={dimension}"), events()

            for theme in ["", "aurora-nebula", "aurora-dawn"]:
                page.evaluate("theme => theme ? document.documentElement.setAttribute('data-theme', theme) : document.documentElement.removeAttribute('data-theme')", theme)
                for width in [1440, 390]:
                    page.set_viewport_size({"width": width, "height": 1100})
                    if width == 390 and page.locator('.sidebar.open').count():
                        page.locator('button.mobile-menu-btn').click()
                    page.evaluate("async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); }")
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), (theme, width)
                    trend.scroll_into_view_if_needed()
                    trend.screenshot(path=str(OUTPUT / f"{theme or 'white'}-{width}.png"), animations="disabled")
            page.set_viewport_size({"width": 1440, "height": 1100})

            # Stop retains samples and closes the server connection; resume adds a discontinuity.
            monitor.get_by_role("button", name="Stop live updates", exact=True).click()
            samples = trend.get_attribute("data-samples")
            page.wait_for_timeout(700)
            assert state.flow_open == 0, state.flow_open
            expect(trend).to_have_attribute("data-samples", samples)
            monitor.get_by_role("button", name="Observe live", exact=True).click()
            expect(trend.locator("g[data-series-label]")).to_have_count(2)

            # Exercise the document visibility event independently of instance visibility.
            page.evaluate("() => { Object.defineProperty(document, 'hidden', {configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); }")
            page.wait_for_timeout(700)
            assert state.flow_open == 0, state.flow_open
            expect(monitor.locator('[data-state="paused"]')).to_be_visible()
            page.evaluate("() => { Object.defineProperty(document, 'hidden', {configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange')); }")
            expect(monitor.locator('[data-state="live"]')).to_be_visible()

            # Hiding a connected instance cancels the subscription; restoring it reconnects.
            page.raw.locator('iframe[data-active=true]').evaluate("node => node.setAttribute('data-active', 'false')")
            page.raw.wait_for_timeout(700)
            assert state.flow_open == 0, state.flow_open
            page.raw.locator('iframe[data-active=false]').evaluate("node => node.setAttribute('data-active', 'true')")
            expect(monitor.locator('[data-state="live"]')).to_be_visible()
            assert state.flow_open == 1, state.flow_open

            # Truncation is a gap, and switching to total gets an ungrouped stream.
            state.flow_partial, state.flow_process = True, "partial-process"
            expect(trend.get_by_text("Some samples have incomplete group data.", exact=False)).to_be_visible()
            expect(trend.locator("g[data-series-label]")).to_have_count(0)
            trend.get_by_role("combobox", name="Observation view", exact=True).select_option("total")
            trend.get_by_role("combobox", name="Metric", exact=True).select_option("overview")
            expect(trend.locator("polyline")).to_have_count(3)
            state.flow_partial = False
            monitor.get_by_role("button", name="Stop live updates", exact=True).click()
            state.flow_grouping = False
            monitor.get_by_role("button", name="Refresh status and references", exact=True).click()
            expect(trend.get_by_text("Upgrade Core to compare separate lines", exact=False)).to_be_visible()
            expect(trend.get_by_role("option", name="Upstream credential", exact=True)).to_have_attribute("disabled", "")
            monitor.get_by_role("button", name="Observe live", exact=True).click()
            expect(trend.locator("polyline")).to_have_count(3)
            page.goto(app_url + "#/analytics/flow/config")
            page.wait_for_timeout(700)
            assert state.flow_open == 0, state.flow_open
            assert not any("/flow-control/details" in request for request in state.requests)
            assert not state.config_yaml_puts
            assert not errors, errors
        except Exception:
            page.screenshot(path=str(OUTPUT / "failure.png"), full_page=True)
            raise
        finally:
            state.flow_stop.set()
            context.close()
            browser.close()
    print("Flow on-demand smoke passed: idle has no SSE, total/model/account/key/provider queries, delayed HTTP/disabled races, local metrics/selection, view reset and stale-frame isolation, stop/resume/hidden/unmount, truncation gaps, old Core, three themes at 1440/390; no detail polling or config writes.")


if __name__ == "__main__":
    run()

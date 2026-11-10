#!/usr/bin/env python3
"""Flow grouped-summary browser regression against the shared synthetic fixture."""
from __future__ import annotations

import copy
import importlib.util
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from panel_browser import PanelBrowser, launch_chromium
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_smoke", ROOT / "scripts/smoke-lts-panel.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
FIXTURE = json.loads((ROOT / "src/lts/flowControl/fixtures/grouped-summary.json").read_text())
OUTPUT = ROOT / "local/flow-grouping-smoke"


def flow_payload(state):
    payload = copy.deepcopy(FIXTURE)
    payload.update({"events-supported": True, "events-enabled": True, "events-interval-ms": 500})
    payload["policy"] = {"version": 3, "enabled": True, "rules": []}
    payload["state"]["sampled-at"] = datetime.now(timezone.utc).isoformat()
    payload["state"]["process-id"] = state.flow_process
    if not state.flow_grouping:
        payload["features"] = []
        payload["state"].pop("breakdown")
    elif state.flow_partial:
        payload["state"]["active-attempts"] += 1
        payload["state"]["breakdown"]["omitted"]["active-attempts"] = 1
        payload["state"]["breakdown"]["truncated"] = True
    return payload


class GroupedCore(base.MockCoreHandler):
    def do_GET(self):
        if self.path == "/v0/management/flow-control":
            self.state.record("GET", self.path, "")
            self._send_json(flow_payload(self.state))
        elif self.path == "/v0/management/flow-control/events":
            self.state.record("GET", self.path, "")
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                while not self.state.flow_stop.is_set():
                    frame = {"schema-version": 3, "state": flow_payload(self.state)["state"]}
                    self.wfile.write(("event: snapshot\ndata: " + json.dumps(frame) + "\n\n").encode())
                    self.wfile.flush()
                    self.state.flow_stop.wait(0.5)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            super().do_GET()


def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    state = base.MockCoreState()
    state.flow_grouping, state.flow_partial = True, False
    state.flow_process = "grouped-fixture"
    state.flow_stop = threading.Event()
    app_port, api_port = base.find_free_port(), base.find_free_port()
    app_url, api_url = f"http://127.0.0.1:{app_port}/management.html", f"http://127.0.0.1:{api_port}"
    errors = []
    try:
        with base.run_server(base.StaticPanelHandler, app_port), base.run_server(GroupedCore, api_port, state), sync_playwright() as p:
            browser = launch_chromium(p)
            context = browser.new_context(locale="en-US", viewport={"width": 1440, "height": 1100})
            context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
            page = PanelBrowser(context.new_page())
            page.set_default_timeout(15000)
            page.on("pageerror", lambda error: errors.append(str(error)))
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
                monitor.get_by_role("button", name="Observe live", exact=True).click()
                expect(trend.locator("polyline")).to_have_count(3)
                trend.get_by_role("combobox", name="Metric", exact=True).select_option("attempts")
                expect(trend.locator("g[data-series-label]")).to_have_count(2)
                assert sorted(trend.locator("g[data-series-label]").evaluate_all("nodes => nodes.map(n => n.dataset.seriesLabel)")) == ["p · alpha", "p · beta"]
                trend.get_by_role("combobox", name="Separate lines by", exact=True).select_option("account")
                expect(trend.locator('g[data-series-label="Credential A"]')).to_have_count(1)
                trend.locator("summary").filter(has_text="Filter observations").click()
                trend.get_by_role("combobox", name="Model", exact=True).select_option(label="p · alpha")
                for name, count in [("Credential A", 2), ("Credential B", 1)]:
                    expect(trend.locator(f'g[data-series-label="{name}"] title').last).to_contain_text(f"{name}: {count}")
                trend.get_by_role("combobox", name="Caller Key", exact=True).select_option(label="Caller B")
                expect(trend.locator("g[data-series-label]")).to_have_count(1)
                expect(trend.locator('g[data-series-label="Credential B"] title').last).to_contain_text("Credential B: 1")
                trend.get_by_role("button", name="Clear filters", exact=True).click()
                expect(trend.locator("g[data-series-label]")).to_have_count(2)

                # Both responsive layouts and the existing three themes keep controls readable.
                for theme in ["", "aurora-nebula", "aurora-dawn"]:
                    page.evaluate("theme => theme ? document.documentElement.setAttribute('data-theme', theme) : document.documentElement.removeAttribute('data-theme')", theme)
                    for width in [1440, 390]:
                        page.set_viewport_size({"width": width, "height": 1100})
                        if width == 390 and page.locator('.sidebar.open').count():
                            page.locator('button.mobile-menu-btn').click()
                        page.evaluate("""async () => {
                          await Promise.all(document.getAnimations()
                            .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
                            .map(a => a.finished.catch(() => {})));
                        }""")
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), (theme, width)
                        trend.scroll_into_view_if_needed()
                        trend.screenshot(path=str(OUTPUT / f"{theme or 'white'}-{width}.png"), animations="disabled")
                page.set_viewport_size({"width": 1440, "height": 1100})

                trend.get_by_role("combobox", name="Metric", exact=True).select_option("requests")
                expect(trend.get_by_role("option", name="Upstream credential", exact=True)).to_have_attribute("disabled", "")
                expect(trend.locator("g[data-series-label]")).to_have_count(1)
                expect(trend.locator("g[data-series-label] title").last).to_contain_text("public-alpha: 2")
                trend.get_by_role("combobox", name="Metric", exact=True).select_option("waiting")
                trend.get_by_role("combobox", name="Separate lines by", exact=True).select_option("account")
                expect(trend.locator("g[data-series-label]")).to_have_count(2)
                trend.locator("summary").filter(has_text="Choose lines").click()
                trend.get_by_role("button", name="Clear selection", exact=True).click()
                expect(trend.locator("g[data-series-label]")).to_have_count(0)
                trend.get_by_label("Search lines", exact=True).fill("Credential A")
                trend.get_by_role("checkbox", name="Credential A", exact=True).check()
                expect(trend.locator("g[data-series-label]")).to_have_count(1)
                trend.get_by_role("button", name="Automatic selection", exact=True).click()

                # A new process resets the history. Incomplete samples never appear as zero lines.
                state.flow_partial, state.flow_process = True, "partial-process"
                trend.get_by_role("combobox", name="Metric", exact=True).select_option("attempts")
                expect(trend.get_by_text("Some samples have incomplete group data.", exact=False)).to_be_visible()
                expect(trend.locator("g[data-series-label]")).to_have_count(0)
                trend.get_by_role("combobox", name="Metric", exact=True).select_option("overview")
                expect(trend.locator("polyline")).to_have_count(3)
                state.flow_partial = False
                monitor.get_by_role("button", name="Stop live updates", exact=True).click()

                # Old Core: capability absent, original totals remain available.
                state.flow_grouping = False
                monitor.get_by_role("button", name="Refresh status and references", exact=True).click()
                trend = page.get_by_test_id("flow-trend")
                expect(trend.get_by_text("Model and credential lines require a Core", exact=False)).to_be_visible()
                expect(trend.get_by_role("combobox", name="Metric", exact=True)).to_have_count(0)
                monitor = page.get_by_role("region", name="Runtime status", exact=True)
                monitor.get_by_role("button", name="Observe live", exact=True).click()
                expect(trend.locator("polyline")).to_have_count(3)
                monitor.get_by_role("button", name="Stop live updates", exact=True).click()
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
    finally:
        state.flow_stop.set()
    print("Flow grouping browser smoke passed: models, credentials, caller filters, queue, manual lines, gaps, old Core, three themes, desktop/mobile; no detail polling or config writes.")


if __name__ == "__main__":
    run()

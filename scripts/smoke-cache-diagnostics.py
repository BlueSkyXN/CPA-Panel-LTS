#!/usr/bin/env python3
"""Exercise cache diagnostics in the built Panel against local synthetic Core data."""
from __future__ import annotations
import importlib.util
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from panel_browser import PanelBrowser, launch_chromium

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_smoke", Path(__file__).with_name("smoke-lts-panel.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
TRACE = "a" * 64
BASELINE = "b" * 64
INSTANCE = "synthetic-cache-instance"
SESSION = "c" * 64
NOW = datetime.now(timezone.utc).isoformat()
OBS = {"version": 1, "read": {"state": "absent"}, "write": {"state": "present", "value": 0, "source": "input_tokens_details.cache_write_tokens"}}

def payload(effort="high"):
    return {"known": True, "bytes": 2048, "fields": {"input": {"digest": "1" * 64}, "reasoning.effort": {"digest": ("2" if effort == "high" else "3") * 64, "value": effort}, "prompt_cache_key": {"digest": "4" * 64}}}

def trace(identifier=TRACE):
    created_at = "" if identifier == BASELINE else NOW
    return {"version": 1, "id": identifier, "instance_id": INSTANCE, "logical_request_id": "logical-request", "session_hash": SESSION, "trace_id": "shared-log", "model": "gpt-5.6-sol", "source_format": "openai-response", "created_at": created_at, "updated_at": NOW, "input": payload("low" if identifier == BASELINE else "high"), "truncated": False,
        "events": [{"sequence": 1, "decision_id": "decision-A", "layer": "account", "method": "lcp", "result": "not_run", "reason": "explicit_identity"}, {"sequence": 2, "decision_id": "decision-B", "layer": "account", "method": "session_binding", "result": "created", "auth_index": "B"}],
        "attempts": [{"number": 1, "decision_id": "decision-A", "execution_id": "execution-A", "provider": "codex", "model": "gpt-5.6-sol", "auth_type": "api_key", "auth_index": "A", "transport": "http", "endpoint": "openai_public", "status": 503, "outcome": "body_consumed", "request": payload(), "comparison_id_sent": "absent", "observation_state": "not_observed", "diagnostic_returned": False, "response_truncated": False},
        {"number": 2, "decision_id": "decision-B", "execution_id": "execution-B", "provider": "codex", "model": "gpt-5.6-sol", "auth_type": "api_key", "auth_index": "B", "transport": "websocket", "endpoint": "openai_public", "outcome": "completed", "request": payload(), "response_id": "resp_synthetic", "response_model": "gpt-5.6-sol", "response_status": "completed", "observation_state": "observed", "comparison_id_sent": "present", "diagnostic_returned": True, "diagnostic": {"type": "comparison_response_not_found"}, "cache_observation": OBS, "response_truncated": False}]}

def trace_search_page():
    return {
        "version": 1,
        "current_instance_id": INSTANCE,
        "history_included": True,
        "items": [
            {
                "at": NOW,
                "model": "gpt-5.6-sol",
                "available": True,
                "instance_id": INSTANCE,
                "diagnostics_id": TRACE,
                "request_id": "execution-B",
                "trace_id": "shared-log",
                "auth_index": "B",
                "matched": ["trace_id"],
                "input_tokens": 100,
                "cache_observation": OBS,
                "attempt_count": 2,
                "status": 200,
                "outcome": "completed",
                "previous": {"instance_id": INSTANCE, "diagnostics_id": BASELINE},
            },
            {
                "at": NOW,
                "model": "gpt-5.6-sol",
                "available": True,
                "instance_id": INSTANCE,
                "diagnostics_id": BASELINE,
                "request_id": "execution-baseline",
                "trace_id": "shared-log",
                "auth_index": "A",
                "matched": ["trace_id"],
                "input_tokens": 90,
                "cache_observation": OBS,
                "attempt_count": 1,
                "status": 200,
                "outcome": "completed",
            },
        ],
    }

class CacheHandler(smoke.MockCoreHandler):
    mode = "ready"
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        prefix = "/v0/management/cache-diagnostics/"
        if path.startswith(prefix):
            self.state.record("GET", path, parsed.query)
            if path.endswith("capabilities"):
                payload_caps = {"version": 1, "recording_enabled": True, "trace_search_version": 1, "store": {"instance_id": INSTANCE, "active": 2}} if type(self).mode == "search" else {"version": 1}
                self._send_json(payload_caps, status=404 if type(self).mode == "unsupported" else 200)
            elif path.endswith("traces"):
                self._send_json(trace_search_page())
            elif type(self).mode == "missing":
                self._send_json({"error": "unavailable"}, status=404)
            else:
                value = trace(path.rsplit("/", 1)[-1])
                if type(self).mode == "foreign": value["instance_id"] = "other-instance"
                self._send_json(value)
            return
        super().do_GET()
    def do_POST(self):
        if urlparse(self.path).path == "/v0/management/cache-diagnostics/session":
            body = json.loads(self._read_body_text())
            assert body["diagnostics_id"] == TRACE and body["session_hash"] == SESSION
            self.state.record("POST", urlparse(self.path).path, "")
            self._send_json({"instance_id": INSTANCE, "status": "bound", "at": NOW, "session_hash": SESSION, "bindings": [{"kind": "session_binding", "auth_index": "B", "expires_at": NOW, "expired": False}], "truncated": False, "oauth": {"status": "not_recorded", "at": NOW, "rows": [], "truncated": False}})
            return
        super().do_POST()

def main():
    state = smoke.MockCoreState()
    state.usage_payload = {"usage": {"apis": {"POST /v1/responses": {"models": {
        "gpt-5.6-sol": {"details": [{"timestamp": NOW, "source": "synthetic", "auth_index": "B", "request_id": "execution-B", "diagnostics_id": TRACE, "diagnostics_instance_id": INSTANCE, "cache_observation": OBS, "tokens": {"input_tokens": 100, "output_tokens": 1, "total_tokens": 101, "cached_tokens": 0}, "failed": False}]},
        "gpt-5.6-shared": {"details": [{"timestamp": "2026-11-25T00:00:00Z", "source": "synthetic", "auth_index": "A", "trace_id": "shared-log", "diagnostics_instance_id": INSTANCE, "cache_observation": OBS, "tokens": {"input_tokens": 90, "output_tokens": 1, "total_tokens": 91, "cached_tokens": 0}, "failed": False}]},
    }}}}}
    app_port, api_port = smoke.find_free_port(), smoke.find_free_port()
    app_url, api_url = f"http://127.0.0.1:{app_port}/management.html", f"http://127.0.0.1:{api_port}"
    artifacts = ROOT / "local/cache-browser"
    artifacts.mkdir(parents=True, exist_ok=True)
    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(CacheHandler, api_port, state), sync_playwright() as playwright:
        browser = launch_chromium(playwright, headless=True)
        context = browser.new_context(locale="en-US", viewport={"width": 1360, "height": 1000})
        context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
        page = PanelBrowser(context.new_page())
        page.set_default_timeout(15000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            page.goto(app_url + "#/login", wait_until="domcontentloaded")
            page.locator('input[type="checkbox"]').first.check(force=True)
            page.locator("input.input").first.fill(api_url)
            page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
            page.get_by_label("Remember password").check(force=True)
            page.get_by_role("button", name=re.compile(r"^(Login|Connect)$", re.I)).click()
            page.wait_for_url(re.compile(r".*#/$"), timeout=20000)
            page.goto(app_url + "?route=cache-smoke#/usage?range=all", wait_until="domcontentloaded")
            page.get_by_role("button", name="Show details here").click()
            row = page.locator('tr[data-request-row-expanded]').first
            row.click()
            panel = page.locator('[data-cache-diagnostics="ready"]')
            panel.wait_for()
            disclosure = panel.locator('summary').first
            disclosure.focus()
            disclosure.press('Enter')
            if disclosure.locator('..').get_attribute('open') is None:
                raise AssertionError("Disclosure did not open from the keyboard")
            disclosure.press('Enter')
            panel.get_by_text("Field not provided upstream", exact=True).first.wait_for()
            panel.locator("summary").filter(has_text="Outbound attempt 1").click()
            panel.locator("summary").filter(has_text="Outbound attempt 2").click()
            panel.locator('details[data-current-execution="false"]').get_by_text("decision-A", exact=True).wait_for()
            panel.locator('details[data-current-execution="true"]').get_by_text("decision-B", exact=True).wait_for()
            panel.get_by_text("resp_synthetic", exact=True).wait_for()
            panel.get_by_role("button", name="Query current session binding", exact=True).click()
            panel.get_by_text("Active binding found", exact=False).wait_for()
            panel.get_by_label("Diagnostic record ID for local comparison").fill(BASELINE.upper())
            panel.get_by_role("button", name="Compare field digests", exact=True).click()
            panel.locator('[role="status"]').filter(has_text="reasoning.effort").wait_for()
            if f"GET /v0/management/cache-diagnostics/requests/{BASELINE}" not in state.requests:
                raise AssertionError("Uppercase diagnostic ID was not normalized to lowercase")
            panel.locator('dl').first.scroll_into_view_if_needed()
            page.screenshot(path=str(artifacts / "desktop.png"))
            if panel.bounding_box()["width"] < 600: raise AssertionError("Desktop diagnostics collapsed into a narrow column")
            page.set_viewport_size({"width": 390, "height": 844})
            panel.locator('dl').first.scroll_into_view_if_needed()
            page.screenshot(path=str(artifacts / "mobile.png"))
            if panel.bounding_box()["width"] > 390: raise AssertionError("Mobile diagnostics exceed the viewport")
            if page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"):
                raise AssertionError("diagnostic details overflow the document")
            for mode, result in [("missing", "unavailable"), ("foreign", "unavailable"), ("unsupported", "unsupported")]:
                row.click()
                CacheHandler.mode = mode
                row.click()
                page.locator(f'[data-cache-diagnostics="{result}"]').wait_for()
            CacheHandler.mode = "ready"
            page.set_viewport_size({"width": 1360, "height": 1000})
            page.goto(app_url + "?route=cache-details#/usage/events?range=all", wait_until="domcontentloaded")
            event_row = page.locator('tr[data-request-row-expanded]').first
            event_row.locator("td").first.get_by_role("button").click()
            page.locator('[data-cache-diagnostics]').wait_for(state="detached")
            page.get_by_role("button", name="Analyze this request").press("Enter")
            page.get_by_text("Outbound attempt 2 · WebSocket", exact=False).wait_for()
            page.get_by_role("button", name="Back to request events").click()
            page.wait_for_function("() => document.activeElement?.hasAttribute('data-cache-analysis-trigger')")
            page.goto(app_url + "?route=legacy-cache-analysis#/analytics/cache", wait_until="domcontentloaded")
            page.get_by_text("This Core can open a single diagnostic ID.", exact=True).wait_for()
            field = page.get_by_role("searchbox", name="Diagnostic record ID")
            field.fill(TRACE.upper())
            field.press("Enter")
            page.get_by_text("Outbound attempt 2 · WebSocket", exact=False).wait_for()

            CacheHandler.mode = "search"
            state.requests.clear()
            page.goto(app_url + "?route=cache-diagnostic-link#/analytics/cache?diagnostics=" + TRACE.upper(), wait_until="domcontentloaded")
            page.get_by_text("Outbound attempt 2 · WebSocket", exact=False).wait_for()
            if not any(req.startswith("GET /v0/management/cache-diagnostics/traces?") and "q=" + TRACE in req for req in state.requests):
                raise AssertionError("The diagnostic link did not query its canonical digest")
            state.requests.clear()
            page.goto(app_url + "?route=cache-trace-link#/analytics/cache?trace=shared-log", wait_until="domcontentloaded")
            page.locator("#cache-timeline-heading").wait_for()
            if page.locator("#cache-timeline-heading").inner_text() != "Matching requests":
                raise AssertionError(f"Mode A heading mismatch: {page.locator('#cache-timeline-heading').inner_text()!r}")
            if not any("GET /v0/management/cache-diagnostics/traces?" in req and "q=shared-log" in req for req in state.requests):
                raise AssertionError(f"Mode A did not query /traces with q=shared-log: {state.requests}")
            page.locator('[data-testid="cache-trace-candidate"]').first.click()
            page.get_by_text("Outbound attempt 2 · WebSocket", exact=False).wait_for()
            page.locator('li[data-kind="changed"]').filter(has_text="reasoning.effort").wait_for()

            page.goto(app_url + "?route=cache-mode-b#/usage/events?range=all", wait_until="domcontentloaded")
            shared_row = page.locator('tr[data-request-row-expanded]').filter(has_text="gpt-5.6-shared").first
            shared_row.locator("td").first.get_by_role("button").click()
            page.get_by_role("button", name="Analyze this request").click()
            page.locator("#cache-timeline-heading").wait_for()
            if page.locator("#cache-timeline-heading").inner_text() != "Matching requests":
                raise AssertionError(f"Mode B desktop heading mismatch: {page.locator('#cache-timeline-heading').inner_text()!r}")
            if page.locator('[data-testid="cache-trace-candidate"]').count() < 2:
                raise AssertionError("Mode B expected at least 2 matching candidates")
            if page.get_by_text("Usage summary available. This instance has no trace for this request.", exact=True).count() != 0:
                raise AssertionError("Mode B unexpectedly displayed history_only notice while matches exist")

            page.set_viewport_size({"width": 390, "height": 844})
            mobile_details = page.locator("details").filter(has=page.locator("summary", has_text="Matching requests")).first
            mobile_details.wait_for()
            if mobile_details.get_attribute("open") is None:
                raise AssertionError("Mode B mobile candidate disclosure should default to open")
            mobile_details.locator('[data-testid="cache-trace-candidate"]').first.click()
            page.get_by_text("Outbound attempt 2 · WebSocket", exact=False).wait_for()
            page.set_viewport_size({"width": 1360, "height": 1000})
            if page.locator("#cache-timeline-heading").inner_text() != "Related requests":
                raise AssertionError(f"Expected Related requests after candidate selection, got: {page.locator('#cache-timeline-heading').inner_text()!r}")

            if errors: raise AssertionError(errors)
            print("Cache diagnostics browser smoke passed: attempts, field presence, query, comparison, instance mismatch, old Core, search Mode A/B, uppercase ID, empty created_at, desktop and mobile.")
        except Exception:
            page.screenshot(path=str(artifacts / "failure.png"), full_page=True)
            (artifacts / "failure.html").write_text(page.content())
            raise
        finally:
            context.close()
            browser.close()

if __name__ == "__main__":
    main()

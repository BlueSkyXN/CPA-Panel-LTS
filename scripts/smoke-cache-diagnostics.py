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
    return {"version": 1, "id": identifier, "instance_id": INSTANCE, "logical_request_id": "logical-request", "session_hash": SESSION, "model": "gpt-5.6-sol", "source_format": "openai-response", "created_at": NOW, "updated_at": NOW, "input": payload("low" if identifier == BASELINE else "high"), "truncated": False,
        "events": [{"sequence": 1, "decision_id": "decision-A", "layer": "account", "method": "lcp", "result": "not_run", "reason": "explicit_identity"}, {"sequence": 2, "decision_id": "decision-B", "layer": "account", "method": "session_binding", "result": "created", "auth_index": "B"}],
        "attempts": [{"number": 1, "decision_id": "decision-A", "execution_id": "execution-A", "provider": "codex", "model": "gpt-5.6-sol", "auth_type": "api_key", "auth_index": "A", "transport": "http", "endpoint": "openai_public", "status": 503, "outcome": "body_consumed", "request": payload(), "comparison_id_sent": "absent", "observation_state": "not_observed", "diagnostic_returned": False, "response_truncated": False},
        {"number": 2, "decision_id": "decision-B", "execution_id": "execution-B", "provider": "codex", "model": "gpt-5.6-sol", "auth_type": "api_key", "auth_index": "B", "transport": "websocket", "endpoint": "openai_public", "outcome": "completed", "request": payload(), "response_id": "resp_synthetic", "response_model": "gpt-5.6-sol", "response_status": "completed", "observation_state": "observed", "comparison_id_sent": "present", "diagnostic_returned": True, "diagnostic": {"type": "comparison_response_not_found"}, "cache_observation": OBS, "response_truncated": False}]}

class CacheHandler(smoke.MockCoreHandler):
    mode = "ready"
    def do_GET(self):
        path = urlparse(self.path).path
        prefix = "/v0/management/cache-diagnostics/"
        if path.startswith(prefix):
            self.state.record("GET", path, "")
            if path.endswith("capabilities"):
                self._send_json({"version": 1}, status=404 if type(self).mode == "unsupported" else 200)
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
    state.usage_payload = {"usage": {"apis": {"POST /v1/responses": {"models": {"gpt-5.6-sol": {"details": [{"timestamp": NOW, "source": "synthetic", "auth_index": "B", "request_id": "execution-B", "diagnostics_id": TRACE, "diagnostics_instance_id": INSTANCE, "cache_observation": OBS, "tokens": {"input_tokens": 100, "output_tokens": 1, "total_tokens": 101, "cached_tokens": 0}, "failed": False}]}}}}}}
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
            page.goto(app_url + "?route=cache-smoke#/usage/events?range=all", wait_until="domcontentloaded")
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
            panel.get_by_label("Diagnostic record ID for local comparison").fill(BASELINE)
            panel.get_by_role("button", name="Compare field digests", exact=True).click()
            panel.locator('[role="status"]').filter(has_text="reasoning.effort").wait_for()
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
            page.goto(app_url + "?route=legacy-cache-analysis#/analytics/cache", wait_until="domcontentloaded")
            page.get_by_text("This Core can open a single diagnostic ID.", exact=True).wait_for()
            field = page.get_by_role("searchbox", name="Diagnostic record ID")
            field.fill(TRACE)
            field.press("Enter")
            page.get_by_text("Outbound attempt 2 · WebSocket", exact=False).wait_for()
            if errors: raise AssertionError(errors)
            print("Cache diagnostics browser smoke passed: attempts, field presence, query, comparison, instance mismatch, old Core, desktop and mobile.")
        except Exception:
            page.screenshot(path=str(artifacts / "failure.png"), full_page=True)
            (artifacts / "failure.html").write_text(page.content())
            raise
        finally:
            context.close()
            browser.close()

if __name__ == "__main__":
    main()

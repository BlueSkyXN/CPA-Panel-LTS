#!/usr/bin/env python3
"""使用本地合成 Core 验证导出恢复、取消、完整性与翻页；先运行 npm run build。"""
from __future__ import annotations

import csv
import importlib.util
import io
import json
import re
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from panel_browser import PanelBrowser
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("export_mock", ROOT / "scripts/smoke-lts-panel.py")
mock = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mock
spec.loader.exec_module(mock)


def metrics(count):
    result = dict.fromkeys([
        "requests", "success", "failure", "tokens", "input", "output", "reasoning",
        "cache_read", "cache_write", "prompt", "latency_ms", "latency_samples", "ttfb_samples",
    ], 0)
    result.update(requests=count, success=count, tokens=count * 15, input=count * 10, output=count * 5)
    for key in ["output_tps", "average_tps", "visible_tps", "reasoning_ratio"]:
        result[key] = {"numerator": 0, "denominator": 0, "samples": 0}
    return result


class ExportState(mock.MockCoreState):
    def __init__(self):
        super().__init__()
        now = datetime.now(timezone.utc)
        self.session = {"version": 1, "bound": "synthetic-export-bound", "now_ms": int(now.timestamp() * 1000),
                        "models": ["export-model-a", "export-model-b"], "max_page_size": 200}
        self.items = [{
            "id": str(i), "api": "synthetic-caller", "model": "export-model-a" if i < 250 else "export-model-b",
            "detail": {"timestamp": (now - timedelta(seconds=i)).isoformat(), "source": "synthetic-source",
                       "auth_index": "synthetic-index", "failed": False, "trace_id": f"export-trace-{i}",
                       "tokens": {"input_tokens": 10, "output_tokens": 5, "reasoning_tokens": 0,
                                  "cached_tokens": 0, "total_tokens": 15}},
        } for i in range(450)]
        self.scenario = "normal"
        self.calls = []
        self.failures = 0
        self.pending = threading.Event()
        self.release = threading.Event()

    def reset(self, scenario):
        self.scenario = scenario
        self.calls = []
        self.failures = 0
        self.pending.clear()
        self.release.clear()


class ExportHandler(mock.MockCoreHandler):
    def _send_bytes(self, *args, **kwargs):
        try:
            super()._send_bytes(*args, **kwargs)
        except (BrokenPipeError, ConnectionResetError):
            pass  # 浏览器取消请求是本测试的预期行为。

    def do_GET(self):
        if urlparse(self.path).path.endswith("/usage/query/capabilities"):
            self._send_json(self.state.session)
        else:
            super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith("/v0/management/usage/query/"):
            return super().do_POST()
        request = json.loads(self._read_body_text())
        if not path.endswith("/details"):
            self._send_json({**self.state.session, "totals": metrics(450), "groups": {}})
            return
        self.state.calls.append(request)
        limit = request.get("limit", 100)
        offset = int(request.get("cursor") or 0)
        scenario = self.state.scenario
        if (scenario == "page-failure" and limit == 100 and offset == 100 and self.state.failures == 0
                or scenario == "resume" and limit == 200 and offset == 200 and self.state.failures < 3):
            self.state.failures += 1
            self._send_json({"error": "synthetic temporary failure"}, status=503)
            return
        if scenario == "slow" and limit == 200 and offset == 200:
            self.state.pending.set()
            if not self.state.release.wait(15):
                self._send_json({"error": "synthetic timeout"}, status=504)
                return
        if scenario == "expired" and limit == 200:
            self._send_json({"error": "synthetic expired snapshot"}, status=409)
            return
        model = request.get("filter", {}).get("model")
        items = [item for item in self.state.items if not model or item["model"] == model]
        response = {"version": 1, "bound": self.state.session["bound"], "total": len(items),
                    "items": items[offset:offset + limit], "metrics": metrics(len(items)),
                    "next_cursor": str(offset + limit) if offset + limit < len(items) else ""}
        if request.get("include_options"):
            response["options"] = {"models": self.state.session["models"], "apis": ["synthetic-caller"],
                                   "identities": [{"source": "synthetic-source", "auth_index": "synthetic-index"}],
                                   "auth_indices": ["synthetic-index"], "efforts": [], "metrics": metrics(450)}
        if limit == 200:
            if scenario == "cursor" and offset:
                response["next_cursor"] = request["cursor"]
            elif scenario == "bound":
                response["bound"] = "different-synthetic-bound"
            elif scenario == "short":
                response["next_cursor"] = ""
        self._send_json(response)


def run(app_url, api_url, state):
    artifacts = ROOT / "local/usage-export"
    artifacts.mkdir(parents=True, exist_ok=True)
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(locale="en-US", accept_downloads=True, reduced_motion="reduce",
                                      viewport={"width": 1440, "height": 1000})
        context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
        page = PanelBrowser(context.new_page())
        page.set_default_timeout(10000)
        errors, downloads = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("download", lambda download: downloads.append(download.suggested_filename))
        try:
            page.goto(app_url + "/#/login")
            page.get_by_label("Custom Connection URL:").check(force=True)
            page.locator("input.input").first.fill(api_url)
            page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
            page.get_by_label("Remember password").check(force=True)
            page.get_by_role("button", name=re.compile(r"^(Login|Connect)$", re.I)).click()
            page.wait_for_url(re.compile(r".*/#/$"))

            def workspace(scenario="normal"):
                state.release.set()
                page.goto(app_url + "/#/usage/events?range=all")
                region = page.get_by_role("region", name="Request events table", exact=True)
                expect(region.locator("tbody tr")).to_have_count(100)
                state.reset(scenario)
                return region

            def export(format="JSON"):
                page.get_by_role("button", name=f"Export filtered {format}", exact=True).click()

            def selected(model):
                page.get_by_role("button", name="Model", exact=True).click()
                page.get_by_role("option", name=model, exact=True).click()
                expect(page.get_by_role("button", name="Export filtered JSON", exact=True)).to_be_enabled()

            region = workspace("page-failure")
            before = region.locator("tbody tr").first.inner_text()
            page.get_by_role("button", name="Next page", exact=True).click()
            page.get_by_text("Could not load page 2.", exact=False).wait_for()
            assert region.locator("tbody tr").first.inner_text() == before
            page.get_by_text("1–100 of 450 requests. Export includes all filtered requests.", exact=True).wait_for()
            page.get_by_role("button", name="Retry page", exact=True).click()
            page.get_by_text("101–200 of 450 requests. Export includes all filtered requests.", exact=True).wait_for()
            assert region.locator("tbody tr").first.inner_text() != before
            checks.append("page failure retains rows and position; retry loads requested page")

            state.reset("resume")
            export()
            page.get_by_role("button", name="Continue export", exact=True).wait_for()
            page.get_by_text("Read 200 / 450 records", exact=True).wait_for()
            assert not downloads
            with page.expect_download() as pending:
                page.get_by_role("button", name="Continue export", exact=True).click()
            payload = json.loads(Path(pending.value.path()).read_text())
            assert len(payload) == 450
            assert {row["trace_id"] for row in payload} == {f"export-trace-{i}" for i in range(450)}
            calls = [q for q in state.calls if q["limit"] == 200]
            assert [q["cursor"] for q in calls] == ["", "200", "200", "200", "200", "400"]
            assert all(q["bound"] == state.session["bound"] and q["include_options"] is False for q in calls)
            checks.append("450 records exported from page 2 after bounded retry and checkpoint resume")

            selected("export-model-a")
            state.reset("normal")
            with page.expect_download() as pending:
                export("CSV")
            rows = list(csv.DictReader(io.StringIO(Path(pending.value.path()).read_text(encoding="utf-8-sig"))))
            assert len(rows) == 250 and all(row["model"] == "export-model-a" for row in rows)
            assert len({row["trace_id"] for row in rows}) == 250
            assert all(q.get("filter", {}).get("model") == "export-model-a" for q in state.calls if q["limit"] == 200)
            backup = page.get_by_role("button", name="Export full backup", exact=True)
            assert "regardless of the current filters" in backup.get_attribute("title")
            with page.expect_download() as pending:
                backup.click()
            assert "usage" in json.loads(Path(pending.value.path()).read_text())
            assert any("/usage/export" in entry for entry in state.requests)
            checks.append("filtered CSV includes all 250 matching records; full backup keeps its separate API")

            for scenario in ["cursor", "bound", "short", "expired"]:
                workspace(scenario)
                count = len(downloads)
                export()
                message = "The query snapshot expired." if scenario == "expired" else "Export stopped because records, count or cursor were inconsistent."
                page.get_by_text(message, exact=False).wait_for()
                assert len(downloads) == count
                expect(page.get_by_role("button", name="Continue export", exact=True)).to_have_count(0)
            checks.append("repeated cursor, changed bound, incomplete count and expired snapshot prevent download")

            for action in ["cancel", "filter", "unmount"]:
                workspace("slow")
                count = len(downloads)
                export()
                page.get_by_text("Read 200 / 250 records", exact=True).wait_for()
                assert state.pending.wait(2), "Second export batch did not start"
                if action == "cancel":
                    page.get_by_role("button", name="Cancel", exact=True).click()
                    page.get_by_text("Export cancelled.", exact=False).wait_for()
                elif action == "filter":
                    selected("export-model-b")
                else:
                    page.get_by_role("button", name="Back to Usage", exact=True).click()
                state.release.set()
                page.wait_for_timeout(700)
                assert len(downloads) == count
                assert len([q for q in state.calls if q["limit"] == 200]) == 2
                if action == "filter":
                    selected("export-model-a")
            checks.append("cancel, filter change and leaving the page stop old export without a download")

            workspace()
            page.wait_for_timeout(700)
            page.screenshot(path=str(artifacts / "desktop.png"), animations="disabled")
            mock.expand_header_toolbar(page)
            page.locator(".language-menu > button").click()
            page.get_by_role("menuitemradio", name="中文", exact=True).click()
            page.get_by_role("button", name="导出完整备份", exact=True).wait_for()
            page.get_by_role("button", name="导出筛选结果 JSON", exact=True).wait_for()
            page.get_by_text("CSV / JSON 导出当前时间范围和筛选条件下的全部 250 条匹配记录。", exact=True).wait_for()
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(700)
            if page.locator(".sidebar.open").count():
                page.locator("button.mobile-menu-btn").click()
            page.wait_for_timeout(300)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "mobile document overflow"
            page.screenshot(path=str(artifacts / "mobile.png"), animations="disabled")
            assert not errors, errors
            checks.append("English/Chinese desktop/mobile render without document overflow or browser page errors")
        finally:
            state.release.set()
            browser.close()
    result = {"passed": checks, "page_errors": errors}
    (artifacts / "browser-results.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    state = ExportState()
    app_port, api_port = mock.find_free_port(), mock.find_free_port()
    with mock.run_server(mock.StaticPanelHandler, app_port), mock.run_server(ExportHandler, api_port, state):
        run(f"http://127.0.0.1:{app_port}/management.html", f"http://127.0.0.1:{api_port}", state)

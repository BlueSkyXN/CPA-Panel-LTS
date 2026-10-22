#!/usr/bin/env python3
"""用临时真实 Core 验证三个新旧版本组合的导出内容及能力选择；不访问生产。"""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from panel_browser import PanelBrowser
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("usage_query_smoke", ROOT / "scripts/smoke-usage-query.py")
query = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = query
spec.loader.exec_module(query)
core = query.core


def browser_export(browser, app, api, expected_bulk):
    context = browser.new_context(locale="en-US", accept_downloads=True, reduced_motion="reduce")
    context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
    page = PanelBrowser(context.new_page())
    errors, requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def record(request):
        if request.method == "POST" and request.url.endswith(("/usage/query/details", "/usage/query/export")):
            requests.append({"path": urlparse(request.url).path, "limit": request.post_data_json["limit"]})

    page.on("request", record)
    try:
        page.goto(app + "/#/login")
        page.get_by_label("Custom Connection URL:").check(force=True)
        page.locator("input.input").first.fill(api)
        page.locator('input[name="cpa-management-key"]').fill(core.MANAGEMENT_KEY)
        page.get_by_label("Remember password").check(force=True)
        page.get_by_role("button", name=re.compile(r"^(Login|Connect)$", re.I)).click()
        page.wait_for_url(re.compile(r".*/#/$"))
        page.goto(app + "/#/usage/events?range=all")
        region = page.get_by_role("region", name="Request events table", exact=True)
        region.locator("tbody tr").nth(99).wait_for()
        results = []
        for format in ["JSON", "CSV"]:
            start = len(requests)
            with page.expect_download(timeout=60000) as pending:
                page.get_by_role("button", name=f"Export filtered {format}", exact=True).click()
            data = Path(pending.value.path()).read_bytes()
            calls = requests[start:]
            expected_path = "/usage/query/export" if expected_bulk else "/usage/query/details"
            assert calls and all(call["path"].endswith(expected_path) for call in calls), calls
            assert all(call["limit"] == (1000 if expected_bulk else 200) for call in calls), calls
            assert len(calls) == (3 if expected_bulk else 13), calls
            if format == "JSON":
                assert len(json.loads(data)) == 2501
            results.append({"format": format, "requests": len(calls), "limit": calls[0]["limit"],
                            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
        assert not errors, errors
        return {"formats": results, "page_errors": errors}
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-dir", required=True, type=Path)
    parser.add_argument("--legacy-core-dir", required=True, type=Path)
    parser.add_argument("--legacy-panel-dist", required=True, type=Path)
    args = parser.parse_args()
    payload = query.seed_payload(0, 2501, int(time.time()*1000))
    for model, data in payload["usage"]["apis"]["query-caller"]["models"].items():
        for i, detail in enumerate(data["details"]):
            detail["trace_id"] = f"synthetic-export-{model}-{i}"
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for core_name, directory in [("new", args.core_dir), ("old", args.legacy_core_dir)]:
                with tempfile.TemporaryDirectory(prefix="usage-export-core-") as temporary:
                    with core.run_core(directory.resolve(), Path(temporary)) as runtime:
                        receipt, _ = query.call(runtime.api_url, "/usage/import", payload)
                        assert receipt["total_requests"] == 2501, "synthetic import count changed"
                        caps, _ = query.call(runtime.api_url, "/usage/query/capabilities")
                        assert (caps.get("export_version") == 1) == (core_name == "new")
                        panels = [("new", ROOT / "dist")]
                        if core_name == "new":
                            panels.append(("old", args.legacy_panel_dist))
                        for panel_name, dist in panels:
                            core.INDEX_HTML = dist.resolve() / "index.html"
                            assert core.INDEX_HTML.is_file()
                            port = core.find_free_port()
                            with core.run_static_server(port):
                                key = f"{panel_name}_panel_{core_name}_core"
                                results[key] = browser_export(browser, f"http://127.0.0.1:{port}/management.html",
                                                              runtime.api_url, core_name == panel_name == "new")
                                print(json.dumps({key: results[key]}), flush=True)
        finally:
            browser.close()
    expected = [item["sha256"] for item in results["new_panel_new_core"]["formats"]]
    assert all([item["sha256"] for item in result["formats"]] == expected for result in results.values()), "export contents differ across versions"
    results["cross_version_bytes_equal"] = True
    output = ROOT / "local/usage-export/core-compatibility.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2) + "\n")
    print("Real Core export compatibility passed.")


if __name__ == "__main__":
    main()

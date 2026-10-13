#!/usr/bin/env python3
"""比较两个已构建 Panel 的导出内容、耗时、采样堆峰值及最长主线程任务；仅访问合成 Core。"""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from panel_browser import PanelBrowser
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("export_smoke", ROOT / "scripts/smoke-usage-export.py")
fixture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fixture
spec.loader.exec_module(fixture)


def measure(browser, app, api, state):
    context = browser.new_context(accept_downloads=True, reduced_motion="reduce")
    context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
    page = PanelBrowser(context.new_page())
    try:
        page.goto(app + "/#/login")
        page.get_by_label("Custom Connection URL:").check(force=True)
        page.locator("input.input").first.fill(api)
        page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
        page.get_by_label("Remember password").check(force=True)
        page.get_by_role("button", name=re.compile(r"^(Login|Connect)$", re.I)).click()
        page.wait_for_url(re.compile(r".*/#/$"))
        page.goto(app + "/#/usage/events?range=all")
        page.get_by_role("region", name="Request events table", exact=True).locator("tbody tr").nth(99).wait_for()
        page.wait_for_timeout(400)
        cdp = context.new_cdp_session(page.raw)
        results = []
        for format in ["JSON", "CSV"]:
            cdp.send("HeapProfiler.collectGarbage")
            page.evaluate("""() => {
                const p = window.exportMeasurement = {heapStart: performance.memory.usedJSHeapSize, heapPeak: 0, longestTaskMs: 0};
                p.timer = setInterval(() => p.heapPeak = Math.max(p.heapPeak, performance.memory.usedJSHeapSize), 10);
                p.observer = new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) p.longestTaskMs = Math.max(p.longestTaskMs, entry.duration);
                });
                p.observer.observe({type: 'longtask'});
                p.start = performance.now();
            }""")
            before = len(state.calls)
            with page.expect_download(timeout=120000) as pending:
                page.get_by_role("button", name=f"Export filtered {format}", exact=True).click()
            elapsed = page.evaluate("performance.now() - window.exportMeasurement.start")
            page.wait_for_timeout(100)
            result = page.evaluate("""() => {
                const p = window.exportMeasurement;
                clearInterval(p.timer); p.observer.disconnect();
                return {heap_start_bytes: p.heapStart, sampled_heap_peak_bytes: p.heapPeak, longest_task_ms: p.longestTaskMs};
            }""")
            data = Path(pending.value.path()).read_bytes()
            result.update(format=format, elapsed_ms=round(elapsed, 2), requests=len(state.calls)-before,
                          bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            results.append(result)
        return results
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dist", type=Path, required=True)
    parser.add_argument("--rows", type=int, default=10000)
    args = parser.parse_args()
    state = fixture.ExportState()
    now = datetime.now(timezone.utc)
    template = state.items[0]
    state.items = [{**template, "id": str(i), "detail": {**template["detail"],
                   "timestamp": (now-timedelta(seconds=i)).isoformat(), "trace_id": f"export-trace-{i}"}}
                   for i in range(args.rows)]
    state.session["now_ms"] = int(now.timestamp()*1000)
    results = {"rows": args.rows, "heap_measurement": "10ms browser samples, not an exact allocator peak"}
    api_port = fixture.mock.find_free_port()
    with fixture.mock.run_server(fixture.ExportHandler, api_port, state), sync_playwright() as p:
        browser = p.chromium.launch(args=["--enable-precise-memory-info"])
        try:
            for name, directory in [("baseline", args.baseline_dist), ("current", ROOT / "dist")]:
                fixture.mock.INDEX_HTML = directory.resolve() / "index.html"
                assert fixture.mock.INDEX_HTML.is_file(), fixture.mock.INDEX_HTML
                port = fixture.mock.find_free_port()
                with fixture.mock.run_server(fixture.mock.StaticPanelHandler, port):
                    results[name] = measure(browser, f"http://127.0.0.1:{port}/management.html", f"http://127.0.0.1:{api_port}", state)
        finally:
            browser.close()
    for old, new in zip(results["baseline"], results["current"]):
        assert old["sha256"] == new["sha256"], f"{old['format']} export bytes changed"
    output = ROOT / "local/usage-export/benchmark.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

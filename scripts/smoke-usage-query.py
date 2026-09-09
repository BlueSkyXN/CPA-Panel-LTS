#!/usr/bin/env python3
"""在临时真实 Core 中验证按量查询、旧新算法等价和浏览器请求，不访问生产。"""
from __future__ import annotations

import importlib.util
import io
import json
import re
import subprocess
import sys
import tempfile
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("core_smoke", ROOT / "scripts/smoke-lts-panel-core.py")
core = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = core
spec.loader.exec_module(core)


def call(api, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = Request(api + "/v0/management" + path, data=data, headers={"Authorization": "Bearer " + core.MANAGEMENT_KEY, "Content-Type": "application/json"})
    started = time.perf_counter()
    with urlopen(request, timeout=60) as response:
        body = response.read()
    return json.loads(body), {"ms": round((time.perf_counter() - started) * 1000, 2), "bytes": len(body)}


def seed_payload(start, stop, now):
    models = {}
    names = ["gpt-5.6-sol", "claude-sonnet-4", "unmatched-query-model"]
    for i in range(start, stop):
        name = names[i % len(names)]
        timestamp = now - (i * 7919) % (48 * 3600000)
        token_input = 300000 if i % 9 == 0 else 1000
        detail = {"timestamp": datetime.fromtimestamp(timestamp / 1000, timezone.utc).isoformat(), "latency_ms": 1000 + i % 7, "ttfb_ms": 0 if i % 11 == 0 else 200, "source": "query-source-" + str(i % 4), "auth_index": str(i % 4), "failed": i % 5 == 0, "generate": i % 7 != 0, "tokens": {"input_tokens": token_input, "output_tokens": 100, "reasoning_tokens": 20, "cached_tokens": 100, "cache_read_tokens": 100, "cache_creation_tokens": 30, "total_tokens": token_input + 100}, "request_service_tier": "priority" if i % 2 else "standard", "response_service_tier": "future-tier" if i % 13 == 0 else "priority" if i % 3 == 0 else "standard", "reasoning_effort": "CUSTOM" if i % 4 else "high"}
        model = models.setdefault(name, {"total_requests": 0, "total_tokens": 0, "details": []})
        model["details"].append(detail)
    return {"version": 3, "usage": {"apis": {"query-caller": {"models": models}}}}


def node_check(data, rules=False):
    command = ["node", "scripts/check-usage-query-equivalence.mjs"]
    if rules:
        command.append("--rules")
    result = subprocess.run(command, cwd=ROOT, input=json.dumps(data), text=True, capture_output=True, check=False)
    if result.returncode:
        raise AssertionError(result.stderr[-5000:])
    return json.loads(result.stdout)


def browser_check(api, app_url, count):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            context = browser.new_context(locale="en-US")
            context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
            page = context.new_page()
            page.set_default_timeout(30000)
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url.split("?")[0]))
            page.goto(app_url + "/#/login")
            page.get_by_label("Custom Connection URL:").check(force=True)
            page.get_by_placeholder("Eg: https://example.com:8317").fill(api)
            page.locator('input[name="cpa-management-key"]').fill(core.MANAGEMENT_KEY)
            page.get_by_label("Remember password").check(force=True)
            page.get_by_role("button", name=re.compile("Login|Connect", re.I)).click()
            page.wait_for_url(lambda url: "#/login" not in url)
            for route, query_path in [("/usage", "/usage/query/summary"), ("/usage/pricing", "/usage/query/pricing")]:
                with page.expect_response(lambda response: response.url.endswith(query_path) and response.status == 200):
                    page.goto(app_url + "/#" + route)
                page.wait_for_timeout(250)
            page.goto(app_url + "/#/usage/events?range=all")
            page.locator('[data-testid="usage-events-workspace"] tbody tr').first.wait_for()
            assert page.locator('[data-testid="usage-events-workspace"] tbody tr').count() == 100
            first = page.locator('[data-testid="usage-events-workspace"] tbody tr').first.inner_text()
            with page.expect_response(lambda response: response.url.endswith("/usage/query/details") and response.status == 200) as response:
                page.get_by_role("button", name="Next page", exact=True).click()
            page.wait_for_timeout(100)
            payload = response.value.json()
            assert len(payload["items"]) == 100 and payload["total"] == count
            assert page.locator('[data-testid="usage-events-workspace"] tbody tr').first.inner_text() != first
            assert page.locator('[data-testid="usage-events-workspace"] tbody tr').count() == 100
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "mobile document overflow"
            for route in ["/core", "/ai-providers/legacy", "/auth-files"]:
                page.goto(app_url + "/#" + route)
                page.wait_for_timeout(350)
            page.route("**/usage/query/summary", lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":"query-failure-test"}'))
            page.goto(app_url + "/#/usage")
            page.get_by_text("query-failure-test", exact=True).wait_for()
            page.unroute("**/usage/query/summary")
            full = [path for path in requests if path.endswith("/v0/management/usage")]
            assert not full, "daily consumers still requested full usage"
            assert not errors, errors
            return {"rows": 100, "full_usage_requests": len(full), "query_requests": sum("/usage/query/" in path for path in requests), "page_errors": len(errors), "mobile_overflow": False, "query_failure_no_full_fallback": True}
        finally:
            browser.close()


def legacy_panel_check(api, directory):
    """构建本仓修改前的 HEAD，仅使用已有依赖；不检出或覆盖当前工作区。"""
    from playwright.sync_api import sync_playwright
    source = directory / "legacy-panel"
    source.mkdir()
    archive = subprocess.run(["git", "archive", "HEAD"], cwd=ROOT, check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as files:
        files.extractall(source, filter="data")
    (source / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
    build = subprocess.run(["npm", "run", "build"], cwd=source, capture_output=True, text=True)
    if build.returncode:
        raise AssertionError(build.stderr[-3000:])
    previous = core.INDEX_HTML
    core.INDEX_HTML = source / "dist/index.html"
    try:
        with core.run_static_server(core.find_free_port()) as server, sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                context = browser.new_context(locale="en-US")
                context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
                page = context.new_page()
                page.set_default_timeout(30000)
                errors, reads = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: reads.append(request.url))
                app = f"http://127.0.0.1:{server.server_port}"
                page.goto(app + "/#/login")
                page.get_by_label("Custom Connection URL:").check(force=True)
                page.get_by_placeholder("Eg: https://example.com:8317").fill(api)
                page.locator('input[name="cpa-management-key"]').fill(core.MANAGEMENT_KEY)
                page.get_by_role("button", name=re.compile("Login|Connect", re.I)).click()
                page.wait_for_url(lambda url: "#/login" not in url)
                page.goto(app + "/#/usage/events?range=all")
                page.locator('[data-testid="usage-events-workspace"] tbody tr').first.wait_for()
                assert page.locator('[data-testid="usage-events-workspace"] tbody tr').count() == 100
                assert any(url.endswith("/v0/management/usage") for url in reads)
                assert not errors, errors
                return {"baseline": subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip(), "old_panel_new_core": "passed"}
            finally:
                browser.close()
    finally:
        core.INDEX_HTML = previous


def main():
    now = int(time.time() * 1000)
    with tempfile.TemporaryDirectory(prefix="cpa-usage-query-") as directory:
        with core.run_core(ROOT.parent / "CPA-Core-LTS", Path(directory)) as runtime:
            api = runtime.api_url
            for count, previous in [(10000, 0), (100000, 10000)]:
                receipt, _ = call(api, "/usage/import", seed_payload(previous, count, now))
                assert receipt["total_requests"] == count
                session, _ = call(api, "/usage/query/capabilities")
                rules = node_check({"models": session["models"]}, rules=True)
                request = {"bound": session["bound"], "now_ms": session["now_ms"], "timezone": "Asia/Shanghai", "modules": ["models", "api_models", "credentials", "hours", "days", "rates", "minutes", "status", "health"]}
                summary, summary_timing = call(api, "/usage/query/summary", request)
                pricing, _ = call(api, "/usage/query/pricing", {**request, "rules": rules})
                snapshot, snapshot_timing = call(api, "/usage")
                equivalence = node_check({"snapshot": snapshot["usage"], "summary": summary, "pricing": pricing})
                window = {"startMs": now - 12 * 3600000 + 12345, "endMs": now - 3600000 + 54321}
                scoped = {**request, "from_ms": window["startMs"], "to_ms": window["endMs"], "hour_from_ms": window["startMs"]}
                scoped_summary, _ = call(api, "/usage/query/summary", scoped)
                scoped_price, _ = call(api, "/usage/query/pricing", {**scoped, "rules": rules})
                node_check({"snapshot": snapshot["usage"], "summary": scoped_summary, "pricing": scoped_price, "window": window})
                details, details_timing = call(api, "/usage/query/details", {"bound": session["bound"], "include_options": True})
                assert len(details["items"]) == 100 and details["total"] == count
                output = {"count": count, "summary": summary_timing, "details": details_timing, "snapshot": snapshot_timing, "equivalence": equivalence}
                print(json.dumps({"api_checked": output}), flush=True)
                port = core.find_free_port()
                with core.run_static_server(port):
                    output["browser"] = browser_check(api, f"http://127.0.0.1:{port}", count)
                if count == 10000 and "--legacy-panel" in sys.argv:
                    output["legacy_panel"] = legacy_panel_check(api, Path(directory))
                print(json.dumps(output), flush=True)


if __name__ == "__main__":
    main()

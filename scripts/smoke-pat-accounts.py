#!/usr/bin/env python3
"""PAT 表单和额度的 mock-Core 浏览器回归，不连接真实账号。"""
from email.parser import BytesParser
from email.policy import default
import importlib.util
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_smoke", ROOT / "scripts/smoke-lts-panel.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def main():
    app_port, api_port = smoke.find_free_port(), smoke.find_free_port()
    state = smoke.MockCoreState()
    auths = {}
    plugin_enabled = True
    quota_rejected = False
    secrets_used = ["pt-fixture-create-only", "pt-fixture-update-only"]

    def api(route):
        nonlocal auths
        request = route.request
        url = urlparse(request.url)
        path = url.path.removeprefix("/v0/management")
        query = parse_qs(url.query)
        result = None
        if path == "/plugins":
            result = {"plugins_enabled": True, "plugins_dir": "/opt/cpa-pat-plugins", "plugins": [
                {"id": f"cpa-provider-{provider}", "registered": plugin_enabled, "effective_enabled": plugin_enabled,
                 "enabled": plugin_enabled, "configured": True,
                 "metadata": {"name": f"cpa-provider-{provider}", "version": "0.1.0", "author": "Fixture"}}
                for provider in ("codebuddy", "qoder")
            ]}
        elif path.startswith("/plugins/") and path.endswith("/config"):
            result = {"transport": "direct_openai", "openapi_endpoint": "https://openapi.qoder.com.cn"}
        elif path.endswith("/summary"):
            provider = path.split("/")[2]
            result = {"provider": provider, "auth_index": query["auth_index"][0], "label": "Fixture account",
                      "account": {"status": "fallback"}, "plan": {"status": "unsupported"},
                      "quota": {"status": "auth_rejected"} if quota_rejected else
                        {"status": "available", "remaining_exact": "0", "total_exact": "100.125", "used_exact": "100.125", "unit": "credits"},
                      "updated_at": "2026-09-09T00:00:00Z", "cached": True}
        elif path == "/auth-files" and request.method == "POST":
            message = BytesParser(policy=default).parsebytes(
                f"Content-Type: {request.headers['content-type']}\r\n\r\n".encode() + request.post_data_buffer)
            for part in message.iter_parts():
                name = part.get_filename()
                auths[name] = json.loads(part.get_payload(decode=True))
            result = {"status": "ok"}
        elif path == "/auth-files":
            result = {"files": [{"name": name, "type": value["type"], "label": value.get("label", ""),
                                 "auth_index": name, "status": "active", "size": 200, "disabled": False}
                                for name, value in auths.items()]}
        elif path == "/auth-files/download":
            result = auths[query["name"][0]]
        if result is None:
            route.continue_()
        else:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(result),
                          headers={"Access-Control-Allow-Origin": "*", "x-cpa-support-plugin": "true"})

    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(smoke.MockCoreHandler, api_port, state):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(locale="en-US", viewport={"width": 1440, "height": 1000})
            context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
            page = context.new_page()
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.route("**/v0/management/**", api)
            base = f"http://127.0.0.1:{app_port}/management.html"
            page.goto(base + "#/login")
            page.locator('input[type="checkbox"]').first.check(force=True)
            page.locator("input.input").first.fill(f"http://127.0.0.1:{api_port}")
            page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
            page.get_by_role("button", name=re.compile("Login|Connect", re.I)).click()
            page.wait_for_function("window.location.hash === '#/'")
            page.goto(base + "#/auth-files")
            page.get_by_role("button", name="Add PAT account", exact=True).click()
            dialog = page.get_by_role("dialog", name="Add PAT account")
            dialog.get_by_label("Account label").fill("Fixture account")
            dialog.get_by_label("PAT", exact=True).fill(secrets_used[0])
            dialog.get_by_role("button", name="Save", exact=True).click()
            dialog.wait_for(state="detached")
            assert len(auths) == 1
            name = next(iter(auths))
            assert auths[name]["type"] == "codebuddy" and auths[name]["pat"] == secrets_used[0]
            auths[name]["priority"] = 7
            page.get_by_role("button", name="Update PAT", exact=True).click()
            dialog = page.get_by_role("dialog", name="Update PAT")
            assert dialog.get_by_label("PAT", exact=True).input_value() == ""
            dialog.get_by_label("PAT", exact=True).fill(secrets_used[1])
            dialog.get_by_role("button", name="Save", exact=True).click()
            dialog.wait_for(state="detached")
            assert len(auths) == 1 and auths[name]["priority"] == 7 and auths[name]["pat"] == secrets_used[1]
            page.get_by_role("button", name="View account and quota", exact=True).click()
            page.get_by_text("100.125 credits", exact=True).first.wait_for()
            page.get_by_text("0 credits", exact=True).wait_for()
            page.get_by_text(re.compile("Data as of:.*2026-09-09T00:00:00Z.*Server cache")).wait_for()
            quota_rejected = True
            page.get_by_role("button", name="Refresh account and quota", exact=True).click()
            page.get_by_text("Credential rejected; update PAT", exact=True).wait_for()
            assert page.get_by_text("0 credits", exact=True).count() == 0

            page.get_by_role("button", name="Add PAT account", exact=True).click()
            dialog = page.get_by_role("dialog", name="Add PAT account")
            dialog.get_by_role("button", name="Provider", exact=True).click()
            page.get_by_role("option", name="Qoder", exact=True).click()
            dialog.get_by_label("PAT", exact=True).fill("invalid-fixture")
            dialog.get_by_role("button", name="Save", exact=True).click()
            dialog.get_by_text("Enter a valid single-line PAT. Qoder PATs must start with pt-.", exact=True).wait_for()
            dialog.get_by_label("PAT", exact=True).fill("pt-qoder-fixture")
            dialog.get_by_role("button", name="Save", exact=True).click()
            dialog.wait_for(state="detached")
            assert len(auths) == 2
            qoder = next(value for value in auths.values() if value["type"] == "qoder")
            assert "transport" not in qoder and "region" not in qoder

            storage = page.evaluate("JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)])")
            assert all(value not in storage for value in [*secrets_used, "pt-qoder-fixture"])
            output = ROOT / "output/playwright"
            output.mkdir(parents=True, exist_ok=True)
            page.wait_for_function("document.querySelectorAll('.notification-container .notification').length === 0")
            page.screenshot(path=str(output / "pat-accounts-desktop.png"), full_page=True, animations="disabled")
            plugin_enabled = False
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("button", name="Add PAT account", exact=True).click()
            dialog = page.get_by_role("dialog", name="Add PAT account")
            dialog.get_by_text(re.compile("Core plugin support is unconfirmed")).wait_for()
            assert dialog.get_by_role("button", name="Save", exact=True).is_disabled()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
            dialog.get_by_role("button", name="Retry", exact=True).wait_for()
            page.screenshot(path=str(output / "pat-accounts-mobile.png"), animations="disabled")
            plugin_enabled = True
            dialog.get_by_role("button", name="Retry", exact=True).click()
            dialog.get_by_text(re.compile("Instance: direct_https")).wait_for()
            dialog.get_by_role("button", name="Cancel", exact=True).click()
            assert not errors, "Browser reported JavaScript errors"
            browser.close()
    print("PASS: PAT create/update, Qoder validation, quota states/cache, dependency gate, mobile layout, no browser PAT persistence (mock Core)")


if __name__ == "__main__":
    main()

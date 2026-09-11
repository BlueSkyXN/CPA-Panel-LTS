#!/usr/bin/env python3
"""配额分组可见性的 mock-Core 浏览器回归；先构建 dist，不连接真实账号。"""

from panel_browser import PanelBrowser
import importlib.util
import json
from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_smoke", ROOT / "scripts/smoke-lts-panel.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def main():
    app_port, api_port = smoke.find_free_port(), smoke.find_free_port()
    state = smoke.MockCoreState()
    files = smoke.build_auth_files_payload()["files"]
    files.extend([
        {"name": "disabled-claude.json", "type": "claude", "disabled": True},
        {"name": "runtime-gemini.json", "type": "gemini-cli", "runtime_only": True},
    ])

    def auth_files(route):
        route.fulfill(
            status=200, content_type="application/json", body=json.dumps({"files": files}),
            headers={"Access-Control-Allow-Origin": "*"},
        )

    with smoke.run_server(smoke.StaticPanelHandler, app_port), smoke.run_server(smoke.MockCoreHandler, api_port, state):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(locale="en-US", viewport={"width": 1440, "height": 1000})
            context.add_init_script("localStorage.setItem('cli-proxy-language', JSON.stringify({state:{language:'en'},version:0}));")
            page = PanelBrowser(context.new_page())
            page.set_default_timeout(10000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.route("**/v0/management/auth-files", auth_files)
            base = f"http://127.0.0.1:{app_port}/management.html"
            page.goto(base + "#/login")
            page.locator('input[type="checkbox"]').first.check(force=True)
            page.locator("input.input").first.fill(f"http://127.0.0.1:{api_port}")
            page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
            page.get_by_role("button", name=re.compile("Login|Connect", re.I)).click()
            page.wait_for_function("window.location.hash === '#/'")
            page.goto(base + "#/quota")

            sections = page.locator(".card:visible > .card-header > .title")
            expect(sections.filter(has_text="Codex")).to_have_count(1)
            expect(sections, "Only Codex and xAI have eligible auth files").to_have_count(2)
            expect(sections.filter(has_text="Grok")).to_have_count(1)

            tabs = page.get_by_role("group", name="All", exact=True)
            tabs.get_by_role("button", name=re.compile(r"^Codex")).click()
            expect(sections).to_have_count(1)
            expect(sections).to_contain_text("Codex")
            tabs.get_by_role("button", name=re.compile(r"^Claude")).click()
            expect(sections).to_have_count(0)
            tabs.get_by_role("button", name=re.compile(r"^All")).click()
            expect(sections).to_have_count(2)

            output = ROOT / "output/playwright"
            output.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(output / "quota-visibility-desktop.png"), full_page=True, animations="disabled")
            page.set_viewport_size({"width": 390, "height": 844})
            expect(sections).to_have_count(2)
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
            page.screenshot(path=str(output / "quota-visibility-mobile.png"), full_page=True, animations="disabled")
            page.set_viewport_size({"width": 1440, "height": 1000})

            files.clear()
            page.get_by_role("button", name="Refresh all credentials", exact=True).first.click()
            expect(sections).to_have_count(0)
            files.append({"name": "kimi-fixture.json", "type": "kimi", "disabled": False})
            page.goto(base + "#/")
            page.goto(base + "#/quota")
            expect(sections).to_have_count(1)
            expect(sections).to_contain_text("Kimi")

            page.goto(base + "#/quota?provider=claude")
            expect(tabs.get_by_role("button", name=re.compile(r"^Claude"))).to_have_attribute("aria-pressed", "true")
            expect(sections).to_have_count(0)
            assert not errors, "Browser reported JavaScript errors"
            browser.close()

    print("PASS: populated-only quota sections, provider filters/deep links, disabled/runtime-only exclusions, empty/refresh, desktop/mobile (mock Core)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Regression for the Coding Plan local-credentials help interactions.

Mounts the real components (Modal + Select + CodingPlanLocalCredentialsHelp
+ i18n) via the Vite dev server and covers: Esc closes the region dropdown
before the modal, second Esc closes the modal, collapse/expand, region
switching, copy success/failure, reopen, and that Select keys never submit
the surrounding form. Synthetic data only; no backend, no real credentials.
"""
import re
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

PORT = 5997
COPY_SUCCESS = "Command copied. Run it in your Mac terminal."
COPY_FAILED = "Copy failed. Select and copy the command above manually."


def wait_for_server(timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/scripts/credentials-help-fixture.html", timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main():
    vite = subprocess.Popen(
        ["npx", "vite", "--host", "127.0.0.1", "--port", str(PORT), "--strictPort"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        if not wait_for_server():
            vite.terminate()
            print(vite.communicate(timeout=5)[0][-1500:])
            print("FAIL: vite dev server did not become ready")
            return 2
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(locale="en-US", viewport={"width": 1440, "height": 1000})
            context.grant_permissions(["clipboard-read", "clipboard-write"])
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{PORT}/scripts/credentials-help-fixture.html")

            summary = page.get_by_text("Get credentials from local ZCode (macOS)")
            summary.wait_for()
            details = page.locator("details")
            details_open = lambda: details.evaluate("d => d.open")

            # Collapse / expand
            initially_open = details_open()
            summary.click()
            page.wait_for_timeout(150)
            collapsed = not details_open()
            summary.click()
            page.wait_for_timeout(150)
            expanded_again = details_open()

            # Region switching changes the rendered command
            page.get_by_label("API key", exact=True).fill("synthetic-unsaved-key")
            region = page.get_by_role("button", name="Local ZCode account region")
            code_text = lambda: page.locator("code").first.inner_text()
            region.click()
            page.get_by_role("option", name="International · z.ai", exact=True).click()
            page.wait_for_timeout(150)
            zai_command = "builtin:zai-coding-plan" in code_text()
            region.click()
            page.get_by_role("option", name="China · bigmodel", exact=True).click()
            page.wait_for_timeout(150)
            bigmodel_command = "builtin:bigmodel-coding-plan" in code_text()

            # Copy success
            page.get_by_role("button", name=re.compile(r"^Copy extraction command")).first.click()
            page.get_by_text(COPY_SUCCESS, exact=True).wait_for()
            copied_text = page.evaluate("navigator.clipboard.readText()")
            copy_ok = copied_text == code_text()

            # Copy failure (both clipboard API and execCommand fallback denied)
            page.evaluate("""() => {
                Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('denied')) });
                document.execCommand = () => false;
            }""")
            page.get_by_role("button", name=re.compile(r"^Copy extraction command")).first.click()
            page.get_by_text(COPY_FAILED, exact=True).wait_for()

            # Enter inside the Select must not submit the surrounding form
            region.click()
            page.keyboard.press("Enter")
            page.wait_for_timeout(150)
            enter_submit_count = page.evaluate("window.__credentialsHelpFixtureState().submitCount")

            # First Esc closes only the dropdown and keeps the typed value
            region.click()
            option = page.get_by_role("option", name="China · bigmodel", exact=True)
            option.wait_for()
            page.keyboard.press("Escape")
            page.wait_for_timeout(450)
            first = page.evaluate("window.__credentialsHelpFixtureState()")
            dropdown_closed = not option.is_visible()

            # Second Esc closes the modal (original behaviour preserved)
            page.keyboard.press("Escape")
            page.wait_for_timeout(450)
            second = page.evaluate("window.__credentialsHelpFixtureState()")

            # Reopen yields a fresh modal
            page.get_by_role("button", name="Reopen modal").click()
            page.get_by_role("button", name="Local ZCode account region").wait_for()
            reopened = page.evaluate("window.__credentialsHelpFixtureState()")

            print(f"RESULT initially_open={initially_open} collapsed={collapsed} expanded_again={expanded_again} "
                  f"zai_command={zai_command} bigmodel_command={bigmodel_command} copy_ok={copy_ok} "
                  f"enter_submit_count={enter_submit_count} "
                  f"first_esc_modal_open={first['modalOpen']} first_esc_dropdown_closed={dropdown_closed} "
                  f"first_esc_api_key={first['apiKey']!r} second_esc_modal_open={second['modalOpen']} "
                  f"reopen_count={reopened['reopenCount']} reopened_modal_open={reopened['modalOpen']} "
                  f"reopened_api_key={reopened['apiKey']!r}")
            browser.close()
            if errors:
                print("page-errors:", errors)
                return 1
            ok = (
                initially_open and collapsed and expanded_again
                and zai_command and bigmodel_command and copy_ok
                and enter_submit_count == 0
                and first["modalOpen"] and dropdown_closed and first["apiKey"] == "synthetic-unsaved-key"
                and not second["modalOpen"]
                and reopened["reopenCount"] == 1 and reopened["modalOpen"] and reopened["apiKey"] == ""
            )
            return 0 if ok else 1
    finally:
        vite.terminate()
        try:
            vite.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            vite.kill()
            vite.communicate()


if __name__ == "__main__":
    sys.exit(main())

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SCRIPT = Path(__file__).with_name("codex-quota-monitor.py")
SPEC = importlib.util.spec_from_file_location("codex_quota_monitor", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load {SCRIPT}")
monitor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = monitor
SPEC.loader.exec_module(monitor)


class Handler(BaseHTTPRequestHandler):
    key = "test-management-key"
    upstream_status = 200
    calls: list[dict] = []

    def log_message(self, _format: str, *_args: object) -> None:
        pass

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        return self.headers.get("Authorization") == f"Bearer {self.key}"

    def do_GET(self) -> None:
        if not self.authorized():
            self.send_json(401, {"error": "invalid management key"})
            return
        self.send_json(
            200,
            {
                "files": [
                    {
                        "name": "active-codex.json",
                        "provider": "codex",
                        "auth_index": "codex-index-1",
                        "id_token": {"chatgpt_account_id": "account-1"},
                    },
                    {
                        "name": "disabled-codex.json",
                        "provider": "codex",
                        "auth_index": "codex-index-2",
                        "disabled": True,
                    },
                ]
            },
        )

    def do_POST(self) -> None:
        if not self.authorized():
            self.send_json(401, {"error": "invalid management key"})
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).calls.append(payload)
        usage = {
            "plan_type": "plus",
            "rate_limit": {
                "allowed": True,
                "limit_reached": False,
                "primary_window": {
                    "used_percent": 25,
                    "limit_window_seconds": 18000,
                    "reset_at": 1_800_000_000,
                },
                "secondary_window": {
                    "used_percent": 40,
                    "limit_window_seconds": 604800,
                    "reset_after_seconds": 3600,
                },
            },
        }
        self.send_json(
            200,
            {
                "status_code": type(self).upstream_status,
                "header": {},
                "body": json.dumps(usage if type(self).upstream_status == 200 else {}),
            },
        )


class Server:
    def __enter__(self) -> "Server":
        Handler.calls = []
        Handler.upstream_status = 200
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.httpd.server_address
        self.url = f"http://{host}:{port}"
        return self

    def __exit__(self, *_args: object) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)


class MonitorTest(unittest.TestCase):
    def test_success_and_literal_token_placeholder(self) -> None:
        with Server() as server, contextlib.redirect_stdout(io.StringIO()) as output:
            code = monitor.main(
                [
                    "--core-url",
                    server.url,
                    "--management-key",
                    Handler.key,
                    "--delay-seconds",
                    "0",
                    "--json",
                ],
                {},
            )

        self.assertEqual(code, monitor.EXIT_OK)
        report = json.loads(output.getvalue())
        self.assertEqual(report["credential_count"], 1)
        windows = report["credentials"][0]["limits"][0]["windows"]
        self.assertEqual(windows[0]["remaining_percent"], 75.0)
        self.assertEqual(windows[1]["name"], "weekly")
        self.assertEqual(Handler.calls[0]["header"]["Authorization"], "Bearer $TOKEN$")
        self.assertEqual(Handler.calls[0]["header"]["Chatgpt-Account-Id"], "account-1")

    def test_environment_key(self) -> None:
        with Server() as server, contextlib.redirect_stdout(io.StringIO()):
            code = monitor.main(
                ["--core-url", server.url, "--delay-seconds", "0", "--json"],
                {"CPA_MANAGEMENT_KEY": Handler.key},
            )
        self.assertEqual(code, monitor.EXIT_OK)

    def test_upstream_failure_returns_one_without_body(self) -> None:
        with Server() as server:
            Handler.upstream_status = 401
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = monitor.main(
                    [
                        "--core-url",
                        server.url,
                        "--management-key",
                        Handler.key,
                        "--delay-seconds",
                        "0",
                        "--json",
                    ],
                    {},
                )
        self.assertEqual(code, monitor.EXIT_QUERY_FAILED)
        report = json.loads(output.getvalue())
        self.assertEqual(report["errors"][0]["message"], "ChatGPT quota 接口返回 HTTP 401")

    def test_invalid_management_key_returns_two(self) -> None:
        with Server() as server, contextlib.redirect_stderr(io.StringIO()) as error:
            code = monitor.main(
                ["--core-url", server.url, "--management-key", "wrong-key"],
                {},
            )
        self.assertEqual(code, monitor.EXIT_CONFIGURATION_ERROR)
        self.assertIn("HTTP 401", error.getvalue())


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Browser smoke for the LTS panel build with a local mock Core API.

The script intentionally uses Python Playwright as an optional local tool instead
of adding a new npm dependency. Run it through `npm run smoke:lts`, which builds
the single-file dist first.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import mimetypes
import os
import re
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
INDEX_HTML = DIST / "index.html"


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class StaticPanelHandler(BaseHTTPRequestHandler):
    server_version = "LTSPanelSmokeStatic/1.0"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        raw_path = unquote(parsed.path)
        if raw_path in {"", "/", "/index.html", "/management.html"}:
            self._serve_file(INDEX_HTML, "text/html; charset=utf-8")
            return

        candidate = (DIST / raw_path.lstrip("/")).resolve()
        if DIST in candidate.parents and candidate.is_file():
            content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            self._serve_file(candidate, content_type)
            return

        self._serve_file(INDEX_HTML, "text/html; charset=utf-8")

    def _serve_file(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class MockCoreState:
    def __init__(self) -> None:
        self.requests: list[str] = []
        self.request_bodies: dict[str, list[str]] = {}
        self.config_yaml = build_config_yaml()
        self.config_yaml_puts: list[str] = []
        self.runtime_kind = "cpa"

    def record(self, method: str, path: str, query: str = "") -> None:
        suffix = f"?{query}" if query else ""
        self.requests.append(f"{method} {path}{suffix}")

    def record_body(self, method: str, path: str, body: str) -> None:
        key = f"{method} {path}"
        self.request_bodies.setdefault(key, []).append(body)

    def save_config_yaml(self, content: str) -> None:
        self.config_yaml = content
        self.config_yaml_puts.append(content)


def build_recent_buckets() -> list[dict[str, Any]]:
    return [
        {"time": "2026-06-16T00:00:00Z", "success": 2, "failed": 0},
        {"time": "2026-06-16T00:10:00Z", "success": 1, "failed": 1},
    ]


def build_config_payload() -> dict[str, Any]:
    return {
        "debug": False,
        "usage-statistics-enabled": True,
        "request-log": True,
        "logging-to-file": True,
        "transient-error-cooldown-seconds": 30,
        "routing": {"strategy": "round-robin"},
        "api-keys": ["mgmt-key-1"],
        "gemini-api-key": [
            {
                "api-key": "gemini-key-1",
                "base-url": "https://generativelanguage.googleapis.com",
                "models": [{"name": "gemini-2.5-flash"}],
            }
        ],
        "codex-api-key": [
            {
                "api-key": "codex-key-1",
                "base-url": "https://api.openai.com",
                "websockets": True,
                "models": [{"name": "gpt-5"}],
            }
        ],
        "claude-api-key": [
            {
                "api-key": "claude-key-1",
                "base-url": "https://api.anthropic.com",
                "models": [{"name": "claude-sonnet-4"}],
            }
        ],
        "vertex-api-key": [
            {
                "api-key": "vertex-key-1",
                "base-url": "https://vertex.example.test",
                "models": [{"name": "vertex-model", "alias": "vertex-alias"}],
            }
        ],
        "openai-compatibility": [
            {
                "name": "OpenRouter",
                "base-url": "https://openrouter.ai/api/v1",
                "x-lts-unknown-provider": {"preserve": "provider"},
                "api-key-entries": [
                    {
                        "api-key": "openai-key-1",
                        "auth-index": "openrouter-a",
                        "x-lts-entry-note": "keep-entry-a",
                    },
                    {
                        "api-key": "openai-key-2",
                        "auth-index": "openrouter-b",
                        "proxy-url": "http://127.0.0.1:7890",
                        "x-lts-entry-note": "keep-entry-b",
                    },
                ],
                "models": [
                    {
                        "name": "openai/mock-model",
                        "alias": "mock-model",
                        "test-model": "mock-model",
                        "x-lts-model-note": "keep-model",
                    }
                ],
            }
        ],
        "ampcode": {
            "upstream-url": "https://amp.example.test",
            "upstream-api-key": "sk-amp-smoke",
            "force-model-mappings": True,
            "model-mappings": [{"from": "amp-default", "to": "amp-lts"}],
            "upstream-api-keys": [
                {"upstream-api-key": "sk-amp-route", "api-keys": ["client-a"]}
            ],
        },
        "plugins": {
            "enabled": True,
            "store-sources": [
                {
                    "id": "official",
                    "name": "official",
                    "url": "https://github.com/router-for-me/plugin-store",
                }
            ],
        },
    }


def build_usage_payload() -> dict[str, Any]:
    # The full usage parser tolerates multiple shapes; this keeps the payload
    # intentionally small while proving the page reaches /usage.
    return {
        "usage": {
            "requests": [
                {
                    "time": "2026-06-16T00:00:00Z",
                    "model": "gpt-5",
                    "api": "codex",
                    "api_key": "codex-key-1",
                    "success": True,
                    "input_tokens": 12,
                    "output_tokens": 8,
                }
            ]
        }
    }


def build_api_key_usage_payload() -> dict[str, Any]:
    buckets = build_recent_buckets()
    return {
        "https://api.openai.com|codex-key-1": {
            "codex-key-1": {
                "success": 3,
                "failed": 1,
                "recent_requests": buckets,
            }
        },
        "https://openrouter.ai/api/v1|openai-key-1": {
            "openrouter-a": {
                "success": 2,
                "failed": 0,
                "recent_requests": buckets,
            }
        },
        "https://openrouter.ai/api/v1|openai-key-2": {
            "openrouter-b": {
                "success": 1,
                "failed": 0,
                "recent_requests": buckets,
            }
        },
    }


def build_auth_files_payload() -> dict[str, Any]:
    return {
        "files": [
            {
                "name": "codex-smoke.json",
                "type": "codex",
                "provider": "codex",
                "source": "file",
                "path": "/tmp/codex-smoke.json",
                "auth_index": "codex-smoke-auth",
                "email": "codex-smoke@example.test",
                "runtime_only": False,
                "disabled": False,
                "modtime": 1781517600,
                "id_token": {
                    "chatgpt_account_id": "acct-smoke",
                    "plan_type": "plus",
                    "email": "codex-smoke@example.test",
                },
            },
            {
                "name": "xai-smoke.json",
                "type": "xai",
                "provider": "xai",
                "source": "file",
                "path": "/tmp/xai-smoke.json",
                "auth_index": "xai-smoke-auth",
                "email": "xai-smoke@example.test",
                "runtime_only": False,
                "disabled": False,
                "modtime": 1781517600,
            },
        ]
    }


def build_config_yaml() -> str:
    return """debug: false
usage-statistics-enabled: true
request-log: true
logging-to-file: true
transient-error-cooldown-seconds: 30
unmanaged-lts-smoke: keep-me
routing:
  strategy: round-robin
api-keys:
  - mgmt-key-1
plugins:
  enabled: true
  store-sources:
    - id: official
      name: official
      url: https://github.com/router-for-me/plugin-store
ampcode:
  upstream-url: https://amp.example.test
  upstream-api-key: sk-amp-smoke
  force-model-mappings: true
"""


def build_plugin_list_payload() -> dict[str, Any]:
    return {
        "plugins_enabled": True,
        "plugins_dir": "plugins",
        "plugins": [
            {
                "id": "mock-plugin",
                "path": "plugins/mock-plugin",
                "configured": True,
                "registered": True,
                "enabled": True,
                "effective_enabled": True,
                "metadata": {
                    "name": "Mock Resource Plugin",
                    "version": "0.1.0",
                    "author": "LTS smoke",
                    "github_repository": "router-for-me/mock-plugin",
                    "logo": "",
                    "config_fields": [],
                },
                "menus": [
                    {
                        "path": "/plugin/mock-resource.html",
                        "menu": "Mock Resource",
                        "description": "Mock plugin resource page",
                    }
                ],
            }
        ],
    }


def build_plugin_store_payload() -> dict[str, Any]:
    return {
        "plugins_enabled": True,
        "plugins_dir": "plugins",
        "sources": [
            {
                "id": "official",
                "name": "official",
                "url": "https://github.com/router-for-me/plugin-store",
            }
        ],
        "plugins": [
            {
                "source_id": "official",
                "source_name": "official",
                "source_url": "https://github.com/router-for-me/plugin-store",
                "id": "mock-plugin",
                "name": "Mock Resource Plugin",
                "description": "Plugin from the mock official store",
                "author": "LTS smoke",
                "version": "0.1.0",
                "repository": "router-for-me/mock-plugin",
                "tags": ["smoke"],
                "installed": True,
                "enabled": True,
                "effective_enabled": True,
            }
        ],
    }


def build_codex_quota_usage_payload() -> dict[str, Any]:
    return {
        "user_id": "user-smoke",
        "account_id": "acct-smoke",
        "email": "codex-smoke@example.test",
        "plan_type": "plus",
        "rate_limit": {
            "allowed": True,
            "limit_reached": False,
            "primary_window": {
                "used_percent": 25,
                "limit_window_seconds": 18_000,
                "reset_after_seconds": 7_200,
                "reset_at": 1_781_524_800,
            },
            "secondary_window": {
                "used_percent": 42,
                "limit_window_seconds": 604_800,
                "reset_after_seconds": 259_200,
                "reset_at": 1_781_776_000,
            },
        },
        "code_review_rate_limit": {
            "allowed": True,
            "limit_reached": False,
            "primary_window": {
                "used_percent": 12,
                "limit_window_seconds": 18_000,
                "reset_after_seconds": 7_200,
                "reset_at": 1_781_524_800,
            },
            "secondary_window": {
                "used_percent": 18,
                "limit_window_seconds": 604_800,
                "reset_after_seconds": 259_200,
                "reset_at": 1_781_776_000,
            },
        },
        "rate_limit_reset_credits": {
            "available_count": 2,
            "credits": [
                {
                    "id": "RateLimitResetCredit_smoke",
                    "reset_type": "codex_rate_limits",
                    "status": "available",
                    "title": "Smoke reset credit",
                    "description": "Codex reset credit smoke fixture",
                    "granted_at": "2026-06-18T00:32:23.324671Z",
                    "expires_at": "2026-07-18T00:32:23.324671Z",
                    "redeem_started_at": None,
                    "redeemed_at": None,
                    "profile_user_id": "user-smoke",
                }
            ],
        },
    }


def build_codex_daily_usage_payload() -> dict[str, Any]:
    return {
        "data": [
            {
                "date": "2026-06-16",
                "totals": {
                    "credits": 3.25,
                    "threads": 2,
                    "turns": 7,
                    "users": 1,
                    "cached_text_input_tokens": 1000,
                    "uncached_text_input_tokens": 2000,
                    "text_output_tokens": 500,
                },
                "clients": [
                    {
                        "client_id": "codex-cli",
                        "credits": 3.25,
                        "threads": 2,
                        "turns": 7,
                        "cached_text_input_tokens": 1000,
                        "uncached_text_input_tokens": 2000,
                        "text_output_tokens": 500,
                    }
                ],
            }
        ]
    }


def build_codex_remote_cloud_connect_environments_payload() -> dict[str, Any]:
    return {
        "items": [
            {
                "env_id": "env-smoke-online",
                "kind": "desktop",
                "display_name": "Smoke MacBook",
                "host_name": "smoke-host-a",
                "online": True,
                "busy": False,
                "os": "macOS",
                "os_version": "16.0",
                "arch": "arm64",
                "app_server_version": "26.513.20950",
                "installation_id": "install-smoke-a",
                "client_type": "desktop",
                "originator": "Codex Desktop",
                "terminal": "zsh",
                "client_name": "Codex",
                "client_version": "26.513.20950",
                "last_seen_at": "2026-06-17T02:30:00Z",
            },
            {
                "env_id": "env-smoke-stale",
                "kind": "desktop",
                "display_name": "Smoke Old Host",
                "host_name": "smoke-host-b",
                "online": False,
                "busy": False,
                "os": "macOS",
                "arch": "arm64",
            },
        ],
        "cursor": None,
    }


def build_xai_billing_payload() -> dict[str, Any]:
    return {
        "config": {
            "monthlyLimit": {"val": 5000},
            "used": {"val": 1200},
            "onDemandCap": {"val": 2500},
            "billingPeriodStart": "2026-06-01T00:00:00Z",
            "billingPeriodEnd": "2026-07-01T00:00:00Z",
        }
    }


def build_openai_models_payload() -> dict[str, Any]:
    return {
        "data": [
            {"id": "openai/mock-model", "name": "openai/mock-model"},
            {"id": "openai/smoke-discovered", "name": "openai/smoke-discovered"},
        ]
    }


def build_home_logs_payload(offset: int, limit: int) -> dict[str, Any]:
    records = [
        {
            "id": 1,
            "timestamp": "2026-06-16T08:00:00Z",
            "request_id": "home-req-smoke",
            "home_ip": "10.99.0.7",
            "level": "info",
            "line": (
                "2026-06-16T08:00:00Z INFO request_id=home-req-smoke "
                "status=200 GET /home/db-smoke"
            ),
        },
        {
            "id": 2,
            "timestamp": "2026-06-16T08:00:01Z",
            "request_id": "home-req-next",
            "home_ip": "10.99.0.8",
            "level": "warn",
            "line": (
                "2026-06-16T08:00:01Z WARN request_id=home-req-next "
                "status=429 POST /home/db-smoke"
            ),
        },
    ]
    page_limit = max(limit, 1)
    start = max(offset, 0)
    return {
        "logs": records[start : start + page_limit],
        "total": len(records),
        "limit": page_limit,
        "offset": start,
    }


def build_api_call_result(body: Any, status_code: int = 200) -> dict[str, Any]:
    return {
        "status_code": status_code,
        "header": {},
        "body": body,
    }


class MockCoreHandler(BaseHTTPRequestHandler):
    server_version = "LTSPanelSmokeCore/1.0"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    @property
    def state(self) -> MockCoreState:
        return self.server.state  # type: ignore[attr-defined]

    def do_OPTIONS(self) -> None:
        self._send_empty(204)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        self.state.record("GET", path, parsed.query)

        routes: dict[str, Any] = {
            "/v0/management/config": build_config_payload(),
            "/v0/management/auth-files": build_auth_files_payload(),
            "/v0/management/usage": build_usage_payload(),
            "/v0/management/usage/export": {"version": 1, "usage": build_usage_payload()["usage"]},
            "/v0/management/api-key-usage": build_api_key_usage_payload(),
            "/v0/management/ampcode": {"ampcode": build_config_payload()["ampcode"]},
            "/v0/management/vertex-api-key": {
                "vertex-api-key": build_config_payload()["vertex-api-key"]
            },
            "/v0/management/openai-compatibility": {
                "openai-compatibility": build_config_payload()["openai-compatibility"]
            },
            "/v0/management/ampcode/upstream-api-keys": {
                "upstream-api-keys": build_config_payload()["ampcode"]["upstream-api-keys"]
            },
            "/v0/management/ampcode/model-mappings": {
                "model-mappings": build_config_payload()["ampcode"]["model-mappings"]
            },
            "/v0/management/oauth-excluded-models": {
                "oauth-excluded-models": {"codex": ["gpt-5-disabled"]}
            },
            "/v0/management/oauth-model-alias": {
                "oauth-model-alias": {"codex": [{"name": "gpt-5", "alias": "codex-gpt-5"}]}
            },
            "/v0/management/model-definitions/codex": {
                "models": [{"id": "gpt-5", "display_name": "GPT-5"}]
            },
            "/v0/management/plugins": build_plugin_list_payload(),
            "/v0/management/plugin-store": build_plugin_store_payload(),
            "/v0/management/logs": self._mock_logs_response(parsed.query),
            "/v0/management/request-error-logs": {
                "files": [
                    {
                        "name": "error-smoke.log",
                        "size": 48,
                        "modified": 1781517600,
                    }
                ]
            },
            "/v1/models": {"data": [{"id": "gpt-5"}, {"id": "mock-model"}]},
        }

        if path == "/plugin/mock-resource.html":
            self._send_bytes(
                b"<!doctype html><title>Mock Resource</title><main>Mock plugin resource loaded</main>",
                content_type="text/html; charset=utf-8",
            )
            return

        if path == "/v0/management/config.yaml":
            self._send_bytes(
                self.state.config_yaml.encode("utf-8"),
                content_type="application/yaml; charset=utf-8",
            )
            return

        if path == "/v0/management/nodes":
            self._send_json({"error": "not found"}, status=404)
            return

        if path == "/v0/management/request-error-logs/error-smoke.log":
            self._send_bytes(
                b"mock error log body request_id=req-error",
                content_type="text/plain; charset=utf-8",
            )
            return

        if path == "/v0/management/request-log-by-id/req-smoke":
            self._send_bytes(
                b"mock request log body request_id=req-smoke",
                content_type="text/plain; charset=utf-8",
            )
            return

        if path == "/v0/management/request-log-by-id/home-req-smoke":
            self._send_bytes(
                b"mock home request log body request_id=home-req-smoke home_ip=10.99.0.7",
                content_type="text/plain; charset=utf-8",
            )
            return

        if path in routes:
            self._send_json(routes[path])
            return

        if re.match(r"^/v0/management/plugins/[^/]+/config$", path):
            self._send_json({"enabled": True, "priority": 0})
            return

        self._send_json({"error": f"unhandled mock route: {path}"}, status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        self.state.record("POST", parsed.path, parsed.query)
        body = self._read_body_text()
        self.state.record_body("POST", parsed.path, body)
        if parsed.path == "/v0/management/api-call":
            self._send_json(self._mock_api_call_response(body))
            return
        self._send_json({"status": "ok"})

    def _mock_api_call_response(self, body: str) -> dict[str, Any]:
        try:
            payload = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            return build_api_call_result({"error": "invalid api-call payload"}, status_code=400)

        url = str(payload.get("url") or "")
        if "rate-limit-reset-credits/consume" in url:
            return build_api_call_result({"status": "ok"})
        if "daily-workspace-usage-counts" in url:
            return build_api_call_result(build_codex_daily_usage_payload())
        if "backend-api/codex/remote/control/environments" in url:
            return build_api_call_result(build_codex_remote_cloud_connect_environments_payload())
        if url == "https://chatgpt.com/backend-api/wham/usage":
            return build_api_call_result(build_codex_quota_usage_payload())
        if url == "https://cli-chat-proxy.grok.com/v1/billing":
            return build_api_call_result(build_xai_billing_payload())
        if url == "https://openrouter.ai/api/v1/models":
            return build_api_call_result(build_openai_models_payload())
        if url == "https://openrouter.ai/api/v1/chat/completions":
            return build_api_call_result(
                {
                    "id": "chatcmpl-smoke",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "ok"},
                            "finish_reason": "stop",
                        }
                    ],
                }
            )

        return build_api_call_result(
            {"error": f"unhandled mock api-call url: {url}"},
            status_code=404,
        )

    def _mock_logs_response(self, query: str) -> dict[str, Any]:
        if self.state.runtime_kind == "home":
            params = parse_qs(query)
            try:
                offset = int(params.get("offset", ["0"])[0] or "0")
            except ValueError:
                offset = 0
            try:
                requested_limit = int(params.get("limit", ["1"])[0] or "1")
            except ValueError:
                requested_limit = 1
            # Return small Home pages so the Panel must exercise offset pagination.
            return build_home_logs_payload(offset=offset, limit=min(requested_limit, 1))

        return {
            "lines": [
                "2026-06-16T00:00:00Z INFO request_id=req-smoke status=200 model=gpt-5"
            ],
            "line-count": 1,
            "latest-timestamp": 1781517600,
            "next-cursor": "cursor-smoke-1",
        }

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        self.state.record("PUT", parsed.path, parsed.query)
        body = self._read_body_text()
        self.state.record_body("PUT", parsed.path, body)
        if parsed.path == "/v0/management/config.yaml":
            self.state.save_config_yaml(body)
        self._send_json({"status": "ok"})

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        self.state.record("PATCH", parsed.path, parsed.query)
        body = self._read_body_text()
        self.state.record_body("PATCH", parsed.path, body)
        self._send_json({"status": "ok"})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        self.state.record("DELETE", parsed.path, parsed.query)
        self._send_json({"status": "ok"})

    def _send_empty(self, status: int) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.end_headers()

    def _send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._send_bytes(body, status=status, content_type="application/json; charset=utf-8")

    def _send_bytes(
        self,
        body: bytes,
        status: int = 200,
        content_type: str = "application/octet-stream",
    ) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "authorization,content-type")
        self.send_header(
            "Access-Control-Expose-Headers",
            (
                "x-cpa-version,x-cpa-build-date,x-cpa-home-version,"
                "x-cpa-home-build-date,x-cpa-support-plugin"
            ),
        )
        if self.state.runtime_kind == "home":
            self.send_header("x-cpa-home-version", "home-smoke")
            self.send_header("x-cpa-home-build-date", "2026-06-16T00:00:00Z")
        else:
            self.send_header("x-cpa-version", "6.9.49-smoke")
            self.send_header("x-cpa-build-date", "2026-06-16T00:00:00Z")
        self.send_header("x-cpa-support-plugin", "true")

    def _read_body_text(self) -> str:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError:
            length = 0
        if length <= 0:
            return ""
        return self.rfile.read(length).decode("utf-8")


@contextlib.contextmanager
def run_server(handler: type[BaseHTTPRequestHandler], port: int, state: MockCoreState | None = None):
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    if state is not None:
        server.state = state  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def assert_request_seen(state: MockCoreState, method: str, path: str) -> None:
    prefix = f"{method} {path}"
    if not any(entry == prefix or entry.startswith(f"{prefix}?") for entry in state.requests):
        raise AssertionError(f"Expected mock API request {prefix}; saw: {state.requests}")


def assert_request_not_seen(state: MockCoreState, method: str, path: str) -> None:
    prefix = f"{method} {path}"
    if any(entry == prefix or entry.startswith(f"{prefix}?") for entry in state.requests):
        raise AssertionError(f"Unexpected mock API request {prefix}; saw: {state.requests}")


def assert_request_seen_after(
    state: MockCoreState,
    after_method: str,
    after_path: str,
    method: str,
    path: str,
) -> None:
    after_prefix = f"{after_method} {after_path}"
    target_prefix = f"{method} {path}"
    try:
        after_index = next(
            index
            for index, entry in enumerate(state.requests)
            if entry == after_prefix or entry.startswith(f"{after_prefix}?")
        )
    except StopIteration as exc:
        raise AssertionError(f"Expected anchor request {after_prefix}; saw: {state.requests}") from exc

    if not any(
        entry == target_prefix or entry.startswith(f"{target_prefix}?")
        for entry in state.requests[after_index + 1 :]
    ):
        raise AssertionError(
            f"Expected mock API request {target_prefix} after {after_prefix}; "
            f"saw: {state.requests}"
        )


def request_count(state: MockCoreState, method: str, path: str) -> int:
    prefix = f"{method} {path}"
    return sum(
        1 for entry in state.requests if entry == prefix or entry.startswith(f"{prefix}?")
    )


def assert_request_count_at_least(
    state: MockCoreState,
    method: str,
    path: str,
    expected: int,
) -> None:
    count = request_count(state, method, path)
    if count < expected:
        raise AssertionError(
            f"Expected at least {expected} {method} {path} request(s); "
            f"saw {count}: {state.requests}"
        )


def assert_request_query_contains(
    state: MockCoreState,
    method: str,
    path: str,
    needle: str,
) -> None:
    prefix = f"{method} {path}?"
    if not any(entry.startswith(prefix) and needle in entry for entry in state.requests):
        raise AssertionError(
            f"Expected mock API request {method} {path} with query containing {needle!r}; "
            f"saw: {state.requests}"
        )


def parse_json_bodies(state: MockCoreState, method: str, path: str) -> list[Any]:
    key = f"{method} {path}"
    parsed: list[Any] = []
    for body in state.request_bodies.get(key, []):
        try:
            parsed.append(json.loads(body))
        except json.JSONDecodeError as exc:
            raise AssertionError(f"Expected JSON body for {key}, got:\n{body}") from exc
    return parsed


def json_contains_key(value: Any, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(json_contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(json_contains_key(item, key) for item in value)
    return False


def assert_payload_match(
    state: MockCoreState,
    method: str,
    path: str,
    predicate: Any,
    description: str,
) -> None:
    payloads = parse_json_bodies(state, method, path)
    if not any(predicate(payload) for payload in payloads):
        raise AssertionError(
            f"Expected {method} {path} payload matching {description}; "
            f"saw {payloads!r}"
        )


def assert_api_call_url_seen(state: MockCoreState, needle: str, description: str) -> None:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    if not any(
        isinstance(payload, dict) and needle in str(payload.get("url") or "")
        for payload in payloads
    ):
        raise AssertionError(
            f"Expected /api-call URL matching {description} ({needle!r}); "
            f"saw {payloads!r}"
        )


def assert_api_call_auth_seen(
    state: MockCoreState,
    url_needle: str,
    auth_index: str,
    description: str,
) -> None:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    if not any(
        isinstance(payload, dict)
        and url_needle in str(payload.get("url") or "")
        and payload.get("authIndex") == auth_index
        for payload in payloads
    ):
        raise AssertionError(
            f"Expected /api-call payload for {description} with authIndex={auth_index!r}; "
            f"saw {payloads!r}"
        )


def assert_provider_mutation_payloads(state: MockCoreState) -> None:
    assert_request_count_at_least(state, "PUT", "/v0/management/codex-api-key", 2)
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/codex-api-key",
        lambda payload: any(
            item.get("api-key") == "codex-smoke-new"
            and item.get("base-url") == "https://codex.new.example/v1"
            and item.get("websockets") is True
            for item in payload
            if isinstance(item, dict)
        ),
        "created Codex resource with websocket field preserved",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/codex-api-key",
        lambda payload: any(
            item.get("api-key") == "codex-key-1"
            and item.get("base-url") == "https://codex.updated.example/v1"
            for item in payload
            if isinstance(item, dict)
        ),
        "updated Codex resource keeping the original key via edit fallback",
    )
    assert_request_seen(state, "DELETE", "/v0/management/codex-api-key")
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "OpenRouter" and item.get("prefix") == "oa-smoke"
            for item in payload
            if isinstance(item, dict)
        ),
        "updated OpenAI Compatibility provider prefix",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "OpenRouter"
            and any(
                isinstance(model, dict) and model.get("name") == "openai/smoke-discovered"
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "saved OpenAI Compatibility discovered model",
    )
    for payload in parse_json_bodies(state, "PUT", "/v0/management/openai-compatibility"):
        if json_contains_key(payload, "auth-index") or json_contains_key(payload, "authIndex"):
            raise AssertionError(
                "OpenAI Compatibility PUT payload must not write response-only auth-index: "
                f"{payload!r}"
            )
        openrouter = next(
            (
                item
                for item in payload
                if isinstance(item, dict) and item.get("name") == "OpenRouter"
            ),
            None,
        )
        if not isinstance(openrouter, dict):
            continue
        if openrouter.get("x-lts-unknown-provider") != {"preserve": "provider"}:
            raise AssertionError(
                "OpenAI Compatibility PUT payload dropped provider unknown fields: "
                f"{payload!r}"
            )
        entries = [
            entry
            for entry in openrouter.get("api-key-entries", [])
            if isinstance(entry, dict)
        ]
        if not any(
            entry.get("api-key") == "openai-key-1"
            and entry.get("x-lts-entry-note") == "keep-entry-a"
            for entry in entries
        ):
            raise AssertionError(
                "OpenAI Compatibility PUT payload dropped first api-key entry unknown field: "
                f"{payload!r}"
            )
        if not any(
            entry.get("api-key") == "openai-key-2"
            and entry.get("x-lts-entry-note") == "keep-entry-b"
            for entry in entries
        ):
            raise AssertionError(
                "OpenAI Compatibility PUT payload dropped second api-key entry unknown field: "
                f"{payload!r}"
            )
        models = [
            model
            for model in openrouter.get("models", [])
            if isinstance(model, dict)
        ]
        if not any(
            model.get("name") == "openai/mock-model"
            and model.get("x-lts-model-note") == "keep-model"
            for model in models
        ):
            raise AssertionError(
                "OpenAI Compatibility PUT payload dropped model unknown field: "
                f"{payload!r}"
            )


def assert_config_yaml_roundtrip(state: MockCoreState) -> None:
    if len(state.config_yaml_puts) < 2:
        raise AssertionError(
            "Expected source and visual config.yaml saves; "
            f"saw {len(state.config_yaml_puts)} PUT payload(s)."
        )

    source_payload = state.config_yaml_puts[0]
    visual_payload = state.config_yaml_puts[-1]
    for marker in [
        "source-smoke-marker: saved",
        "unmanaged-lts-smoke: keep-me",
        "store-sources:",
        "https://github.com/router-for-me/plugin-store",
    ]:
        if marker not in visual_payload:
            raise AssertionError(f"Visual config save dropped marker {marker!r}:\n{visual_payload}")

    if "debug: true" not in source_payload:
        raise AssertionError(f"Source config save did not persist edited debug flag:\n{source_payload}")
    if "logging-to-file: false" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist the logging-to-file toggle:\n"
            f"{visual_payload}"
        )
    if "transient-error-cooldown-seconds: -1" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist transient-error-cooldown-seconds:\n"
            f"{visual_payload}"
        )
    if "action: retry" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry action:\n"
            f"{visual_payload}"
        )
    if "exhausted-behavior: pass-through" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry exhausted-behavior:\n"
            f"{visual_payload}"
        )
    if "client-usage-aggregation: sum-with-delivered-total" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry client-usage-aggregation:\n"
            f"{visual_payload}"
        )
    if "delivery-policy: max-output" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry delivery-policy:\n"
            f"{visual_payload}"
        )
    if "fallback-policy: max-output-special" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry fallback-policy:\n"
            f"{visual_payload}"
        )
    if "stream-buffer-max-bytes: 4096" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry stream-buffer-max-bytes:\n"
            f"{visual_payload}"
        )
    if not re.search(
        r"hedged-retry:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+enabled: true",
        visual_payload,
    ):
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry hedged-retry.enabled:\n"
            f"{visual_payload}"
        )
    if not re.search(
        r"hedged-retry:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+mode: speed",
        visual_payload,
    ):
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry hedged-retry.mode:\n"
            f"{visual_payload}"
        )
    if "hedge-delay-ms: 250" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry hedge-delay-ms:\n"
            f"{visual_payload}"
        )
    if "require-distinct-auth: true" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist codex abnormal retry require-distinct-auth:\n"
            f"{visual_payload}"
        )


def run_logs_runtime_smoke(page: Any, app_url: str) -> None:
    page.goto(f"{app_url}?route=logs-runtime#/logs", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/logs')")
    page.get_by_text("Logs Viewer", exact=False).first.wait_for()
    page.get_by_text("req-smoke", exact=False).first.wait_for()

    page.get_by_role("button", name="Full Screen").click()
    page.get_by_role("button", name="Exit Full Screen").wait_for()
    page.get_by_role("button", name="Exit Full Screen").click()
    page.get_by_role("button", name="Full Screen").wait_for()

    request_id_badge = page.get_by_text("req-smoke", exact=True).first
    request_id_badge.wait_for()
    box = request_id_badge.bounding_box()
    if not box:
        raise AssertionError("Could not locate request id badge for long-press smoke")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(750)
    page.mouse.up()
    request_dialog = page.get_by_role("dialog", name="Download Request Log")
    request_dialog.get_by_text("req-smoke", exact=False).wait_for()
    with page.expect_download() as request_download:
        request_dialog.get_by_role("button", name="Confirm").click()
    if request_download.value.suggested_filename != "request-req-smoke.log":
        raise AssertionError(
            "Unexpected request log download filename: "
            f"{request_download.value.suggested_filename}"
        )

    page.get_by_role("button", name="Error Request Logs").click()
    page.get_by_text("error-smoke.log", exact=False).first.wait_for()
    error_row = page.locator(".item-row").filter(has_text="error-smoke.log").first
    error_row.get_by_role("button", name="Open").click()
    error_dialog = page.get_by_role("dialog", name="error-smoke.log")
    error_dialog.get_by_text("mock error log body", exact=False).wait_for()
    error_dialog.get_by_role("button", name="Copy").click()
    page.wait_for_function(
        "() => window.__ltsSmokeClipboard?.includes('mock error log body request_id=req-error')"
    )
    with page.expect_download() as error_download:
        error_dialog.get_by_role("button", name="Download").click()
    if error_download.value.suggested_filename != "error-smoke.log":
        raise AssertionError(
            "Unexpected error log download filename: "
            f"{error_download.value.suggested_filename}"
        )
    error_dialog.get_by_role("button", name="Close").nth(1).click()


def run_home_logs_runtime_smoke(page: Any, app_url: str, state: MockCoreState) -> None:
    state.runtime_kind = "home"
    try:
        page.goto(f"{app_url}?route=home-logs-runtime#/logs", wait_until="domcontentloaded")
        page.wait_for_function("() => window.location.hash.endsWith('/logs')")
        page.get_by_text("Logs Viewer", exact=False).first.wait_for()
        page.get_by_text("Current runtime: Home", exact=False).first.wait_for()
        page.get_by_text("home-req-smoke", exact=False).first.wait_for()
        page.get_by_text("home-req-next", exact=False).first.wait_for()
        page.get_by_text("GET", exact=True).first.wait_for()
        page.get_by_text("POST", exact=True).first.wait_for()

        clear_button = page.get_by_role("button", name="Clear Logs")
        clear_button.wait_for()
        if not clear_button.is_disabled():
            raise AssertionError("Home logs clear button should be disabled")

        request_id_badge = page.get_by_text("home-req-smoke", exact=True).first
        box = request_id_badge.bounding_box()
        if not box:
            raise AssertionError("Could not locate Home request id badge for long-press smoke")
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.wait_for_timeout(750)
        page.mouse.up()
        request_dialog = page.get_by_role("dialog", name="Download Request Log")
        request_dialog.get_by_text("home-req-smoke", exact=False).wait_for()
        with page.expect_download() as request_download:
            request_dialog.get_by_role("button", name="Confirm").click()
        if request_download.value.suggested_filename != "request-home-req-smoke.log":
            raise AssertionError(
                "Unexpected Home request log download filename: "
                f"{request_download.value.suggested_filename}"
            )

        page.get_by_role("button", name="Error Request Logs").click()
        page.get_by_text("In Home mode", exact=False).first.wait_for()
        page.get_by_text("No error request log files found", exact=False).first.wait_for()
    finally:
        state.runtime_kind = "cpa"


def run_quota_runtime_smoke(page: Any, app_url: str) -> None:
    page.goto(f"{app_url}?route=quota-runtime#/quota", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/quota')")
    page.get_by_text("Quota Management", exact=False).first.wait_for()

    codex_card = page.get_by_text("codex-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    codex_card.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "POST"
        and response.url.endswith("/v0/management/api-call")
    ):
        codex_card.get_by_role("button", name="Click here to refresh quota").click()
    codex_card.get_by_text("Plus", exact=True).wait_for()
    codex_card.get_by_text("Manual resets", exact=False).wait_for()
    codex_card.get_by_text("2", exact=True).first.wait_for()
    codex_card.get_by_text("Reset expires", exact=False).wait_for()
    codex_card.get_by_role("button", name="Details").click()
    reset_details = page.get_by_role("dialog", name="Manual reset details")
    reset_details.get_by_text("RateLimitResetCredit_smoke", exact=False).wait_for()
    reset_details.get_by_text("codex_rate_limits", exact=True).wait_for()
    reset_details.locator(".modal-footer").get_by_role("button", name="Close").click()
    codex_card.get_by_text("Est weekly 0.31 USD", exact=True).wait_for()

    # codexDetails analytics fold-out is LTS-isolated: its structure and the compound
    # `.codexDetails[open] .codexDetailsChevron` selector live in the codexQuota sidecar
    # module, while each page injects only the .codexDetailsSurface background. Verify the
    # fold-out renders (summary) and expands (details[open] + body), guarding the isolation.
    usage_details = codex_card.get_by_text("Usage details", exact=True)
    usage_details.wait_for()
    usage_details.click()
    codex_card.locator("details[open]").first.wait_for()
    codex_card.get_by_text("Deep Usage", exact=False).first.wait_for()

    codex_card.get_by_role("button", name="Details").click()
    reset_action_details = page.get_by_role("dialog", name="Manual reset details")
    reset_action_details.get_by_text("RateLimitResetCredit_smoke", exact=False).wait_for()
    reset_action_details.get_by_role("button", name="Reset quota").click()
    confirm = page.get_by_role("dialog", name="Reset Codex quota")
    confirm.get_by_text("codex-smoke.json", exact=False).wait_for()
    confirm.get_by_role("button", name="Continue").click()
    second_confirm = page.get_by_role("dialog", name="Confirm reset again")
    second_confirm.get_by_text("codex-smoke.json", exact=False).wait_for()
    with page.expect_response(
        lambda response: response.request.method == "POST"
        and response.url.endswith("/v0/management/api-call")
    ):
        second_confirm.get_by_role("button", name="Reset quota now").click()
    page.wait_for_function("() => document.querySelectorAll('[role=\"dialog\"]').length === 0")

    xai_card = page.get_by_text("xai-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    xai_card.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "POST"
        and response.url.endswith("/v0/management/api-call")
    ):
        xai_card.get_by_role("button", name="Click here to refresh quota").click()
    xai_card.get_by_text("Enabled, cap $25.00", exact=False).wait_for()
    xai_card.get_by_text("$12.00 / $50.00", exact=False).wait_for()


def run_remote_cloud_connect_runtime_smoke(page: Any, app_url: str) -> None:
    page.goto(
        f"{app_url}?route=remote-cloud-connect-runtime#/auth-files",
        wait_until="domcontentloaded",
    )
    page.wait_for_function("() => window.location.hash.endsWith('/auth-files')")
    page.get_by_text("Auth Files Management", exact=False).first.wait_for()

    codex_card = page.get_by_text("codex-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    codex_card.wait_for()
    action = codex_card.get_by_role("button", name="Codex Remote Cloud Connect Environments")
    action.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "POST"
        and response.url.endswith("/v0/management/api-call")
    ):
        action.click()

    dialog = page.get_by_role(
        "dialog",
        name="Codex Remote Cloud Connect Environments - codex-smoke.json",
    )
    dialog.wait_for()
    dialog_text = dialog.inner_text()
    for expected_text in [
        "2 connections · 2 hosts · 1 online · 0 cleanable",
        "Smoke MacBook",
        "smoke-host-a",
        "Smoke Old Host",
        "smoke-host-b",
        "Use caution",
    ]:
        if expected_text not in dialog_text:
            raise AssertionError(
                f"Remote cloud connect smoke missing modal text: {expected_text!r}"
            )

    body_text = page.locator("body").inner_text()
    for raw_key in [
        "auth_files.codex_remote_cloud_connect",
        "codex_remote_cloud_connect_environment_button",
        "codex_remote_cloud_connect_environment_title",
    ]:
        if raw_key in body_text:
            raise AssertionError(f"Remote cloud connect smoke leaked raw i18n key: {raw_key}")

    page.keyboard.press("Escape")
    page.wait_for_function("() => document.querySelectorAll('[role=\"dialog\"]').length === 0")


def run_browser_smoke(app_url: str, api_url: str, state: MockCoreState, headed: bool) -> None:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - environment guard
        raise RuntimeError(
            "Python Playwright is required. Install with: python3 -m pip install playwright && "
            "python3 -m playwright install chromium"
        ) from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed)
        context = browser.new_context(locale="en-US", accept_downloads=True)
        context.add_init_script(
            """
            localStorage.setItem(
              'cli-proxy-language',
              JSON.stringify({ state: { language: 'en' }, version: 0 })
            );
            window.__ltsSmokeClipboard = [];
            Object.defineProperty(navigator, 'clipboard', {
              configurable: true,
              value: {
                writeText: async (text) => {
                  window.__ltsSmokeClipboard.push(String(text));
                },
              },
            });
            """
        )
        page = context.new_page()
        page.set_default_timeout(15_000)

        try:
            def wait_for_no_dialog() -> None:
                page.wait_for_function(
                    "() => document.querySelectorAll('[role=\"dialog\"]').length === 0"
                )

            page.goto(f"{app_url}/#/login", wait_until="domcontentloaded")
            page.locator('input[name="cpa-management-key"]').wait_for()
            page.locator('input[type="checkbox"]').first.check(force=True)
            page.locator("input.input").first.fill(api_url)
            page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
            page.get_by_label("Remember password").check(force=True)
            if not page.get_by_label("Remember password").is_checked():
                raise AssertionError("Remember password checkbox did not become checked")
            page.get_by_role("button", name=re.compile("Login|Connect", re.I)).click()
            page.wait_for_url(re.compile(r".*/#/$"), timeout=20_000)

            route_checks = [
                ("/", "System Overview", None),
                ("/config", "Config Panel", None),
                ("/auth-files", "Auth Files Management", None),
                ("/oauth", "OAuth Login", None),
                ("/quota", "Quota Management", None),
                ("/usage", "Usage Statistics", None),
                ("/lts/usage", "Usage Statistics", "/usage"),
                ("/ai-providers", "AI Providers Configuration", None),
                ("/ai-providers/workbench", "AI Providers", None),
                ("/ai-providers/ampcode", "Configure Ampcode", None),
                ("/lts/ampcode", "Configure Ampcode", "/ai-providers/ampcode"),
                ("/plugins", "Mock Resource Plugin", None),
                ("/plugin-store", "Plugin Store", None),
                ("/plugin-pages/mock-plugin/0", "Mock", None),
                ("/logs", "Logs Viewer", None),
            ]

            for index, (route, expected_text, expected_hash) in enumerate(route_checks):
                page.goto(f"{app_url}?route={index}#{route}", wait_until="domcontentloaded")
                if expected_hash:
                    page.wait_for_function(
                        "(expected) => window.location.hash.endsWith(expected)",
                        arg=expected_hash,
                    )
                else:
                    page.wait_for_function(
                        "(route) => window.location.hash.endsWith(route)",
                        arg=route,
                    )
                page.get_by_text(expected_text, exact=False).first.wait_for()

            page.goto(f"{app_url}?route=dashboard#/", wait_until="domcontentloaded")
            page.wait_for_function("() => window.location.hash.endsWith('/')")
            page.get_by_text("A:1", exact=False).first.wait_for()

            page.goto(f"{app_url}?route=workbench-toggle#/ai-providers/workbench", wait_until="domcontentloaded")
            page.wait_for_function("() => window.location.hash.endsWith('/ai-providers/workbench')")
            page.get_by_text("AI Providers", exact=False).first.wait_for()
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/gemini-api-key")
            ):
                page.get_by_label("Disable").first.evaluate("(element) => element.click()")
            page.wait_for_timeout(500)

            page.get_by_role("button", name=re.compile(r"Codex", re.I)).click()
            page.get_by_role("heading", name="Codex").wait_for()
            page.get_by_role("button", name=re.compile(r"^New$", re.I)).first.click()
            sheet = page.get_by_role("dialog").last
            sheet.get_by_role("textbox", name="API key").fill("codex-smoke-new")
            sheet.get_by_label("Base URL").fill("https://codex.new.example/v1")
            sheet.get_by_label("Enable WebSockets").check()
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/codex-api-key")
            ):
                sheet.get_by_role("button", name="Create").click()
            wait_for_no_dialog()

            page.get_by_role("button", name="Edit").first.click()
            sheet = page.get_by_role("dialog").last
            sheet.get_by_label("Base URL").fill("https://codex.updated.example/v1")
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/codex-api-key")
            ):
                sheet.get_by_role("button", name="Save").click()
            wait_for_no_dialog()

            page.get_by_role("button", name="Delete").first.click()
            confirm = page.get_by_role("dialog", name="Delete resource")
            confirm.get_by_text("This action cannot be undone", exact=False).first.wait_for()
            with page.expect_response(
                lambda response: response.request.method == "DELETE"
                and "/v0/management/codex-api-key" in response.url
            ):
                confirm.get_by_role("button", name="Delete").click()
            wait_for_no_dialog()

            page.get_by_role("button", name=re.compile(r"OpenAI Compatible", re.I)).click()
            page.get_by_role("heading", name="OpenAI Compatible").wait_for()
            page.get_by_role("button", name="Edit").first.click()
            sheet = page.get_by_role("dialog").last

            sheet.get_by_text("API key entries", exact=True).click()
            key2_card = sheet.get_by_text("Key #2", exact=True).locator(
                "xpath=ancestor::div[contains(@class, 'entryCard')][1]"
            )
            key2_card.wait_for()
            with page.expect_response(
                lambda response: response.request.method == "POST"
                and response.url.endswith("/v0/management/api-call")
            ):
                key2_card.get_by_role("button", name="Test").click()
            with page.expect_response(
                lambda response: response.request.method == "POST"
                and response.url.endswith("/v0/management/api-call")
            ):
                sheet.get_by_role("button", name="Test all").click()
            page.wait_for_timeout(500)

            sheet.get_by_text("Custom models", exact=True).click()
            with page.expect_response(
                lambda response: response.request.method == "POST"
                and response.url.endswith("/v0/management/api-call")
            ):
                sheet.get_by_role("button", name="Fetch from endpoint").click()
            sheet.get_by_text("openai/smoke-discovered", exact=True).wait_for()
            sheet.get_by_text("openai/smoke-discovered", exact=True).click()
            sheet.get_by_role("button", name="Apply (1)").click()
            page.wait_for_function(
                """
                () => Array.from(document.querySelectorAll('input'))
                  .some((input) => input.value === 'openai/smoke-discovered')
                """
            )

            sheet.get_by_label("Prefix").fill("oa-smoke")
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/openai-compatibility")
            ):
                sheet.get_by_role("button", name="Save").click()
            wait_for_no_dialog()

            page.goto(f"{app_url}?route=config-source-save#/config", wait_until="domcontentloaded")
            page.wait_for_function("() => window.location.hash.endsWith('/config')")
            page.get_by_text("Config Panel", exact=False).first.wait_for()
            page.get_by_role("button", name="Source File Editor").click()
            editor = page.locator(".cm-content").first
            editor.wait_for()
            updated_yaml = build_config_yaml().replace("debug: false", "debug: true")
            updated_yaml = f"{updated_yaml.rstrip()}\nsource-smoke-marker: saved\n"
            editor.fill(updated_yaml)
            page.locator('button[aria-label="Save"]').click()
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/config.yaml")
            ):
                page.get_by_role("button", name="Confirm Save").click()
            page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()

            page.get_by_role("button", name="Visual Editor").click()
            page.get_by_label("Log to File").evaluate(
                "(element) => { if (element.checked) element.click(); }"
            )
            page.get_by_label("Transient Error Cooldown (seconds)").fill("-1")
            page.get_by_label("Retry action").click()
            page.get_by_role("option", name="Retry").click()
            page.get_by_label("Stream buffer max bytes").fill("4096")
            page.get_by_label("Enable Hedged Retry").evaluate(
                "(element) => { if (!element.checked) element.click(); }"
            )
            page.get_by_label("Hedge delay (ms)").fill("250")
            page.get_by_label("Require Distinct Auth").evaluate(
                "(element) => { if (!element.checked) element.click(); }"
            )
            page.get_by_label("Hedged retry mode").click()
            page.get_by_role("option", name="Speed").click()
            page.get_by_label("Exhausted behavior").click()
            page.get_by_role("option", name="Pass through abnormal response").click()
            page.get_by_label("Client usage aggregation").click()
            page.get_by_role("option", name="Sum with delivered total").click()
            page.get_by_label("Delivery policy").click()
            page.get_by_role("option", name="Max output").click()
            page.get_by_label("Fallback policy").click()
            page.get_by_role("option", name="Max output special").click()
            page.locator('button[aria-label="Save"]').click()
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/config.yaml")
            ):
                page.get_by_role("button", name="Confirm Save").click()
            page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()

            run_quota_runtime_smoke(page, app_url)
            run_remote_cloud_connect_runtime_smoke(page, app_url)
            run_logs_runtime_smoke(page, app_url)
            run_home_logs_runtime_smoke(page, app_url, state)
        except PlaywrightError as exc:
            with contextlib.suppress(Exception):
                body_text = page.locator("body").inner_text(timeout=1000)
                print(f"--- smoke failure body text at {page.url} ---", file=sys.stderr)
                print(body_text[:4000], file=sys.stderr)
                print("--- end body text ---", file=sys.stderr)
            raise AssertionError(f"Browser smoke failed at {page.url}: {exc}") from exc
        finally:
            context.close()
            browser.close()

    for method, path in [
        ("GET", "/v0/management/config"),
        ("GET", "/v0/management/config.yaml"),
        ("GET", "/v0/management/auth-files"),
        ("GET", "/v0/management/oauth-excluded-models"),
        ("GET", "/v0/management/oauth-model-alias"),
        ("GET", "/v1/models"),
        ("GET", "/v0/management/usage"),
        ("GET", "/v0/management/api-key-usage"),
        ("GET", "/v0/management/ampcode"),
        ("GET", "/v0/management/plugins"),
        ("GET", "/v0/management/plugin-store"),
        ("GET", "/v0/management/logs"),
        ("GET", "/v0/management/request-error-logs"),
        ("GET", "/v0/management/request-error-logs/error-smoke.log"),
        ("GET", "/v0/management/request-log-by-id/req-smoke"),
        ("GET", "/v0/management/request-log-by-id/home-req-smoke"),
        ("POST", "/v0/management/api-call"),
        ("PUT", "/v0/management/gemini-api-key"),
        ("PUT", "/v0/management/codex-api-key"),
        ("DELETE", "/v0/management/codex-api-key"),
        ("PUT", "/v0/management/openai-compatibility"),
        ("PUT", "/v0/management/config.yaml"),
    ]:
        assert_request_seen(state, method, path)
    assert_request_seen_after(
        state,
        "PUT",
        "/v0/management/gemini-api-key",
        "GET",
        "/v0/management/config",
    )
    assert_request_seen_after(
        state,
        "PUT",
        "/v0/management/codex-api-key",
        "GET",
        "/v0/management/config",
    )
    assert_request_seen_after(
        state,
        "DELETE",
        "/v0/management/codex-api-key",
        "GET",
        "/v0/management/config",
    )
    assert_request_seen_after(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        "GET",
        "/v0/management/config",
    )
    assert_request_query_contains(
        state,
        "GET",
        "/v0/management/logs",
        "offset=1",
    )
    assert_request_query_contains(
        state,
        "GET",
        "/v0/management/request-log-by-id/home-req-smoke",
        "home_ip=10.99.0.7",
    )
    assert_provider_mutation_payloads(state)
    assert_config_yaml_roundtrip(state)
    assert_api_call_url_seen(state, "backend-api/wham/usage", "Codex quota usage")
    assert_api_call_url_seen(
        state,
        "daily-workspace-usage-counts",
        "Codex daily analytics",
    )
    assert_api_call_url_seen(
        state,
        "rate-limit-reset-credits/consume",
        "Codex reset credit consume",
    )
    assert_api_call_url_seen(
        state,
        "backend-api/codex/remote/control/environments",
        "Codex remote cloud connect environments",
    )
    assert_api_call_url_seen(state, "cli-chat-proxy.grok.com/v1/billing", "xAI billing")
    assert_api_call_url_seen(
        state,
        "openrouter.ai/api/v1/chat/completions",
        "OpenAI Compatibility connectivity test",
    )
    assert_api_call_url_seen(
        state,
        "openrouter.ai/api/v1/models",
        "OpenAI Compatibility model discovery",
    )
    assert_api_call_auth_seen(
        state,
        "backend-api/wham/usage",
        "codex-smoke-auth",
        "Codex quota usage",
    )
    assert_api_call_auth_seen(
        state,
        "backend-api/codex/remote/control/environments",
        "codex-smoke-auth",
        "Codex remote cloud connect environments",
    )
    assert_api_call_auth_seen(
        state,
        "cli-chat-proxy.grok.com/v1/billing",
        "xai-smoke-auth",
        "xAI billing",
    )
    assert_api_call_auth_seen(
        state,
        "openrouter.ai/api/v1/chat/completions",
        "openrouter-a",
        "OpenAI Compatibility first key connectivity",
    )
    assert_api_call_auth_seen(
        state,
        "openrouter.ai/api/v1/chat/completions",
        "openrouter-b",
        "OpenAI Compatibility second key connectivity",
    )
    assert_api_call_auth_seen(
        state,
        "openrouter.ai/api/v1/models",
        "openrouter-a",
        "OpenAI Compatibility model discovery",
    )
    assert_request_not_seen(state, "GET", "/v0/management/nodes")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run LTS Panel browser smoke against a mock Core API.")
    parser.add_argument("--headed", action="store_true", help="Run Chromium headed for debugging.")
    args = parser.parse_args()

    if not INDEX_HTML.exists():
        print("dist/index.html is missing. Run `npm run build` first.", file=sys.stderr)
        return 2

    app_port = find_free_port()
    api_port = find_free_port()
    app_url = f"http://127.0.0.1:{app_port}/management.html"
    api_url = f"http://127.0.0.1:{api_port}"
    state = MockCoreState()

    with run_server(StaticPanelHandler, app_port), run_server(MockCoreHandler, api_port, state):
        run_browser_smoke(app_url, api_url, state, headed=args.headed)

    print("LTS panel browser smoke passed.")
    for entry in state.requests:
        print(f"  {entry}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"LTS panel browser smoke failed: {exc}", file=sys.stderr)
        if os.environ.get("DEBUG_SMOKE"):
            raise
        raise SystemExit(1)

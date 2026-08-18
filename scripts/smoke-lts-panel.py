#!/usr/bin/env python3
"""Browser smoke for the LTS panel build with a local mock Core API.

The script intentionally uses Python Playwright as an optional local tool instead
of adding a new npm dependency. Run it through `npm run smoke:lts`, which builds
the single-file dist first.
"""

from __future__ import annotations

import argparse
import csv
import contextlib
import json
import mimetypes
import os
import re
import socket
import sys
import threading
from datetime import datetime, timedelta, timezone
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
        self.supports_plugin = True
        self.emit_plugin_support_header = True
        self.plugin_endpoint_available = True
        self.plugins_config_enabled = True
        self.include_branded_providers = True
        self.logging_to_file = True
        self.plugin_enabled = True
        self.oauth_excluded_status = 200
        self.oauth_model_alias_status = 200
        self.usage_payload = build_usage_payload()
        self.usage_contract_code: str | None = None
        self.usage_contract_legacy_receipt = False
        self.delay_next_config_response = False
        self.delayed_config_status = 200
        self.delayed_config_started = threading.Event()
        self.release_delayed_config = threading.Event()

    def record(self, method: str, path: str, query: str = "") -> None:
        suffix = f"?{query}" if query else ""
        self.requests.append(f"{method} {path}{suffix}")

    def record_body(self, method: str, path: str, body: str) -> None:
        key = f"{method} {path}"
        self.request_bodies.setdefault(key, []).append(body)

    def save_config_yaml(self, content: str) -> None:
        self.config_yaml = content
        self.config_yaml_puts.append(content)

    def arm_delayed_config_response(self, status: int = 200) -> None:
        self.delayed_config_started.clear()
        self.release_delayed_config.clear()
        self.delayed_config_status = status
        self.delay_next_config_response = True


def build_recent_buckets() -> list[dict[str, Any]]:
    return [
        {"time": "2026-06-16T00:00:00Z", "success": 2, "failed": 0},
        {"time": "2026-06-16T00:10:00Z", "success": 1, "failed": 1},
    ]


def build_config_payload(
    include_branded_providers: bool = True,
    plugins_enabled: bool = True,
    logging_to_file: bool = True,
) -> dict[str, Any]:
    claude_api_keys = [
        {
            "api-key": "claude-key-1",
            "base-url": "https://api.anthropic.com",
            "models": [{"name": "claude-sonnet-4"}],
        }
    ]
    openai_compatibility = [
        {
            "name": "OpenRouter",
            "base-url": "https://openrouter.ai/api/v1",
            "x-lts-unknown-provider": {
                "preserve": "provider",
                "authIndex": "custom-extension-value",
            },
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
                    "display-name": "Mock Model",
                    "test-model": "mock-model",
                    "thinking": {
                        "levels": ["low", "vendor-custom"],
                        "min": 128,
                        "max": 32768,
                        "zero_allowed": True,
                        "dynamic_allowed": True,
                        "x-lts-thinking-note": "keep-thinking",
                    },
                    "x-lts-model-note": "keep-model",
                },
                {
                    "name": "openai/clear-display-name",
                    "alias": "clear-display-name",
                    "display-name": "Clear Me",
                    "x-lts-model-note": "keep-after-clear",
                },
                {
                    "name": "openai/legacy-snake",
                    "display_name": "legacy-snake-alias",
                    "x-lts-model-note": "keep-legacy-snake",
                },
                {
                    "name": "openai/legacy-camel",
                    "displayName": "legacy-camel-alias",
                    "x-lts-model-note": "keep-legacy-camel",
                },
            ],
        }
    ]

    if include_branded_providers:
        claude_api_keys.append(
            {
                "api-key": "claudeapi-smoke-key",
                "base-url": "https://gw.claudeapi.com",
                "models": [{"name": "claude-sonnet-4"}],
            }
        )
        claude_api_keys.append(
            {
                "api-key": "fenno-smoke-key",
                "base-url": "https://api.fenno.ai",
            }
        )
        openai_compatibility.extend(
            [
                {
                    "name": "code0",
                    "base-url": "https://code0.ai/v1",
                    "api-key-entries": [{"api-key": "code0-smoke-key"}],
                    "models": [
                        {
                            "name": "code0/mock-model",
                            "alias": "code0-route",
                            "display-name": "Code0 Model",
                            "x-lts-model-note": "keep-code0-model",
                        }
                    ],
                },
                {
                    "name": "qiniuCloud",
                    "base-url": "https://api.qnaigc.com/v1",
                    "api-key-entries": [{"api-key": "qiniu-smoke-key"}],
                },
            ]
        )

    return {
        "debug": False,
        "usage-statistics-enabled": True,
        "request-log": True,
        "logging-to-file": logging_to_file,
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
        "xai-api-key": [
            {
                "api-key": "xai-key-1",
                "base-url": "https://api.x.ai/v1",
                "websockets": True,
                "models": [
                    {
                        "name": "grok-4.5",
                        "display-name": "Grok 4.5",
                        "x-lts-model-note": "keep-xai-model",
                    }
                ],
                "x-lts-xai-note": "keep-xai-entry",
                "auth-index": "xai-response-only",
            }
        ],
        "claude-api-key": claude_api_keys,
        "vertex-api-key": [
            {
                "api-key": "vertex-key-1",
                "base-url": "https://vertex.example.test",
                "models": [{"name": "vertex-model", "alias": "vertex-alias"}],
            }
        ],
        "openai-compatibility": openai_compatibility,
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
            "enabled": plugins_enabled,
            "store-sources": [
                {
                    "id": "official",
                    "name": "official",
                    "url": "https://github.com/router-for-me/plugin-store",
                }
            ],
            "store-auth": [
                {
                    "match": "https://api.github.com/repos/router-for-me/",
                    "type": "github-token",
                    "apply-to": ["metadata", "artifact"],
                    "token-env": "CLIPROXY_PLUGIN_STORE_TOKEN",
                }
            ],
        },
    }


def build_usage_payload() -> dict[str, Any]:
    now = datetime.now(timezone.utc)

    def timestamp(minutes_ago: int) -> str:
        return (now - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")

    details = [
        {
            "timestamp": timestamp(1),
            "source": "codex-key-1",
            "auth_index": "codex-smoke-auth",
            "service_tier": " priority ",
            "request_service_tier": " priority ",
            "outbound_service_tier": " priority ",
            "response_service_tier": " priority ",
            "effective_service_tier": " priority ",
            "reasoning_effort": " max ",
            "latency": 110,
            "tokens": {
                "input_tokens": 12,
                "output_tokens": 8,
                "reasoning_tokens": 2,
                "cached_tokens": 1,
                "cache_read_tokens": 3,
                "cache_creation_tokens": 4,
                "total_tokens": 23,
            },
            "failed": False,
        },
        {
            "timestamp": timestamp(2),
            "source": "codex-key-1",
            "authIndex": "codex-smoke-auth",
            "serviceTier": " priority ",
            "requestServiceTier": " priority ",
            "outboundServiceTier": " standard ",
            "responseServiceTier": " default ",
            "effectiveServiceTier": " standard ",
            "reasoningEffort": " high ",
            "latency": 120,
            "tokens": {
                "input_tokens": 10,
                "output_tokens": 6,
                "reasoning_tokens": 0,
                "cached_tokens": 0,
                "cache_read_tokens": 1,
                "total_tokens": 16,
            },
            "failed": False,
        },
        {
            "timestamp": timestamp(3),
            "source": "codex-key-1",
            "AuthIndex": "codex-smoke-auth",
            "reasoning_effort": "none",
            "latency": 130,
            "tokens": {
                "input_tokens": 9,
                "output_tokens": 3,
                "reasoning_tokens": 0,
                "cached_tokens": 12,
                "cache_read_tokens": 12,
                "total_tokens": 12,
            },
            "failed": True,
        },
        {
            "timestamp": timestamp(4),
            "source": "codex-key-1",
            "auth_index": "codex-smoke-auth",
            "ServiceTier": " flex ",
            "RequestServiceTier": " priority ",
            "OutboundServiceTier": " priority ",
            "ResponseServiceTier": " flex ",
            "ReasoningEffort": " low ",
            "latency": 140,
            "tokens": {
                "input_tokens": 11,
                "output_tokens": 7,
                "reasoning_tokens": 1,
                "cached_tokens": 7,
                "cache_read_tokens": 7,
                "total_tokens": 19,
            },
            "failed": False,
        },
        {
            "timestamp": timestamp(5),
            "source": "codex-key-1",
            "auth_index": "codex-smoke-auth",
            "service_tier": " cache-import ",
            "request_service_tier": " fast ",
            "outbound_service_tier": " standard ",
            "reasoning_effort": "xhigh",
            "latency": 150,
            "tokens": {
                "input_tokens": 20,
                "output_tokens": 5,
                "reasoning_tokens": 0,
                "cached_tokens": 0,
                "cache_read_tokens": 0,
                "cache_creation_tokens": 7,
                "total_tokens": 32,
            },
            "failed": False,
        },
    ]

    gpt54_details = [
        {
            "timestamp": timestamp(6),
            "source": "codex-key-1",
            "auth_index": "codex-smoke-auth",
            "effective_service_tier": "priority",
            "response_service_tier": "priority",
            "request_service_tier": "priority",
            "reasoning_effort": "minimal",
            "tokens": {
                "input_tokens": 271_999,
                "output_tokens": 0,
                "total_tokens": 271_999,
            },
            "failed": False,
        },
        {
            "timestamp": timestamp(7),
            "source": "codex-key-1",
            "auth_index": "codex-smoke-auth",
            "effective_service_tier": "priority",
            "response_service_tier": "priority",
            "request_service_tier": "priority",
            "reasoning_effort": "medium",
            "tokens": {
                "input_tokens": 272_000,
                "cache_read_tokens": 163_200,
                "output_tokens": 0,
                "total_tokens": 272_000,
            },
            "failed": False,
        },
    ]

    unmatched_details = [
        {
            "timestamp": timestamp(58),
            "source": "codex-key-1",
            "auth_index": "codex-smoke-auth",
            "effective_service_tier": "standard",
            "tokens": {
                "input_tokens": 0,
                "output_tokens": 110,
                "total_tokens": 110,
            },
            "failed": False,
        }
    ]

    return {
        "usage": {
            "total_requests": 8,
            "success_count": 7,
            "failure_count": 1,
            "total_tokens": 1_544_211,
            "apis": {
                "POST /v1/responses": {
                    "total_requests": 8,
                    "success_count": 7,
                    "failure_count": 1,
                    "total_tokens": 1_544_211,
                    "models": {
                        "gpt-5.6-sol": {
                            "total_requests": 5,
                            "success_count": 4,
                            "failure_count": 1,
                            "total_tokens": 102,
                            "details": details,
                        },
                        "gpt-5.4": {
                            "total_requests": 2,
                            "success_count": 2,
                            "failure_count": 0,
                            "total_tokens": 1_543_999,
                            "details": gpt54_details,
                        },
                        "vendor/unmatched-model": {
                            "total_requests": 1,
                            "success_count": 1,
                            "failure_count": 0,
                            "total_tokens": 110,
                            "details": unmatched_details,
                        },
                    },
                }
            },
        }
    }


def build_usage_request_event_clock_payload() -> dict[str, Any]:
    payload = build_usage_payload()
    now = datetime.now(timezone.utc)
    usage = payload["usage"]
    api = usage["apis"]["POST /v1/responses"]
    models = api["models"]

    boundary_events = {
        "follow-page-boundary-model": now - timedelta(hours=23, minutes=59),
        "outside-page-range-model": now - timedelta(hours=25),
        "future-event-model": now + timedelta(minutes=5),
    }
    for model_name, timestamp in boundary_events.items():
        models[model_name] = {
            "total_requests": 1,
            "success_count": 1,
            "failure_count": 0,
            "total_tokens": 1,
            "details": [
                {
                    "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
                    "source": "request-events-clock",
                    "auth_index": "request-events-clock-auth",
                    "effective_service_tier": "standard",
                    "tokens": {
                        "input_tokens": 1,
                        "output_tokens": 0,
                        "total_tokens": 1,
                    },
                    "failed": False,
                }
            ],
        }
        for aggregate in (usage, api):
            aggregate["total_requests"] += 1
            aggregate["success_count"] += 1
            aggregate["total_tokens"] += 1

    return payload


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
                "name": "codex-team-smoke.json",
                "type": "codex",
                "provider": "codex",
                "source": "file",
                "path": "/tmp/codex-team-smoke.json",
                "auth_index": "codex-team-smoke-auth",
                "email": "codex-team-smoke@example.test",
                "runtime_only": False,
                "disabled": False,
                "modtime": 1781517600,
                "id_token": {
                    "chatgpt_account_id": "team-acct-smoke",
                    "plan_type": "team",
                    "email": "codex-team-smoke@example.test",
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
disable-image-generation: chat
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
  store-auth:
    - match: https://api.github.com/repos/router-for-me/
      type: github-token
      apply-to:
        - metadata
        - artifact
      token-env: CLIPROXY_PLUGIN_STORE_TOKEN
ampcode:
  upstream-url: https://amp.example.test
  upstream-api-key: sk-amp-smoke
  force-model-mappings: true
codex:
  abnormal-reasoning-retry:
    hedged-retry:
      require-distinct-auth: false
"""


def build_plugin_list_payload(enabled: bool = True) -> dict[str, Any]:
    return {
        "plugins_enabled": True,
        "plugins_dir": "plugins",
        "plugins": [
            {
                "id": "mock-plugin",
                "path": "plugins/mock-plugin",
                "configured": True,
                "registered": True,
                "enabled": enabled,
                "effective_enabled": enabled,
                "metadata": {
                    "name": "Mock Resource Plugin",
                    "version": "0.1.0",
                    "author": "LTS smoke",
                    "github_repository": "router-for-me/mock-plugin",
                    "logo": "",
                    "config_fields": [
                        {
                            "name": "label",
                            "type": "string",
                            "description": "Smoke label",
                        },
                        {
                            "name": "advanced",
                            "type": "object",
                            "description": "Smoke object",
                        },
                    ],
                },
                "menus": [
                    {
                        "path": "/plugin/mock-resource.html",
                        "menu": "Mock Resource",
                        "description": "Mock plugin resource page",
                    },
                    {
                        "path": "/plugin/mock-settings.html",
                        "menu": "Mock Resource Settings",
                        "description": "Mock plugin settings page",
                    }
                ],
            },
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
        "source_errors": [
            {
                "source_id": "private",
                "source_name": "private",
                "source_url": "https://plugins.example.test/registry.json",
                "message": "missing store auth",
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
                "install_type": "github-release",
                "auth_required": True,
                "auth_configured": False,
                "platforms": [{"goos": "darwin", "goarch": "arm64"}],
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


def build_codex_team_quota_usage_payload() -> dict[str, Any]:
    payload = build_codex_quota_usage_payload()
    payload.update(
        {
            "user_id": "team-user-smoke",
            "account_id": "team-acct-smoke",
            "email": "codex-team-smoke@example.test",
            "plan_type": "team",
        }
    )
    return payload


def build_codex_team_leaderboard_payload() -> dict[str, Any]:
    return {
        "total_users": 2,
        "data": [
            {
                "rank": 1,
                "name": "Team Current User",
                "email": "codex-team-smoke@example.test",
                "credits": 3.25,
                "n_threads": 2,
                "n_turns": 7,
                "text_tokens": 600,
            },
            {
                "rank": 2,
                "name": "Team Other User",
                "email": "other-team-smoke@example.test",
                "credits": 4.75,
                "n_threads": 3,
                "n_turns": 8,
                "text_tokens": 800,
            },
        ],
    }


def build_codex_daily_usage_payload() -> dict[str, Any]:
    def bucket(
        date: str,
        credits: float,
        *,
        threads: int = 1,
        turns: int = 2,
        users: int = 1,
    ) -> dict[str, Any]:
        return {
            "date": date,
            "totals": {
                "credits": credits,
                "threads": threads,
                "turns": turns,
                "users": users,
                "cached_text_input_tokens": threads * 100,
                "uncached_text_input_tokens": threads * 200,
                "text_output_tokens": turns * 100,
            },
            "clients": [
                {
                    "client_id": "codex-cli",
                    "credits": credits,
                    "threads": threads,
                    "turns": turns,
                    "cached_text_input_tokens": threads * 100,
                    "uncached_text_input_tokens": threads * 200,
                    "text_output_tokens": turns * 100,
                }
            ],
        }

    return {
        "data": [
            # The mock secondary window makes backend ``now`` 2026-06-15 and
            # the daily request end date exclusive 2026-06-16. Keep one
            # out-of-range bucket on each side so the smoke catches inclusive
            # end-date regressions as well as a truncated 360-day history.
            bucket("2025-06-20", 99),
            bucket("2025-06-21", 1.25),
            bucket("2025-12-01", 2.75),
            bucket("2026-03-18", 4),
            bucket("2026-05-17", 3),
            bucket("2026-06-01", 1.75),
            bucket("2026-06-11", 0.5),
            bucket("2026-06-15", 2.75, threads=2, turns=7),
            bucket("2026-06-16", 99),
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


def build_xai_weekly_billing_payload() -> dict[str, Any]:
    return {
        "config": {
            "currentPeriod": {
                "type": "weekly",
                "start": "2026-06-15T00:00:00Z",
                "end": "2026-06-22T00:00:00Z",
            },
            "creditUsagePercent": 40,
            "prepaidBalance": {"val": -750},
            "isUnifiedBillingUser": True,
            "history": [{"billingCycle": {"year": 2026, "month": 7}}],
            "productUsage": [
                {"product": "Grok 4", "usagePercent": 25},
                {"product": "Grok Code", "usagePercent": 55},
            ],
        },
        "onDemandEnabled": True,
        "subscriptionTier": "SuperGrok Heavy",
    }


def build_xai_monthly_billing_payload() -> dict[str, Any]:
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
        config_payload = build_config_payload(
            include_branded_providers=self.state.include_branded_providers,
            plugins_enabled=self.state.plugins_config_enabled,
            logging_to_file=self.state.logging_to_file,
        )

        if path == "/v0/management/config" and self.state.delay_next_config_response:
            self.state.delay_next_config_response = False
            plugin_support = self.state.supports_plugin
            self.state.delayed_config_started.set()
            if not self.state.release_delayed_config.wait(timeout=10):
                self._send_json({"error": "delayed config response timed out"}, status=504)
                return
            if self.state.delayed_config_status != 200:
                self._send_json(
                    {"error": "delayed config response failed"},
                    status=self.state.delayed_config_status,
                    plugin_support_override=plugin_support,
                )
                return
            self._send_json(config_payload, plugin_support_override=plugin_support)
            return

        if path == "/v0/management/plugins" and not self.state.plugin_endpoint_available:
            self._send_json({"error": "plugin endpoint unavailable"}, status=404)
            return

        if (
            path == "/v0/management/oauth-excluded-models"
            and self.state.oauth_excluded_status != 200
        ):
            self._send_json(
                {"error": "oauth excluded models unavailable"},
                status=self.state.oauth_excluded_status,
            )
            return

        if (
            path == "/v0/management/oauth-model-alias"
            and self.state.oauth_model_alias_status != 200
        ):
            self._send_json(
                {"error": "oauth model aliases unavailable"},
                status=self.state.oauth_model_alias_status,
            )
            return

        routes: dict[str, Any] = {
            "/v0/management/config": config_payload,
            "/v0/management/auth-files": build_auth_files_payload(),
            "/v0/management/usage": self.state.usage_payload,
            "/v0/management/usage/export": {
                "version": 2,
                "usage": self.state.usage_payload["usage"],
            },
            "/v0/management/api-key-usage": build_api_key_usage_payload(),
            "/v0/management/ampcode": {"ampcode": config_payload["ampcode"]},
            "/v0/management/vertex-api-key": {
                "vertex-api-key": config_payload["vertex-api-key"]
            },
            "/v0/management/openai-compatibility": {
                "openai-compatibility": config_payload["openai-compatibility"]
            },
            "/v0/management/xai-api-key": {
                "xai-api-key": config_payload["xai-api-key"]
            },
            "/v0/management/ampcode/upstream-api-keys": {
                "upstream-api-keys": config_payload["ampcode"]["upstream-api-keys"]
            },
            "/v0/management/ampcode/model-mappings": {
                "model-mappings": config_payload["ampcode"]["model-mappings"]
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
            "/v0/management/plugins": build_plugin_list_payload(self.state.plugin_enabled),
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

        if path == "/plugin/mock-settings.html":
            self._send_bytes(
                b"<!doctype html><title>Mock Resource Settings</title><main>Mock plugin settings loaded</main>",
                content_type="text/html; charset=utf-8",
            )
            return

        if path == "/v0/management/config.yaml":
            self._send_bytes(
                self.state.config_yaml.encode("utf-8"),
                content_type="application/yaml; charset=utf-8",
            )
            return

        if path == "/v0/management/auth-files/download":
            name = parse_qs(parsed.query).get("name", [""])[0]
            auth_files = {
                "codex-smoke.json": {
                    "type": "codex",
                    "email": "codex-smoke@example.test",
                    "websockets": True,
                },
                "xai-smoke.json": {
                    "type": "xai",
                    "email": "xai-smoke@example.test",
                    "using_api": False,
                    "unmanaged-smoke-field": "keep-me",
                },
            }
            payload = auth_files.get(name)
            if payload is None:
                self._send_json({"error": "auth file not found"}, status=404)
                return
            self._send_json(payload)
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
            self._send_json(
                {
                    "enabled": True,
                    "priority": 7,
                    "label": "original-label",
                    "advanced": {"mode": "safe"},
                    "untouched-server-field": {"keep": True},
                }
            )
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
        if parsed.path == "/v0/management/usage/import":
            if self.state.usage_contract_code:
                self._send_json(
                    {
                        "error": "mock usage import rejection",
                        "code": self.state.usage_contract_code,
                    },
                    status=400,
                )
                return
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {}
            receipt = {
                "added": 0,
                "skipped": 2,
                "total_requests": 5,
                "failed_requests": 1,
                "schema_version": 2,
                "future_receipt_field": {"ignored_by_panel": True},
            }
            if self.state.usage_contract_legacy_receipt:
                receipt.pop("schema_version")
                receipt.pop("future_receipt_field")
            elif payload.get("version") == 1:
                receipt.update(
                    {
                        "migrated_from_version": 1,
                        "migration": "v1_uncached_input_tokens_to_v2",
                    }
                )
            self._send_json(receipt)
            return
        self._send_json({"status": "ok"})

    def _mock_api_call_response(self, body: str) -> dict[str, Any]:
        try:
            payload = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            return build_api_call_result({"error": "invalid api-call payload"}, status_code=400)

        url = str(payload.get("url") or "")
        auth_index = str(payload.get("authIndex") or "")
        if "rate-limit-reset-credits/consume" in url:
            return build_api_call_result({"status": "ok"})
        if "usage-leaderboard" in url:
            return build_api_call_result(build_codex_team_leaderboard_payload())
        if "daily-workspace-usage-counts" in url:
            return build_api_call_result(build_codex_daily_usage_payload())
        if "backend-api/codex/remote/control/environments" in url:
            return build_api_call_result(build_codex_remote_cloud_connect_environments_payload())
        if url == "https://chatgpt.com/backend-api/wham/usage":
            if auth_index == "codex-team-smoke-auth":
                return build_api_call_result(build_codex_team_quota_usage_payload())
            return build_api_call_result(build_codex_quota_usage_payload())
        if url == "https://cli-chat-proxy.grok.com/v1/billing?format=credits":
            return build_api_call_result(build_xai_weekly_billing_payload())
        if url == "https://cli-chat-proxy.grok.com/v1/billing":
            return build_api_call_result(build_xai_monthly_billing_payload())
        if url == "https://cli-chat-proxy.grok.com/v1/user":
            return build_api_call_result({"user_id": "xai-user-smoke"})
        if url == "https://cli-chat-proxy.grok.com/v1/auto-topup-rule":
            return build_api_call_result(
                {
                    "rule": {
                        "enabled": True,
                        "topup_amount": {"val": -750},
                        "max_amount_per_month": {"val": -2500},
                    }
                }
            )
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
        if parsed.path == "/v0/management/plugins/mock-plugin/enabled":
            try:
                payload = json.loads(body) if body.strip() else {}
            except json.JSONDecodeError:
                payload = {}
            self.state.plugin_enabled = payload.get("enabled") is True
        self._send_json({"status": "ok"})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        self.state.record("DELETE", parsed.path, parsed.query)
        self._send_json({"status": "ok"})

    def _send_empty(self, status: int) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.end_headers()

    def _send_json(
        self,
        payload: Any,
        status: int = 200,
        plugin_support_override: bool | None = None,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._send_bytes(
            body,
            status=status,
            content_type="application/json; charset=utf-8",
            plugin_support_override=plugin_support_override,
        )

    def _send_bytes(
        self,
        body: bytes,
        status: int = 200,
        content_type: str = "application/octet-stream",
        plugin_support_override: bool | None = None,
    ) -> None:
        self.send_response(status)
        self._send_cors_headers(plugin_support_override=plugin_support_override)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self, plugin_support_override: bool | None = None) -> None:
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
        if self.state.emit_plugin_support_header:
            supports_plugin = (
                self.state.supports_plugin
                if plugin_support_override is None
                else plugin_support_override
            )
            self.send_header("x-cpa-support-plugin", "1" if supports_plugin else "0")

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


def assert_each_request_immediately_preceded_by(
    state: MockCoreState,
    method: str,
    path: str,
    preceding_method: str,
    preceding_path: str,
) -> None:
    target_prefix = f"{method} {path}"
    preceding_prefix = f"{preceding_method} {preceding_path}"
    target_indexes = [
        index
        for index, entry in enumerate(state.requests)
        if entry == target_prefix or entry.startswith(f"{target_prefix}?")
    ]
    if not target_indexes:
        raise AssertionError(f"Expected mock API request {target_prefix}; saw: {state.requests}")

    for index in target_indexes:
        previous = state.requests[index - 1] if index > 0 else ""
        if previous != preceding_prefix and not previous.startswith(f"{preceding_prefix}?"):
            raise AssertionError(
                f"Expected {target_prefix} to use a latest-state read immediately before writing; "
                f"previous request was {previous!r}: {state.requests}"
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


def codex_daily_workspace_api_call_payloads(state: MockCoreState) -> list[dict[str, Any]]:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    return [
        payload
        for payload in payloads
        if isinstance(payload, dict)
        and "daily-workspace-usage-counts" in str(payload.get("url") or "")
    ]


def codex_team_leaderboard_api_call_payloads(state: MockCoreState) -> list[dict[str, Any]]:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    return [
        payload
        for payload in payloads
        if isinstance(payload, dict) and "usage-leaderboard" in str(payload.get("url") or "")
    ]


def assert_codex_daily_workspace_fetch(
    state: MockCoreState,
    before_count: int,
    expected_delta: int,
    description: str,
) -> int:
    payloads = codex_daily_workspace_api_call_payloads(state)
    actual_delta = len(payloads) - before_count
    if actual_delta != expected_delta:
        raise AssertionError(
            f"{description} must issue exactly {expected_delta} daily-workspace-usage-counts "
            f"request(s), saw delta={actual_delta} (total={len(payloads)})"
        )
    return len(payloads)


def assert_api_call_exact_url_seen(state: MockCoreState, url: str, description: str) -> None:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    if not any(isinstance(payload, dict) and payload.get("url") == url for payload in payloads):
        raise AssertionError(
            f"Expected /api-call URL for {description} to equal {url!r}; "
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


def assert_api_call_exact_url_auth_seen(
    state: MockCoreState,
    url: str,
    auth_index: str,
    description: str,
) -> None:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    if not any(
        isinstance(payload, dict)
        and payload.get("url") == url
        and payload.get("authIndex") == auth_index
        for payload in payloads
    ):
        raise AssertionError(
            f"Expected /api-call payload for {description} with url={url!r} "
            f"and authIndex={auth_index!r}; saw {payloads!r}"
        )


def assert_xai_billing_identity(
    state: MockCoreState,
    url: str,
    description: str,
) -> None:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    matching = [
        payload
        for payload in payloads
        if isinstance(payload, dict)
        and payload.get("url") == url
        and payload.get("authIndex") == "xai-smoke-auth"
    ]
    expected_headers = {
        "Authorization": "Bearer $TOKEN$",
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-version": "1.0.3",
        "x-grok-client-mode": "interactive",
        "accept": "application/json",
        "x-userid": "xai-user-smoke",
    }
    valid = False
    for payload in matching:
        headers = payload.get("header") or {}
        if not all(headers.get(key) == value for key, value in expected_headers.items()):
            continue
        user_agent = headers.get("user-agent", "")
        if re.fullmatch(
            r"grok-pager/1\.0\.3 grok-shell/1\.0\.3 "
            r"\((?:macos|windows|linux|unknown); (?:aarch64|x86_64|unknown)\)",
            user_agent,
        ):
            valid = True
            break
    if not valid:
        raise AssertionError(
            f"Expected /api-call payload for {description} with the current official "
            f"Grok billing identity; saw {matching!r}"
        )


def assert_xai_user_identity_lookup(state: MockCoreState) -> None:
    payloads = parse_json_bodies(state, "POST", "/v0/management/api-call")
    matching = [
        payload for payload in payloads
        if isinstance(payload, dict)
        and payload.get("url") == "https://cli-chat-proxy.grok.com/v1/user"
        and payload.get("authIndex") == "xai-smoke-auth"
    ]
    if not matching:
        raise AssertionError("xAI quota fallback did not request /v1/user")
    if any("x-userid" in (payload.get("header") or {}) for payload in matching):
        raise AssertionError("xAI /v1/user fallback must not send x-userid")


def assert_xai_auto_topup_identity(state: MockCoreState) -> None:
    assert_xai_billing_identity(
        state,
        "https://cli-chat-proxy.grok.com/v1/auto-topup-rule",
        "xAI auto-top-up rule",
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
            and any(
                isinstance(model, dict)
                and model.get("name") == "gpt-5.6-sol"
                and model.get("display-name") == "Codex Thinking Model"
                and model.get("thinking")
                == {
                    "levels": ["max"],
                    "min": 128,
                    "max": 32768,
                    "zero_allowed": True,
                    "dynamic_allowed": True,
                }
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "created Codex resource with websocket and thinking capability preserved",
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
    assert_request_count_at_least(state, "PUT", "/v0/management/xai-api-key", 2)
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/xai-api-key",
        lambda payload: any(
            item.get("api-key") == "xai-smoke-new"
            and item.get("base-url") == "https://api.x.ai/v1"
            and item.get("websockets") is True
            and any(
                isinstance(model, dict)
                and model.get("name") == "grok-4.5"
                and model.get("display-name") == "Grok Browser Model"
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "created xAI resource using the Core contract",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/xai-api-key",
        lambda payload: any(
            item.get("api-key") == "xai-key-1"
            and item.get("base-url") == "https://xai.updated.example/v1"
            and item.get("x-lts-xai-note") == "keep-xai-entry"
            and any(
                isinstance(model, dict)
                and model.get("x-lts-model-note") == "keep-xai-model"
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "updated xAI resource while preserving unknown fields",
    )
    assert_request_seen(state, "DELETE", "/v0/management/xai-api-key")
    for payload in parse_json_bodies(state, "PUT", "/v0/management/xai-api-key"):
        if json_contains_key(payload, "auth-index") or json_contains_key(payload, "authIndex"):
            raise AssertionError("xAI provider payload wrote response-only auth-index")
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
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "OpenRouter"
            and any(
                isinstance(model, dict)
                and model.get("name") == "openai/mock-model"
                and model.get("display-name") == "Updated Mock Model"
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "updated model display-name",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "OpenRouter"
            and any(
                isinstance(model, dict)
                and model.get("name") == "openai/mock-model"
                and model.get("thinking")
                == {
                    "levels": ["low", "high", "max", "vendor-custom"],
                    "min": 256,
                    "max": 32768,
                    "zero_allowed": True,
                    "dynamic_allowed": True,
                    "x-lts-thinking-note": "keep-thinking",
                }
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "updated standard thinking levels without dropping advanced config",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "OpenRouter"
            and any(
                isinstance(model, dict)
                and model.get("name") == "openai/smoke-discovered"
                and model.get("display-name") == "Discovered Model"
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "new model display-name",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "OpenRouter"
            and all(
                any(
                    isinstance(model, dict)
                    and model.get("name") == model_name
                    and model.get("alias") == expected_alias
                    and "display-name" not in model
                    and "display_name" not in model
                    and "displayName" not in model
                    for model in item.get("models", [])
                )
                for model_name, expected_alias in (
                    ("openai/legacy-snake", "legacy-snake-alias"),
                    ("openai/legacy-camel", "legacy-camel-alias"),
                )
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "preserved legacy model routing aliases",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "OpenRouter"
            and any(
                isinstance(model, dict)
                and model.get("name") == "openai/clear-display-name"
                and "display-name" not in model
                and model.get("x-lts-model-note") == "keep-after-clear"
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "cleared model display-name without dropping unknown fields",
    )
    assert_payload_match(
        state,
        "PUT",
        "/v0/management/openai-compatibility",
        lambda payload: any(
            item.get("name") == "code0"
            and any(
                isinstance(model, dict)
                and model.get("name") == "code0/mock-model"
                and model.get("alias") == "code0-route"
                and model.get("display-name") == "Code0 Model Updated"
                and model.get("x-lts-model-note") == "keep-code0-model"
                for model in item.get("models", [])
            )
            for item in payload
            if isinstance(item, dict)
        ),
        "updated sponsor model display-name",
    )
    for payload in parse_json_bodies(state, "PUT", "/v0/management/openai-compatibility"):
        for provider in payload:
            if not isinstance(provider, dict):
                continue
            if any(key in provider for key in ("auth-index", "authIndex", "auth_index")):
                raise AssertionError(
                    "OpenAI Compatibility provider payload wrote response-only auth-index: "
                    f"{payload!r}"
                )
            for entry in provider.get("api-key-entries", []):
                if isinstance(entry, dict) and any(
                    key in entry for key in ("auth-index", "authIndex", "auth_index")
                ):
                    raise AssertionError(
                        "OpenAI Compatibility key payload wrote response-only auth-index: "
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
        if openrouter.get("x-lts-unknown-provider") != {
            "preserve": "provider",
            "authIndex": "custom-extension-value",
        }:
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
        for provider_name, base_url, api_key in [
            ("code0", "https://code0.ai/v1", "code0-smoke-key"),
            ("qiniuCloud", "https://api.qnaigc.com/v1", "qiniu-smoke-key"),
        ]:
            branded_provider = next(
                (
                    item
                    for item in payload
                    if isinstance(item, dict) and item.get("name") == provider_name
                ),
                None,
            )
            branded_entries = (
                branded_provider.get("api-key-entries", [])
                if isinstance(branded_provider, dict)
                else []
            )
            if (
                not isinstance(branded_provider, dict)
                or branded_provider.get("base-url") != base_url
                or not any(
                    isinstance(entry, dict) and entry.get("api-key") == api_key
                    for entry in branded_entries
                )
            ):
                raise AssertionError(
                    "OpenAI Compatibility PUT payload dropped configured branded provider "
                    f"{provider_name!r}: {payload!r}"
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
        "store-auth:",
        "CLIPROXY_PLUGIN_STORE_TOKEN",
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
    if "disable-image-generation: passthrough" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist disable-image-generation passthrough:\n"
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

    if "concurrent-managed-smoke: keep-me" not in visual_payload:
        raise AssertionError(
            "Visual config save dropped a concurrent server-side marker:\n"
            f"{visual_payload}"
        )
    if "usage-statistics-enabled: false" not in visual_payload:
        raise AssertionError(
            "Visual config save overwrote a concurrent managed-field update:\n"
            f"{visual_payload}"
        )
    if "redis-usage-queue-retention-seconds: 60" not in visual_payload:
        raise AssertionError(
            "Visual config save did not persist the validated Redis retention value:\n"
            f"{visual_payload}"
        )


def run_plugin_config_patch_smoke(page: Any, app_url: str) -> None:
    page.goto(f"{app_url}?route=plugin-config-patch#/plugins", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/plugins')")
    page.get_by_text("Plugin Management", exact=False).first.wait_for()
    page.get_by_role("button", name="Edit config").click()
    config_dialog = page.get_by_role("dialog", name="Configure Mock Resource Plugin")
    config_dialog.wait_for()
    config_dialog.get_by_label("label", exact=True).fill("updated-label")
    enabled_toggle = config_dialog.get_by_label("Enabled", exact=True)
    enabled_toggle.evaluate("(element) => { if (element.checked) element.click(); }")
    with page.expect_response(
        lambda response: response.request.method == "PATCH"
        and response.url.endswith("/v0/management/plugins/mock-plugin/config")
    ), page.expect_response(
        lambda response: response.request.method == "PATCH"
        and response.url.endswith("/v0/management/plugins/mock-plugin/enabled")
    ):
        config_dialog.get_by_role("button", name="Save", exact=True).click()
    page.get_by_text("Plugin config saved", exact=False).first.wait_for()


def run_oauth_editor_smoke(page: Any, app_url: str) -> None:
    page.goto(
        f"{app_url}?route=oauth-alias-empty-draft#/auth-files/oauth-model-alias",
        wait_until="domcontentloaded",
    )
    page.wait_for_function("() => window.location.hash.includes('/auth-files/oauth-model-alias')")
    page.get_by_text("Add provider model aliases", exact=False).first.wait_for()
    page.get_by_role("button", name="Back", exact=True).click()
    page.wait_for_function("() => window.location.hash.endsWith('/auth-files')")
    if page.get_by_role("dialog", name="Unsaved changes").count() != 0:
        raise AssertionError("empty OAuth alias draft must not trigger the unsaved changes guard")

    page.goto(
        f"{app_url}?route=oauth-editor#/auth-files/oauth-excluded",
        wait_until="domcontentloaded",
    )
    page.wait_for_function("() => window.location.hash.includes('/auth-files/oauth-excluded')")
    page.get_by_text("Add provider model disablement", exact=False).first.wait_for()
    page.get_by_role("button", name="Codex", exact=True).click()
    page.get_by_text("Edit model disablement for codex", exact=False).first.wait_for()
    page.get_by_label("Custom model rule", exact=True).fill("gpt-*")

    page.get_by_role("button", name="Back", exact=True).click()
    unsaved_dialog = page.get_by_role("dialog", name="Unsaved changes")
    unsaved_dialog.wait_for()
    unsaved_dialog.get_by_role("button", name="Stay", exact=True).click()
    unsaved_dialog.wait_for(state="hidden")

    with page.expect_response(
        lambda response: response.request.method == "PATCH"
        and response.url.endswith("/v0/management/oauth-excluded-models")
    ):
        page.get_by_role("button", name="Save/Update", exact=True).click()
    page.get_by_text("Model disablement updated", exact=False).first.wait_for()


def run_oauth_load_failure_smoke(
    page: Any, app_url: str, state: MockCoreState
) -> None:
    write_paths = (
        "/v0/management/oauth-excluded-models",
        "/v0/management/oauth-model-alias",
    )
    writes_before = sum(
        1
        for request in state.requests
        if request.startswith(("PATCH ", "PUT ", "DELETE "))
        and any(path in request for path in write_paths)
    )

    state.oauth_excluded_status = 500
    state.oauth_model_alias_status = 500
    try:
        page.goto(f"{app_url}?route=oauth-load-failure#/auth-files", wait_until="domcontentloaded")
        page.wait_for_function("() => window.location.hash.endsWith('/auth-files')")
        page.get_by_text("Refresh failed", exact=True).first.wait_for()
        if not page.get_by_role("button", name="Add Disablement", exact=True).is_disabled():
            raise AssertionError("OAuth excluded-model writes stayed enabled after a load failure")
        if not page.get_by_role("button", name="Add Alias", exact=True).is_disabled():
            raise AssertionError("OAuth model-alias writes stayed enabled after a load failure")
        if page.get_by_role("button", name="Refresh", exact=True).count() < 2:
            raise AssertionError("OAuth load failures did not expose retry actions")

        page.goto(
            f"{app_url}?route=oauth-excluded-load-failure#/auth-files/oauth-excluded",
            wait_until="domcontentloaded",
        )
        page.get_by_text("Refresh failed", exact=True).first.wait_for()
        if not page.get_by_role("button", name="Save/Update", exact=True).is_disabled():
            raise AssertionError("OAuth excluded editor allowed saving without a loaded baseline")

        page.goto(
            f"{app_url}?route=oauth-alias-load-failure#/auth-files/oauth-model-alias",
            wait_until="domcontentloaded",
        )
        page.get_by_text("Refresh failed", exact=True).first.wait_for()
        if not page.get_by_role("button", name="Save/Update", exact=True).is_disabled():
            raise AssertionError("OAuth alias editor allowed saving without a loaded baseline")
    finally:
        state.oauth_excluded_status = 200
        state.oauth_model_alias_status = 200

    writes_after = sum(
        1
        for request in state.requests
        if request.startswith(("PATCH ", "PUT ", "DELETE "))
        and any(path in request for path in write_paths)
    )
    if writes_after != writes_before:
        raise AssertionError("OAuth load-failure smoke emitted a write request")


def run_auth_file_using_api_smoke(page: Any, app_url: str) -> None:
    page.goto(f"{app_url}?route=auth-file-using-api#/auth-files", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/auth-files')")
    page.get_by_text("Auth Files Management", exact=False).first.wait_for()

    codex_card = page.get_by_text("codex-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    with page.expect_response(
        lambda response: response.request.method == "GET"
        and "/v0/management/auth-files/download" in response.url
        and "codex-smoke.json" in response.url
    ):
        codex_card.locator('button[title="Auth File Details / Edit"]').click()
    codex_dialog = page.get_by_role(
        "dialog", name="Auth File Details / Edit - codex-smoke.json"
    )
    codex_dialog.wait_for()
    if codex_dialog.get_by_label("Use official API (using_api)").count() != 0:
        raise AssertionError("using_api control must stay hidden for non-xAI auth files")
    codex_dialog.locator(".modal-footer").get_by_role(
        "button", name="Close", exact=True
    ).click()
    codex_dialog.wait_for(state="hidden")

    xai_card = page.get_by_text("xai-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    with page.expect_response(
        lambda response: response.request.method == "GET"
        and "/v0/management/auth-files/download" in response.url
        and "xai-smoke.json" in response.url
    ):
        xai_card.locator('button[title="Auth File Details / Edit"]').click()
    xai_dialog = page.get_by_role("dialog", name="Auth File Details / Edit - xai-smoke.json")
    xai_dialog.wait_for()
    using_api_toggle = xai_dialog.get_by_label("Use official API (using_api)")
    if using_api_toggle.is_checked():
        raise AssertionError("xAI using_api smoke baseline must start in CLI chat-proxy mode")
    using_api_toggle.evaluate("(element) => element.click()")
    page.wait_for_function(
        "() => document.querySelector('input[aria-label=\"Use official API (using_api)\"]')?.checked === true"
    )
    xai_dialog.get_by_text(
        "Use the official xAI API when enabled; use Grok CLI chat-proxy when disabled.",
        exact=True,
    ).wait_for()
    with page.expect_response(
        lambda response: response.request.method == "PATCH"
        and response.url.endswith("/v0/management/auth-files/fields")
    ):
        xai_dialog.get_by_role("button", name="Save", exact=True).click()
    page.get_by_text('Updated auth file "xai-smoke.json" successfully', exact=True).wait_for()


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


def run_quota_runtime_smoke(page: Any, app_url: str, state: MockCoreState) -> None:
    page.goto(f"{app_url}?route=quota-runtime#/quota", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/quota')")
    page.get_by_text("Quota Management", exact=False).first.wait_for()

    codex_card = page.get_by_text("codex-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    codex_card.wait_for()
    daily_before_refresh = len(codex_daily_workspace_api_call_payloads(state))
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

    def assert_daily_range(label: str, credits: str, date_range: str) -> None:
        range_card = codex_card.get_by_text(label, exact=True).locator(
            "xpath=ancestor::div[contains(@class, 'codexUsageRange') "
            "and not(contains(@class, 'codexUsageRangeHeader'))][1]"
        )
        range_card.wait_for()
        range_text = range_card.inner_text()
        for expected in [f"{credits} credits", date_range]:
            if expected not in range_text:
                raise AssertionError(
                    f"Codex {label} range must contain {expected!r}; saw {range_text!r}"
                )

    assert_daily_range("Since last reset", "3.25", "2026-06-11 - 2026-06-15")
    assert_daily_range("Calendar month", "5", "2026-06-01 - 2026-06-15")
    assert_daily_range("Last 30 days", "8", "2026-05-17 - 2026-06-15")
    assert_daily_range("Last 90 days", "12", "2026-03-18 - 2026-06-15")
    assert_daily_range("Last 360 days", "16", "2025-06-21 - 2026-06-15")
    daily_after_refresh = assert_codex_daily_workspace_fetch(
        state,
        daily_before_refresh,
        1,
        "ordinary Codex quota refresh",
    )

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
    daily_after_reset = assert_codex_daily_workspace_fetch(
        state,
        daily_after_refresh,
        1,
        "Codex reset refresh",
    )
    if daily_after_reset - daily_before_refresh != 2:
        raise AssertionError(
            "The initial Codex fetch plus the reset refresh must issue exactly two "
            "daily-workspace-usage-counts requests"
        )

    team_card = page.get_by_text("codex-team-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    team_card.wait_for()
    team_leaderboard_before = len(codex_team_leaderboard_api_call_payloads(state))
    with page.expect_response(
        lambda response: response.request.method == "POST"
        and response.url.endswith("/v0/management/api-call")
    ):
        team_card.get_by_role("button", name="Click here to refresh quota").click()
    team_card.get_by_text("Team", exact=True).wait_for()
    team_card.get_by_text("Usage details", exact=True).click()
    team_card.locator("details[open]").first.wait_for()
    team_card.get_by_text("Deep Usage", exact=False).first.wait_for()

    def assert_team_range(label: str, date_range: str) -> None:
        range_card = team_card.get_by_text(label, exact=True).locator(
            "xpath=ancestor::div[contains(@class, 'codexUsageRange') "
            "and not(contains(@class, 'codexUsageRangeHeader'))][1]"
        )
        range_card.wait_for()
        range_text = range_card.inner_text()
        for expected in ["3.25 credits", "8 credits", date_range]:
            if expected not in range_text:
                raise AssertionError(
                    f"Team Codex {label} range must contain {expected!r}; saw {range_text!r}"
                )

    assert_team_range("Since last reset", "2026-06-11 - 2026-06-15")
    assert_team_range("Calendar month", "2026-06-01 - 2026-06-15")
    assert_team_range("Last 30 days", "2026-05-17 - 2026-06-15")
    if team_card.get_by_text("Last 90 days", exact=True).count() != 0:
        raise AssertionError("Team leaderboard must retain exactly three analytics ranges")
    if team_card.get_by_text("Last 360 days", exact=True).count() != 0:
        raise AssertionError("Team leaderboard must not use the ordinary 360-day range set")
    team_leaderboard_after = len(codex_team_leaderboard_api_call_payloads(state))
    if team_leaderboard_after - team_leaderboard_before != 3:
        raise AssertionError(
            "Team leaderboard analytics must retain three date-range requests, "
            f"saw delta={team_leaderboard_after - team_leaderboard_before}"
        )

    xai_card = page.get_by_text("xai-smoke.json", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'fileCard')][1]"
    )
    xai_card.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "POST"
        and response.url.endswith("/v0/management/api-call")
    ):
        xai_card.get_by_role("button", name="Click here to refresh quota").click()
    xai_card.get_by_text("Weekly limit", exact=True).wait_for()
    xai_card.get_by_text("Used 40%", exact=True).wait_for()
    weekly_row = xai_card.get_by_text("Weekly limit", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'quotaRow')][1]"
    )
    weekly_row.get_by_text(re.compile(r"^Resets ", re.I)).wait_for()
    if " ~ " in weekly_row.inner_text():
        raise AssertionError("xAI weekly quota still renders the redundant full period range")
    xai_card.get_by_text("Grok 4 usage", exact=True).wait_for()
    xai_card.get_by_text("Used 25%", exact=True).wait_for()
    xai_card.get_by_text("Pay as you go", exact=True).wait_for()
    xai_card.get_by_text("$25.00 / $25.00", exact=False).wait_for()
    xai_card.get_by_text("Prepaid credits", exact=True).wait_for()
    xai_card.get_by_text("Auto top-up", exact=True).wait_for()
    xai_card.get_by_text("Enabled, $7.50 per top-up", exact=False).wait_for()
    auto_topup_cap = xai_card.get_by_text("Auto top-up monthly cap", exact=True).locator(
        "xpath=ancestor::div[contains(@class, 'codexPlan')][1]"
    )
    auto_topup_cap.get_by_text("$25.00", exact=True).wait_for()
    xai_card.get_by_text("Unified billing", exact=True).wait_for()
    xai_card.get_by_text("$38.00 / $50.00", exact=False).wait_for()


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


def run_usage_pricing_entry_smoke(page: Any) -> None:
    page.get_by_text("Local API-equivalent estimate", exact=True).wait_for()
    page.get_by_text("Partial local estimate:", exact=False).first.wait_for()
    pricing_buttons = page.get_by_role("button", name="Configure pricing", exact=True)
    if pricing_buttons.count() < 2:
        raise AssertionError(
            "Usage page must expose pricing from the cost summary and trend/entry surfaces"
        )

    # Aggregate/detail reconciliation is available for All Time; bounded windows are
    # detail-derived because aggregate-only Tokens have no timestamp attribution.
    page_time_range = page.get_by_label("Time Range", exact=True).first
    page_time_range.click()
    page.get_by_role("option", name="All Time", exact=True).click()
    page.get_by_text(
        "The local estimate is incomplete; unmatched, unsupported, or detail-less usage is excluded.",
        exact=True,
    ).first.wait_for()
    page_time_range.click()
    page.get_by_role("option", name="Last 24 Hours", exact=True).click()


def run_usage_pricing_empty_catalog_smoke(context: Any, app_url: str) -> None:
    empty_usage_payload = {
        "usage": {
            "total_requests": 0,
            "success_count": 0,
            "failure_count": 0,
            "total_tokens": 0,
            "apis": {},
        }
    }
    page = context.new_page()
    page.set_default_timeout(15_000)
    page.route(
        "**/v0/management/usage",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(empty_usage_payload),
        ),
    )

    try:
        page.goto(
            f"{app_url}?route=pricing-empty-catalog#/usage/pricing",
            wait_until="domcontentloaded",
        )
        page.get_by_role("heading", name="Pricing workspace", exact=True).wait_for()
        catalog = page.locator('[data-testid="preset-pricing-catalog"]')
        catalog.wait_for()
        page.get_by_text("No usage models yet", exact=True).wait_for()

        summary = page.locator('[aria-label="Pricing coverage summary"]')
        summary.wait_for()
        summary_text = summary.inner_text()
        if "No usage requests" not in summary_text or "0.0%" in summary_text:
            raise AssertionError(
                "Empty local estimate coverage was presented as zero percent instead of unavailable: "
                f"{summary_text!r}"
            )

        preset_models = catalog.locator('[data-testid="preset-pricing-model"]')
        expected_model_count = int(catalog.get_attribute("data-model-count") or "0")
        if expected_model_count <= 0 or preset_models.count() != expected_model_count:
            raise AssertionError(
                "Empty-usage preset catalog did not render every catalog model: "
                f"expected {expected_model_count}, found {preset_models.count()}"
            )
        if page.locator('[data-testid="pricing-model-row"]').count() != 0:
            raise AssertionError("Empty usage unexpectedly produced usage-backed pricing rows")

        for model_name in [
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
            "glm-5.2",
            "kimi-k3",
            "kimi-k3-256k",
            "kimi-k2.7-code",
            "kimi-k2.7-code-highspeed",
            "grok-4.5",
            "grok-4.6",
            "claude-haiku-4-5-20251001",
            "claude-sonnet-4-5-20250929",
            "claude-sonnet-4-6",
            "claude-sonnet-5",
            "claude-opus-4-5-20251101",
            "claude-opus-4-6",
            "claude-opus-4-7",
            "claude-opus-4-8",
            "claude-opus-5",
            "claude-fable-5",
        ]:
            catalog.locator(
                f'[data-testid="preset-pricing-model"][data-model="{model_name}"]'
            ).wait_for()

        catalog_rows = catalog.locator("tbody tr")
        for index in range(catalog_rows.count()):
            row = catalog_rows.nth(index)
            if row.locator('[data-testid="pricing-official-source"]').count() != 1:
                raise AssertionError(
                    f"Preset catalog row {index} does not expose exactly one official source"
                )

        glm_row = catalog.locator(
            '[data-testid="preset-pricing-model"][data-model="glm-5.2"] '
            'tr[data-context-band="short"]'
        )
        for label, expected_rate in [
            ("Input", "$1.4"),
            ("Cached input", "$0.26"),
            ("Cache write", "$0"),
            ("Output", "$4.4"),
        ]:
            actual_rate = (
                glm_row.locator(f'td[data-label="{label}"] strong').first.text_content() or ""
            )
            if actual_rate != expected_rate:
                raise AssertionError(
                    f"GLM-5.2 {label} rate is {actual_rate!r}, expected {expected_rate!r}"
                )
        if "Unavailable" not in (
            glm_row.locator('td[data-label="Fast policies"]').text_content() or ""
        ):
            raise AssertionError("GLM-5.2 catalog row did not expose Fast as unavailable")

        glm_official = glm_row.locator('[data-testid="pricing-official-source"]')
        if (
            (glm_official.text_content() or "").strip() != "Official source"
            or glm_official.get_attribute("href")
            != "https://docs.z.ai/guides/overview/pricing"
        ):
            raise AssertionError("GLM-5.2 Official source does not point to the Z.AI pricing table")
        glm_notes = glm_row.locator('[data-testid="pricing-notes-source"]')
        if (
            glm_notes.count() != 1
            or (glm_notes.text_content() or "").strip() != "Model notes"
            or glm_notes.get_attribute("href") != "https://docs.z.ai/guides/llm/glm-5.2"
        ):
            raise AssertionError("GLM-5.2 Model notes does not point to the model overview")

        for model_name, expected_rates, expected_source in [
            (
                "kimi-k3",
                {"Input": "$3", "Cached input": "$0.3", "Output": "$15"},
                "https://platform.kimi.ai/docs/pricing/chat-k3",
            ),
            (
                "kimi-k3-256k",
                {"Input": "$1.5", "Cached input": "$0.15", "Output": "$7.5"},
                "https://platform.kimi.ai/docs/pricing/chat-k3",
            ),
            (
                "kimi-k2.7-code",
                {"Input": "$0.95", "Cached input": "$0.19", "Output": "$4"},
                "https://platform.kimi.ai/docs/pricing/chat-k27-code",
            ),
            (
                "kimi-k2.7-code-highspeed",
                {"Input": "$1.9", "Cached input": "$0.38", "Output": "$8"},
                "https://platform.kimi.ai/docs/pricing/chat-k27-code",
            ),
        ]:
            kimi_row = catalog.locator(
                f'[data-testid="preset-pricing-model"][data-model="{model_name}"] '
                'tr[data-context-band="short"]'
            )
            for label, expected_rate in expected_rates.items():
                actual_rate = (
                    kimi_row.locator(f'td[data-label="{label}"] strong')
                    .first.text_content()
                    or ""
                )
                if actual_rate != expected_rate:
                    raise AssertionError(
                        f"{model_name} {label} rate is {actual_rate!r}, expected {expected_rate!r}"
                    )

            cache_write = kimi_row.locator('td[data-label="Cache write"]')
            actual_cache_write_label = cache_write.locator("strong").text_content() or ""
            actual_cache_write_rate = cache_write.locator("small").text_content() or ""
            if (
                actual_cache_write_label != "Auto / input rate"
                or actual_cache_write_rate != expected_rates["Input"]
            ):
                raise AssertionError(
                    f"{model_name} Cache write did not inherit the Cache Miss/Input rate: "
                    f"label={actual_cache_write_label!r}, rate={actual_cache_write_rate!r}, "
                    f"expected rate={expected_rates['Input']!r}"
                )
            if "Unavailable" not in (
                kimi_row.locator('td[data-label="Fast policies"]').text_content() or ""
            ):
                raise AssertionError(f"{model_name} catalog row did not expose Fast as unavailable")
            if (
                kimi_row.locator('[data-testid="pricing-official-source"]').get_attribute("href")
                != expected_source
            ):
                raise AssertionError(f"{model_name} Official source does not point to Kimi pricing")

        for model_name, expected_aliases in [
            ("kimi-k3", ["k3"]),
            ("kimi-k3-256k", ["k3-256k"]),
            ("kimi-k2.7-code", ["kimi-for-coding"]),
            (
                "kimi-k2.7-code-highspeed",
                ["kimi-for-coding-highspee", "kimi-for-coding-highspeed"],
            ),
        ]:
            model_text = (
                catalog.locator(
                    f'[data-testid="preset-pricing-model"][data-model="{model_name}"]'
                ).inner_text()
                or ""
            )
            for alias in expected_aliases:
                if alias not in model_text:
                    raise AssertionError(f"{model_name} catalog row is missing alias {alias}")

        anthropic_source = "https://platform.claude.com/docs/en/about-claude/pricing"
        anthropic_notes = (
            "https://platform.claude.com/docs/en/about-claude/models/"
            "model-ids-and-versions"
        )
        for model_name, expected_aliases, expected_rates in [
            (
                "claude-haiku-4-5-20251001",
                ["claude-haiku-4-5"],
                {"Input": "$1", "Cached input": "$0.1", "Cache write": "$1.25", "Output": "$5"},
            ),
            (
                "claude-sonnet-4-5-20250929",
                ["claude-sonnet-4-5"],
                {"Input": "$3", "Cached input": "$0.3", "Cache write": "$3.75", "Output": "$15"},
            ),
            (
                "claude-sonnet-4-6",
                [],
                {"Input": "$3", "Cached input": "$0.3", "Cache write": "$3.75", "Output": "$15"},
            ),
            (
                "claude-sonnet-5",
                [],
                {"Input": "$3", "Cached input": "$0.3", "Cache write": "$3.75", "Output": "$15"},
            ),
            (
                "claude-opus-4-5-20251101",
                ["claude-opus-4-5"],
                {"Input": "$5", "Cached input": "$0.5", "Cache write": "$6.25", "Output": "$25"},
            ),
            (
                "claude-opus-4-6",
                [],
                {"Input": "$5", "Cached input": "$0.5", "Cache write": "$6.25", "Output": "$25"},
            ),
            (
                "claude-opus-4-7",
                [],
                {"Input": "$5", "Cached input": "$0.5", "Cache write": "$6.25", "Output": "$25"},
            ),
            (
                "claude-opus-4-8",
                [],
                {"Input": "$5", "Cached input": "$0.5", "Cache write": "$6.25", "Output": "$25"},
            ),
            (
                "claude-opus-5",
                [],
                {"Input": "$5", "Cached input": "$0.5", "Cache write": "$6.25", "Output": "$25"},
            ),
            (
                "claude-fable-5",
                [],
                {"Input": "$10", "Cached input": "$1", "Cache write": "$12.5", "Output": "$50"},
            ),
        ]:
            claude_model = catalog.locator(
                f'[data-testid="preset-pricing-model"][data-model="{model_name}"]'
            )
            if claude_model.locator("tr").count() != 1:
                raise AssertionError(f"{model_name} must expose one standard rate card")
            claude_row = claude_model.locator('tr[data-context-band="short"]')
            for label, expected_rate in expected_rates.items():
                actual_rate = (
                    claude_row.locator(f'td[data-label="{label}"] strong').text_content()
                    or ""
                )
                if actual_rate != expected_rate:
                    raise AssertionError(
                        f"{model_name} {label} rate is {actual_rate!r}, expected {expected_rate!r}"
                    )
            if "Unavailable" not in (
                claude_row.locator('td[data-label="Fast policies"]').text_content() or ""
            ):
                raise AssertionError(f"{model_name} catalog row did not keep Fast unavailable")
            model_text = claude_model.inner_text() or ""
            for alias in expected_aliases:
                if alias not in model_text:
                    raise AssertionError(f"{model_name} catalog row is missing alias {alias}")
            if (
                claude_model.locator('[data-testid="pricing-official-source"]').get_attribute(
                    "href"
                )
                != anthropic_source
            ):
                raise AssertionError(f"{model_name} Official source does not point to Anthropic")
            if (
                claude_model.locator('[data-testid="pricing-notes-source"]').get_attribute("href")
                != anthropic_notes
            ):
                raise AssertionError(f"{model_name} Model notes do not point to Anthropic IDs")

        grok_model = catalog.locator(
            '[data-testid="preset-pricing-model"][data-model="grok-4.5"]'
        )
        grok_rows = grok_model.locator("tr")
        if grok_rows.count() != 2:
            raise AssertionError("Grok 4.5 catalog did not render short and long-context rows")
        for band, expected_rates in [
            ("short", {"Input": "$2", "Cached input": "$0.3", "Output": "$6"}),
            ("long", {"Input": "$4", "Cached input": "$0.6", "Output": "$12"}),
        ]:
            grok_row = grok_model.locator(f'tr[data-context-band="{band}"]')
            for label, expected_rate in expected_rates.items():
                actual_rate = (
                    grok_row.locator(f'td[data-label="{label}"] strong')
                    .first.text_content()
                    or ""
                )
                if actual_rate != expected_rate:
                    raise AssertionError(
                        f"Grok 4.5 {band} {label} rate is {actual_rate!r}, "
                        f"expected {expected_rate!r}"
                    )
            cache_write = grok_row.locator('td[data-label="Cache write"]')
            if (
                (cache_write.locator("strong").text_content() or "")
                != "Auto / input rate"
                or (cache_write.locator("small").text_content() or "")
                != expected_rates["Input"]
            ):
                raise AssertionError(
                    f"Grok 4.5 {band} Cache write did not inherit the Input rate"
                )
            if "Unavailable" not in (
                grok_row.locator('td[data-label="Fast policies"]').text_content() or ""
            ):
                raise AssertionError(f"Grok 4.5 {band} row did not expose Fast as unavailable")

        grok_text = grok_model.inner_text()
        if "200.0K" not in grok_text:
            raise AssertionError("Grok 4.5 catalog did not expose the 200K pricing threshold")
        if (
            grok_model.locator(
                '[data-testid="pricing-official-source"]'
            ).first.get_attribute("href")
            != "https://docs.x.ai/developers/models/grok-4.5"
        ):
            raise AssertionError("Grok 4.5 Official source does not point to xAI model pricing")

        grok46_model = catalog.locator(
            '[data-testid="preset-pricing-model"][data-model="grok-4.6"]'
        )
        grok46_rows = grok46_model.locator("tr")
        if grok46_rows.count() != 2:
            raise AssertionError("Grok 4.6 catalog did not render short and long-context rows")
        for band, expected_rates in [
            ("short", {"Input": "$2", "Cached input": "$0.5", "Output": "$6"}),
            ("long", {"Input": "$4", "Cached input": "$1", "Output": "$12"}),
        ]:
            grok46_row = grok46_model.locator(f'tr[data-context-band="{band}"]')
            for label, expected_rate in expected_rates.items():
                actual_rate = (
                    grok46_row.locator(f'td[data-label="{label}"] strong')
                    .first.text_content()
                    or ""
                )
                if actual_rate != expected_rate:
                    raise AssertionError(
                        f"Grok 4.6 {band} {label} rate is {actual_rate!r}, "
                        f"expected {expected_rate!r}"
                    )
            cache_write = grok46_row.locator('td[data-label="Cache write"]')
            if (
                (cache_write.locator("strong").text_content() or "")
                != "Auto / input rate"
                or (cache_write.locator("small").text_content() or "")
                != expected_rates["Input"]
            ):
                raise AssertionError(
                    f"Grok 4.6 {band} Cache write did not inherit the Input rate"
                )
            if "Unavailable" not in (
                grok46_row.locator('td[data-label="Fast policies"]').text_content() or ""
            ):
                raise AssertionError(f"Grok 4.6 {band} row did not expose Fast as unavailable")

        grok46_text = grok46_model.inner_text()
        if "200.0K" not in grok46_text:
            raise AssertionError("Grok 4.6 catalog did not expose the 200K pricing threshold")
        if (
            grok46_model.locator(
                '[data-testid="pricing-official-source"]'
            ).first.get_attribute("href")
            != "https://docs.x.ai/developers/models/grok-4.6"
        ):
            raise AssertionError("Grok 4.6 Official source does not point to xAI model pricing")

        long_context_cell_text = (
            catalog.locator(
                '[data-testid="preset-pricing-model"][data-model="gpt-5.6-sol"] '
                'tr[data-context-band="long"] td'
            )
            .nth(1)
            .text_content()
            or ""
        )
        if "gpt-5.6-sol" not in long_context_cell_text:
            raise AssertionError(
                "Mobile-hidden long-context model identity is missing from accessible text"
            )

        for column_name in ["Input", "Cached input", "Cache write", "Output"]:
            catalog.get_by_role(
                "columnheader", name=column_name, exact=True
            ).wait_for()

        catalog_text = catalog.inner_text()
        for expected_text in [
            "Short context",
            "Long context",
            "Official API ×2.50",
            "Fast long context unsupported",
        ]:
            if expected_text not in catalog_text:
                raise AssertionError(
                    f"Empty-usage preset catalog is missing {expected_text!r}: {catalog_text!r}"
                )

        table_region = catalog.get_by_role(
            "region", name="Complete preset price table", exact=True
        )
        table_region.focus()
        if not table_region.evaluate("region => document.activeElement === region"):
            raise AssertionError("Preset catalog table region is not keyboard focusable")
        if table_region.evaluate("region => getComputedStyle(region).outlineStyle") == "none":
            raise AssertionError("Preset catalog table region has no keyboard focus indicator")

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_function("() => window.matchMedia('(max-width: 768px)').matches")

        def assert_mobile_catalog_layout(locale_name: str) -> None:
            mobile_metrics = catalog.evaluate(
                """catalog => ({
                  documentClientWidth: document.documentElement.clientWidth,
                  documentScrollWidth: document.documentElement.scrollWidth,
                  modelGroups: Array.from(
                    catalog.querySelectorAll('[data-testid="preset-pricing-model"]')
                  ).map((group) => {
                    const rect = group.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, width: rect.width };
                  }),
                })"""
            )
            if (
                mobile_metrics["documentScrollWidth"]
                > mobile_metrics["documentClientWidth"] + 1
            ):
                raise AssertionError(
                    f"{locale_name} preset catalog causes page overflow at 390px: "
                    f"{mobile_metrics!r}"
                )
            if any(
                group["left"] < -1
                or group["right"] > mobile_metrics["documentClientWidth"] + 1
                or group["width"] <= 0
                for group in mobile_metrics["modelGroups"]
            ):
                raise AssertionError(
                    f"{locale_name} preset catalog cards are clipped at 390px: "
                    f"{mobile_metrics!r}"
                )

        assert_mobile_catalog_layout("English")
        language_button = page.locator(".language-menu > button")
        for menu_name, catalog_title, locale_name in [
            ("Русский", "Таблица предустановленных цен", "Russian"),
            ("中文", "预设价格表", "Simplified Chinese"),
        ]:
            language_button.click()
            page.get_by_role("menuitemradio", name=menu_name, exact=True).click()
            catalog.get_by_role("heading", name=catalog_title, exact=True).wait_for()
            assert_mobile_catalog_layout(locale_name)

        language_button.click()
        page.get_by_role("menuitemradio", name="English", exact=True).click()
    finally:
        page.close()


def run_usage_pricing_smoke(page: Any) -> None:
    page.get_by_role("heading", name="Pricing workspace", exact=True).wait_for()
    page.get_by_text(
        "Local API-equivalent estimates are references, not provider invoices.", exact=True
    ).wait_for()
    page.get_by_text("The profile is stored only in this browser", exact=False).wait_for()
    migration_state = page.evaluate(
        """() => ({
          v2: localStorage.getItem('cli-proxy-model-prices-v2'),
          v3: localStorage.getItem('cli-proxy-model-prices-v3'),
        })"""
    )
    if migration_state["v2"] is not None or not migration_state["v3"]:
        raise AssertionError(
            f"V2 pricing was not durably migrated and removed: {migration_state!r}"
        )
    migrated_profile = json.loads(migration_state["v3"])
    if sorted(migrated_profile.get("overrides", {})) != ["gpt-5.4", "gpt-5.6-sol"]:
        raise AssertionError(
            "V2 migration silently changed or discarded legacy overrides: "
            f"{migrated_profile!r}"
        )
    page.get_by_text(
        re.compile(r"Legacy-shaped custom entries matching preset short rates: 1")
    ).wait_for()
    page.get_by_role("button", name="Use complete presets", exact=True).click()
    migration_recovery_dialog = page.get_by_role("dialog", name="Use complete presets")
    migration_recovery_dialog.wait_for()
    migration_recovery_dialog.get_by_role("button", name="Cancel", exact=True).click()
    migration_recovery_dialog.wait_for(state="detached")
    cancelled_profile = page.evaluate(
        "() => JSON.parse(localStorage.getItem('cli-proxy-model-prices-v3'))"
    )
    if sorted(cancelled_profile.get("overrides", {})) != ["gpt-5.4", "gpt-5.6-sol"]:
        raise AssertionError("Cancelling preset recovery changed the persisted profile")
    page.get_by_role("button", name="Use complete presets", exact=True).click()
    migration_recovery_dialog = page.get_by_role("dialog", name="Use complete presets")
    migration_recovery_dialog.get_by_role(
        "button", name="Use complete presets", exact=True
    ).click()
    page.get_by_text(
        "Complete presets applied to 1 matching entries", exact=True
    ).last.wait_for()
    migrated_profile = page.evaluate(
        "() => JSON.parse(localStorage.getItem('cli-proxy-model-prices-v3'))"
    )
    if sorted(migrated_profile.get("overrides", {})) != ["gpt-5.6-sol"]:
        raise AssertionError(
            "Confirmed preset recovery did not preserve the real custom override: "
            f"{migrated_profile!r}"
        )

    summary = page.locator('[aria-label="Pricing coverage summary"]')
    summary.wait_for()
    summary_text = summary.inner_text()
    for expected in [
        "6 / 8 requests",
        "75.0%",
    ]:
        if expected not in summary_text:
            raise AssertionError(
                f"Pricing summary missing {expected!r}: {summary_text!r}"
            )
    if not re.search(r"\$\d", summary_text):
        raise AssertionError(
            f"Browser-local pricing did not produce an amount for matched usage: {summary_text!r}"
        )

    rows = page.locator('[data-testid="pricing-model-row"]')

    def wait_for_model_rows(expected: int) -> None:
        for _ in range(50):
            if rows.count() == expected:
                return
            page.wait_for_timeout(100)
        raise AssertionError(f"Expected {expected} pricing model row(s), found {rows.count()}")

    wait_for_model_rows(3)
    for model_name in ["gpt-5.6-sol", "gpt-5.4", "vendor/unmatched-model"]:
        page.locator(f'[data-testid="pricing-model-row"][data-model="{model_name}"]').wait_for()

    gpt54_row = page.locator('[data-testid="pricing-model-row"][data-model="gpt-5.4"]')
    gpt54_text = gpt54_row.text_content() or ""
    for expected in [
        "Needs review",
        "Fast long context unsupported",
        "Official API ×2.00",
    ]:
        if expected not in gpt54_text:
            raise AssertionError(
                f"Long-context pricing anomaly is not visible in the model row: {gpt54_text!r}"
            )

    filter_select = page.get_by_label("Pricing status filter", exact=True)
    filter_select.click()
    page.get_by_role("option", name="Locally unmatched", exact=True).click()
    wait_for_model_rows(1)
    if "vendor/unmatched-model" not in rows.first.inner_text():
        raise AssertionError("Unmatched pricing filter returned the wrong model set")
    filter_select.click()
    page.get_by_role("option", name="All", exact=True).click()
    wait_for_model_rows(3)

    search = page.get_by_label("Search actual usage models", exact=True)
    search.fill("vendor")
    wait_for_model_rows(1)
    if "vendor/unmatched-model" not in rows.first.inner_text():
        raise AssertionError("Pricing model search returned the wrong model set")
    search.fill("")
    wait_for_model_rows(3)

    gpt56_row = page.locator('[data-testid="pricing-model-row"][data-model="gpt-5.6-sol"]')
    gpt56_local_amount = gpt56_row.locator(
        '[data-label="Local API-equivalent amount"]'
    ).inner_text()
    if "$" not in gpt56_local_amount or "100.0%" not in gpt56_local_amount:
        raise AssertionError(
            f"GPT-5.6 usage was not fully included in the browser-local estimate: {gpt56_local_amount!r}"
        )
    gpt56_row.click()
    editor = page.locator('[data-testid="pricing-editor"]')
    editor.wait_for()
    editor.get_by_text("Custom", exact=True).first.wait_for()
    editor.get_by_role("button", name="Restore preset", exact=True).click()
    page.get_by_text("Preset restored", exact=True).last.wait_for()

    storage_after_restore = page.evaluate(
        """() => ({
          v2: localStorage.getItem('cli-proxy-model-prices-v2'),
          v3: JSON.parse(localStorage.getItem('cli-proxy-model-prices-v3')),
        })"""
    )
    if storage_after_restore["v2"] is not None:
        raise AssertionError("Persisted v3 migration left the obsolete v2 storage key behind")
    if storage_after_restore["v3"]["overrides"]:
        raise AssertionError("Restoring a preset did not clear the migrated override")
    restored_gpt56_text = gpt56_row.inner_text()
    for expected in ["Official API ×2.00"]:
        if expected not in restored_gpt56_text:
            raise AssertionError(
                f"Restored GPT-5.6 row lost separate Fast policies: {restored_gpt56_text!r}"
            )

    fast_mode = editor.get_by_label("Fast rates · USD / 1M", exact=True)
    fast_mode.click()
    page.get_by_role("option", name="Standard × multiplier", exact=True).click()
    editor.get_by_label("Fast multiplier", exact=True).fill("3")
    editor.get_by_role("button", name="Save", exact=True).click()
    page.get_by_text("Pricing profile saved", exact=True).last.wait_for()

    stored_multiplier = page.evaluate(
        """() => JSON.parse(localStorage.getItem('cli-proxy-model-prices-v3'))
          .overrides['gpt-5.6-sol'].fast.multiplier"""
    )
    if stored_multiplier != 3:
        raise AssertionError(f"Fast multiplier was not persisted: {stored_multiplier!r}")
    if "Custom API ×3.00" not in gpt56_row.inner_text():
        raise AssertionError("Custom Fast multiplier was presented as an official policy")

    with page.expect_download() as profile_download:
        page.get_by_role("button", name="Export profile", exact=True).click()
    profile_path = profile_download.value.path()
    if not profile_path:
        raise AssertionError("Pricing profile export did not create a download")
    exported_profile = json.loads(Path(profile_path).read_text(encoding="utf-8"))
    if exported_profile.get("schemaVersion") != 3:
        raise AssertionError(f"Pricing profile export lost schema v3: {exported_profile!r}")
    if exported_profile.get("overrides", {}).get("gpt-5.6-sol", {}).get("fast", {}).get(
        "multiplier"
    ) != 3:
        raise AssertionError("Pricing profile export lost the Fast multiplier")

    fast_mode.click()
    page.get_by_role("option", name="Explicit rates", exact=True).click()
    fast_section = editor.locator("fieldset").filter(has_text="Fast rates · USD / 1M")
    fast_section.get_by_label("Input", exact=True).fill("10")
    fast_section.get_by_label("Cached input", exact=True).fill("1")
    fast_section.get_by_label("Cache write", exact=True).fill("12.5")
    fast_section.get_by_label("Output", exact=True).fill("40")
    editor.get_by_role("button", name="Save", exact=True).click()
    page.get_by_text("Pricing profile saved", exact=True).last.wait_for()
    explicit_row_text = gpt56_row.inner_text()
    if "API explicit rates" not in explicit_row_text or "Custom API ×" in explicit_row_text:
        raise AssertionError(
            f"Explicit Fast rates were collapsed into one multiplier: {explicit_row_text!r}"
        )

    unmatched_row = page.locator(
        '[data-testid="pricing-model-row"][data-model="vendor/unmatched-model"]'
    )
    unmatched_row.click()
    editor = page.locator('[data-testid="pricing-editor"]')
    editor.get_by_label("Exact alias target", exact=True).fill("gpt-5.4")
    editor.get_by_role("button", name="Save", exact=True).click()
    page.get_by_text("Pricing profile saved", exact=True).last.wait_for()
    unmatched_text = unmatched_row.inner_text()
    for expected in ["Custom", "Alias"]:
        if expected not in unmatched_text:
            raise AssertionError(
                f"Saved pricing alias is not visible in the model row: {unmatched_text!r}"
            )
    summary.get_by_text("7 / 8 requests", exact=True).wait_for()
    summary.get_by_text("87.5%", exact=True).first.wait_for()

    editor.get_by_role("button", name="Delete configuration", exact=True).click()
    page.get_by_text("Custom pricing removed", exact=True).last.wait_for()
    if "Unmatched" not in unmatched_row.inner_text():
        raise AssertionError("Deleting the alias did not return the model to unmatched")

    imported_profile = json.loads(json.dumps(exported_profile))
    imported_profile.setdefault("aliases", {})["vendor/unmatched-model"] = "gpt-5.4"
    page.locator('input[type="file"][accept*="json"]').set_input_files(
        {
            "name": "pricing-profile-v3.json",
            "mimeType": "application/json",
            "buffer": json.dumps(imported_profile).encode("utf-8"),
        }
    )
    import_dialog = page.get_by_role("dialog", name="Import pricing profile")
    import_dialog.wait_for()
    import_dialog.get_by_role("button", name="Import profile", exact=True).click()
    page.get_by_text("Pricing profile imported", exact=True).last.wait_for()
    if "Alias" not in unmatched_row.inner_text():
        raise AssertionError("Imported pricing alias was not applied")

    page.get_by_role("button", name="Restore all defaults", exact=True).click()
    reset_dialog = page.get_by_role("dialog", name="Restore all preset prices")
    reset_dialog.wait_for()
    reset_dialog.get_by_role("button", name="Restore all defaults", exact=True).click()
    page.get_by_text("Preset pricing restored", exact=True).last.wait_for()
    storage_after_reset = page.evaluate(
        """() => ({
          v2: localStorage.getItem('cli-proxy-model-prices-v2'),
          v3: JSON.parse(localStorage.getItem('cli-proxy-model-prices-v3')),
        })"""
    )
    if storage_after_reset["v2"] is not None:
        raise AssertionError("Resetting pricing restored the obsolete v2 storage key")
    if storage_after_reset["v3"]["overrides"] or storage_after_reset["v3"]["aliases"]:
        raise AssertionError("Resetting pricing did not clear v3 overrides and aliases")

    page.evaluate(
        """() => localStorage.setItem(
          'cli-proxy-model-prices-v3',
          JSON.stringify({
            schemaVersion: 3,
            currency: 'USD',
            assumptions: { historicalPricing: 'current', unknownServiceTier: 'standard' },
            aliases: {},
            overrides: {
              'gpt-5.6-sol': {
                standard: {
                  short: {
                    input: 5,
                    cachedInput: 0.5,
                    cacheWrite: 6.25,
                    output: 30
                  }
                }
              },
              'grok-4.5': {
                standard: {
                  short: { input: 2, cachedInput: 0, output: 6 }
                }
              }
            }
          })
        )"""
    )
    page.reload(wait_until="domcontentloaded")
    page.get_by_role("heading", name="Pricing workspace", exact=True).wait_for()
    recovery_notice = page.get_by_text(
        re.compile(r"Legacy-shaped custom entries matching preset short rates: 1")
    )
    recovery_notice.wait_for()
    page.set_viewport_size({"width": 390, "height": 844})

    def assert_recovery_notice_layout(locale_name: str) -> None:
        recovery_metrics = page.locator('[data-testid="pricing-preset-recovery"]').evaluate(
            """notice => {
              const noticeRect = notice.getBoundingClientRect();
              const buttonRect = notice.querySelector('button').getBoundingClientRect();
              return {
                documentClientWidth: document.documentElement.clientWidth,
                documentScrollWidth: document.documentElement.scrollWidth,
                noticeLeft: noticeRect.left,
                noticeRight: noticeRect.right,
                buttonLeft: buttonRect.left,
                buttonRight: buttonRect.right,
              };
            }"""
        )
        if (
            recovery_metrics["documentScrollWidth"]
            > recovery_metrics["documentClientWidth"] + 1
            or recovery_metrics["noticeLeft"] < -1
            or recovery_metrics["noticeRight"]
            > recovery_metrics["documentClientWidth"] + 1
            or recovery_metrics["buttonLeft"] < -1
            or recovery_metrics["buttonRight"]
            > recovery_metrics["documentClientWidth"] + 1
        ):
            raise AssertionError(
                f"{locale_name} preset recovery notice overflowed at 390px: "
                f"{recovery_metrics!r}"
            )

    assert_recovery_notice_layout("English")
    language_button = page.locator(".language-menu > button")
    language_button.click()
    page.get_by_role("menuitemradio", name="Русский", exact=True).click()
    page.get_by_role(
        "button", name="Использовать предустановки", exact=True
    ).wait_for()
    assert_recovery_notice_layout("Russian")
    language_button.click()
    page.get_by_role("menuitemradio", name="English", exact=True).click()
    page.get_by_role("button", name="Use complete presets", exact=True).click()
    recovery_dialog = page.get_by_role("dialog", name="Use complete presets")
    recovery_dialog.wait_for()
    recovery_dialog.get_by_role("button", name="Use complete presets", exact=True).click()
    page.get_by_text(
        "Complete presets applied to 1 matching entries", exact=True
    ).last.wait_for()
    recovered_profile = page.evaluate(
        "() => JSON.parse(localStorage.getItem('cli-proxy-model-prices-v3'))"
    )
    if sorted(recovered_profile.get("overrides", {})) != ["grok-4.5"]:
        raise AssertionError(
            "Preset-equivalent v3 recovery removed real custom data or kept the matching override: "
            f"{recovered_profile!r}"
        )
    if "Official API ×2.00" not in gpt56_row.inner_text():
        raise AssertionError("Recovered GPT-5.6 pricing did not inherit the official Fast policy")

    page.set_viewport_size({"width": 1024, "height": 768})
    page.wait_for_function("() => window.matchMedia('(max-width: 1279px)').matches")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"pricing-editor\"]') === null"
    )
    gpt54_row.click()
    compact_dialog = page.get_by_role("dialog", name="gpt-5.4")
    compact_dialog.wait_for()
    compact_dialog.get_by_text("Fast rates · USD / 1M", exact=True).wait_for()
    page.keyboard.press("Escape")
    compact_dialog.wait_for(state="detached")
    page.wait_for_function(
        "row => document.activeElement === row",
        arg=gpt54_row.element_handle(),
    )

    language_button = page.locator(".language-menu > button")
    language_button.click()
    page.get_by_role("menuitemradio", name="Русский", exact=True).click()

    page.set_viewport_size({"width": 390, "height": 844})
    russian_summary = page.get_by_label("Сводка покрытия цен", exact=True)
    russian_summary.wait_for()
    mobile_summary_metrics = russian_summary.evaluate(
        """summary => ({
          columns: getComputedStyle(summary).gridTemplateColumns.split(' ').length,
          textOverflows: Array.from(summary.querySelectorAll('span, small')).filter((node) => {
            const style = getComputedStyle(node);
            return style.whiteSpace === 'nowrap' || node.scrollWidth > node.clientWidth + 1;
          }).map((node) => node.textContent?.trim()),
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
        })"""
    )
    if mobile_summary_metrics["columns"] != 1 or mobile_summary_metrics["textOverflows"]:
        raise AssertionError(
            f"Russian pricing summary is truncated at 390px: {mobile_summary_metrics!r}"
        )
    if (
        mobile_summary_metrics["documentScrollWidth"]
        > mobile_summary_metrics["documentClientWidth"] + 1
    ):
        raise AssertionError(
            f"Pricing workspace overflows at 390px: {mobile_summary_metrics!r}"
        )

    page.set_viewport_size({"width": 769, "height": 900})
    toolbar_actions = page.get_by_role(
        "button", name="Импортировать профиль", exact=True
    ).locator("xpath=..")
    toolbar_metrics = toolbar_actions.evaluate(
        """actions => {
          const bounds = actions.getBoundingClientRect();
          return {
            clientWidth: actions.clientWidth,
            scrollWidth: actions.scrollWidth,
            buttons: Array.from(actions.querySelectorAll('button')).map((button) => {
              const rect = button.getBoundingClientRect();
              return { text: button.textContent?.trim(), left: rect.left, right: rect.right };
            }),
            left: bounds.left,
            right: bounds.right,
          };
        }"""
    )
    if toolbar_metrics["scrollWidth"] > toolbar_metrics["clientWidth"] + 1 or any(
        button["left"] < toolbar_metrics["left"] - 1
        or button["right"] > toolbar_metrics["right"] + 1
        for button in toolbar_metrics["buttons"]
    ):
        raise AssertionError(
            f"Russian pricing toolbar is clipped at 769px: {toolbar_metrics!r}"
        )

    language_button.click()
    page.get_by_role("menuitemradio", name="English", exact=True).click()
    page.set_viewport_size({"width": 1280, "height": 720})
    page.wait_for_function("() => !window.matchMedia('(max-width: 1279px)').matches")
    page.locator('[data-testid="pricing-editor"]').wait_for()


def run_usage_service_tier_smoke(page: Any) -> None:
    card = page.get_by_text("Request Events", exact=True).locator("xpath=../..")
    card.wait_for()
    table_region = card.get_by_role("region", name="Request events table", exact=True)
    table_region.wait_for()
    table_region.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    if not table_region.evaluate("region => document.activeElement === region"):
        raise AssertionError("Request-event table region is not reachable by keyboard")
    focus_outline = table_region.evaluate(
        "region => getComputedStyle(region).outlineStyle"
    )
    if focus_outline == "none":
        raise AssertionError("Request-event table region has no keyboard focus indicator")
    card.get_by_role("columnheader", name="Tier", exact=True).wait_for()
    card.get_by_role("columnheader", name="Effort", exact=True).wait_for()
    if card.get_by_role("columnheader", name="Source", exact=True).count() != 0:
        raise AssertionError("Request events must hide the Source column by default")
    if card.get_by_role("columnheader", name="Auth Index", exact=True).count() != 0:
        raise AssertionError("Request events must hide the Auth Index column by default")
    if card.get_by_role("columnheader", name="Thinking", exact=True).count() != 0:
        raise AssertionError("Request events must expose one canonical effort column")
    card.get_by_role("columnheader", name="Total Input Tokens", exact=True).wait_for()
    card.locator("th", has_text="Non-Cache-Read Input Tokens").wait_for()
    card.get_by_role("columnheader", name="Total Output Tokens", exact=True).wait_for()
    card.locator("th", has_text="Explicit Output Tokens").wait_for()
    card.get_by_role("columnheader", name="Reasoning Tokens", exact=True).wait_for()
    card.locator("th", has_text="Cache Read Tokens").wait_for()
    card.get_by_role("columnheader", name="Cache Write Tokens", exact=True).wait_for()
    card.get_by_role("columnheader", name="Total Tokens", exact=True).wait_for()
    card.get_by_role("columnheader", name="Estimated cost (USD / ¢)", exact=True).wait_for()
    cost_visuals = card.locator("td[data-request-cost-tone]").evaluate_all(
        """cells => cells.map(cell => ({
          tone: cell.getAttribute('data-request-cost-tone'),
          color: getComputedStyle(cell).color,
          marker: getComputedStyle(cell, '::before').content,
        }))"""
    )
    if any(item["marker"] not in {"none", "normal", "\"\""} for item in cost_visuals):
        raise AssertionError(f"Request-event cost cells still render a leading marker: {cost_visuals!r}")
    tone_colors = {
        item["tone"]: item["color"] for item in cost_visuals if item["tone"] is not None
    }
    required_tones = {"unavailable", "micro", "critical"}
    if not required_tones.issubset(tone_colors) or len(
        {tone_colors[tone] for tone in required_tones}
    ) != len(required_tones):
        raise AssertionError(
            f"Request-event amount text did not retain distinct colors: {tone_colors!r}"
        )

    card.get_by_role("button", name="Column Settings", exact=True).click()
    column_dialog = card.get_by_role("dialog", name="Column Settings", exact=True)
    column_dialog.wait_for()
    source_column = column_dialog.get_by_role("checkbox", name="Source", exact=True)
    auth_index_column = column_dialog.get_by_role("checkbox", name="Auth Index", exact=True)
    if source_column.is_checked() or auth_index_column.is_checked():
        raise AssertionError("Default request-event columns exposed Source or Auth Index")
    source_column.check()
    auth_index_column.check()
    card.get_by_role("columnheader", name="Source", exact=True).wait_for()
    card.get_by_role("columnheader", name="Auth Index", exact=True).wait_for()
    column_dialog.get_by_role("button", name="Restore Default Columns", exact=True).click()
    if card.get_by_role("columnheader", name="Source", exact=True).count() != 0:
        raise AssertionError("Restoring request-event columns did not hide Source")
    if card.get_by_role("columnheader", name="Auth Index", exact=True).count() != 0:
        raise AssertionError("Restoring request-event columns did not hide Auth Index")
    stored_column_state = page.evaluate(
        """() => ({
          legacyV1: localStorage.getItem('cli-proxy-usage-request-event-columns-v1'),
          legacyV2: localStorage.getItem('cli-proxy-usage-request-event-columns-v2'),
          current: JSON.parse(
            localStorage.getItem('cli-proxy-usage-request-event-columns-v3')
          ),
        })"""
    )
    stored_columns = stored_column_state["current"]
    if (
        stored_column_state["legacyV1"] is not None
        or stored_column_state["legacyV2"] is not None
    ):
        raise AssertionError("The obsolete request-event column defaults were not removed")
    expected_column_defaults = {
        "timestamp": True,
        "model": True,
        "source": False,
        "authIndex": False,
        "tier": True,
        "result": True,
        "latency": True,
        "effort": True,
        "totalInputTokens": True,
        "nonCacheReadInputTokens": True,
        "totalOutputTokens": True,
        "displayedOutputTokens": True,
        "reasoningTokens": True,
        "cacheReadTokens": True,
        "cacheWriteTokens": True,
        "totalTokens": True,
        "cost": True,
    }
    if stored_columns != expected_column_defaults:
        raise AssertionError(
            f"Request-event default columns were not persisted: {stored_columns!r}"
        )

    for checkbox in column_dialog.get_by_role("checkbox").all():
        checkbox_id = checkbox.get_attribute("id") or ""
        if checkbox_id.endswith("-timestamp") or checkbox_id.endswith("-latency"):
            continue
        if checkbox.is_checked():
            checkbox.uncheck()
    timestamp_column = column_dialog.get_by_role("checkbox", name="Timestamp", exact=True)
    if not timestamp_column.is_disabled():
        raise AssertionError(
            "Column settings allowed the last non-conditional request-event column to be hidden"
        )
    column_dialog.get_by_role("button", name="Restore Default Columns", exact=True).click()
    page.keyboard.press("Escape")

    rows = card.locator("tbody tr")

    def wait_for_row_count(expected: int) -> None:
        for _ in range(50):
            if rows.count() == expected:
                return
            page.wait_for_timeout(100)
        raise AssertionError(
            f"Expected {expected} request event row(s), found {rows.count()}"
        )

    model_select = card.get_by_label("Model", exact=True)
    model_select.click()
    page.get_by_role("option", name="gpt-5.6-sol", exact=True).click()
    wait_for_row_count(5)
    priced_cost_cells = card.locator('td[data-request-cost-status="priced"]')
    if priced_cost_cells.count() != 5:
        raise AssertionError(
            "Every matched request event must expose a priced local estimate"
        )
    if any(cell.inner_text().strip() in {"", "$0.00", "--"} for cell in priced_cost_cells.all()):
        raise AssertionError(
            "Priced request-event amounts were hidden, rounded to zero, or marked unavailable"
        )
    cost_tones = {
        cell.get_attribute("data-request-cost-tone") for cell in priced_cost_cells.all()
    }
    if cost_tones != {"micro"}:
        raise AssertionError(
            f"Request-event micro-cost color classification drifted: {cost_tones!r}"
        )
    token_column_alignment = card.locator("table").evaluate(
        """(table, labels) => {
          const headers = Array.from(table.tHead?.rows[0]?.cells ?? []);
          const firstRow = table.tBodies[0]?.rows[0];
          return labels.map((label) => {
            const header = headers.find((cell) => cell.textContent?.trim() === label);
            const cell = header && firstRow ? firstRow.cells[header.cellIndex] : null;
            if (!header || !cell) return { label, missing: true };
            const headerRect = header.getBoundingClientRect();
            const cellRect = cell.getBoundingClientRect();
            return {
              label,
              missing: false,
              headerAlign: getComputedStyle(header).textAlign,
              cellAlign: getComputedStyle(cell).textAlign,
              headerBorderLeftStyle: getComputedStyle(header).borderLeftStyle,
              cellBorderLeftStyle: getComputedStyle(cell).borderLeftStyle,
              headerColor: getComputedStyle(header).color,
              cellColor: getComputedStyle(cell).color,
              cellFontWeight: getComputedStyle(cell).fontWeight,
              headerTitle: header.getAttribute('title'),
              headerAriaLabel: header.getAttribute('aria-label'),
              cellTitle: cell.getAttribute('title'),
              cellAriaLabel: cell.getAttribute('aria-label'),
              leftDelta: Math.abs(headerRect.left - cellRect.left),
              rightDelta: Math.abs(headerRect.right - cellRect.right),
            };
          });
        }""",
        [
            "Total Input Tokens",
            "Non-Cache-Read Input Tokens",
            "Total Output Tokens",
            "Explicit Output Tokens",
            "Reasoning Tokens",
            "Cache Read Tokens",
            "Cache Write Tokens",
            "Total Tokens",
        ],
    )
    misaligned_token_columns = [
        column
        for column in token_column_alignment
        if column.get("missing")
        or column.get("headerAlign") != "right"
        or column.get("cellAlign") != "right"
        or column.get("headerBorderLeftStyle") != "dashed"
        or column.get("cellBorderLeftStyle") != "dashed"
        or column.get("leftDelta", 1) > 0.5
        or column.get("rightDelta", 1) > 0.5
    ]
    if misaligned_token_columns:
        raise AssertionError(
            "Request-event token headers and values are not column-aligned: "
            f"{misaligned_token_columns!r}"
        )
    token_header_colors = {column["headerColor"] for column in token_column_alignment}
    if len(token_header_colors) != 1:
        raise AssertionError(
            "Request-event Token headers still use fixed per-column colors: "
            f"{token_column_alignment!r}"
        )
    neutral_token_value_colors = {
        column["cellColor"]
        for column in token_column_alignment
        if column["label"] != "Cache Read Tokens"
    }
    if len(neutral_token_value_colors) != 1:
        raise AssertionError(
            "Non-cache Request-event Token values still use fixed per-column colors: "
            f"{token_column_alignment!r}"
        )
    header_hints = {
        column["label"]: column.get("headerAriaLabel") or column.get("headerTitle")
        for column in token_column_alignment
        if column["label"]
        in {"Non-Cache-Read Input Tokens", "Explicit Output Tokens", "Cache Read Tokens"}
    }
    if any(not hint for hint in header_hints.values()):
        raise AssertionError(
            f"Derived token explanations were not attached to column headers: {header_hints!r}"
        )
    unexpected_value_tooltips = [
        column["label"]
        for column in token_column_alignment
        if column.get("cellTitle") is not None and column["label"] != "Cache Read Tokens"
    ]
    if unexpected_value_tooltips:
        raise AssertionError(
            "Non-cache Token value cells still expose disruptive hover explanations: "
            f"{unexpected_value_tooltips!r}"
        )
    for expected_label in ["Fast", "Std", "none", "low", "high", "xhigh", "max"]:
        card.get_by_text(expected_label, exact=True).first.wait_for()
    resolved_fast_flows = card.locator('[data-service-tier-flow="resolved"]').filter(
        has_text="Fast"
    )
    if resolved_fast_flows.count() != 1:
        raise AssertionError(
            "Expected one resolved Fast tier after outbound precedence, found "
            f"{resolved_fast_flows.count()}"
        )
    combined_flows = card.locator('[data-service-tier-flow="combined"]')
    if combined_flows.count() != 3:
        raise AssertionError(
            f"Expected three compact request-to-effective tier flows, found {combined_flows.count()}"
        )
    for index in range(combined_flows.count()):
        if combined_flows.nth(index).inner_text().replace("\n", "").replace(" ", "") != "Fast→Std":
            raise AssertionError(
                "Combined tier flow did not render Fast → Std with existing badges: "
                f"{combined_flows.nth(index).inner_text()!r}"
            )
    outbound_flow = card.locator(
        '[data-service-tier-flow="combined"]'
        '[aria-label*="Resolved: Std (evidence: CPA outbound)"]'
    )
    if outbound_flow.count() != 1:
        raise AssertionError("Outbound-resolved tier flow did not expose precise evidence")
    outbound_description = outbound_flow.first.get_attribute("aria-label") or ""
    for expected in [
        "Client request: Fast (raw: fast)",
        "CPA outbound: Std (raw: standard)",
        "Upstream response: Missing",
        "Effective: Missing",
        "Resolved: Std (evidence: CPA outbound)",
    ]:
        if expected not in outbound_description:
            raise AssertionError(
                f"Outbound tier flow lost {expected!r}: {outbound_description!r}"
            )
    unknown_flow = card.locator(
        '[data-service-tier-flow="combined"]'
        '[aria-label*="Upstream response: Unknown (raw: flex)"]'
    )
    if unknown_flow.count() != 1:
        raise AssertionError("Unknown response tier was not preserved in the accessible chain")
    unknown_description = unknown_flow.first.get_attribute("aria-label") or ""
    if "Resolved: Std (evidence: assumed fallback)" not in unknown_description:
        raise AssertionError(
            f"Unknown response tier was presented as confirmed: {unknown_description!r}"
        )
    priority_row = rows.filter(has_text="12").filter(has_text="Fast").first
    priority_cells = [text.strip() for text in priority_row.locator("td").all_inner_texts()]
    priority_token_values = [cell.splitlines()[0] for cell in priority_cells[-9:-1]]
    if priority_token_values != ["12", "9", "8", "6", "2", "3", "4", "23"]:
        raise AssertionError(
            "Combined service-tier/cache row rendered the wrong token values: "
            f"{priority_cells!r}"
        )
    if card.locator("td[data-non-cache-read-input-source]").count() != 0:
        raise AssertionError("Non-cache-read input must be calculated locally without a source badge")
    low_cache_cells = rows.locator(
        'td[data-cache-rate-tone="low"][data-cache-token-count="1"]'
    )
    if low_cache_cells.count() != 1 or low_cache_cells.first.inner_text().strip() != "1":
        raise AssertionError("Cache Read Tokens must render as one numeric line")
    high_cache_cells = rows.locator('td[data-cache-rate-tone="high"]')
    if high_cache_cells.count() == 0:
        raise AssertionError(
            "High cache-read share did not receive the ratio-based color tone"
        )
    low_cache_cell = low_cache_cells.first
    high_cache_cell = high_cache_cells.first
    if card.locator("td[data-cache-color-weight]").count() != 0:
        raise AssertionError("Cache-read color still depends on the absolute Token count")
    low_cache_color = low_cache_cell.evaluate("cell => getComputedStyle(cell).color")
    high_cache_color = high_cache_cell.evaluate("cell => getComputedStyle(cell).color")
    if low_cache_color == high_cache_color:
        raise AssertionError("Cache-read share did not change the numeric color hue")
    if low_cache_color in neutral_token_value_colors:
        raise AssertionError("A low cache-read share was not emphasized against neutral Token values")
    zero_cache_cells = rows.locator(
        'td[data-cache-rate-tone="low"][data-cache-token-count="0"]'
    )
    if zero_cache_cells.count() == 0:
        raise AssertionError("A known 0% cache-read share was not classified as Low")
    anomaly_cache_cells = rows.locator('td[data-cache-rate-tone="anomaly"]')
    if anomaly_cache_cells.count() != 1:
        raise AssertionError(
            f"Expected one anomalous cache ratio, found {anomaly_cache_cells.count()}"
        )
    anomaly_cache_cell = anomaly_cache_cells.first
    if "!" not in anomaly_cache_cell.inner_text():
        raise AssertionError("Anomalous cache ratio did not expose a non-color marker")
    anomaly_description = anomaly_cache_cell.get_attribute("aria-label") or ""
    if "exceed" not in anomaly_description.lower():
        raise AssertionError(
            f"Anomalous cache ratio lacks an accessible explanation: {anomaly_description!r}"
        )

    with page.expect_download() as csv_download:
        card.get_by_role("button", name="Export CSV", exact=True).click()
    csv_path = csv_download.value.path()
    if not csv_path:
        raise AssertionError("Request-event CSV export did not create a download")
    with Path(csv_path).open("r", encoding="utf-8", newline="") as csv_file:
        csv_rows = list(csv.DictReader(csv_file))
    if any(column.startswith("thinking_") for column in csv_rows[0]):
        raise AssertionError("Request-event CSV must not export legacy thinking fields")
    csv_tiers = sorted(row.get("service_tier", "") for row in csv_rows)
    if csv_tiers != ["", "cache-import", "flex", "priority", "priority"]:
        raise AssertionError(f"Request-event CSV lost raw service_tier values: {csv_tiers!r}")
    csv_outbound_tiers = sorted(row.get("outbound_service_tier", "") for row in csv_rows)
    if csv_outbound_tiers != ["", "priority", "priority", "standard", "standard"]:
        raise AssertionError(
            f"Request-event CSV lost raw outbound_service_tier values: {csv_outbound_tiers!r}"
        )
    resolved_csv_tiers = sorted(row.get("resolved_service_tier", "") for row in csv_rows)
    if resolved_csv_tiers != ["fast", "std", "std", "std", "std"]:
        raise AssertionError(
            f"Request-event CSV resolved tiers incorrectly: {resolved_csv_tiers!r}"
        )
    csv_evidence = sorted(row.get("service_tier_evidence", "") for row in csv_rows)
    if csv_evidence != ["assumed", "assumed", "outbound", "response", "response"]:
        raise AssertionError(
            f"Request-event CSV lost tier evidence: {csv_evidence!r}"
        )
    csv_efforts = sorted(row.get("reasoning_effort", "") for row in csv_rows)
    if csv_efforts != ["high", "low", "max", "none", "xhigh"]:
        raise AssertionError(
            f"Request-event CSV lost raw reasoning_effort values: {csv_efforts!r}"
        )
    if any(
        row.get("pricing_status") != "priced"
        or float(row.get("estimated_cost_usd", "0")) <= 0
        for row in csv_rows
    ):
        raise AssertionError("Request-event CSV lost per-event pricing estimates")
    priority_csv_rows = [
        row for row in csv_rows if row.get("effective_service_tier") == "priority"
    ]
    if len(priority_csv_rows) != 1:
        raise AssertionError(
            f"Request-event CSV lost the combined priority row: {priority_csv_rows!r}"
        )
    priority_csv = priority_csv_rows[0]
    expected_priority_csv_tokens = {
        "non_cache_read_input_tokens": "9",
        "cached_tokens": "3",
        "cache_read_tokens": "3",
        "cache_creation_tokens": "4",
        "total_tokens": "23",
    }
    actual_priority_csv_tokens = {
        key: priority_csv.get(key, "") for key in expected_priority_csv_tokens
    }
    if actual_priority_csv_tokens != expected_priority_csv_tokens:
        raise AssertionError(
            "Request-event CSV lost combined service-tier/cache token values: "
            f"{actual_priority_csv_tokens!r}"
        )
    standard_csv_rows = [
        row for row in csv_rows if row.get("effective_service_tier") == "standard"
    ]
    if len(standard_csv_rows) != 1 or standard_csv_rows[0].get("non_cache_read_input_tokens") != "9":
        raise AssertionError(
            "Request-event CSV did not derive non-cache-read input from input minus cache reads: "
            f"{standard_csv_rows!r}"
        )

    with page.expect_download() as json_download:
        card.get_by_role("button", name="Export JSON", exact=True).click()
    json_path = json_download.value.path()
    if not json_path:
        raise AssertionError("Request-event JSON export did not create a download")
    json_rows = json.loads(Path(json_path).read_text(encoding="utf-8"))
    if any("thinking" in row for row in json_rows):
        raise AssertionError("Request-event JSON must not export legacy thinking data")
    json_tiers = sorted(
        "<null>" if row.get("service_tier") is None else str(row.get("service_tier"))
        for row in json_rows
    )
    if json_tiers != ["<null>", "cache-import", "flex", "priority", "priority"]:
        raise AssertionError(f"Request-event JSON lost raw service_tier values: {json_tiers!r}")
    json_outbound_tiers = sorted(
        "<null>"
        if row.get("outbound_service_tier") is None
        else str(row.get("outbound_service_tier"))
        for row in json_rows
    )
    if json_outbound_tiers != ["<null>", "priority", "priority", "standard", "standard"]:
        raise AssertionError(
            "Request-event JSON lost raw outbound_service_tier values: "
            f"{json_outbound_tiers!r}"
        )
    resolved_json_tiers = sorted(str(row.get("resolved_service_tier")) for row in json_rows)
    if resolved_json_tiers != ["fast", "std", "std", "std", "std"]:
        raise AssertionError(
            f"Request-event JSON resolved tiers incorrectly: {resolved_json_tiers!r}"
        )
    json_efforts = sorted(
        "<null>" if row.get("reasoning_effort") is None else str(row.get("reasoning_effort"))
        for row in json_rows
    )
    if json_efforts != ["high", "low", "max", "none", "xhigh"]:
        raise AssertionError(
            f"Request-event JSON lost raw reasoning_effort values: {json_efforts!r}"
        )
    if any(
        row.get("pricing_status") != "priced"
        or not isinstance(row.get("estimated_cost_usd"), (int, float))
        or row["estimated_cost_usd"] <= 0
        for row in json_rows
    ):
        raise AssertionError("Request-event JSON lost per-event pricing estimates")
    priority_json_rows = [
        row for row in json_rows if row.get("effective_service_tier") == "priority"
    ]
    if len(priority_json_rows) != 1:
        raise AssertionError(
            f"Request-event JSON lost the combined priority row: {priority_json_rows!r}"
        )
    priority_json_tokens = priority_json_rows[0].get("tokens", {})
    expected_priority_json_tokens = {
        "input_tokens": 12,
        "non_cache_read_input_tokens": 9,
        "output_tokens": 8,
        "reasoning_tokens": 2,
        "cached_tokens": 3,
        "cache_read_tokens": 3,
        "cache_creation_tokens": 4,
        "total_tokens": 23,
    }
    if priority_json_tokens != expected_priority_json_tokens:
        raise AssertionError(
            "Request-event JSON lost combined service-tier/cache token values: "
            f"{priority_json_tokens!r}"
        )
    standard_json_rows = [
        row for row in json_rows if row.get("effective_service_tier") == "standard"
    ]
    standard_json_tokens = standard_json_rows[0].get("tokens", {}) if len(standard_json_rows) == 1 else {}
    if standard_json_tokens.get("non_cache_read_input_tokens") != 9:
        raise AssertionError(
            "Request-event JSON did not derive non-cache-read input from input minus cache reads: "
            f"{standard_json_rows!r}"
        )

    tier_select = card.get_by_label("Tier", exact=True)
    for option_label, expected_rows in [("Fast", 1), ("Std", 4)]:
        tier_select.click()
        page.get_by_role("option", name=option_label, exact=True).click()
        wait_for_row_count(expected_rows)
        if any(option_label not in rows.nth(index).inner_text() for index in range(expected_rows)):
            raise AssertionError(
                f"Tier filter {option_label!r} returned the wrong request event row"
            )

    card.get_by_role("button", name="Clear Filters", exact=True).click()
    wait_for_row_count(8)

    def get_cache_value_style(cache_cell: Any) -> dict[str, Any]:
        return cache_cell.evaluate(
            """cell => {
              const value = cell.querySelector('span');
              if (!value) throw new Error('Cache-read value is missing');
              const style = getComputedStyle(value);
              const rootStyle = getComputedStyle(document.documentElement);
              const backgroundToken = rootStyle.getPropertyValue('--bg-primary').trim();
              const probe = document.createElement('span');
              probe.style.color = backgroundToken;
              document.body.appendChild(probe);
              const backgroundColor = getComputedStyle(probe).color;
              probe.remove();
              const toRgb = color => {
                const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
                if (!channels || channels.length !== 3) {
                  throw new Error(`Unable to parse color: ${color}`);
                }
                return channels;
              };
              const luminance = color => {
                const [red, green, blue] = toRgb(color).map(channel => {
                  const normalized = channel / 255;
                  return normalized <= 0.04045
                    ? normalized / 12.92
                    : ((normalized + 0.055) / 1.055) ** 2.4;
                });
                return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
              };
              const foregroundLuminance = luminance(style.color);
              const backgroundLuminance = luminance(backgroundColor);
              const contrastRatio =
                (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
                (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
              return {
                color: style.color,
                backgroundColor,
                contrastRatio,
                fontWeight: style.fontWeight,
              };
            }"""
        )

    expected_cache_font_weights = {
        "unavailable": "600",
        "low": "800",
        "medium": "750",
        "high": "650",
        "anomaly": "820",
    }
    expected_cache_tone_labels = {
        "unavailable": "Not set",
        "low": "Low",
        "medium": "Moderate",
        "high": "High",
        "anomaly": "Anomaly",
    }
    original_theme = page.evaluate(
        "() => document.documentElement.getAttribute('data-theme')"
    )
    page.evaluate("() => document.documentElement.removeAttribute('data-theme')")
    cache_tone_signatures = {}
    for tone in ["unavailable", "low", "medium", "high", "anomaly"]:
        cache_cell = card.locator(f'td[data-cache-rate-tone="{tone}"]').first
        cache_cell.wait_for()
        cache_description = cache_cell.get_attribute("aria-label") or ""
        if (
            "token" not in cache_description.lower()
            or expected_cache_tone_labels[tone].lower() not in cache_description.lower()
            or (tone != "unavailable" and "%" not in cache_description)
        ):
            raise AssertionError(
                f"Cache-read {tone!r} state lacks an accessible Token/rate/status description: "
                f"{cache_description!r}"
            )
        cache_style = get_cache_value_style(cache_cell)
        if cache_style["fontWeight"] != expected_cache_font_weights[tone]:
            raise AssertionError(
                f"Cache-read {tone!r} state has the wrong numeric font weight: "
                f"{cache_style!r}"
            )
        if cache_style["contrastRatio"] < 4.5:
            raise AssertionError(
                f"Cache-read {tone!r} state fails WCAG AA text contrast: "
                f"{cache_style!r}"
            )
        cache_tone_signatures[tone] = (
            f'{cache_style["color"]}|{cache_style["fontWeight"]}'
        )
    if len(set(cache_tone_signatures.values())) != len(cache_tone_signatures):
        raise AssertionError(
            "Cache-read semantic states reused the same color and emphasis signature: "
            f"{cache_tone_signatures!r}"
        )
    cache_rate_boundaries = {
        "medium": ('td[data-cache-rate-tone="medium"][data-cache-token-count="3"]', "25%"),
        "high": ('td[data-cache-rate-tone="high"][data-cache-token-count="163200"]', "60%"),
    }
    for tone, (selector, expected_rate) in cache_rate_boundaries.items():
        boundary_cell = card.locator(selector)
        boundary_cell.wait_for()
        boundary_description = boundary_cell.get_attribute("aria-label") or ""
        if expected_rate not in boundary_description:
            raise AssertionError(
                f"Cache-read {tone!r} boundary lost {expected_rate}: "
                f"{boundary_description!r}"
            )

    try:
        for theme in ["white", "dark"]:
            page.evaluate(
                "theme => document.documentElement.setAttribute('data-theme', theme)",
                theme,
            )
            theme_token_colors = rows.first.locator(
                'td[class*="requestEventsTokenCell"]'
            ).evaluate_all(
                """cells => cells.map(cell => getComputedStyle(cell).color)"""
            )
            if (
                len(
                    set(
                        color
                        for index, color in enumerate(theme_token_colors)
                        if index != 5
                    )
                )
                != 1
            ):
                raise AssertionError(
                    f"{theme.capitalize()} theme restored fixed per-column Token colors: "
                    f"{theme_token_colors!r}"
                )
            theme_cache_tone_signatures = {}
            for tone in ["unavailable", "low", "medium", "high", "anomaly"]:
                theme_cache_style = get_cache_value_style(
                    card.locator(f'td[data-cache-rate-tone="{tone}"]').first
                )
                if theme_cache_style["fontWeight"] != expected_cache_font_weights[tone]:
                    raise AssertionError(
                        f"{theme.capitalize()}-theme Cache-read {tone!r} state has the "
                        f"wrong numeric font weight: {theme_cache_style!r}"
                    )
                if theme_cache_style["contrastRatio"] < 4.5:
                    raise AssertionError(
                        f"{theme.capitalize()}-theme Cache-read {tone!r} state fails "
                        f"WCAG AA text contrast: {theme_cache_style!r}"
                    )
                theme_cache_tone_signatures[tone] = (
                    f'{theme_cache_style["color"]}|{theme_cache_style["fontWeight"]}'
                )
            if len(set(theme_cache_tone_signatures.values())) != len(
                theme_cache_tone_signatures
            ):
                raise AssertionError(
                    f"{theme.capitalize()}-theme Cache-read states reused the same "
                    f"color and emphasis signature: {theme_cache_tone_signatures!r}"
                )
    finally:
        page.evaluate(
            """theme => {
              if (theme === null) document.documentElement.removeAttribute('data-theme');
              else document.documentElement.setAttribute('data-theme', theme);
            }""",
            original_theme,
        )

    effort_color_signatures = {}
    for tone in ["none", "minimal", "low", "medium", "high", "xhigh", "max"]:
        badge = card.locator(f'[data-reasoning-effort-tone="{tone}"]').first
        badge.wait_for()
        effort_color_signatures[tone] = badge.evaluate(
            """element => {
              const style = getComputedStyle(element);
              return [style.color, style.backgroundColor, style.borderColor].join('|');
            }"""
        )
    if len(set(effort_color_signatures.values())) != len(effort_color_signatures):
        raise AssertionError(
            "Reasoning-effort levels reused a visual color signature: "
            f"{effort_color_signatures!r}"
        )
    if card.locator('[data-reasoning-effort-tone="empty"]').count() != 1:
        raise AssertionError("Legacy unknown effort lost its separate muted treatment")

    effort_select = card.get_by_label("Effort", exact=True)
    effort_select.click()
    page.get_by_role("option", name="max", exact=True).click()
    wait_for_row_count(1)
    for row_text in rows.all_inner_texts():
        if "max" not in row_text:
            raise AssertionError("Effort filter returned a row without the selected raw effort")

    card.get_by_role("button", name="Clear Filters", exact=True).click()
    wait_for_row_count(8)

    result_select = card.get_by_label("Result", exact=True)
    result_select.click()
    page.get_by_role("option", name="Failure", exact=True).click()
    wait_for_row_count(1)
    if "Failure" not in rows.first.inner_text():
        raise AssertionError("Result filter returned a successful request")

    card.get_by_role("button", name="Clear Filters", exact=True).click()
    wait_for_row_count(8)

    cache_select = card.get_by_label("Cache Status", exact=True)
    cache_select.click()
    page.get_by_role("option", name="Has Cached Tokens", exact=True).click()
    wait_for_row_count(6)

    card.get_by_role("button", name="Clear Filters", exact=True).click()
    wait_for_row_count(8)

    numeric_filter_trigger = card.get_by_role(
        "button", name="Token value range", exact=True
    )
    numeric_filter_trigger.click()
    numeric_dialog = card.get_by_role("dialog", name="Token value range", exact=True)
    numeric_dialog.wait_for()
    numeric_minimum = numeric_dialog.get_by_label("Minimum", exact=True)
    page.wait_for_function(
        "input => document.activeElement === input",
        arg=numeric_minimum.element_handle(),
    )
    numeric_metric_select = numeric_dialog.get_by_label("Token metric", exact=True)
    apply_range = numeric_dialog.get_by_role("button", name="Apply range", exact=True)
    if not apply_range.is_disabled():
        raise AssertionError("Token range can be applied without a numeric bound")
    numeric_metric_select.click()
    for metric_name in [
        "Total Input Tokens",
        "Non-Cache-Read Input Tokens",
        "Total Output Tokens",
        "Explicit Output Tokens",
        "Reasoning Tokens",
        "Cache Read Tokens",
        "Cache Write Tokens",
        "Total Tokens",
    ]:
        page.get_by_role("option", name=metric_name, exact=True).wait_for()
    page.keyboard.press("Escape")
    numeric_dialog.wait_for()
    if numeric_metric_select.get_attribute("aria-expanded") != "false":
        raise AssertionError("Escape did not close the Token metric listbox first")
    numeric_metric_select.click()
    page.get_by_role("option", name="Cache Read Tokens", exact=True).click()
    numeric_minimum = numeric_dialog.get_by_label("Minimum", exact=True)
    numeric_maximum = numeric_dialog.get_by_label("Maximum", exact=True)
    numeric_minimum.fill("1")
    wait_for_row_count(8)
    numeric_maximum.fill("1")
    wait_for_row_count(8)
    numeric_dialog.get_by_text("Cache Read Tokens · 1–1", exact=True).wait_for()
    apply_range.click()
    wait_for_row_count(1)
    if rows.first.locator('td[data-cache-token-count="1"]').count() != 1:
        raise AssertionError("Inclusive Token range did not retain the exact boundary value")

    active_numeric_filter_trigger = card.get_by_role(
        "button", name="Token range: Cache Read Tokens · 1–1", exact=True
    )
    active_numeric_filter_trigger.click()
    numeric_dialog = card.get_by_role("dialog", name="Token value range", exact=True)
    numeric_minimum = numeric_dialog.get_by_label("Minimum", exact=True)
    numeric_minimum.fill("8")
    numeric_dialog.get_by_text(
        "Minimum cannot be greater than maximum.", exact=True
    ).wait_for()
    if not numeric_dialog.get_by_role("button", name="Apply range", exact=True).is_disabled():
        raise AssertionError("Invalid Token range left the Apply action enabled")
    wait_for_row_count(1)
    numeric_dialog.get_by_label("Maximum", exact=True).fill("")
    numeric_minimum.fill("1.5")
    numeric_dialog.get_by_text(
        "Enter non-negative whole-number bounds.", exact=True
    ).wait_for()
    if not numeric_dialog.get_by_role("button", name="Apply range", exact=True).is_disabled():
        raise AssertionError("Fractional Token range left the Apply action enabled")
    numeric_dialog.get_by_role("button", name="Cancel", exact=True).click()
    wait_for_row_count(1)
    page.wait_for_function(
        "trigger => document.activeElement === trigger",
        arg=active_numeric_filter_trigger.element_handle(),
    )

    active_numeric_filter_trigger.click()
    numeric_dialog = card.get_by_role("dialog", name="Token value range", exact=True)
    numeric_dialog.get_by_label("Minimum", exact=True).fill("0")
    numeric_dialog.get_by_label("Maximum", exact=True).fill("2")
    result_select.click()
    numeric_dialog.wait_for(state="detached")
    wait_for_row_count(1)
    card.get_by_role(
        "button", name="Token range: Cache Read Tokens · 1–1", exact=True
    ).wait_for()
    if not result_select.evaluate("trigger => document.activeElement === trigger"):
        raise AssertionError("Outside-click dismissal stole focus from the clicked filter")
    page.keyboard.press("Escape")

    active_numeric_filter_trigger.click()
    numeric_dialog = card.get_by_role("dialog", name="Token value range", exact=True)
    numeric_dialog.get_by_label("Minimum", exact=True).fill("0")
    numeric_dialog.get_by_label("Maximum", exact=True).fill("2")
    page.keyboard.press("Escape")
    numeric_dialog.wait_for(state="detached")
    wait_for_row_count(1)
    page.wait_for_function(
        "trigger => document.activeElement === trigger",
        arg=active_numeric_filter_trigger.element_handle(),
    )

    card.get_by_role("button", name="Clear Filters", exact=True).click()
    wait_for_row_count(8)
    numeric_filter_trigger = card.get_by_role(
        "button", name="Token value range", exact=True
    )
    numeric_filter_trigger.click()
    numeric_dialog = card.get_by_role("dialog", name="Token value range", exact=True)
    if numeric_dialog.get_by_label("Token metric", exact=True).inner_text().strip() != "Total Tokens":
        raise AssertionError("A new Token range did not start with the Total Tokens metric")
    if (
        numeric_dialog.get_by_label("Minimum", exact=True).input_value()
        or numeric_dialog.get_by_label("Maximum", exact=True).input_value()
    ):
        raise AssertionError("Clearing filters did not clear the applied numeric bounds")
    numeric_dialog.get_by_label("Token metric", exact=True).click()
    page.get_by_role("option", name="Cache Read Tokens", exact=True).click()
    numeric_dialog.get_by_label("Minimum", exact=True).fill("1")
    numeric_dialog.get_by_role("button", name="Apply range", exact=True).click()
    wait_for_row_count(5)
    active_numeric_filter_trigger = card.get_by_role(
        "button", name="Token range: Cache Read Tokens · ≥ 1", exact=True
    )
    active_numeric_filter_trigger.click()
    numeric_dialog = card.get_by_role("dialog", name="Token value range", exact=True)
    numeric_dialog.get_by_role("button", name="Clear range", exact=True).click()
    wait_for_row_count(8)
    page.wait_for_function(
        "trigger => document.activeElement === trigger",
        arg=numeric_filter_trigger.element_handle(),
    )

    time_range_select = card.get_by_label("Time Range", exact=True)
    if "Follow Page (Last 24 Hours)" not in time_range_select.inner_text():
        raise AssertionError("Request-event time filter did not expose its page-range scope")
    time_range_select.click()
    for range_label in [
        "All Time",
        "Last 1 Hour",
        "Last 24 Hours",
        "Last 7 Days",
        "Last 30 Days",
    ]:
        page.get_by_role("option", name=range_label, exact=True).wait_for()
    page.get_by_role("option", name="All Time", exact=True).click()
    wait_for_row_count(8)

    card.get_by_role("button", name="Clear Filters", exact=True).click()
    wait_for_row_count(8)

    page.set_viewport_size({"width": 1024, "height": 480})
    desktop_numeric_trigger = card.get_by_role(
        "button", name="Token value range", exact=True
    )
    desktop_numeric_trigger.click()
    desktop_numeric_dialog = card.get_by_role(
        "dialog", name="Token value range", exact=True
    )
    desktop_numeric_dialog.wait_for()
    desktop_numeric_dialog.get_by_role("button", name="Cancel", exact=True).scroll_into_view_if_needed()
    desktop_numeric_metrics = desktop_numeric_dialog.evaluate(
        """dialog => {
          const bounds = dialog.getBoundingClientRect();
          const cancel = Array.from(dialog.querySelectorAll('button')).find(
            (button) => button.textContent?.trim() === 'Cancel'
          )?.getBoundingClientRect();
          return {
            position: getComputedStyle(dialog).position,
            overflowY: getComputedStyle(dialog).overflowY,
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            cancelTop: cancel?.top,
            cancelBottom: cancel?.bottom,
          };
        }"""
    )
    if (
        desktop_numeric_metrics["position"] != "fixed"
        or desktop_numeric_metrics["overflowY"] not in {"auto", "scroll"}
        or desktop_numeric_metrics["left"] < -1
        or desktop_numeric_metrics["top"] < -1
        or desktop_numeric_metrics["right"] > desktop_numeric_metrics["viewportWidth"] + 1
        or desktop_numeric_metrics["bottom"]
        > desktop_numeric_metrics["viewportHeight"] + 1
        or desktop_numeric_metrics["cancelTop"] is None
        or desktop_numeric_metrics["cancelTop"] < desktop_numeric_metrics["top"] - 1
        or desktop_numeric_metrics["cancelBottom"]
        > desktop_numeric_metrics["bottom"] + 1
    ):
        raise AssertionError(
            f"Token-range popover is clipped at 1024x480: {desktop_numeric_metrics!r}"
        )
    desktop_numeric_dialog.get_by_role("button", name="Cancel", exact=True).click()
    desktop_numeric_trigger.click()
    desktop_numeric_dialog = card.get_by_role(
        "dialog", name="Token value range", exact=True
    )
    desktop_numeric_dialog.wait_for()
    desktop_trigger_handle = desktop_numeric_trigger.element_handle()
    page.set_viewport_size({"width": 390, "height": 844})
    desktop_numeric_dialog.wait_for(state="detached")
    page.wait_for_function(
        "trigger => document.activeElement === trigger",
        arg=desktop_trigger_handle,
    )
    tier_select.wait_for()
    mobile_numeric_trigger = card.get_by_role(
        "button", name="Token value range", exact=True
    )
    mobile_numeric_trigger.click()
    mobile_numeric_dialog = page.get_by_role(
        "dialog", name="Token value range", exact=True
    )
    mobile_numeric_dialog.wait_for()
    mobile_metric_select = mobile_numeric_dialog.get_by_label("Token metric", exact=True)
    mobile_metric_select.click()
    page.get_by_role("option", name="Cache Read Tokens", exact=True).wait_for()
    page.keyboard.press("Escape")
    mobile_numeric_dialog.wait_for()
    if mobile_metric_select.get_attribute("aria-expanded") != "false":
        raise AssertionError("Escape did not close the mobile Token metric listbox first")
    mobile_numeric_metrics = mobile_numeric_dialog.evaluate(
        """dialog => {
          const bounds = dialog.getBoundingClientRect();
          const buttons = Array.from(dialog.querySelectorAll('button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return { text: button.textContent?.trim(), left: rect.left, right: rect.right };
          });
          return {
            ariaModal: dialog.getAttribute('aria-modal'),
            overlayPosition: getComputedStyle(dialog.parentElement).position,
            bodyPosition: document.body.style.position,
            left: bounds.left,
            right: bounds.right,
            bottom: bounds.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            buttons,
          };
        }"""
    )
    if (
        mobile_numeric_metrics["ariaModal"] != "true"
        or mobile_numeric_metrics["overlayPosition"] != "fixed"
        or mobile_numeric_metrics["bodyPosition"] != "fixed"
        or mobile_numeric_metrics["left"] < -1
        or mobile_numeric_metrics["right"] > mobile_numeric_metrics["viewportWidth"] + 1
        or mobile_numeric_metrics["bottom"]
        > mobile_numeric_metrics["viewportHeight"] + 1
        or any(
            button["left"] < mobile_numeric_metrics["left"] - 1
            or button["right"] > mobile_numeric_metrics["right"] + 1
            for button in mobile_numeric_metrics["buttons"]
        )
    ):
        raise AssertionError(
            f"Token-range sheet overflows at 390px: {mobile_numeric_metrics!r}"
        )
    mobile_metric_select.click()
    page.get_by_role("option", name="Cache Read Tokens", exact=True).click()
    page.wait_for_function(
        "select => document.activeElement === select",
        arg=mobile_metric_select.element_handle(),
    )
    mobile_close = mobile_numeric_dialog.get_by_role("button", name="Close", exact=True)
    mobile_cancel = mobile_numeric_dialog.get_by_role("button", name="Cancel", exact=True)
    page.keyboard.press("Shift+Tab")
    if not mobile_close.evaluate("button => document.activeElement === button"):
        raise AssertionError("Mobile Token sheet did not move backward to its first control")
    page.keyboard.press("Shift+Tab")
    if not mobile_cancel.evaluate("button => document.activeElement === button"):
        raise AssertionError("Mobile Token sheet focus escaped before its last enabled control")
    page.keyboard.press("Tab")
    if not mobile_close.evaluate("button => document.activeElement === button"):
        raise AssertionError("Mobile Token sheet did not wrap focus to its first control")
    mobile_numeric_dialog.get_by_label("Minimum", exact=True).fill("1")
    mobile_trigger_handle = mobile_numeric_trigger.element_handle()
    mobile_numeric_dialog.get_by_role("button", name="Apply range", exact=True).click()
    mobile_numeric_dialog.wait_for(state="detached")
    wait_for_row_count(5)
    page.wait_for_function(
        "trigger => document.activeElement === trigger",
        arg=mobile_trigger_handle,
    )
    active_mobile_numeric_trigger = card.get_by_role(
        "button", name="Token range: Cache Read Tokens · ≥ 1", exact=True
    )
    active_mobile_numeric_trigger.click()
    mobile_numeric_dialog = page.get_by_role(
        "dialog", name="Token value range", exact=True
    )
    active_mobile_trigger_handle = active_mobile_numeric_trigger.element_handle()
    mobile_numeric_dialog.get_by_role("button", name="Clear range", exact=True).click()
    mobile_numeric_dialog.wait_for(state="detached")
    wait_for_row_count(8)
    page.wait_for_function(
        "trigger => document.activeElement === trigger",
        arg=active_mobile_trigger_handle,
    )
    table_metrics = card.locator("table").evaluate(
        """(table) => ({
          wrapperOverflowX: getComputedStyle(table.parentElement).overflowX,
          wrapperClientWidth: table.parentElement.clientWidth,
          wrapperScrollWidth: table.parentElement.scrollWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        })"""
    )
    if table_metrics["wrapperOverflowX"] not in {"auto", "scroll"}:
        raise AssertionError(
            f"Request-event table is not horizontally scrollable on narrow screens: {table_metrics!r}"
        )
    if table_metrics["documentScrollWidth"] > table_metrics["viewportWidth"] + 1:
        raise AssertionError(
            f"Request-event table causes page-level overflow at 390px: {table_metrics!r}"
        )
    mobile_token_colors = rows.first.locator(
        'td[class*="requestEventsTokenCell"]'
    ).evaluate_all(
        """cells => cells.map(cell => {
          const value = cell.querySelector('span');
          return getComputedStyle(value ?? cell).color;
        })"""
    )
    if len(set(color for index, color in enumerate(mobile_token_colors) if index != 5)) != 1:
        raise AssertionError(
            "Mobile layout restored fixed per-column Token colors: "
            f"{mobile_token_colors!r}"
        )
    mobile_cache_tone_signatures = {}
    for tone in ["unavailable", "low", "medium", "high", "anomaly"]:
        mobile_cache_cell = card.locator(f'td[data-cache-rate-tone="{tone}"]').first
        mobile_cache_description = mobile_cache_cell.get_attribute("aria-label") or ""
        if (
            "token" not in mobile_cache_description.lower()
            or expected_cache_tone_labels[tone].lower()
            not in mobile_cache_description.lower()
            or (tone != "unavailable" and "%" not in mobile_cache_description)
        ):
            raise AssertionError(
                f"Mobile Cache-read {tone!r} state lost its accessible description: "
                f"{mobile_cache_description!r}"
            )
        mobile_cache_style = get_cache_value_style(mobile_cache_cell)
        if mobile_cache_style["fontWeight"] != expected_cache_font_weights[tone]:
            raise AssertionError(
                f"Mobile Cache-read {tone!r} state has the wrong numeric font weight: "
                f"{mobile_cache_style!r}"
            )
        if mobile_cache_style["contrastRatio"] < 4.5:
            raise AssertionError(
                f"Mobile Cache-read {tone!r} state fails WCAG AA text contrast: "
                f"{mobile_cache_style!r}"
            )
        mobile_cache_tone_signatures[tone] = (
            f'{mobile_cache_style["color"]}|{mobile_cache_style["fontWeight"]}'
        )
    if len(set(mobile_cache_tone_signatures.values())) != len(
        mobile_cache_tone_signatures
    ):
        raise AssertionError(
            "Mobile Cache-read states reused the same semantic signature: "
            f"{mobile_cache_tone_signatures!r}"
        )
    if "!" not in card.locator('td[data-cache-rate-tone="anomaly"]').first.inner_text():
        raise AssertionError("Mobile anomalous cache ratio lost its non-color marker")
    page.set_viewport_size({"width": 1280, "height": 720})


def run_usage_request_event_clock_smoke(context: Any, app_url: str) -> None:
    browser = context.browser
    if browser is None:
        raise AssertionError("Request-event clock smoke cannot create an isolated context")
    clock_context = browser.new_context(storage_state=context.storage_state())
    clock_page = clock_context.new_page()
    clock_page.set_default_timeout(15_000)
    try:
        # Install before navigation so React never mixes native and fake timers.
        clock_page.clock.install()
        clock_usage_payload = build_usage_request_event_clock_payload()
        clock_page.route(
            "**/v0/management/usage",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(clock_usage_payload),
            ),
        )
        clock_page.goto(
            f"{app_url}?route=request-events-clock#/usage",
            wait_until="domcontentloaded",
        )
        clock_page.wait_for_function("() => window.location.hash.endsWith('/usage')")
        card = clock_page.get_by_text("Request Events", exact=True).locator("xpath=../..")
        card.wait_for()
        rows = card.locator("tbody tr")

        def wait_for_clock_row_count(expected: int) -> None:
            for _ in range(50):
                if rows.count() == expected:
                    return
                clock_page.wait_for_timeout(100)
            raise AssertionError(
                f"Expected {expected} clock-scoped request rows, found {rows.count()}"
            )

        time_range_select = card.get_by_label("Time Range", exact=True)
        wait_for_clock_row_count(9)
        card.get_by_text("follow-page-boundary-model", exact=True).wait_for()
        if card.get_by_text("outside-page-range-model", exact=True).count() != 0:
            raise AssertionError("Follow Page retained an event outside its page range")
        if card.get_by_text("future-event-model", exact=True).count() != 0:
            raise AssertionError("Follow Page accepted a future request event")
        time_range_select.click()
        clock_page.get_by_role("option", name="Last 1 Hour", exact=True).click()
        wait_for_clock_row_count(8)
        clock_page.clock.fast_forward("03:00")
        wait_for_clock_row_count(7)

        time_range_select.click()
        clock_page.get_by_role(
            "option", name="Follow Page (Last 24 Hours)", exact=True
        ).click()
        wait_for_clock_row_count(9)
        card.get_by_text("follow-page-boundary-model", exact=True).wait_for()
        if card.get_by_text("outside-page-range-model", exact=True).count() != 0:
            raise AssertionError("Follow Page drifted beyond its stable page range")
        if card.get_by_text("future-event-model", exact=True).count() != 0:
            raise AssertionError("Follow Page drifted forward to a future event")

        time_range_select.click()
        clock_page.get_by_role("option", name="All Time", exact=True).click()
        wait_for_clock_row_count(11)
        card.get_by_text("follow-page-boundary-model", exact=True).wait_for()
        card.get_by_text("outside-page-range-model", exact=True).wait_for()
        card.get_by_text("future-event-model", exact=True).wait_for()

        time_range_select.click()
        clock_page.get_by_role("option", name="Last 24 Hours", exact=True).click()
        wait_for_clock_row_count(8)
        if card.get_by_text("follow-page-boundary-model", exact=True).count() != 0:
            raise AssertionError("Last 24 Hours did not advance with the browser clock")
        if card.get_by_text("outside-page-range-model", exact=True).count() != 0:
            raise AssertionError("Last 24 Hours retained an event outside the page range")
        if card.get_by_text("future-event-model", exact=True).count() != 0:
            raise AssertionError("Last 24 Hours accepted a future request event")
    finally:
        clock_context.close()


def run_usage_request_event_column_storage_smoke(context: Any, app_url: str) -> None:
    storage_page = context.new_page()
    storage_page.set_default_timeout(15_000)
    storage_key = "cli-proxy-usage-request-event-columns-v3"
    legacy_keys = [
        "cli-proxy-usage-request-event-columns-v1",
        "cli-proxy-usage-request-event-columns-v2",
    ]
    try:
        storage_page.goto(
            f"{app_url}?route=request-events-columns#/usage",
            wait_until="domcontentloaded",
        )
        storage_page.evaluate(
            """({ current, legacy }) => {
              localStorage.removeItem(current);
              localStorage.setItem(legacy[0], JSON.stringify({ source: true }));
              localStorage.setItem(legacy[1], JSON.stringify({
                timestamp: false,
                model: false,
                source: true,
                authIndex: true,
                totalTokens: false,
              }));
            }""",
            {"current": storage_key, "legacy": legacy_keys},
        )
        storage_page.reload(wait_until="domcontentloaded")
        card = storage_page.get_by_text("Request Events", exact=True).locator("xpath=../..")
        card.wait_for()
        if card.get_by_role("columnheader", name="Source", exact=True).count() != 0:
            raise AssertionError("The formal v3 defaults inherited obsolete v2 Source visibility")
        if card.get_by_role("columnheader", name="Auth Index", exact=True).count() != 0:
            raise AssertionError("The formal v3 defaults inherited obsolete v2 Auth Index visibility")
        card.get_by_role("columnheader", name="Total Tokens", exact=True).wait_for()
        storage_page.wait_for_function(
            """({ current, legacy }) => {
              const stored = JSON.parse(localStorage.getItem(current) || '{}');
              return legacy.every((key) => localStorage.getItem(key) === null) &&
                stored.source === false && stored.authIndex === false &&
                stored.totalInputTokens === true &&
                stored.nonCacheReadInputTokens === true &&
                stored.totalOutputTokens === true &&
                stored.displayedOutputTokens === true &&
                stored.reasoningTokens === true && stored.cacheReadTokens === true &&
                stored.cacheWriteTokens === true && stored.totalTokens === true &&
                stored.cost === true;
            }""",
            arg={"current": storage_key, "legacy": legacy_keys},
        )

        card.get_by_role("button", name="Column Settings", exact=True).click()
        settings = card.get_by_role("dialog", name="Column Settings", exact=True)
        settings.get_by_role("checkbox", name="Source", exact=True).check()
        card.get_by_role("columnheader", name="Source", exact=True).wait_for()

        storage_page.reload(wait_until="domcontentloaded")
        card = storage_page.get_by_text("Request Events", exact=True).locator("xpath=../..")
        card.get_by_role("columnheader", name="Source", exact=True).wait_for()

        storage_page.evaluate(
            """key => {
              localStorage.setItem(key, JSON.stringify({
                timestamp: false,
                model: false,
                source: false,
                authIndex: false,
                tier: false,
                result: false,
                latency: true,
                effort: false,
                totalInputTokens: false,
                nonCacheReadInputTokens: false,
                totalOutputTokens: false,
                displayedOutputTokens: false,
                reasoningTokens: false,
                cacheReadTokens: false,
                cacheWriteTokens: false,
                totalTokens: false,
                cost: false,
                unexpected: true,
              }));
            }""",
            storage_key,
        )
        storage_page.reload(wait_until="domcontentloaded")
        card = storage_page.get_by_text("Request Events", exact=True).locator("xpath=../..")
        card.get_by_role("columnheader", name="Timestamp", exact=True).wait_for()
        storage_page.wait_for_function(
            """key => {
              const stored = JSON.parse(localStorage.getItem(key) || '{}');
              return stored.timestamp === true && !('unexpected' in stored);
            }""",
            arg=storage_key,
        )

        storage_page.add_init_script(
            f"""(() => {{
              const currentKey = {json.dumps(storage_key)};
              const originalSetItem = Storage.prototype.setItem;
              Storage.prototype.setItem = function(key, value) {{
                if (key === currentKey) throw new Error('mock v3 storage failure');
                return originalSetItem.call(this, key, value);
              }};
            }})()"""
        )
        storage_page.evaluate(
            """({ current, legacy }) => {
              localStorage.removeItem(current);
              localStorage.setItem(legacy, JSON.stringify({ source: true }));
            }""",
            {"current": storage_key, "legacy": legacy_keys[1]},
        )
        storage_page.reload(wait_until="domcontentloaded")
        card = storage_page.get_by_text("Request Events", exact=True).locator("xpath=../..")
        card.wait_for()
        failed_write_state = storage_page.evaluate(
            """({ current, legacy }) => ({
              current: localStorage.getItem(current),
              legacy: localStorage.getItem(legacy),
            })""",
            {"current": storage_key, "legacy": legacy_keys[1]},
        )
        if failed_write_state["current"] is not None or failed_write_state["legacy"] is None:
            raise AssertionError(
                "Request-event column cleanup removed legacy state before v3 write verification"
            )
    finally:
        storage_page.evaluate(
            "keys => keys.forEach((key) => localStorage.removeItem(key))",
            [storage_key, *legacy_keys],
        )
        storage_page.close()


def run_branded_provider_visibility_smoke(
    page: Any,
    app_url: str,
    state: MockCoreState,
) -> None:
    branded_labels = ["Claudeapi.com", "Code0", "FennoAI", "Qiniu Cloud"]

    for label in branded_labels:
        category = page.get_by_role(
            "button",
            name=re.compile(rf"^{re.escape(label)}(?:\s|$)", re.I),
        )
        category.wait_for()
        category.click()
        page.get_by_role("heading", name=label, exact=True).wait_for()
        for action in ["View", "Edit", "Delete"]:
            action_buttons = page.get_by_role("button", name=action, exact=True)
            action_buttons.first.wait_for()
            if action_buttons.count() != 1:
                raise AssertionError(
                    f"Configured branded provider {label!r} should expose exactly one "
                    f"{action!r} action; found {action_buttons.count()}"
                )
            if not action_buttons.first.is_enabled():
                raise AssertionError(
                    f"Configured branded provider {label!r} has disabled {action!r} action"
                )

    code0_category = page.get_by_role("button", name=re.compile(r"^Code0(?:\s|$)", re.I))
    code0_category.click()
    page.get_by_role("heading", name="Code0", exact=True).wait_for()
    page.get_by_role("button", name="Edit", exact=True).click()
    code0_sheet = page.get_by_role("dialog").last
    code0_sheet.get_by_text("Grouped key #1", exact=True).click()
    code0_sheet.get_by_text("OpenAI-compatible models", exact=True).click()
    code0_display_name = code0_sheet.get_by_label("Display name (optional)").first
    if code0_display_name.input_value() != "Code0 Model":
        raise AssertionError("Sponsor form did not parse existing model display-name")
    if code0_sheet.get_by_label("Routing alias (optional)").first.input_value() != "code0-route":
        raise AssertionError("Sponsor form did not keep routing alias separate from display-name")
    code0_display_name.fill("Code0 Model Updated")
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith("/v0/management/openai-compatibility")
    ):
        code0_sheet.get_by_role("button", name="Save", exact=True).click()
    code0_sheet.wait_for(state="detached")

    body_text = page.locator("body").inner_text()
    for forbidden_text in ["Quick" + " Fill", "Register" + " here"]:
        if forbidden_text in body_text:
            raise AssertionError(
                f"Provider workbench rendered removed promotional text: {forbidden_text!r}"
            )

    state.include_branded_providers = False
    try:
        page.goto(
            f"{app_url}?route=workbench-no-brands#/ai-providers",
            wait_until="domcontentloaded",
        )
        page.wait_for_function("() => window.location.hash.endsWith('/ai-providers')")
        page.get_by_text("AI Providers", exact=False).first.wait_for()
        page.get_by_role("button", name=re.compile(r"^Gemini(?:\s|$)", re.I)).wait_for()

        for label in branded_labels:
            category = page.get_by_role(
                "button",
                name=re.compile(rf"^{re.escape(label)}(?:\s|$)", re.I),
            )
            if category.count() != 0:
                raise AssertionError(
                    f"Unconfigured branded provider {label!r} was shown as a recommendation"
                )

        body_text = page.locator("body").inner_text()
        for forbidden_text in ["Quick" + " Fill", "Register" + " here"]:
            if forbidden_text in body_text:
                raise AssertionError(
                    f"Unconfigured provider workbench rendered promotional text: "
                    f"{forbidden_text!r}"
                )
        if page.locator('a[href*="quick-start"]').count() != 0:
            raise AssertionError("Unconfigured provider workbench exposed a quick-start route")
    finally:
        state.include_branded_providers = True


def run_usage_contract_import_smoke(page: Any, state: MockCoreState) -> None:
    current_detail = state.usage_payload["usage"]["apis"]["POST /v1/responses"]["models"][
        "gpt-5.6-sol"
    ]["details"][-1]
    ambiguous_detail = json.loads(json.dumps(current_detail))
    ambiguous_payload = {
        "version": 1,
        "usage": {
            "apis": {
                "POST /v1/responses": {
                    "models": {
                        "gpt-5.6-sol": {
                            "details": [ambiguous_detail]
                        }
                    }
                }
            }
        },
    }
    import_route = "POST /v0/management/usage/import"
    before_posts = sum(request == import_route for request in state.requests)

    uncertain_detail = json.loads(json.dumps(current_detail))
    uncertain_detail.pop("timestamp", None)
    uncertain_detail["tokens"] = {
        "input_tokens": 1,
        "output_tokens": 0,
        "reasoning_tokens": 0,
        "cached_tokens": 0,
        "total_tokens": 1,
    }
    uncertain_payload = {
        "version": 1,
        "usage": {
            "apis": {
                "POST /v1/responses": {
                    "models": {"gpt-5.6-sol": {"details": [uncertain_detail]}}
                }
            }
        },
    }
    page.locator('input[type="file"][accept*=".json"]').set_input_files(
        {
            "name": "usage-import-uncertain-timestamp.json",
            "mimeType": "application/json",
            "buffer": json.dumps(uncertain_payload).encode("utf-8"),
        }
    )
    uncertain_dialog = page.get_by_role("dialog", name="Review usage import")
    uncertain_dialog.wait_for()
    uncertain_dialog.get_by_text(
        "1 details without a stable timestamp were excluded from duplicate and overlap detection",
        exact=True,
    ).wait_for()
    uncertain_dialog.get_by_role("button", name="Cancel", exact=True).click()
    uncertain_dialog.wait_for(state="detached")
    if sum(request == import_route for request in state.requests) != before_posts:
        raise AssertionError("Uncertain timestamp review must not POST after cancellation")

    released_core_detail = json.loads(json.dumps(uncertain_detail))
    released_core_detail["timestamp"] = current_detail["timestamp"]
    released_core_payload = {
        "version": 1,
        "usage": {
            "apis": {
                "POST /v1/responses": {
                    "models": {"gpt-5.6-sol": {"details": [released_core_detail]}}
                }
            }
        },
    }
    state.usage_contract_legacy_receipt = True
    try:
        page.locator('input[type="file"][accept*=".json"]').set_input_files(
            {
                "name": "usage-import-released-core-receipt.json",
                "mimeType": "application/json",
                "buffer": json.dumps(released_core_payload).encode("utf-8"),
            }
        )
        released_dialog = page.get_by_role("dialog", name="Review usage import")
        released_dialog.wait_for()
        with page.expect_response(
            lambda response: response.request.method == "POST"
            and response.url.endswith("/v0/management/usage/import")
        ):
            released_dialog.get_by_role("button", name="Import anyway", exact=True).click()
        page.get_by_text(
            "Import complete: added 0, skipped 2, total 5, failed 1",
            exact=True,
        ).wait_for()
    finally:
        state.usage_contract_legacy_receipt = False
    posts_after_released_core = before_posts + 1
    if sum(request == import_route for request in state.requests) != posts_after_released_core:
        raise AssertionError("Released Core success receipt must be accepted after exactly one POST")

    page.locator('input[type="file"][accept*=".json"]').set_input_files(
        {
            "name": "usage-import-ambiguous-v1-cache-semantics.json",
            "mimeType": "application/json",
            "buffer": json.dumps(ambiguous_payload).encode("utf-8"),
        }
    )

    page.get_by_text(
        "Schema v1 cache semantics are ambiguous. Cached details require "
        "uncached_input_tokens for a lossless migration.",
        exact=True,
    ).wait_for()
    if page.get_by_role("dialog", name="Review usage import").count() != 0:
        raise AssertionError("Ambiguous v1 cache semantics must not open an import confirmation")

    if sum(request == import_route for request in state.requests) != posts_after_released_core:
        raise AssertionError("Ambiguous v1 cache semantics must not POST usage imports")

    invalid_v2_detail = json.loads(json.dumps(current_detail))
    del invalid_v2_detail["tokens"]["reasoning_tokens"]
    invalid_v2_payload = {
        "version": 2,
        "usage": {
            "apis": {
                "POST /v1/responses": {
                    "models": {"gpt-5.6-sol": {"details": [invalid_v2_detail]}}
                }
            }
        },
    }
    page.locator('input[type="file"][accept*=".json"]').set_input_files(
        {
            "name": "usage-import-invalid-v2-token-contract.json",
            "mimeType": "application/json",
            "buffer": json.dumps(invalid_v2_payload).encode("utf-8"),
        }
    )
    page.get_by_text("Invalid canonical schema v2 token contract.", exact=True).wait_for()
    if sum(request == import_route for request in state.requests) != posts_after_released_core:
        raise AssertionError("Invalid v2 token contracts must not POST usage imports")

    migrated_detail = json.loads(json.dumps(current_detail))
    migrated_tokens = migrated_detail["tokens"]
    migrated_tokens["uncached_input_tokens"] = (
        migrated_tokens["input_tokens"]
        - migrated_tokens.get("cache_read_tokens", 0)
        - migrated_tokens.get("cache_creation_tokens", 0)
    )
    migrated_payload = {
        "version": 1,
        "usage": {
            "apis": {
                "POST /v1/responses": {
                    "models": {
                        "gpt-5.6-sol": {
                            "details": [migrated_detail]
                        }
                    }
                }
            }
        },
    }
    page.locator('input[type="file"][accept*=".json"]').set_input_files(
        {
            "name": "usage-import-v1-migration.json",
            "mimeType": "application/json",
            "buffer": json.dumps(migrated_payload).encode("utf-8"),
        }
    )

    dialog = page.get_by_role("dialog", name="Review usage import")
    dialog.wait_for()
    for expected_text in [
        "Version 1 · 1 request details",
        "0 potential duplicates inside this file",
        "1 potential overlaps with current usage",
    ]:
        dialog.get_by_text(expected_text, exact=False).wait_for()

    if sum(request == import_route for request in state.requests) != posts_after_released_core:
        raise AssertionError("Migratable v1 usage import POST occurred before confirmation")

    with page.expect_response(
        lambda response: response.request.method == "POST"
        and response.url.endswith("/v0/management/usage/import")
    ):
        dialog.get_by_role("button", name="Import anyway", exact=True).click()

    page.get_by_text(
        "Import complete: added 0, skipped 2, total 5, failed 1. "
        "Token contract migrated from schema v1 to v2.",
        exact=True,
    ).wait_for()
    if sum(request == import_route for request in state.requests) != posts_after_released_core + 1:
        raise AssertionError("Migratable v1 usage import must POST exactly once after confirmation")

    posted_payload = json.loads(state.request_bodies[import_route][-1])
    posted_details = posted_payload["usage"]["apis"]["POST /v1/responses"]["models"][
        "gpt-5.6-sol"
    ]["details"]
    if posted_details != [migrated_detail]:
        raise AssertionError("Migratable v1 usage import was mutated before POST")

    state.usage_contract_code = "usage_aggregate_overflow"
    try:
        canonical_payload = {
            "version": 2,
            "usage": {
                "apis": {
                    "POST /v1/responses": {
                        "models": {"gpt-5.6-sol": {"details": [current_detail]}}
                    }
                }
            },
        }
        page.locator('input[type="file"][accept*=".json"]').set_input_files(
            {
                "name": "usage-import-overflow-receipt.json",
                "mimeType": "application/json",
                "buffer": json.dumps(canonical_payload).encode("utf-8"),
            }
        )
        overflow_dialog = page.get_by_role("dialog", name="Review usage import")
        overflow_dialog.wait_for()
        with page.expect_response(
            lambda response: response.request.method == "POST"
            and response.url.endswith("/v0/management/usage/import")
        ):
            overflow_dialog.get_by_role("button", name="Import anyway", exact=True).click()
        page.get_by_text(
            "Import would overflow Core usage aggregates. No usage data was merged.",
            exact=True,
        ).wait_for()
    finally:
        state.usage_contract_code = None


def run_plugin_runtime_mismatch_smoke(
    page: Any,
    api_url: str,
    state: MockCoreState,
) -> None:
    def logout() -> None:
        page.get_by_title("Logout").click()
        page.wait_for_function("() => window.location.hash.endsWith('/login')")

    def login() -> None:
        page.locator('input[type="checkbox"]').first.check(force=True)
        page.locator("input.input").first.fill(api_url)
        page.locator('input[name="cpa-management-key"]').fill("smoke-management-key")
        page.get_by_role("button", name=re.compile("Login|Connect", re.I)).click()
        page.wait_for_function("() => window.location.hash === '#/'")

    def open_diagnostic_from_nav() -> None:
        unavailable_link = page.get_by_role("link", name="Plugins (runtime unavailable)")
        unavailable_link.wait_for()
        if page.get_by_role("link", name="Plugin Store").count() != 0:
            raise AssertionError("Plugin Store must remain gated when runtime support is unavailable")
        unavailable_link.click()
        page.wait_for_function("() => window.location.hash.endsWith('/plugins')")
        page.get_by_text("Plugin runtime unavailable", exact=True).first.wait_for()

    def wait_for_plugin_store_shortcut() -> None:
        plugin_drawer = page.get_by_role("button", name="Plugins", exact=True)
        plugin_drawer.wait_for()
        if plugin_drawer.get_attribute("aria-expanded") != "true":
            plugin_drawer.click()
        page.get_by_role("link", name="Plugin Store", exact=True).wait_for()

    try:
        state.supports_plugin = False
        state.emit_plugin_support_header = True
        state.plugin_endpoint_available = True
        state.plugins_config_enabled = True
        logout()
        login()

        open_diagnostic_from_nav()
        page.get_by_text("x-cpa-support-plugin: 0", exact=False).wait_for()

        page.set_viewport_size({"width": 390, "height": 844})
        mobile_metrics = page.evaluate(
            """
            () => ({
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
            })
            """
        )
        if mobile_metrics["scrollWidth"] > mobile_metrics["clientWidth"] + 1:
            raise AssertionError(
                f"Plugin runtime diagnostics overflow on mobile: {mobile_metrics!r}"
            )
        page.set_viewport_size({"width": 1280, "height": 720})

        page.get_by_title("Refresh All").click()
        page.wait_for_function("() => window.location.hash.endsWith('/plugins')")
        page.get_by_text("Plugin runtime unavailable", exact=True).first.wait_for()

        for route in ["/plugin-store", "/plugin-pages/mock-plugin/0"]:
            page.evaluate("route => { window.location.hash = `#${route}`; }", route)
            page.wait_for_function("route => window.location.hash.endsWith(route)", arg=route)
            page.get_by_text("Plugin runtime unavailable", exact=True).first.wait_for()

        state.supports_plugin = True
        state.emit_plugin_support_header = False
        state.plugin_endpoint_available = True
        logout()
        login()
        wait_for_plugin_store_shortcut()

        state.supports_plugin = False
        state.plugin_endpoint_available = False
        logout()
        login()
        open_diagnostic_from_nav()
        page.get_by_text("could not verify plugin runtime support", exact=False).wait_for()

        state.emit_plugin_support_header = True
        state.plugins_config_enabled = False
        logout()
        login()
        if page.get_by_role("link", name="Plugins (runtime unavailable)").count() != 0:
            raise AssertionError("Disabled plugin config must not expose runtime diagnostics")
        page.evaluate("() => { window.location.hash = '#/plugins'; }")
        page.wait_for_function("() => window.location.hash === '#/'")

        state.supports_plugin = True
        state.plugin_endpoint_available = True
        state.plugins_config_enabled = True
        logout()
        login()
        wait_for_plugin_store_shortcut()

        state.supports_plugin = False
        state.arm_delayed_config_response()
        page.get_by_title("Refresh All").click()
        if not state.delayed_config_started.wait(timeout=5):
            raise AssertionError("Delayed stale config request did not start")

        logout()
        state.supports_plugin = True
        login()
        wait_for_plugin_store_shortcut()

        state.release_delayed_config.set()
        page.wait_for_timeout(500)
        wait_for_plugin_store_shortcut()
        if page.get_by_role("link", name="Plugins (runtime unavailable)").count() != 0:
            raise AssertionError("A stale capability response polluted the active connection")

        state.arm_delayed_config_response(status=401)
        page.get_by_title("Refresh All").click()
        if not state.delayed_config_started.wait(timeout=5):
            raise AssertionError("Delayed stale unauthorized request did not start")

        logout()
        login()
        wait_for_plugin_store_shortcut()

        state.release_delayed_config.set()
        page.wait_for_timeout(500)
        if page.get_by_title("Logout").count() != 1:
            raise AssertionError("A stale unauthorized response logged out the active connection")
        wait_for_plugin_store_shortcut()
    finally:
        state.release_delayed_config.set()
        state.supports_plugin = True
        state.emit_plugin_support_header = True
        state.plugin_endpoint_available = True
        state.plugins_config_enabled = True


def run_sidebar_navigation_smoke(page: Any, state: MockCoreState) -> None:
    navigation = page.get_by_role("navigation", name="Primary navigation")
    navigation.wait_for()

    for group_label in ["Operate", "Gateway", "Observe", "Control", "Plugins"]:
        navigation.locator(
            ".nav-group-label", has_text=re.compile(f"^{re.escape(group_label)}$")
        ).wait_for()

    state.logging_to_file = False
    try:
        with page.expect_response(
            lambda response: response.request.method == "GET"
            and response.url.endswith("/v0/management/config")
        ):
            page.reload(wait_until="domcontentloaded")
        page.get_by_text("Where to go from here", exact=False).first.wait_for()
        navigation = page.get_by_role("navigation", name="Primary navigation")
        if navigation.get_by_role("link", name="Logs Viewer", exact=True).count() != 1:
            raise AssertionError(
                "Logs navigation disappeared when logging-to-file was disabled"
            )
    finally:
        state.logging_to_file = True
        with page.expect_response(
            lambda response: response.request.method == "GET"
            and response.url.endswith("/v0/management/config")
        ):
            page.reload(wait_until="domcontentloaded")
        page.get_by_text("Where to go from here", exact=False).first.wait_for()
        navigation = page.get_by_role("navigation", name="Primary navigation")

    providers_drawer = navigation.get_by_role("button", name="AI Providers", exact=True)
    if providers_drawer.count() != 1:
        raise AssertionError("AI Providers navigation did not expose the provider drawer")
    if providers_drawer.get_attribute("aria-expanded") != "false":
        raise AssertionError("AI Providers drawer must start collapsed away from Provider routes")
    providers_drawer.click()
    legacy_link = navigation.get_by_role("link", name="LTS Provider Status", exact=True)
    legacy_link.wait_for()
    legacy_link.click()
    page.wait_for_function("() => window.location.hash.endsWith('/ai-providers/legacy')")
    if providers_drawer.get_attribute("aria-expanded") != "true":
        raise AssertionError("Active legacy provider status did not keep its drawer open")
    providers_drawer.click()
    if providers_drawer.get_attribute("aria-expanded") != "false":
        raise AssertionError("Active AI Providers drawer could not be manually collapsed")

    usage_drawer = navigation.get_by_role("button", name="Usage Statistics", exact=True)
    if usage_drawer.get_attribute("aria-expanded") != "false":
        raise AssertionError("Usage drawer must start collapsed away from Usage routes")
    usage_drawer.click()
    navigation.get_by_role("link", name="Pricing workspace", exact=True).wait_for()
    if usage_drawer.get_attribute("aria-expanded") != "true":
        raise AssertionError("Usage drawer did not expose its shortcut")

    navigation.get_by_role("link", name="Pricing workspace", exact=True).click()
    page.wait_for_function("() => window.location.hash.endsWith('/usage/pricing')")
    if usage_drawer.get_attribute("aria-expanded") != "true":
        raise AssertionError("Active Usage child did not keep its drawer open")
    usage_drawer.click()
    if usage_drawer.get_attribute("aria-expanded") != "false":
        raise AssertionError("Active Usage drawer could not be manually collapsed")

    plugin_drawer = navigation.get_by_role("button", name="Mock Resource Plugin", exact=True)
    plugin_drawer.wait_for()
    plugin_drawer.click()
    navigation.get_by_role("link", name="Mock Resource Settings", exact=True).wait_for()
    navigation.get_by_role("link", name="Mock Resource Settings", exact=True).click()
    page.wait_for_function("() => window.location.hash.endsWith('/plugin-pages/mock-plugin/1')")
    if plugin_drawer.get_attribute("aria-expanded") != "true":
        raise AssertionError("Active plugin child did not keep its drawer open")
    plugin_drawer.click()
    if plugin_drawer.get_attribute("aria-expanded") != "false":
        raise AssertionError("Active plugin drawer could not be manually collapsed")

    page.locator(".sidebar-toggle-floating").click()
    if navigation.locator(".nav-group-label", has_text=re.compile(r"^Operate$")).count() != 0:
        raise AssertionError("Collapsed sidebar still exposed group labels")
    page.get_by_title("Mock Resource Plugin").click()
    navigation.get_by_role("link", name="Mock Resource Settings", exact=True).wait_for()

    page.set_viewport_size({"width": 390, "height": 844})
    page.locator(".mobile-menu-btn").click()
    navigation.get_by_role("link", name="Mock Resource Settings", exact=True).click()
    page.wait_for_function("() => window.location.hash.endsWith('/plugin-pages/mock-plugin/1')")
    sidebar_class = page.locator(".sidebar").get_attribute("class") or ""
    if "open" in sidebar_class.split():
        raise AssertionError("Selecting a mobile sidebar child did not close the sidebar")
    mobile_metrics = page.evaluate(
        """
        () => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })
        """
    )
    if mobile_metrics["scrollWidth"] > mobile_metrics["clientWidth"] + 1:
        raise AssertionError(f"Sidebar hierarchy overflowed on mobile: {mobile_metrics!r}")
    page.set_viewport_size({"width": 1280, "height": 720})


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
            localStorage.setItem(
              'cli-proxy-usage-request-event-columns-v1',
              JSON.stringify({ source: true, authIndex: true })
            );
            if (
              !localStorage.getItem('cli-proxy-model-prices-v3') &&
              !localStorage.getItem('cli-proxy-model-prices-v2')
            ) {
              localStorage.setItem(
                'cli-proxy-model-prices-v2',
                JSON.stringify({
                  'gpt-5.6-sol': {
                    prompt: 4,
                    completion: 20,
                    cache: 0.4
                  },
                  'gpt-5.4': {
                    prompt: 2.5,
                    completion: 15,
                    cache: 0.25,
                    cacheWrite: 2.5
                  }
                })
              );
            }
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
            run_sidebar_navigation_smoke(page, state)

            route_checks = [
                ("/", "Where to go from here", None),
                ("/config", "Config Panel", None),
                ("/auth-files", "Auth Files Management", None),
                ("/oauth", "OAuth Login", None),
                ("/quota", "Quota Management", None),
                ("/usage", "Usage Statistics", None),
                ("/usage/pricing", "Pricing workspace", None),
                ("/lts/usage", "Usage Statistics", "/usage"),
                ("/auth-files/oauth-excluded", "OAuth Model Disablement", None),
                ("/auth-files/oauth-model-alias", "OAuth Model Aliases", None),
                ("/ai-providers", "AI Providers", None),
                ("/ai-providers/workbench", "AI Providers", "/ai-providers"),
                ("/ai-providers/legacy", "AI Providers Configuration", None),
                ("/ai-providers/legacy/ampcode", "Configure Ampcode", None),
                ("/lts/providers", "AI Providers Configuration", "/ai-providers/legacy"),
                ("/lts/ampcode", "Configure Ampcode", "/ai-providers/legacy/ampcode"),
                ("/ai-providers/gemini/new", "AI Providers", "/ai-providers/legacy/gemini/new"),
                ("/ai-providers/codex/new", "AI Providers", "/ai-providers/legacy/codex/new"),
                ("/ai-providers/claude/new", "AI Providers", "/ai-providers/legacy/claude/new"),
                ("/ai-providers/vertex/new", "AI Providers", "/ai-providers/legacy/vertex/new"),
                ("/ai-providers/openai/new", "AI Providers", "/ai-providers/legacy/openai/new"),
                ("/ai-providers/ampcode", "Configure Ampcode", "/ai-providers/legacy/ampcode"),
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
                if route == "/usage":
                    run_usage_pricing_entry_smoke(page)
                    run_usage_service_tier_smoke(page)
                    page.evaluate(
                        """() => {
                          window.__ltsNativeDateNow = Date.now;
                          window.__ltsNativeSetTimeout = window.setTimeout;
                        }"""
                    )
                    run_usage_request_event_clock_smoke(context, app_url)
                    native_clock_preserved = page.evaluate(
                        """() => Date.now === window.__ltsNativeDateNow
                          && window.setTimeout === window.__ltsNativeSetTimeout"""
                    )
                    if not native_clock_preserved:
                        raise AssertionError("Request-event clock smoke polluted the main page clock")
                    run_usage_request_event_column_storage_smoke(context, app_url)
                    run_usage_contract_import_smoke(page, state)
                elif route == "/usage/pricing":
                    run_usage_pricing_smoke(page)
                    run_usage_pricing_empty_catalog_smoke(context, app_url)

            page.goto(f"{app_url}?route=plugin-store-auth#/plugin-store", wait_until="domcontentloaded")
            page.wait_for_function("() => window.location.hash.endsWith('/plugin-store')")
            page.get_by_text("Some plugin sources failed to load", exact=False).first.wait_for()
            page.get_by_text("Auth required", exact=False).first.wait_for()
            page.get_by_text("Install: Github Release", exact=False).first.wait_for()
            page.get_by_text("Platforms: darwin/arm64", exact=False).first.wait_for()

            run_plugin_config_patch_smoke(page, app_url)
            run_oauth_editor_smoke(page, app_url)
            run_oauth_load_failure_smoke(page, app_url, state)
            run_auth_file_using_api_smoke(page, app_url)

            page.goto(f"{app_url}?route=dashboard#/", wait_until="domcontentloaded")
            page.wait_for_function("() => window.location.hash.endsWith('/')")
            page.get_by_text("Provider keys", exact=False).first.wait_for()
            page.get_by_text("Credential status", exact=False).first.wait_for()

            page.goto(f"{app_url}?route=workbench-toggle#/ai-providers", wait_until="domcontentloaded")
            page.wait_for_function("() => window.location.hash.endsWith('/ai-providers')")
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
            sheet.get_by_text("Custom models", exact=True).click()
            sheet.get_by_label("Upstream model name").fill("gpt-5.6-sol")
            sheet.get_by_label("Display name (optional)").fill("Codex Thinking Model")
            codex_model = sheet.get_by_label("Upstream model name").locator(
                "xpath=ancestor::div[contains(@class, 'modelEntry')][1]"
            )
            codex_model.get_by_role("button", name="Expand", exact=True).click()
            codex_model.get_by_role("checkbox", name="Maximum", exact=True).set_checked(
                True, force=True
            )
            codex_model.get_by_role(
                "checkbox", name="Allow thinking off", exact=True
            ).set_checked(True, force=True)
            codex_model.get_by_role("checkbox", name="Allow automatic budget", exact=True).set_checked(
                True, force=True
            )
            codex_model.get_by_label("Minimum token budget").fill("128")
            codex_model.get_by_label("Maximum token budget").fill("32768")
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

            page.get_by_role("button", name=re.compile(r"^xAI(?:\s|$)", re.I)).click()
            page.get_by_role("heading", name="xAI", exact=True).wait_for()
            page.get_by_role("button", name=re.compile(r"^New$", re.I)).first.click()
            sheet = page.get_by_role("dialog").last
            sheet.get_by_text(re.compile(r"^(?:New|Create) · xAI$"), exact=True).wait_for()
            xai_base_url = sheet.get_by_label("Base URL")
            if xai_base_url.input_value() != "https://api.x.ai/v1":
                raise AssertionError(
                    f"xAI create form used the wrong default base URL: {xai_base_url.input_value()!r}"
                )
            sheet.get_by_role("textbox", name="API key").fill("xai-smoke-new")
            sheet.get_by_label("Enable WebSockets").check()
            sheet.get_by_text("Custom models", exact=True).click()
            sheet.get_by_label("Upstream model name").fill("grok-4.5")
            sheet.get_by_label("Display name (optional)").fill("Grok Browser Model")
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/xai-api-key")
            ):
                sheet.get_by_role("button", name="Create").click()
            wait_for_no_dialog()

            page.get_by_role("button", name="Edit").first.click()
            sheet = page.get_by_role("dialog").last
            sheet.get_by_label("Base URL").fill("https://xai.updated.example/v1")
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/xai-api-key")
            ):
                sheet.get_by_role("button", name="Save").click()
            wait_for_no_dialog()

            page.get_by_role("button", name="Delete").first.click()
            confirm = page.get_by_role("dialog", name="Delete resource")
            confirm.get_by_text("This action cannot be undone", exact=False).first.wait_for()
            with page.expect_response(
                lambda response: response.request.method == "DELETE"
                and "/v0/management/xai-api-key" in response.url
            ):
                confirm.get_by_role("button", name="Delete").click()
            wait_for_no_dialog()

            page.get_by_role("button", name=re.compile(r"OpenAI Compatible", re.I)).click()
            page.get_by_role("heading", name="OpenAI Compatible").wait_for()
            openrouter_row = page.get_by_text("OpenRouter", exact=True).locator(
                "xpath=ancestor::tr[1]"
            )
            openrouter_row.get_by_role("button", name="Edit", exact=True).click()
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
            display_name_inputs = sheet.get_by_label("Display name (optional)")
            if display_name_inputs.first.input_value() != "Mock Model":
                raise AssertionError("Workbench did not parse existing model display-name")
            if display_name_inputs.nth(1).input_value() != "Clear Me":
                raise AssertionError("Workbench did not parse clearable model display-name")
            routing_alias_inputs = sheet.get_by_label("Routing alias (optional)")
            if routing_alias_inputs.nth(2).input_value() != "legacy-snake-alias":
                raise AssertionError("Workbench changed legacy display_name routing alias semantics")
            if routing_alias_inputs.nth(3).input_value() != "legacy-camel-alias":
                raise AssertionError("Workbench changed legacy displayName routing alias semantics")
            if display_name_inputs.nth(2).input_value() or display_name_inputs.nth(3).input_value():
                raise AssertionError("Workbench misread legacy routing aliases as display names")
            first_model = display_name_inputs.first.locator(
                "xpath=ancestor::div[contains(@class, 'modelEntry')][1]"
            )
            first_model.get_by_role("button", name="Expand", exact=True).click()
            expected_initial_thinking = {
                "Allow thinking off": True,
                "Low": True,
                "Allow automatic budget": True,
            }
            for label, expected_checked in expected_initial_thinking.items():
                if first_model.get_by_role(
                    "checkbox", name=label, exact=True
                ).is_checked() is not expected_checked:
                    raise AssertionError(
                        f"Workbench did not parse existing thinking level {label!r}"
                    )
            thinking_min = first_model.get_by_label("Minimum token budget")
            thinking_max = first_model.get_by_label("Maximum token budget")
            if thinking_min.input_value() != "128" or thinking_max.input_value() != "32768":
                raise AssertionError("Workbench did not parse existing thinking budget bounds")
            thinking_min.fill("256")
            thinking_max.fill("128")
            first_model.get_by_text(
                "Minimum token budget cannot exceed the maximum token budget.", exact=True
            ).wait_for()
            thinking_max.fill("32768")
            first_model.get_by_text(
                "Minimum token budget cannot exceed the maximum token budget.", exact=True
            ).wait_for(state="detached")
            first_model.get_by_role("checkbox", name="High", exact=True).set_checked(
                True, force=True
            )
            first_model.get_by_role("checkbox", name="Maximum", exact=True).set_checked(
                True, force=True
            )
            first_model.get_by_text("Advanced thinking JSON", exact=True).click()
            thinking_textarea = first_model.locator("textarea")
            updated_thinking = json.loads(thinking_textarea.input_value())
            if updated_thinking != {
                "levels": ["low", "high", "max", "vendor-custom"],
                "min": 256,
                "max": 32768,
                "zero_allowed": True,
                "dynamic_allowed": True,
                "x-lts-thinking-note": "keep-thinking",
            }:
                raise AssertionError(
                    "Workbench thinking selector dropped advanced config: "
                    f"{updated_thinking!r}"
                )
            thinking_textarea.fill("{")
            first_model.get_by_text(
                "Enter a valid JSON object before changing standard levels.", exact=True
            ).wait_for()
            if not first_model.get_by_role(
                "checkbox", name="High", exact=True
            ).is_disabled():
                raise AssertionError("Invalid advanced thinking JSON did not disable level edits")
            thinking_textarea.fill(json.dumps(updated_thinking))
            first_model.get_by_text(
                "Enter a valid JSON object before changing standard levels.", exact=True
            ).wait_for(state="detached")
            if not first_model.get_by_role(
                "checkbox", name="High", exact=True
            ).is_checked():
                raise AssertionError("Thinking levels did not recover after fixing advanced JSON")
            second_model = display_name_inputs.nth(1).locator(
                "xpath=ancestor::div[contains(@class, 'modelEntry')][1]"
            )
            second_model.get_by_role("button", name="Expand", exact=True).click()
            second_model.get_by_text(
                "Not explicitly configured. Core will use the model's built-in or default capability.",
                exact=True,
            ).wait_for()
            second_model.get_by_role("checkbox", name="Maximum", exact=True).set_checked(
                True, force=True
            )
            second_model.get_by_text(
                "Explicit capability configured. Custom fields in advanced JSON are preserved.",
                exact=True,
            ).wait_for()
            second_model.get_by_role("button", name="Use Core default", exact=True).click()
            second_model.get_by_text(
                "Not explicitly configured. Core will use the model's built-in or default capability.",
                exact=True,
            ).wait_for()
            display_name_inputs.first.fill("Updated Mock Model")
            display_name_inputs.nth(1).fill("")
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
            sheet.get_by_label("Display name (optional)").last.fill("Discovered Model")

            page.set_viewport_size({"width": 390, "height": 844})
            model_form_metrics = page.evaluate(
                """
                () => ({
                  clientWidth: document.documentElement.clientWidth,
                  scrollWidth: document.documentElement.scrollWidth,
                })
                """
            )
            if model_form_metrics["scrollWidth"] > model_form_metrics["clientWidth"] + 1:
                raise AssertionError(
                    f"Provider model display-name fields overflow on mobile: {model_form_metrics!r}"
                )
            page.set_viewport_size({"width": 1280, "height": 720})

            sheet.get_by_label("Prefix").fill("oa-smoke")
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/openai-compatibility")
            ):
                sheet.get_by_role("button", name="Save").click()
            wait_for_no_dialog()

            run_branded_provider_visibility_smoke(page, app_url, state)

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
            redis_retention = page.get_by_label("Redis Usage Queue Retention (seconds)")
            redis_retention.fill("0")
            page.get_by_text("Enter a whole number between 1 and 3600", exact=True).wait_for()
            redis_retention.fill("60")
            page.get_by_role("tab", name="Network & Routing", exact=True).click()
            page.get_by_label("Transient Error Cooldown (seconds)").fill("-1")
            disable_image_generation_select = page.get_by_label("Disable Image Generation")
            if disable_image_generation_select.inner_text().strip() != (
                "chat (remove image tool from non-image endpoints)"
            ):
                raise AssertionError(
                    "Visual config did not parse disable-image-generation: chat"
                )
            disable_image_generation_select.click()
            page.get_by_role(
                "option", name="passthrough (preserve client tools)", exact=True
            ).click()
            page.get_by_role("tab", name="Headers & Codex Strategy", exact=True).click()
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
            state.config_yaml = state.config_yaml.replace(
                "usage-statistics-enabled: true",
                "usage-statistics-enabled: false",
            )
            state.config_yaml = (
                f"{state.config_yaml.rstrip()}\nconcurrent-managed-smoke: keep-me\n"
            )
            page.locator('button[aria-label="Save"]').click()
            with page.expect_response(
                lambda response: response.request.method == "PUT"
                and response.url.endswith("/v0/management/config.yaml")
            ):
                page.get_by_role("button", name="Confirm Save").click()
            page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()

            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("() => window.location.hash.endsWith('/config')")
            page.get_by_text("Config Panel", exact=False).first.wait_for()
            page.get_by_role("button", name="Visual Editor").click()
            page.get_by_role("tab", name="Network & Routing", exact=True).click()
            if page.get_by_label("Disable Image Generation").inner_text().strip() != (
                "passthrough (preserve client tools)"
            ):
                raise AssertionError(
                    "Visual config did not reload disable-image-generation: passthrough"
                )

            run_quota_runtime_smoke(page, app_url, state)
            run_remote_cloud_connect_runtime_smoke(page, app_url)
            run_logs_runtime_smoke(page, app_url)
            run_home_logs_runtime_smoke(page, app_url, state)
            run_plugin_runtime_mismatch_smoke(page, api_url, state)
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
        ("GET", "/v0/management/auth-files/download"),
        ("PATCH", "/v0/management/auth-files/fields"),
        ("PATCH", "/v0/management/plugins/mock-plugin/config"),
        ("PATCH", "/v0/management/plugins/mock-plugin/enabled"),
        ("PATCH", "/v0/management/oauth-excluded-models"),
        ("PUT", "/v0/management/gemini-api-key"),
        ("PUT", "/v0/management/codex-api-key"),
        ("DELETE", "/v0/management/codex-api-key"),
        ("PUT", "/v0/management/xai-api-key"),
        ("DELETE", "/v0/management/xai-api-key"),
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
    for provider_path in [
        "/v0/management/gemini-api-key",
        "/v0/management/codex-api-key",
        "/v0/management/xai-api-key",
        "/v0/management/openai-compatibility",
    ]:
        assert_each_request_immediately_preceded_by(
            state,
            "PUT",
            provider_path,
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
        "/v0/management/xai-api-key",
        "GET",
        "/v0/management/config",
    )
    assert_request_seen_after(
        state,
        "DELETE",
        "/v0/management/xai-api-key",
        "GET",
        "/v0/management/config",
    )
    assert_request_query_contains(
        state,
        "DELETE",
        "/v0/management/xai-api-key",
        "base-url=https%3A%2F%2Fapi.x.ai%2Fv1",
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
    assert_payload_match(
        state,
        "PATCH",
        "/v0/management/auth-files/fields",
        lambda payload: payload == {"name": "xai-smoke.json", "using_api": True},
        "only the touched xAI using_api field",
    )
    assert_payload_match(
        state,
        "PATCH",
        "/v0/management/plugins/mock-plugin/config",
        lambda payload: payload == {"label": "updated-label"},
        "only the touched plugin config field",
    )
    assert_payload_match(
        state,
        "PATCH",
        "/v0/management/plugins/mock-plugin/enabled",
        lambda payload: payload == {"enabled": False},
        "the dedicated plugin enabled update",
    )
    assert_payload_match(
        state,
        "PATCH",
        "/v0/management/oauth-excluded-models",
        lambda payload: isinstance(payload, dict)
        and payload.get("provider") == "codex"
        and "gpt-5-disabled" in payload.get("models", [])
        and "gpt-*" in payload.get("models", []),
        "the pending custom OAuth exclusion rule",
    )
    assert_config_yaml_roundtrip(state)
    assert_api_call_url_seen(state, "backend-api/wham/usage", "Codex quota usage")
    assert_api_call_url_seen(
        state,
        "daily-workspace-usage-counts",
        "Codex daily analytics",
    )
    assert_api_call_url_seen(
        state,
        "usage-leaderboard",
        "Codex Team leaderboard analytics",
    )
    daily_payloads = codex_daily_workspace_api_call_payloads(state)
    if len(daily_payloads) < 2:
        raise AssertionError(
            "Codex ordinary refresh plus reset must leave at least two daily analytics requests"
        )
    expected_daily_query = (
        "start_date=2025-06-21&end_date=2026-06-16&group_by=day"
    )
    for payload in daily_payloads:
        if expected_daily_query not in str(payload.get("url") or ""):
            raise AssertionError(
                "Codex daily analytics must request one 360-day history window with an "
                f"exclusive end date; saw {payload.get('url')!r}"
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
    assert_api_call_exact_url_seen(
        state,
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
        "xAI weekly billing",
    )
    assert_api_call_exact_url_seen(
        state,
        "https://cli-chat-proxy.grok.com/v1/billing",
        "xAI monthly billing",
    )
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
        "usage-leaderboard",
        "codex-team-smoke-auth",
        "Codex Team leaderboard analytics",
    )
    assert_api_call_auth_seen(
        state,
        "backend-api/codex/remote/control/environments",
        "codex-smoke-auth",
        "Codex remote cloud connect environments",
    )
    assert_api_call_exact_url_auth_seen(
        state,
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
        "xai-smoke-auth",
        "xAI weekly billing",
    )
    assert_api_call_exact_url_auth_seen(
        state,
        "https://cli-chat-proxy.grok.com/v1/billing",
        "xai-smoke-auth",
        "xAI monthly billing",
    )
    assert_xai_billing_identity(
        state,
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
        "xAI weekly billing",
    )
    assert_xai_billing_identity(
        state,
        "https://cli-chat-proxy.grok.com/v1/billing",
        "xAI monthly billing",
    )
    assert_xai_user_identity_lookup(state)
    assert_xai_auto_topup_identity(state)
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

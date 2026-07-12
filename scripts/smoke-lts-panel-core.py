#!/usr/bin/env python3
"""Authenticated LTS Panel smoke against a real local CPA-Core-LTS process.

This optional smoke complements `scripts/smoke-lts-panel.py`, which uses a mock
Core API. It starts a sibling CPA-Core-LTS checkout with a temporary config and
runtime directories, then checks real Management API endpoints and a small set
of browser routes.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import mimetypes
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
INDEX_HTML = DIST / "index.html"
DEFAULT_CORE_DIR = ROOT.parent / "CPA-Core-LTS"
MANAGEMENT_KEY = "smoke-management-key"
CLIENT_API_KEY = "smoke-client-api-key"
BROWSER_PLUGIN_STORE_SOURCE = "https://example.com/lts-core-browser-registry.json"
BROWSER_SOURCE_MARKER = "# lts-core-browser-source-smoke: saved"
CORE_LOG_REQUEST_ID = "corefile1"
CORE_ERROR_LOG_NAME = "error-core-smoke-coreerror1.log"
CORE_ERROR_LOG_BODY = "real core error log body request_id=coreerror1"


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class StaticPanelHandler(BaseHTTPRequestHandler):
    server_version = "LTSPanelCoreSmokeStatic/1.0"

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
        try:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return


@contextlib.contextmanager
def run_static_server(port: int):
    server = ThreadingHTTPServer(("127.0.0.1", port), StaticPanelHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@dataclass
class CoreRuntime:
    api_url: str
    process: subprocess.Popen[bytes]
    log_path: Path
    config_path: Path
    logs_dir: Path


def build_core_config(port: int, temp_dir: Path) -> str:
    auth_dir = temp_dir / "auths"
    plugins_dir = temp_dir / "plugins"
    auth_dir.mkdir(parents=True, exist_ok=True)
    plugins_dir.mkdir(parents=True, exist_ok=True)

    return textwrap.dedent(
        f"""\
        host: "127.0.0.1"
        port: {port}
        auth-dir: "{auth_dir.as_posix()}"
        remote-management:
          allow-remote: false
          secret-key: ""
          disable-control-panel: true
          disable-auto-update-panel: true
        api-keys:
          - "{MANAGEMENT_KEY}"
          - "{CLIENT_API_KEY}"
        debug: false
        commercial-mode: false
        logging-to-file: true
        request-log: true
        logs-max-total-size-mb: 0
        error-logs-max-files: 10
        usage-statistics-enabled: true
        redis-usage-queue-retention-seconds: 60
        request-retry: 0
        max-retry-credentials: 1
        max-retry-interval: 1
        transient-error-cooldown-seconds: 30
        disable-image-generation: chat
        routing:
          strategy: round-robin
        codex:
          abnormal-reasoning-retry:
            hedged-retry:
              require-distinct-auth: false
        plugins:
          enabled: true
          dir: "{plugins_dir.as_posix()}"
          store-sources: []
          configs: {{}}
        gemini-api-key:
          - api-key: "gemini-smoke-key"
            base-url: "https://generativelanguage.googleapis.com"
            models:
              - name: "gemini-2.5-flash"
        codex-api-key:
          - api-key: "codex-smoke-key"
            base-url: "https://api.openai.com"
            websockets: true
            models:
              - name: "gpt-5"
        claude-api-key:
          - api-key: "claude-smoke-key"
            base-url: "https://api.anthropic.com"
            models:
              - name: "claude-sonnet-4"
        vertex-api-key:
          - api-key: "vertex-smoke-key"
            base-url: "https://vertex.example.test"
            models:
              - name: "vertex-smoke-model"
                alias: "vertex-smoke"
        openai-compatibility:
          - name: "Smoke OpenAI Compatible"
            base-url: "https://openai-compatible.example.test/v1"
            api-key-entries:
              - api-key: "openai-smoke-key"
            models:
              - name: "openai-smoke-model"
                alias: "openai-smoke"
        ampcode:
          upstream-url: "https://amp.example.test"
          upstream-api-key: "amp-smoke-upstream-key"
          force-model-mappings: true
          model-mappings:
            - from: "amp-default"
              to: "claude-sonnet-4"
          upstream-api-keys:
            - upstream-api-key: "amp-smoke-route-key"
              api-keys:
                - "{CLIENT_API_KEY}"
        """
    )


def read_tail(path: Path, max_bytes: int = 12000) -> str:
    if not path.exists():
        return ""
    data = path.read_bytes()
    if len(data) > max_bytes:
        data = data[-max_bytes:]
    return data.decode("utf-8", errors="replace")


def request_json(
    api_url: str,
    path: str,
    method: str = "GET",
    payload: Any | None = None,
    token: str = MANAGEMENT_KEY,
    expected: tuple[int, ...] = (200,),
) -> Any:
    data: bytes | None = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(f"{api_url}{path}", data=data, headers=headers, method=method)
    with urlopen(request, timeout=15) as response:
        status = response.status
        body = response.read()
        content_type = response.headers.get("Content-Type", "")
    if status not in expected:
        raise AssertionError(f"{method} {path} returned {status}, expected {expected}")
    if not body:
        return None
    if "json" not in content_type.lower():
        return body.decode("utf-8", errors="replace")
    return json.loads(body.decode("utf-8"))


def read_supports_plugin_header(api_url: str) -> bool:
    request = Request(
        f"{api_url}/v0/management/config",
        headers={
            "Authorization": f"Bearer {MANAGEMENT_KEY}",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urlopen(request, timeout=15) as response:
        value = response.headers.get("x-cpa-support-plugin", "")
        if not value:
            value = response.headers.get("X-CPA-SUPPORT-PLUGIN", "")
    return value.strip().lower() in {"1", "true", "yes", "on"}


def request_text(
    api_url: str,
    path: str,
    token: str = MANAGEMENT_KEY,
    expected: tuple[int, ...] = (200,),
) -> str:
    request = Request(
        f"{api_url}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/yaml, text/plain, */*",
        },
        method="GET",
    )
    with urlopen(request, timeout=15) as response:
        status = response.status
        body = response.read()
    if status not in expected:
        raise AssertionError(f"GET {path} returned {status}, expected {expected}")
    return body.decode("utf-8", errors="replace")


def put_text(
    api_url: str,
    path: str,
    text: str,
    token: str = MANAGEMENT_KEY,
    expected: tuple[int, ...] = (200,),
) -> Any:
    data = text.encode("utf-8")
    request = Request(
        f"{api_url}{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/yaml; charset=utf-8",
        },
        method="PUT",
    )
    with urlopen(request, timeout=15) as response:
        status = response.status
        body = response.read()
        content_type = response.headers.get("Content-Type", "")
    if status not in expected:
        raise AssertionError(f"PUT {path} returned {status}, expected {expected}")
    if not body:
        return None
    if "json" not in content_type.lower():
        return body.decode("utf-8", errors="replace")
    return json.loads(body.decode("utf-8"))


def wait_for_core(runtime: CoreRuntime, timeout_seconds: float = 90) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if runtime.process.poll() is not None:
            tail = read_tail(runtime.log_path)
            raise RuntimeError(
                f"CPA-Core-LTS exited before becoming ready (code={runtime.process.returncode}).\n{tail}"
            )
        try:
            request_json(runtime.api_url, "/v0/management/config")
            return
        except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(0.5)
    tail = read_tail(runtime.log_path)
    raise TimeoutError(f"CPA-Core-LTS did not become ready: {last_error}\n{tail}")


@contextlib.contextmanager
def run_core(core_dir: Path, temp_dir: Path):
    if not core_dir.is_dir():
        raise FileNotFoundError(f"Core directory not found: {core_dir}")
    if not (core_dir / "cmd/server/main.go").is_file():
        raise FileNotFoundError(f"Core server entrypoint not found under: {core_dir}")
    if shutil.which("go") is None:
        raise RuntimeError("Go is required to run the real CPA-Core-LTS smoke.")

    port = find_free_port()
    api_url = f"http://127.0.0.1:{port}"
    config_path = temp_dir / "config.yaml"
    log_path = temp_dir / "core-smoke.log"
    config_path.write_text(build_core_config(port, temp_dir), encoding="utf-8")

    env = os.environ.copy()
    writable_dir = temp_dir / "writable"
    logs_dir = writable_dir / "logs"
    env.update(
        {
            "MANAGEMENT_PASSWORD": MANAGEMENT_KEY,
            "WRITABLE_PATH": str(writable_dir),
        }
    )
    logs_dir.mkdir(parents=True, exist_ok=True)

    command = [
        "go",
        "run",
        "./cmd/server",
        "--config",
        str(config_path),
        "--no-browser",
        "--local-model",
    ]
    with log_path.open("wb") as log_file:
        process = subprocess.Popen(
            command,
            cwd=core_dir,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    runtime = CoreRuntime(
        api_url=api_url,
        process=process,
        log_path=log_path,
        config_path=config_path,
        logs_dir=logs_dir,
    )
    try:
        wait_for_core(runtime)
        yield runtime
    finally:
        if process.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)


def assert_mapping(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AssertionError(f"{path} returned {type(value).__name__}, expected object: {value!r}")
    return value


def assert_list(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        raise AssertionError(f"{path} returned {type(value).__name__}, expected array: {value!r}")
    return value


def contains_key(value: Any, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(contains_key(item, key) for item in value)
    return False


def replace_one(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise AssertionError(f"Could not update {label} in config.yaml")
    return updated


def wait_for_config_value(
    api_url: str,
    key: str,
    expected: Any,
    timeout_seconds: float = 8,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_config: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last_config = assert_mapping(
            request_json(api_url, "/v0/management/config"),
            "/v0/management/config",
        )
        if last_config.get(key) == expected:
            return last_config
        time.sleep(0.25)
    raise AssertionError(
        f"Core config did not reload {key}={expected!r}; last value="
        f"{None if last_config is None else last_config.get(key)!r}"
    )


def add_browser_plugin_store_source(yaml_payload: str) -> str:
    if BROWSER_PLUGIN_STORE_SOURCE in yaml_payload:
        return yaml_payload

    pattern = r"^(\s*)store-sources:\s*\[\]\s*$"
    replacement = (
        "\\1store-sources:\n"
        f'\\1  - "{BROWSER_PLUGIN_STORE_SOURCE}"'
    )
    return replace_one(yaml_payload, pattern, replacement, "plugins.store-sources")


def set_core_config_booleans(api_url: str, values: dict[str, bool]) -> None:
    yaml_payload = request_text(api_url, "/v0/management/config.yaml")
    updated_yaml = yaml_payload
    for key, enabled in values.items():
        value = "true" if enabled else "false"
        updated_yaml = replace_one(
            updated_yaml,
            rf"^{re.escape(key)}:\s*(true|false)\s*$",
            f"{key}: {value}",
            key,
        )

    if updated_yaml != yaml_payload:
        assert_mapping(
            put_text(api_url, "/v0/management/config.yaml", updated_yaml),
            "/v0/management/config.yaml",
        )

    for key, enabled in values.items():
        wait_for_config_value(api_url, key, enabled)


def seed_core_file_log_fixtures(logs_dir: Path) -> None:
    logs_dir.mkdir(parents=True, exist_ok=True)
    main_log = logs_dir / "main.log"
    main_line = (
        "[2026-06-16 12:34:56] [info ] | request_id="
        f"{CORE_LOG_REQUEST_ID} | 200 | 12ms | 127.0.0.1 | "
        "GET /v1/lts-core-file-log-smoke\n"
    )
    with main_log.open("a", encoding="utf-8") as file:
        file.write(main_line)

    (logs_dir / f"request-lts-core-file-{CORE_LOG_REQUEST_ID}.log").write_text(
        "real core request log body request_id="
        f"{CORE_LOG_REQUEST_ID}\n=== REQUEST ===\nGET /v1/lts-core-file-log-smoke\n",
        encoding="utf-8",
    )
    (logs_dir / CORE_ERROR_LOG_NAME).write_text(
        f"{CORE_ERROR_LOG_BODY}\n=== RESPONSE ===\n500 smoke error\n",
        encoding="utf-8",
    )


def provider_items(payload: Any, key: str, path: str) -> list[Any]:
    return assert_list(assert_mapping(payload, path).get(key), path)


def auth_file_entries(api_url: str) -> list[dict[str, Any]]:
    payload = assert_mapping(
        request_json(api_url, "/v0/management/auth-files"),
        "/v0/management/auth-files",
    )
    files = assert_list(payload.get("files"), "/v0/management/auth-files")
    return [item for item in files if isinstance(item, dict)]


def find_auth_file_entry(api_url: str, name: str) -> dict[str, Any] | None:
    for item in auth_file_entries(api_url):
        if item.get("name") == name or item.get("id") == name:
            return item
    return None


def run_write_smoke(api_url: str) -> list[str]:
    seen: list[str] = []

    original_yaml = request_text(api_url, "/v0/management/config.yaml")
    marker = "# lts-core-write-smoke: saved"
    updated_yaml = original_yaml.replace("debug: false", "debug: true", 1)
    if marker not in updated_yaml:
        updated_yaml = f"{updated_yaml.rstrip()}\n{marker}\n"
    seen.append("PUT /v0/management/config.yaml")
    assert_mapping(
        put_text(api_url, "/v0/management/config.yaml", updated_yaml),
        "/v0/management/config.yaml",
    )
    reloaded_yaml = request_text(api_url, "/v0/management/config.yaml")
    seen.append("GET /v0/management/config.yaml after write")
    if marker not in reloaded_yaml or "debug: true" not in reloaded_yaml:
        raise AssertionError("config.yaml write smoke did not persist marker and debug flag")
    reloaded_config = wait_for_config_value(api_url, "debug", True)
    seen.append("GET /v0/management/config after config.yaml write")
    if reloaded_config.get("debug") is not True:
        raise AssertionError("Core config did not reload debug=true after config.yaml write")

    gemini_payload = [
        {
            "api-key": "gemini-real-write-key",
            "base-url": "https://generativelanguage.googleapis.com",
            "excluded-models": ["*"],
            "models": [{"name": "gemini-2.5-flash"}],
        }
    ]
    seen.append("PUT /v0/management/gemini-api-key")
    assert_mapping(
        request_json(api_url, "/v0/management/gemini-api-key", method="PUT", payload=gemini_payload),
        "/v0/management/gemini-api-key",
    )
    gemini_items = provider_items(
        request_json(api_url, "/v0/management/gemini-api-key"),
        "gemini-api-key",
        "/v0/management/gemini-api-key",
    )
    seen.append("GET /v0/management/gemini-api-key after write")
    if not any(
        isinstance(item, dict)
        and item.get("api-key") == "gemini-real-write-key"
        and item.get("excluded-models") == ["*"]
        for item in gemini_items
    ):
        raise AssertionError(f"Gemini write smoke did not round-trip excluded-models: {gemini_items!r}")

    codex_payload = [
        {
            "api-key": "codex-real-write-key",
            "base-url": "https://api.openai.com",
            "websockets": True,
            "models": [{"name": "gpt-5", "alias": "gpt-5-real-write"}],
        }
    ]
    seen.append("PUT /v0/management/codex-api-key")
    assert_mapping(
        request_json(api_url, "/v0/management/codex-api-key", method="PUT", payload=codex_payload),
        "/v0/management/codex-api-key",
    )
    codex_items = provider_items(
        request_json(api_url, "/v0/management/codex-api-key"),
        "codex-api-key",
        "/v0/management/codex-api-key",
    )
    seen.append("GET /v0/management/codex-api-key after write")
    if not any(
        isinstance(item, dict)
        and item.get("api-key") == "codex-real-write-key"
        and item.get("websockets") is True
        for item in codex_items
    ):
        raise AssertionError(f"Codex write smoke did not round-trip websockets: {codex_items!r}")

    delete_query = urlencode(
        {
            "api-key": "codex-real-write-key",
            "base-url": "https://api.openai.com",
        }
    )
    seen.append("DELETE /v0/management/codex-api-key")
    assert_mapping(
        request_json(api_url, f"/v0/management/codex-api-key?{delete_query}", method="DELETE"),
        "/v0/management/codex-api-key",
    )
    codex_after_delete = provider_items(
        request_json(api_url, "/v0/management/codex-api-key"),
        "codex-api-key",
        "/v0/management/codex-api-key",
    )
    seen.append("GET /v0/management/codex-api-key after delete")
    if any(
        isinstance(item, dict) and item.get("api-key") == "codex-real-write-key"
        for item in codex_after_delete
    ):
        raise AssertionError(f"Codex delete smoke did not remove written key: {codex_after_delete!r}")

    openai_payload = [
        {
            "name": "Smoke OpenAI Compatible",
            "prefix": "real-write",
            "base-url": "https://openai-compatible.example.test/v1",
            "api-key-entries": [{"api-key": "openai-real-write-key"}],
            "models": [
                {
                    "name": "openai-real-write-model",
                    "alias": "openai-real-write",
                    "image": True,
                }
            ],
        }
    ]
    seen.append("PUT /v0/management/openai-compatibility")
    assert_mapping(
        request_json(
            api_url,
            "/v0/management/openai-compatibility",
            method="PUT",
            payload=openai_payload,
        ),
        "/v0/management/openai-compatibility",
    )
    openai_items = provider_items(
        request_json(api_url, "/v0/management/openai-compatibility"),
        "openai-compatibility",
        "/v0/management/openai-compatibility",
    )
    seen.append("GET /v0/management/openai-compatibility after write")
    if not any(
        isinstance(item, dict)
        and item.get("name") == "Smoke OpenAI Compatible"
        and item.get("prefix") == "real-write"
        for item in openai_items
    ):
        raise AssertionError(f"OpenAI Compatibility write smoke did not round-trip prefix: {openai_items!r}")
    persisted_yaml = request_text(api_url, "/v0/management/config.yaml")
    seen.append("GET /v0/management/config.yaml after provider writes")
    if "auth-index" in persisted_yaml or "authIndex" in persisted_yaml:
        raise AssertionError("Provider write smoke persisted response-only auth-index into config.yaml")
    if contains_key(openai_payload, "auth-index") or contains_key(openai_payload, "authIndex"):
        raise AssertionError("OpenAI Compatibility write smoke payload unexpectedly contains auth-index")

    return seen


def run_auth_files_write_smoke(api_url: str) -> list[str]:
    seen: list[str] = []
    auth_name = "lts-xai-auth-smoke.json"
    upload_path = f"/v0/management/auth-files?{urlencode({'name': auth_name})}"
    download_path = f"/v0/management/auth-files/download?{urlencode({'name': auth_name})}"
    auth_payload = {
        "type": "xai",
        "email": "lts-xai-auth-smoke@example.test",
        "access_token": "dummy-lts-smoke-access-token",
        "refresh_token": "dummy-lts-smoke-refresh-token",
        "note": "created by lts smoke",
    }

    seen.append("POST /v0/management/auth-files")
    seen.append(f"POST {upload_path}")
    assert_mapping(
        request_json(api_url, upload_path, method="POST", payload=auth_payload),
        upload_path,
    )

    created_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v0/management/auth-files after auth upload")
    if (
        not created_entry
        or created_entry.get("type") != "xai"
        or created_entry.get("email") != "lts-xai-auth-smoke@example.test"
    ):
        raise AssertionError(f"Auth file upload did not appear in list: {created_entry!r}")

    seen.append("PATCH /v0/management/auth-files/fields")
    fields_patch = {
        "name": auth_name,
        "prefix": "auth-smoke",
        "proxy_url": "http://127.0.0.1:7890",
        "priority": 7,
        "websockets": True,
        "using_api": True,
        "note": "updated by lts smoke",
        "headers": {
            "X-LTS-Smoke": "1",
        },
    }
    assert_mapping(
        request_json(api_url, "/v0/management/auth-files/fields", method="PATCH", payload=fields_patch),
        "/v0/management/auth-files/fields",
    )

    patched_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v0/management/auth-files after auth fields patch")
    if not patched_entry:
        raise AssertionError("Auth file disappeared after fields patch")
    if patched_entry.get("priority") != 7:
        raise AssertionError(f"Auth file priority did not round-trip through list: {patched_entry!r}")
    if patched_entry.get("websockets") is not True:
        raise AssertionError(f"Auth file websockets did not round-trip through list: {patched_entry!r}")
    if patched_entry.get("note") != "updated by lts smoke":
        raise AssertionError(f"Auth file note did not round-trip through list: {patched_entry!r}")

    # /auth-files intentionally returns a curated list shape and does not expose every
    # arbitrary auth-file field. The raw download is the persistence truth for using_api.
    downloaded = json.loads(request_text(api_url, download_path))
    seen.append("GET /v0/management/auth-files/download after auth fields patch")
    if (
        downloaded.get("prefix") != "auth-smoke"
        or downloaded.get("proxy_url") != "http://127.0.0.1:7890"
        or downloaded.get("priority") != 7
        or downloaded.get("websockets") is not True
        or downloaded.get("using_api") is not True
        or downloaded.get("note") != "updated by lts smoke"
        or downloaded.get("headers") != {"X-LTS-Smoke": "1"}
    ):
        raise AssertionError(f"Auth file fields patch did not persist to download payload: {downloaded!r}")

    seen.append("PATCH /v0/management/auth-files/status")
    disabled_result = assert_mapping(
        request_json(
            api_url,
            "/v0/management/auth-files/status",
            method="PATCH",
            payload={"name": auth_name, "disabled": True},
        ),
        "/v0/management/auth-files/status",
    )
    if disabled_result.get("disabled") is not True:
        raise AssertionError(f"Auth file status patch did not report disabled=true: {disabled_result!r}")
    disabled_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v0/management/auth-files after auth status patch")
    if not disabled_entry or disabled_entry.get("disabled") is not True:
        raise AssertionError(f"Auth file status patch did not round-trip through list: {disabled_entry!r}")

    seen.append("DELETE /v0/management/auth-files")
    assert_mapping(
        request_json(
            api_url,
            "/v0/management/auth-files",
            method="DELETE",
            payload={"names": [auth_name]},
        ),
        "/v0/management/auth-files",
    )
    deleted_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v0/management/auth-files after auth delete")
    if deleted_entry is not None:
        raise AssertionError(f"Auth file delete did not remove smoke file: {deleted_entry!r}")
    seen.append(
        "Auth files smoke uploaded patched xAI using_api disabled and deleted temporary auth file"
    )

    return seen


def run_plugin_config_smoke(api_url: str) -> list[str]:
    seen: list[str] = []
    plugin_id = "lts-smoke-plugin"
    config_path = f"/v0/management/plugins/{plugin_id}/config"
    enabled_path = f"/v0/management/plugins/{plugin_id}/enabled"
    plugin_path = f"/v0/management/plugins/{plugin_id}"

    plugin_payload = {
        "enabled": True,
        "priority": 4,
        "mode": "safe",
        "permissions": {
            "auth-list": True,
            "model-execute": True,
        },
        "nested": {
            "keep": "yes",
        },
    }

    seen.append(f"PUT {config_path}")
    assert_mapping(
        request_json(api_url, config_path, method="PUT", payload=plugin_payload),
        config_path,
    )
    saved_config = assert_mapping(request_json(api_url, config_path), config_path)
    seen.append(f"GET {config_path} after put")
    if (
        saved_config.get("enabled") is not True
        or saved_config.get("priority") != 4
        or saved_config.get("mode") != "safe"
        or saved_config.get("nested") != {"keep": "yes"}
    ):
        raise AssertionError(f"Plugin config PUT did not round-trip: {saved_config!r}")

    seen.append(f"PATCH {enabled_path} disabled")
    assert_mapping(
        request_json(api_url, enabled_path, method="PATCH", payload={"enabled": False}),
        enabled_path,
    )
    disabled_config = assert_mapping(request_json(api_url, config_path), config_path)
    seen.append(f"GET {config_path} after disable")
    if disabled_config.get("enabled") is not False:
        raise AssertionError(
            f"Plugin enabled endpoint did not expose disabled state: {disabled_config!r}"
        )

    seen.append(f"PATCH {enabled_path} enabled")
    assert_mapping(
        request_json(api_url, enabled_path, method="PATCH", payload={"enabled": True}),
        enabled_path,
    )

    seen.append(f"PATCH {config_path}")
    assert_mapping(
        request_json(
            api_url,
            config_path,
            method="PATCH",
            payload={"mode": "fast", "count": 3},
        ),
        config_path,
    )
    patched_config = assert_mapping(request_json(api_url, config_path), config_path)
    seen.append(f"GET {config_path} after patch")
    if (
        patched_config.get("enabled") is not True
        or patched_config.get("priority") != 4
        or patched_config.get("mode") != "fast"
        or patched_config.get("count") != 3
    ):
        raise AssertionError(f"Plugin config PATCH did not merge fields: {patched_config!r}")

    list_payload = assert_mapping(request_json(api_url, "/v0/management/plugins"), "/v0/management/plugins")
    seen.append("GET /v0/management/plugins after plugin config patch")
    plugins = assert_list(list_payload.get("plugins"), "/v0/management/plugins")
    plugin_entry = next((item for item in plugins if isinstance(item, dict) and item.get("id") == plugin_id), None)
    if (
        not isinstance(plugin_entry, dict)
        or plugin_entry.get("configured") is not True
        or plugin_entry.get("registered") is not False
        or plugin_entry.get("enabled") is not True
        or plugin_entry.get("effective_enabled") is not False
    ):
        raise AssertionError(f"Configured-only plugin list entry is invalid: {plugin_entry!r}")

    persisted_yaml = request_text(api_url, "/v0/management/config.yaml")
    seen.append("GET /v0/management/config.yaml after plugin config patch")
    for marker in [plugin_id, "mode: fast", "count: 3", "permissions:"]:
        if marker not in persisted_yaml:
            raise AssertionError(f"Plugin config YAML missing marker {marker!r}")

    seen.append(f"DELETE {plugin_path}")
    delete_result = assert_mapping(
        request_json(api_url, plugin_path, method="DELETE"),
        plugin_path,
    )
    if (
        delete_result.get("status") != "deleted"
        or delete_result.get("configured_removed") is not True
        or delete_result.get("file_deleted") is not False
        or delete_result.get("restart_required") is not False
    ):
        raise AssertionError(f"Plugin DELETE returned unexpected result: {delete_result!r}")
    plugins_after_delete = assert_list(
        assert_mapping(request_json(api_url, "/v0/management/plugins"), "/v0/management/plugins").get("plugins"),
        "/v0/management/plugins",
    )
    seen.append("GET /v0/management/plugins after plugin delete")
    if any(isinstance(item, dict) and item.get("id") == plugin_id for item in plugins_after_delete):
        raise AssertionError(f"Plugin DELETE did not remove configured plugin from live API: {plugins_after_delete!r}")
    seen.append("Plugin config smoke removed configured-only plugin from live API")

    return seen


def run_endpoint_smoke(api_url: str, include_plugin_store: bool, include_write_smoke: bool) -> tuple[list[str], bool]:
    seen: list[str] = []
    supports_plugin = read_supports_plugin_header(api_url)
    seen.append(f"x-cpa-support-plugin={str(supports_plugin).lower()}")

    def get(path: str) -> Any:
        seen.append(f"GET {path}")
        return request_json(api_url, path)

    config_payload = assert_mapping(get("/v0/management/config"), "/v0/management/config")
    if config_payload.get("usage-statistics-enabled") is not True:
        raise AssertionError("Core config did not expose usage-statistics-enabled=true")
    if "ampcode" not in config_payload:
        raise AssertionError("Core config did not expose ampcode block")

    yaml_payload = request_text(api_url, "/v0/management/config.yaml")
    seen.append("GET /v0/management/config.yaml")
    for marker in ["usage-statistics-enabled: true", "plugins:", "ampcode:"]:
        if marker not in yaml_payload:
            raise AssertionError(f"config.yaml missing marker {marker!r}")

    usage = assert_mapping(get("/v0/management/usage"), "/v0/management/usage")
    if "usage" not in usage:
        raise AssertionError("/usage response missing usage object")

    export_payload = assert_mapping(
        get("/v0/management/usage/export"),
        "/v0/management/usage/export",
    )
    if export_payload.get("version") != 1 or "usage" not in export_payload:
        raise AssertionError(f"Invalid usage export payload: {export_payload!r}")

    seen.append("POST /v0/management/usage/import")
    import_result = assert_mapping(
        request_json(api_url, "/v0/management/usage/import", method="POST", payload=export_payload),
        "/v0/management/usage/import",
    )
    if "total_requests" not in import_result:
        raise AssertionError(f"Invalid usage import result: {import_result!r}")

    assert_mapping(get("/v0/management/api-key-usage"), "/v0/management/api-key-usage")
    assert_mapping(get("/v0/management/ampcode"), "/v0/management/ampcode")
    assert_mapping(get("/v0/management/ampcode/upstream-api-keys"), "/v0/management/ampcode/upstream-api-keys")
    assert_mapping(get("/v0/management/ampcode/model-mappings"), "/v0/management/ampcode/model-mappings")
    assert_mapping(get("/v0/management/plugins"), "/v0/management/plugins")
    assert_mapping(get("/v0/management/auth-files"), "/v0/management/auth-files")
    assert_mapping(get("/v0/management/logs?limit=100"), "/v0/management/logs")
    assert_mapping(get("/v0/management/request-error-logs"), "/v0/management/request-error-logs")
    assert_mapping(get("/v0/management/oauth-excluded-models"), "/v0/management/oauth-excluded-models")
    assert_mapping(get("/v0/management/oauth-model-alias"), "/v0/management/oauth-model-alias")

    for provider_path, key in [
        ("/v0/management/gemini-api-key", "gemini-api-key"),
        ("/v0/management/codex-api-key", "codex-api-key"),
        ("/v0/management/claude-api-key", "claude-api-key"),
        ("/v0/management/vertex-api-key", "vertex-api-key"),
        ("/v0/management/openai-compatibility", "openai-compatibility"),
    ]:
        payload = assert_mapping(get(provider_path), provider_path)
        assert_list(payload.get(key), provider_path)

    models = assert_mapping(
        request_json(api_url, "/v1/models", token=MANAGEMENT_KEY),
        "/v1/models",
    )
    seen.append("GET /v1/models")
    if "data" not in models:
        raise AssertionError(f"/v1/models missing data: {models!r}")

    if include_plugin_store:
        assert_mapping(get("/v0/management/plugin-store"), "/v0/management/plugin-store")

    if include_write_smoke:
        seen.extend(run_write_smoke(api_url))
        seen.extend(run_auth_files_write_smoke(api_url))
        if supports_plugin:
            seen.extend(run_plugin_config_smoke(api_url))
        else:
            seen.append("SKIP plugin config smoke because x-cpa-support-plugin is false")

    return seen, supports_plugin


def run_browser_config_save_smoke(page: Any, api_url: str) -> list[str]:
    seen: list[str] = []

    page.evaluate("() => { window.location.hash = '/config'; }")
    page.wait_for_function("() => window.location.hash.endsWith('/config')")
    page.get_by_text("Config Panel", exact=False).first.wait_for()
    page.get_by_role("button", name="Source File Editor").click()
    editor = page.locator(".cm-content").first
    editor.wait_for()

    current_yaml = request_text(api_url, "/v0/management/config.yaml")
    debug_match = re.search(r"^debug:\s*(true|false)\s*$", current_yaml, re.MULTILINE)
    if not debug_match:
        raise AssertionError("config.yaml missing debug boolean for browser source smoke")
    next_debug = "false" if debug_match.group(1) == "true" else "true"
    source_yaml = replace_one(
        current_yaml,
        r"^debug:\s*(true|false)\s*$",
        f"debug: {next_debug}",
        "debug",
    )
    source_yaml = add_browser_plugin_store_source(source_yaml)
    if BROWSER_SOURCE_MARKER not in source_yaml:
        source_yaml = f"{source_yaml.rstrip()}\n{BROWSER_SOURCE_MARKER}\n"

    editor.fill(source_yaml)
    page.locator('button[aria-label="Save"]').click()
    page.get_by_text("Review Changes", exact=False).first.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith("/v0/management/config.yaml")
    ):
        page.get_by_role("button", name="Confirm Save").click()
    page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()
    seen.append("BROWSER source save PUT /v0/management/config.yaml")

    saved_yaml = request_text(api_url, "/v0/management/config.yaml")
    if f"debug: {next_debug}" not in saved_yaml:
        raise AssertionError("Browser source save did not persist debug toggle")
    if BROWSER_PLUGIN_STORE_SOURCE not in saved_yaml:
        raise AssertionError("Browser source save did not persist plugins.store-sources")

    page.get_by_role("button", name="Visual Editor").click()
    logging_toggle = page.get_by_label("Log to File")
    logging_toggle.scroll_into_view_if_needed()
    logging_was_checked = logging_toggle.is_checked()
    logging_toggle.evaluate("(element) => element.click()")
    expected_logging = not logging_was_checked
    page.get_by_role("tab", name="Network & Routing", exact=True).click()
    transient_cooldown_input = page.get_by_label("Transient Error Cooldown (seconds)")
    transient_cooldown_input.scroll_into_view_if_needed()
    transient_cooldown_input.fill("0")
    disable_image_generation_select = page.get_by_label("Disable Image Generation")
    disable_image_generation_select.scroll_into_view_if_needed()
    disable_image_generation_select.click()
    page.get_by_role(
        "option", name="passthrough (preserve client tools)", exact=True
    ).click()
    page.get_by_role("tab", name="Headers & Codex Strategy", exact=True).click()
    retry_action_select = page.get_by_label("Retry action")
    retry_action_select.scroll_into_view_if_needed()
    retry_action_select.click()
    page.get_by_role("option", name="Retry").click()
    stream_buffer_max_input = page.get_by_label("Stream buffer max bytes")
    stream_buffer_max_input.scroll_into_view_if_needed()
    stream_buffer_max_input.fill("4096")
    hedged_retry_toggle = page.get_by_label("Enable Hedged Retry")
    hedged_retry_toggle.scroll_into_view_if_needed()
    hedged_retry_toggle.evaluate("(element) => { if (!element.checked) element.click(); }")
    hedge_delay_input = page.get_by_label("Hedge delay (ms)")
    hedge_delay_input.scroll_into_view_if_needed()
    hedge_delay_input.fill("250")
    require_distinct_auth_toggle = page.get_by_label("Require Distinct Auth")
    require_distinct_auth_toggle.scroll_into_view_if_needed()
    require_distinct_auth_toggle.evaluate(
        "(element) => { if (!element.checked) element.click(); }"
    )
    hedged_retry_mode_select = page.get_by_label("Hedged retry mode")
    hedged_retry_mode_select.scroll_into_view_if_needed()
    hedged_retry_mode_select.click()
    page.get_by_role("option", name="Speed").click()
    exhausted_behavior_select = page.get_by_label("Exhausted behavior")
    exhausted_behavior_select.scroll_into_view_if_needed()
    exhausted_behavior_select.click()
    page.get_by_role("option", name="Pass through abnormal response").click()
    client_usage_aggregation_select = page.get_by_label("Client usage aggregation")
    client_usage_aggregation_select.scroll_into_view_if_needed()
    client_usage_aggregation_select.click()
    page.get_by_role("option", name="Sum with delivered total").click()
    delivery_policy_select = page.get_by_label("Delivery policy")
    delivery_policy_select.scroll_into_view_if_needed()
    delivery_policy_select.click()
    page.get_by_role("option", name="Max output").click()
    fallback_policy_select = page.get_by_label("Fallback policy")
    fallback_policy_select.scroll_into_view_if_needed()
    fallback_policy_select.click()
    page.get_by_role("option", name="Max output special").click()

    page.locator('button[aria-label="Save"]').click()
    page.get_by_text("Review Changes", exact=False).first.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith("/v0/management/config.yaml")
    ):
        page.get_by_role("button", name="Confirm Save").click()
    page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()
    seen.append("BROWSER visual save PUT /v0/management/config.yaml")

    visual_saved_yaml = request_text(api_url, "/v0/management/config.yaml")
    expected_logging_text = f"logging-to-file: {str(expected_logging).lower()}"
    if expected_logging_text not in visual_saved_yaml:
        raise AssertionError("Browser visual save did not persist logging-to-file toggle")
    if "transient-error-cooldown-seconds: 0" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist transient-error-cooldown-seconds"
        )
    if "disable-image-generation: passthrough" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist disable-image-generation passthrough"
        )
    if "action: retry" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry action"
        )
    if "exhausted-behavior: pass-through" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry exhausted-behavior"
        )
    if "client-usage-aggregation: sum-with-delivered-total" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry client-usage-aggregation"
        )
    if "delivery-policy: max-output" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry delivery-policy"
        )
    if "fallback-policy: max-output-special" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry fallback-policy"
        )
    if "stream-buffer-max-bytes: 4096" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry stream-buffer-max-bytes"
        )
    if not re.search(
        r"hedged-retry:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+enabled: true",
        visual_saved_yaml,
    ):
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry hedged-retry.enabled"
        )
    if not re.search(
        r"hedged-retry:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+mode: speed",
        visual_saved_yaml,
    ):
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry hedged-retry.mode"
        )
    if "hedge-delay-ms: 250" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry hedge-delay-ms"
        )
    if "require-distinct-auth: true" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist codex abnormal retry require-distinct-auth"
        )
    if BROWSER_PLUGIN_STORE_SOURCE not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save dropped plugins.store-sources from the source draft"
        )
    if BROWSER_SOURCE_MARKER not in visual_saved_yaml:
        raise AssertionError("Browser visual save dropped the source mode marker comment")
    seen.append("BROWSER visual save preserved plugins.store-sources")

    return seen


def wait_for_no_dialog(page: Any) -> None:
    page.wait_for_function("() => document.querySelectorAll('[role=\"dialog\"]').length === 0")


def is_provider_disabled(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    excluded = item.get("excluded-models")
    return isinstance(excluded, list) and "*" in excluded


def mask_api_key(api_key: str) -> str:
    trimmed = str(api_key or "").strip()
    if not trimmed:
        return ""
    visible_chars = 1 if len(trimmed) < 4 else 2
    masked_length = max(10 - visible_chars * 2, 1)
    return f"{trimmed[:visible_chars]}{'*' * masked_length}{trimmed[-visible_chars:]}"


def provider_row_for_api_key(page: Any, api_key: str) -> Any:
    row = page.get_by_role("row").filter(has_text=mask_api_key(api_key)).first
    row.wait_for()
    return row


BROWSER_PROVIDER_KEY_CRUD_MARKERS = (
    "BROWSER provider workbench Claude create PUT /v0/management/claude-api-key",
    "BROWSER provider workbench Claude update PUT /v0/management/claude-api-key",
    "BROWSER provider workbench Claude delete DELETE /v0/management/claude-api-key",
    "BROWSER provider workbench Vertex create PUT /v0/management/vertex-api-key",
    "BROWSER provider workbench Vertex update PUT /v0/management/vertex-api-key",
    "BROWSER provider workbench Vertex delete DELETE /v0/management/vertex-api-key",
)


def run_browser_provider_key_crud_smoke(
    page: Any,
    api_url: str,
    label: str,
    button_pattern: str,
    endpoint: str,
    response_key: str,
    api_key: str,
    create_base_url: str,
    update_base_url: str,
) -> list[str]:
    seen: list[str] = []

    page.get_by_role("button", name=re.compile(button_pattern, re.I)).click()
    page.get_by_role("heading", name=label).wait_for()
    page.get_by_role("button", name=re.compile(r"^New$", re.I)).first.click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_role("textbox", name="API key").fill(api_key)
    sheet.get_by_label("Base URL").fill(create_base_url)
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith(endpoint)
    ):
        sheet.get_by_role("button", name="Create").click()
    wait_for_no_dialog(page)
    seen.append(f"BROWSER provider workbench {label} create PUT {endpoint}")
    items_after_create = provider_items(request_json(api_url, endpoint), response_key, endpoint)
    if not any(
        isinstance(item, dict)
        and item.get("api-key") == api_key
        and item.get("base-url") == create_base_url
        for item in items_after_create
    ):
        raise AssertionError(f"{label} browser create did not round-trip: {items_after_create!r}")

    row = provider_row_for_api_key(page, api_key)
    row.get_by_role("button", name="Edit").click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_label("Base URL").fill(update_base_url)
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith(endpoint)
    ):
        sheet.get_by_role("button", name="Save").click()
    wait_for_no_dialog(page)
    seen.append(f"BROWSER provider workbench {label} update PUT {endpoint}")
    items_after_update = provider_items(request_json(api_url, endpoint), response_key, endpoint)
    if not any(
        isinstance(item, dict)
        and item.get("api-key") == api_key
        and item.get("base-url") == update_base_url
        for item in items_after_update
    ):
        raise AssertionError(f"{label} browser update did not round-trip: {items_after_update!r}")

    row = provider_row_for_api_key(page, api_key)
    row.get_by_role("button", name="Delete").click()
    confirm = page.get_by_role("dialog", name="Delete resource")
    confirm.get_by_text("This action cannot be undone", exact=False).first.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "DELETE"
        and endpoint in response.url
    ):
        confirm.get_by_role("button", name="Delete").click()
    wait_for_no_dialog(page)
    seen.append(f"BROWSER provider workbench {label} delete DELETE {endpoint}")
    items_after_delete = provider_items(request_json(api_url, endpoint), response_key, endpoint)
    if any(isinstance(item, dict) and item.get("api-key") == api_key for item in items_after_delete):
        raise AssertionError(f"{label} browser delete did not remove the created key: {items_after_delete!r}")

    return seen


def run_browser_provider_workbench_smoke(page: Any, app_url: str, api_url: str) -> list[str]:
    seen: list[str] = []

    page.goto(f"{app_url}?core-provider-workbench#/ai-providers/workbench", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/ai-providers/workbench')")
    page.get_by_role("heading", name="AI Providers").wait_for()

    gemini_before = provider_items(
        request_json(api_url, "/v0/management/gemini-api-key"),
        "gemini-api-key",
        "/v0/management/gemini-api-key",
    )
    if not gemini_before:
        raise AssertionError("Browser workbench smoke expected at least one Gemini resource")
    gemini_was_disabled = is_provider_disabled(gemini_before[0])
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith("/v0/management/gemini-api-key")
    ):
        page.get_by_label(re.compile(r"Enable|Disable", re.I)).first.evaluate(
            "(element) => element.click()"
        )
    seen.append("BROWSER provider workbench Gemini toggle PUT /v0/management/gemini-api-key")
    gemini_after = provider_items(
        request_json(api_url, "/v0/management/gemini-api-key"),
        "gemini-api-key",
        "/v0/management/gemini-api-key",
    )
    if not gemini_after or is_provider_disabled(gemini_after[0]) == gemini_was_disabled:
        raise AssertionError(f"Gemini browser toggle did not change disabled state: {gemini_after!r}")

    page.get_by_role("button", name=re.compile(r"Codex", re.I)).click()
    page.get_by_role("heading", name="Codex").wait_for()
    page.get_by_role("button", name=re.compile(r"^New$", re.I)).first.click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_role("textbox", name="API key").fill("codex-browser-new")
    sheet.get_by_label("Base URL").fill("https://codex.browser.example/v1")
    sheet.get_by_label("Enable WebSockets").check()
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith("/v0/management/codex-api-key")
    ):
        sheet.get_by_role("button", name="Create").click()
    wait_for_no_dialog(page)
    seen.append("BROWSER provider workbench Codex create PUT /v0/management/codex-api-key")
    codex_after_create = provider_items(
        request_json(api_url, "/v0/management/codex-api-key"),
        "codex-api-key",
        "/v0/management/codex-api-key",
    )
    if not any(
        isinstance(item, dict)
        and item.get("api-key") == "codex-browser-new"
        and item.get("base-url") == "https://codex.browser.example/v1"
        and item.get("websockets") is True
        for item in codex_after_create
    ):
        raise AssertionError(f"Codex browser create did not round-trip: {codex_after_create!r}")

    page.get_by_role("button", name="Edit").first.click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_label("Base URL").fill("https://codex.browser-updated.example/v1")
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith("/v0/management/codex-api-key")
    ):
        sheet.get_by_role("button", name="Save").click()
    wait_for_no_dialog(page)
    seen.append("BROWSER provider workbench Codex update PUT /v0/management/codex-api-key")
    codex_after_update = provider_items(
        request_json(api_url, "/v0/management/codex-api-key"),
        "codex-api-key",
        "/v0/management/codex-api-key",
    )
    if not any(
        isinstance(item, dict)
        and item.get("api-key") == "codex-browser-new"
        and item.get("base-url") == "https://codex.browser-updated.example/v1"
        for item in codex_after_update
    ):
        raise AssertionError(f"Codex browser update did not round-trip: {codex_after_update!r}")

    page.get_by_role("button", name="Delete").first.click()
    confirm = page.get_by_role("dialog", name="Delete resource")
    confirm.get_by_text("This action cannot be undone", exact=False).first.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "DELETE"
        and "/v0/management/codex-api-key" in response.url
    ):
        confirm.get_by_role("button", name="Delete").click()
    wait_for_no_dialog(page)
    seen.append("BROWSER provider workbench Codex delete DELETE /v0/management/codex-api-key")
    codex_after_delete = provider_items(
        request_json(api_url, "/v0/management/codex-api-key"),
        "codex-api-key",
        "/v0/management/codex-api-key",
    )
    if any(isinstance(item, dict) and item.get("api-key") == "codex-browser-new" for item in codex_after_delete):
        raise AssertionError(f"Codex browser delete did not remove the created key: {codex_after_delete!r}")

    seen.extend(
        run_browser_provider_key_crud_smoke(
            page,
            api_url,
            label="Claude",
            button_pattern=r"^Claude\b",
            endpoint="/v0/management/claude-api-key",
            response_key="claude-api-key",
            api_key="claude-browser-new",
            create_base_url="https://claude.browser.example",
            update_base_url="https://claude.browser-updated.example",
        )
    )

    seen.extend(
        run_browser_provider_key_crud_smoke(
            page,
            api_url,
            label="Vertex",
            button_pattern=r"Vertex",
            endpoint="/v0/management/vertex-api-key",
            response_key="vertex-api-key",
            api_key="vertex-browser-new",
            create_base_url="https://vertex.browser.example",
            update_base_url="https://vertex.browser-updated.example",
        )
    )

    page.get_by_role("button", name=re.compile(r"OpenAI Compatible", re.I)).click()
    page.get_by_role("heading", name="OpenAI Compatible").wait_for()
    page.get_by_role("button", name="Edit").first.click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_label("Prefix").fill("browser-oa-smoke")
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith("/v0/management/openai-compatibility")
    ):
        sheet.get_by_role("button", name="Save").click()
    wait_for_no_dialog(page)
    seen.append(
        "BROWSER provider workbench OpenAI Compatibility save PUT /v0/management/openai-compatibility"
    )
    openai_after_save = provider_items(
        request_json(api_url, "/v0/management/openai-compatibility"),
        "openai-compatibility",
        "/v0/management/openai-compatibility",
    )
    if not any(
        isinstance(item, dict)
        and item.get("name") == "Smoke OpenAI Compatible"
        and item.get("prefix") == "browser-oa-smoke"
        for item in openai_after_save
    ):
        raise AssertionError(f"OpenAI browser save did not round-trip prefix: {openai_after_save!r}")
    persisted_yaml = request_text(api_url, "/v0/management/config.yaml")
    if "auth-index" in persisted_yaml or "authIndex" in persisted_yaml:
        raise AssertionError("Browser provider workbench persisted response-only auth-index")
    seen.append("BROWSER provider workbench kept auth-index out of config.yaml")

    return seen


def read_download_text(download: Any) -> str:
    path = download.path()
    if not path:
        return ""
    return Path(path).read_text(encoding="utf-8", errors="replace")


def run_browser_real_core_logs_smoke(
    page: Any,
    app_url: str,
    api_url: str,
    logs_dir: Path,
) -> list[str]:
    seen: list[str] = []

    set_core_config_booleans(
        api_url,
        {
            "logging-to-file": True,
            "request-log": True,
        },
    )
    seed_core_file_log_fixtures(logs_dir)
    seen.append("SEEDED real Core file logs with request-log enabled")

    page.goto(f"{app_url}?core-logs=file-request#/logs", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/logs')")
    page.get_by_text("Logs Viewer", exact=False).first.wait_for()
    page.get_by_text(CORE_LOG_REQUEST_ID, exact=False).first.wait_for()

    request_id_badge = page.get_by_text(CORE_LOG_REQUEST_ID, exact=True).first
    box = request_id_badge.bounding_box()
    if not box:
        raise AssertionError("Could not locate real Core request id badge for long-press smoke")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(750)
    page.mouse.up()
    request_dialog = page.get_by_role("dialog", name="Download Request Log")
    request_dialog.get_by_text(CORE_LOG_REQUEST_ID, exact=False).wait_for()
    with page.expect_download() as request_download:
        request_dialog.get_by_role("button", name="Confirm").click()
    request_file = request_download.value
    if request_file.suggested_filename != f"request-{CORE_LOG_REQUEST_ID}.log":
        raise AssertionError(
            "Unexpected real Core request log download filename: "
            f"{request_file.suggested_filename}"
        )
    if CORE_LOG_REQUEST_ID not in read_download_text(request_file):
        raise AssertionError("Real Core request log download did not contain the smoke request id")
    seen.append("BROWSER real Core request log download GET /v0/management/request-log-by-id")

    set_core_config_booleans(
        api_url,
        {
            "logging-to-file": True,
            "request-log": False,
        },
    )
    seen.append("SET real Core request-log false for error log listing")

    page.goto(f"{app_url}?core-logs=file-error#/logs", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/logs')")
    page.get_by_text("Logs Viewer", exact=False).first.wait_for()
    page.get_by_role("button", name="Error Request Logs").click()
    page.get_by_text(CORE_ERROR_LOG_NAME, exact=False).first.wait_for()

    error_row = page.locator(".item-row").filter(has_text=CORE_ERROR_LOG_NAME).first
    error_row.get_by_role("button", name="Open").click()
    error_dialog = page.get_by_role("dialog", name=CORE_ERROR_LOG_NAME)
    error_dialog.get_by_text(CORE_ERROR_LOG_BODY, exact=False).wait_for()
    with page.expect_download() as error_download:
        error_dialog.get_by_role("button", name="Download").click()
    error_file = error_download.value
    if error_file.suggested_filename != CORE_ERROR_LOG_NAME:
        raise AssertionError(
            "Unexpected real Core error log download filename: "
            f"{error_file.suggested_filename}"
        )
    if CORE_ERROR_LOG_BODY not in read_download_text(error_file):
        raise AssertionError("Real Core error log download did not contain the smoke body")
    seen.append("BROWSER real Core error log open download GET /v0/management/request-error-logs")
    error_dialog.get_by_role("button", name="Close").nth(1).click()

    set_core_config_booleans(
        api_url,
        {
            "request-log": True,
        },
    )
    seen.append("RESTORED real Core request-log true after logs smoke")

    return seen


def run_browser_smoke(
    app_url: str,
    api_url: str,
    headed: bool,
    include_plugin_store: bool,
    supports_plugin: bool,
    logs_dir: Path,
) -> list[str]:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - environment guard
        raise RuntimeError(
            "Python Playwright is required for browser smoke. "
            "Use --no-browser to run only authenticated endpoint checks."
        ) from exc

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
        ("/logs", "Logs Viewer", None),
    ]
    if supports_plugin:
        route_checks.append(("/plugins", "Plugins", None))
    if supports_plugin and include_plugin_store:
        route_checks.append(("/plugin-store", "Plugin Store", None))

    seen: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed)
        context = browser.new_context(locale="en-US", accept_downloads=True)
        context.add_init_script(
            """
            localStorage.setItem(
              'cli-proxy-language',
              JSON.stringify({ state: { language: 'en' }, version: 0 })
            );
            """
        )
        page = context.new_page()
        page.set_default_timeout(20_000)

        try:
            page.goto(f"{app_url}/#/login", wait_until="domcontentloaded")
            page.locator('input[name="cpa-management-key"]').wait_for()
            page.get_by_label("Custom Connection URL:").check(force=True)
            page.get_by_placeholder("Eg: https://example.com:8317").fill(api_url)
            page.locator('input[name="cpa-management-key"]').fill(MANAGEMENT_KEY)
            page.get_by_label("Remember password").check(force=True)
            page.get_by_role("button", name=re.compile("Login|Connect", re.I)).click()
            page.wait_for_url(re.compile(r".*/#/$"), timeout=30_000)
            seen.extend(run_browser_config_save_smoke(page, api_url))
            seen.extend(run_browser_provider_workbench_smoke(page, app_url, api_url))
            seen.extend(run_browser_real_core_logs_smoke(page, app_url, api_url, logs_dir))

            for index, (route, expected_text, expected_hash) in enumerate(route_checks):
                page.goto(f"{app_url}?core-route={index}#{route}", wait_until="domcontentloaded")
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
        except PlaywrightError as exc:
            with contextlib.suppress(Exception):
                body_text = page.locator("body").inner_text(timeout=1000)
                print(f"--- real-core smoke failure body text at {page.url} ---", file=sys.stderr)
                print(body_text[:4000], file=sys.stderr)
                print("--- end body text ---", file=sys.stderr)
            raise AssertionError(f"Real Core browser smoke failed at {page.url}: {exc}") from exc
        finally:
            context.close()
            browser.close()

    return seen


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run LTS Panel smoke against a real local CPA-Core-LTS process."
    )
    parser.add_argument(
        "--core-dir",
        default=str(DEFAULT_CORE_DIR),
        help="Path to CPA-Core-LTS checkout. Defaults to ../CPA-Core-LTS.",
    )
    parser.add_argument("--no-browser", action="store_true", help="Skip Playwright route checks.")
    parser.add_argument(
        "--no-write-smoke",
        action="store_true",
        help="Skip safe write checks against the temporary Core config.",
    )
    parser.add_argument("--headed", action="store_true", help="Run Chromium headed for debugging.")
    parser.add_argument(
        "--include-plugin-store",
        action="store_true",
        help="Also hit /plugin-store. This may use GitHub network for the built-in official registry.",
    )
    args = parser.parse_args()

    if not INDEX_HTML.exists():
        print("dist/index.html is missing. Run `npm run build` first.", file=sys.stderr)
        return 2

    core_dir = Path(args.core_dir).expanduser().resolve()
    app_port = find_free_port()
    app_url = f"http://127.0.0.1:{app_port}/management.html"

    with tempfile.TemporaryDirectory(prefix="cpa-panel-core-smoke-") as raw_temp:
        temp_dir = Path(raw_temp)
        with run_core(core_dir, temp_dir) as runtime:
            seen, supports_plugin = run_endpoint_smoke(
                runtime.api_url,
                include_plugin_store=args.include_plugin_store,
                include_write_smoke=not args.no_write_smoke,
            )
            if not supports_plugin:
                seen.append("SKIP browser /plugins routes because x-cpa-support-plugin is false")
            if not args.no_browser:
                with run_static_server(app_port):
                    seen.extend(
                        run_browser_smoke(
                            app_url,
                            runtime.api_url,
                            headed=args.headed,
                            include_plugin_store=args.include_plugin_store,
                            supports_plugin=supports_plugin,
                            logs_dir=runtime.logs_dir,
                        )
                    )

    print("LTS panel real Core smoke passed.")
    for entry in seen:
        print(f"  {entry}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"LTS panel real Core smoke failed: {exc}", file=sys.stderr)
        if os.environ.get("DEBUG_SMOKE"):
            raise
        raise SystemExit(1)

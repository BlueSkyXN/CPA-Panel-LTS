#!/usr/bin/env python3
"""Authenticated LTS Panel smoke against a real local CPA-Core-LTS process.

This optional smoke complements `scripts/smoke-lts-panel.py`, which uses a mock
Core API. It builds a CPA-Core-LTS v8 checkout (`--core-dir`, default
../CPA-Core-LTS) into a temporary directory, starts it there with a fresh, pure
v8 config (`config-version: 8`, a synthetic management secret and one synthetic
client API key), then checks the v8 Management API (ETag/If-Match), the LTS
`/v0/management` extensions and the Panel GUI. The Core checkout is only read.
"""

from __future__ import annotations
from panel_browser import PanelBrowser, launch_chromium

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
from datetime import datetime, timedelta, timezone
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
V8 = "/v8/management"
LTS = "/v0/management"
MANAGEMENT_KEY = "smoke-management-key"
CLIENT_API_KEY = "smoke-client-api-key"
BROWSER_PLUGIN_STORE_SOURCE = "https://example.com/lts-core-browser-registry.json"
BROWSER_SOURCE_MARKER = "# lts-core-browser-source-smoke: saved"


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
    """Fresh, pure v8 layout: no legacy keys and no provider credentials.

    The management secret is supplied through MANAGEMENT_PASSWORD; the only client key is the
    synthetic CLIENT_API_KEY. Provider resources are created by the smoke itself.
    """
    auth_dir = temp_dir / "auths"
    plugins_dir = temp_dir / "plugins"
    auth_dir.mkdir(parents=True, exist_ok=True)
    plugins_dir.mkdir(parents=True, exist_ok=True)

    return textwrap.dedent(
        f"""\
        config-version: 8
        server:
          host: "127.0.0.1"
          port: {port}
          commercial-mode: false
        management:
          allow-remote: false
          secret-key: ""
          disable-control-panel: true
          disable-auto-update-panel: true
        access:
          api-keys:
            - "{CLIENT_API_KEY}"
        oauth:
          auth-dir: "{auth_dir.as_posix()}"
        observability:
          logs:
            debug: false
            logging-to-file: true
            request-log: true
            logs-max-total-size-mb: 0
            error-logs-max-files: 10
          usage:
            usage-statistics-enabled: true
            redis-usage-queue-retention-seconds: 60
        routing:
          strategy: round-robin
          retry:
            request-retry: 0
            max-retry-credentials: 1
            max-retry-interval: 1
          cooldown:
            transient-error-cooldown-seconds: 30
        multimedia:
          disable-image-generation: chat
        upstream:
          codex:
            abnormal-reasoning-retry:
              hedged-retry:
                require-distinct-auth: false
        plugins:
          enabled: true
          dir: "{plugins_dir.as_posix()}"
          store-sources: []
          configs: {{}}
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
    try:
        with urlopen(request, timeout=15) as response:
            status = response.status
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
    except HTTPError as exc:
        if exc.code not in expected:
            raise
        status = exc.code
        body = exc.read()
        content_type = exc.headers.get("Content-Type", "")
    if status not in expected:
        raise AssertionError(f"{method} {path} returned {status}, expected {expected}")
    if not body:
        return None
    if "json" not in content_type.lower():
        return body.decode("utf-8", errors="replace")
    return json.loads(body.decode("utf-8"))


def http_request(
    api_url: str,
    path: str,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    token: str = MANAGEMENT_KEY,
) -> tuple[int, Any, bytes]:
    """Raw request returning (status, headers, body) for any status code."""
    merged = {"Authorization": f"Bearer {token}", **(headers or {})}
    request = Request(f"{api_url}{path}", data=body, headers=merged, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            return response.status, response.headers, response.read()
    except HTTPError as exc:
        return exc.code, exc.headers, exc.read()


ETAG_PATTERN = re.compile(r'^"[0-9a-f]{64}"$')
# Core defects observed while the Panel behaved correctly. They do not stop the remaining
# checks, but the smoke still fails and prints them at the end.
CORE_DEFECTS: list[str] = []


def record_core_defect(message: str) -> None:
    print(f"CORE DEFECT: {message}", file=sys.stderr)
    CORE_DEFECTS.append(message)


def read_config(api_url: str) -> tuple[dict[str, Any], str]:
    """GET /v8/management/config: canonical JSON view plus the file revision (ETag)."""
    status, headers, body = http_request(api_url, f"{V8}/config", headers={"Accept": "application/json"})
    if status != 200:
        raise AssertionError(f"GET {V8}/config returned {status}: {body[:300]!r}")
    etag = headers.get("ETag", "")
    if not ETAG_PATTERN.match(etag):
        raise AssertionError(f"GET {V8}/config returned a non-sha256 ETag: {etag!r}")
    return assert_mapping(json.loads(body.decode("utf-8")), f"{V8}/config"), etag


def read_config_yaml(api_url: str) -> tuple[str, str]:
    status, headers, body = http_request(
        api_url, f"{V8}/config.yaml", headers={"Accept": "application/yaml, text/plain"}
    )
    if status != 200:
        raise AssertionError(f"GET {V8}/config.yaml returned {status}")
    etag = headers.get("ETag", "")
    if not ETAG_PATTERN.match(etag):
        raise AssertionError(f"GET {V8}/config.yaml returned a non-sha256 ETag: {etag!r}")
    return body.decode("utf-8", errors="replace"), etag


def config_at(config: Any, dotted: str) -> Any:
    node = config
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def write_config(
    api_url: str,
    path: str,
    value: Any = None,
    *,
    method: str = "PUT",
    yaml_text: str | None = None,
    revision: str | None = None,
) -> Any:
    """v8 config write bound to the current revision; asserts Core clears the ETag."""
    if revision is None:
        _, revision = read_config_yaml(api_url)
    if yaml_text is not None:
        body = yaml_text.encode("utf-8")
        content_type = "application/yaml; charset=utf-8"
    else:
        body = None if method == "DELETE" else json.dumps(value).encode("utf-8")
        content_type = "application/json"
    headers = {"Accept": "application/json", "If-Match": revision}
    if body is not None:
        headers["Content-Type"] = content_type
    status, response_headers, response_body = http_request(api_url, f"{V8}{path}", method, body, headers)
    if status != 200:
        raise AssertionError(
            f"{method} {V8}{path} returned {status}: {response_body[:500].decode('utf-8', 'replace')}"
        )
    if response_headers.get("ETag", None) not in ("", None):
        raise AssertionError(f"{method} {V8}{path} did not clear the ETag after a write")
    return json.loads(response_body.decode("utf-8")) if response_body else None


def disk_thinking(config_path: Path) -> list[dict[str, Any]]:
    """Thinking blocks of every persisted OpenAI Compatibility model (format-independent)."""
    return [
        model["thinking"]
        for group in provider_groups(disk_config(config_path), "openai-compatibility")
        for model in group.get("models") or []
        if isinstance(model, dict) and isinstance(model.get("thinking"), dict)
    ]


def disk_config(config_path: Path) -> dict[str, Any]:
    import yaml  # PyYAML; only the real-Core smoke reads the persisted file.

    return assert_mapping(yaml.safe_load(config_path.read_text(encoding="utf-8")), str(config_path))


def provider_groups(config: dict[str, Any], family: str) -> list[dict[str, Any]]:
    groups = config_at(config, f"api-keys.{family}") or []
    return [group for group in assert_list(groups, f"api-keys.{family}") if isinstance(group, dict)]


def provider_entries(config: dict[str, Any], family: str) -> list[dict[str, Any]]:
    """Effective per-key entries: group fields merged under key fields (Core semantics)."""
    entries: list[dict[str, Any]] = []
    for group in provider_groups(config, family):
        shared = {key: value for key, value in group.items() if key not in ("keys", "name")}
        for key in group.get("keys") or []:
            if isinstance(key, dict):
                entries.append({**shared, **{k: v for k, v in key.items() if v is not None}})
    return entries


def read_supports_plugin_header(api_url: str) -> bool:
    request = Request(
        f"{api_url}{V8}/config",
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
            request_json(runtime.api_url, f"{V8}/config")
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

    # Build outside the checkout and run from the temporary directory, so the Core worktree
    # (possibly owned by another session) is only read.
    binary = temp_dir / "cpa-core-smoke"
    build = subprocess.run(
        ["go", "-C", str(core_dir), "build", "-o", str(binary), "./cmd/server"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if build.returncode != 0:
        raise RuntimeError(
            "Could not build CPA-Core-LTS for the smoke:\n"
            + build.stdout.decode("utf-8", errors="replace")[-6000:]
        )
    command = [str(binary), "--config", str(config_path), "--no-browser", "--local-model"]
    with log_path.open("wb") as log_file:
        process = subprocess.Popen(
            command,
            cwd=temp_dir,
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


def build_service_tier_usage_snapshot() -> dict[str, Any]:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    day_key = now.strftime("%Y-%m-%d")
    hour_key = now.strftime("%H")
    details = [
        {
            "timestamp": (now - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
            "source": "auths/core-tier-smoke.json",
            "auth_index": "1",
            "service_tier": "priority",
            "request_service_tier": "priority",
            "outbound_service_tier": "priority",
            "response_service_tier": "standard",
            "effective_service_tier": "standard",
            "latency_ms": 120,
            "ttfb_ms": 40,
            "timing_version": 1,
            "ttft_ms": 60,
            "ttfa_ms": 90,
            "tokens": {
                "input_tokens": 5,
                "output_tokens": 7,
                "reasoning_tokens": 0,
                "cached_tokens": 0,
                "total_tokens": 12,
            },
            "failed": False,
        },
        {
            "timestamp": (now - timedelta(minutes=2)).isoformat().replace("+00:00", "Z"),
            "source": "auths/core-tier-smoke.json",
            "auth_index": "1",
            "service_tier": "auto",
            "request_service_tier": "auto",
            "outbound_service_tier": "priority",
            "effective_service_tier": "priority",
            "tokens": {
                "input_tokens": 8,
                "output_tokens": 4,
                "reasoning_tokens": 0,
                "cached_tokens": 0,
                "total_tokens": 12,
            },
            "failed": False,
        },
        {
            "timestamp": (now - timedelta(minutes=3)).isoformat().replace("+00:00", "Z"),
            "source": "auths/core-tier-smoke.json",
            "auth_index": "1",
            "service_tier": "priority",
            "request_service_tier": "priority",
            "outbound_service_tier": "priority",
            "response_service_tier": "future-tier",
            "tokens": {
                "input_tokens": 6,
                "output_tokens": 3,
                "reasoning_tokens": 0,
                "cached_tokens": 0,
                "total_tokens": 9,
            },
            "failed": False,
        },
    ]
    return {
        "version": 3,
        "exported_at": now.isoformat().replace("+00:00", "Z"),
        "usage": {
            "total_requests": 3,
            "success_count": 3,
            "failure_count": 0,
            "total_tokens": 33,
            "apis": {
                "panel-core-tier-smoke": {
                    "total_requests": 3,
                    "total_tokens": 33,
                    "models": {
                        "gpt-5.4": {
                            "total_requests": 3,
                            "total_tokens": 33,
                            "details": details,
                        }
                    },
                }
            },
            "requests_by_day": {day_key: 3},
            "requests_by_hour": {hour_key: 3},
            "tokens_by_day": {day_key: 33},
            "tokens_by_hour": {hour_key: 33},
        },
    }


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
    """Poll GET /v8/management/config until the dotted v8 path has the expected value."""
    deadline = time.monotonic() + timeout_seconds
    last_config: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last_config, _ = read_config(api_url)
        if config_at(last_config, key) == expected:
            return last_config
        time.sleep(0.25)
    raise AssertionError(
        f"Core config did not reload {key}={expected!r}; last value="
        f"{None if last_config is None else config_at(last_config, key)!r}"
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


V8_LOG_BOOLEANS = {
    "debug": "observability.logs.debug",
    "logging-to-file": "observability.logs.logging-to-file",
    "request-log": "observability.logs.request-log",
}


def set_core_config_booleans(api_url: str, values: dict[str, bool]) -> None:
    """Set v8 log toggles as independent scalars (fresh revision per write)."""
    for key, enabled in values.items():
        path = V8_LOG_BOOLEANS[key]
        config, revision = read_config(api_url)
        if config_at(config, path) is not enabled:
            write_config(api_url, "/config/" + path.replace(".", "/"), enabled, revision=revision)
        wait_for_config_value(api_url, path, enabled)


def provider_items(payload: Any, key: str, path: str) -> list[Any]:
    return assert_list(assert_mapping(payload, path).get(key), path)


def auth_file_entries(api_url: str) -> list[dict[str, Any]]:
    payload = assert_mapping(
        request_json(api_url, f"{V8}/credentials"),
        f"{V8}/credentials",
    )
    files = assert_list(payload.get("files"), f"{V8}/credentials")
    return [item for item in files if isinstance(item, dict)]


def find_auth_file_entry(api_url: str, name: str) -> dict[str, Any] | None:
    for item in auth_file_entries(api_url):
        if item.get("name") == name or item.get("id") == name:
            return item
    return None


def run_revision_contract_smoke(api_url: str) -> list[str]:
    """Core v8 contract the Panel relies on: 428 without If-Match, 412 when stale."""
    seen: list[str] = []
    path = f"{V8}/config/observability/logs/debug"
    body = b"true"
    json_headers = {"Content-Type": "application/json", "Accept": "application/json"}
    _, before = read_config_yaml(api_url)
    status, headers, response = http_request(api_url, path, "PUT", body, json_headers)
    if status != 428 or b"config_revision_required" not in response:
        raise AssertionError(f"PUT {path} without If-Match returned {status}: {response[:200]!r}")
    seen.append(f"PUT {path} without If-Match -> 428 config_revision_required")
    stale = '"' + "0" * 64 + '"'
    status, headers, response = http_request(
        api_url, path, "PUT", body, {**json_headers, "If-Match": stale}
    )
    if status != 412 or b"config_revision_conflict" not in response:
        raise AssertionError(f"PUT {path} with a stale If-Match returned {status}: {response[:200]!r}")
    seen.append(f"PUT {path} with stale If-Match -> 412 config_revision_conflict")
    _, after = read_config_yaml(api_url)
    if after != before:
        raise AssertionError("Rejected v8 writes changed the configuration revision")
    write_config(api_url, "/config/observability/logs/debug", True, revision=after)
    wait_for_config_value(api_url, "observability.logs.debug", True)
    write_config(api_url, "/config/observability/logs/debug", False)
    wait_for_config_value(api_url, "observability.logs.debug", False)
    seen.append(f"PUT {path} with current If-Match -> 200, empty ETag, readback")
    return seen


def run_write_smoke(api_url: str, config_path: Path) -> list[str]:
    seen: list[str] = run_revision_contract_smoke(api_url)

    original_yaml, revision = read_config_yaml(api_url)
    marker = "# lts-core-write-smoke: saved"
    updated_yaml = replace_one(
        original_yaml, r"^([ \t]*)debug:\s*false[ \t]*$", "\\1debug: true", "observability.logs.debug"
    )
    if marker not in updated_yaml:
        updated_yaml = f"{updated_yaml.rstrip()}\n{marker}\n"
    seen.append(f"PUT {V8}/config.yaml with If-Match")
    write_config(api_url, "/config.yaml", yaml_text=updated_yaml, revision=revision)
    reloaded_yaml, _ = read_config_yaml(api_url)
    if marker not in reloaded_yaml or not re.search(r"^\s+debug: true\s*$", reloaded_yaml, re.M):
        raise AssertionError("config.yaml write smoke did not persist marker and debug flag")
    wait_for_config_value(api_url, "observability.logs.debug", True)
    seen.append(f"GET {V8}/config after config.yaml write")
    write_config(api_url, "/config/observability/logs/debug", False)
    wait_for_config_value(api_url, "observability.logs.debug", False)

    def put_family(family: str, groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
        _, revision = read_config(api_url)
        seen.append(f"PUT {V8}/config/api-keys/{family}")
        write_config(api_url, f"/config/api-keys/{family}", groups, revision=revision)
        config, _ = read_config(api_url)
        seen.append(f"GET {V8}/config after {family} write")
        return provider_entries(config, family)

    gemini_items = put_family(
        "gemini",
        [
            {
                "name": "gemini-1",
                "base-url": "https://generativelanguage.googleapis.com",
                "excluded-models": ["*"],
                "models": [{"name": "gemini-2.5-flash", "display-name": "Gemini Flash Write"}],
                # Response-only; Core must strip it on write (the Panel strips it too).
                "keys": [{"api-key": "gemini-real-write-key", "auth_index": "client-supplied"}],
            }
        ],
    )
    if not any(
        item.get("api-key") == "gemini-real-write-key"
        and item.get("excluded-models") == ["*"]
        and isinstance(item.get("auth_index"), str)
        and item.get("auth_index") not in ("", "client-supplied")
        and any(
            isinstance(model, dict) and model.get("display-name") == "Gemini Flash Write"
            for model in item.get("models", [])
        )
        for item in gemini_items
    ):
        raise AssertionError(f"Gemini v8 group write did not round-trip: {gemini_items!r}")
    seen.append("Core injected auth_index into GET /v8/management/config api-keys")

    codex_items = put_family(
        "codex",
        [
            {
                "name": "codex-1",
                "base-url": "https://api.openai.com",
                "models": [
                    {"name": "gpt-5", "alias": "gpt-5-real-write", "display-name": "GPT-5 Real Write"}
                ],
                "keys": [{"api-key": "codex-real-write-key", "websockets": True}],
            }
        ],
    )
    if not any(
        item.get("api-key") == "codex-real-write-key" and item.get("websockets") is True
        for item in codex_items
    ):
        raise AssertionError(f"Codex v8 group write did not round-trip websockets: {codex_items!r}")
    codex_after_delete = put_family("codex", [])
    if codex_after_delete:
        raise AssertionError(f"Codex family PUT [] did not remove the key: {codex_after_delete!r}")
    seen.append("Codex v8 family write and removal round-tripped through Core")

    openai_groups = [
        {
            "name": "Smoke OpenAI Compatible",
            "prefix": "real-write",
            "base-url": "https://openai-compatible.example.test/v1",
            "keys": [{"api-key": "openai-real-write-key"}],
            "models": [
                {
                    "name": "k3",
                    "alias": "kimi-k3",
                    "display-name": "Kimi K3 Smoke",
                    "image": True,
                    "thinking": {"levels": ["low", "vendor-custom"], "min": 128, "max": 32768},
                }
            ],
        }
    ]
    put_family("openai-compatibility", openai_groups)
    config, _ = read_config(api_url)
    openai_items = provider_groups(config, "openai-compatibility")
    if not any(
        item.get("name") == "Smoke OpenAI Compatible"
        and item.get("prefix") == "real-write"
        and any(
            isinstance(model, dict)
            and model.get("display-name") == "Kimi K3 Smoke"
            and model.get("thinking") == {"levels": ["low", "vendor-custom"], "min": 128, "max": 32768}
            for model in item.get("models", [])
        )
        for item in openai_items
    ):
        raise AssertionError(f"OpenAI Compatibility v8 write did not round-trip: {openai_items!r}")
    seen.append("OpenAI Compatibility thinking config round-tripped through Core")

    persisted_yaml, _ = read_config_yaml(api_url)
    on_disk = config_path.read_text(encoding="utf-8")
    seen.append(f"GET {V8}/config.yaml and on-disk config after provider writes")
    for text in (persisted_yaml, on_disk):
        if "auth_index" in text or "auth-index" in text or "authIndex" in text:
            raise AssertionError("Provider write smoke persisted response-only auth-index into config.yaml")
    if contains_key(openai_groups, "auth-index") or contains_key(openai_groups, "auth_index"):
        raise AssertionError("OpenAI Compatibility write smoke payload unexpectedly contains auth-index")
    if not any(
        "vendor-custom" in (thinking.get("levels") or []) and thinking.get("max") == 32768
        for thinking in disk_thinking(config_path)
    ):
        raise AssertionError("OpenAI Compatibility write smoke did not persist thinking config to disk")
    if "config-version: 8" not in on_disk:
        raise AssertionError("v8 writes did not keep the persisted file at config-version 8")

    return seen


def run_auth_files_write_smoke(api_url: str) -> list[str]:
    seen: list[str] = []
    auth_name = "lts-xai-auth-smoke.json"
    upload_path = f"{V8}/credentials?{urlencode({'name': auth_name})}"
    download_path = f"{V8}/credentials/download?{urlencode({'name': auth_name})}"
    auth_payload = {
        "type": "xai",
        "email": "lts-xai-auth-smoke@example.test",
        "access_token": "dummy-lts-smoke-access-token",
        "refresh_token": "dummy-lts-smoke-refresh-token",
        "note": "created by lts smoke",
    }

    seen.append(f"POST {V8}/credentials")
    seen.append(f"POST {upload_path}")
    assert_mapping(
        request_json(api_url, upload_path, method="POST", payload=auth_payload),
        upload_path,
    )

    created_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v8/management/credentials after auth upload")
    if (
        not created_entry
        or created_entry.get("type") != "xai"
        or created_entry.get("email") != "lts-xai-auth-smoke@example.test"
    ):
        raise AssertionError(f"Auth file upload did not appear in list: {created_entry!r}")

    seen.append(f"PATCH {V8}/credentials/fields")
    fields_patch = {
        "name": auth_name,
        "prefix": "auth-smoke",
        "proxy_url": "http://127.0.0.1:7890",
        "priority": 7,
        "weight": 5,
        "websockets": True,
        "using_api": True,
        "note": "updated by lts smoke",
        "headers": {
            "X-LTS-Smoke": "1",
        },
    }
    assert_mapping(
        request_json(api_url, f"{V8}/credentials/fields", method="PATCH", payload=fields_patch),
        f"{V8}/credentials/fields",
    )

    patched_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v8/management/credentials after auth fields patch")
    if not patched_entry:
        raise AssertionError("Auth file disappeared after fields patch")
    if patched_entry.get("priority") != 7:
        raise AssertionError(f"Auth file priority did not round-trip through list: {patched_entry!r}")
    if patched_entry.get("weight") != 5:
        raise AssertionError(f"Auth file weight did not round-trip through list: {patched_entry!r}")
    if patched_entry.get("websockets") is not True:
        raise AssertionError(f"Auth file websockets did not round-trip through list: {patched_entry!r}")
    if patched_entry.get("note") != "updated by lts smoke":
        raise AssertionError(f"Auth file note did not round-trip through list: {patched_entry!r}")

    # /auth-files intentionally returns a curated list shape and does not expose every
    # arbitrary auth-file field. The raw download is the persistence truth for using_api.
    downloaded = json.loads(request_text(api_url, download_path))
    seen.append("GET /v8/management/credentials/download after auth fields patch")
    if (
        downloaded.get("prefix") != "auth-smoke"
        or downloaded.get("proxy_url") != "http://127.0.0.1:7890"
        or downloaded.get("priority") != 7
        or downloaded.get("weight") != 5
        or downloaded.get("websockets") is not True
        or downloaded.get("using_api") is not True
        or downloaded.get("note") != "updated by lts smoke"
        or downloaded.get("headers") != {"X-LTS-Smoke": "1"}
    ):
        raise AssertionError(f"Auth file fields patch did not persist to download payload: {downloaded!r}")
    seen.append("Auth file credential weight round-tripped through Core")

    seen.append(f"PATCH {V8}/credentials/status")
    disabled_result = assert_mapping(
        request_json(
            api_url,
            f"{V8}/credentials/status",
            method="PATCH",
            payload={"name": auth_name, "disabled": True},
        ),
        f"{V8}/credentials/status",
    )
    if disabled_result.get("disabled") is not True:
        raise AssertionError(f"Auth file status patch did not report disabled=true: {disabled_result!r}")
    disabled_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v8/management/credentials after auth status patch")
    if not disabled_entry or disabled_entry.get("disabled") is not True:
        raise AssertionError(f"Auth file status patch did not round-trip through list: {disabled_entry!r}")

    seen.append(f"DELETE {V8}/credentials")
    assert_mapping(
        request_json(
            api_url,
            f"{V8}/credentials",
            method="DELETE",
            payload={"names": [auth_name]},
        ),
        f"{V8}/credentials",
    )
    deleted_entry = find_auth_file_entry(api_url, auth_name)
    seen.append("GET /v8/management/credentials after auth delete")
    if deleted_entry is not None:
        raise AssertionError(f"Auth file delete did not remove smoke file: {deleted_entry!r}")
    seen.append(
        "Auth files smoke uploaded patched xAI using_api disabled and deleted temporary auth file"
    )

    return seen


def run_plugin_config_smoke(api_url: str) -> list[str]:
    seen: list[str] = []
    plugin_id = "lts-smoke-plugin"
    config_node = f"/config/plugins/configs/{plugin_id}"
    plugin_path = f"{V8}/plugins/{plugin_id}"

    def read_plugin_config() -> dict[str, Any]:
        config, _ = read_config(api_url)
        return assert_mapping(config_at(config, f"plugins.configs.{plugin_id}"), config_node)

    plugin_payload = {
        "enabled": True,
        "priority": 4,
        "mode": "safe",
        "permissions": {"auth-list": True, "model-execute": True},
        "nested": {"keep": "yes"},
    }
    seen.append(f"PUT {V8}{config_node} with If-Match")
    write_config(api_url, config_node, plugin_payload)
    saved_config = read_plugin_config()
    if (
        saved_config.get("enabled") is not True
        or saved_config.get("priority") != 4
        or saved_config.get("mode") != "safe"
        or saved_config.get("nested") != {"keep": "yes"}
    ):
        raise AssertionError(f"Plugin config PUT did not round-trip: {saved_config!r}")

    seen.append(f"PUT {V8}{config_node}/enabled false")
    write_config(api_url, f"{config_node}/enabled", False)
    if read_plugin_config().get("enabled") is not False:
        raise AssertionError("Plugin enabled node did not persist false")
    write_config(api_url, f"{config_node}/enabled", True)

    # The Panel merges touched fields into the latest object and replaces the instance.
    latest = read_plugin_config()
    seen.append(f"PUT {V8}{config_node} merged object")
    write_config(api_url, config_node, {**latest, "mode": "fast", "count": 3})
    patched_config = read_plugin_config()
    if (
        patched_config.get("enabled") is not True
        or patched_config.get("priority") != 4
        or patched_config.get("mode") != "fast"
        or patched_config.get("count") != 3
    ):
        raise AssertionError(f"Plugin config merge did not round-trip: {patched_config!r}")

    list_payload = assert_mapping(request_json(api_url, f"{V8}/plugins"), f"{V8}/plugins")
    seen.append(f"GET {V8}/plugins after plugin config write")
    plugins = assert_list(list_payload.get("plugins"), f"{V8}/plugins")
    plugin_entry = next((item for item in plugins if isinstance(item, dict) and item.get("id") == plugin_id), None)
    if (
        not isinstance(plugin_entry, dict)
        or plugin_entry.get("configured") is not True
        or plugin_entry.get("registered") is not False
        or plugin_entry.get("enabled") is not True
        or plugin_entry.get("effective_enabled") is not False
    ):
        raise AssertionError(f"Configured-only plugin list entry is invalid: {plugin_entry!r}")

    import yaml  # PyYAML

    persisted_yaml, _ = read_config_yaml(api_url)
    persisted_plugin = config_at(yaml.safe_load(persisted_yaml), f"plugins.configs.{plugin_id}") or {}
    if (
        persisted_plugin.get("mode") != "fast"
        or persisted_plugin.get("count") != 3
        or not isinstance(persisted_plugin.get("permissions"), dict)
    ):
        raise AssertionError(f"Plugin config YAML did not persist the merged object: {persisted_plugin!r}")

    seen.append(f"DELETE {plugin_path}")
    delete_result = assert_mapping(request_json(api_url, plugin_path, method="DELETE"), plugin_path)
    if (
        delete_result.get("status") != "deleted"
        or delete_result.get("configured_removed") is not True
        or delete_result.get("file_deleted") is not False
        or delete_result.get("restart_required") is not False
    ):
        raise AssertionError(f"Plugin DELETE returned unexpected result: {delete_result!r}")
    plugins_after_delete = assert_list(
        assert_mapping(request_json(api_url, f"{V8}/plugins"), f"{V8}/plugins").get("plugins"),
        f"{V8}/plugins",
    )
    if any(isinstance(item, dict) and item.get("id") == plugin_id for item in plugins_after_delete):
        raise AssertionError(f"Plugin DELETE did not remove configured plugin from live API: {plugins_after_delete!r}")
    seen.append("Plugin config smoke removed configured-only plugin from live API")

    return seen


def run_usage_import_contract_smoke(
    api_url: str, seen: list[str], core_usage_version: int
) -> None:
    def export_state(payload: dict[str, Any]) -> dict[str, Any]:
        # exported_at changes on every request; all other envelope and usage
        # fields represent the state that a rejected import must preserve.
        return {key: value for key, value in payload.items() if key != "exported_at"}

    migration_timestamp = (datetime.now(timezone.utc) - timedelta(minutes=4)).isoformat().replace(
        "+00:00", "Z"
    )
    legacy_alias_payload = {
        "version": 1,
        "usage": {
            "apis": {
                "panel-core-v1-migration-smoke": {
                    "models": {
                        "gpt-5.6-sol": {
                            "details": [
                                {
                                    "timestamp": migration_timestamp,
                                    "source": "panel-core-v1-migration-smoke",
                                    "auth_index": "0",
                                    "failed": False,
                                    "tokens": {
                                        "input_tokens": 1200,
                                        "uncached_input_tokens": 176,
                                        "cached_tokens": 1024,
                                        "cache_read_tokens": 0,
                                        "cache_creation_tokens": 1024,
                                        "output_tokens": 10,
                                        "total_tokens": 1210,
                                    },
                                }
                            ]
                        }
                    }
                }
            }
        },
    }
    seen.append("POST /v0/management/usage/import v1 cache-creation alias fixture")
    legacy_alias_result = assert_mapping(
        request_json(
            api_url,
            "/v0/management/usage/import",
            method="POST",
            payload=legacy_alias_payload,
        ),
        "/v0/management/usage/import v1 cache-creation alias fixture",
    )
    if core_usage_version == 3:
        valid_v1_receipt = (
            legacy_alias_result.get("added") == 1
            and legacy_alias_result.get("migrated_from_version") == 1
            and legacy_alias_result.get("schema_version") == 3
            and legacy_alias_result.get("migrations")
            == ["v1_uncached_input_tokens_to_v2", "v2_timing_contract_to_v3"]
        )
    else:
        valid_v1_receipt = (
            legacy_alias_result.get("added") == 1
            and legacy_alias_result.get("migrated_from_version") == 1
            and legacy_alias_result.get("schema_version") == 2
            and legacy_alias_result.get("migration") == "v1_uncached_input_tokens_to_v2"
        )
    if not valid_v1_receipt:
        raise AssertionError(
            f"Core did not report the expected v1 migration receipt: {legacy_alias_result!r}"
        )

    migrated_export = assert_mapping(
        request_json(api_url, "/v0/management/usage/export"),
        "/v0/management/usage/export after v1 cache-creation migration",
    )
    expected_export_version = 3 if core_usage_version == 3 else 2
    if migrated_export.get("version") != expected_export_version:
        raise AssertionError(
            f"Core v1 migration re-exported schema {migrated_export.get('version')!r}, "
            f"want {expected_export_version}"
        )
    migrated_usage = assert_mapping(migrated_export.get("usage"), "migrated usage")
    migrated_api = assert_mapping(
        assert_mapping(migrated_usage.get("apis"), "migrated usage apis").get(
            "panel-core-v1-migration-smoke"
        ),
        "migrated usage API",
    )
    migrated_model = assert_mapping(
        assert_mapping(migrated_api.get("models"), "migrated usage models").get(
            "gpt-5.6-sol"
        ),
        "migrated usage model",
    )
    migrated_details = assert_list(migrated_model.get("details"), "migrated usage details")
    if len(migrated_details) != 1:
        raise AssertionError(f"Core v1 migration exported unexpected details: {migrated_details!r}")
    migrated_tokens = assert_mapping(migrated_details[0].get("tokens"), "migrated tokens")
    required_canonical_tokens = {
        "input_tokens": 1200,
        "output_tokens": 10,
        "reasoning_tokens": 0,
        "cached_tokens": 0,
        "total_tokens": 1210,
    }
    missing_canonical_fields = [
        field for field in required_canonical_tokens if field not in migrated_tokens
    ]
    if (
        missing_canonical_fields
        or any(
            migrated_tokens.get(field) != expected
            for field, expected in required_canonical_tokens.items()
        )
        or migrated_tokens.get("cache_read_tokens", 0) != 0
        or migrated_tokens.get("cache_creation_tokens") != 1024
        or "uncached_input_tokens" in migrated_tokens
    ):
        raise AssertionError(
            "Core v1 alias migration did not export creation-only canonical tokens: "
            f"missing={missing_canonical_fields!r} tokens={migrated_tokens!r}"
        )

    duplicate_result = assert_mapping(
        request_json(
            api_url,
            "/v0/management/usage/import",
            method="POST",
            payload=legacy_alias_payload,
        ),
        "/v0/management/usage/import duplicate v1 cache-creation alias fixture",
    )
    if duplicate_result.get("added") != 0 or duplicate_result.get("skipped") != 1:
        raise AssertionError(f"Duplicate migrated usage was not skipped: {duplicate_result!r}")
    duplicate_export = assert_mapping(
        request_json(api_url, "/v0/management/usage/export"),
        "/v0/management/usage/export after duplicate v1 cache-creation alias fixture",
    )
    if export_state(duplicate_export) != export_state(migrated_export):
        raise AssertionError("Duplicate migrated usage mutated the Core export snapshot")
    seen.append("Core migrated the v1 cache-creation alias once and skipped its duplicate")

    if core_usage_version == 3:
        v2_migration_payload = json.loads(json.dumps(legacy_alias_payload))
        v2_migration_payload["version"] = 2
        v2_tokens = v2_migration_payload["usage"]["apis"][
            "panel-core-v1-migration-smoke"
        ]["models"]["gpt-5.6-sol"]["details"][0]["tokens"]
        v2_tokens.pop("uncached_input_tokens", None)
        v2_tokens["cached_tokens"] = 0
        v2_tokens["reasoning_tokens"] = 0
        v2_migration_payload["usage"]["apis"]["panel-core-v2-migration-smoke"] = (
            v2_migration_payload["usage"]["apis"].pop("panel-core-v1-migration-smoke")
        )
        seen.append("POST /v0/management/usage/import v2 migration receipt")
        v2_result = assert_mapping(
            request_json(
                api_url,
                "/v0/management/usage/import",
                method="POST",
                payload=v2_migration_payload,
            ),
            "/v0/management/usage/import v2 migration receipt",
        )
        if (
            v2_result.get("migrated_from_version") != 2
            or v2_result.get("schema_version") != 3
            or v2_result.get("migrations") != ["v2_timing_contract_to_v3"]
        ):
            raise AssertionError(f"Core did not report the expected v2 migration receipt: {v2_result!r}")
        seen.append("Core usage import returned audited v2-to-v3 migration receipt")

    invalid_canonical_tokens = [
        {
            "input_tokens": 10,
            "output_tokens": 0,
            "reasoning_tokens": 0,
            "cached_tokens": 9,
            "cache_read_tokens": 9,
            "cache_creation_tokens": 2,
            "total_tokens": 10,
        },
        {
            "input_tokens": 10,
            "output_tokens": 0,
            "reasoning_tokens": 0,
            "cached_tokens": 9,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "total_tokens": 10,
        },
        {
            "input_tokens": 10,
            "output_tokens": 1,
            "reasoning_tokens": 0,
            "cached_tokens": 0,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "total_tokens": 10,
        },
    ]
    for index, tokens in enumerate(invalid_canonical_tokens):
        valid_input_tokens = 20 + index
        fixture_id = index + 1
        invalid_payload = {
            "version": core_usage_version,
            "usage": {
                "apis": {
                    f"panel-core-invalid-v2-smoke-{fixture_id}": {
                        "models": {
                            "gpt-5.6-sol": {
                                "details": [
                                    {
                                        "timestamp": f"2026-07-22T01:0{fixture_id}:00Z",
                                        "source": f"panel-core-valid-before-invalid-{fixture_id}",
                                        "auth_index": str(fixture_id),
                                        "failed": False,
                                        "tokens": {
                                            "input_tokens": valid_input_tokens,
                                            "output_tokens": 3,
                                            "reasoning_tokens": 0,
                                            "cached_tokens": 2,
                                            "cache_read_tokens": 2,
                                            "cache_creation_tokens": 3,
                                            "total_tokens": valid_input_tokens + 3,
                                        },
                                    },
                                    {
                                        "timestamp": f"2026-07-22T02:0{fixture_id}:00Z",
                                        "source": f"panel-core-invalid-v2-smoke-{fixture_id}",
                                        "auth_index": str(fixture_id),
                                        "failed": False,
                                        "tokens": tokens,
                                    },
                                ]
                            }
                        }
                    }
                }
            },
        }
        before_reject = assert_mapping(
            request_json(api_url, "/v0/management/usage/export"),
            f"usage export before rejected canonical fixture {fixture_id}",
        )
        rejected = assert_mapping(
            request_json(
                api_url,
                "/v0/management/usage/import",
                method="POST",
                payload=invalid_payload,
                expected=(400,),
            ),
            f"invalid canonical usage fixture {fixture_id}",
        )
        expected_token_error = (
            "usage_v3_token_contract_invalid"
            if core_usage_version == 3
            else "usage_v2_token_contract_invalid"
        )
        if rejected.get("code") != expected_token_error:
            raise AssertionError(f"Unexpected invalid canonical response: {rejected!r}")
        after_reject = assert_mapping(
            request_json(api_url, "/v0/management/usage/export"),
            f"usage export after rejected canonical fixture {fixture_id}",
        )
        if export_state(after_reject) != export_state(before_reject):
            raise AssertionError("Rejected canonical usage fixture partially mutated Core state")
    seen.append(
        f"Core rejected impossible canonical v{core_usage_version} token fixtures atomically with a stable code"
    )


def run_endpoint_smoke(
    api_url: str, include_plugin_store: bool, include_write_smoke: bool, config_path: Path
) -> tuple[list[str], bool, int]:
    seen: list[str] = []
    supports_plugin = read_supports_plugin_header(api_url)
    seen.append(f"x-cpa-support-plugin={str(supports_plugin).lower()}")

    def get(path: str) -> Any:
        seen.append(f"GET {path}")
        return request_json(api_url, path)

    config_payload, json_revision = read_config(api_url)
    seen.append(f"GET {V8}/config (sha256 ETag)")
    if config_payload.get("config-version") != 8:
        raise AssertionError(f"Core did not render the v8 layout: {sorted(config_payload)!r}")
    if config_at(config_payload, "observability.usage.usage-statistics-enabled") is not True:
        raise AssertionError("Core v8 config did not expose observability.usage.usage-statistics-enabled=true")
    if config_at(config_payload, "access.api-keys") != [CLIENT_API_KEY]:
        raise AssertionError("Core v8 config did not keep the single synthetic client API key")

    yaml_payload, yaml_revision = read_config_yaml(api_url)
    seen.append(f"GET {V8}/config.yaml")
    if yaml_revision != json_revision:
        raise AssertionError("JSON and YAML views reported different revisions for the same file")
    for marker in ["config-version: 8", "usage-statistics-enabled: true", "plugins:"]:
        if marker not in yaml_payload:
            raise AssertionError(f"config.yaml missing marker {marker!r}")
    status, headers, _ = http_request(api_url, f"{V8}/config/ampcode")
    if status != 404 or not ETAG_PATTERN.match(headers.get("ETag", "")):
        raise AssertionError(f"Absent v8 node must 404 with a revision; got {status}")
    seen.append(f"GET {V8}/config/ampcode absent -> 404 with ETag")

    usage = assert_mapping(get("/v0/management/usage"), "/v0/management/usage")
    if "usage" not in usage:
        raise AssertionError("/usage response missing usage object")

    export_payload = assert_mapping(
        get("/v0/management/usage/export"),
        "/v0/management/usage/export",
    )
    core_usage_version = export_payload.get("version")
    if core_usage_version not in {1, 2, 3} or "usage" not in export_payload:
        raise AssertionError(f"Invalid usage export payload: {export_payload!r}")

    seen.append("POST /v0/management/usage/import")
    import_result = assert_mapping(
        request_json(api_url, "/v0/management/usage/import", method="POST", payload=export_payload),
        "/v0/management/usage/import",
    )
    if "total_requests" not in import_result:
        raise AssertionError(f"Invalid usage import result: {import_result!r}")
    if core_usage_version == 2 and import_result.get("schema_version") != 2:
        raise AssertionError(f"Canonical Core import omitted schema_version=2: {import_result!r}")
    if core_usage_version == 3 and (
        import_result.get("schema_version") != 3
        or "migrated_from_version" in import_result
        or "migrations" in import_result
    ):
        raise AssertionError(f"Canonical Core import omitted direct schema_version=3 receipt: {import_result!r}")
    if core_usage_version == 1 and "schema_version" in import_result:
        raise AssertionError(f"Released Core unexpectedly returned a schema receipt: {import_result!r}")

    tier_snapshot = build_service_tier_usage_snapshot()
    tier_snapshot["version"] = core_usage_version
    if core_usage_version < 3:
        for detail in tier_snapshot["usage"]["apis"]["panel-core-tier-smoke"]["models"]["gpt-5.4"]["details"]:
            for timing_field in ("timing_version", "ttft_ms", "ttfa_ms"):
                detail.pop(timing_field, None)
    seen.append("POST /v0/management/usage/import service-tier fixture")
    tier_import_result = assert_mapping(
        request_json(
            api_url,
            "/v0/management/usage/import",
            method="POST",
            payload=tier_snapshot,
        ),
        "/v0/management/usage/import service-tier fixture",
    )
    if tier_import_result.get("total_requests") != 3:
        raise AssertionError(
            f"Service-tier usage fixture was not imported: {tier_import_result!r}"
        )

    tier_export = assert_mapping(
        get("/v0/management/usage/export"),
        "/v0/management/usage/export after service-tier import",
    )
    tier_usage = assert_mapping(tier_export.get("usage"), "usage export usage")
    tier_apis = assert_mapping(tier_usage.get("apis"), "usage export apis")
    tier_api = assert_mapping(tier_apis.get("panel-core-tier-smoke"), "service-tier API")
    tier_models = assert_mapping(tier_api.get("models"), "service-tier models")
    tier_model = assert_mapping(tier_models.get("gpt-5.4"), "service-tier model")
    tier_details = assert_list(tier_model.get("details"), "service-tier details")
    if len(tier_details) != 3:
        raise AssertionError(f"Service-tier export lost request details: {tier_details!r}")
    standard_detail = next(
        (
            item
            for item in tier_details
            if isinstance(item, dict) and item.get("response_service_tier") == "standard"
        ),
        None,
    )
    if (
        not isinstance(standard_detail, dict)
        or standard_detail.get("request_service_tier") != "priority"
        or standard_detail.get("outbound_service_tier") != "priority"
        or standard_detail.get("effective_service_tier") != "standard"
    ):
        raise AssertionError(
            "Core import/export lost request/response/effective tier precedence: "
            f"{standard_detail!r}"
        )
    outbound_detail = next(
        (
            item
            for item in tier_details
            if isinstance(item, dict) and item.get("request_service_tier") == "auto"
        ),
        None,
    )
    if (
        not isinstance(outbound_detail, dict)
        or outbound_detail.get("response_service_tier") not in {None, ""}
        or outbound_detail.get("outbound_service_tier") != "priority"
        or outbound_detail.get("effective_service_tier") != "priority"
    ):
        raise AssertionError(
            "Core import/export lost outbound-derived effective priority: "
            f"{outbound_detail!r}"
        )
    unknown_detail = next(
        (
            item
            for item in tier_details
            if isinstance(item, dict) and item.get("response_service_tier") == "future-tier"
        ),
        None,
    )
    if (
        not isinstance(unknown_detail, dict)
        or unknown_detail.get("outbound_service_tier") != "priority"
        or unknown_detail.get("effective_service_tier") not in {None, ""}
    ):
        raise AssertionError(
            "Unknown response tier must not fabricate effective_service_tier: "
            f"{unknown_detail!r}"
        )
    seen.append(
        f"Core usage v{core_usage_version} round-tripped inconsistent "
        "request/response/effective tiers"
    )

    if core_usage_version in {2, 3}:
        migrated_v1 = json.loads(json.dumps(tier_snapshot))
        migrated_v1["version"] = 1
        for detail in migrated_v1["usage"]["apis"]["panel-core-tier-smoke"]["models"]["gpt-5.4"]["details"]:
            for timing_field in ("timing_version", "ttft_ms", "ttfa_ms"):
                detail.pop(timing_field, None)
        migrated_tokens = migrated_v1["usage"]["apis"]["panel-core-tier-smoke"]["models"][
            "gpt-5.4"
        ]["details"][0]["tokens"]
        migrated_tokens["uncached_input_tokens"] = migrated_tokens["input_tokens"]
        seen.append("POST /v0/management/usage/import v1 migration receipt")
        migrated_result = assert_mapping(
            request_json(
                api_url,
                "/v0/management/usage/import",
                method="POST",
                payload=migrated_v1,
            ),
            "/v0/management/usage/import v1 migration receipt",
        )
        if core_usage_version == 2:
            valid_migration_receipt = (
                migrated_result.get("schema_version") == 2
                and migrated_result.get("migrated_from_version") == 1
                and migrated_result.get("migration") == "v1_uncached_input_tokens_to_v2"
            )
        else:
            valid_migration_receipt = (
                migrated_result.get("schema_version") == 3
                and migrated_result.get("migrated_from_version") == 1
                and migrated_result.get("migrations")
                == ["v1_uncached_input_tokens_to_v2", "v2_timing_contract_to_v3"]
            )
        if not valid_migration_receipt:
            raise AssertionError(f"Invalid v1 migration receipt: {migrated_result!r}")
        seen.append("Core usage import returned audited v1-to-v3 migration receipt")
        run_usage_import_contract_smoke(api_url, seen, core_usage_version)
    else:
        seen.append("Released Core v1 baseline has no v1-to-v3 migration receipt")

    assert_mapping(get(f"{V8}/observability/usage/api-keys"), f"{V8}/observability/usage/api-keys")
    assert_mapping(get(f"{V8}/plugins"), f"{V8}/plugins")
    assert_mapping(get(f"{V8}/credentials"), f"{V8}/credentials")
    assert_mapping(get(f"{V8}/observability/logs?limit=100"), f"{V8}/observability/logs")
    assert_mapping(get(f"{V8}/observability/logs/errors"), f"{V8}/observability/logs/errors")
    assert_mapping(get(f"{LTS}/flow-control"), f"{LTS}/flow-control")

    models = assert_mapping(
        request_json(api_url, "/v1/models", token=CLIENT_API_KEY),
        "/v1/models",
    )
    seen.append("GET /v1/models")
    if "data" not in models:
        raise AssertionError(f"/v1/models missing data: {models!r}")

    if include_plugin_store:
        assert_mapping(get(f"{V8}/plugins/store"), f"{V8}/plugins/store")

    if include_write_smoke:
        seen.extend(run_write_smoke(api_url, config_path))
        seen.extend(run_auth_files_write_smoke(api_url))
        if supports_plugin:
            seen.extend(run_plugin_config_smoke(api_url))
        else:
            seen.append("SKIP plugin config smoke because x-cpa-support-plugin is false")

    return seen, supports_plugin, core_usage_version



def locate_config_field(page: Any, field: str, key: str) -> None:
    search = page.get_by_role("searchbox")
    search.fill(key)
    page.locator(f'[data-config-search-field="{field}"]').click()
    page.locator(f'[data-config-field="{field}"]').wait_for(state="visible")
    page.wait_for_function("field => document.activeElement?.closest('[data-config-field]')?.dataset.configField === field", arg=field)


def assert_browser_revisioned_write(response: Any, label: str) -> None:
    """The Panel must send exactly the strong sha256 ETag it read; Core must accept it."""
    if_match = response.request.headers.get("if-match", "")
    if not ETAG_PATTERN.match(if_match):
        raise AssertionError(f"Panel {label} did not send a strong If-Match: {if_match!r}")
    if response.status != 200:
        raise AssertionError(f"Core rejected the Panel {label}: {response.status}")


def run_browser_config_save_smoke(page: Any, api_url: str, config_path: Path) -> list[str]:
    seen: list[str] = []

    page.evaluate("() => { window.location.hash = '/config'; }")
    page.wait_for_function("() => window.location.hash.split('?')[0].endsWith('/config')")
    page.get_by_text("Config Panel", exact=False).first.wait_for()
    page.get_by_role("button", name="Source File Editor").click()
    editor = page.locator(".cm-content").first
    editor.wait_for()

    current_yaml, _ = read_config_yaml(api_url)
    debug_match = re.search(r"^([ \t]*)debug:\s*(true|false)[ \t]*$", current_yaml, re.MULTILINE)
    if not debug_match:
        raise AssertionError("config.yaml missing observability.logs.debug for browser source smoke")
    next_debug = "false" if debug_match.group(2) == "true" else "true"
    source_yaml = replace_one(
        current_yaml,
        r"^([ \t]*)debug:\s*(true|false)[ \t]*$",
        f"\\1debug: {next_debug}",
        "observability.logs.debug",
    )
    source_yaml = add_browser_plugin_store_source(source_yaml)
    if BROWSER_SOURCE_MARKER not in source_yaml:
        source_yaml = f"{source_yaml.rstrip()}\n{BROWSER_SOURCE_MARKER}\n"

    editor.fill(source_yaml)
    page.locator('button[aria-label="Save"]').click()
    page.get_by_text("Review Changes", exact=False).first.wait_for()
    with page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith(f"{V8}/config.yaml")
    ) as source_saved:
        page.get_by_role("button", name="Confirm Save").click()
    page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()
    assert_browser_revisioned_write(source_saved.value, "source config.yaml save")
    seen.append("BROWSER source save PUT /v8/management/config.yaml with If-Match")

    saved_yaml, _ = read_config_yaml(api_url)
    if f"debug: {next_debug}" not in saved_yaml:
        raise AssertionError("Browser source save did not persist debug toggle")
    if BROWSER_PLUGIN_STORE_SOURCE not in saved_yaml:
        raise AssertionError("Browser source save did not persist plugins.store-sources")
    if BROWSER_SOURCE_MARKER not in saved_yaml:
        raise AssertionError("Browser source save did not persist the source mode marker comment")

    page.get_by_role("button", name="Visual Editor").click()
    locate_config_field(page, "loggingToFile", "logging-to-file")
    logging_toggle = page.get_by_label("Log to File")
    logging_toggle.scroll_into_view_if_needed()
    logging_was_checked = logging_toggle.is_checked()
    logging_toggle.evaluate("(element) => element.click()")
    expected_logging = not logging_was_checked
    locate_config_field(page, "antigravitySensitiveWords", "sensitive-words")
    words = page.locator('[data-testid="antigravity-sensitive-words"]')
    words.get_by_role('button', name='Add', exact=True).click()
    words.get_by_role('textbox').last.fill('word-obfuscation-smoke')
    locate_config_field(page, "transientErrorCooldownSeconds", "transient-error-cooldown-seconds")
    transient_cooldown_input = page.get_by_label("Transient Error Cooldown (seconds)")
    transient_cooldown_input.scroll_into_view_if_needed()
    transient_cooldown_input.fill("0")
    locate_config_field(page, "routingStrategy", "routing.strategy")
    routing_strategy_select = page.get_by_label("Routing Strategy")
    routing_strategy_select.scroll_into_view_if_needed()
    routing_strategy_select.click()
    page.get_by_role("option", name="Weighted Round Robin", exact=True).click()
    locate_config_field(page, "disableImageGeneration", "disable-image-generation")
    disable_image_generation_select = page.get_by_label("Disable Image Generation")
    disable_image_generation_select.scroll_into_view_if_needed()
    if disable_image_generation_select.inner_text().strip() != (
        "chat (remove image tool from non-image endpoints)"
    ):
        raise AssertionError(
            "Browser visual editor did not parse disable-image-generation: chat"
        )
    disable_image_generation_select.click()
    page.get_by_role(
        "option", name="passthrough (preserve client tools)", exact=True
    ).click()
    locate_config_field(page, "codexAbnormalReasoningRetryAction", "abnormal-reasoning-retry.action")
    page.get_by_role("group", name="Retry action", exact=True).get_by_role("radio", name="Retry", exact=True).check()
    locate_config_field(page, "codexAbnormalReasoningRetryStreamBufferMaxBytes", "stream-buffer-max-bytes")
    stream_buffer_max_input = page.get_by_label("Stream buffer max bytes")
    stream_buffer_max_input.scroll_into_view_if_needed()
    stream_buffer_max_input.fill("4096")
    locate_config_field(page, "codexAbnormalReasoningRetryHedgedRetryEnabled", "hedged-retry.enabled")
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
    page.get_by_role("group", name="Hedged retry mode", exact=True).get_by_role("radio", name="Speed", exact=True).check()
    locate_config_field(page, "codexAbnormalReasoningRetryExhaustedBehavior", "exhausted-behavior")
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
        and response.url.endswith(f"{V8}/config.yaml")
    ) as visual_saved:
        page.get_by_role("button", name="Confirm Save").click()
    page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()
    assert_browser_revisioned_write(visual_saved.value, "visual config.yaml save")
    seen.append("BROWSER visual save PUT /v8/management/config.yaml with If-Match")

    visual_saved_yaml, _ = read_config_yaml(api_url)
    on_disk = disk_config(config_path)
    for dotted, expected in [
        ("routing.strategy", "weighted-round-robin"),
        ("routing.cooldown.transient-error-cooldown-seconds", 0),
        ("multimedia.disable-image-generation", "passthrough"),
        ("upstream.codex.abnormal-reasoning-retry.action", "retry"),
    ]:
        if config_at(on_disk, dotted) != expected:
            raise AssertionError(
                f"Visual save did not persist canonical v8 {dotted}={expected!r} on disk: "
                f"{config_at(on_disk, dotted)!r}"
            )
    seen.append("BROWSER visual save persisted canonical v8 paths in the on-disk YAML")
    if 'word-obfuscation-smoke' not in visual_saved_yaml or 'sensitive-words:' not in visual_saved_yaml:
        raise AssertionError('Real Core did not persist Antigravity sensitive words')
    expected_logging_text = f"logging-to-file: {str(expected_logging).lower()}"
    if expected_logging_text not in visual_saved_yaml:
        raise AssertionError("Browser visual save did not persist logging-to-file toggle")
    if "transient-error-cooldown-seconds: 0" not in visual_saved_yaml:
        raise AssertionError(
            "Browser visual save did not persist transient-error-cooldown-seconds"
        )
    if "strategy: weighted-round-robin" not in visual_saved_yaml:
        raise AssertionError("Browser visual save did not persist weighted-round-robin")
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
        sent = visual_saved.value.request.post_data or ""
        if BROWSER_SOURCE_MARKER not in sent:
            raise AssertionError("Browser visual save dropped the source mode marker comment")
        # The Panel sent the comment (as a document foot comment); losing it is a Core defect.
        record_core_defect(
            "PUT /v8/management/config.yaml dropped a document-level foot comment that the "
            "Panel sent (internal/api/handlers/management/config_v8.go: whole-document PUT "
            "copies only update.Content[0])"
        )
    seen.append("BROWSER visual save preserved plugins.store-sources")

    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.split('?')[0].endsWith('/config')")
    page.get_by_text("Config Panel", exact=False).first.wait_for()
    page.get_by_role("button", name="Visual Editor").click()
    locate_config_field(page, "routingStrategy", "routing.strategy")
    if page.get_by_label("Routing Strategy").inner_text().strip() != "Weighted Round Robin":
        raise AssertionError("Browser visual editor did not reload weighted-round-robin")
    seen.append("BROWSER visual save and reload weighted-round-robin")
    locate_config_field(page, "disableImageGeneration", "disable-image-generation")
    if page.get_by_label("Disable Image Generation").inner_text().strip() != (
        "passthrough (preserve client tools)"
    ):
        raise AssertionError(
            "Browser visual editor did not reload disable-image-generation: passthrough"
        )
    seen.append("BROWSER visual reload parsed disable-image-generation passthrough")

    # 验证真实浏览器选择、YAML 落盘及 Core 热更新使用同一策略。
    locate_config_field(page, "codexCacheAffinityStrategy", "codex.cache-affinity.strategy")
    cache_control = page.get_by_test_id("codex-cache-affinity-control")
    for label, strategy in [
        ("Session compatibility only", "stable-id"),
        ("Disable enhanced optimization", "legacy"),
        ("Automatic optimization (recommended)", "client-aware"),
    ]:
        cache_control.get_by_role("radio", name=label, exact=True).check()
        page.locator('button[aria-label="Save"]').click()
        with page.expect_response(
            lambda response: response.request.method == "PUT"
            and response.url.endswith(f"{V8}/config.yaml")
        ) as saved:
            page.get_by_role("button", name="Confirm Save").click()
        if saved.value.status != 200:
            raise AssertionError(f"Core rejected cache affinity strategy {strategy}")
        page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()
        saved_yaml, _ = read_config_yaml(api_url)
        if not re.search(r"cache-affinity:\s*\n\s+strategy: " + strategy + r"\b", saved_yaml):
            raise AssertionError(f"Core did not persist cache affinity strategy {strategy}")
        deadline = time.monotonic() + 8
        while True:
            config, _ = read_config(api_url)
            if config_at(config, "upstream.codex.cache-affinity.strategy") == strategy:
                break
            if time.monotonic() >= deadline:
                raise AssertionError(f"Core did not reload cache affinity strategy {strategy}")
            time.sleep(0.25)
        page.reload(wait_until="domcontentloaded")
        page.get_by_role("button", name="Visual Editor").click()
        locate_config_field(page, "codexCacheAffinityStrategy", "codex.cache-affinity.strategy")
        if not cache_control.get_by_role("radio", name=label, exact=True).is_checked():
            raise AssertionError(f"Panel did not reload cache affinity strategy {strategy}")
        seen.append(f"BROWSER cache affinity {strategy}: save, Core reload, Panel readback")

    # The Core config watcher applies file writes asynchronously. Wait for the
    # visual-save value to reach the live config before the next smoke phase,
    # otherwise a delayed write can overwrite the log fixtures it is about to
    # inspect.
    wait_for_config_value(api_url, "observability.logs.logging-to-file", expected_logging)
    if not expected_logging:
        set_core_config_booleans(api_url, {"logging-to-file": True})

    return seen


def run_browser_flow_control_smoke(page: Any, app_url: str, api_url: str) -> list[str]:
    endpoint = "/v0/management/flow-control"
    before = request_json(api_url, endpoint)
    if before.get("schema-version") != 3 or not before.get("supported"):
        raise AssertionError("Local Core must expose supported Flow schema 3")
    if before["state"]["enabled"] or before["events-enabled"]:
        raise AssertionError("Fresh Flow must default to disabled admission and observation")
    original_yaml, _ = read_config_yaml(api_url)
    if "flow-control:" in original_yaml:
        raise AssertionError("Unrelated visual edits unexpectedly created Flow configuration")

    page.goto(f"{app_url}/#/flow-control", wait_until="domcontentloaded")
    flow = page.get_by_test_id("flow-control-settings")
    flow.wait_for()
    flow.get_by_role("button", name="Add rule", exact=True).click()
    flow.get_by_label("Maximum in flight (0 = unlimited concurrency)", exact=True).fill("2")
    flow.get_by_label("Enable local flow control", exact=True).evaluate("element => element.click()")
    flow.get_by_label("Allow live updates", exact=True).evaluate("element => element.click()")

    def save() -> None:
        page.locator('button[aria-label="Save"]').click()
        page.get_by_text("Review Changes", exact=False).first.wait_for()
        with page.expect_response(lambda response: response.request.method == "PUT"
                                  and response.url.endswith(f"{V8}/config.yaml")) as saved:
            page.get_by_role("button", name="Confirm Save").click()
        assert_browser_revisioned_write(saved.value, "Flow page config.yaml save")
        page.get_by_text("Configuration saved successfully", exact=False).first.wait_for()

    save()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        applied = request_json(api_url, endpoint)
        if applied["state"]["enabled"] and applied["events-enabled"]:
            break
        time.sleep(0.1)
    else:
        raise AssertionError("Flow watcher did not apply the saved policy")
    rule = applied["policy"]["rules"][0]
    if applied["policy"]["version"] != 3 or rule["max-concurrent"] != 2:
        raise AssertionError("Flow visual rule did not round-trip into Core policy")
    preview = request_json(api_url, endpoint + "/preview", "POST", {
        "targets": [{"stage": "attempt", "provider": "codex", "model": "gpt-5"}]
    })
    if preview["results"][0]["complete"]:
        raise AssertionError("Missing account must not appear as a complete account-limit preview")
    details = request_json(api_url, endpoint + "/details?offset=0&limit=100")
    if details["matching-total"] != 0:
        raise AssertionError("Management previews must not create model activity")

    flow.get_by_role("button", name="Refresh status and references", exact=True).click()
    flow.get_by_role("button", name="Observe live", exact=True).click()
    flow.locator('[data-state="live"]').wait_for()
    flow.get_by_role("button", name="Stop live updates", exact=True).click()
    # Change the actual policy while observation is stopped. Its first resumed
    # summary must refresh the full policy, not only its counters/revision.
    current_yaml, revision = read_config_yaml(api_url)
    changed_yaml = replace_one(current_yaml, r"max-concurrent: 2", "max-concurrent: 3", "Flow limit")
    write_config(api_url, "/config.yaml", yaml_text=changed_yaml, revision=revision)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        changed = request_json(api_url, endpoint)
        if changed["policy"]["rules"][0]["max-concurrent"] == 3:
            break
        time.sleep(0.1)
    else:
        raise AssertionError("Paused Flow policy update was not applied")
    with page.expect_response(lambda response: response.request.method == "GET"
                              and response.url.endswith(endpoint)) as refreshed:
        flow.get_by_role("button", name="Observe live", exact=True).click()
    if refreshed.value.json()["policy"]["rules"][0]["max-concurrent"] != 3:
        raise AssertionError("Resumed Flow observation did not reload the latest policy")
    flow.locator('[data-state="live"]').wait_for()
    flow.get_by_role("button", name="Stop live updates", exact=True).click()
    for width in (1440, 390):
        page.set_viewport_size({"width": width, "height": 1000})
        flow.scroll_into_view_if_needed()
        if page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1"):
            raise AssertionError(f"Flow configuration overflows the page at {width}px")
    page.set_viewport_size({"width": 1440, "height": 1000})
    flow.get_by_label("Enable local flow control", exact=True).evaluate("element => element.click()")
    flow.get_by_label("Allow live updates", exact=True).evaluate("element => element.click()")
    save()
    return ["BROWSER Flow V3 defaults, dedicated-page save/readback, incomplete preview, paged details, authenticated SSE, paused-policy refresh and responsive widths"]


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
    "BROWSER provider workbench Interactions API create PUT /v8/management/config/api-keys/interactions",
    "BROWSER provider workbench Interactions API update PUT /v8/management/config/api-keys/interactions",
    "BROWSER provider workbench Interactions API delete PUT /v8/management/config/api-keys/interactions",
    "BROWSER provider workbench Interactions API weight round-trip",
    "BROWSER provider workbench Claude create PUT /v8/management/config/api-keys/claude",
    "BROWSER provider workbench Claude update PUT /v8/management/config/api-keys/claude",
    "BROWSER provider workbench Claude delete PUT /v8/management/config/api-keys/claude",
    "BROWSER provider workbench Claude fingerprint-profile round-trip and reset",
    "BROWSER provider workbench Vertex create PUT /v8/management/config/api-keys/vertex",
    "BROWSER provider workbench Vertex update PUT /v8/management/config/api-keys/vertex",
    "BROWSER provider workbench Vertex delete PUT /v8/management/config/api-keys/vertex",
)

# v8 JSON is rendered from YAML, so thinking flags use their YAML tags.
V8_THINKING_FLAGS = {"zero-allowed": True, "dynamic-allowed": True}


def entries_from_groups(groups: Any) -> list[dict[str, Any]]:
    return provider_entries({"api-keys": {"family": groups if isinstance(groups, list) else []}}, "family")


def expect_family_put(page: Any, family: str) -> Any:
    return page.expect_response(
        lambda response: response.request.method == "PUT"
        and response.url.endswith(f"{V8}/config/api-keys/{family}")
    )


def edit_browser_provider_group_base_url(
    page: Any, family: str, label: str, api_key: str, base_url: str
) -> list[str]:
    """v8 base URLs are group-owned: key edits keep them read-only and the group sheet writes them."""
    provider_row_for_api_key(page, api_key).get_by_role("button", name="Edit").click()
    sheet = page.get_by_role("dialog").last
    if not sheet.get_by_label("Base URL").is_disabled():
        raise AssertionError(f"{label} key edit allowed changing the shared group base URL")
    sheet.get_by_role("button", name="Edit configuration group").click()
    group_sheet = page.get_by_role("dialog", name="Edit configuration group")
    group_sheet.get_by_label("Shared base URL").fill(base_url)
    group_sheet.get_by_role("button", name="Save").click()
    with expect_family_put(page, family) as group_put:
        page.get_by_role("dialog", name="Apply group-wide changes?").get_by_role(
            "button", name="Save"
        ).click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(group_put.value, f"{label} group edit")
    payload = json.loads(group_put.value.request.post_data or "null")
    if contains_key(payload, "auth_index") or contains_key(payload, "auth-index"):
        raise AssertionError(f"{label} group PUT wrote response-only auth index: {payload!r}")
    return [f"BROWSER provider workbench {label} group base-url edit PUT {V8}/config/api-keys/{family} with readback"]


def run_browser_provider_key_crud_smoke(
    page: Any,
    api_url: str,
    label: str,
    button_pattern: str,
    family: str,
    api_key: str,
    create_base_url: str,
    update_base_url: str,
    weight: int | None = None,
) -> list[str]:
    seen: list[str] = []
    endpoint = f"{V8}/config/api-keys/{family}"
    label_slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    model_name = f"{label_slug}-browser-model"
    model_alias = f"{label_slug}-browser-alias"
    created_display_name = f"{label} Browser Model"
    updated_display_name = f"{label} Browser Model Updated"

    def entries() -> list[dict[str, Any]]:
        config, _ = read_config(api_url)
        return provider_entries(config, family)

    page.get_by_role("button", name=re.compile(button_pattern, re.I)).click()
    page.get_by_role("heading", name=label).wait_for()
    page.get_by_role("button", name=re.compile(r"^New$", re.I)).first.click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_role("textbox", name="API key").fill(api_key)
    sheet.get_by_label("Base URL").fill(create_base_url)
    if weight is not None:
        sheet.get_by_label("Scheduling weight").fill(str(weight))
    if label == "Claude":
        sheet.get_by_role("button", name="Request fingerprint").click()
        page.get_by_role("option", name="Claude Code CLI", exact=True).click()
    sheet.get_by_text("Custom models", exact=True).click()
    sheet.get_by_label("Upstream model name").fill(model_name)
    sheet.get_by_label("Routing alias (optional)").fill(model_alias)
    sheet.get_by_label("Display name (optional)").fill(created_display_name)
    model_card = sheet.get_by_label("Upstream model name").locator(
        "xpath=ancestor::div[contains(@class, 'modelEntry')][1]"
    )
    model_card.get_by_role("button", name="Expand", exact=True).click()
    model_card.get_by_role("checkbox", name="Maximum", exact=True).set_checked(True, force=True)
    model_card.get_by_role(
        "checkbox", name="Allow thinking off", exact=True
    ).set_checked(True, force=True)
    model_card.get_by_role("checkbox", name="Allow automatic budget", exact=True).set_checked(
        True, force=True
    )
    model_card.get_by_label("Minimum token budget").fill("128")
    model_card.get_by_label("Maximum token budget").fill("32768")
    model_card.get_by_text("Advanced thinking JSON", exact=True).click()
    thinking_textarea = model_card.locator("textarea")
    thinking_config = json.loads(thinking_textarea.input_value())
    thinking_config["levels"].append("vendor-custom")
    # Core v8 decodes provider config strictly: a field outside its schema is rejected (400
    # invalid_config) and must surface in the open sheet without persisting anything.
    thinking_textarea.fill(json.dumps({**thinking_config, "x-lts-thinking-note": "rejected"}))
    model_card.get_by_role("checkbox", name="High", exact=True).set_checked(True, force=True)
    with expect_family_put(page, family) as rejected_info:
        sheet.get_by_role("button", name="Create").click()
    if rejected_info.value.status != 400:
        raise AssertionError(f"Core v8 accepted an unknown thinking field for {label}: {rejected_info.value.status}")
    sheet.get_by_text("x-lts-thinking-note", exact=False).first.wait_for()
    if any(item.get("api-key") == api_key for item in entries()):
        raise AssertionError(f"Rejected {label} create still persisted the key")
    seen.append(f"BROWSER provider workbench {label} surfaced Core v8 strict-schema rejection in the sheet")
    accepted_thinking = json.loads(thinking_textarea.input_value())
    accepted_thinking.pop("x-lts-thinking-note", None)
    thinking_textarea.fill(json.dumps(accepted_thinking))
    with expect_family_put(page, family) as create_response_info:
        sheet.get_by_role("button", name="Create").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(create_response_info.value, f"{label} create")
    seen.append(f"BROWSER provider workbench {label} create PUT {endpoint}")
    create_payload = json.loads(create_response_info.value.request.post_data or "null")
    if contains_key(create_payload, "auth_index") or contains_key(create_payload, "auth-index"):
        raise AssertionError(f"{label} browser PUT wrote response-only auth index: {create_payload!r}")
    if not any(
        item.get("api-key") == api_key
        and (weight is None or item.get("weight") == weight)
        and (label != "Claude" or item.get("fingerprint-profile") == "claude-code-cli")
        and any(
            isinstance(model, dict)
            and model.get("name") == model_name
            and isinstance(model.get("thinking"), dict)
            and "vendor-custom" in (model["thinking"].get("levels") or [])
            for model in item.get("models", [])
        )
        for item in entries_from_groups(create_payload)
    ):
        raise AssertionError(f"{label} browser PUT dropped advanced thinking JSON: {create_payload!r}")
    items_after_create = entries()
    if not any(
        item.get("api-key") == api_key
        and item.get("base-url") == create_base_url
        and item.get("auth_index")
        and (weight is None or item.get("weight") == weight)
        and (label != "Claude" or item.get("fingerprint-profile") == "claude-code-cli")
        and any(
            isinstance(model, dict)
            and model.get("name") == model_name
            and model.get("alias") == model_alias
            and model.get("display-name") == created_display_name
            and isinstance(model.get("thinking"), dict)
            and all(
                model["thinking"].get(key) == value
                for key, value in {
                    "levels": ["high", "max", "vendor-custom"],
                    "min": 128,
                    "max": 32768,
                    **V8_THINKING_FLAGS,
                }.items()
            )
            for model in item.get("models", [])
        )
        for item in items_after_create
    ):
        raise AssertionError(f"{label} browser create did not round-trip: {items_after_create!r}")

    row = provider_row_for_api_key(page, api_key)
    row.get_by_role("button", name="Edit").click()
    sheet = page.get_by_role("dialog").last
    if not sheet.get_by_label("Base URL").is_disabled():
        raise AssertionError(f"{label} key edit allowed changing the shared group base URL")
    if weight is not None:
        weight_input = sheet.get_by_label("Scheduling weight")
        if weight_input.input_value() != str(weight):
            raise AssertionError(f"{label} edit did not reload credential weight")
        weight_input.fill(str(weight + 1))
    if label == "Claude":
        fingerprint_select = sheet.get_by_role("button", name="Request fingerprint")
        if fingerprint_select.inner_text().strip() != "Claude Code CLI":
            raise AssertionError("Claude edit did not reload the saved fingerprint profile")
        fingerprint_select.click()
        page.get_by_role("option", name="Default (caller-owned)", exact=True).click()
    sheet.get_by_text("Custom models", exact=True).click()
    sheet.get_by_label("Display name (optional)").fill(updated_display_name)
    model_card = sheet.get_by_label("Upstream model name").locator(
        "xpath=ancestor::div[contains(@class, 'modelEntry')][1]"
    )
    model_card.get_by_role("button", name="Expand", exact=True).click()
    if not model_card.get_by_role("checkbox", name="Maximum", exact=True).is_checked():
        raise AssertionError(f"{label} edit did not reload the saved maximum thinking level")
    model_card.get_by_role("button", name="Use Core default", exact=True).click()
    model_card.get_by_text(
        "Not explicitly configured. Core will use the model's built-in or default capability.",
        exact=True,
    ).wait_for()
    with expect_family_put(page, family) as update_response_info:
        sheet.get_by_role("button", name="Save").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(update_response_info.value, f"{label} update")
    seen.append(f"BROWSER provider workbench {label} update PUT {endpoint}")
    items_after_update = entries()
    if not any(
        item.get("api-key") == api_key
        and item.get("base-url") == create_base_url
        and (weight is None or item.get("weight") == weight + 1)
        and (label != "Claude" or "fingerprint-profile" not in item)
        and any(
            isinstance(model, dict)
            and model.get("name") == model_name
            and model.get("display-name") == updated_display_name
            and "thinking" not in model
            for model in item.get("models", [])
        )
        for item in items_after_update
    ):
        raise AssertionError(f"{label} browser update did not round-trip: {items_after_update!r}")
    seen.append(f"BROWSER provider workbench {label} new model display-name")
    seen.append(f"BROWSER provider workbench {label} updated model display-name")
    seen.append(f"BROWSER provider workbench {label} thinking capability round-trip and reset")
    if label == "Claude":
        seen.append("BROWSER provider workbench Claude fingerprint-profile round-trip and reset")
    if weight is not None:
        seen.append(f"BROWSER provider workbench {label} weight round-trip")

    seen.extend(edit_browser_provider_group_base_url(page, family, label, api_key, update_base_url))
    items_after_group = entries()
    if not any(
        item.get("api-key") == api_key
        and item.get("base-url") == update_base_url
        and item.get("auth_index")
        and (weight is None or item.get("weight") == weight + 1)
        and any(
            isinstance(model, dict) and model.get("display-name") == updated_display_name
            for model in item.get("models", [])
        )
        for item in items_after_group
    ):
        raise AssertionError(f"{label} group edit did not keep key settings: {items_after_group!r}")

    row = provider_row_for_api_key(page, api_key)
    row.get_by_role("button", name="Delete").click()
    confirm = page.get_by_role("dialog", name="Delete resource")
    confirm.get_by_text("This action cannot be undone", exact=False).first.wait_for()
    with expect_family_put(page, family) as delete_response_info:
        confirm.get_by_role("button", name="Delete").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(delete_response_info.value, f"{label} delete")
    seen.append(f"BROWSER provider workbench {label} delete PUT {endpoint}")
    if any(item.get("api-key") == api_key for item in entries()):
        raise AssertionError(f"{label} browser delete did not remove the created key")

    return seen


def ensure_provider_fixtures(api_url: str) -> None:
    """Synthetic provider resources the Workbench edits (created when --no-write-smoke)."""
    config, revision = read_config(api_url)
    if not provider_groups(config, "gemini"):
        write_config(
            api_url,
            "/config/api-keys/gemini",
            [
                {
                    "name": "gemini-1",
                    "base-url": "https://generativelanguage.googleapis.com",
                    "models": [{"name": "gemini-2.5-flash", "display-name": "Gemini Flash Write"}],
                    "keys": [{"api-key": "gemini-real-write-key"}],
                }
            ],
            revision=revision,
        )
        config, revision = read_config(api_url)
    if not provider_groups(config, "openai-compatibility"):
        write_config(
            api_url,
            "/config/api-keys/openai-compatibility",
            [
                {
                    "name": "Smoke OpenAI Compatible",
                    "base-url": "https://openai-compatible.example.test/v1",
                    "keys": [{"api-key": "openai-real-write-key"}],
                    "models": [
                        {
                            "name": "k3",
                            "alias": "kimi-k3",
                            "display-name": "Kimi K3 Smoke",
                            "thinking": {"levels": ["low", "vendor-custom"], "min": 128, "max": 32768},
                        }
                    ],
                }
            ],
            revision=revision,
        )


def run_browser_provider_workbench_smoke(
    page: Any, app_url: str, api_url: str, config_path: Path
) -> list[str]:
    seen: list[str] = []
    ensure_provider_fixtures(api_url)

    page.goto(f"{app_url}?core-provider-workbench#/ai-providers", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/ai-providers')")
    page.get_by_role("heading", name="AI Providers").wait_for()

    config, _ = read_config(api_url)
    gemini_before = provider_entries(config, "gemini")
    if not gemini_before:
        raise AssertionError("Browser workbench smoke expected at least one Gemini resource")
    gemini_was_disabled = is_provider_disabled(gemini_before[0])
    with expect_family_put(page, "gemini") as toggled:
        page.get_by_label(re.compile(r"Enable|Disable", re.I)).first.evaluate(
            "(element) => element.click()"
        )
    assert_browser_revisioned_write(toggled.value, "Gemini toggle")
    seen.append("BROWSER provider workbench Gemini toggle PUT /v8/management/config/api-keys/gemini")
    config, _ = read_config(api_url)
    gemini_after = provider_entries(config, "gemini")
    if not gemini_after or is_provider_disabled(gemini_after[0]) == gemini_was_disabled:
        raise AssertionError(f"Gemini browser toggle did not change disabled state: {gemini_after!r}")
    if not any(
        isinstance(model, dict) and model.get("display-name") == "Gemini Flash Write"
        for model in gemini_after[0].get("models", [])
    ):
        raise AssertionError(f"Gemini toggle dropped model display-name: {gemini_after!r}")

    # Codex create/edit with an inherit/override runtime policy field; read back from the
    # persisted file and from GET /v8/management/config (auth_index injected, never stored).
    codex_key = "codex-browser-new"

    def codex_disk_key() -> dict[str, Any] | None:
        for group in provider_groups(disk_config(config_path), "codex"):
            for key in group.get("keys") or []:
                if isinstance(key, dict) and key.get("api-key") == codex_key:
                    return {"group": group, "key": key}
        return None

    page.get_by_role("button", name=re.compile(r"Codex", re.I)).click()
    page.get_by_role("heading", name="Codex").wait_for()
    page.get_by_role("button", name=re.compile(r"^New$", re.I)).first.click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_role("textbox", name="API key").fill(codex_key)
    sheet.get_by_label("Base URL").fill("https://codex.browser.example/v1")
    sheet.get_by_label("Enable WebSockets").check()
    sheet.get_by_text("Advanced runtime policy", exact=True).click()
    sheet.get_by_label("Request retries", exact=True).fill("2")
    sheet.get_by_role("button", name="Cooling", exact=True).click()
    page.get_by_role("option", name="Disable cooling", exact=True).click()
    sheet.get_by_text("Custom models", exact=True).click()
    sheet.get_by_label("Upstream model name").fill("gpt-5")
    sheet.get_by_label("Routing alias (optional)").fill("gpt-5-browser")
    sheet.get_by_label("Display name (optional)").fill("Codex Browser Model")
    with expect_family_put(page, "codex") as created:
        sheet.get_by_role("button", name="Create").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(created.value, "Codex create")
    seen.append("BROWSER provider workbench Codex create PUT /v8/management/config/api-keys/codex")
    persisted = codex_disk_key()
    if (
        not persisted
        or persisted["group"].get("base-url") != "https://codex.browser.example/v1"
        or persisted["key"].get("websockets") is not True
        or persisted["key"].get("request-retry") != 2
        or persisted["key"].get("disable-cooling") is not True
    ):
        raise AssertionError(f"Codex create did not persist the override policy on disk: {persisted!r}")
    config, _ = read_config(api_url)
    codex_entry = next(
        (item for item in provider_entries(config, "codex") if item.get("api-key") == codex_key), None
    )
    if not codex_entry or not codex_entry.get("auth_index"):
        raise AssertionError(f"GET /v8/management/config did not inject auth_index: {codex_entry!r}")
    if "auth_index" in config_path.read_text(encoding="utf-8"):
        raise AssertionError("Codex create persisted the response-only auth_index on disk")
    gemini_index_before = [item.get("auth_index") for item in provider_entries(config, "gemini")]
    seen.append("BROWSER Codex override policy (request-retry, disable-cooling) persisted on disk; auth_index only in GET")

    provider_row_for_api_key(page, codex_key).get_by_role("button", name="Edit").click()
    sheet = page.get_by_role("dialog").last
    if not sheet.get_by_label("Base URL").is_disabled():
        raise AssertionError("Codex key edit allowed changing the shared group base URL")
    sheet.get_by_text("Advanced runtime policy", exact=True).click()
    retries = sheet.get_by_label("Request retries", exact=True)
    if retries.input_value() != "2":
        raise AssertionError(f"Codex edit did not reload the retry override: {retries.input_value()!r}")
    retries.fill("")
    sheet.get_by_role("button", name="Cooling", exact=True).click()
    page.get_by_role("option", name="Inherit", exact=True).click()
    sheet.get_by_text("Custom models", exact=True).click()
    sheet.get_by_label("Display name (optional)").fill("Codex Browser Model Updated")
    with expect_family_put(page, "codex") as updated:
        sheet.get_by_role("button", name="Save").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(updated.value, "Codex update")
    seen.append("BROWSER provider workbench Codex update PUT /v8/management/config/api-keys/codex")
    persisted = codex_disk_key()
    if (
        not persisted
        or persisted["group"].get("base-url") != "https://codex.browser.example/v1"
        or "request-retry" in persisted["key"]
        or "disable-cooling" in persisted["key"]
        or not any(
            isinstance(model, dict) and model.get("display-name") == "Codex Browser Model Updated"
            for model in persisted["key"].get("models", []) + persisted["group"].get("models", [])
        )
    ):
        raise AssertionError(f"Codex edit back to inherit did not persist on disk: {persisted!r}")
    config, _ = read_config(api_url)
    if not any(
        item.get("api-key") == codex_key and item.get("auth_index")
        for item in provider_entries(config, "codex")
    ):
        raise AssertionError("Codex edit dropped the injected auth_index")
    # F24: editing provider B must not disturb provider A's usage attribution identity.
    gemini_index_after = [item.get("auth_index") for item in provider_entries(config, "gemini")]
    if gemini_index_after != gemini_index_before or not all(gemini_index_after):
        raise AssertionError(
            f"Codex edit changed Gemini auth_index: {gemini_index_before!r} -> {gemini_index_after!r}"
        )
    seen.append("BROWSER Codex inherit policy removed key overrides on disk; other providers' auth_index unchanged")
    seen.extend(
        edit_browser_provider_group_base_url(
            page, "codex", "Codex", codex_key, "https://codex.browser-updated.example/v1"
        )
    )
    persisted = codex_disk_key()
    if (
        not persisted
        or persisted["group"].get("base-url") != "https://codex.browser-updated.example/v1"
        or persisted["key"].get("websockets") is not True
        or not any(
            isinstance(model, dict) and model.get("display-name") == "Codex Browser Model Updated"
            for model in persisted["key"].get("models", []) + persisted["group"].get("models", [])
        )
    ):
        raise AssertionError(f"Codex group edit did not persist on disk with key settings: {persisted!r}")

    provider_row_for_api_key(page, codex_key).get_by_role("button", name="Delete").click()
    confirm = page.get_by_role("dialog", name="Delete resource")
    confirm.get_by_text("This action cannot be undone", exact=False).first.wait_for()
    with expect_family_put(page, "codex") as deleted:
        confirm.get_by_role("button", name="Delete").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(deleted.value, "Codex delete")
    seen.append("BROWSER provider workbench Codex delete PUT /v8/management/config/api-keys/codex")
    if codex_disk_key() is not None:
        raise AssertionError("Codex browser delete did not remove the created key from disk")

    page.get_by_role("button", name=re.compile(r"^xAI(?:\s|$)", re.I)).click()
    page.get_by_role("heading", name="xAI", exact=True).wait_for()
    page.get_by_role("button", name=re.compile(r"^New$", re.I)).first.click()
    sheet = page.get_by_role("dialog").last
    sheet.get_by_text(re.compile(r"^(?:New|Create) · xAI$"), exact=True).wait_for()
    xai_base_url = sheet.get_by_label("Base URL")
    if xai_base_url.input_value() != "https://api.x.ai/v1":
        raise AssertionError(
            f"xAI browser form used the wrong default base URL: {xai_base_url.input_value()!r}"
        )
    sheet.get_by_role("textbox", name="API key").fill("xai-browser-new")
    sheet.get_by_label("Enable WebSockets").check()
    sheet.get_by_text("Custom models", exact=True).click()
    sheet.get_by_label("Upstream model name").fill("grok-4.5")
    sheet.get_by_label("Routing alias (optional)").fill("grok-browser")
    sheet.get_by_label("Display name (optional)").fill("Grok Browser Model")
    with expect_family_put(page, "xai") as xai_created:
        sheet.get_by_role("button", name="Create").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(xai_created.value, "xAI create")
    seen.append("BROWSER provider workbench xAI create PUT /v8/management/config/api-keys/xai")
    config, _ = read_config(api_url)
    if not any(
        item.get("api-key") == "xai-browser-new"
        and item.get("base-url") == "https://api.x.ai/v1"
        and item.get("websockets") is True
        and any(
            isinstance(model, dict)
            and model.get("alias") == "grok-browser"
            and model.get("display-name") == "Grok Browser Model"
            for model in item.get("models", [])
        )
        for item in provider_entries(config, "xai")
    ):
        raise AssertionError(f"xAI browser create did not round-trip: {provider_entries(config, 'xai')!r}")
    provider_row_for_api_key(page, "xai-browser-new").get_by_role("button", name="Delete").click()
    confirm = page.get_by_role("dialog", name="Delete resource")
    with expect_family_put(page, "xai") as xai_deleted:
        confirm.get_by_role("button", name="Delete").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(xai_deleted.value, "xAI delete")
    config, _ = read_config(api_url)
    if any(item.get("api-key") == "xai-browser-new" for item in provider_entries(config, "xai")):
        raise AssertionError("xAI browser delete did not remove the created key")
    seen.append("BROWSER provider workbench xAI delete PUT /v8/management/config/api-keys/xai")

    seen.extend(
        run_browser_provider_key_crud_smoke(
            page,
            api_url,
            label="Interactions API",
            button_pattern=r"^Interactions API\b",
            family="interactions",
            api_key="interactions-browser-new",
            create_base_url="https://interactions.browser.example",
            update_base_url="https://interactions.browser-updated.example",
            weight=5,
        )
    )
    seen.extend(
        run_browser_provider_key_crud_smoke(
            page,
            api_url,
            label="Claude",
            button_pattern=r"^Claude\b",
            family="claude",
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
            family="vertex",
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
    sheet.get_by_text("Custom models", exact=True).click()
    if sheet.get_by_label("Display name (optional)").first.input_value() != "Kimi K3 Smoke":
        raise AssertionError("OpenAI workbench did not parse existing model display-name")
    first_model = sheet.get_by_label("Display name (optional)").first.locator(
        "xpath=ancestor::div[contains(@class, 'modelEntry')][1]"
    )
    first_model.get_by_role("button", name="Expand", exact=True).click()
    if not first_model.get_by_role("checkbox", name="Low", exact=True).is_checked():
        raise AssertionError("OpenAI workbench did not parse the existing low thinking level")
    first_model.get_by_role("checkbox", name="High", exact=True).set_checked(True, force=True)
    first_model.get_by_role("checkbox", name="Maximum", exact=True).set_checked(True, force=True)
    first_model.get_by_text("Advanced thinking JSON", exact=True).click()
    updated_thinking = json.loads(first_model.locator("textarea").input_value())
    if updated_thinking != {"levels": ["low", "high", "max", "vendor-custom"], "min": 128, "max": 32768}:
        raise AssertionError(f"OpenAI workbench dropped advanced thinking config: {updated_thinking!r}")
    sheet.get_by_label("Display name (optional)").first.fill("OpenAI Smoke Updated")
    with expect_family_put(page, "openai-compatibility") as openai_saved:
        sheet.get_by_role("button", name="Save").click()
    wait_for_no_dialog(page)
    assert_browser_revisioned_write(openai_saved.value, "OpenAI Compatibility save")
    seen.append(
        "BROWSER provider workbench OpenAI Compatibility save PUT /v8/management/config/api-keys/openai-compatibility"
    )
    config, _ = read_config(api_url)
    openai_after_save = provider_groups(config, "openai-compatibility")
    if not any(
        item.get("name") == "Smoke OpenAI Compatible"
        and item.get("prefix") == "browser-oa-smoke"
        and any(
            isinstance(key, dict) and key.get("auth_index") for key in item.get("keys", [])
        )
        and any(
            isinstance(model, dict)
            and model.get("display-name") == "OpenAI Smoke Updated"
            and model.get("thinking")
            == {"levels": ["low", "high", "max", "vendor-custom"], "min": 128, "max": 32768}
            for model in item.get("models", [])
        )
        for item in openai_after_save
    ):
        raise AssertionError(f"OpenAI browser save did not round-trip prefix: {openai_after_save!r}")
    seen.append("BROWSER provider workbench thinking levels preserved advanced config")
    seen.append("BROWSER provider workbench new model display-name round-trip")
    seen.append("BROWSER provider workbench updated model display-name round-trip")
    persisted_yaml = config_path.read_text(encoding="utf-8")
    if "auth_index" in persisted_yaml or "auth-index" in persisted_yaml or "authIndex" in persisted_yaml:
        raise AssertionError("Browser provider workbench persisted response-only auth-index")
    if not any(
        thinking.get("levels") == ["low", "high", "max", "vendor-custom"] and thinking.get("max") == 32768
        for thinking in disk_thinking(config_path)
    ):
        raise AssertionError("Browser provider workbench did not persist thinking config")
    seen.append("BROWSER provider workbench kept auth-index out of config.yaml")

    return seen


def run_browser_full_usage_status_smoke(page: Any, app_url: str, api_url: str) -> list[str]:
    """Workbench status bars are driven by full usage, attributed through the v8 auth_index."""
    usage_key = "codex-usage-status-key"
    config, revision = read_config(api_url)
    groups = provider_groups(config, "codex")
    groups = [
        {k: v for k, v in group.items()} | {
            "keys": [
                {k: v for k, v in key.items() if k != "auth_index"}
                for key in group.get("keys") or []
                if isinstance(key, dict)
            ]
        }
        for group in groups
    ]
    groups.append(
        {"name": "codex-usage", "base-url": "https://codex.usage.example/v1", "keys": [{"api-key": usage_key}]}
    )
    write_config(api_url, "/config/api-keys/codex", groups, revision=revision)
    config, _ = read_config(api_url)
    auth_index = next(
        (item.get("auth_index") for item in provider_entries(config, "codex") if item.get("api-key") == usage_key),
        None,
    )
    if not auth_index:
        raise AssertionError("Core did not inject an auth_index for the usage-status Codex key")

    now = datetime.now(timezone.utc).replace(microsecond=0)
    details = [
        {
            "timestamp": (now - timedelta(minutes=minute)).isoformat().replace("+00:00", "Z"),
            "source": usage_key,
            "auth_index": auth_index,
            "latency_ms": 100,
            "tokens": {"input_tokens": 3, "output_tokens": 2, "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 5},
            "failed": failed,
        }
        for minute, failed in [(1, False), (2, False), (3, False), (4, True)]
    ]
    snapshot = {
        "version": 3,
        "exported_at": now.isoformat().replace("+00:00", "Z"),
        "usage": {
            "total_requests": 4,
            "success_count": 3,
            "failure_count": 1,
            "total_tokens": 20,
            "apis": {
                "panel-core-provider-status": {
                    "total_requests": 4,
                    "total_tokens": 20,
                    "models": {"gpt-5": {"total_requests": 4, "total_tokens": 20, "details": details}},
                }
            },
        },
    }
    receipt = assert_mapping(
        request_json(api_url, f"{LTS}/usage/import", method="POST", payload=snapshot),
        f"{LTS}/usage/import provider status fixture",
    )
    if receipt.get("total_requests") is None:
        raise AssertionError(f"Usage import for the provider status bar failed: {receipt!r}")

    # Full usage comes from the LTS extension (usage query summary when Core supports it,
    # otherwise GET /usage); either way it is read fresh on this navigation.
    with page.expect_response(
        lambda response: f"{LTS}/usage" in response.url and response.status == 200
    ):
        page.goto(f"{app_url}?core-provider-usage#/ai-providers", wait_until="domcontentloaded")
    page.get_by_role("button", name=re.compile(r"Codex", re.I)).click()
    page.get_by_role("heading", name="Codex").wait_for()
    row = provider_row_for_api_key(page, usage_key)
    stats = row.locator('[data-usage-source="full"]')
    stats.wait_for()
    stats.get_by_text("Success: 3", exact=True).wait_for()
    stats.get_by_text("Failure: 1", exact=True).wait_for()
    return [
        "BROWSER Workbench full-usage status bar attributed imported v3 usage by v8 auth_index (3 success / 1 failure)"
    ]


def read_download_text(download: Any) -> str:
    path = download.path()
    if not path:
        return ""
    return Path(path).read_text(encoding="utf-8", errors="replace")


def trigger_real_core_request_log(api_url: str) -> str:
    """Send one synthetic failing /v1 request and return the request id Core logged for it."""
    marker_model = "lts-core-log-smoke-model"
    http_request(
        api_url,
        "/v1/chat/completions",
        "POST",
        json.dumps({"model": marker_model, "messages": [{"role": "user", "content": "smoke"}]}).encode(),
        {"Content-Type": "application/json"},
        token=CLIENT_API_KEY,
    )
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        payload = assert_mapping(
            request_json(api_url, f"{V8}/observability/logs?limit=200"), f"{V8}/observability/logs"
        )
        for line in reversed(payload.get("lines") or []):
            match = re.search(r"\[([0-9a-f]{8})\][^\n]*/v1/chat/completions", str(line))
            if match:
                return match.group(1)
        time.sleep(0.25)
    raise AssertionError("Real Core did not log the synthetic /v1 request with a request id")


def run_browser_real_core_logs_smoke(
    page: Any,
    app_url: str,
    api_url: str,
    logs_dir: Path,
) -> list[str]:
    """Logs produced by real Core traffic (no files written into Core's live log)."""
    seen: list[str] = []

    set_core_config_booleans(api_url, {"logging-to-file": True, "request-log": True})
    request_id = trigger_real_core_request_log(api_url)
    seen.append("TRIGGERED real Core request log with a synthetic failing /v1 request")

    page.goto(f"{app_url}?core-logs=file-request#/logs", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/logs')")
    page.get_by_text("Logs Viewer", exact=False).first.wait_for()
    request_id_badge = page.get_by_text(request_id, exact=True).first
    request_id_badge.wait_for()
    box = request_id_badge.bounding_box()
    if not box:
        raise AssertionError("Could not locate real Core request id badge for long-press smoke")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(750)
    page.mouse.up()
    request_dialog = page.get_by_role("dialog", name="Download Request Log")
    request_dialog.get_by_text(request_id, exact=False).wait_for()
    with page.expect_download() as request_download:
        request_dialog.get_by_role("button", name="Confirm").click()
    request_file = request_download.value
    if request_file.suggested_filename != f"request-{request_id}.log":
        raise AssertionError(
            f"Unexpected real Core request log download filename: {request_file.suggested_filename}"
        )
    if "lts-core-log-smoke-model" not in read_download_text(request_file):
        raise AssertionError("Real Core request log download did not contain the smoke request")
    seen.append("BROWSER real Core request log download GET /v8/management/observability/logs/requests")

    set_core_config_booleans(api_url, {"logging-to-file": True, "request-log": False})
    seen.append("SET real Core request-log false for error log listing")
    trigger_real_core_request_log(api_url)
    error_files: list[str] = []
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and not error_files:
        listing = assert_mapping(
            request_json(api_url, f"{V8}/observability/logs/errors"), f"{V8}/observability/logs/errors"
        )
        error_files = [
            str(item.get("name"))
            for item in listing.get("files") or []
            if isinstance(item, dict) and item.get("name")
        ]
        if not error_files:
            time.sleep(0.25)
    if not error_files:
        raise AssertionError("Real Core did not write an error log for the failing request")
    error_name = error_files[0]

    page.goto(f"{app_url}?core-logs=file-error#/logs", wait_until="domcontentloaded")
    page.wait_for_function("() => window.location.hash.endsWith('/logs')")
    page.get_by_text("Logs Viewer", exact=False).first.wait_for()
    page.get_by_role("button", name="Error Request Logs").click()
    page.get_by_text(error_name, exact=False).first.wait_for()
    error_row = page.locator(".item-row").filter(has_text=error_name).first
    error_row.get_by_role("button", name="Open").click()
    error_dialog = page.get_by_role("dialog", name=error_name)
    error_dialog.get_by_text("lts-core-log-smoke-model", exact=False).first.wait_for()
    with page.expect_download() as error_download:
        error_dialog.get_by_role("button", name="Download").click()
    error_file = error_download.value
    if error_file.suggested_filename != error_name:
        raise AssertionError(
            f"Unexpected real Core error log download filename: {error_file.suggested_filename}"
        )
    if "lts-core-log-smoke-model" not in read_download_text(error_file):
        raise AssertionError("Real Core error log download did not contain the smoke request")
    seen.append("BROWSER real Core error log open download GET /v8/management/observability/logs/errors")
    error_dialog.get_by_role("button", name="Close").nth(1).click()

    set_core_config_booleans(api_url, {"request-log": True})
    seen.append("RESTORED real Core request-log true after logs smoke")
    return seen


def run_browser_smoke(
    app_url: str,
    api_url: str,
    headed: bool,
    include_plugin_store: bool,
    supports_plugin: bool,
    core_usage_version: int,
    logs_dir: Path,
    config_path: Path,
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
        ("/ai-providers/ampcode", "Configure Ampcode", None),
        # V8-only: legacy provider editors are removed; old links land on the Workbench.
        ("/lts/providers", "AI Providers", "/ai-providers"),
        ("/lts/ampcode", "Configure Ampcode", "/ai-providers/ampcode"),
        ("/ai-providers/legacy", "AI Providers", "/ai-providers"),
        ("/flow-control", "Flow", None),
        ("/logs", "Logs Viewer", None),
    ]
    if supports_plugin:
        route_checks.append(("/plugins", "Plugins", None))
    if supports_plugin and include_plugin_store:
        route_checks.append(("/plugin-store", "Plugin Store", None))

    seen: list[str] = []

    with sync_playwright() as playwright:
        browser = launch_chromium(playwright, headless=not headed)
        context = browser.new_context(locale="en-US", accept_downloads=True)
        context.add_init_script(
            """
            localStorage.setItem(
              'cli-proxy-language',
              JSON.stringify({ state: { language: 'en' }, version: 0 })
            );
            """
        )
        page = PanelBrowser(context.new_page())
        page.set_default_timeout(20_000)

        try:
            page.goto(f"{app_url}/#/login", wait_until="domcontentloaded")
            page.locator('input[name="cpa-management-key"]').wait_for()
            page.get_by_label("Custom Connection URL:").check(force=True)
            page.get_by_placeholder("Eg: https://example.com:8317").fill(api_url)
            page.locator('input[name="cpa-management-key"]').fill(MANAGEMENT_KEY)
            page.get_by_label("Remember password").check(force=True)
            page.get_by_role("button", name=re.compile(r"^(Login|Connect)$", re.I)).click()
            page.wait_for_url(re.compile(r".*/#/$"), timeout=30_000)
            seen.extend(run_browser_config_save_smoke(page, api_url, config_path))
            seen.extend(run_browser_flow_control_smoke(page, app_url, api_url))
            seen.extend(run_browser_provider_workbench_smoke(page, app_url, api_url, config_path))
            seen.extend(run_browser_real_core_logs_smoke(page, app_url, api_url, logs_dir))
            seen.append("BROWSER login against the real Core v8 Management API")

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
                if route == "/usage":
                    page.get_by_role("button", name="Show details here", exact=True).click()
                    events_card = page.get_by_text("Request Events", exact=True).locator(
                        "xpath=../.."
                    )
                    events_card.wait_for()
                    rows = events_card.locator("tbody tr")
                    expected_usage_rows = 4 if core_usage_version in {2, 3} else 3
                    if core_usage_version == 3:
                        expected_usage_rows += 1
                    for _ in range(50):
                        if rows.count() == expected_usage_rows:
                            break
                        page.wait_for_timeout(100)
                    if rows.count() != expected_usage_rows:
                        raise AssertionError(
                            "Real Core migration/tier fixtures rendered "
                            f"{rows.count()} rows, want {expected_usage_rows}"
                        )
                    events_card.get_by_role("columnheader", name="Upstream TTFB", exact=True).wait_for()
                    events_card.get_by_role(
                        "columnheader", name="First Text", exact=True
                    ).wait_for()
                    events_card.get_by_role("columnheader", name="First Reasoning", exact=True).wait_for()
                    events_card.get_by_role("columnheader", name="First Answer", exact=True).wait_for()
                    events_card.get_by_role("columnheader", name="Output TPS (estimate)", exact=True).wait_for()
                    events_card.locator(
                        'td[data-request-performance="ttfb"][data-ttfb-ms="40"]'
                    ).wait_for()
                    if core_usage_version == 3:
                        events_card.locator(
                            'td[data-request-performance="first-content"]'
                            '[data-first-content-ms="60"]'
                        ).wait_for()
                        events_card.locator(
                            'td[data-request-performance="ttft"][data-ttft-ms="60"]'
                        ).wait_for()
                        events_card.locator(
                            'td[data-request-performance="ttfa"][data-ttfa-ms="90"]'
                        ).wait_for()
                        events_card.locator('[data-performance-summary-key="output-tps"]').wait_for()
                        events_card.locator('[data-performance-summary-key="reasoning-ratio"]').wait_for()
                    resolved_fast_flows = events_card.locator(
                        '[data-service-tier-flow][aria-label*="Resolved: Fast"]'
                    )
                    resolved_fast_flows.first.wait_for()
                    if resolved_fast_flows.count() != 1:
                        raise AssertionError("Real Core effective priority did not render as Fast")
                    expected_std_rows = 3 if core_usage_version in {2, 3} else 2
                    if core_usage_version == 3:
                        expected_std_rows += 1
                    resolved_std_flows = events_card.locator(
                        '[data-service-tier-flow][aria-label*="Resolved: Std"]'
                    )
                    if resolved_std_flows.count() != expected_std_rows:
                        raise AssertionError(
                            "Real Core response standard/unknown tiers did not render as Std"
                        )
                    assumed_std_flows = events_card.locator(
                        '[data-service-tier-flow]'
                        '[aria-label*="Resolved: Std (evidence: assumed fallback)"]'
                    )
                    expected_assumed_std = 2 if core_usage_version in {2, 3} else 1
                    if core_usage_version == 3:
                        expected_assumed_std += 1
                    if assumed_std_flows.count() != expected_assumed_std:
                        raise AssertionError(
                            "Real Core migration/tier fixtures exposed "
                            f"{assumed_std_flows.count()} assumed Std flows, "
                            f"want {expected_assumed_std}"
                        )
                    assumed_std_flows.first.wait_for()
                    tier_select = events_card.get_by_label("Tier", exact=True)
                    tier_select.click()
                    page.get_by_role("option", name="Fast", exact=True).wait_for()
                    page.get_by_role("option", name="Std", exact=True).wait_for()
                    if page.get_by_role("option", name=re.compile("Priority|Other|Unknown", re.I)).count():
                        raise AssertionError("Real Core tier filter exposed more than Fast and Std")
                    page.keyboard.press("Escape")
                    seen.append("BROWSER real Core usage tiers render only Fast/Std with assumed evidence")
                elif route == "/usage/pricing":
                    pricing_summary = page.locator('[aria-label="Pricing coverage summary"]')
                    pricing_summary.wait_for()
                    page.locator(
                        '[data-testid="pricing-model-row"][data-model="gpt-5.4"]'
                    ).wait_for()
                    expected_priced_requests = "4 / 4 requests" if core_usage_version in {2, 3} else "3 / 3 requests"
                    if core_usage_version == 3:
                        expected_priced_requests = "5 / 5 requests"
                    pricing_summary.get_by_text(expected_priced_requests, exact=True).wait_for()
                    pricing_summary.get_by_text("100.0%", exact=True).first.wait_for()
                    seen.append(
                        "BROWSER real Core pricing route estimates every matched usage record locally"
                    )
                elif route == "/plugins":
                    seen.append("BROWSER real Core plugins page rendered")
                elif route == "/flow-control":
                    page.get_by_test_id("flow-control-settings").wait_for()
                    seen.append("BROWSER real Core Flow page rendered")
            # Seeded after the route checks so the usage page row counts above stay exact.
            seen.extend(run_browser_full_usage_status_smoke(page, app_url, api_url))
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
        help=(
            "Path to the CPA-Core-LTS v8 checkout (read only; built into a temp dir). "
            "Defaults to ../CPA-Core-LTS."
        ),
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
            seen, supports_plugin, core_usage_version = run_endpoint_smoke(
                runtime.api_url,
                include_plugin_store=args.include_plugin_store,
                include_write_smoke=not args.no_write_smoke,
                config_path=runtime.config_path,
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
                            core_usage_version=core_usage_version,
                            logs_dir=runtime.logs_dir,
                            config_path=runtime.config_path,
                        )
                    )

    for entry in seen:
        print(f"  {entry}")
    if CORE_DEFECTS:
        print("LTS panel real Core smoke found Core defects:", file=sys.stderr)
        for defect in CORE_DEFECTS:
            print(f"  CORE DEFECT: {defect}", file=sys.stderr)
        return 1
    print("LTS panel real Core smoke passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"LTS panel real Core smoke failed: {exc}", file=sys.stderr)
        if os.environ.get("DEBUG_SMOKE"):
            raise
        raise SystemExit(1)

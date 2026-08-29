#!/usr/bin/env python3
"""Query Codex OAuth quota through the CPA Core Management API."""

from __future__ import annotations

import argparse
import getpass
import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_CORE_URL = "http://127.0.0.1:8317"
MANAGEMENT_PATH = "/v0/management"
CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
CODEX_USER_AGENT = "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)"

EXIT_OK = 0
EXIT_QUERY_FAILED = 1
EXIT_CONFIGURATION_ERROR = 2
EXIT_NO_CREDENTIALS = 3
EXIT_INTERRUPTED = 130


class MonitorError(Exception):
    def __init__(self, message: str, exit_code: int, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.retryable = retryable


def nonnegative_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("必须是数字") from error
    if not math.isfinite(parsed) or parsed < 0:
        raise argparse.ArgumentTypeError("必须是大于或等于 0 的有限数字")
    return parsed


def positive_float(value: str) -> float:
    parsed = nonnegative_float(value)
    if parsed == 0:
        raise argparse.ArgumentTypeError("必须大于 0")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="通过 CPA Core Management API 查询已登录 Codex OAuth 账号的限额。",
        epilog=(
            "Management Key 优先级：--management-key > CPA_MANAGEMENT_KEY > 终端隐藏输入。"
            "默认单次查询；设置 --interval-seconds 可持续轮询。"
        ),
    )
    parser.add_argument(
        "--core-url",
        help=f"CPA Core 根地址；默认读取 CPA_CORE_URL，否则使用 {DEFAULT_CORE_URL}",
    )
    parser.add_argument(
        "--management-key",
        help=(
            "登录 CPA Panel 使用的明文 Management Key。定时任务建议使用 "
            "CPA_MANAGEMENT_KEY 环境变量。"
        ),
    )
    parser.add_argument(
        "--timeout-seconds",
        type=positive_float,
        default=30.0,
        metavar="SECONDS",
        help="每个 Management API 请求的超时秒数（默认：30）",
    )
    parser.add_argument(
        "--delay-seconds",
        type=nonnegative_float,
        default=0.6,
        metavar="SECONDS",
        help="多个 Codex 凭据之间的查询间隔（默认：0.6）",
    )
    parser.add_argument(
        "--interval-seconds",
        type=nonnegative_float,
        default=0.0,
        metavar="SECONDS",
        help="大于 0 时持续轮询；0 表示只查询一次（建议不低于 900 秒）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="每轮输出一行 JSON；默认输出适合人工阅读的摘要",
    )
    return parser


def resolve_management_base(core_url: str) -> str:
    value = core_url.strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise MonitorError(
            "--core-url 必须是完整的 http:// 或 https:// URL",
            EXIT_CONFIGURATION_ERROR,
        )
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise MonitorError(
            "--core-url 不能包含认证信息、query 或 fragment",
            EXIT_CONFIGURATION_ERROR,
        )
    return value if value.endswith(MANAGEMENT_PATH) else f"{value}{MANAGEMENT_PATH}"


def resolve_management_key(cli_value: str | None, environ: Mapping[str, str]) -> str:
    value = cli_value or environ.get("CPA_MANAGEMENT_KEY")
    if value is None and sys.stdin.isatty():
        value = getpass.getpass("Management Key: ")
    key = (value or "").strip()
    if not key:
        raise MonitorError(
            "缺少 Management Key；请传入 --management-key 或设置 CPA_MANAGEMENT_KEY",
            EXIT_CONFIGURATION_ERROR,
        )
    if "\r" in key or "\n" in key:
        raise MonitorError("Management Key 不能包含换行符", EXIT_CONFIGURATION_ERROR)
    return key


class ManagementClient:
    def __init__(self, base_url: str, management_key: str, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.management_key = management_key
        self.timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        payload: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.base_url}/{path.lstrip('/')}",
            data=body,
            method=method.upper(),
            headers={
                "Authorization": f"Bearer {self.management_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "CPA-Panel-LTS-Codex-Quota-Monitor/1.0",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except HTTPError as error:
            retryable = error.code == 429 or error.code >= 500
            raise MonitorError(
                f"Management API {method.upper()} {path} 返回 HTTP {error.code}",
                EXIT_CONFIGURATION_ERROR,
                retryable=retryable,
            ) from None
        except (URLError, TimeoutError) as error:
            reason = str(getattr(error, "reason", error)).strip() or "连接失败"
            raise MonitorError(
                f"无法连接 CPA Core：{reason}",
                EXIT_CONFIGURATION_ERROR,
                retryable=True,
            ) from None

        try:
            decoded = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise MonitorError(
                f"Management API {method.upper()} {path} 返回了无效 JSON",
                EXIT_CONFIGURATION_ERROR,
            ) from None
        if not isinstance(decoded, dict):
            raise MonitorError(
                f"Management API {method.upper()} {path} 返回值不是 JSON object",
                EXIT_CONFIGURATION_ERROR,
            )
        return decoded


def pick(record: Mapping[str, Any] | None, snake: str, camel: str) -> Any:
    if not isinstance(record, Mapping):
        return None
    value = record.get(snake)
    return value if value is not None else record.get(camel)


def clean_string(value: Any) -> str | None:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    cleaned = " ".join(str(value).split())
    return cleaned or None


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0
    return None


def discover_codex_credentials(client: ManagementClient) -> list[dict[str, str | None]]:
    files = client.request("GET", "/auth-files").get("files")
    if not isinstance(files, list):
        raise MonitorError("/auth-files 响应缺少 files array", EXIT_CONFIGURATION_ERROR)

    credentials: list[dict[str, str | None]] = []
    for item in files:
        if not isinstance(item, Mapping):
            continue
        provider = clean_string(item.get("provider") or item.get("type"))
        if not provider or provider.lower().replace("_", "-") != "codex":
            continue
        if boolean(item.get("disabled")) is True:
            continue
        auth_index = clean_string(pick(item, "auth_index", "authIndex"))
        if not auth_index:
            continue

        account_id = None
        claims = item.get("id_token")
        if isinstance(claims, Mapping):
            account_id = clean_string(pick(claims, "chatgpt_account_id", "chatgptAccountId"))
        credentials.append(
            {
                "name": clean_string(item.get("name") or item.get("id")) or f"codex-{auth_index}",
                "auth_index": auth_index,
                "account_id": account_id,
            }
        )
    return credentials


def query_usage(client: ManagementClient, credential: Mapping[str, str | None]) -> dict[str, Any]:
    upstream_headers = {
        "Accept": "application/json",
        # Core replaces this literal placeholder using auth_index.
        "Authorization": "Bearer $TOKEN$",
        "Content-Type": "application/json",
        "User-Agent": CODEX_USER_AGENT,
    }
    if credential.get("account_id"):
        upstream_headers["Chatgpt-Account-Id"] = str(credential["account_id"])

    envelope = client.request(
        "POST",
        "/api-call",
        {
            "auth_index": credential["auth_index"],
            "method": "GET",
            "url": CODEX_USAGE_URL,
            "header": upstream_headers,
        },
    )
    status_value = number(envelope.get("status_code"))
    status = int(status_value) if status_value is not None else 0
    if status < 200 or status >= 300:
        raise MonitorError(f"ChatGPT quota 接口返回 HTTP {status}", EXIT_QUERY_FAILED)

    payload = envelope.get("body")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            raise MonitorError("ChatGPT quota 接口返回了无效 JSON", EXIT_QUERY_FAILED) from None
    if not isinstance(payload, dict):
        raise MonitorError("ChatGPT quota 接口返回值不是 JSON object", EXIT_QUERY_FAILED)
    return payload


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def reset_time(window: Mapping[str, Any], checked_at: datetime) -> str | None:
    reset_at = number(pick(window, "reset_at", "resetAt"))
    if reset_at is not None and reset_at > 0:
        seconds = reset_at / 1000 if reset_at > 1e12 else reset_at
        try:
            return iso_utc(datetime.fromtimestamp(seconds, tz=timezone.utc))
        except (OverflowError, OSError, ValueError):
            return None
    reset_after = number(pick(window, "reset_after_seconds", "resetAfterSeconds"))
    if reset_after is not None and reset_after > 0:
        return iso_utc(checked_at + timedelta(seconds=reset_after))
    return None


def window_name(window: Mapping[str, Any], position: str) -> str:
    seconds = number(pick(window, "limit_window_seconds", "limitWindowSeconds"))
    if seconds == 18_000:
        return "five-hour"
    if seconds == 604_800:
        return "weekly"
    if seconds is not None and 28 * 86_400 <= seconds <= 31 * 86_400:
        return "monthly"
    return position


def summarize_limit(
    limit: Mapping[str, Any],
    name: str,
    checked_at: datetime,
) -> dict[str, Any]:
    allowed = boolean(limit.get("allowed"))
    limit_reached = boolean(pick(limit, "limit_reached", "limitReached"))
    exhausted = allowed is False or limit_reached is True
    windows: list[dict[str, Any]] = []
    for position, snake, camel in (
        ("primary", "primary_window", "primaryWindow"),
        ("secondary", "secondary_window", "secondaryWindow"),
    ):
        window = pick(limit, snake, camel)
        if not isinstance(window, Mapping):
            continue
        used = number(pick(window, "used_percent", "usedPercent"))
        reset_at = reset_time(window, checked_at)
        if used is None and exhausted and reset_at:
            used = 100.0
        remaining = None if used is None else round(100 - max(0.0, min(100.0, used)), 2)
        windows.append(
            {
                "name": window_name(window, position),
                "used_percent": None if used is None else round(used, 2),
                "remaining_percent": remaining,
                "reset_at": reset_at,
            }
        )
    return {
        "name": name,
        "allowed": allowed,
        "limit_reached": limit_reached,
        "windows": windows,
    }


def summarize_usage(
    credential: Mapping[str, str | None],
    payload: Mapping[str, Any],
    checked_at: datetime,
) -> dict[str, Any]:
    limits: list[dict[str, Any]] = []
    main_limit = pick(payload, "rate_limit", "rateLimit")
    if isinstance(main_limit, Mapping):
        limits.append(summarize_limit(main_limit, "Codex", checked_at))

    code_review = pick(payload, "code_review_rate_limit", "codeReviewRateLimit")
    if isinstance(code_review, Mapping):
        limits.append(summarize_limit(code_review, "Code Review", checked_at))

    additional = pick(payload, "additional_rate_limits", "additionalRateLimits")
    if isinstance(additional, list):
        for index, item in enumerate(additional, start=1):
            if not isinstance(item, Mapping):
                continue
            item_limit = pick(item, "rate_limit", "rateLimit")
            if not isinstance(item_limit, Mapping):
                continue
            name = (
                clean_string(pick(item, "limit_name", "limitName"))
                or clean_string(pick(item, "metered_feature", "meteredFeature"))
                or f"Additional {index}"
            )
            limits.append(summarize_limit(item_limit, name, checked_at))

    reset_credits = pick(payload, "rate_limit_reset_credits", "rateLimitResetCredits")
    reset_count = None
    if isinstance(reset_credits, Mapping):
        count = number(pick(reset_credits, "available_count", "availableCount"))
        reset_count = int(count) if count is not None else None

    return {
        "credential": credential["name"],
        "auth_index": credential["auth_index"],
        "plan_type": clean_string(pick(payload, "plan_type", "planType")),
        "reset_credits_available": reset_count,
        "limits": limits,
    }


def collect_report(client: ManagementClient, delay_seconds: float) -> tuple[dict[str, Any], int]:
    checked_at = datetime.now(timezone.utc)
    credentials = discover_codex_credentials(client)
    if not credentials:
        raise MonitorError(
            "未发现带 auth_index 的已启用 Codex OAuth 凭据",
            EXIT_NO_CREDENTIALS,
            retryable=True,
        )

    results: list[dict[str, Any]] = []
    errors: list[dict[str, str | None]] = []
    for index, credential in enumerate(credentials):
        if index and delay_seconds:
            time.sleep(delay_seconds)
        try:
            results.append(summarize_usage(credential, query_usage(client, credential), checked_at))
        except MonitorError as error:
            errors.append(
                {
                    "credential": credential["name"],
                    "auth_index": credential["auth_index"],
                    "message": str(error),
                }
            )

    report = {
        "checked_at": iso_utc(checked_at),
        "status": "ok" if not errors else "partial" if results else "error",
        "credential_count": len(credentials),
        "credentials": results,
        "errors": errors,
    }
    return report, EXIT_OK if not errors else EXIT_QUERY_FAILED


def render_text(report: Mapping[str, Any]) -> str:
    lines = [f"[{report['checked_at']}] Codex quota：{report['status']}"]
    for credential in report["credentials"]:
        plan = credential["plan_type"] or "unknown"
        lines.append(f"{credential['credential']}  plan={plan}")
        if credential["reset_credits_available"] is not None:
            lines.append(f"  reset credits：{credential['reset_credits_available']}")
        for limit in credential["limits"]:
            states = []
            if limit["allowed"] is not None:
                states.append(f"allowed={str(limit['allowed']).lower()}")
            if limit["limit_reached"] is not None:
                states.append(f"limit_reached={str(limit['limit_reached']).lower()}")
            state_label = f" ({', '.join(states)})" if states else ""
            lines.append(f"  {limit['name']}{state_label}")
            for window in limit["windows"]:
                remaining = window["remaining_percent"]
                remaining_label = "--" if remaining is None else f"{remaining:g}%"
                lines.append(
                    f"    {window['name']}：剩余 {remaining_label}，重置 {window['reset_at'] or '-'}"
                )
    for error in report["errors"]:
        lines.append(f"ERROR {error['credential']}：{error['message']}")
    return "\n".join(lines)


def emit_report(report: Mapping[str, Any], json_output: bool) -> None:
    if json_output:
        print(json.dumps(report, ensure_ascii=False, separators=(",", ":")), flush=True)
    else:
        print(render_text(report), flush=True)


def emit_error(error: MonitorError, json_output: bool) -> None:
    if json_output:
        print(
            json.dumps(
                {
                    "checked_at": iso_utc(datetime.now(timezone.utc)),
                    "status": "error",
                    "credential_count": 0,
                    "credentials": [],
                    "errors": [{"credential": None, "auth_index": None, "message": str(error)}],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            flush=True,
        )
    else:
        print(f"ERROR：{error}", file=sys.stderr, flush=True)


def main(argv: Sequence[str] | None = None, environ: Mapping[str, str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    env = os.environ if environ is None else environ
    try:
        core_url = args.core_url or env.get("CPA_CORE_URL") or DEFAULT_CORE_URL
        management_base = resolve_management_base(core_url)
        management_key = resolve_management_key(args.management_key, env)
    except MonitorError as error:
        emit_error(error, args.json)
        return error.exit_code

    client = ManagementClient(management_base, management_key, args.timeout_seconds)
    last_exit_code = EXIT_OK
    while True:
        try:
            report, last_exit_code = collect_report(client, args.delay_seconds)
            emit_report(report, args.json)
        except MonitorError as error:
            last_exit_code = error.exit_code
            emit_error(error, args.json)
            if args.interval_seconds <= 0 or not error.retryable:
                return last_exit_code

        if args.interval_seconds <= 0:
            return last_exit_code
        try:
            time.sleep(args.interval_seconds)
        except KeyboardInterrupt:
            return EXIT_INTERRUPTED


if __name__ == "__main__":
    raise SystemExit(main())

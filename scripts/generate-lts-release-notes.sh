#!/usr/bin/env bash
# Generate scannable GitHub release notes for a CPA LTS tag.
# Previous TLS tag discovery only considers v*-tls-* refs, never upstream v7.* / v1.8.* tags.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/generate-lts-release-notes.sh --product core|panel --tag v1-tls-X.Y.Z [options]

Options:
  --product core|panel   Required. Selects companion repo and asset section.
  --tag TAG              Required. Existing v*-tls-* tag.
  --repo OWNER/NAME      Override GitHub repo. Defaults from --product.
  --companion OWNER/NAME Override companion repo. Defaults from --product.
  --notes-file PATH      Write notes to PATH instead of stdout.
  --title-file PATH      Write the release title to PATH.
  -h, --help             Show this help.
EOF
}

product=""
tag=""
repo=""
companion=""
notes_file=""
title_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --product)
      product="${2:-}"
      shift 2
      ;;
    --tag)
      tag="${2:-}"
      shift 2
      ;;
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --companion)
      companion="${2:-}"
      shift 2
      ;;
    --notes-file)
      notes_file="${2:-}"
      shift 2
      ;;
    --title-file)
      title_file="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$product" || -z "$tag" ]]; then
  echo "--product and --tag are required" >&2
  usage >&2
  exit 2
fi

case "$product" in
  core)
    repo="${repo:-${GH_REPO:-BlueSkyXN/CPA-Core-LTS}}"
    companion="${companion:-BlueSkyXN/CPA-Panel-LTS}"
    companion_label="CPA-Panel-LTS"
    ;;
  panel)
    repo="${repo:-${GH_REPO:-BlueSkyXN/CPA-Panel-LTS}}"
    companion="${companion:-BlueSkyXN/CPA-Core-LTS}"
    companion_label="CPA-Core-LTS"
    ;;
  *)
    echo "--product must be core or panel" >&2
    exit 2
    ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

if [[ "$tag" != v*-tls-* ]]; then
  echo "Only LTS release tags matching v*-tls-* are supported: $tag" >&2
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  echo "Release tag ${tag} does not exist in this checkout." >&2
  exit 1
fi

previous_tls_tag() {
  local current="$1"
  local candidate
  while IFS= read -r candidate; do
    [[ -z "$candidate" || "$candidate" == "$current" ]] && continue
    if git merge-base --is-ancestor "$candidate" "$current" 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(git tag --list 'v*-tls-*' --sort=-v:refname)
  return 1
}

tag_subject() {
  local current="$1"
  local subject
  subject="$(git tag --list --format='%(contents:subject)' "$current" | sed -n '1p')"
  printf '%s' "$subject"
}

is_placeholder_subject() {
  local subject="$1"
  local current="$2"
  local compact tagcompact
  compact="$(printf '%s' "$subject" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:][:punct:]')"
  tagcompact="$(printf '%s' "$current" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:][:punct:]')"
  if [[ -z "$compact" ]]; then
    return 0
  fi
  if [[ "$compact" == "$tagcompact" ]]; then
    return 0
  fi
  if [[ ${#subject} -le 48 && "$compact" == *"$tagcompact"* ]]; then
    return 0
  fi
  return 1
}

brief_first_parent_line() {
  local subject="$1"
  local pr rest
  if [[ "$subject" == "Merge pull request #"* ]]; then
    pr="$(printf '%s' "$subject" | sed -n 's/^Merge pull request \(#[0-9][0-9]*\).*/\1/p')"
    rest="$(printf '%s' "$subject" | sed -n 's/^Merge pull request #[0-9][0-9]* from [^/]*\///p')"
    if [[ -n "$pr" && -n "$rest" ]]; then
      printf '%s — %s\n' "$pr" "$rest"
      return 0
    fi
  fi
  printf '%s\n' "$subject"
}

iso_from_tag() {
  local current="$1"
  git for-each-ref --format='%(creatordate:iso-strict)' "refs/tags/${current}" | sed -n '1p'
}

normalize_iso() {
  local raw="$1"
  python3 -c 'import sys
from datetime import datetime, timezone
raw = sys.argv[1].strip()
if not raw:
    raise SystemExit(1)
text = raw.replace("Z", "+00:00")
dt = datetime.fromisoformat(text)
if dt.tzinfo is None:
    dt = dt.replace(tzinfo=timezone.utc)
print(dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
' "$raw"
}

companion_choice() {
  local companion_repo="$1"
  local current_iso="$2"
  if [[ -z "$current_iso" ]]; then
    return 1
  fi
  if ! command -v gh >/dev/null 2>&1; then
    return 1
  fi
  local payload
  if ! payload="$(gh release list --repo "$companion_repo" --limit 30 --json tagName,publishedAt 2>/dev/null)"; then
    return 1
  fi
  python3 -c 'import json, sys
from datetime import datetime, timezone

def parse(value):
    text = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

current = parse(sys.argv[1])
releases = json.loads(sys.argv[2])
eligible = []
for item in releases:
    published = item.get("publishedAt") or ""
    tag_name = item.get("tagName") or ""
    if not published or not tag_name:
        continue
    dt = parse(published)
    if dt.timestamp() <= current.timestamp() + 7200:
        eligible.append((dt, tag_name, published))
if not eligible:
    raise SystemExit(1)
eligible.sort(key=lambda row: row[0], reverse=True)
chosen = eligible[0]
delta = abs((chosen[0] - current).total_seconds())
kind = "paired" if delta <= 36 * 3600 else "latest"
print(f"{chosen[1]}\t{kind}\t{chosen[2]}")
' "$current_iso" "$payload"
}

core_asset_section() {
  cat <<'EOF'
<!-- cliproxyapi-linux-release-assets:start -->
## 发布资产

- `CLIProxyAPI_<version>_linux_<arch>.tar.gz` 是默认 Linux 构建，支持动态库插件，GLIBC 基线为 2.17。
- `CLIProxyAPI_<version>_linux_<arch>_no-plugin.tar.gz` 是面向 musl / OpenWrt 等环境的便携构建，不支持动态库插件。
- `sky-cpa-core-lts_<version>_linux_<arch>.tar.gz` 与 `sky-cpa-core-lts_<version>_linux_<arch>_no-plugin.tar.gz` 使用同一套 Core 代码和平台矩阵，只是二进制名和产品横幅为 `sky-cpa-core-lts`，供 CPA-HFS 使用。

### FreeBSD

- `CLIProxyAPI_<version>_freebsd_aarch64_no-plugin.tar.gz` 是 FreeBSD arm64 构建，关闭 CGO，不支持动态库插件。

<!-- cliproxyapi-linux-release-assets:end -->
EOF
}

panel_asset_section() {
  cat <<'EOF'
## 发布资产

- `management.html`：单文件管理面板，供 `CPA-Core-LTS` 按资产名下载。
EOF
}

previous=""
if previous="$(previous_tls_tag "$tag")"; then
  range="${previous}..${tag}"
else
  previous=""
  range="$tag"
fi

subject="$(tag_subject "$tag")"
highlights_file="$(mktemp)"
briefs_file="$(mktemp)"
generated_file="$(mktemp)"
trap 'rm -f "$highlights_file" "$briefs_file" "$generated_file"' EXIT

if [[ -n "$previous" ]]; then
  git log --first-parent --reverse --pretty=format:'%s' "$range" > "$highlights_file" || true
else
  : > "$highlights_file"
fi

while IFS= read -r line || [[ -n "${line:-}" ]]; do
  [[ -z "$line" ]] && continue
  brief_first_parent_line "$line" >> "$briefs_file"
done < "$highlights_file"

if command -v gh >/dev/null 2>&1; then
  generate_args=(api "repos/${repo}/releases/generate-notes" -f "tag_name=${tag}")
  if [[ -n "$previous" ]]; then
    generate_args+=(-f "previous_tag_name=${previous}")
  fi
  gh "${generate_args[@]}" --jq .body > "$generated_file" 2>/dev/null || true
fi
if [[ ! -s "$generated_file" ]]; then
  if [[ -n "$previous" ]]; then
    printf '**完整变更**: https://github.com/%s/compare/%s...%s\n' "$repo" "$previous" "$tag" > "$generated_file"
  else
    printf '**完整变更**: https://github.com/%s/commits/%s\n' "$repo" "$tag" > "$generated_file"
  fi
fi

summary_from_generated_notes() {
  python3 -c 'import re, sys
text = sys.stdin.read()
titles = []
for line in text.splitlines():
    match = re.match(r"^\* (.+?) by @", line)
    if match:
        titles.append(match.group(1).strip())
print("；".join(titles[:3]))
'
}

summary="$subject"
if is_placeholder_subject "$subject" "$tag"; then
  summary=""
  if [[ -s "$generated_file" ]]; then
    summary="$(summary_from_generated_notes < "$generated_file")"
  fi
  if [[ -z "$summary" && -s "$briefs_file" ]]; then
    summary="$(sed -n '1,3p' "$briefs_file" | paste -sd '；' -)"
  fi
fi
if [[ -z "$summary" ]]; then
  summary="${tag}"
fi

title="$tag"
if [[ "$summary" != "$tag" ]]; then
  short_summary="$(printf '%s' "$summary" | python3 -c 'import sys
text = sys.stdin.read().strip()
limit = 140
if len(text) <= limit:
    print(text)
    raise SystemExit
cut = text[:limit]
for sep in ("；", ";", ",", "，", " "):
    idx = cut.rfind(sep)
    if idx >= 48:
        cut = cut[:idx].rstrip("；;,， ")
        break
print(cut + "...")
')"
  title="${tag} — ${short_summary}"
fi

current_iso=""
if raw_iso="$(iso_from_tag "$tag")"; then
  current_iso="$(normalize_iso "$raw_iso" || true)"
fi
if [[ -z "$current_iso" ]] && command -v gh >/dev/null 2>&1; then
  published="$(gh release view "$tag" --repo "$repo" --json publishedAt --jq .publishedAt 2>/dev/null || true)"
  if [[ -n "$published" ]]; then
    current_iso="$(normalize_iso "$published" || true)"
  fi
fi

companion_tag=""
companion_kind=""
if companion_row="$(companion_choice "$companion" "$current_iso" 2>/dev/null)"; then
  companion_tag="$(printf '%s' "$companion_row" | awk -F '\t' 'NR==1{print $1}')"
  companion_kind="$(printf '%s' "$companion_row" | awk -F '\t' 'NR==1{print $2}')"
fi

notes_tmp="$(mktemp)"
{
  printf '## 摘要\n\n%s\n\n' "$summary"

  printf '## 配套版本\n\n'
  if [[ -n "$companion_tag" ]]; then
    if [[ "$companion_kind" == "paired" ]]; then
      printf -- '- 同期配套 %s：[%s](https://github.com/%s/releases/tag/%s)\n\n' \
        "$companion_label" "$companion_tag" "$companion" "$companion_tag"
    else
      printf -- '- 发布时可用的 %s Latest：[%s](https://github.com/%s/releases/tag/%s)\n\n' \
        "$companion_label" "$companion_tag" "$companion" "$companion_tag"
    fi
  else
    printf -- '- 配套 %s：未能从 GitHub 解析同期 Release，请按发布当天的 Latest 核对。\n\n' "$companion_label"
  fi

  printf '## 本版要点\n\n'
  if [[ -s "$briefs_file" ]]; then
    while IFS= read -r brief || [[ -n "${brief:-}" ]]; do
      [[ -z "$brief" ]] && continue
      printf -- '- %s\n' "$brief"
    done < "$briefs_file"
    printf '\n'
  else
    printf -- '- 本 tag 没有可列出的 first-parent 变更。\n\n'
  fi

  if [[ "$product" == "core" ]]; then
    core_asset_section
    printf '\n'
  else
    panel_asset_section
    printf '\n'
  fi

  cat "$generated_file"
  printf '\n'
} > "$notes_tmp"

if [[ -n "$title_file" ]]; then
  printf '%s\n' "$title" > "$title_file"
fi

if [[ -n "$notes_file" ]]; then
  cat "$notes_tmp" > "$notes_file"
else
  cat "$notes_tmp"
fi
rm -f "$notes_tmp"

#!/usr/bin/env bash
# Generate a CPA-Panel-LTS Release body from an authoritative annotated tag.
set -euo pipefail

DEFAULT_REPO="BlueSkyXN/CPA-Panel-LTS"
COMPANION_LABEL="CPA-Core-LTS"
DEFAULT_COMPANION_REPO="BlueSkyXN/CPA-Core-LTS"
COMPANION_TRAILER="Companion-Core"

usage() {
  cat <<'EOF'
Usage: scripts/generate-lts-release-notes.sh --tag v1-lts-X.Y.Z [options]

The tag must be annotated. Its subject is the user-facing summary and its body
must contain exactly one companion trailer, for example:

  Panel LTS: upstream intake and retained LTS fixes

  Companion-Core: v1-lts-0.0.20

Options:
  --tag TAG                   Required. Existing annotated v*-lts-* tag.
  --repo OWNER/NAME           Override the Panel repository.
  --companion-repo OWNER/NAME Override the Core repository.
  --notes-file PATH           Write notes to PATH instead of stdout.
  --title-file PATH           Write the release title to PATH.
  -h, --help                  Show this help.
EOF
}

tag=""
repo="${GH_REPO:-$DEFAULT_REPO}"
companion_repo="$DEFAULT_COMPANION_REPO"
notes_file=""
title_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      tag="${2:-}"
      shift 2
      ;;
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --companion-repo)
      companion_repo="${2:-}"
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

if [[ -z "$tag" ]]; then
  echo "--tag is required" >&2
  usage >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
cd "$REPO_ROOT"

if [[ "$tag" != v*-lts-* ]]; then
  echo "Only Panel LTS release tags matching v*-lts-* are supported: $tag" >&2
  exit 1
fi

tag_ref="refs/tags/${tag}"
if ! git rev-parse -q --verify "$tag_ref" >/dev/null; then
  echo "Release tag ${tag} does not exist in this checkout." >&2
  exit 1
fi
if [[ "$(git cat-file -t "$tag_ref" 2>/dev/null || true)" != "tag" ]]; then
  echo "Release tag ${tag} must be an annotated tag." >&2
  exit 1
fi

tag_message="$(git for-each-ref --format='%(contents)' "$tag_ref")"
summary="$(git for-each-ref --format='%(contents:subject)' "$tag_ref" | sed -n '1p')"

is_placeholder_summary() {
  local candidate="$1"
  local current="$2"
  local compact tag_compact
  compact="$(printf '%s' "$candidate" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:][:punct:]')"
  tag_compact="$(printf '%s' "$current" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:][:punct:]')"
  [[ -z "$compact" || "$compact" == "$tag_compact" || \
    ( ${#candidate} -le 48 && "$compact" == *"$tag_compact"* ) ]]
}

if is_placeholder_summary "$summary" "$tag"; then
  echo "warning: tag ${tag} has a placeholder summary; using generic title." >&2
  summary="CPA Panel LTS ${tag}"
fi

companion_lines="$(
  printf '%s\n' "$tag_message" |
    sed -n "s/^${COMPANION_TRAILER}:[[:space:]]*//p" |
    sed 's/[[:space:]]*$//'
)"
companion_count="$(printf '%s\n' "$companion_lines" | awk 'NF { count++ } END { print count + 0 }')"
companion_tag=""
if [[ "$companion_count" -eq 1 ]]; then
  companion_tag="$(printf '%s\n' "$companion_lines" | sed -n '1p')"
  if [[ "$companion_tag" != v*-lts-* ]]; then
    echo "warning: ${COMPANION_TRAILER} value does not match v*-lts-*: ${companion_tag}; skipping companion." >&2
    companion_tag=""
  fi
else
  echo "warning: tag ${tag} has ${companion_count} ${COMPANION_TRAILER} trailers (expected 1); skipping companion." >&2
fi

previous_lts_tag() {
  local current="$1"
  local candidate
  while IFS= read -r candidate; do
    [[ -z "$candidate" || "$candidate" == "$current" ]] && continue
    if git merge-base --is-ancestor "$candidate" "$current" 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(git tag --list 'v*-lts-*' --sort=-v:refname)
  return 1
}

previous=""
if previous="$(previous_lts_tag "$tag")"; then
  :
else
  previous=""
fi

generated_file="$(mktemp)"
notes_tmp="$(mktemp)"
trap 'rm -f "$generated_file" "$notes_tmp"' EXIT

if command -v gh >/dev/null 2>&1; then
  generate_args=(api "repos/${repo}/releases/generate-notes" -f "tag_name=${tag}")
  if [[ -n "$previous" ]]; then
    generate_args+=(-f "previous_tag_name=${previous}")
  fi
  gh "${generate_args[@]}" --jq .body >"$generated_file" 2>/dev/null || true
fi
if [[ ! -s "$generated_file" ]]; then
  if [[ -n "$previous" ]]; then
    printf '**完整变更**: https://github.com/%s/compare/%s...%s\n' \
      "$repo" "$previous" "$tag" >"$generated_file"
  else
    printf '**完整变更**: https://github.com/%s/commits/%s\n' \
      "$repo" "$tag" >"$generated_file"
  fi
fi

short_summary="$(printf '%s' "$summary" | python3 -c 'import sys
text = sys.stdin.read().strip()
limit = 140
if len(text) <= limit:
    print(text)
    raise SystemExit
cut = text[:limit]
for sep in ("；", ";", ",", "，", " "):
    index = cut.rfind(sep)
    if index >= 48:
        cut = cut[:index].rstrip("；;,， ")
        break
print(cut + "...")
')"
title="${tag} — ${short_summary}"

{
  printf '## 摘要\n\n%s\n\n' "$summary"
  if [[ -n "$companion_tag" ]]; then
    printf '## 配套版本\n\n'
    printf -- '- 配套 %s：[%s](https://github.com/%s/releases/tag/%s)\n\n' \
      "$COMPANION_LABEL" "$companion_tag" "$companion_repo" "$companion_tag"
  fi

  cat <<'EOF'
## 发布资产

- `management.html`：单文件管理面板，供 `CPA-Core-LTS` 按资产名下载。

EOF
  cat "$generated_file"
  printf '\n'
} >"$notes_tmp"

if [[ -n "$title_file" ]]; then
  printf '%s\n' "$title" >"$title_file"
fi
if [[ -n "$notes_file" ]]; then
  cat "$notes_tmp" >"$notes_file"
else
  cat "$notes_tmp"
fi

# scripts navigation card

Public helper scripts for this repository. Read this card before editing `scripts/codex-quota-compass.user.js`, especially metadata, ChatGPT quota requests, token handling, and exported JSON behavior.

Key file: `scripts/codex-quota-compass.user.js`.

## Local invariants

- The userscript is published from `main` via raw GitHub URLs in its metadata. Keep `@downloadURL` and `@updateURL` aligned with the intended public path.
- `@match` is intentionally scoped to `https://chatgpt.com/codex/cloud*`.
- `CONFIG.MANUAL_ACCESS_TOKEN` must stay empty in committed files.
- The script must not print access tokens, id tokens, refresh tokens, raw `/usage` responses, or raw analytics responses.
- Quota reads currently use `/backend-api/wham/usage`, `/backend-api/wham/rate-limit-reset-credits`, `/backend-api/wham/analytics/daily-workspace-usage-counts`, `/backend-api/wham/analytics/usage-leaderboard`, and `/backend-api/me`; verify endpoint semantics before changing parsers or estimates.

## Local rules

- If publishing a behavior change, update `@version` deliberately.
- Keep the script dependency-free unless the userscript metadata and target environment are updated to support the dependency.
- Exported JSON should contain useful quota/analytics summaries, not credentials or raw account tokens.
- When changing UI text in the userscript, remember it is standalone JavaScript and is not covered by `src/i18n/`.

## Do not

- Do not hardcode a personal access token, ChatGPT token, management key, or account id.
- Do not broaden `@grant` or `@match` without explaining the new browser capability or site scope.
- Do not persist access tokens in localStorage/sessionStorage.
- Do not treat the main app build as proof that this userscript works.

## Validation

There is no package script that fully validates this userscript. If no browser/Tampermonkey smoke test was run, say so in the final report.

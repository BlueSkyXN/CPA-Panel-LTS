# CPA Panel LTS

CPA Panel LTS is the long-term-maintained management panel for `CPA-Core-LTS`.

It is a single-file Web UI (React + TypeScript) for operating and troubleshooting the **CLI Proxy API / CPA Core LTS** via its **Management API** (config, credentials, logs, quota, and usage statistics).

[中文文档](README_CN.md)

- **LTS Core Project**: https://github.com/BlueSkyXN/CPA-Core-LTS
- **Original Upstream Core**: https://github.com/router-for-me/CLIProxyAPI
- **Original Upstream Panel**: https://github.com/router-for-me/Cli-Proxy-API-Management-Center
- **Example URL**: http://localhost:8317/management.html
- **LTS Baseline**: panel `v1.8.4` paired with core `v6.9.49`
- **Core integration**: latest release publishes `management.html` for `CPA-Core-LTS`

## LTS Plan

This repository exists to keep the full usage statistics UI after upstream changed the management panel to rely on lighter recent-request/API-key usage data.

Baseline facts:

- Panel baseline: `v1.8.4`
- Panel baseline commit: `8ed837c3d734c3970a6d6799c557bb6a6753360d`
- Core baseline: `CPA-Core-LTS` based on `CLIProxyAPI v6.9.49`
- `v1.9.3` still contains the full usage statistics implementation, but `v1.8.4` is the later tag and the last tagged panel version before the removal path.
- The upstream removal path starts after this baseline: `b25f722` switches provider usage tracking to recent requests, and `632be0b` removes `src/components/usage/*`, `src/pages/UsagePage.tsx`, `src/services/api/usage.ts`, `src/stores/useUsageStatsStore.ts`, and related usage utilities.

Maintenance rules:

- `main` is the LTS line. Do not create a separate long-lived statistics branch.
- Preserve the `/usage` page, usage charts, request events table, model/API/credential breakdowns, export/import, and local model price settings.
- Keep compatibility with `CPA-Core-LTS` Management API usage endpoints.
- Track upstream UI fixes selectively, but do not blindly sync upstream if the change removes or weakens full statistics.
- Planned cleanup can remove promotional copy, unused UI surfaces, and non-LTS release machinery, but must not break the usage statistics contract.

Since version 6.0.19, the Web UI ships with the main program; access it via `/management.html` on the API port once the service is running. `CPA-Core-LTS` downloads the latest release asset named `management.html` from this repository by default.

## What this is (and isn’t)

- This repository is the Web UI only. It talks to the CPA Core LTS / CLI Proxy API **Management API** (`/v0/management`) to read/update config, upload credentials, view logs, and inspect usage.
- It is **not** a proxy and does not forward traffic.

## Quick start

### Option A: Use the Web UI bundled in CLI Proxy API (recommended)

1. Start your CLI Proxy API service.
2. Open: `http://<host>:<api_port>/management.html`
3. Enter your **management key** and connect.

The address is auto-detected from the current page URL; manual override is supported.

### Option B: Run the dev server

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, then connect to your CLI Proxy API backend instance.

### Option C: Build a single HTML file

```bash
npm install
npm run build
```

- Output: `dist/index.html` (all assets are inlined).
- For CLI Proxy API bundling, the release workflow renames it to `management.html`.
- `CPA-Core-LTS` expects the latest release to contain an asset named exactly `management.html`.
- To preview locally: `npm run preview`

Tip: opening `dist/index.html` via `file://` may be blocked by browser CORS; serving it (preview/static server) is more reliable.

## Connecting to the server

### API address

You can enter any of the following; the UI will normalize it:

- `localhost:8317`
- `http://192.168.1.10:8317`
- `https://example.com:8317`
- `http://example.com:8317/v0/management` (also accepted; the suffix is removed internally)

### Management key (not the same as API keys)

The management key is sent with every request as:

- `Authorization: Bearer <MANAGEMENT_KEY>` (default)

This is different from the proxy `api-keys` you manage inside the UI (those are for client requests to the proxy endpoints).

### Remote management

If you connect from a non-localhost browser, the server must allow remote management (e.g. `allow-remote-management: true`).  
See `api.md` for the full authentication rules, server-side limits, and edge cases.

## What you can manage (mapped to the UI pages)

- **Dashboard**: connection status, server version/build date, quick counts, model availability snapshot.
- **Basic Settings**: debug, proxy URL, request retry, quota fallback (switch project or preview models when limits reached), usage statistics, request logging, file logging, WebSocket auth.
- **API Keys**: manage proxy `api-keys` (add/edit/delete).
- **AI Providers**:
  - Gemini/Codex/Claude/Vertex key entries (base URL, headers, proxy, model aliases, excluded models, prefix).
  - OpenAI-compatible providers (multiple API keys, custom headers, model alias import via `/v1/models`, optional browser-side "chat/completions" test).
  - Ampcode integration (upstream URL/key, force mappings, model mapping table).
- **Auth Files**: upload/download/delete JSON credentials, filter/search/pagination, runtime-only indicators, view supported models per credential (when the server supports it), manage OAuth excluded models (supports `*` wildcards), configure OAuth model alias mappings.
- **OAuth**: start OAuth/device flows for supported providers, poll status, optionally submit callback `redirect_url`; includes iFlow cookie import.
- **Quota Management**: manage quota limits and usage for Claude, Antigravity, Codex, Gemini CLI, and other providers.
- **Usage**: requests/tokens charts (hour/day), per-API & per-model breakdown, cached/reasoning token breakdown, RPM/TPM window, optional cost estimation with locally-saved model pricing.
- **Config**: edit `/config.yaml` in-browser with YAML highlighting + search, then save/reload.
- **Logs**: tail logs with incremental polling, auto-refresh, search, hide management traffic, clear logs; download request error log files.
- **System**: quick links + fetch `/v1/models` (grouped view). Requires at least one proxy API key to query models.

## Tech Stack

- React 19 + TypeScript 5.9
- Vite 7 (single-file build)
- Zustand (state management)
- Axios (HTTP client)
- react-router-dom v7 (HashRouter)
- Chart.js (data visualization)
- CodeMirror 6 (YAML editor)
- SCSS Modules (styling)
- i18next (internationalization)

## Internationalization

Currently supports three languages:

- English (en)
- Simplified Chinese (zh-CN)
- Russian (ru)

The UI language is automatically detected from browser settings and can be manually switched at the bottom of the page.

## Browser Compatibility

- Build target: `ES2020`
- Supports modern browsers (Chrome, Firefox, Safari, Edge)
- Responsive layout for mobile and tablet access

## Build & release notes

- Vite produces a **single HTML** output (`dist/index.html`) with all assets inlined (via `vite-plugin-singlefile`).
- Tagging a panel release such as `v1-tls-0.0.1` triggers `.github/workflows/release.yml` to publish `dist/management.html`.
- Push only the exact panel release tag being released; do not use `git push --tags` after fetching upstream.
- The UI version shown in the footer is injected at build time (env `VERSION`, git tag, or `package.json` fallback).

## Security notes

- The management key is stored in browser `localStorage` using a lightweight obfuscation format (`enc::v1::...`) to avoid plaintext storage; treat it as sensitive.
- Use a dedicated browser profile/device for management. Be cautious when enabling remote management and evaluate its exposure surface.

## Troubleshooting

- **Can’t connect / 401**: confirm the API address and management key; remote access may require enabling remote management in the server config.
- **Repeated auth failures**: the server may temporarily block remote IPs.
- **Logs page missing**: enable “Logging to file” in Basic Settings; the navigation item is shown only when file logging is enabled.
- **Some features show “unsupported”**: the backend may be too old or the endpoint is disabled/absent (common for model lists per auth file, excluded models, logs).
- **OpenAI provider test fails**: the test runs in the browser and depends on network/CORS of the provider endpoint; a failure here does not always mean the server cannot reach it.

## Development

```bash
npm run dev        # Vite dev server
npm run build      # tsc + Vite build
npm run preview    # serve dist locally
npm run lint       # ESLint (fails on warnings)
npm run format     # Prettier
npm run type-check # tsc --noEmit
```

## Contributing

Issues and PRs are welcome. Please include:

- Reproduction steps (server version + UI version)
- Screenshots for UI changes
- Verification notes (`npm run lint`, `npm run type-check`)

## License

MIT

# Panel ↔ Core v8 Management endpoint map

Panel pairs only with the CPA-Core-LTS v8 line. `apiClient` targets `/v8/management`;
`ltsExtensionClient` targets `/v0/management` and is used **only** for LTS surfaces that Core does
not expose under v8. Both clients share one transport (base URL, management key, connection
generation, session-write freeze, capability headers, 401 handling).

Sources of truth (read-only, CPA-Core-LTS v8 worktree):
`internal/api/server_management_v8.go` (v8 route table), `internal/api/server_management.go`
(v0 routes), `internal/api/handlers/management/config_v8.go`, `config_revision.go`,
`config_auth_index.go`, `auth_files_v8.go`. A route is mapped to v8 only when Core registers the
**same handler** there (identical response shape) or a v8 config node with the same YAML schema.

## Config writes (v8 only)

Every PUT/PATCH/DELETE under `/v8/management/config*` must carry exactly one strong `If-Match`
equal to the current ETag (sha256 of the persisted file). Missing → `428 config_revision_required`;
stale → `412 config_revision_conflict`. A successful write returns an empty ETag, so the Panel
re-reads before every write. Panel never writes configuration through `/v0/management`.

| Panel surface | v8 endpoint | Revision source |
|---|---|---|
| Login / connection probe | `GET /config.yaml` | Validate V8 YAML and its ETag |
| Config load / store | `GET /config`; on `422 config_not_json_compatible`, read required config nodes without plugin-owned YAML | All projection nodes must have the original ETag; projection is not a full writable document |
| Provider families (Workbench) | `GET` / `PUT /config/api-keys/{family}` | ETag of the same family read; explicit group updates also read back |
| Source / visual YAML editor, Flow page | `GET` / `PUT /config.yaml` | ETag of the editor's `GET /config.yaml` |
| Client API keys | `GET` / `PUT /config/access/api-keys` | ETag of the same node read |
| OAuth channel model policy | `GET` / `PUT /config.yaml` (`oauth.model-policy` subtree after probing `/v0/management/oauth-model-policy`) | ETag of the `GET /config.yaml` snapshot; policy changes and moving excluded rules use one PUT |
| OAuth excluded models / model alias | `GET` / `PUT /config/oauth/excluded-models`, `/config/oauth/model-alias` | ETag of the same node read (writes serialized per map) |
| Ampcode (LTS) | `GET` / `PUT /config/ampcode` (single PUT of the whole node) | ETag of the editor's node read |
| Plugin enabled / plugin config | `PUT /config/plugins/configs/{id}/enabled`, `GET` / `PUT /config/plugins/configs/{id}` | node read (config) / fresh revision (independent scalar) |
| Request-log toggle | `PUT /config/observability/logs/request-log` | fresh revision (independent scalar) |
| `configPatch.applyConfigPatch` | `PATCH /config`, `PUT`/`DELETE /config/{path}` | first step bound to the caller's revision; later steps re-read |

Response-only `auth_index` / `auth-index` are stripped from groups and keys before every write
(Core strips them too).

## Operational routes moved to v8 (same Core handler or v8 counterpart)

| v0 (old Panel) | v8 (Panel now) | Handler |
|---|---|---|
| `/auth-files` GET/POST/DELETE | `/credentials` | `ListAuthFiles` / `UploadAuthFileV8` / `DeleteAuthFileV8` |
| `/auth-files/models`, `/download`, `/status`, `/fields` | `/credentials/models`, `/download`, `/status`, `/fields` | `GetAuthFileModels` / `DownloadAuthFile` / `PatchAuthFileStatus` / `PatchAuthFileFields` |
| `/auth-files/refresh` POST | `POST /credentials/refresh` | `RefreshAuthFiles` |
| `/reset-quota` POST | `POST /routing/cooldown/reset` | `ResetQuota` |
| `/model-definitions/:channel` | `GET /routing/model-definitions/:channel` | `GetStaticModelDefinitions` |
| — (v8 catalog sync) | `POST /models/refresh` (Core also aliases `/routing/model-definitions/refresh`) | `RefreshModelDefinitions` |
| `/{provider}-auth-url` | `GET` / `POST /oauth/auth-url` (`?provider=` on GET; JSON `{ provider, is_webui, proxy_url }` on POST when login proxy is set; `project_id` in query; `anthropic` → `claude`; plugin providers via `ServePluginAuthURL`) | `StartOAuthV8` |
| — (v8 Codex SIWC) | `POST /oauth/siwc/bind` | `StartSIWCBind` |
| `/get-auth-status` | `GET /oauth/status` | `GetAuthStatus` |
| `/oauth-session` DELETE | `DELETE /oauth/session` (exempted from session-write freeze during connection switch) | `CancelAuthSession` |
| `/oauth-callback` POST | `POST /oauth/callback` | `PostOAuthCallbackV8` |
| `/vertex/import` | `POST /oauth/import?provider=vertex` | `ImportOAuthV8` → `ImportVertexCredential` |
| `/logs` GET/DELETE | `/observability/logs` | `GetLogs` / `DeleteLogs` |
| `/request-error-logs`, `/:name` | `/observability/logs/errors`, `/:name` | `GetRequestErrorLogs` / `DownloadRequestErrorLog` |
| `/request-log-by-id/:id` | `/observability/logs/requests/:id` | `GetRequestLogByID` |
| `/api-key-usage` | `GET /observability/usage/api-keys` | `GetAPIKeyUsage` |
| `/api-call` | `POST /requests/api-call` | `APICall` |
| `/latest-version` | `GET /server/latest-version` | `GetLatestVersion` |
| `/plugins` GET, `/plugins/:id` DELETE | same paths under v8 | `ListPlugins` / `DeletePlugin` |
| `/plugin-store`, `/plugin-store/:id/install` | `GET /plugins/store`, `POST /plugins/store/:id/install` | `ListPluginStore` / `InstallPluginFromStore` |
| `/plugins/:id/quota` POST | `POST /plugins/:id/quota` (Core v8 also registers GET/DELETE) | `FetchPluginQuota` |
| scalar setters (`/debug`, `/proxy-url`, …) | removed from Panel; edited through `/config.yaml` or `/config/{path}` | — |

## LTS extensions kept on `ltsExtensionClient` (`/v0/management`)

| Surface | Endpoint(s) | Why not v8 |
|---|---|---|
| Full usage statistics | `/usage`, `/usage/export`, `/usage/import` | LTS protected; no v8 route |
| Usage query workspace | `/usage/query/capabilities`, `/summary`, `/details`, `/pricing`, `/analytics`, `/export` | no v8 route |
| Cache & request diagnostics | `GET /cache-diagnostics/capabilities`, `GET /cache-diagnostics/traces`, `GET /cache-diagnostics/requests/:id`, `POST /cache-diagnostics/session` | LTS-only bounded diagnostics and session affinity lookup; no v8 route |
| Old-Core usage probe | `GET /usage-statistics-enabled` (read only) | probe only; no write |
| Flow control V3 | `/flow-control` and its `/events`, `/summary`, `/details`, `/preview`, `/migration-preview` subroutes | The Panel reads SSE events with `fetch` via `computeLtsExtensionApiUrl` and requests rule explanations through `/preview`. Core also exposes `GET /flow-control/explain` for other clients. |
| Plugin readiness | `GET /plugins/:id/readiness` | no v8 route |
| Plugin-owned management routes | `GET /plugins/copilot/login-info`, `GET /plugins/{pat}/summary` | pluginhost serves only under `/v0/management` |
| Model policy capability probe and preview | `GET /oauth-model-policy`, `GET /auth-files/models/policy-preview` | Existing LTS read-only operations; configuration writes use v8 |
| Proxy probe | `POST /proxy-url/test` | Read-only probe; no v8 route |
| Per-credential model refresh | `POST /auth-files/models/refresh` | no v8 route |
| Home runtime probe | `GET /nodes` | Home control-plane, not a Core v8 route |
| Legacy-backend diagnosis | `GET /v0/management/config` via a bare axios call | only after v8 `/config.yaml` returns 404; never used as data |

Read-only `POST` endpoints in `src/services/api/client.ts` (`READ_ONLY_USAGE_POSTS`: `/usage/query/{summary,details,pricing,analytics,export}`, `/cache-diagnostics/session`, `/flow-control/{preview,migration-preview}`, `/proxy-url/test`) do not count as active mutations during instance switching.

## Known gaps / risks

- A Home control plane that does not expose `/v8/management` cannot be used with this Panel.
- `GET /v8/management/config` returns `422 config_not_json_compatible` when the requested subtree
  has non-string map keys. Authentication uses YAML, ordinary pages use revision-consistent
  config-node projections, and the affected plugin form offers the YAML source editor.
- Plugin enable/config writes now go through v8 config (`plugins.configs.<id>`); runtime apply
  relies on Core's post-save reload, as for the v0 handler.

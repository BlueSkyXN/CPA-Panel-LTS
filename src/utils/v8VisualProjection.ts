import { isMap, isNode, isSeq, parseDocument } from 'yaml';
type ConfigDocument = ReturnType<typeof parseDocument>;

/**
 * The Panel pairs only with v8 Core: `/v8/management/config.yaml` always returns the canonical
 * v8 tree. The visual editor still addresses fields by their historical flat names, so this
 * module projects canonical v8 nodes into that editor key space and maps edits back. It does
 * not classify or accept any other configuration layout.
 */
const paths: [string, string][] = [
  ['host', 'server.host'],
  ['port', 'server.port'],
  ['tls', 'server.tls'],
  ['trusted-proxies', 'server.trusted-proxies'],
  ['commercial-mode', 'server.commercial-mode'],
  ['discovery', 'server.discovery'],
  ['remote-management', 'management'],
  ['api-keys', 'access.api-keys'],
  ['auth-dir', 'oauth.auth-dir'],
  ['auth-auto-refresh-workers', 'oauth.auth-auto-refresh-workers'],
  ['oauth-model-alias', 'oauth.model-alias'],
  ['oauth-excluded-models', 'oauth.excluded-models'],
  ['oauth-request-scoped-errors', 'oauth.request-scoped-errors'],
  ['oauth-settings', 'oauth.settings'],
  ['credential-concurrency', 'credentials.concurrency'],
  ['credential-in-flight', 'credentials.in-flight'],
  ['force-model-prefix', 'routing.force-model-prefix'],
  ['request-retry', 'routing.retry.request-retry'],
  ['max-retry-credentials', 'routing.retry.max-retry-credentials'],
  ['max-retry-interval', 'routing.retry.max-retry-interval'],
  ['disable-cooling', 'routing.cooldown.disable-cooling'],
  ['save-cooldown-status', 'routing.cooldown.save-cooldown-status'],
  ['transient-error-cooldown-seconds', 'routing.cooldown.transient-error-cooldown-seconds'],
  ['proxy-url', 'requests.proxy-url'],
  ['passthrough-headers', 'requests.passthrough-headers'],
  ['nonstream-keepalive-interval', 'requests.nonstream-keepalive-interval'],
  ['streaming', 'requests.streaming'],
  ['payload', 'requests.payload'],
  ['debug', 'observability.logs.debug'],
  ['logging-to-file', 'observability.logs.logging-to-file'],
  ['request-log', 'observability.logs.request-log'],
  ['logs-max-total-size-mb', 'observability.logs.logs-max-total-size-mb'],
  ['error-logs-max-files', 'observability.logs.error-logs-max-files'],
  ['usage-statistics-enabled', 'observability.usage.usage-statistics-enabled'],
  [
    'redis-usage-queue-retention-seconds',
    'observability.usage.redis-usage-queue-retention-seconds',
  ],
  ['pprof', 'observability.pprof'],
  ['ws-auth', 'oauth.providers.aistudio.ws-auth'],
  ['antigravity', 'oauth.providers.antigravity'],
  ['antigravity-signature-cache-enabled', 'oauth.providers.antigravity.signature-cache-enabled'],
  ['antigravity-signature-bypass-strict', 'oauth.providers.antigravity.signature-bypass-strict'],
  ['quota-exceeded.antigravity-credits', 'oauth.providers.antigravity.antigravity-credits'],
  ['codex-header-defaults', 'oauth.providers.codex.header-defaults'],
  ['codex', 'oauth.providers.codex'],
  ['claude', 'upstream.claude'],
  ['claude-code', 'upstream.claude'],
  ['claude-header-defaults', 'upstream.claude.header-defaults'],
  ['disable-claude-cloak-mode', 'upstream.claude.disable-claude-cloak-mode'],
  ['xai', 'upstream.xai'],
  ['devin', 'oauth.providers.devin'],
  ['disable-image-generation', 'multimedia.disable-image-generation'],
  ['gpt-image-2-base-model', 'multimedia.gpt-image-2-base-model'],
  ['video-result-auth-cache-ttl', 'multimedia.video-result-auth-cache-ttl'],
  ...[
    'disable-codex-cloaking',
    'stream-bootstrap-buffering',
    'stream-bootstrap-timeout',
    'orphan-delegation-compatibility',
    'model-level-cooling',
    'response-steering',
    'cache-affinity',
    'identity-confuse',
    'client-metadata',
    'desktop-tool-overlay',
    'model-fallback',
    'rate-limit-continuity',
    'abnormal-reasoning-retry',
  ].map((key): [string, string] => [`codex.${key}`, `upstream.codex.${key}`]),
  ['codex.optimize-multi-agent-v2', 'client.codex.optimize-multi-agent-v2'],
];

export function parseConfigDocument(content: string): ConfigDocument {
  const doc = parseDocument(content);
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('Invalid configuration mapping');
  return doc;
}

const split = (path: string) => path.split('.');
const clone = (node: unknown) => (isNode(node) ? node.clone() : structuredClone(node));

// This is an editor-only projection; the original provider tree is never replaced by it.
export function projectConfigForVisual(content: string): ConfigDocument {
  const original = parseConfigDocument(content);
  const accessKeys = original.getIn(['access', 'api-keys'], true);
  if (original.hasIn(['access', 'api-keys']) && !isSeq(accessKeys))
    throw new Error('Invalid access.api-keys list');
  const view = original.clone();
  if (isMap(view.get('api-keys', true))) view.delete('api-keys');
  for (const [legacy, canonical] of paths) {
    let source = split(canonical);
    if (!original.hasIn(source) && canonical.startsWith('upstream.')) {
      source = split(canonical.replace('upstream.', 'oauth.providers.'));
    }
    if (original.hasIn(source)) {
      const overlay = (node: unknown, target: string[]) => {
        if (isMap(node)) {
          if (node.items.length === 0) view.setIn(target, node.clone());
          for (const pair of node.items)
            overlay(node.get(String(pair.key), true), [...target, String(pair.key)]);
        } else view.setIn(target, clone(node));
      };
      overlay(original.getIn(source, true), split(legacy));
    }
  }
  return view;
}

function mappedPath(path: string[]): string[] {
  const key = path.join('.');
  const match = [...paths]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([legacy]) => key === legacy || key.startsWith(`${legacy}.`));
  return match ? split(match[1]).concat(path.slice(split(match[0]).length)) : path;
}

export function applyVisualProjection(
  originalYaml: string,
  before: ConfigDocument,
  after: ConfigDocument
): string {
  const original = parseConfigDocument(originalYaml);
  const visit = (a: unknown, b: unknown, path: string[]) => {
    if ((isMap(a) && (isMap(b) || b === undefined)) || (isMap(b) && a === undefined)) {
      const keys = new Set(
        [...(isMap(a) ? a.items : []), ...(isMap(b) ? b.items : [])].map((pair) => String(pair.key))
      );
      for (const key of keys)
        visit(isMap(a) ? a.get(key, true) : undefined, isMap(b) ? b.get(key, true) : undefined, [
          ...path,
          key,
        ]);
      return;
    }
    if (String(a) === String(b) && JSON.stringify(a) === JSON.stringify(b)) return;
    if (path[0] === 'enable-gemini-cli-endpoint')
      throw new Error('Unsupported configuration field');
    const target = mappedPath(path);
    if (b === undefined) {
      if (original.hasIn(target)) original.deleteIn(target);
    } else {
      for (let length = 1; length < target.length; length++) {
        const parent = target.slice(0, length);
        if (!isMap(original.getIn(parent, true))) original.setIn(parent, original.createNode({}));
      }
      original.setIn(target, clone(b));
    }
    // A stale legacy spelling must not override a deliberate canonical deletion.
    if (
      target.join('.') !== path.join('.') &&
      !(path[0] === 'api-keys' && isMap(original.get('api-keys', true)))
    ) {
      if (original.hasIn(path)) original.deleteIn(path);
    }
  };
  visit(before.contents, after.contents, []);
  return original.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 });
}

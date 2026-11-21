import { useTranslation } from 'react-i18next';
import type { CacheRouteKey, CacheRouteReference, CacheRouteSummary } from '@/types/cacheDiagnostics';
import { cacheRouteKey, cacheRouteOrder } from '@/utils/usage/cacheRoute';
import styles from '@/pages/UsagePage.module.scss';

export function CacheRouteLinks({ refs, onFilter, showSources, showAll, className }: {
  refs: CacheRouteReference[];
  onFilter?: (ref: CacheRouteKey) => void;
  showSources?: boolean;
  showAll?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const ordered = cacheRouteOrder(refs);
  if (!ordered.length) return <span className={styles.analyticsChipMeta}>{t('cache_analysis.not_recorded')}</span>;

  const render = (ref: CacheRouteReference) => {
    const key = cacheRouteKey(ref);
    const label = t(`cache_analysis.kind_${ref.kind}`);
    const method = t(`cache_analysis.method_${ref.method}`);
    const content = <>{label} <code>{ref.digest.slice(0, 8)}</code> <small>{method}</small>
      {showSources && ref.source && <code> · {ref.source}</code>}
    </>;
    return key && onFilter ? (
      <button key={`${ref.kind}-${ref.digest}-${ref.scope}`} type="button" className={styles.cacheRouteLink}
        title={ref.digest} aria-label={t('cache_analysis.filter_link', { label, digest: ref.digest.slice(0, 8), method })}
        onClick={(event) => { event.stopPropagation(); onFilter(key); }}>
        {content}
      </button>
    ) : <span key={`${ref.kind}-${ref.digest}-${ref.scope}`} title={ref.digest}>{content}</span>;
  };
  const visible = showAll ? ordered : ordered.slice(0, 1);
  const rest = ordered.slice(visible.length);
  return (
    <div className={[styles.cacheRouteLinks, className].filter(Boolean).join(' ')} onClick={(event) => event.stopPropagation()}>
      {visible.map(render)}
      {rest.length > 0 && (
        <details>
          <summary className={`${styles.cacheRouteLink} ${styles.cacheRouteMore}`}
            aria-label={t('cache_analysis.more_links', { count: rest.length })}>
            <span aria-hidden="true">{rest.length}</span>
          </summary>
          <ul className={styles.cacheRouteList} role="list">
            {rest.map((ref) => <li key={`${ref.kind}-${ref.digest}-${ref.scope}`}>{render(ref)}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function CacheRouteFacts({ route }: { route?: CacheRouteSummary }) {
  const { t } = useTranslation();
  if (!route) return null;
  const selection = route.selection;
  let label: string | undefined;
  if (selection?.method === 'session_binding' && selection.result === 'reused') {
    label = t('cache_analysis.selection_binding');
  } else if (selection?.method === 'websocket_connection' && selection.result === 'reused') {
    label = t('cache_analysis.selection_connection');
  } else if (selection?.method === 'lcp' && selection.result === 'candidate_found') {
    label = t('cache_analysis.selection_candidate');
    if (selection.prefix_length && selection.prefix_unit) {
      label += ` · ${t(`cache_analysis.prefix_${selection.prefix_unit}`, { count: selection.prefix_length })}`;
    }
  }
  if (!label && route.attempt_count <= 1) return null;
  return (
    <div className={styles.cacheRouteFacts} data-testid="cache-route-facts">
      {label && <span>{label}</span>}
      {route.attempt_count > 1 && <span>{t('cache_analysis.attempt_count', { count: route.attempt_count })}</span>}
    </div>
  );
}

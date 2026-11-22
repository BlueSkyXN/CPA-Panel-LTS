import { useTranslation } from 'react-i18next';
import type { CacheRouteKey, CacheRouteReference } from '@/types/cacheDiagnostics';
import { cacheRouteKey, cacheRouteOrder } from '@/utils/usage/cacheRoute';
import styles from '@/pages/UsagePage.module.scss';

export function CacheRouteLinks({ refs, onFilter, activeKey, className }: {
  refs: CacheRouteReference[];
  onFilter?: (ref: CacheRouteKey) => void;
  activeKey?: CacheRouteKey;
  className?: string;
}) {
  const { t } = useTranslation();
  const ordered = cacheRouteOrder(refs);
  if (!ordered.length) return <span className={styles.analyticsChipMeta}>{t('cache_analysis.not_recorded')}</span>;

  const render = (ref: CacheRouteReference) => {
    const key = cacheRouteKey(ref);
    const active = Boolean(key && activeKey && key.kind === activeKey.kind && key.digest === activeKey.digest && key.scope === activeKey.scope);
    const label = t(`cache_analysis.kind_${ref.kind}`);
    const method = t(`cache_analysis.method_${ref.method}`);
    const content = <>{label} <code>{ref.digest.slice(0, 8)}</code> <small>{method}</small></>;
    return key && onFilter ? (
      <button key={`${ref.kind}-${ref.digest}-${ref.scope}`} type="button" className={styles.cacheRouteLink}
        data-active={active || undefined} aria-pressed={active || undefined}
        title={ref.digest} aria-label={t('cache_analysis.filter_link', { label, digest: ref.digest.slice(0, 8), method })}
        onClick={() => onFilter(key)}>
        {content}
      </button>
    ) : <span key={`${ref.kind}-${ref.digest}-${ref.scope}`} title={ref.digest}>{content}</span>;
  };
  return (
    <div className={[styles.cacheRouteLinks, className].filter(Boolean).join(' ')}>
      {ordered.map(render)}
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { CacheDisclosure, CacheExecutionFlow, CacheInbound } from './CacheExecutionFlow';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAuthStore } from '@/stores/useAuthStore';
import { ltsExtensionClient } from '@/services/api/client';
import { captureCacheDiagnosticsClient } from '@/services/api/cacheDiagnostics';
import { isRecord } from '@/utils/helpers';
import { cacheAttemptFailed, cacheAttemptTransport, cacheFieldSummary, cacheExecutionPath, diffCachePayloads, isCacheLookupId, normalizeDiagnosticsId, readRate, shortCredentialLabel } from './cacheDiagnostics';
import { cacheRouteKey } from './cacheRoute';
import {
  cacheLocationSearch, cacheTraceRowKey, readCacheLocation, readCacheReturnContext, readCacheUsageRow,
} from './cacheNavigation';
import type {
  CacheDiagnosticsCapabilities, CacheRouteKey, CacheTrace, CacheTraceFocus,
  CacheTraceLocation, CacheTracePage, CacheTraceQuery, CacheTraceRow,
} from '@/types/cacheDiagnostics';
import { AnalyticsLayout, AnalyticsPageHeader } from '@/pages/AnalyticsLayout';
import analyticsStyles from '@/pages/AnalyticsPage.module.scss';
import styles from './CacheAnalysisPage.module.scss';

const errorStatus = (error: unknown) => isRecord(error) ? error.status : undefined;
const focusFilters: CacheTraceFocus[] = ['', 'zero_read', 'retry', 'official_loss'];

function useTracePages(query: CacheTraceQuery | null, instance: string, revision: number) {
  const serialized = query ? JSON.stringify(query) : '';
  const key = JSON.stringify([instance, serialized, revision]);
  const [state, setState] = useState<{
    key: string; page?: CacheTracePage; error?: string; loadingMore?: boolean;
  } | null>(null);
  const owner = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!serialized || !instance) return;
    const controller = new AbortController();
    owner.current = controller;
    const client = captureCacheDiagnosticsClient();
    const current = () => !controller.signal.aborted && client.isCurrent();
    const request: CacheTraceQuery = JSON.parse(serialized);
    void client.traces(request, controller.signal).then((page) => {
      if (!current()) return;
      if (page?.current_instance_id !== instance) {
        setState({ key, error: 'instance_changed' });
        return;
      }
      setState({ key, page });
    }).catch((error: unknown) => {
      if (current()) setState({ key, error: errorStatus(error) === 409 ? 'query_expired' : 'request_failed' });
    });
    return () => controller.abort();
  }, [serialized, key, instance]);
  const result = state?.key === key ? state : null;
  const loadMore = async () => {
    const cursor = result?.page?.next_cursor;
    const controller = owner.current;
    if (!cursor || !result.page || result.loadingMore || !controller || !serialized) return;
    const client = captureCacheDiagnosticsClient();
    const current = () => !controller.signal.aborted && client.isCurrent();
    const request: CacheTraceQuery = JSON.parse(serialized);
    setState({ ...result, loadingMore: true, error: undefined });
    try {
      const next = await client.traces({ ...request, cursor }, controller.signal);
      if (!current()) return;
      if (next?.current_instance_id !== instance) {
        setState({ ...result, loadingMore: false, error: 'instance_changed' });
        return;
      }
      setState({ key, page: { ...next, items: [...result.page.items, ...next.items] } });
    } catch (error) {
      if (current()) setState({ ...result, loadingMore: false, error: errorStatus(error) === 409 ? 'query_expired' : 'request_failed' });
    }
  };
  return { ...result, loading: Boolean(query && !result), loadMore };
}

function useTraceDetail(target: CacheTraceLocation | null, enabled: boolean, revision: number) {
  const id = target?.diagnostics_id;
  const instance = target?.instance_id;
  const key = JSON.stringify([id, instance, revision]);
  const [result, setResult] = useState<{ key: string; trace?: CacheTrace; error?: string } | null>(null);
  useEffect(() => {
    if (!id || !enabled) return;
    const controller = new AbortController();
    const client = captureCacheDiagnosticsClient();
    const current = () => !controller.signal.aborted && client.isCurrent();
    void client.trace(id, controller.signal, instance).then((trace) => {
      if (current()) setResult(trace ? { key, trace } : { key, error: 'unavailable' });
    }).catch((error: unknown) => {
      if (current()) setResult({ key, error: errorStatus(error) === 404 ? 'unavailable' : 'request_failed' });
    });
    return () => controller.abort();
  }, [id, instance, key, enabled]);
  return {
    ...(enabled && result?.key === key ? result : null),
    loading: Boolean(enabled && id && result?.key !== key),
  };
}

function matchesLocation(row: CacheTraceRow, location: CacheTraceLocation): boolean {
  if (location.instance_id && location.instance_id !== row.instance_id) return false;
  if (location.diagnostics_id && location.diagnostics_id !== row.diagnostics_id) return false;
  if (location.attempt && location.attempt !== row.attempt) return false;
  return Boolean(location.request_id ?? location.diagnostics_id ?? location.trace_id) &&
    (!location.request_id || location.request_id === row.request_id) &&
    (!location.trace_id || location.trace_id === row.trace_id);
}

function shortTraceID(row: CacheTraceRow) {
  return (row.request_id || row.diagnostics_id || row.trace_id)?.slice(-6);
}

export function CacheAnalysisPage() {
  const connection = useAuthStore((state) => JSON.stringify([state.profileId, state.apiBase]));
  const managementKey = useAuthStore((state) => state.managementKey);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const generation = ltsExtensionClient.getConnectionGeneration();
  const owner = JSON.stringify([connection, generation]);
  // A key change on the same address re-evaluates the transport generation.
  const connected = Boolean(managementKey) && connectionStatus === 'connected';
  return <CacheAnalysisWorkspace key={owner} connection={owner} connected={connected} />;
}

function CacheAnalysisWorkspace({ connection, connected }: { connection: string; connected: boolean }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const link = readCacheLocation(params);
  const source = isRecord(location.state) ? location.state : null;
  const returnContext = readCacheReturnContext(source?.cacheReturnContext, connection);
  const usageRow = returnContext ? readCacheUsageRow(source?.cacheUsageRow) : null;
  const active = usePageTransitionLayer()?.isCurrentLayer ?? true;
  const narrow = useMediaQuery('(max-width: 720px)');
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  const [capResult, setCapResult] = useState<{ revision: number; data?: CacheDiagnosticsCapabilities; error?: string } | null>(null);
  useEffect(() => {
    if (!active || !connected) return;
    const controller = new AbortController();
    const client = captureCacheDiagnosticsClient();
    const current = () => !controller.signal.aborted && client.isCurrent();
    void client.capabilities(controller.signal).then((data) => {
      if (current()) setCapResult({ revision, data });
    }).catch((error: unknown) => {
      if (current()) setCapResult({ revision, error: [404, 501].includes(Number(errorStatus(error))) ? 'unsupported' : 'request_failed' });
    });
    return () => controller.abort();
  }, [active, connected, revision]);
  const cap = capResult?.revision === revision ? capResult : null;
  const instance = cap?.data?.store?.instance_id ?? '';
  const supported = cap?.data?.version === 1 && cap.data.trace_search_version === 1 && !!instance;
  const oldCore = cap?.data?.version === 1 && !supported;

  const initialID = link.request_id ?? link.diagnostics_id ?? link.trace_id ?? '';
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [picked, setPicked] = useState<CacheTraceRow | null>(null);
  const [focus, setFocus] = useState<CacheTraceFocus>('');
  const [relatedKey, setRelatedKey] = useState<CacheRouteKey | null>(null);
  const relatedDisclosure = useRef<HTMLDetailsElement>(null);
  const filterRelated = (key: CacheRouteKey) => {
    setRelatedKey(key);
    if (relatedDisclosure.current) {
      relatedDisclosure.current.open = true;
      relatedDisclosure.current.querySelector('summary')?.focus();
    }
  };
  const [manualBaseline, setManualBaseline] = useState<{
    row: CacheTraceRow; source: 'manual' | 'nearby';
  } | null>(null);
  const timelineID = useId();
  const compareHeading = useRef<HTMLHeadingElement>(null);
  const changeReference = (next: typeof manualBaseline) => {
    setManualBaseline(next);
    requestAnimationFrame(() => compareHeading.current?.focus());
  };
  const [formError, setFormError] = useState(false);
  const q = submitted ?? (picked || focus ? '' : initialID);
  const linkedLookup = submitted === null && !picked && Boolean(initialID);
  const linkedUsage = linkedLookup ? usageRow : null;
  // A usage row needs its recorded instance. A bare log ID is only a search term.
  const linkMatchesInstance = link.instance_id
    ? !instance || link.instance_id === instance
    : !linkedUsage && Boolean(link.request_id || link.diagnostics_id || link.trace_id);
  const records = useTracePages(supported && active && (!linkedLookup || linkMatchesInstance) ? {
    q: q || undefined, instance_id: linkedLookup ? link.instance_id : undefined,
    focus,
  } : null, instance, revision);
  const matches = records.page?.items ?? [];
  const linkedRows = linkedLookup
    ? matches.filter((row) => matchesLocation(row, link))
    : [];
  const pinned = linkedRows.length === 1 && !records.page?.next_cursor ? linkedRows[0] : undefined;
  const unique = !linkedLookup && q && matches.length === 1 && !records.page?.next_cursor ? matches[0] : null;
  const selected = picked ?? pinned ?? unique ?? linkedUsage;
  const legacyID = oldCore && (!linkedLookup || linkMatchesInstance)
    ? normalizeDiagnosticsId(submitted ?? link.diagnostics_id) : undefined;
  const directLink = supported && linkedLookup && linkMatchesInstance && !records.loading && !records.error &&
    !records.page?.next_cursor && matches.length === 0 && link.diagnostics_id ? link : null;
  const target = legacyID
    ? { diagnostics_id: legacyID, instance_id: (linkedLookup ? link.instance_id : undefined) ?? (instance || undefined) }
    : selected?.available && selected.instance_id === instance ? selected : directLink;
  const detail = useTraceDetail(target, active && Boolean(target), revision);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const returnToken = returnContext?.token;
  useEffect(() => {
    if (returnToken && active) detailHeading.current?.focus({ preventScroll: true });
  }, [returnToken, active]);

  const relations = (selected?.cache_route?.references ?? []).filter((item) => item.scope);
  const autoRelation = relations.find((item) => item.kind === 'input_session') ??
    relations.find((item) => item.kind === 'pck') ?? relations[0];
  const currentRelation = relatedKey ?? (autoRelation ? cacheRouteKey(autoRelation) : undefined);
  const relationKeys = relations.flatMap((item) => cacheRouteKey(item) ?? []);
  if (relatedKey && !relationKeys.some((item) => JSON.stringify(item) === JSON.stringify(relatedKey))) {
    relationKeys.unshift(relatedKey);
  }
  const related = useTracePages(supported && active && selected && currentRelation ? {
    ...currentRelation, instance_id: selected.instance_id,
  } : null, instance, revision);
  const timeline = currentRelation && selected ? related : records;
  // A selected request is kept in the list even while the new related page loads.
  const candidates = timeline.page?.items ?? [];
  const rows = selected?.available && !candidates.some((item) => cacheTraceRowKey(item) === cacheTraceRowKey(selected))
    ? [selected, ...candidates].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : candidates;
  const canCompareRow = (row: CacheTraceRow) => !!selected?.available && row.available &&
    !!row.diagnostics_id && row.instance_id === selected.instance_id && row.diagnostics_id !== selected.diagnostics_id;
  const manualReference = manualBaseline && canCompareRow(manualBaseline.row) ? manualBaseline : null;
  const baseline = manualReference?.row ?? selected?.previous ?? null;
  const usableBaseline = baseline && !!selected && baseline.instance_id === selected.instance_id &&
    baseline.diagnostics_id !== selected.diagnostics_id;
  const baselineRow = usableBaseline && baseline
    ? rows.find((row) => matchesLocation(row, baseline)) ?? rows.find((row) =>
      row.instance_id === baseline.instance_id && row.diagnostics_id === baseline.diagnostics_id)
    : undefined;
  const selectedAt = selected ? Date.parse(selected.at) : Number.NaN;
  const nearby = !usableBaseline && (currentRelation?.kind === 'input_session' || currentRelation?.kind === 'pck')
    ? related.page?.items.find((row) => canCompareRow(row) && Date.parse(row.at) < selectedAt)
    : undefined;
  const baselineLabel = manualReference?.source === 'nearby' ? 'nearby_reference'
    : manualReference ? 'manual_reference'
    : selected?.previous_source === 'diagnostics.previous_message_id' ? 'explicit_claude_diagnostic'
    : selected?.previous_source === 'thread.previous_message_id' ? 'explicit_claude_thread'
    : 'explicit_previous';
  const reference = useTraceDetail(baseline, active && !!usableBaseline &&
    baseline?.instance_id === instance, revision);
  const directExecutionMismatch = directLink?.request_id && detail.trace?.attempts.length &&
    !detail.trace.attempts.some((attempt) => attempt.execution_id === directLink.request_id);
  const trace = directExecutionMismatch ? undefined : detail.trace;
  const fieldChanges = reference.trace && trace ? diffCachePayloads(reference.trace.input, trace.input) : null;
  const attempts = trace?.attempts ?? [];
  const first = attempts[0], final = attempts[attempts.length - 1];
  const firstPCK = first?.cache_references.find((item) => item.kind === 'pck');
  const finalPCK = final?.cache_references.find((item) => item.kind === 'pck');
  const asPercent = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 });
  const dateTime = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
  const rowClock = new Intl.DateTimeFormat(i18n.language, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const chosenAttempt = selected?.attempt
    ? attempts.find((attempt) => attempt.number === selected.attempt)
    : selected?.request_id
      ? [...attempts].reverse().find((attempt) => attempt.execution_id === selected.request_id)
      : undefined;
  const visibleObs = chosenAttempt ? chosenAttempt.cache_observation
    : selected?.cache_observation ?? final?.cache_observation;
  const noParsed = !visibleObs && (chosenAttempt?.observation_state === 'not_observed' ||
    chosenAttempt?.observation_state === 'encoded_response' || selected?.cache_route?.no_parsed_response);
  const summaryValue = (field: 'read' | 'write') => {
    const historical = field === 'read' ? linkedUsage?.cache_read_tokens : linkedUsage?.cache_write_tokens;
    if (!trace && !visibleObs && historical !== undefined && historical > 0)
      return t('cache_analysis.historical_value', { value: historical.toLocaleString(i18n.language) });
    return cacheFieldSummary(t, visibleObs?.[field]);
  };
  const measurements = noParsed ? t('cache_analysis.summary_not_observed') : t('cache_analysis.execution_summary', {
    read: summaryValue('read'),
    write: summaryValue('write'),
  });
  const path = cacheExecutionPath(attempts);
  let executionSummary = '';
  if (path) {
    const { from, final, failedBeforeFinal, changedCredential } = path;
    const fromTransport = cacheAttemptTransport(from.transport);
    const toTransport = cacheAttemptTransport(final.transport);
    const result = from.status && from.status >= 400 ? `${fromTransport} ${from.status}`
      : failedBeforeFinal ? `${fromTransport} · ${t(`cache_diagnostics.outcome_${from.outcome}`, {
        defaultValue: t('cache_analysis.attempt_failed'),
      })}` : fromTransport;
    executionSummary = t(changedCredential ? 'cache_analysis.attempt_path_with_credential' : 'cache_analysis.attempt_path', {
      action: t(failedBeforeFinal ? 'cache_analysis.retry_action' : 'cache_analysis.multiple_sends'),
      count: attempts.length,
      from: result,
      to: toTransport,
      first: from.auth_index,
      final: final.auth_index,
    });
  }
  const selectRow = (row: CacheTraceRow) => {
    setPicked(row);
    setRelatedKey(null);
    setParams(new URLSearchParams(cacheLocationSearch(row)), { replace: true, state: location.state });
    if (narrow) requestAnimationFrame(() => detailHeading.current?.focus());
  };
  useEffect(() => {
    if (!unique || picked || initialID) return;
    const search = cacheLocationSearch(unique);
    if (search) setParams(new URLSearchParams(search), { replace: true, state: location.state });
  }, [unique, picked, initialID, location.state, setParams]);

  const changeFocus = (value: CacheTraceFocus) => {
    setFocus(value);
    setSubmitted(null);
    setPicked(null);
    setRelatedKey(null);
    setManualBaseline(null);
    setParams({}, { replace: true, state: location.state });
  };

  const renderRows = () => (
    <div className={styles.timelineContent}>
      {selected && relationKeys.length > 0 && (
        <label className={styles.relation}>
          <span>{t('cache_analysis.related_by')}</span>
          <select value={currentRelation ? JSON.stringify(currentRelation) : ''} onChange={(event) => {
            const chosen = relationKeys.find((key) => JSON.stringify(key) === event.target.value);
            if (chosen) setRelatedKey(chosen);
          }}>
            {relationKeys.map((ref) => <option key={JSON.stringify(ref)} value={JSON.stringify(ref)}>
              {t(`cache_analysis.kind_${ref.kind}`)} · {ref.digest.slice(0, 8)}
            </option>)}
          </select>
        </label>
      )}
      {timeline.loading && <p role="status">{t('common.loading')}</p>}
      {timeline.error && <p role="alert" className={styles.alert}>{t(`cache_analysis.${timeline.error}`)}</p>}
      {!rows.length && !timeline.loading && !timeline.error && (
        <p role="status">{t(q ? 'cache_analysis.no_matches' : 'cache_analysis.no_recent')}</p>
      )}
      {rows.length > 0 && (
        <ol className={styles.timelineList} role="list">
          {rows.map((row, index) => {
            const key = cacheTraceRowKey(row);
            const current = selected && key === cacheTraceRowKey(selected);
            const comparison = row === baselineRow;
            const rowDescription = `${timelineID}-${index}`;
            const rate = readRate(row.input_tokens, row.cache_observation?.read);
            const currentRate = readRate(selected?.input_tokens, selected?.cache_observation?.read);
            const delta = rate !== null && currentRate !== null && !current ? currentRate - rate : null;
            const rateLabel = rate === null
              ? cacheFieldSummary(t, row.cache_observation?.read)
              : asPercent.format(rate);
            const shortID = shortTraceID(row);
            const time = dateTime.format(new Date(row.at));
            const sends = row.attempt_count ?? row.cache_route?.attempt_count ?? 0;
            return (
              <li key={key} className={styles.timelineItem} data-selected={!!current} data-baseline={comparison}>
                <button type="button" className={styles.timelineSelect} aria-current={current ? 'true' : undefined}
                  aria-describedby={rowDescription}
                  data-testid="cache-trace-candidate" onClick={() => selectRow(row)}>
                  <span className={styles.timelineMain}>
                    <time dateTime={row.at} title={time} aria-label={time}>{rowClock.format(new Date(row.at))}</time>
                    <strong title={rateLabel}>{rate === null && row.cache_observation?.read.value === undefined ? '—' : rateLabel}</strong>
                  </span>
                </button>
                {comparison ? (
                  <span className={styles.referenceBadge} data-testid="cache-current-reference">
                    {t('cache_analysis.current_reference')}
                  </span>
                ) : canCompareRow(row) && (
                  <button type="button" className={styles.referenceAction} data-testid="cache-reference-action"
                    aria-label={t('cache_analysis.reference_action_for', { label: t('cache_analysis.reference_action'), target: shortID ? `#${shortID}` : time })}
                    onClick={() => changeReference({ row, source: 'manual' })}>
                    {t('cache_analysis.reference_action')}
                  </button>
                )}
                <div className={styles.timelineDescription} id={rowDescription}>
                  <div className={styles.timelineIdentity}>
                    {shortID && <code title={row.request_id || row.diagnostics_id || row.trace_id}>#{shortID}</code>}
                    <span title={row.model}>{row.model}</span>
                    {row.auth_index && <code title={row.auth_index}>{shortCredentialLabel(row.auth_index)}</code>}
                  </div>
                  <div className={styles.timelineSignals}>
                    {sends > 1 && <small>{t('cache_analysis.attempt_count', { count: sends })}</small>}
                    {cacheAttemptFailed(row) && <small data-tone="failed">
                      {(row.status ?? 0) >= 400 ? `HTTP ${row.status}` : t('cache_analysis.attempt_failed')}
                    </small>}
                    {row.cache_route?.official_loss && <small data-tone="loss">{t('cache_analysis.focus_official_loss')}</small>}
                    {delta !== null && delta !== 0 && <small>{t('cache_analysis.rate_delta', {
                      value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(delta * 100),
                    })}</small>}
                    {row.matched.length > 0 && <small>{row.matched
                      .map((type) => t(`cache_analysis.match_${type}`, { defaultValue: type })).join(' · ')}</small>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {timeline.page?.next_cursor && (
        <Button type="button" size="sm" variant="secondary" loading={timeline.loadingMore}
          disabled={timeline.error === 'query_expired' || timeline.error === 'instance_changed'}
          onClick={() => void timeline.loadMore()}>
          {t('cache_analysis.more_requests')}
        </Button>
      )}
    </div>
  );

  const hasSelectedTrace = Boolean(selected?.available);
  const showTimeline = supported && (!selected || hasSelectedTrace || matches.length > 0);
  const lookupInDetail = linkedLookup && !showTimeline;
  const mobileRows = showTimeline && narrow && (
    <details ref={relatedDisclosure} className={styles.timeline} open={!hasSelectedTrace} key={selected?.available ? cacheTraceRowKey(selected) : 'recent'}>
      <summary><span>{t(hasSelectedTrace ? 'cache_analysis.related_requests' : q ? 'cache_analysis.matches' : 'cache_analysis.recent')}</span></summary>
      {renderRows()}
    </details>
  );

  const searchControls = (
    <>
      <form className={styles.search} onSubmit={(event) => {
        event.preventDefault();
        const id = draft.trim();
        const valid = oldCore ? Boolean(normalizeDiagnosticsId(id)) : isCacheLookupId(id);
        setFormError(!valid);
        if (!valid) return;
        setPicked(null);
        setFocus('');
        setRelatedKey(null);
        setManualBaseline(null);
        setParams({}, { replace: true, state: location.state });
        setSubmitted(id);
      }}>
        <label>
          <span>{t(oldCore ? 'cache_diagnostics.record_id' : 'cache_analysis.find_id')}</span>
          <input value={draft} type="search" maxLength={192} onChange={(event) => setDraft(event.target.value)}
            autoComplete="off" aria-invalid={formError || undefined} />
        </label>
        <Button type="submit" disabled={!supported && !oldCore}>{t('cache_analysis.search')}</Button>
      </form>
      {formError && <p role="alert" className={styles.alert}>{t('cache_analysis.invalid_id')}</p>}
      {supported && (
        <div className={styles.focusFilters}>
          {focusFilters.map((value) => (
            <Button key={value} type="button" size="sm" variant={focus === value && !q ? 'primary' : 'secondary'}
              aria-pressed={focus === value && !q} onClick={() => changeFocus(value)}>
              {t(value ? `cache_analysis.focus_${value}` : 'cache_analysis.recent')}
            </Button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <AnalyticsLayout>
      <AnalyticsPageHeader title={t('cache_analysis.title')} actions={
        <>
          {returnContext && (
            <Button type="button" variant="secondary" onClick={() => navigate(`${returnContext.pathname}${returnContext.search}`, {
              state: { ...(isRecord(source?.cacheSourceState) ? source.cacheSourceState : {}), cacheRestoreContext: returnContext },
            })}>{t('cache_analysis.back_to_events')}</Button>
          )}
          <Button type="button" variant="secondary" onClick={refresh}>{t('common.refresh')}</Button>
        </>
      } />
      <details className={`${analyticsStyles.scopeNote} ${styles.scopeDisclosure}`}>
        <summary><span>{t('cache_analysis.scope_short')}</span></summary>
        <p>{t('cache_analysis.scope_detail')}</p>
      </details>
      {narrow && hasSelectedTrace ? (
        <details className={styles.searchDisclosure}>
          <summary><span>{t('cache_analysis.find_other_request')}</span></summary>
          {searchControls}
        </details>
      ) : searchControls}
      {!cap && <p role="status">{t('common.loading')}</p>}
      {cap?.error && <p role="alert" className={styles.alert}>{t(`cache_diagnostics.${cap.error}`)}</p>}
      {oldCore && <p role="status">{t('cache_analysis.legacy_search')}</p>}
      {cap?.data?.recording_enabled === false && <p role="status">{t('cache_analysis.recording_disabled')}</p>}
      <div className={styles.workspace}>
        {showTimeline && !narrow && (
          <aside className={styles.timeline} aria-labelledby="cache-timeline-heading">
            <h2 id="cache-timeline-heading">{t(hasSelectedTrace ? 'cache_analysis.related_requests' : q ? 'cache_analysis.matches' : 'cache_analysis.recent')}</h2>
            {renderRows()}
          </aside>
        )}
        {!hasSelectedTrace && mobileRows}
        <section className={styles.inspection} aria-labelledby="cache-inspection-heading">
          <div className={styles.conclusion}>
            <h2 ref={detailHeading} tabIndex={-1} id="cache-inspection-heading">
              {selected?.model ?? trace?.model ?? t('cache_analysis.current_request')}
            </h2>
            {selected?.at && <time dateTime={selected.at}>{dateTime.format(new Date(selected.at))}</time>}
            {selected || trace ? (
              <>
                <div className={styles.resultText} data-testid="cache-analysis-observed-result">
                  {executionSummary && <p>{executionSummary}</p>}
                  <p>{measurements}</p>
                </div>
                {!trace && linkedUsage?.input_tokens !== undefined && (
                  <p>{t('usage_stats.request_events_total_input_tokens')} · {linkedUsage.input_tokens.toLocaleString(i18n.language)}</p>
                )}
                {firstPCK && finalPCK && first !== final && (
                  <p>{t(firstPCK.digest === finalPCK.digest
                    ? 'cache_analysis.pck_retained' : 'cache_analysis.pck_changed')}</p>
                )}
                {linkedUsage && cap && !records.loading && !records.error && matches.length === 0 && !detail.loading && !trace &&
                  (!detail.error || detail.error === 'unavailable') && (
                  <p role="status">{t('cache_analysis.history_only')}</p>
                )}
              </>
            ) : (
              <>
                <p>{t(linkedLookup && cap && (!linkMatchesInstance || directExecutionMismatch)
                  ? 'cache_diagnostics.unavailable' : 'cache_analysis.choose_request')}</p>
                {!linkedLookup && rows.length > 0 && (
                  <p className={styles.note}>
                    {typeof cap?.data?.store?.active === 'number' && focus === '' && (
                      <>{t('cache_analysis.recent_overview_instance', { total: cap.data.store.active })} </>
                    )}
                    {t(focus ? 'cache_analysis.recent_overview_filtered' : 'cache_analysis.recent_overview_loaded', {
                      ...(focus ? { focus: t(`cache_analysis.focus_${focus}`) } : {}),
                      count: rows.length,
                      retried: rows.filter((row) => (row.attempt_count ?? row.cache_route?.attempt_count ?? 0) > 1).length,
                      zeroRead: rows.filter((row) => row.cache_observation?.read.state === 'present' && row.cache_observation.read.value === 0).length,
                    })}
                    {timeline.page?.next_cursor && <> {t('cache_analysis.recent_overview_more')}</>}
                  </p>
                )}
              </>
            )}
          </div>
          {hasSelectedTrace && mobileRows}
          {(detail.loading || (lookupInDetail && records.loading)) && <p role="status">{t('common.loading')}</p>}
          {lookupInDetail && records.error && <p role="alert" className={styles.alert}>{t(`cache_analysis.${records.error}`)}</p>}
          {detail.error && (!linkedUsage || detail.error !== 'unavailable') && (
            <p role="status">{t(`cache_diagnostics.${detail.error}`)}</p>
          )}
          {trace && (
            <>
              <CacheInbound trace={trace} onFilter={filterRelated} activeKey={currentRelation} />
              <div className={styles.compare}>
                <h3 ref={compareHeading} tabIndex={-1}>{t('cache_analysis.input_comparison')}</h3>
                {usableBaseline ? (
                  <>
                    <p>{t(`cache_analysis.${baselineLabel}`)}
                      {baseline && <code> · #{(baseline.request_id || baseline.diagnostics_id)?.slice(-6)}</code>}
                      {reference.trace && ` · ${reference.trace.model}${Number.isFinite(Date.parse(reference.trace.created_at)) ? ` · ${dateTime.format(new Date(reference.trace.created_at))}` : ''}`}
                    </p>
                    {reference.loading ? <p role="status">{t('common.loading')}</p> : fieldChanges === null
                      ? <p>{t('cache_diagnostics.unavailable')}</p>
                      : fieldChanges.length > 0
                        ? <ul className={styles.changedFields} role="list">
                            {fieldChanges.map((item) => {
                              const valueText = item.beforeValue && item.afterValue && item.beforeValue !== item.afterValue
                                ? `${item.beforeValue} → ${item.afterValue}`
                                : item.afterValue ?? item.beforeValue;
                              return (
                                <li key={item.field} data-kind={item.kind} data-prefix-risk={!item.turnExpected || undefined}>
                                  <span aria-hidden="true" className={styles.diffKind}>
                                    {item.kind === 'added' ? '+' : item.kind === 'removed' ? '−' : '~'}
                                  </span>
                                  <code>{item.field}</code>
                                  {valueText && <small className={styles.diffValue}>{valueText}</small>}
                                </li>
                              );
                            })}
                          </ul>
                        : <p>{t('cache_diagnostics.no_difference')}</p>}
                    {manualReference && <Button type="button" variant="secondary" size="sm" onClick={() => changeReference(null)}>
                      {t('cache_analysis.clear_reference')}
                    </Button>}
                  </>
                ) : nearby ? (
                  <Button type="button" variant="secondary" size="sm"
                    onClick={() => changeReference({ row: nearby, source: 'nearby' })}>
                    {t('cache_analysis.compare_nearby')}
                  </Button>
                ) : <p>{t('cache_analysis.choose_reference')}</p>}
              </div>
              <CacheExecutionFlow trace={trace} selected={selected ?? link} onFilter={filterRelated} activeKey={currentRelation} />
              <CacheDisclosure className={styles.ids} label={t('cache_analysis.identifiers')}>
                <p>{t('cache_diagnostics.logical_request')} · <code>{trace.logical_request_id}</code></p>
                <p>{t('cache_diagnostics.record_id')} · <code>{trace.id}</code></p>
                {trace.trace_id && <p>{t('cache_analysis.match_trace_id')} · <code>{trace.trace_id}</code></p>}
                <p>{t('cache_diagnostics.instance')} · <code>{trace.instance_id}</code></p>
              </CacheDisclosure>
            </>
          )}
        </section>
      </div>
    </AnalyticsLayout>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { captureCacheDiagnosticsClient } from '@/services/api/cacheDiagnostics';
import type { CacheAttempt, CacheRouteKey, CacheSessionSnapshot, CacheTrace, CacheTraceLocation } from '@/types/cacheDiagnostics';
import { cacheAttemptFailed, cacheAttemptTransport, cacheFieldText, diffCachePayloads } from '@/utils/usage/cacheDiagnostics';
import { CacheRouteLinks } from './CacheRouteLinks';
import styles from '@/pages/CacheAnalysisPage.module.scss';

export function CacheDisclosure({ label, children, className }: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={className}>
      <summary><span>{label}</span></summary>
      {children}
    </details>
  );
}

export function CacheInbound({ trace, onFilter, activeKey }: {
  trace: CacheTrace;
  onFilter: (key: CacheRouteKey) => void;
  activeKey?: CacheRouteKey;
}) {
  const { t } = useTranslation();
  return (
    <section className={styles.sharedInput} data-testid="cache-shared-input">
      <h3>{t('cache_analysis.shared_input')}</h3>
      <div className={styles.sharedInputFacts}>
        <code>{trace.source_format || '—'}</code>
        {trace.input_session && <CacheRouteLinks refs={[trace.input_session]} onFilter={onFilter} activeKey={activeKey} />}
      </div>
      {trace.input.known ? (
        <CacheDisclosure label={t('cache_analysis.input_fields')}>
          <ul className={styles.changedFields} role="list">
            {Object.keys(trace.input.fields).map((field) => <li key={field}><code>{field}</code></li>)}
          </ul>
        </CacheDisclosure>
      ) : <p className={styles.note}>{t('cache_diagnostics.unavailable')}</p>}
    </section>
  );
}

function AttemptStages({ attempt, trace, onFilter, activeKey }: {
  attempt: CacheAttempt;
  trace: CacheTrace;
  onFilter: (key: CacheRouteKey) => void;
  activeKey?: CacheRouteKey;
}) {
  const { t } = useTranslation();
  const input = attempt.input ?? trace.input;
  const changed = diffCachePayloads(input, attempt.request);
  const inputChanges = attempt.input ? diffCachePayloads(trace.input, attempt.input) : null;
  const decisions = trace.events.filter((event) =>
    (event.execution_id === attempt.execution_id && Boolean(event.execution_id) ||
     !event.execution_id && Boolean(attempt.decision_id) && event.decision_id === attempt.decision_id) &&
    (event.layer === 'account' || event.layer === 'oauth_group')
  );
  const transforms = trace.events.filter((event) =>
    event.layer === 'transform' && event.execution_id === attempt.execution_id
  );
  const diagnostic = attempt.diagnostic;
  const compared = attempt.request.fields['prompt_cache_options.comparison_response_id'] ??
    attempt.request.fields['diagnostics.previous_message_id'];
  const loss = attempt.diagnostic_returned && diagnostic &&
    !['comparison_response_not_found', 'unavailable'].includes(diagnostic.type) &&
    (diagnostic.type === 'cache_miss' || (diagnostic.cache_missed_tokens ?? 0) > 0);
  const diagnosticResult = loss && diagnostic?.type !== 'cache_miss'
    ? t('cache_analysis.reported_partial_loss')
    : t(`cache_diagnostics.diagnostic_${diagnostic?.type}`, { defaultValue: diagnostic?.type || '—' });

  return (
    <div className={styles.stages}>
      <section className={styles.stage}>
        <h5>{t('cache_analysis.stage_selection')}</h5>
        <p><strong>{attempt.auth_index || '—'}</strong>{attempt.auth_type ? ` · ${attempt.auth_type}` : ''}</p>
        {decisions.length > 0 && (
          <ul className={styles.decisions} role="list">
            {decisions.map((event) => (
              <li key={event.sequence}>
                {t(`cache_analysis.decision_${event.method}_${event.result}`, {
                  defaultValue: `${event.method} · ${event.result}`,
                })}
                {event.reason && <> · {t(`cache_diagnostics.reason_${event.reason}`, { defaultValue: event.reason })}</>}
                {event.prefix_length !== undefined && event.prefix_length > 0 && (
                  <> · {t(`cache_analysis.prefix_${event.prefix_unit}`, { count: event.prefix_length, defaultValue: `${event.prefix_length} ${event.prefix_unit}` })}</>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.stage}>
        <h5>{t('cache_analysis.stage_outbound')}</h5>
        <p>{attempt.provider} · {attempt.model}</p>
        <CacheRouteLinks refs={attempt.cache_references} onFilter={onFilter} activeKey={activeKey} className={styles.flowRoute} />
        {attempt.cache_control && (
          <p>{t('cache_analysis.breakpoints', { count: attempt.cache_control.breakpoints })}
            {attempt.cache_control.five_minutes ? ` · 5m × ${attempt.cache_control.five_minutes}` : ''}
            {attempt.cache_control.one_hour ? ` · 1h × ${attempt.cache_control.one_hour}` : ''}
          </p>
        )}
        {attempt.input && inputChanges && inputChanges.length > 0 && (
          <p className={styles.note}>{t('cache_analysis.attempt_input_changed')} · <code>{inputChanges.map((item) => item.field).join(', ')}</code></p>
        )}
        <CacheDisclosure label={t('cache_diagnostics.wire_difference')}>
          {changed === null ? <p>{t('cache_diagnostics.unavailable')}</p> : changed.length
            ? <ul className={styles.changedFields} role="list">
                {changed.map((item) => {
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
          {transforms.map((event) => (
            <p key={event.sequence} className={styles.note}><code>{event.method}</code> · {event.changes.join(', ')}</p>
          ))}
        </CacheDisclosure>
        {attempt.request.known && <CacheDisclosure label={t('cache_diagnostics.outbound_fields')}>
          <dl className={styles.fieldDigestList}>
            {Object.entries(attempt.request.fields).map(([path, field]) => <div key={path}>
              <dt><code>{path}</code></dt>
              <dd>{field.value
                ? <code>{field.value}</code>
                : <code className={styles.digestBadge} title={field.digest}>#{field.digest.slice(0, 8)}…{field.digest.slice(-4)}</code>}</dd>
            </div>)}
          </dl>
        </CacheDisclosure>}
      </section>
      <section className={styles.stage}>
        <h5>{t('cache_analysis.stage_response')}</h5>
        <p className={styles.responseStatus} data-failed={cacheAttemptFailed(attempt)}>
          {attempt.status ? <strong>HTTP {attempt.status}</strong> : null}
          {attempt.status ? ' · ' : ''}
          {t(`cache_diagnostics.outcome_${attempt.outcome}`, { defaultValue: attempt.outcome })}
        </p>
        <dl className={styles.measurements}>
          {(['read', 'write'] as const).map((name) => {
            const evidence = attempt.cache_observation?.[name];
            return <div key={name}>
              <dt>{t(`cache_diagnostics.${name}`)}</dt>
              <dd title={evidence?.source}>{cacheFieldText(t, evidence, true)}</dd>
            </div>;
          })}
        </dl>
        {attempt.cache_write_by_ttl && Object.keys(attempt.cache_write_by_ttl).length > 0 && (
          <p>{t('cache_analysis.write_by_ttl')} · {Object.entries(attempt.cache_write_by_ttl)
            .map(([ttl, value]) => `${ttl} ${value.toLocaleString()}`).join(' · ')}</p>
        )}
        {attempt.cache_observation?.read.value !== undefined && attempt.input_tokens !== undefined &&
          attempt.cache_observation.read.value > attempt.input_tokens && (
          <p>{t('cache_analysis.invalid_ratio', { read: attempt.cache_observation.read.value, input: attempt.input_tokens })}</p>
        )}
        {attempt.diagnostic_returned ? (
          <div className={styles.officialReport} data-testid="cache-official-report" data-loss={Boolean(loss)}>
            <p className={styles.officialLabel}>{t('cache_diagnostics.official')}</p>
            <strong>{diagnosticResult}</strong>
            {diagnostic?.reason && <p><code>{diagnostic.reason}</code></p>}
            {diagnostic?.cache_missed_tokens !== undefined && <p>{t('cache_analysis.missed_tokens', { count: diagnostic.cache_missed_tokens })}</p>}
            {diagnostic?.comparison_reusable_tokens !== undefined && (
              <p>{t('cache_analysis.reusable_tokens', { count: diagnostic.comparison_reusable_tokens })}</p>
            )}
          </div>
        ) : attempt.observation_state === 'observed' && <p className={styles.note}>{t('cache_diagnostics.not_returned')}</p>}
        {(attempt.diagnostic_returned || attempt.comparison_id_sent === 'present') && (
          <CacheDisclosure label={t('cache_analysis.comparison_details')}>
            <p>{t('cache_diagnostics.comparison_sent')} · {t(`cache_diagnostics.comparison_${attempt.comparison_id_sent}`)}</p>
            {compared && attempt.comparison_id_sent === 'present' && <p><code title={compared.digest}>{compared.digest.slice(0, 12)}</code></p>}
          </CacheDisclosure>
        )}
        {attempt.response_truncated && <p>{t('cache_diagnostics.truncated')}</p>}
      </section>
    </div>
  );
}

function CurrentBinding({ trace }: { trace: CacheTrace }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ loading?: boolean; error?: boolean; data?: CacheSessionSnapshot }>({});
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);
  const attempt = trace.attempts[trace.attempts.length - 1];
  if (!trace.session_hash || !attempt) return null;
  const load = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const client = captureCacheDiagnosticsClient();
    const current = () => !controller.signal.aborted && client.isCurrent();
    setState({ loading: true });
    try {
      const data = await client.session(
        attempt.provider,
        trace.model,
        trace.session_hash!,
        trace.id,
        controller.signal
      );
      if (!current()) return;
      setState(data?.instance_id === trace.instance_id ? { data } : { error: true });
    } catch {
      if (current()) setState({ error: true });
    }
  };
  const snapshot = state.data;
  return (
    <section className={styles.binding}>
      <Button type="button" size="sm" variant="secondary" loading={state.loading} onClick={() => void load()}>
        {t('cache_diagnostics.query_session')}
      </Button>
      {state.error && <p role="status">{t('cache_diagnostics.request_failed')}</p>}
      {snapshot && (
        <div role="status">
          <p>{t(`cache_diagnostics.binding_${snapshot.status}`, { defaultValue: snapshot.status })} · {new Date(snapshot.at).toLocaleString()}</p>
          {snapshot.bindings.length > 0 && (
            <ul>{snapshot.bindings.map((item, index) => <li key={index}>
              {item.kind} · {item.auth_index || '—'} · {item.expired ? t('cache_diagnostics.expired') : t('cache_diagnostics.expires', { at: item.expires_at })}
            </li>)}</ul>
          )}
          {snapshot.oauth && <CacheDisclosure label={t('cache_diagnostics.oauth_snapshot')}>
            <p>{t(`cache_diagnostics.oauth_${snapshot.oauth.status}`, { defaultValue: snapshot.oauth.status })} · {new Date(snapshot.oauth.at).toLocaleString()}</p>
            {snapshot.oauth.rows.length > 0 && <ul>{snapshot.oauth.rows.map((row, index) => <li key={index}>
              {row.kind} · <code>{row.group_hash || row.object_hash}</code>
            </li>)}</ul>}
          </CacheDisclosure>}
        </div>
      )}
    </section>
  );
}

export function CacheExecutionFlow({ trace, selected, onFilter, activeKey }: {
  trace: CacheTrace;
  selected: CacheTraceLocation;
  onFilter: (key: CacheRouteKey) => void;
  activeKey?: CacheRouteKey;
}) {
  const { t } = useTranslation();
  const detached = trace.events.filter((event) => event.layer === 'transport' && event.result === 'no_client_dispatch');
  return (
    <>
      <h3>{t('cache_analysis.execution_path')}</h3>
      {trace.truncated && <p role="status">{t('cache_diagnostics.truncated')}</p>}
      {trace.attempts.length === 0 && <p>{t('cache_analysis.no_sends')}</p>}
      <ol className={styles.attempts} role="list">
        {trace.attempts.map((attempt) => {
          const current = selected.attempt ? selected.attempt === attempt.number :
            Boolean(selected.request_id) && selected.request_id === attempt.execution_id;
          return (
            <li key={attempt.number} className={styles.attempt} data-current-execution={current}>
              <h4 className={styles.attemptHeading}>
                {t('cache_diagnostics.attempt', { number: attempt.number })} · {cacheAttemptTransport(attempt.transport)}
                {current && <span className={styles.currentTag}>{t('cache_analysis.current_attempt')}</span>}
              </h4>
              <AttemptStages attempt={attempt} trace={trace} onFilter={onFilter} activeKey={activeKey} />
              <CacheDisclosure className={styles.ids} label={t('cache_analysis.attempt_identifiers')}>
                <dl className={styles.measurements}>
                  <div><dt>{t('cache_diagnostics.execution')}</dt><dd><code>{attempt.execution_id}</code></dd></div>
                  <div><dt>{t('cache_diagnostics.decision')}</dt><dd><code>{attempt.decision_id || '—'}</code></dd></div>
                  <div><dt>{t('cache_diagnostics.response_id')}</dt><dd><code>{attempt.response_id || '—'}</code></dd></div>
                </dl>
              </CacheDisclosure>
            </li>
          );
        })}
      </ol>
      {detached.map((event) => <p key={event.sequence}>{t('cache_analysis.server_event')} · <code>{event.method}</code></p>)}
      <CurrentBinding key={trace.id} trace={trace} />
    </>
  );
}

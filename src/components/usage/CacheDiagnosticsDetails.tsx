import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/useAuthStore';
import { ltsExtensionClient } from '@/services/api/client';
import { captureCacheDiagnosticsClient } from '@/services/api/cacheDiagnostics';
import { compareCachePayloads, readCacheObservation } from '@/utils/usage/cacheDiagnostics';
import type { CacheObservation, CacheSessionSnapshot, CacheTrace } from '@/types/cacheDiagnostics';
import styles from './CacheDiagnosticsDetails.module.scss';

interface Props {
  instanceId?: string | null;
  diagnosticId?: string | null;
  requestId?: string | null;
  observation?: unknown;
}

function errorStatus(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof error.status === 'number'
  )
    return error.status;
  return undefined;
}

export function CacheDiagnosticsDetails(props: Props) {
  const apiBase = useAuthStore((s) => s.apiBase);
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const profileId = useAuthStore((s) => s.profileId);
  const connectionKey = `${profileId}:${apiBase}:${connectionStatus}:${ltsExtensionClient.getConnectionGeneration()}`;
  return (
    <CacheDiagnosticsContent
      key={`${connectionKey}:${props.instanceId}:${props.diagnosticId}:${props.requestId}`}
      {...props}
    />
  );
}

function CacheDiagnosticsContent({ diagnosticId, instanceId, requestId, observation }: Props) {
  const { t } = useTranslation();
  const inputId = useId();
  const [trace, setTrace] = useState<CacheTrace | null>(null);
  const [state, setState] = useState(diagnosticId && instanceId ? 'loading' : 'not_recorded');
  const [snapshot, setSnapshot] = useState<CacheSessionSnapshot | null>(null);
  const [snapshotState, setSnapshotState] = useState('');
  const [baselineId, setBaselineId] = useState('');
  const [comparison, setComparison] = useState<string[] | null>(null);
  const [compareState, setCompareState] = useState('');
  const requestOwner = useRef({ active: true, generation: 0 });
  const cache = readCacheObservation(observation);
  const key = (name: string) => `cache_diagnostics.${name}`;

  useEffect(() => {
    const owner = requestOwner.current;
    owner.active = true;
    const generation = ++owner.generation;
    const client = captureCacheDiagnosticsClient();
    const current = () => owner.active && owner.generation === generation && client.isCurrent();
    if (diagnosticId && instanceId) {
      void (async () => {
        try {
          const caps = await client.capabilities();
          if (!current()) return;
          if (caps.version !== 1) {
            setState('unsupported');
            return;
          }
          try {
            const result = await client.trace(diagnosticId);
            if (!current()) return;
            const belongs = result?.instance_id === instanceId;
            setTrace(belongs ? result : null);
            setState(belongs ? 'ready' : 'unavailable');
          } catch (error) {
            if (current()) setState(errorStatus(error) === 404 ? 'unavailable' : 'request_failed');
          }
        } catch (error) {
          if (current())
            setState(
              [404, 501].includes(errorStatus(error) ?? 0) ? 'unsupported' : 'request_failed'
            );
        }
      })();
    }
    return () => {
      owner.active = false;
      owner.generation++;
    };
  }, [diagnosticId, instanceId]);

  const countLabel = (value: CacheObservation | undefined, field: 'read' | 'write') => {
    const item = value?.[field];
    return item?.state === 'present'
      ? t(key('reported'), { value: item.value?.toLocaleString() })
      : t(key(item?.state ?? 'legacy_unknown'));
  };
  const querySession = async () => {
    if (!trace?.session_hash || !trace.attempts.length) return;
    const client = captureCacheDiagnosticsClient();
    const owner = requestOwner.current;
    const generation = owner.generation;
    setSnapshotState('loading');
    try {
      const result = await client.session(
        trace.attempts[trace.attempts.length - 1].provider,
        trace.model,
        trace.session_hash,
        trace.id
      );
      if (!owner.active || generation !== owner.generation || !client.isCurrent()) return;
      setSnapshot(result?.instance_id === trace.instance_id ? result : null);
      setSnapshotState(result?.instance_id === trace.instance_id ? 'ready' : 'unavailable');
    } catch {
      if (owner.active && generation === owner.generation && client.isCurrent())
        setSnapshotState('unavailable');
    }
  };
  const compare = async () => {
    if (!trace) return;
    const client = captureCacheDiagnosticsClient();
    const owner = requestOwner.current;
    const generation = owner.generation;
    setCompareState('loading');
    setComparison(null);
    try {
      const baseline = await client.trace(baselineId.trim());
      if (!owner.active || generation !== owner.generation || !client.isCurrent()) return;
      const diff =
        baseline?.instance_id === trace.instance_id
          ? compareCachePayloads(baseline.input, trace.input)
          : null;
      setComparison(diff);
      setCompareState(diff ? 'ready' : 'unavailable');
    } catch {
      if (owner.active && generation === owner.generation && client.isCurrent())
        setCompareState('unavailable');
    }
  };

  return (
    <div className={styles.root} data-cache-diagnostics={state}>
      <dl className={styles.facts}>
        <dt>{t(key('read'))}</dt>
        <dd>{countLabel(cache, 'read')}</dd>
        <dt>{t(key('write'))}</dt>
        <dd>{countLabel(cache, 'write')}</dd>
      </dl>
      {state !== 'ready' && (
        <p role="status" className={styles.muted}>
          {t(key(state))}
        </p>
      )}
      {trace && (
        <>
          {trace.truncated && <p>{t(key('truncated'))}</p>}
          <dl className={styles.facts}>
            <dt>{t(key('record_id'))}</dt>
            <dd>
              <code>{trace.id}</code>
            </dd>
            <dt>{t(key('instance'))}</dt>
            <dd>
              <code>{trace.instance_id}</code>
            </dd>
            <dt>{t(key('logical_request'))}</dt>
            <dd>
              <code>{trace.logical_request_id}</code>
            </dd>
          </dl>
          <details>
            <summary>{t(key('decisions'))}</summary>
            {trace.events.length ? (
              <ol className={styles.events}>
                {trace.events.map((event) => (
                  <li key={event.sequence}>
                    <code>
                      {event.layer} / {event.method}
                    </code>
                    : {event.result}
                    {event.reason && (
                      <> · {t(key(`reason_${event.reason}`), { defaultValue: event.reason })}</>
                    )}
                    {event.examined !== undefined && (
                      <div>{t(key('examined'), { count: event.examined })}</div>
                    )}
                    {event.decision_id && (
                      <div>
                        {t(key('decision'))}: <code>{event.decision_id}</code>
                      </div>
                    )}
                    {event.execution_id && (
                      <div>
                        {t(key('execution'))}: <code>{event.execution_id}</code>
                      </div>
                    )}
                    {event.auth_index && (
                      <>
                        {' '}
                        · {t(key('credential'))} {event.auth_index}
                      </>
                    )}
                    {event.object_hash && (
                      <div>
                        {t(key('object'))}: <code>{event.object_hash}</code>
                      </div>
                    )}
                    {event.prefix_length !== undefined && (
                      <div>
                        {event.prefix_length} {event.prefix_unit}
                      </div>
                    )}
                    {event.changes.length > 0 && (
                      <div>
                        {t(key('changed_fields'))}: <code>{event.changes.join(', ')}</code>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t(key('no_decisions'))}</p>
            )}
          </details>
          {trace.attempts.map((attempt) => {
            const changed = compareCachePayloads(attempt.input ?? trace.input, attempt.request);
            return (
              <details
                className={styles.attempt}
                key={attempt.number}
                data-current-execution={attempt.execution_id === requestId}
              >
                <summary>
                  {t(key('attempt'), { number: attempt.number })} · {attempt.auth_index || '—'} ·{' '}
                  {attempt.transport} · {attempt.status ?? '—'}
                </summary>
                <dl className={styles.facts}>
                  <dt>{t(key('decision'))}</dt>
                  <dd>
                    <code>{attempt.decision_id || '—'}</code>
                  </dd>
                  <dt>{t(key('execution'))}</dt>
                  <dd>
                    <code>{attempt.execution_id}</code>
                  </dd>
                  <dt>{t(key('route'))}</dt>
                  <dd>
                    {attempt.provider} / {attempt.auth_type || '—'} / {attempt.model} /{' '}
                    {attempt.endpoint}
                  </dd>
                  <dt>{t(key('outcome'))}</dt>
                  <dd>{t(key(`outcome_${attempt.outcome}`), { defaultValue: attempt.outcome })}</dd>
                  <dt>{t(key('response_state'))}</dt>
                  <dd>
                    {attempt.response_model || '—'} / {attempt.response_status || '—'}
                  </dd>
                  <dt>{t(key('read'))}</dt>
                  <dd>
                    {countLabel(attempt.cache_observation, 'read')}{' '}
                    {attempt.cache_observation?.read.source && (
                      <code>({attempt.cache_observation.read.source})</code>
                    )}
                  </dd>
                  <dt>{t(key('write'))}</dt>
                  <dd>
                    {countLabel(attempt.cache_observation, 'write')}{' '}
                    {attempt.cache_observation?.write.source && (
                      <code>({attempt.cache_observation.write.source})</code>
                    )}
                  </dd>
                  <dt>{t(key('comparison_sent'))}</dt>
                  <dd>{t(key(`comparison_${attempt.comparison_id_sent}`))}</dd>
                  <dt>{t(key('official'))}</dt>
                  <dd>
                    {attempt.diagnostic_returned
                      ? t(key(`diagnostic_${attempt.diagnostic?.type}`), {
                          defaultValue: attempt.diagnostic?.type,
                        })
                      : t(
                          key(
                            attempt.observation_state === 'observed'
                              ? 'not_returned'
                              : 'not_observed'
                          )
                        )}
                    {attempt.diagnostic?.reason && (
                      <>
                        {' '}
                        · <code>{attempt.diagnostic.reason}</code>
                      </>
                    )}
                  </dd>
                  <dt>{t(key('response_id'))}</dt>
                  <dd>
                    <code>{attempt.response_id || '—'}</code>
                  </dd>
                  <dt>{t(key('wire_difference'))}</dt>
                  <dd>
                    {changed === null ? (
                      t(key('unavailable'))
                    ) : changed.length ? (
                      <code>{changed.join(', ')}</code>
                    ) : (
                      t(key('no_difference'))
                    )}
                  </dd>
                </dl>
                <details>
                  <summary>{t(key('outbound_fields'))}</summary>
                  {attempt.request.known ? (
                    <dl className={styles.facts}>
                      {Object.entries(attempt.request.fields).map(([path, field]) => (
                        <div className={styles.field} key={path}>
                          <dt>
                            <code>{path}</code>
                          </dt>
                          <dd>{field.value || <code>{field.digest}</code>}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p>
                      {t(key('not_observed'))} · {attempt.request.reason}
                    </p>
                  )}
                </details>
                {attempt.response_truncated && <p>{t(key('truncated'))}</p>}
              </details>
            );
          })}
          <div className={styles.actions}>
            <label htmlFor={inputId}>
              {t(key('local_baseline'))}
              <input
                id={inputId}
                value={baselineId}
                onChange={(e) => setBaselineId(e.target.value)}
                maxLength={64}
              />
            </label>
            <Button
              variant="secondary"
              disabled={!/^[a-f0-9]{64}$/i.test(baselineId.trim()) || compareState === 'loading'}
              onClick={() => void compare()}
            >
              {t(key('compare'))}
            </Button>
          </div>
          {compareState && (
            <p role="status">
              {compareState === 'ready' ? (
                comparison?.length ? (
                  <code>{comparison.join(', ')}</code>
                ) : (
                  t(key('no_difference'))
                )
              ) : (
                t(key(compareState))
              )}
            </p>
          )}
          <p className={styles.muted}>{t(key('local_only'))}</p>
          <Button
            variant="secondary"
            disabled={!trace.session_hash || !trace.attempts.length || snapshotState === 'loading'}
            onClick={() => void querySession()}
          >
            {t(key('query_session'))}
          </Button>
          {snapshotState && snapshotState !== 'ready' && (
            <p role="status">{t(key(snapshotState))}</p>
          )}
          {snapshot && (
            <div>
              <p>
                {t(key(`binding_${snapshot.status}`), { defaultValue: snapshot.status })} ·{' '}
                {snapshot.at}
              </p>
              <ul className={styles.events}>
                {snapshot.bindings.map((binding, index) => (
                  <li key={index}>
                    {binding.kind} · {binding.auth_index || '—'} ·{' '}
                    {binding.expired
                      ? t(key('expired'))
                      : t(key('expires'), { at: binding.expires_at })}
                    {binding.prefix_length !== undefined && (
                      <>
                        {' '}
                        · {binding.prefix_length} {binding.prefix_unit}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {snapshot.oauth && (
                <details>
                  <summary>{t(key('oauth_snapshot'))}</summary>
                  <p>
                    {t(key(`oauth_${snapshot.oauth.status}`), {
                      defaultValue: snapshot.oauth.status,
                    })}{' '}
                    · {snapshot.oauth.at}
                  </p>
                  <ul className={styles.events}>
                    {snapshot.oauth.rows.map((row) => (
                      <li key={row.kind + row.object_hash}>
                        {row.kind} · {row.prefix_length ?? '—'} {row.prefix_unit}
                        <div>
                          {t(key('group'))}: <code>{row.group_hash}</code>
                        </div>
                        <div>
                          {row.expired
                            ? t(key('expired'))
                            : t(key('expires'), { at: row.expires_at })}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {snapshot.oauth.truncated && <p>{t(key('truncated'))}</p>}
                </details>
              )}
              {snapshot.truncated && <p>{t(key('truncated'))}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { FLOW_CONTROL_ENDPOINTS } from '@/services/api/flowControl';
import { apiClient } from '@/services/api/client';
import {
  asRecord, flowIssues, mergeMigration, nextRule, parseRules, policyFromValues,
  type FlowControlValues, type FlowRule, type FlowSupport,
} from './model';
import { useFlowControlStatus, type FlowLiveState } from './useStatus';
import { FlowRuleEditor } from './FlowRuleEditor';
import { RuleInspector } from './RuleInspector';
import { LiveMonitor } from './LiveMonitor';
import { ruleSentence } from './insights';
import styles from './styles.module.scss';

type Props = {
  values: FlowControlValues;
  disabled?: boolean;
  onChange: (patch: Partial<FlowControlValues>) => void;
};
type ViewProps = Props & {
  support: FlowSupport;
  onRefresh: () => void;
  live?: boolean;
  setLive?: (value: boolean) => void;
  liveState?: FlowLiveState;
  history?: Array<{ requests: number; attempts: number; waiting: number }>;
};
type MigrationPreview = {
  config: Record<string, unknown>;
  issues: Array<{ rule?: string; reason: string }>;
  ready: boolean;
  source: string;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

export function FlowControlFieldsView({
  values, disabled = false, onChange, support, onRefresh,
  live = false, setLive = () => {}, liveState = 'off', history = [],
}: ViewProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const data = support.state === 'ready' ? support.data : null;
  const supported = !disabled && data?.supported === true && data['schema-version'] >= 3;
  const legacy = Number(values.flowControlVersion || 0) < 3;
  const editable = supported && !legacy;
  const rules = parseRules(values.flowControlRulesText);
  const issues = flowIssues(values);
  const refs = { keys: data?.keys ?? [], accounts: data?.accounts ?? [] };
  const [migration, setMigration] = useState<MigrationPreview | null>(null);
  const [migrationError, setMigrationError] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const source = JSON.stringify(policyFromValues(values));
  const failure = data?.['configuration-failure'];
  const applied = data?.state.policy;
  const observation = data?.state.observation ?? applied?.observation;
  const switchRows = [
    { label: 'enabled', draft: values.flowControlEnabled, applied: data?.state.enabled },
    { label: 'v3_realtime', draft: values.flowControlRealtime, applied: observation?.realtime },
    { label: 'v3_resources', draft: values.flowControlResources, applied: observation?.resources },
  ];
  const stateLabel = (value: boolean | undefined) => t(
    value === undefined ? 'flow_control.v3_unknown' : value ? 'flow_control.switch_on' : 'flow_control.switch_off',
  );
  const changeRules = (items: FlowRule[]) => onChange({ flowControlRulesText: JSON.stringify(items, null, 2) });
  const scalar = (field: keyof FlowControlValues, label: string, placeholder: string, allow = editable) => (
    <Field label={t(`flow_control.${label}`)}>
      <input
        type="number" min="0" step="1" disabled={!allow}
        value={String(values[field])} placeholder={placeholder}
        onChange={e => onChange({ [field]: e.target.value })}
      />
    </Field>
  );

  const previewMigration = async () => {
    setMigrationBusy(true);
    setMigrationError(false);
    setAck(false);
    try {
      const raw = asRecord(await apiClient.post<unknown>(FLOW_CONTROL_ENDPOINTS.migrationPreview, policyFromValues(values)));
      if (!raw || !asRecord(raw.config) || !Array.isArray(raw.issues)) throw new Error('Invalid migration');
      setMigration({
        config: raw.config as Record<string, unknown>,
        issues: raw.issues as MigrationPreview['issues'], ready: raw.ready === true, source,
      });
    } catch {
      setMigrationError(true);
    } finally {
      setMigrationBusy(false);
    }
  };
  const applyMigrationDraft = () => {
    const converted = migration?.config.rules ?? [];
    if (!rules || !Array.isArray(converted)) return;
    onChange({
      flowControlVersion: '3',
      flowControlRulesText: JSON.stringify(mergeMigration(rules, converted as FlowRule[]), null, 2),
    });
  };

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`} data-testid="flow-control-settings">
      <div className={styles.heading}>
        <h3 id={`${id}-title`}>{t('flow_control.title')}</h3>
        <ToggleSwitch
          checked={values.flowControlEnabled} disabled={!supported}
          label={t('flow_control.enabled')} ariaLabel={t('flow_control.enabled')}
          onChange={flowControlEnabled => onChange({ flowControlEnabled })}
        />
      </div>
      <p className={styles.hint}>{t('flow_control.v3_description')}</p>
      <p className={styles.hint}>{t('flow_control.admission_switch_hint')}</p>
      {support.state !== 'ready' && <p role="status">{t(`flow_control.${support.state}`)}</p>}
      {data && data['schema-version'] < 3 && <p className={styles.notice}>{t('flow_control.v3_required')}</p>}
      {data && !data.supported && <p className={styles.notice}>{t('flow_control.home_unsupported')}</p>}
      {data?.['configuration-error'] && (
        <div className="error-box" role="alert">
          <strong>{t('flow_control.runtime_error')}</strong>
          {failure && <p>{failure.message}{failure.rule ? ` (${failure.rule})` : ''}</p>}
          {failure?.['rejected-at'] && <small>{failure['rejected-at']}</small>}
        </div>
      )}
      <div className={styles.table}>
        <table aria-label={t('flow_control.switch_status')}>
          <thead>
            <tr><th>{t('flow_control.switch_status')}</th><th>{t('flow_control.v3_draft')}</th><th>{t('flow_control.v3_running')}</th></tr>
          </thead>
          <tbody>
            {switchRows.map(row => (
              <tr key={row.label}>
                <th>{t(`flow_control.${row.label}`)}</th>
                <td>{stateLabel(row.draft)}</td><td>{stateLabel(row.applied)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.hint}>{t('flow_control.save_apply_hint')}</p>
      <LiveMonitor data={data} live={live} setLive={setLive} liveState={liveState} history={history} onRefresh={onRefresh} />

      <details className={styles.inspector}>
        <summary>{t('flow_control.v3_observation')}</summary>
        <p className={styles.hint}>{t('flow_control.v3_observation_hint')}</p>
        <div className={styles.grid}>
          <ToggleSwitch
            checked={values.flowControlRealtime} disabled={!supported}
            label={t('flow_control.v3_realtime')} ariaLabel={t('flow_control.v3_realtime')}
            onChange={flowControlRealtime => onChange({ flowControlRealtime })}
          />
          <ToggleSwitch
            checked={values.flowControlResources} disabled={!supported}
            label={t('flow_control.v3_resources')} ariaLabel={t('flow_control.v3_resources')}
            onChange={flowControlResources => onChange({ flowControlResources })}
          />
          {scalar('flowControlIntervalMs', 'v3_interval', '2000', supported)}
          {scalar('flowControlMaxObservers', 'v3_observers', '4', supported)}
        </div>
        <p className={styles.hint}>{t('flow_control.resource_switch_hint')}</p>
      </details>

      {legacy && (
        <section className={styles.notice} aria-label={t('flow_control.v3_migration')}>
          <h4>{t('flow_control.v3_migration')}</h4>
          <p>{t('flow_control.v3_migration_hint')}</p>
          <Button
            type="button" variant="secondary" disabled={!supported || migrationBusy}
            onClick={() => { void previewMigration(); }}
          >
            {t('flow_control.v3_migration_preview')}
          </Button>
          {migrationError && <p role="alert">{t('flow_control.v3_migration_error')}</p>}
          {migration && migration.source === source && (
            <>
              {migration.issues.map((value, index) => (
                <p key={index} role="status">{value.rule ? `${value.rule}: ` : ''}{value.reason}</p>
              ))}
              {migration.ready && (
                <>
                  <p>{t('flow_control.v3_migration_ready')}</p>
                  <label>
                    <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                    {t('flow_control.v3_migration_ack')}
                  </label>
                  <Button
                    type="button" variant="secondary" disabled={!ack || !rules || !supported}
                    onClick={applyMigrationDraft}
                  >
                    {t('flow_control.v3_apply_draft')}
                  </Button>
                </>
              )}
            </>
          )}
          {!!rules?.length && (
            <div className={styles.table}><table><tbody>
              {rules.map(rule => (
                <tr key={rule.id}><th>{rule.label || rule.id}</th><td>{ruleSentence(rule, refs, i18n.language)}</td></tr>
              ))}
            </tbody></table></div>
          )}
        </section>
      )}
      {!legacy && (
        <>
          <RuleInspector values={values} data={data} />
          <h4>{t('flow_control.edit_policy')}</h4>
          <div className={styles.grid}>
            {scalar('flowControlMaxWaiting', 'max_waiting', '0')}
            {scalar('flowControlMaxWaitingPerKey', 'max_waiting_key', t('flow_control.same_as_queue'))}
            {scalar('flowControlMaxWaitMs', 'wait_ms', '0')}
            {scalar('flowControlMaxBytes', 'queue_bytes', '67108864')}
          </div>
          <p className={styles.hint}>{t('flow_control.v3_wait_hint')}</p>
          <details>
            <summary>{t('flow_control.memory_bounds')}</summary>
            <div className={styles.grid}>
              {scalar('flowControlMaxBuckets', 'max_buckets', '10000')}
              {scalar('flowControlMaxHistory', 'max_history', '200000')}
            </div>
          </details>
          <p className={styles.notice}>{t('flow_control.v3_rule_hint')}</p>
          {!rules && <p className="error-box">{t('flow_control.invalid_rules')}</p>}
          {values.flowControlEnabled && rules?.length === 0 && (
            <p className={styles.notice}>{t('flow_control.empty_active_policy')}</p>
          )}
          {issues.length > 0 && (
            <div className="error-box" role="alert">
              {issues.slice(0, 8).map((issue, index) => (
                <div key={index}>{issue.rule ? `${issue.rule}: ` : ''}{t(`flow_control.${issue.code}`)}</div>
              ))}
            </div>
          )}
          {data && rules?.map((rule, index) => (
            <FlowRuleEditor
              key={index} rule={rule} index={index} data={data} disabled={!editable}
              onChange={value => changeRules(rules.map((old, position) => position === index ? value : old))}
              onRemove={() => changeRules(rules.filter((_, position) => position !== index))}
            />
          ))}
          <Button
            type="button" variant="secondary" disabled={!editable || !rules || rules.length >= 128}
            onClick={() => rules && changeRules([...rules, nextRule(rules)])}
          >
            {t('flow_control.add_rule')}
          </Button>
        </>
      )}
    </section>
  );
}

export function FlowControlFields(props: Props) {
  const { support, refresh, live, setLive, liveState, history } = useFlowControlStatus();
  return (
    <FlowControlFieldsView
      {...props} support={support} onRefresh={refresh} live={live}
      setLive={setLive} liveState={liveState} history={history}
    />
  );
}

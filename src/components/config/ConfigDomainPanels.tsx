import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible/Collapsible';
import { FlowControlFields } from '@/lts/flowControl/FlowControlFields';
import type { ConfigFieldsProps } from './ConfigFieldControls';
import {
  CONFIG_FIELDS,
  fieldTargetId,
  type ConfigFieldMeta,
  type ConfigDomainId,
  type ConfigPage,
  type ConfigLocation,
  type StandardConfigFieldId,
} from './configNavigation';
import styles from './VisualConfigEditor.module.scss';

type Props = ConfigFieldsProps & {
  page: ConfigPage;
  active: boolean;
  controls: Record<StandardConfigFieldId, ReactNode>;
  issueFields: ReadonlySet<string>;
  onNavigate: (location: ConfigLocation) => void;
};

function FieldsPage({
  page,
  controls,
  values,
  issueFields,
  fieldNotes,
}: Props & {
  fieldNotes?: Partial<Record<StandardConfigFieldId, ReactNode>>;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.fieldsGrid}>
      {page.fields.map((field) => {
        const meta: ConfigFieldMeta = CONFIG_FIELDS[field];
        const content = controls[field as StandardConfigFieldId];
        const note = fieldNotes?.[field as StandardConfigFieldId];
        const count =
          field in values && Array.isArray(values[field as keyof typeof values])
            ? (values[field as keyof typeof values] as unknown[]).length
            : 0;
        return (
          <div
            key={field}
            id={fieldTargetId(field)}
            data-config-field={field}
            data-config-error={issueFields.has(field) || undefined}
            tabIndex={-1}
            className={`${styles.fieldMount} ${meta.fullWidth ? styles.fieldWide : ''} ${note ? styles.fieldWithNote : ''}`}
          >
            {meta.advanced ? (
              <Collapsible
                label={t(meta.labelKey)}
                hint={String(count)}
                defaultOpen={count > 0 || issueFields.has(field)}
                flush
              >
                {content}
              </Collapsible>
            ) : (
              <>
                {meta.heading && <h3 className={styles.fieldHeading}>{t(meta.labelKey)}</h3>}
                {content}
              </>
            )}
            {note}
            {meta.defaultReference && (
              <p className={styles.fieldHint} data-config-default-reference={field}>
                {t('config_management.editor.guidance.default_reference', {
                  value: meta.defaultReference,
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ServicePanel(props: Props) {
  return <FieldsPage {...props} />;
}
function OperationsPanel(props: Props) {
  return <FieldsPage {...props} />;
}
function RoutingPanel(props: Props) {
  return <FieldsPage {...props} />;
}
function HeadersPanel(props: Props) {
  return <FieldsPage {...props} />;
}
function CompatibilityPanel(props: Props) {
  return <FieldsPage {...props} />;
}
function PayloadPanel(props: Props) {
  return <FieldsPage {...props} />;
}
function PluginsPanel(props: Props) {
  return <FieldsPage {...props} />;
}

function CodexPolicyPanel(props: Props) {
  const { t } = useTranslation();
  const action = props.values.codexAbnormalReasoningRetryAction;
  const isDecisionPage = props.page.id === 'scope' || props.page.id === 'hedging';
  const hedgingNote = (
    <div className={styles.fieldCondition}>
      <p data-testid="config-hedging-condition" role="status">
        {t(
          `config_management.editor.guidance.${
            action !== 'retry'
              ? 'hedging_needs_retry'
              : props.values.codexAbnormalReasoningRetryHedgedRetryEnabled
                ? 'hedging_ready'
                : 'hedging_off'
          }`
        )}
      </p>
      {action !== 'retry' && (
        <button
          type="button"
          onClick={() =>
            props.onNavigate({
              section: 'codex-policy',
              subsection: 'scope',
              field: 'codexAbnormalReasoningRetryAction',
            })
          }
        >
          {t('config_management.editor.guidance.open_scope')}
        </button>
      )}
    </div>
  );
  return (
    <>
      {!isDecisionPage && (
        <div className={styles.draftSummary} data-testid="codex-draft-summary">
          <strong>{t('config_management.editor.draft_summary')}</strong>
          <span>
            {t(
              `config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_${action.replace('-', '_')}`
            )}
          </span>
        </div>
      )}
      {!isDecisionPage && action !== 'retry' && (
        <p className={styles.contextNotice}>{t('config_management.editor.inactive_policy')}</p>
      )}
      {props.page.id === 'retry' &&
        action === 'retry' &&
        !props.values.codexAbnormalReasoningRetryStreamBuffer && (
          <p className={styles.attentionNotice} data-testid="config-buffer-warning">
            {t('config_management.editor.guidance.buffer_warning')}
          </p>
        )}
      <FieldsPage
        {...props}
        fieldNotes={
          props.page.id === 'hedging'
            ? { codexAbnormalReasoningRetryHedgedRetryEnabled: hedgingNote }
            : undefined
        }
      />
    </>
  );
}

const CONFIG_DOMAIN_PANELS = {
  service: ServicePanel,
  operations: OperationsPanel,
  routing: RoutingPanel,
  headers: HeadersPanel,
  'codex-policy': CodexPolicyPanel,
  compatibility: CompatibilityPanel,
  payload: PayloadPanel,
  plugins: PluginsPanel,
} satisfies Record<Exclude<ConfigDomainId, 'flow-control'>, (props: Props) => ReactNode>;

export function ConfigDomainPanel({
  section,
  ...props
}: Props & { section: Exclude<ConfigDomainId, 'flow-control'> }) {
  const Panel = CONFIG_DOMAIN_PANELS[section];
  return <Panel {...props} />;
}

// One mounted sidecar preserves migration and observation state across its three pages.
export function FlowControlPanel({
  values,
  disabled,
  onChange,
  active,
  page,
}: ConfigFieldsProps & { active: boolean; page: string }) {
  return (
    <FlowControlFields
      values={values}
      disabled={disabled}
      onChange={onChange}
      active={active}
      page={page}
    />
  );
}

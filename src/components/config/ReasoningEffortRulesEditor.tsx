import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useAuthStore } from '@/stores/useAuthStore';
import { makeClientId, type ReasoningEffortRule } from '@/types/visualConfig';
import { RuleDisclosure } from './RuleDisclosure';
import { StringListEditor } from './VisualConfigEditorBlocks';
import {
  REASONING_EFFORT_LEVELS,
  REASONING_EFFORT_MODES,
  validReasoningEffortRules,
} from './reasoningEffort';
import styles from './ReasoningEffortRulesEditor.module.scss';

export function ReasoningEffortRulesEditor({
  rules,
  disabled,
  onChange,
}: {
  rules: ReasoningEffortRule[];
  disabled?: boolean;
  onChange: (rules: ReasoningEffortRule[]) => void;
}) {
  const { t } = useTranslation();
  const supported = useAuthStore((state) => state.supportsReasoningEffortPolicy);
  const locked = disabled || !supported;
  const key = 'config_management.visual.reasoning_effort';
  const update = (id: string, patch: Partial<ReasoningEffortRule>) =>
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  const move = (index: number, offset: number) => {
    const next = [...rules];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <div className={styles.rules} data-testid="reasoning-effort-rules">
      {!supported && <p role="status">{t(`${key}.unsupported`)}</p>}
      <p>{t(`${key}.help`)}</p>
      {rules.map((rule, index) => (
        <RuleDisclosure
          key={rule.id}
          label={`${rule.models.filter(Boolean).join(', ') || t(`${key}.new_rule`)} · ${t(`${key}.mode_${rule.mode}`, { defaultValue: rule.mode })}${rule.mode === 'follow' ? '' : ` · ${rule.effort}`}`}
          defaultOpen
          hasErrors={!validReasoningEffortRules([rule])}
          action={
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={locked}
              onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
            >
              {t(`${key}.remove`)}
            </Button>
          }
        >
          <div className={styles.rule}>
            <div>
              <p>{t(`${key}.models`)}</p>
              <StringListEditor
                value={rule.models}
                disabled={locked}
                placeholder="glm-*"
                inputAriaLabel={t(`${key}.models`)}
                onChange={(models) => update(rule.id, { models })}
              />
            </div>
            <div className={styles.controls}>
              <div>
                <p>{t(`${key}.mode`)}</p>
                <Select
                  ariaLabel={t(`${key}.mode`)}
                  value={rule.mode}
                  disabled={locked}
                  options={[
                    ...REASONING_EFFORT_MODES,
                    ...(REASONING_EFFORT_MODES.includes(rule.mode) ? [] : [rule.mode]),
                  ].map((value) => ({
                    value,
                    label: t(`${key}.mode_${value}`, { defaultValue: value }),
                  }))}
                  onChange={(mode) =>
                    update(rule.id, {
                      mode,
                      effort: mode === 'follow' ? '' : rule.effort || 'high',
                    })
                  }
                />
              </div>
              {rule.mode !== 'follow' && (
                <div>
                  <p>{t(`${key}.effort`)}</p>
                  <Select
                    ariaLabel={t(`${key}.effort`)}
                    value={rule.effort}
                    disabled={locked}
                    options={[
                      ...REASONING_EFFORT_LEVELS,
                      ...(REASONING_EFFORT_LEVELS.includes(rule.effort) ? [] : [rule.effort]),
                    ].map((value) => ({ value, label: value || t(`${key}.select_effort`) }))}
                    onChange={(effort) => update(rule.id, { effort })}
                  />
                </div>
              )}
            </div>
            {!validReasoningEffortRules([rule]) && (
              <p role="alert">{t('config_management.visual.validation.reasoning_effort_rules')}</p>
            )}
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={locked || index === 0}
                onClick={() => move(index, -1)}
              >
                {t(`${key}.move_up`)}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={locked || index === rules.length - 1}
                onClick={() => move(index, 1)}
              >
                {t(`${key}.move_down`)}
              </Button>
            </div>
          </div>
        </RuleDisclosure>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={locked}
        onClick={() =>
          onChange([...rules, { id: makeClientId(), models: [''], mode: 'follow', effort: '' }])
        }
      >
        {t(`${key}.add`)}
      </Button>
    </div>
  );
}

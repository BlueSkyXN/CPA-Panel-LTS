import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconChevronDown, IconPlus, IconX } from '@/components/ui/icons';
import {
  hasThinkingBudgetRangeError,
  parseThinkingJson,
  readThinkingBudget,
  readThinkingLevels,
  THINKING_EFFORT_LEVELS,
  THINKING_LEVELS,
  type ThinkingLevel,
  updateThinkingBudgetJson,
  updateThinkingLevelsJson,
} from '../../thinkingLevels';
import type { ModelEntryInput } from '../../types';
import styles from './sharedForm.module.scss';

const COLLAPSED_LIMIT = 10;

interface ModelEntriesEditorProps {
  models: ModelEntryInput[];
  supportsImage: boolean;
  supportsThinking: boolean;
  mutating: boolean;
  removeDisabled: boolean;
  onUpdate: (idx: number, patch: Partial<ModelEntryInput>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}

export function ModelEntriesEditor({
  models,
  supportsImage,
  supportsThinking,
  mutating,
  removeDisabled,
  onUpdate,
  onAdd,
  onRemove,
}: ModelEntriesEditorProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const handleAdd = () => {
    // New rows are appended; make sure the truncated list doesn't hide them.
    if (!showAll && models.length >= COLLAPSED_LIMIT) {
      setShowAll(true);
    }
    onAdd();
  };

  const handleRemove = (removeIdx: number) => {
    setExpandedIdx((prev) => {
      if (prev === null || prev === removeIdx) return null;
      return prev > removeIdx ? prev - 1 : prev;
    });
    onRemove(removeIdx);
  };

  const visible = showAll ? models : models.slice(0, COLLAPSED_LIMIT);

  return (
    <>
      {visible.map((entry, idx) => {
        const hasExtendedOptions = supportsImage || supportsThinking;
        const expanded = hasExtendedOptions && expandedIdx === idx;
        const hasThinking = supportsThinking && (entry.thinkingJson ?? '').trim().length > 0;
        let thinkingConfig: Record<string, unknown> | undefined;
        let thinkingJsonInvalid = false;
        try {
          thinkingConfig = parseThinkingJson(entry.thinkingJson);
        } catch {
          thinkingJsonInvalid = true;
        }
        const thinkingLevels = readThinkingLevels(thinkingConfig);
        const thinkingMin = readThinkingBudget(thinkingConfig, 'min');
        const thinkingMax = readThinkingBudget(thinkingConfig, 'max');
        const thinkingBudgetRangeInvalid = hasThinkingBudgetRangeError(thinkingConfig);
        const toggleThinkingLevel = (level: ThinkingLevel) => {
          const nextLevels = thinkingLevels.includes(level)
            ? thinkingLevels.filter((item) => item !== level)
            : THINKING_LEVELS.filter((item) => item === level || thinkingLevels.includes(item));
          onUpdate(idx, {
            thinkingJson: updateThinkingLevelsJson(entry.thinkingJson, nextLevels),
          });
        };
        const updateThinkingBudget = (field: 'min' | 'max', rawValue: string) => {
          const nextValue = rawValue === '' ? undefined : Number(rawValue);
          if (nextValue !== undefined && (!Number.isSafeInteger(nextValue) || nextValue < 0)) {
            return;
          }
          onUpdate(idx, {
            thinkingJson: updateThinkingBudgetJson(entry.thinkingJson, field, nextValue),
          });
        };
        return (
          <div key={idx} className={styles.modelEntry}>
            <div className={styles.modelAliasRow}>
              <input
                className={styles.input}
                placeholder={t('providersPage.form.modelNamePlaceholder')}
                aria-label={t('providersPage.form.modelNamePlaceholder')}
                value={entry.name}
                onChange={(e) => onUpdate(idx, { name: e.target.value })}
                disabled={mutating}
              />
              <input
                className={styles.input}
                placeholder={t('providersPage.form.modelAliasPlaceholder')}
                aria-label={t('providersPage.form.modelAliasPlaceholder')}
                value={entry.alias ?? ''}
                onChange={(e) => onUpdate(idx, { alias: e.target.value })}
                disabled={mutating}
              />
              <input
                className={styles.input}
                placeholder={t('providersPage.form.modelDisplayNamePlaceholder')}
                aria-label={t('providersPage.form.modelDisplayNamePlaceholder')}
                value={entry.displayName ?? ''}
                onChange={(e) => onUpdate(idx, { displayName: e.target.value })}
                disabled={mutating}
              />
              <div className={styles.modelEntryActions}>
                {supportsImage && !expanded && entry.image === true ? (
                  <span className={styles.entryBadge}>
                    {t('providersPage.form.modelBadgeImage')}
                  </span>
                ) : null}
                {supportsThinking && !expanded && hasThinking ? (
                  <span className={styles.entryBadge}>
                    {t('providersPage.form.modelBadgeThinking')}
                  </span>
                ) : null}
                {hasExtendedOptions ? (
                  <button
                    type="button"
                    className={styles.entryCardIconBtn}
                    onClick={() => setExpandedIdx(expanded ? null : idx)}
                    title={expanded ? t('common.collapse') : t('common.expand')}
                    aria-label={expanded ? t('common.collapse') : t('common.expand')}
                    aria-expanded={expanded}
                  >
                    <IconChevronDown
                      className={[
                        styles.entryCardChevron,
                        expanded ? styles.entryCardChevronOpen : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      size={14}
                    />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating || removeDisabled}
                  onClick={() => handleRemove(idx)}
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>
            {expanded ? (
              <div className={styles.modelEntryDetails}>
                {supportsImage ? (
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      className={styles.checkboxBox}
                      checked={entry.image === true}
                      disabled={mutating}
                      onChange={(e) => onUpdate(idx, { image: e.target.checked })}
                    />
                    <span className={styles.checkboxText}>
                      <span>{t('providersPage.form.modelImage')}</span>
                      <small>{t('providersPage.form.modelImageHint')}</small>
                    </span>
                  </label>
                ) : null}
                {supportsThinking ? (
                  <div className={styles.thinkingPanel}>
                    <fieldset className={styles.thinkingFieldset}>
                      <legend className={styles.label}>
                        {t('providersPage.form.thinkingConfig')}
                        <span className={styles.labelHint}>
                          {' '}
                          · {t('providersPage.form.thinkingConfigHint')}
                        </span>
                      </legend>
                      <div className={styles.thinkingStatusRow}>
                        <p
                          className={
                            hasThinking ? styles.thinkingConfiguredHint : styles.thinkingDefaultHint
                          }
                        >
                          {t(
                            hasThinking
                              ? 'providersPage.form.thinkingConfiguredHint'
                              : 'providersPage.form.thinkingDefaultHint'
                          )}
                        </p>
                        {hasThinking ? (
                          <button
                            type="button"
                            className={styles.thinkingResetBtn}
                            disabled={mutating}
                            onClick={() => onUpdate(idx, { thinkingJson: '' })}
                          >
                            {t('providersPage.form.thinkingResetDefault')}
                          </button>
                        ) : null}
                      </div>
                      <div className={styles.thinkingLevelGrid}>
                        {THINKING_EFFORT_LEVELS.map((level) => (
                          <SelectionCheckbox
                            key={level}
                            checked={thinkingLevels.includes(level)}
                            disabled={mutating || thinkingJsonInvalid}
                            onChange={() => toggleThinkingLevel(level)}
                            ariaLabel={t(`providersPage.form.thinkingLevels.${level}`)}
                            className={`${styles.thinkingLevelOption} ${
                              thinkingLevels.includes(level)
                                ? styles.thinkingLevelOptionSelected
                                : ''
                            }`}
                            labelClassName={styles.thinkingLevelLabel}
                            label={
                              <>
                                <span>{t(`providersPage.form.thinkingLevels.${level}`)}</span>
                                <code>{level}</code>
                              </>
                            }
                          />
                        ))}
                      </div>
                      <div className={styles.thinkingBudgetGrid}>
                        <div className={styles.field}>
                          <label
                            className={styles.label}
                            htmlFor={`${fieldId}-thinking-min-${idx}`}
                          >
                            {t('providersPage.form.thinkingMin')}
                          </label>
                          <input
                            id={`${fieldId}-thinking-min-${idx}`}
                            className={styles.input}
                            type="number"
                            min={0}
                            step={1}
                            value={thinkingMin ?? ''}
                            disabled={mutating || thinkingJsonInvalid}
                            aria-invalid={thinkingBudgetRangeInvalid}
                            onChange={(event) => updateThinkingBudget('min', event.target.value)}
                          />
                        </div>
                        <div className={styles.field}>
                          <label
                            className={styles.label}
                            htmlFor={`${fieldId}-thinking-max-${idx}`}
                          >
                            {t('providersPage.form.thinkingMax')}
                          </label>
                          <input
                            id={`${fieldId}-thinking-max-${idx}`}
                            className={styles.input}
                            type="number"
                            min={0}
                            step={1}
                            value={thinkingMax ?? ''}
                            disabled={mutating || thinkingJsonInvalid}
                            aria-invalid={thinkingBudgetRangeInvalid}
                            onChange={(event) => updateThinkingBudget('max', event.target.value)}
                          />
                        </div>
                      </div>
                      <div className={styles.thinkingCapabilityGrid}>
                        {(['none', 'auto'] as const).map((level) => (
                          <SelectionCheckbox
                            key={level}
                            checked={thinkingLevels.includes(level)}
                            disabled={mutating || thinkingJsonInvalid}
                            onChange={() => toggleThinkingLevel(level)}
                            ariaLabel={t(`providersPage.form.thinkingLevels.${level}`)}
                            className={`${styles.thinkingLevelOption} ${
                              thinkingLevels.includes(level)
                                ? styles.thinkingLevelOptionSelected
                                : ''
                            }`}
                            labelClassName={styles.thinkingLevelLabel}
                            label={
                              <>
                                <span>{t(`providersPage.form.thinkingLevels.${level}`)}</span>
                                <code>{level === 'none' ? 'zero_allowed' : 'dynamic_allowed'}</code>
                              </>
                            }
                          />
                        ))}
                      </div>
                      {thinkingJsonInvalid ? (
                        <p className={styles.thinkingError} role="alert">
                          {t('providersPage.form.thinkingInvalidJson')}
                        </p>
                      ) : null}
                      {thinkingBudgetRangeInvalid ? (
                        <p className={styles.thinkingError} role="alert">
                          {t('providersPage.form.thinkingBudgetRangeInvalid')}
                        </p>
                      ) : null}
                    </fieldset>
                    <Collapsible
                      label={t('providersPage.form.thinkingAdvanced')}
                      hint={t('providersPage.form.thinkingAdvancedHint')}
                      className={styles.thinkingAdvanced}
                    >
                      <textarea
                        className={styles.textarea}
                        rows={7}
                        value={entry.thinkingJson ?? ''}
                        onChange={(e) => onUpdate(idx, { thinkingJson: e.target.value })}
                        disabled={mutating}
                        aria-invalid={thinkingJsonInvalid || thinkingBudgetRangeInvalid}
                        placeholder={'{"levels":["low","high","max"],"min":128,"max":32768}'}
                      />
                    </Collapsible>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {models.length > COLLAPSED_LIMIT ? (
        <button type="button" className={styles.showMoreBtn} onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? t('providersPage.form.showFewerEntries')
            : t('providersPage.form.showAllEntries', { count: models.length })}
        </button>
      ) : null}
      <button type="button" className={styles.addBtn} disabled={mutating} onClick={handleAdd}>
        <IconPlus size={12} />
        <span>{t('providersPage.form.addModel')}</span>
      </button>
    </>
  );
}

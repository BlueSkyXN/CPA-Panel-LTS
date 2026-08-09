import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconChevronDown, IconPlus, IconX } from '@/components/ui/icons';
import {
  parseThinkingJson,
  readThinkingLevels,
  THINKING_LEVELS,
  type ThinkingLevel,
  updateThinkingLevelsJson,
} from '../../thinkingLevels';
import type { ModelEntryInput } from '../../types';
import styles from './sharedForm.module.scss';

const COLLAPSED_LIMIT = 10;

interface ModelEntriesEditorProps {
  models: ModelEntryInput[];
  /** OpenAI-compatible entries expose image/thinking options behind a per-row expander. */
  extendedOptions: boolean;
  mutating: boolean;
  removeDisabled: boolean;
  onUpdate: (idx: number, patch: Partial<ModelEntryInput>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}

export function ModelEntriesEditor({
  models,
  extendedOptions,
  mutating,
  removeDisabled,
  onUpdate,
  onAdd,
  onRemove,
}: ModelEntriesEditorProps) {
  const { t } = useTranslation();
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
        const expanded = extendedOptions && expandedIdx === idx;
        const hasThinking = (entry.thinkingJson ?? '').trim().length > 0;
        let thinkingConfig: Record<string, unknown> | undefined;
        let thinkingJsonInvalid = false;
        try {
          thinkingConfig = parseThinkingJson(entry.thinkingJson);
        } catch {
          thinkingJsonInvalid = true;
        }
        const thinkingLevels = readThinkingLevels(thinkingConfig);
        const toggleThinkingLevel = (level: ThinkingLevel) => {
          const nextLevels = thinkingLevels.includes(level)
            ? thinkingLevels.filter((item) => item !== level)
            : THINKING_LEVELS.filter(
                (item) => item === level || thinkingLevels.includes(item)
              );
          onUpdate(idx, {
            thinkingJson: updateThinkingLevelsJson(entry.thinkingJson, nextLevels),
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
                {extendedOptions && !expanded && entry.image === true ? (
                  <span className={styles.entryBadge}>
                    {t('providersPage.form.modelBadgeImage')}
                  </span>
                ) : null}
                {extendedOptions && !expanded && hasThinking ? (
                  <span className={styles.entryBadge}>
                    {t('providersPage.form.modelBadgeThinking')}
                  </span>
                ) : null}
                {extendedOptions ? (
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
                <fieldset className={styles.thinkingFieldset}>
                  <legend className={styles.label}>
                    {t('providersPage.form.thinkingConfig')}
                    <span className={styles.labelHint}>
                      {' '}
                      · {t('providersPage.form.thinkingConfigHint')}
                    </span>
                  </legend>
                  <div className={styles.thinkingLevelGrid}>
                    {THINKING_LEVELS.map((level) => (
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
                  {!thinkingConfig && !thinkingJsonInvalid && entry.image !== true ? (
                    <p className={styles.thinkingDefaultHint}>
                      {t('providersPage.form.thinkingDefaultHint')}
                    </p>
                  ) : null}
                  {thinkingJsonInvalid ? (
                    <p className={styles.thinkingError} role="alert">
                      {t('providersPage.form.thinkingInvalidJson')}
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
                    rows={6}
                    value={entry.thinkingJson ?? ''}
                    onChange={(e) => onUpdate(idx, { thinkingJson: e.target.value })}
                    disabled={mutating}
                    aria-invalid={thinkingJsonInvalid}
                    placeholder={'{"levels":["low","high","max"]}'}
                  />
                </Collapsible>
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

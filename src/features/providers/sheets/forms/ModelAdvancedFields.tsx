import { useTranslation } from 'react-i18next';
import { getProviderModelCapabilities } from '../../descriptors';
import type { ModelEntryInput, ProviderBrand } from '../../types';
import styles from './sharedForm.module.scss';

interface ModelAdvancedFieldsProps {
  entry: ModelEntryInput;
  providerBrand: ProviderBrand;
  disabled: boolean;
  onUpdate: (patch: Partial<ModelEntryInput>) => void;
}

/**
 * Upstream advanced model capabilities. Display name and thinking stay in the LTS model row
 * editor (ModelEntriesEditor), so this renders only the remaining capability fields.
 */
export function ModelAdvancedFields({
  entry,
  providerBrand,
  disabled,
  onUpdate,
}: ModelAdvancedFieldsProps) {
  const { t } = useTranslation();
  const capabilities = getProviderModelCapabilities(providerBrand);
  const textField = (
    key: 'maxContextLength' | 'inputModalitiesText' | 'outputModalitiesText',
    numeric = false
  ) => (
    <label className={styles.field}>
      <span className={styles.label}>{t(`providersPage.modelOptions.${key}`)}</span>
      <input
        className={styles.input}
        value={entry[key] ?? ''}
        inputMode={numeric ? 'numeric' : undefined}
        disabled={disabled}
        onChange={(event) =>
          onUpdate({
            [key]: event.target.value,
            ...(key === 'inputModalitiesText' ? { inputModalitiesTouched: true } : {}),
            ...(key === 'outputModalitiesText' ? { outputModalitiesTouched: true } : {}),
          })
        }
      />
      {key === 'maxContextLength' ? (
        <small>{t('providersPage.modelOptions.contextHint')}</small>
      ) : null}
    </label>
  );
  const checkbox = (
    key: 'forceMapping' | 'isCompat' | 'supportConfigurationUpdate' | 'useMaxCompletionTokens'
  ) => (
    <label className={styles.checkboxRow}>
      <input
        type="checkbox"
        className={styles.checkboxBox}
        checked={entry[key] === true}
        disabled={disabled}
        onChange={(event) => onUpdate({ [key]: event.target.checked })}
      />
      <span className={styles.checkboxText}>{t(`providersPage.modelOptions.${key}`)}</span>
    </label>
  );
  return (
    <>
      {capabilities.maxContextLength ? textField('maxContextLength', true) : null}
      {checkbox('forceMapping')}
      {capabilities.isCompat ? checkbox('isCompat') : null}
      {capabilities.configurationUpdate ? checkbox('supportConfigurationUpdate') : null}
      {capabilities.modalities ? (
        <>
          {textField('inputModalitiesText')}
          {textField('outputModalitiesText')}
          <p className={styles.thinkingExistingHint}>
            {t('providersPage.modelOptions.modalitiesHint')}
          </p>
          {checkbox('useMaxCompletionTokens')}
        </>
      ) : null}
    </>
  );
}

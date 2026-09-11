import { useId, type ReactNode } from 'react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import styles from './VisualConfigEditor.module.scss';
type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

export function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleTitle}>{title}</div>
        {description ? <div className={styles.toggleDescription}>{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
    </div>
  );
}

export function ConfigChoiceGroup({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; description: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <fieldset className={styles.choiceGroup} disabled={disabled}>
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={styles.choiceRow}>
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            aria-labelledby={`${id}-${option.value}-title`}
            aria-describedby={`${id}-${option.value}-description`}
          />
          <span>
            <strong id={`${id}-${option.value}-title`}>{option.label}</strong>
            <span id={`${id}-${option.value}-description`} className={styles.choiceDescription}>
              {option.description}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  hintVariant = 'plain',
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  hintVariant?: 'plain' | 'selection';
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div
          id={hintId}
          className={hintVariant === 'selection' ? styles.fieldSelectionHint : styles.fieldHint}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

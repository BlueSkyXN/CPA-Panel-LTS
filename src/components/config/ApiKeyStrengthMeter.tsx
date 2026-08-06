import { memo, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API_KEY_STRENGTH_SEGMENTS,
  evaluateApiKeyStrength,
  type ApiKeyStrengthTier,
} from '@/utils/apiKeyStrength';
import styles from './VisualConfigEditor.module.scss';

const TIER_COLORS: Record<ApiKeyStrengthTier, string> = {
  weak: 'var(--error-color)',
  fair: 'var(--amber-color)',
  good: 'var(--success-color)',
  strong: 'var(--success-color)',
};

const SEGMENT_STAGGER_MS = 45;
const SEGMENT_INDEXES = Array.from({ length: API_KEY_STRENGTH_SEGMENTS }, (_, index) => index);

/** API key 强度仅作输入提示，不改变既有保存校验。 */
export const ApiKeyStrengthMeter = memo(function ApiKeyStrengthMeter({ value }: { value: string }) {
  const { t } = useTranslation();
  const { tier, segments } = useMemo(() => evaluateApiKeyStrength(value), [value]);
  const empty = segments === 0;
  const tierLabel = empty
    ? t('config_management.visual.api_keys.strength.empty')
    : t(`config_management.visual.api_keys.strength.${tier}`);

  return (
    <div
      className={styles.strengthMeter}
      style={
        {
          '--strength-color': empty ? 'var(--text-quaternary)' : TIER_COLORS[tier],
        } as CSSProperties
      }
    >
      <div
        className={styles.strengthTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={API_KEY_STRENGTH_SEGMENTS}
        aria-valuenow={segments}
        aria-valuetext={tierLabel}
        aria-label={t('config_management.visual.api_keys.strength.label')}
      >
        {SEGMENT_INDEXES.map((index) => (
          <span key={index} className={styles.strengthSegment}>
            <span
              className={styles.strengthSegmentFill}
              data-filled={index < segments}
              style={
                {
                  '--segment-delay': `${index < segments ? index * SEGMENT_STAGGER_MS : 0}ms`,
                } as CSSProperties
              }
            />
          </span>
        ))}
      </div>
      <span className={styles.strengthLabel} aria-hidden="true">
        {empty ? '—' : tierLabel}
      </span>
    </div>
  );
});

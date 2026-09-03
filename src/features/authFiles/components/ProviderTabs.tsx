import { useTranslation } from 'react-i18next';
import { IconFilterAll } from '@/components/ui/icons';
import { getTypeLabel } from '@/features/authFiles/constants';
import { ProviderIcon } from '@/features/authFiles/components/ProviderIcon';
import styles from './ProviderTabs.module.scss';

export type ProviderTabsProps = {
  types: string[];
  counts: Record<string, number>;
  active: string;
  onChange: (type: string) => void;
};

/** Provider filter tabs shared by quota-oriented credential surfaces. */
export function ProviderTabs({ types, counts, active, onChange }: ProviderTabsProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.tabs} role="group" aria-label={t('auth_files.filter_all')}>
      {types.map((type) => {
        const isActive = active === type;
        const label = type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type);

        return (
          <button
            key={type}
            type="button"
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            aria-pressed={isActive}
            onClick={() => onChange(type)}
          >
            {type === 'all' ? (
              <span className={`${styles.tabIconWrap} ${styles.tabAllIconWrap}`}>
                <IconFilterAll className={styles.tabGlyph} size={16} />
              </span>
            ) : (
              <ProviderIcon provider={type} size="nav" className={styles.tabIconWrap} />
            )}
            <span className={styles.tabLabel}>{label}</span>
            <span className={styles.tabCount}>{counts[type] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

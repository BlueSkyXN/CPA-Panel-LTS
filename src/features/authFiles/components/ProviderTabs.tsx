import { useTranslation } from 'react-i18next';
import { IconFilterAll } from '@/components/ui/icons';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import styles from './ProviderTabs.module.scss';

export type ProviderTabsProps = {
  types: string[];
  counts: Record<string, number>;
  active: string;
  resolvedTheme: ResolvedTheme;
  onChange: (type: string) => void;
};

/** Provider filter tabs shared by quota-oriented credential surfaces. */
export function ProviderTabs({ types, counts, active, resolvedTheme, onChange }: ProviderTabsProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.tabs} role="group" aria-label={t('auth_files.filter_all')}>
      {types.map((type) => {
        const isActive = active === type;
        const label = type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type);
        const iconSrc = type === 'all' ? null : getAuthFileIcon(type, resolvedTheme);

        return (
          <button
            key={type}
            type="button"
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            aria-pressed={isActive}
            onClick={() => onChange(type)}
          >
            {type === 'all' ? (
              <IconFilterAll className={styles.tabGlyph} size={15} />
            ) : (
              <span
                className={styles.tabIconWrap}
                style={
                  isThemeSurfaceIconProvider(type)
                    ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                    : undefined
                }
              >
                {iconSrc ? (
                  <img src={iconSrc} alt="" className={styles.tabIcon} />
                ) : (
                  <span className={styles.tabIconFallback}>
                    {label.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            )}
            <span className={styles.tabLabel}>{label}</span>
            <span className={styles.tabCount}>{counts[type] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeColor,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import styles from './ProviderIcon.module.scss';

export type ProviderIconSize = 'card' | 'compact' | 'nav';
export type ProviderIconSurface = 'neutral' | 'brand' | 'theme';

export type ProviderIconProps = {
  provider: string;
  size?: ProviderIconSize;
  surface?: ProviderIconSurface;
  className?: string;
  title?: string;
};

const resolveSurface = (provider: string, surface?: ProviderIconSurface): ProviderIconSurface => {
  if (surface) return surface;
  return isThemeSurfaceIconProvider(provider) ? 'theme' : 'neutral';
};

export function ProviderIcon({
  provider,
  size = 'card',
  surface,
  className,
  title,
}: ProviderIconProps) {
  const { t } = useTranslation();
  const resolvedSurface = resolveSurface(provider, surface);
  const typeLabel = getTypeLabel(t, provider);
  const iconSrc = getAuthFileIcon(provider);
  const typeColor = getTypeColor(provider);
  const wrapClassName = [styles.wrap, styles[size], styles[resolvedSurface], className]
    .filter(Boolean)
    .join(' ');
  const wrapStyle =
    resolvedSurface === 'theme'
      ? { backgroundColor: getThemeSurfaceIconBackground() }
      : resolvedSurface === 'brand'
        ? {
            backgroundColor: typeColor.bg,
            color: typeColor.text,
            ...(typeColor.border ? { border: typeColor.border } : {}),
          }
        : undefined;

  return (
    <span className={wrapClassName} style={wrapStyle} title={title} aria-hidden="true">
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.image} />
      ) : (
        <span className={styles.fallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

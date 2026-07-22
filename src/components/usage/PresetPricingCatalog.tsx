import { useTranslation } from 'react-i18next';
import { IconExternalLink } from '@/components/ui/icons';
import {
  PRICE_CATALOG,
  PRICE_CATALOG_AS_OF,
  PRICE_CATALOG_VERSION,
  formatCompactNumber,
  type PriceCatalogEntry,
  type TokenRates,
} from '@/utils/usage';
import { getCatalogExplicitFastRates, getCatalogSourceLinks } from './presetPricingCatalogUtils';
import styles from './PresetPricingCatalog.module.scss';

interface CatalogBand {
  kind: 'short' | 'long';
  rates: TokenRates;
  thresholdTokens: number | null;
}

interface FastPolicyPresentation {
  label: string;
  detail: string | null;
  tone: 'fast' | 'muted';
}

const formatRate = (value: number): string =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

const getCatalogBands = (entry: PriceCatalogEntry): CatalogBand[] => [
  {
    kind: 'short',
    rates: entry.standard.short,
    thresholdTokens: entry.standard.long?.thresholdTokens ?? null,
  },
  ...(entry.standard.long
    ? [
        {
          kind: 'long' as const,
          rates: entry.standard.long.rates,
          thresholdTokens: entry.standard.long.thresholdTokens,
        },
      ]
    : []),
];

export function PresetPricingCatalog() {
  const { t } = useTranslation();

  const getFastPolicyPresentation = (
    entry: PriceCatalogEntry,
    band: CatalogBand
  ): FastPolicyPresentation => {
    const fast = entry.fast;
    if (!fast) {
      return {
        label: t('usage_stats.pricing_catalog_unavailable'),
        detail: null,
        tone: 'muted',
      };
    }
    if (band.kind === 'long' && !fast.longSupported) {
      return {
        label: t('usage_stats.pricing_long_unsupported'),
        detail: null,
        tone: 'muted',
      };
    }
    if (typeof fast.multiplier === 'number') {
      return {
        label: t('usage_stats.pricing_api_priority_multiplier_official', {
          multiplier: fast.multiplier.toFixed(2),
        }),
        detail: null,
        tone: 'fast',
      };
    }
    const rates = getCatalogExplicitFastRates(entry, band.kind);
    return {
      label: t('usage_stats.pricing_api_priority_explicit_rates'),
      detail:
        rates === null
          ? null
          : t('usage_stats.pricing_catalog_fast_explicit_summary', {
              input: formatRate(rates.input),
              cached: formatRate(rates.cachedInput),
              cacheWrite:
                rates.cacheWrite === undefined
                  ? t('usage_stats.pricing_auto')
                  : formatRate(rates.cacheWrite),
              output: formatRate(rates.output),
            }),
      tone: 'fast',
    };
  };

  return (
    <section
      className={styles.catalog}
      aria-labelledby="preset-pricing-catalog-title"
      data-testid="preset-pricing-catalog"
      data-model-count={PRICE_CATALOG.length}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t('usage_stats.pricing_catalog')}</span>
          <h2 id="preset-pricing-catalog-title">{t('usage_stats.pricing_catalog_title')}</h2>
          <p>
            {t('usage_stats.pricing_catalog_description', {
              count: PRICE_CATALOG.length,
              asOf: PRICE_CATALOG_AS_OF,
            })}
          </p>
        </div>
        <div className={styles.meta}>
          <div className={styles.metaBadges}>
            <span>{PRICE_CATALOG_VERSION}</span>
            <strong>{t('usage_stats.pricing_catalog_unit')}</strong>
          </div>
        </div>
      </header>

      <div
        className={styles.tableRegion}
        role="region"
        aria-label={t('usage_stats.pricing_catalog_table_label')}
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption className={styles.srOnly}>
            {t('usage_stats.pricing_catalog_table_label')}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('usage_stats.model_name')}</th>
              <th scope="col">{t('usage_stats.pricing_catalog_context_band')}</th>
              <th scope="col">{t('usage_stats.pricing_rate_input')}</th>
              <th scope="col">{t('usage_stats.pricing_rate_cached_input')}</th>
              <th scope="col">{t('usage_stats.pricing_rate_cache_write')}</th>
              <th scope="col">{t('usage_stats.pricing_rate_output')}</th>
              <th scope="col">{t('usage_stats.pricing_fast_policies')}</th>
            </tr>
          </thead>
          {PRICE_CATALOG.map((entry) => {
            return (
              <tbody
                key={entry.canonicalModel}
                data-testid="preset-pricing-model"
                data-model={entry.canonicalModel}
              >
                {getCatalogBands(entry).map((band) => {
                  const contextLabel = t(
                    band.kind === 'short'
                      ? 'usage_stats.pricing_catalog_short_band'
                      : 'usage_stats.pricing_catalog_long_band'
                  );
                  const contextDetail =
                    band.thresholdTokens === null
                      ? t('usage_stats.pricing_catalog_all_contexts')
                      : t(
                          band.kind === 'short'
                            ? 'usage_stats.pricing_catalog_short_range'
                            : 'usage_stats.pricing_catalog_long_range',
                          { threshold: formatCompactNumber(band.thresholdTokens) }
                        );
                  const fastPolicy = getFastPolicyPresentation(entry, band);

                  return (
                    <tr key={band.kind} data-context-band={band.kind}>
                      <td className={styles.modelCell} data-label={t('usage_stats.model_name')}>
                        <strong>{entry.canonicalModel}</strong>
                        {entry.aliases.length > 0 && (
                          <small>
                            {t('usage_stats.pricing_catalog_aliases', {
                              aliases: entry.aliases.join(', '),
                            })}
                          </small>
                        )}
                        <small>
                          {t('usage_stats.pricing_catalog_verified_as_of', { asOf: entry.asOf })}
                        </small>
                        <span className={styles.modelLinks}>
                          {getCatalogSourceLinks(entry).map((link) => (
                            <a
                              key={link.kind}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              data-testid={`pricing-${link.kind}-source`}
                            >
                              {t(
                                link.kind === 'official'
                                  ? 'usage_stats.pricing_source'
                                  : 'usage_stats.pricing_catalog_model_notes'
                              )}{' '}
                              <IconExternalLink size={12} />
                            </a>
                          ))}
                        </span>
                      </td>
                      <td
                        className={styles.contextCell}
                        data-label={t('usage_stats.pricing_catalog_context_band')}
                      >
                        {band.kind === 'long' && (
                          <span className={styles.srOnly}>{entry.canonicalModel} — </span>
                        )}
                        <strong>{contextLabel}</strong>
                        <small>{contextDetail}</small>
                      </td>
                      <td
                        className={`${styles.rateCell} ${styles.inputRate}`}
                        data-label={t('usage_stats.pricing_rate_input')}
                      >
                        <strong>{formatRate(band.rates.input)}</strong>
                      </td>
                      <td
                        className={`${styles.rateCell} ${styles.cachedRate}`}
                        data-label={t('usage_stats.pricing_rate_cached_input')}
                      >
                        <strong>{formatRate(band.rates.cachedInput)}</strong>
                      </td>
                      <td
                        className={`${styles.rateCell} ${styles.cacheWriteRate}`}
                        data-label={t('usage_stats.pricing_rate_cache_write')}
                      >
                        {band.rates.cacheWrite === undefined ? (
                          <>
                            <strong>{t('usage_stats.pricing_auto')}</strong>
                            <small>{formatRate(band.rates.input)}</small>
                          </>
                        ) : (
                          <strong>{formatRate(band.rates.cacheWrite)}</strong>
                        )}
                      </td>
                      <td
                        className={`${styles.rateCell} ${styles.outputRate}`}
                        data-label={t('usage_stats.pricing_rate_output')}
                      >
                        <strong>{formatRate(band.rates.output)}</strong>
                      </td>
                      <td
                        className={styles.policyCell}
                        data-label={t('usage_stats.pricing_fast_policies')}
                        data-tone={fastPolicy.tone}
                      >
                        <strong>{fastPolicy.label}</strong>
                        {fastPolicy.detail && <small>{fastPolicy.detail}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </section>
  );
}

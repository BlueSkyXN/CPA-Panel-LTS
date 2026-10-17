import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { AnalyticsGrain, AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';
import { bucketRangeAt, type AnalyticsBucketRange } from './analyticsBucketDrill';
import styles from './AnalyticsBucketDrillControl.module.scss';

interface AnalyticsBucketDrillControlProps {
  id: string;
  times: readonly number[];
  grain: AnalyticsGrain;
  window?: AnalyticsTimeWindow | null;
  onOpen: (bucket: AnalyticsBucketRange) => void;
}

export function AnalyticsBucketDrillControl({
  id,
  times,
  grain,
  window,
  onOpen,
}: AnalyticsBucketDrillControlProps) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState<{ grain: AnalyticsGrain; time: number } | null>(null);
  const index = selection?.grain === grain ? times.indexOf(selection.time) : -1;
  const range = index >= 0 ? bucketRangeAt(times, index, grain, window) : null;
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(grain === 'hour'
      ? ({ hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } as const)
      : {}),
  });

  return (
    <div className={styles.row} data-testid={`analytics-${id}-bucket-drill`}>
      <label className={styles.field}>
        <span>{t('analytics.bucket_label')}</span>
        <select
          data-testid={`analytics-${id}-bucket`}
          value={range && selection ? String(selection.time) : ''}
          onChange={(event) =>
            setSelection(
              event.target.value === '' ? null : { grain, time: Number(event.target.value) }
            )
          }
        >
          <option value="">{t('analytics.select_bucket')}</option>
          {times.map(
            (time, bucketIndex) =>
              bucketRangeAt(times, bucketIndex, grain, window) && (
                <option key={time} value={time}>
                  {formatter.format(new Date(time))}
                </option>
              )
          )}
        </select>
      </label>
      <Button
        variant="secondary"
        size="sm"
        data-testid={`analytics-${id}-bucket-open`}
        disabled={!range}
        onClick={() => {
          if (range) onOpen(range);
        }}
      >
        {t('analytics.open_bucket_records')}
      </Button>
    </div>
  );
}

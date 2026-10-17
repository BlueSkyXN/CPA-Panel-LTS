import type { TFunction } from 'i18next';

export function describeFailureReason(reason: string, t: TFunction): { label: string; title: string } {
  const title = t('usage_stats.request_events_failure_reason', { reason });
  if (reason !== 'bigmodel_1301' && reason !== 'zai_1301') {
    return { label: reason, title };
  }
  return {
    label: `1301 · ${t('usage_stats.request_events_content_safety_block')}`,
    title: `${title}\n${t('usage_stats.request_events_content_safety_block_hint')}`,
  };
}

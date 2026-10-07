import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnalyticsLayout } from './AnalyticsLayout';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useFlowControlStatus } from '@/lts/flowControl/useStatus';
import { LiveMonitor } from '@/lts/flowControl/LiveMonitor';
import { RuleInspector } from '@/lts/flowControl/RuleInspector';
import styles from './AnalyticsPage.module.scss';

export function FlowDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const active = usePageTransitionLayer()?.isCurrentLayer ?? true;
  const { support, refresh, live, setLive, liveState, history } = useFlowControlStatus({ active });
  useHeaderRefresh(refresh, active);
  const data = support.state === 'ready' ? support.data : null;
  return (
    <AnalyticsLayout>
      <div className={styles.header}>
        <div>
          <h1>{t('analytics.flow_dashboard')}</h1>
          <p>{t('analytics.flow_dashboard_hint')}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/analytics/flow/config')}>
          {t('analytics.flow_config')}
        </Button>
      </div>
      {support.state === 'loading' ? (
        <LoadingSpinner />
      ) : support.state !== 'ready' ? (
        <div role="alert">
          <p>{t(`flow_control.${support.state}`)}</p>
          <Button variant="secondary" onClick={refresh}>
            {t('flow_control.refresh')}
          </Button>
        </div>
      ) : (
        <>
          <p className={styles.note}>
            {t('flow_control.enabled')}:{' '}
            {t(data?.state.enabled ? 'flow_control.switch_on' : 'flow_control.switch_off')}
            {' · '}
            {t('flow_control.v3_realtime')}:{' '}
            {t(data?.['events-enabled'] ? 'flow_control.switch_on' : 'flow_control.switch_off')}
          </p>
          {data?.['configuration-error'] && (
            <div className="error-box" role="alert">
              <strong>{t('flow_control.runtime_error')}</strong>
              <p>{data['configuration-failure']?.message}</p>
            </div>
          )}
          <p className={styles.note}>{t('analytics.flow_scope_hint')}</p>
          <LiveMonitor
            data={data}
            live={live}
            setLive={setLive}
            liveState={liveState}
            history={history}
            onRefresh={refresh}
          />
          <RuleInspector data={data} runningOnly />
        </>
      )}
    </AnalyticsLayout>
  );
}

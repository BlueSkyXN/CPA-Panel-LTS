/**
 * Sidebar resident pulse: live connection health, recent request totals,
 * the lowest cached quota window, and Panel/Core build provenance.
 * Replaces the old static config echo grid; every cell links to its source page.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useQuotaStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  collectQuotaCanarySamples,
  compactCount,
  pickQuotaCanary,
  quotaCanaryTone,
  sumTrafficFromAuthFiles,
  trimVersionLabel,
  type TowerTraffic,
} from '@/utils/towerPulse';

const TRAFFIC_REFRESH_MS = 5 * 60_000;

export function TowerPulse() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const geminiCliQuota = useQuotaStore((state) => state.geminiCliQuota);
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const [traffic, setTraffic] = useState<TowerTraffic | null>(null);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      setTraffic(null);
      return;
    }
    let alive = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const payload = await authFilesApi.list();
        if (!alive) return;
        setTraffic(sumTrafficFromAuthFiles(payload?.files ?? []));
      } catch {
        // 保留上一次合计；首次失败时脉冲显示占位符而不是报错。
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), TRAFFIC_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [connectionStatus]);

  const canary = useMemo(
    () =>
      pickQuotaCanary(
        collectQuotaCanarySamples({
          claude: claudeQuota,
          codex: codexQuota,
          geminiCli: geminiCliQuota,
          antigravity: antigravityQuota,
          kimi: kimiQuota,
        })
      ),
    [claudeQuota, codexQuota, geminiCliQuota, antigravityQuota, kimiQuota]
  );

  const canaryTone = canary ? quotaCanaryTone(canary.remainingPercent) : null;
  const versionText =
    [
      trimVersionLabel(__APP_VERSION__ || null) && `P ${trimVersionLabel(__APP_VERSION__ || null)}`,
      trimVersionLabel(serverVersion) && `C ${trimVersionLabel(serverVersion)}`,
    ]
      .filter(Boolean)
      .join(' · ') || '—';

  return (
    <div className="tower-runtime-bar" aria-label={t('workspace.runtime_status')}>
      <span className="tower-runtime-label">CPA-Core-LTS</span>
      <div className="tower-runtime-grid">
        <Link to="/system" className="tower-runtime-item" data-status={connectionStatus}>
          <span>{t('workspace.runtime_connection')}</span>
          <strong>
            <i aria-hidden="true" />
            {connectionStatus === 'connected'
              ? t('common.connected')
              : connectionStatus === 'connecting'
                ? t('common.connecting_status')
                : t('common.disconnected')}
          </strong>
        </Link>
        <Link
          to="/ai-providers"
          className="tower-runtime-item"
          title={t('workspace.pulse_traffic_hint')}
        >
          <span>{t('workspace.pulse_traffic')}</span>
          <strong>
            {traffic ? (
              <>
                {compactCount(traffic.success)}
                {traffic.failure > 0 && (
                  <em data-tone="warn">
                    {' '}
                    · {traffic.failure} {t('workspace.pulse_fail')}
                  </em>
                )}
              </>
            ) : (
              '—'
            )}
          </strong>
        </Link>
        <Link
          to="/quota"
          className="tower-runtime-item"
          title={
            canary
              ? `${canary.file} · ${canary.windowLabel} · ${canary.remainingPercent.toFixed(1)}%`
              : t('workspace.pulse_quota_hint')
          }
        >
          <span>{t('workspace.pulse_quota')}</span>
          <strong data-tone={canaryTone ?? undefined}>
            {canary
              ? `${Math.round(canary.remainingPercent)}% · ${canary.tag}`
              : t('workspace.pulse_quota_empty')}
          </strong>
        </Link>
        <Link
          to="/system"
          className="tower-runtime-item"
          title={t('workspace.pulse_version_hint')}
        >
          <span>{t('workspace.pulse_version')}</span>
          <strong>{versionText}</strong>
        </Link>
      </div>
    </div>
  );
}

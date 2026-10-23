import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { usageQueryApi } from '@/services/api/usageQuery';
import type {
  UsageQueryDetails,
  UsageQueryPage,
  UsageQueryFilter,
  UsageQueryItem,
  UsageQueryOptions,
  UsageQueryRequest,
  UsageQuerySession,
} from '@/types/usageQuery';
import { normalizeUsageSourceId, type UsageDetail } from '@/utils/usage';
import {
  UsageDetailsExport,
  canRetryUsageExport,
  usageExportFailure,
  type UsageExportFailure,
  type UsageExportProgress,
} from './usageDetailsExport';

type ExportState = UsageExportProgress & {
  key: string;
  status: 'idle' | 'loading' | 'generating' | 'error' | 'cancelled' | 'complete';
  failure?: UsageExportFailure;
  canResume: boolean;
};

const emptyExport: ExportState = {
  key: '', status: 'idle', loaded: 0, total: null, retry: 0, canResume: false,
};

export const queryItemDetail = (item: UsageQueryItem): UsageDetail => ({
  ...item.detail,
  source: normalizeUsageSourceId(item.detail.source),
  __queryId: item.id,
  __apiBucket: item.api,
  __modelName: item.model,
  __timestampMs: Date.parse(item.detail.timestamp),
});

export function useUsageQueryDetails(
  session: UsageQuerySession | null,
  range: UsageQueryRequest,
  // null only probes metadata; its unfiltered rows must never reach the table or export.
  filter: (options: UsageQueryOptions | null) => UsageQueryFilter | null
) {
  const scope = useAuthStore((s) => JSON.stringify([s.apiBase, s.managementKey]));
  const baseKey = JSON.stringify([scope, session?.bound, range]);
  const [metadata, setMetadata] = useState<{ key: string; options: UsageQueryOptions } | null>(
    null
  );
  const metadataKey = useRef('');
  const options = metadata?.key === baseKey ? metadata.options : null;
  const appliedFilter = filter(options);
  const key = JSON.stringify([baseKey, appliedFilter]);
  const [navigation, setNavigation] = useState<{
    key: string;
    page: number;
    cursors: string[];
  } | null>(null);
  const requestedPage = navigation?.key === key ? navigation.page : 0;
  const cursor = navigation?.key === key ? (navigation.cursors[requestedPage] ?? '') : '';
  const [retryVersion, setRetryVersion] = useState(0);
  const pageCache = useRef<{ key: string; pages: Map<string, UsageQueryDetails> }>({ key: '', pages: new Map() });
  const [lastPage, setLastPage] = useState<{
    key: string; page: number; data: UsageQueryDetails;
  } | null>(null);
  const [state, setState] = useState<{
    key: string;
    data: UsageQueryDetails | null;
    error: string;
  } | null>(null);
  const requestKey = JSON.stringify([key, requestedPage, cursor, retryVersion]);
  const pageSize = Math.max(1, Math.min(100, session?.max_page_size || 100));
  // include_options 不属于查询身份；只有元数据改变实际筛选条件时才重新查询。
  const serialized = JSON.stringify(
    session
      ? {
          ...range,
          bound: session.bound,
          now_ms: session.now_ms,
          filter: appliedFilter ?? {},
          limit: appliedFilter === null ? 1 : pageSize,
          cursor,
        }
      : null
  );
  const request = useMemo<UsageQueryRequest | null>(() => JSON.parse(serialized), [serialized]);
  useEffect(() => {
    if (!request) return;
    if (pageCache.current.key !== key) pageCache.current = { key, pages: new Map() };
    const pages = pageCache.current.pages;
    const cached = pages.get(serialized);
    if (cached) {
      pages.delete(serialized);
      pages.set(serialized, cached);
      setState({ key: requestKey, data: cached, error: '' });
      setLastPage({ key, page: requestedPage, data: cached });
      return;
    }
    const controller = new AbortController();
    void usageQueryApi
      .details({ ...request, include_options: metadataKey.current !== baseKey }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (request.limit === 1 && metadataKey.current !== baseKey && !data.options)
          throw new Error('Missing usage query options');
        if (data.options) {
          metadataKey.current = baseKey;
          setMetadata({ key: baseKey, options: data.options });
        }
        pages.set(serialized, data);
        if (pages.size > 5) pages.delete(pages.keys().next().value!);
        setState({ key: requestKey, data, error: '' });
        setLastPage({ key, page: requestedPage, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key: requestKey,
            data: null,
            error: error instanceof Error ? error.message : 'Usage query failed',
          });
      });
    return () => controller.abort();
  }, [request, requestKey, baseKey, key, requestedPage, serialized]);
  const current = state?.key === requestKey ? state : null;
  const retained = lastPage?.key === key ? lastPage : null;
  const displayedData = current?.data ?? retained?.data ?? null;
  const page = current?.data ? requestedPage : retained?.page ?? 0;
  const data = useMemo(() => {
    if (!displayedData || appliedFilter !== null) return displayedData;
    const metrics: UsageQueryDetails['metrics'] = { ...displayedData.metrics };
    for (const name of Object.keys(metrics) as (keyof typeof metrics)[]) {
      const value = metrics[name];
      if (typeof value === 'number') Object.assign(metrics, { [name]: 0 });
      else if (Array.isArray(value)) Object.assign(metrics, { [name]: [] });
      else if (value)
        Object.assign(metrics, { [name]: { numerator: 0, denominator: 0, samples: 0 } });
    }
    return { ...displayedData, items: [], total: 0, next_cursor: '', metrics };
  }, [displayedData, appliedFilter]);
  const loading = session !== null && current === null;
  const retry = () => {
    pageCache.current.pages.delete(serialized);
    setRetryVersion((version) => version + 1);
  };
  const setPage = (next: number) => {
    if (!data || loading || appliedFilter === null || next < 0 || next > page + 1) return;
    const cursors = navigation?.key === key ? [...navigation.cursors] : [''];
    if (next > page) {
      if (!data.next_cursor) return;
      cursors[next] = data.next_cursor;
    }
    setNavigation({ key, page: next, cursors });
    if (next === requestedPage) retry();
  };
  const [exportState, setExportState] = useState<ExportState>(emptyExport);
  const activeExport = useRef<{
    key: string; job: UsageDetailsExport<Blob>; controller: AbortController | null;
    fetchPage: (request: UsageQueryRequest, signal?: AbortSignal) => Promise<UsageQueryPage>;
  } | null>(null);
  const currentQueryKey = useRef<string | null>(null);
  useEffect(() => {
    currentQueryKey.current = key;
    return () => {
      currentQueryKey.current = null;
      activeExport.current?.controller?.abort();
      activeExport.current = null;
    };
  }, [key]);
  const isCurrentConnection = () => {
    const auth = useAuthStore.getState();
    return JSON.stringify([auth.apiBase, auth.managementKey]) === scope;
  };
  const isCurrentQuery = () => currentQueryKey.current === key && isCurrentConnection();
  const isExportCurrent = () =>
    activeExport.current?.key === key &&
    activeExport.current.controller !== null &&
    !activeExport.current.controller.signal.aborted && isCurrentConnection();
  const cancelExport = () => {
    const active = activeExport.current;
    active?.controller?.abort();
    activeExport.current = null;
    setExportState({ ...emptyExport, ...active?.job.progress, key, status: 'cancelled' });
  };
  const finishExport = () => {
    if (!isExportCurrent()) return;
    setExportState({ ...emptyExport, ...activeExport.current!.job.progress, key, status: 'complete' });
    activeExport.current = null;
  };
  const exportDetails = async (
    convert: (details: UsageDetail[], first: boolean) => string,
    resume = false
  ): Promise<Blob[] | null> => {
    if (!request || appliedFilter === null) return [];
    if (activeExport.current?.controller) return null;
    const useBulkExport = session?.export_version === 1 && (session.max_export_page_size ?? 0) > 0;
    const fetchPage = resume && activeExport.current?.key === key
      ? activeExport.current.fetchPage
      : useBulkExport ? usageQueryApi.exportPage : usageQueryApi.details;
    const exportLimit = useBulkExport
      ? Math.min(1000, session!.max_export_page_size!)
      : Math.max(1, Math.min(200, session?.max_page_size || 200));
    const job = resume && activeExport.current?.key === key
      ? activeExport.current.job
      : new UsageDetailsExport(
          { ...request, limit: exportLimit },
          (items, first) => new Blob([convert(items.map(queryItemDetail), first)])
        );
    const controller = new AbortController();
    const active = { key, job, controller, fetchPage };
    activeExport.current = active;
    const isCurrent = () => activeExport.current === active && isCurrentConnection();
    try {
      const items = await job.run(fetchPage, controller.signal, isCurrent, (progress) => {
        if (isCurrent() && !controller.signal.aborted)
          setExportState({ ...progress, key, status: 'loading', canResume: false });
      });
      if (!isCurrent() || controller.signal.aborted) return null;
      setExportState({ ...job.progress, key, status: 'generating', canResume: false });
      return items;
    } catch (error) {
      if (!isCurrent() || controller.signal.aborted) return null;
      const canResume = canRetryUsageExport(error);
      setExportState({ ...job.progress, key, status: 'error', failure: usageExportFailure(error), canResume });
      activeExport.current = canResume ? { ...active, controller: null } : null;
      return null;
    }
  };
  return {
    options,
    data,
    error: current?.error ?? '',
    loading,
    page,
    requestedPage,
    pageSize,
    setPage,
    retry,
    exportDetails,
    exportState: exportState.key === key ? exportState : emptyExport,
    cancelExport,
    finishExport,
    isExportCurrent,
    isCurrentConnection,
    isCurrentQuery,
  };
}

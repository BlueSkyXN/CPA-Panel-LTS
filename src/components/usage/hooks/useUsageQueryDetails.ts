import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { usageQueryApi } from '@/services/api/usageQuery';
import type {
  UsageQueryDetails,
  UsageQueryFilter,
  UsageQueryItem,
  UsageQueryOptions,
  UsageQueryRequest,
  UsageQuerySession,
} from '@/types/usageQuery';
import { normalizeUsageSourceId, type UsageDetail } from '@/utils/usage';

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
  filter: (options: UsageQueryOptions | null) => UsageQueryFilter
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
  const page = navigation?.key === key ? navigation.page : 0;
  const cursor = navigation?.key === key ? (navigation.cursors[page] ?? '') : '';
  const [state, setState] = useState<{
    key: string;
    data: UsageQueryDetails | null;
    error: string;
  } | null>(null);
  const requestKey = JSON.stringify([key, page, cursor]);
  // options 只控制首次附带元数据，不改变查询身份，也不会因此补发第二个请求。
  const serialized = JSON.stringify(
    session
      ? {
          ...range,
          bound: session.bound,
          now_ms: session.now_ms,
          filter: appliedFilter,
          limit: 100,
          cursor,
        }
      : null
  );
  const request = useMemo<UsageQueryRequest | null>(() => JSON.parse(serialized), [serialized]);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void usageQueryApi
      .details({ ...request, include_options: metadataKey.current !== baseKey }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.options) {
          metadataKey.current = baseKey;
          setMetadata({ key: baseKey, options: data.options });
        }
        setState({ key: requestKey, data, error: '' });
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
  }, [request, requestKey, baseKey]);
  const current = state?.key === requestKey ? state : null;
  const setPage = (next: number) => {
    if (!current?.data || next < 0) return;
    const cursors = navigation?.key === key ? [...navigation.cursors] : [''];
    if (next > page) {
      if (!current.data.next_cursor) return;
      cursors[next] = current.data.next_cursor;
    }
    setNavigation({ key, page: next, cursors });
  };
  const exportDetails = async (): Promise<UsageDetail[]> => {
    if (!request) return [];
    const result: UsageDetail[] = [];
    let next = '';
    do {
      const auth = useAuthStore.getState();
      if (JSON.stringify([auth.apiBase, auth.managementKey]) !== scope)
        throw new Error('Connection changed');
      const data = await usageQueryApi.details({
        ...request,
        cursor: next,
        include_options: false,
        limit: 200,
      });
      result.push(...data.items.map(queryItemDetail));
      next = data.next_cursor ?? '';
    } while (next);
    return result;
  };
  return {
    options,
    data: current?.data ?? null,
    error: current?.error ?? '',
    loading: session !== null && current === null,
    page,
    setPage,
    exportDetails,
  };
}

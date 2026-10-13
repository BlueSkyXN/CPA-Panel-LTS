import type { UsageQueryPage, UsageQueryItem, UsageQueryRequest } from '@/types/usageQuery';

export type UsageExportFailure = 'failed' | 'expired' | 'incomplete';
export interface UsageExportProgress {
  loaded: number;
  total: number | null;
  retry: number;
}

class ExportIntegrityError extends Error {}

const errorField = (error: unknown, field: string): unknown =>
  typeof error === 'object' && error !== null && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;

export const usageExportFailure = (error: unknown): UsageExportFailure => {
  if (error instanceof ExportIntegrityError) return 'incomplete';
  if (errorField(error, 'status') === 409) return 'expired';
  return 'failed';
};

export const canRetryUsageExport = (error: unknown): boolean => {
  const status = errorField(error, 'status');
  if (typeof status === 'number') return [408, 429, 500, 502, 503, 504].includes(status);
  return ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(String(errorField(error, 'code')));
};

const checkActive = (signal: AbortSignal, isCurrent: () => boolean) => {
  if (signal.aborted || !isCurrent()) throw new DOMException('Export stopped', 'AbortError');
};

const waitForRetry = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Export stopped', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });

// 只在内存中保留已校验批次；重试从未完成的游标继续，禁止跨查询边界拼接。
export class UsageDetailsExport<T> {
  private parts: T[] = [];
  private loaded = 0;
  private ids = new Set<string>();
  private cursors = new Set<string>(['']);
  private cursor = '';
  private total: number | null = null;
  private complete = false;

  constructor(
    private readonly request: UsageQueryRequest,
    private readonly convert: (items: UsageQueryItem[], first: boolean) => T
  ) {}

  get progress(): UsageExportProgress {
    return { loaded: this.loaded, total: this.total, retry: 0 };
  }

  async run(
    fetchPage: (request: UsageQueryRequest, signal: AbortSignal) => Promise<UsageQueryPage>,
    signal: AbortSignal,
    isCurrent: () => boolean,
    onProgress: (progress: UsageExportProgress) => void,
    retryDelayMs = 500
  ): Promise<T[]> {
    checkActive(signal, isCurrent);
    onProgress(this.progress);
    while (!this.complete) {
      let data: UsageQueryPage;
      for (let attempt = 0; ; attempt += 1) {
        checkActive(signal, isCurrent);
        try {
          data = await fetchPage(
            { ...this.request, cursor: this.cursor, include_options: false },
            signal
          );
          checkActive(signal, isCurrent);
          break;
        } catch (error) {
          checkActive(signal, isCurrent);
          if (attempt >= 2 || !canRetryUsageExport(error)) throw error;
          onProgress({ ...this.progress, retry: attempt + 1 });
          await waitForRetry(retryDelayMs * 2 ** attempt, signal);
        }
      }

      const next = data.next_cursor ?? '';
      const loaded = this.loaded + data.items.length;
      const pageIds = new Set(data.items.map((item) => item.id));
      if (
        data.bound !== this.request.bound ||
        !Number.isSafeInteger(data.total) || data.total < 0 ||
        (this.total !== null && data.total !== this.total) ||
        pageIds.size !== data.items.length ||
        data.items.some((item) => !item.id || this.ids.has(item.id)) ||
        loaded > data.total ||
        (next ? !data.items.length || this.cursors.has(next) || loaded >= data.total : loaded !== data.total)
      ) {
        throw new ExportIntegrityError('Incomplete or inconsistent usage export');
      }

      // 整批验证通过后才推进 checkpoint，失败批次不会留下重复数据。
      // 每批只保留最终文件片段；让浏览器在转换之间处理绘制和取消。
      await waitForRetry(0, signal);
      checkActive(signal, isCurrent);
      const part = this.convert(data.items, this.loaded === 0);
      checkActive(signal, isCurrent);
      this.parts.push(part);
      this.loaded = loaded;
      pageIds.forEach((id) => this.ids.add(id));
      this.total = data.total;
      this.cursor = next;
      if (next) this.cursors.add(next);
      this.complete = !next;
      onProgress(this.progress);
    }
    return this.parts;
  }
}

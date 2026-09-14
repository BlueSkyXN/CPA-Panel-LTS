import { useCallback, useSyncExternalStore } from 'react';
import {
  MULTI_INSTANCE_KEY,
  readMultiInstanceEnabled,
  writeMultiInstanceEnabled,
} from '@/services/storage/connectionProfiles';

const CHANGE_EVENT = 'cpa-multi-instance-change';

function subscribe(onChange: () => void) {
  // 本文档写入不触发 storage 事件，用自定义事件补齐；宿主与各实例帧靠它保持一致。
  window.addEventListener('storage', handleStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function handleStorage(event: StorageEvent) {
  if (event.key === MULTI_INSTANCE_KEY || event.key === null)
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 多实例管理开关：默认关闭，开启状态跨标签页与宿主/实例帧共享。 */
export function useMultiInstanceEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readMultiInstanceEnabled, () => false);
  const setEnabled = useCallback((next: boolean) => {
    writeMultiInstanceEnabled(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [enabled, setEnabled];
}

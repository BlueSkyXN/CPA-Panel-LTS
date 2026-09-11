import type { ConnectionStatus } from '@/types';
import type { ConnectionProfile } from '@/services/storage/connectionProfiles';

export const SESSION_PARAM = 'cpa-session';

function connectionFrameId(): string | null {
  return (
    new URLSearchParams(window.location.search).get(SESSION_PARAM) ||
    (typeof document !== 'undefined' ? document.documentElement.dataset.cpaSession || null : null)
  );
}

export interface ConnectionBootstrap {
  profile: ConnectionProfile;
  managementKey: string;
}

export interface ConnectionControls {
  inspect: () => { dirty: boolean; busy: boolean };
}

export interface ConnectionHost {
  bootstrap: (id: string, source: Window) => ConnectionBootstrap | null;
  report: (id: string, source: Window, status: ConnectionStatus, path: string) => void;
  register: (id: string, source: Window, controls: ConnectionControls | null) => void;
  open: (id: string, source: Window, profileId?: string) => void;
  disconnect: (id: string, source: Window) => void;
}

declare global {
  interface Window {
    __cpaConnectionHost?: ConnectionHost;
  }
}

export function isConnectionFrame(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.parent) &&
    Boolean(window.location) &&
    window.parent !== window &&
    Boolean(connectionFrameId())
  );
}

export function getConnectionFrameElement(): Element | null {
  return isConnectionFrame() ? window.frameElement : null;
}

// 在 React 挂载前保存单文件模板，不能序列化正在显示的页面、表单或其他会话。
const standaloneTemplate =
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  window.location?.protocol === 'file:' &&
  !isConnectionFrame()
    ? (document.documentElement.cloneNode(true) as HTMLElement)
    : null;

if (isConnectionFrame() && window.location.href === 'about:srcdoc') {
  const path = document.documentElement.dataset.cpaSessionPath || '/';
  window.history.replaceState(
    null,
    '',
    `about:srcdoc#${path.startsWith('/') && !path.startsWith('//') ? path : '/'}`
  );
}

let managed:
  | { id: string; host: ConnectionHost; bootstrap: ConnectionBootstrap }
  | null
  | undefined;

/** 只接受同源父 Panel 为当前 iframe 分配的会话；URL 不携带地址或密钥。 */
export function getManagedConnection() {
  if (managed !== undefined) return managed;
  if (!isConnectionFrame()) return null;
  try {
    const id = connectionFrameId()!;
    const host = window.parent.__cpaConnectionHost;
    const bootstrap = host?.bootstrap(id, window);
    managed = host && bootstrap ? { id, host, bootstrap } : null;
  } catch {
    managed = null;
  }
  return managed;
}

export function sessionWasLoggedIn(): boolean {
  return isConnectionFrame()
    ? Boolean(getManagedConnection())
    : sessionStorage.getItem('isLoggedIn') === 'true';
}

export function setSessionLoggedIn(value: boolean): void {
  if (isConnectionFrame()) return;
  if (value) sessionStorage.setItem('isLoggedIn', 'true');
  else sessionStorage.removeItem('isLoggedIn');
}

export function connectionFrameUrl(id: string, path: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(SESSION_PARAM, id);
  url.hash = path;
  return url.toString();
}

/** file:// 的兄弟文档可能被视为不同源；srcdoc 继承父文档的源，无需放宽浏览器权限。 */
export function connectionFrameDocument(id: string, path: string): string | undefined {
  if (!standaloneTemplate) return undefined;
  const template = standaloneTemplate.cloneNode(true) as HTMLElement;
  template.querySelector('#root')?.replaceChildren();
  template.dataset.cpaSession = id;
  template.dataset.cpaSessionPath = path;
  return `<!doctype html>${template.outerHTML}`;
}

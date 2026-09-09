const leaveChecks = new Set<() => boolean>();
const busyChecks = new Set<() => boolean>();
let frozen = false;
let activeWrites = 0;

export function registerSessionLeaveCheck(check: () => boolean): () => void {
  leaveChecks.add(check);
  return () => {
    leaveChecks.delete(check);
  };
}
export const hasSessionChanges = () => [...leaveChecks].some((check) => check());
export const hasActiveWrites = () => activeWrites > 0 || [...busyChecks].some((check) => check());
export function registerSessionBusyCheck(check: () => boolean): () => void {
  busyChecks.add(check);
  return () => {
    busyChecks.delete(check);
  };
}
export const setSessionFrozen = (value: boolean) => {
  frozen = value;
};
export const isSessionFrozen = () => frozen;
export function beginSessionWrite(): () => void {
  activeWrites += 1;
  let finished = false;
  return () => {
    if (!finished) activeWrites -= 1;
    finished = true;
  };
}

export function safeSessionPath(path: string): string {
  const pathname = path.split('?')[0];
  if (pathname.startsWith('/ai-providers/')) return '/ai-providers';
  if (pathname.startsWith('/auth-files/')) return '/auth-files';
  if (pathname.startsWith('/plugin-pages/')) return '/core';
  const allowed = [
    '/',
    '/dashboard',
    '/core',
    '/usage',
    '/usage/events',
    '/usage/pricing',
    '/quota',
    '/config',
    '/logs',
    '/system',
    '/ai-providers',
    '/auth-files',
    '/oauth',
    '/plugins',
    '/plugin-store',
  ];
  return allowed.includes(pathname) ? pathname : '/core';
}

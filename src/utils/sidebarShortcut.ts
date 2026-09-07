export function isSidebarToggleShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (
    event.metaKey === event.ctrlKey ||
    event.key.toLowerCase() !== 'b' ||
    event.altKey || event.shiftKey || event.repeat || event.defaultPrevented || event.isComposing
  ) return false;

  const target = event.target as HTMLElement | null;
  return !target || (
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) &&
    !target.isContentEditable &&
    !target.closest?.('[role="textbox"]')
  );
}

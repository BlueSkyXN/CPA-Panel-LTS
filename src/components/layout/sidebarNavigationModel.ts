import type { ReactNode } from 'react';

export interface SidebarNavLinkItem {
  kind: 'link';
  path: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  end?: boolean;
}

export interface SidebarNavDrawerItem {
  kind: 'drawer';
  id: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  /** A drawer with a path keeps its primary page one click away. */
  path?: string;
  children: SidebarNavLinkItem[];
}

export type SidebarNavItem = SidebarNavLinkItem | SidebarNavDrawerItem;

export interface SidebarNavGroup {
  id: string;
  label: string;
  items: SidebarNavItem[];
  placement?: 'default' | 'bottom';
}

/** Returns navigable paths in their visual order for page transitions. */
export const flattenSidebarNavPaths = (groups: SidebarNavGroup[]) =>
  groups.flatMap((group) =>
    group.items.flatMap((item) => {
      if (item.kind === 'link') return [item.path];
      return [...(item.path ? [item.path] : []), ...item.children.map((child) => child.path)];
    })
  );

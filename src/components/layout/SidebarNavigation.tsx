import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { IconChevronDown } from '@/components/ui/icons';
import type {
  SidebarNavDrawerItem,
  SidebarNavGroup,
  SidebarNavLinkItem,
} from './sidebarNavigationModel';

interface SidebarNavigationProps {
  groups: SidebarNavGroup[];
  collapsed: boolean;
  showLabels: boolean;
  showMeta: boolean;
  ariaLabel: string;
  onNavigate: () => void;
  onRequestExpand: () => void;
}

const isPathActive = (pathname: string, path: string, end = false) =>
  pathname === path || (!end && path !== '/' && pathname.startsWith(`${path}/`));

const isDrawerActive = (pathname: string, item: SidebarNavDrawerItem) =>
  (item.path ? isPathActive(pathname, item.path) : false) ||
  item.children.some((child) => isPathActive(pathname, child.path, child.end));

const getCollapsedTitle = (item: SidebarNavLinkItem | SidebarNavDrawerItem) =>
  [item.label, item.meta].filter(Boolean).join(' — ');

export function SidebarNavigation({
  groups,
  collapsed,
  showLabels,
  showMeta,
  ariaLabel,
  onNavigate,
  onRequestExpand,
}: SidebarNavigationProps) {
  const location = useLocation();
  const activeDrawerIDs = useMemo(
    () =>
      groups
        .flatMap((group) => group.items)
        .filter((item): item is SidebarNavDrawerItem => item.kind === 'drawer')
        .filter((item) => isDrawerActive(location.pathname, item))
        .map((item) => item.id),
    [groups, location.pathname]
  );
  const [drawerState, setDrawerState] = useState(() => ({
    pathname: location.pathname,
    openDrawerIDs: new Set(activeDrawerIDs),
  }));

  const toggleDrawer = (id: string) => {
    if (collapsed) {
      onRequestExpand();
      setDrawerState((current) => {
        const next = new Set(
          current.pathname === location.pathname ? current.openDrawerIDs : activeDrawerIDs
        );
        next.add(id);
        return { pathname: location.pathname, openDrawerIDs: next };
      });
      return;
    }

    setDrawerState((current) => {
      const next = new Set(
        current.pathname === location.pathname ? current.openDrawerIDs : activeDrawerIDs
      );
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { pathname: location.pathname, openDrawerIDs: next };
    });
  };

  const handleLinkNavigate = () => {
    if (collapsed) onRequestExpand();
    onNavigate();
  };

  const renderNavLink = (item: SidebarNavLinkItem, className = 'nav-item') => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.end}
      className={({ isActive }) => `${className} ${isActive ? 'active' : ''}`}
      onClick={handleLinkNavigate}
      title={showLabels ? undefined : getCollapsedTitle(item)}
      aria-label={item.label}
    >
      <span className="nav-icon">{item.icon}</span>
      {showLabels ? (
        <span className="nav-text">
          <span className="nav-label">{item.label}</span>
          {showMeta && item.meta ? <span className="nav-meta">{item.meta}</span> : null}
        </span>
      ) : null}
      {typeof item.badge === 'number' && item.badge > 0 ? (
        <span className="nav-badge" aria-hidden="true">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
    </NavLink>
  );

  const renderDrawer = (item: SidebarNavDrawerItem) => {
    const isActive = isDrawerActive(location.pathname, item);
    const isOpen =
      drawerState.pathname === location.pathname
        ? drawerState.openDrawerIDs.has(item.id)
        : isActive;
    const panelID = `sidebar-drawer-${item.id}`;
    const drawerClassName = `nav-drawer ${isActive ? 'active' : ''} ${isOpen ? 'open' : ''}`;

    return (
      <div className={drawerClassName} key={item.id}>
        {item.path ? (
          <div className="nav-drawer-row">
            <NavLink
              to={item.path}
              className={`nav-item nav-drawer-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkNavigate}
              title={showLabels ? undefined : getCollapsedTitle(item)}
              aria-label={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              {showLabels ? (
                <span className="nav-text">
                  <span className="nav-label">{item.label}</span>
                  {showMeta && item.meta ? <span className="nav-meta">{item.meta}</span> : null}
                </span>
              ) : null}
            </NavLink>
            {showLabels ? (
              <button
                type="button"
                className={`nav-drawer-action ${isOpen ? 'open' : ''}`}
                onClick={() => toggleDrawer(item.id)}
                aria-label={item.label}
                aria-expanded={isOpen}
                aria-controls={panelID}
              >
                <IconChevronDown size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className={`nav-item nav-drawer-toggle ${isActive ? 'active' : ''} ${
              isOpen ? 'open' : ''
            }`}
            onClick={() => toggleDrawer(item.id)}
            title={showLabels ? undefined : getCollapsedTitle(item)}
            aria-label={item.label}
            aria-expanded={isOpen}
            aria-controls={panelID}
          >
            <span className="nav-icon">{item.icon}</span>
            {showLabels ? (
              <>
                <span className="nav-text">
                  <span className="nav-label">{item.label}</span>
                  {showMeta && item.meta ? <span className="nav-meta">{item.meta}</span> : null}
                </span>
                <span className="nav-drawer-caret" aria-hidden="true">
                  <IconChevronDown size={14} />
                </span>
              </>
            ) : null}
          </button>
        )}

        {isOpen && showLabels ? (
          <div id={panelID} className="nav-sub-list">
            {item.children.map((child) => renderNavLink(child, 'nav-item nav-sub-item'))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <nav className="nav-section" aria-label={ariaLabel}>
      {groups.map((group, index) => (
        <section
          className={`nav-group ${group.placement === 'bottom' ? 'nav-group-bottom' : ''}`}
          key={group.id}
          aria-label={group.label}
        >
          {showLabels ? (
            <div className="nav-group-label">{group.label}</div>
          ) : (
            index > 0 && <div className="nav-group-divider" aria-hidden="true" />
          )}
          {group.items.map((item) =>
            item.kind === 'link' ? renderNavLink(item) : renderDrawer(item)
          )}
        </section>
      ))}
    </nav>
  );
}

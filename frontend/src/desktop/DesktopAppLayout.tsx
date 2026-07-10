import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ConnectionBanner } from './ConnectionBanner';
import { DesktopThemeToggle } from './DesktopThemeToggle';
import type { DesktopTheme } from './desktopTheme';
import type { DesktopConnectionState } from './useDesktopConnection';

export type DesktopNavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  badge?: number;
};

function desktopNavLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'desktopSidebarLink desktopSidebarLink--active' : 'desktopSidebarLink';
}

function pageTitleFromPath(pathname: string, items: DesktopNavItem[]): string {
  const exact = items.find((item) => item.end && (pathname === item.to || pathname === `${item.to}/`));
  if (exact) {
    return exact.label;
  }
  const prefix = items.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  return prefix?.label ?? 'Раздел';
}

export function DesktopAppLayout({
  connection,
  adminError,
  navItems,
  userLabel,
  roleLabel,
  onLogout,
  hideLogout = false,
  hideConnectionStatus = false,
  directorAccountSwitcher,
  syncToolbar,
  desktopTheme,
  onDesktopThemeChange,
  children,
}: {
  connection: DesktopConnectionState;
  adminError?: string;
  navItems: DesktopNavItem[];
  userLabel?: string;
  roleLabel?: string;
  onLogout: () => void;
  hideLogout?: boolean;
  hideConnectionStatus?: boolean;
  directorAccountSwitcher?: ReactNode;
  syncToolbar?: ReactNode;
  desktopTheme: DesktopTheme;
  onDesktopThemeChange: (theme: DesktopTheme) => void;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const pageTitle = pageTitleFromPath(pathname, navItems);

  return (
    <div className="desktopShellLayout">
      <aside className="desktopSidebar" aria-label="Разделы приложения">
        <div className="desktopSidebarBrand">
          <span className="desktopSidebarLogo" aria-hidden>
            Ф
          </span>
          <div className="desktopSidebarBrandText">
            <span className="desktopSidebarTitle">Фотографы</span>
            <span className="desktopSidebarTagline">Учёт и продажи</span>
          </div>
        </div>

        <p className="desktopSidebarSectionLabel">Разделы</p>
        <nav className="desktopSidebarNav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={desktopNavLinkClass}
              title={item.label}
            >
              <span className="desktopSidebarLinkIndicator" aria-hidden />
              <span className="desktopSidebarNavIcon" aria-hidden>
                {item.icon}
              </span>
              <span className="desktopSidebarNavLabel">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 ? (
                <span className="desktopSidebarNavBadge">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <footer className="desktopSidebarFooter">
          {directorAccountSwitcher ?? (
            <div className="desktopSidebarUserCard">
              <span className="desktopSidebarUserAvatar" aria-hidden>
                {(userLabel?.trim()[0] ?? '?').toUpperCase()}
              </span>
              <div className="desktopSidebarUserMeta">
                {userLabel ? <span className="desktopSidebarUserName">{userLabel}</span> : null}
                {roleLabel ? <span className="desktopSidebarUserRole">{roleLabel}</span> : null}
              </div>
            </div>
          )}
          <DesktopThemeToggle theme={desktopTheme} onChange={onDesktopThemeChange} />
          {hideLogout ? null : (
          <button type="button" className="desktopSidebarLogout" onClick={onLogout}>
            Выйти
          </button>
          )}
        </footer>
      </aside>

      <div className="desktopMainPane">
        <header className="desktopTitlebar">
          <div className="desktopTitlebarMain">
            <div className="desktopTitlebarDrag" data-tauri-drag-region>
              <h2 className="desktopTitlebarTitle">{pageTitle}</h2>
            </div>
            <div className="desktopTitlebarTrailing">
              {hideConnectionStatus ? null : syncToolbar}
              {hideConnectionStatus ? null : <ConnectionBanner {...connection} variant="pill" />}
            </div>
          </div>
        </header>

        {adminError ? (
          <p className="error desktopMainError" role="alert">
            {adminError}
          </p>
        ) : null}

        <div className="desktopMainScroll">
          <div className="desktopContentFrame">{children}</div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { api, tk, IS_DEMO_BUILD } from '@xb/shared';
import { Icon } from './icons';
import { GlobalSearch } from './GlobalSearch';
import { Link } from '../lib/router';
import { useSession, useUser } from '../lib/session';
import { useApi } from '../lib/useApi';
import { MODULES, NAV_GROUPS, type ModuleDef } from '../modules';
import { LangSwitch } from './LangSwitch';
import { useCan } from '../lib/access';
import { NotificationBell } from './flow';
import { PasswordChangeModal } from './PasswordChange';
import { SystemBanners } from './SystemBanners'; // P4-GEN: баннеры регламентных работ и аварийного режима
import { moduleForPath } from '../lib/access';
import { navigate } from '../lib/router';

function isActive(m: ModuleDef, fullPath: string) {
  const path = fullPath.split('?')[0]!;
  return m.path === '/' ? path === '/' : path === m.path || path.startsWith(m.path + '/');
}

export function Layout({ path, children }: { path: string; children: ReactNode }) {
  const { t, loc, logout } = useSession();
  const user = useUser();
  const allowed = useCan(); // меню показывает только модули с правом «просмотр» (P1-ORG)
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState(false);
  const approvals = useApi(() => api.listApprovals(user), [user.id]);
  const initials = user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const label = (m: ModuleDef) => (typeof m.name === 'string' ? t(m.name) : loc(m.name));

  // Мобильное меню: закрывается при переходе и по Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="shell">
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <div className="brand-mark">XB</div>
          <div>
            <div className="brand-name">{t('appName')}</div>
            <div className="brand-sub">{t('bankName')}</div>
          </div>
        </div>
        <nav className="nav">
          {NAV_GROUPS.filter((g) => MODULES.some((m) => m.group === g && allowed(m.id))).map((g) => (
            <div key={g} className="nav-group">
              {g !== 'core' && <div className="nav-section">{t(tk('navGroup_', g))}</div>}
              {MODULES.filter((m) => m.group === g && allowed(m.id)).map((m) => (
                <Link key={m.id} to={m.path} className={`nav-item ${isActive(m, path) ? 'active' : ''}`} title={m.tz ? `${t('tzLabel')} ${m.tz}` : undefined}>
                  <Icon name={m.icon} />
                  <span className="nav-label">{label(m)}</span>
                  {m.id === 'approvals' && !!approvals.data?.length && <span className="nav-count">{approvals.data.length}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">v0.2 · {IS_DEMO_BUILD ? t('demoMode') : t('auth_prod_build')}</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost menu-btn" onClick={() => setOpen((v) => !v)} aria-label={t('menu')} aria-expanded={open}>
            <Icon name="menu" />
          </button>
          <GlobalSearch />
          <div className="topbar-spacer" />
          {IS_DEMO_BUILD && <span className="demo-pill build-demo" data-build="demo" title={t('demoMode')}>DEMO</span>}
          <LangSwitch />
          <NotificationBell user={user} />
          {/* P4-GEN (PR-TEC-007): контекстная справка — статья по модулю текущего экрана */}
          <button
            className="btn btn-ghost btn-sm help-btn"
            onClick={() => {
              const m = moduleForPath(path);
              navigate(m && m.id !== 'help' ? `/help/${m.id}` : '/help');
            }}
            title={t('p4g_help_context')}
            aria-label={t('p4g_help_context')}
          >
            <Icon name="help" size={16} />
          </button>
          <div className="user-chip">
            <div className="avatar">{initials}</div>
            <div className="meta">
              <div className="name">{user.fullName}</div>
              <div className="role">{t(tk('role_', user.role))}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm pwd-change-btn" onClick={() => setPwd(true)} title={t('pwd_change_title')} aria-label={t('pwd_change_title')}>
            <Icon name="key" size={16} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => logout()} title={t('logout')} aria-label={t('logout')}>
            <Icon name="logout" size={16} />
          </button>
        </header>
        <SystemBanners />
        <main className="content">{children}</main>
        {pwd && <PasswordChangeModal onClose={() => setPwd(false)} />}
      </div>
    </div>
  );
}

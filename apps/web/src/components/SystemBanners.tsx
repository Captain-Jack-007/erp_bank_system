// P4-GEN (ТЗ PR-GEN-059/060): баннеры режима работы на всех экранах — аварийный режим (только чтение),
// идущее регламентное окно, ближайшее согласованное окно (за 72 ч до начала).
import { useEffect, useState } from 'react';
import { api, formatDateTime, maintenanceApi, tk, type SystemBanner } from '@xb/shared';
import { Icon } from './icons';
import { useSession } from '../lib/session';
import '../p4gen.css';

export function SystemBanners() {
  const { t, loc } = useSession();
  const [banners, setBanners] = useState<SystemBanner[]>(() => maintenanceApi.banners());
  useEffect(() => {
    const refresh = () => setBanners(maintenanceApi.banners());
    const off = api.subscribe(refresh);
    const id = window.setInterval(refresh, 30_000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, []);
  if (!banners.length) return null;
  const comps = maintenanceApi.components();
  const sysNames = (ids: string[]) => ids.map((s) => { const c = comps.find((x) => x.id === s); return c ? loc(c.name) : s; }).join(', ');
  return (
    <div className="p4-banners">
      {banners.map((b) =>
        b.kind === 'emergency' ? (
          <div key="em" className="p4-banner danger" role="alert" data-testid="banner-emergency">
            <Icon name="alert" size={16} />
            <span>
              <b>{t('p4g_banner_emergency')}</b> {b.state.reason}
              {b.state.since && <span className="p4-banner-sub"> · {t('p4g_banner_since')} {formatDateTime(b.state.since)}</span>}
            </span>
          </div>
        ) : (
          <div key={b.window.id} className={`p4-banner ${b.kind === 'active' ? 'warn' : 'info'}`} role="status" data-testid={`banner-${b.kind}`}>
            <Icon name="wrench" size={16} />
            <span>
              <b>{b.kind === 'active' ? t('p4g_banner_active') : t('p4g_banner_upcoming')}</b> {b.window.title} · {formatDateTime(b.window.start)} — {formatDateTime(b.window.end)}
              <span className="p4-banner-sub"> · {t(tk('p4g_mw_impact_', b.window.impact))} · {sysNames(b.window.systems)}</span>
            </span>
          </div>
        ),
      )}
    </div>
  );
}

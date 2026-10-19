// Предупреждения: сроки документов ТС и водителей, плановое ТО, перерасход, лимиты (PR-FLT-028, 041, 058, 075);
// настройки горизонта и допуска; рассылка уведомлений.
import { useState } from 'react';
import { fleetApi, fleetCanManage, formatDate, tk, type FleetAlert } from '@xb/shared';
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, useToast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ExportButton } from '../../components/Export';
import { Link } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { ALERT_ICON, FleetNav, useFleetErr } from './shared';

const KINDS: FleetAlert['kind'][] = ['insurance', 'kasko', 'inspection', 'tech_passport', 'power_of_attorney', 'license', 'medical', 'service', 'overconsumption', 'limit'];

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const s = useApi(() => fleetApi.getSettings(), []);
  const [horizon, setHorizon] = useState('');
  const [tol, setTol] = useState('');
  const [error, setError] = useState('');
  if (!s.data) return null;
  async function save() {
    try {
      await fleetApi.saveSettings({ alertHorizonDays: Number(horizon || s.data!.alertHorizonDays), overrunTolerancePct: Number(tol || s.data!.overrunTolerancePct) }, user);
      toast(t('fleet_saved'));
      onClose();
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <Modal title={t('fleet_alertSettings')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" onClick={save}>{t('save')}</Button></>}>
      <Field label={t('fleet_horizonDays')} hint="1–180">
        <Input type="number" value={horizon} placeholder={String(s.data.alertHorizonDays)} onChange={(e) => { setHorizon(e.target.value); setError(''); }} ariaLabel={t('fleet_horizonDays')} />
      </Field>
      <Field label={t('fleet_tolerancePct')} hint="0–50">
        <Input type="number" value={tol} placeholder={String(s.data.overrunTolerancePct)} onChange={(e) => { setTol(e.target.value); setError(''); }} ariaLabel={t('fleet_tolerancePct')} />
      </Field>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

export function AlertsPage() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const canManage = fleetCanManage(user);
  const alerts = useApi(() => fleetApi.listAlerts(), []);
  const settings = useApi(() => fleetApi.getSettings(), []);
  const [kind, setKind] = useState<FleetAlert['kind'] | ''>('');
  const [cfg, setCfg] = useState(false);
  const rows = (alerts.data ?? []).filter((a) => !kind || a.kind === kind);
  async function scan() {
    try {
      const n = await fleetApi.scanExpiries(user);
      toast(`${t('fleet_notified')}: ${n}`);
    } catch (e) {
      toast(err(e));
    }
  }
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_alerts') }]}
        title={t('fleet_alerts')}
        subtitle={settings.data ? `${t('fleet_horizonDays')}: ${settings.data.alertHorizonDays} · ${t('fleet_tolerancePct')}: ${settings.data.overrunTolerancePct}%` : undefined}
        actions={
          <>
            <ExportButton<FleetAlert> filename={t('fleet_alerts')} rows={rows} columns={[{ header: t('type'), value: (a) => t(tk('fleet_alert_', a.kind)), width: 34 }, { header: t('description'), value: (a) => a.detail, width: 40 }, { header: t('fleet_validUntil'), value: (a) => a.due ?? '', format: 'date' }, { header: t('fleet_expired'), value: (a) => (a.expired ? t('svc_yes') : t('svc_no')) }]} />
            {canManage && <Button size="small" icon="pen" onClick={() => setCfg(true)}>{t('fleet_alertSettings')}</Button>}
            {canManage && <Button size="small" type="primary" icon="bell" onClick={scan}>{t('fleet_scanNotify')}</Button>}
          </>
        }
      />
      <FleetNav active="alerts" />
      <Card flush>
        <div className="flt-tablebar">
          <Select<FleetAlert['kind']> value={kind} placeholder={`${t('type')}: ${t('all')}`} ariaLabel={t('type')} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(tk('fleet_alert_', k)) }))} style={{ width: 280 }} />
          <span className="muted">{t('fleet_expired')}: {rows.filter((a) => a.expired).length} · {t('fleet_soon')}: {rows.filter((a) => !a.expired).length}</span>
        </div>
        {alerts.loading && !alerts.data ? <Loading /> : !rows.length ? <Empty text={t('fleet_noAlerts')} icon="check" /> : (
          <div>
            {rows.map((a) => (
              <div key={a.id} className="task">
                <div className="task-icon" style={{ background: a.expired ? 'var(--danger-bg)' : 'var(--warn-bg)', color: a.expired ? 'var(--danger)' : 'var(--warn)' }}>
                  <Icon name={ALERT_ICON[a.kind]} />
                </div>
                <div className="task-body">
                  <div className="task-title">{t(tk('fleet_alert_', a.kind))}</div>
                  <div className="task-meta">
                    <span>{a.detail}</span>
                    {a.due && <Badge tone={a.expired ? 'danger' : 'warn'}>{formatDate(a.due)}</Badge>}
                    {a.expired && <Badge tone="danger">{t('fleet_expired')}</Badge>}
                  </div>
                </div>
                <div className="task-actions">
                  <Link to={a.vehicleId ? `/fleet/${a.vehicleId}` : `/fleet/drivers/${a.driverId}`} className="btn btn-sm">{t('open')}</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {cfg && <SettingsModal onClose={() => setCfg(false)} />}
    </>
  );
}

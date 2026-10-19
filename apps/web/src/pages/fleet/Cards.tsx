// Топливные карты и электронные распоряжения на зачисление средств в пределах лимитов (4.2.6.1, PR-FLT-051):
// маршрут согласования, отправка в iABS, сверка, повтор; транзакции процессинга → заправки.
import { useState } from 'react';
import { api, fleetApi, fleetCanManage, formatDateTime, formatMoney, tk, type FleetFuelCard, type FleetTopUp, type PrintDocument } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Input, Loading, Modal, PageHeader, RouteSteps, Field, Timeline, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { Link, navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { FleetNav, Plate, useFleetErr, FleetTaskBox } from './shared';
import { TopUpModal } from './expenseForms';
import { GuardedLink } from '../../lib/access'; // P4-SEC: ссылки с учётом прав

export const TOPUP_TONE: Record<FleetTopUp['status'], Tone> = { draft: 'muted', pending: 'warn', returned: 'warn', rejected: 'danger', approved: 'info', sent: 'info', done: 'ok', failed: 'danger' };

function LimitModal({ card, onClose }: { card: FleetFuelCard; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const [limit, setLimit] = useState(String(card.monthlyLimit));
  const [error, setError] = useState('');
  async function save() {
    try {
      await fleetApi.setCardLimit(card.id, Number(limit), user);
      toast(t('fleet_saved'));
      onClose();
    } catch (e) {
      setError(err(e));
    }
  }
  return (
    <Modal title={`${t('fleet_cardLimit')} · ${card.number}`} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" onClick={save}>{t('save')}</Button></>}>
      <Field label={t('fleet_cardLimit')} required error={error}>
        <Input type="number" value={limit} onChange={(e) => { setLimit(e.target.value); setError(''); }} ariaLabel={t('fleet_cardLimit')} />
      </Field>
    </Modal>
  );
}

export function CardsPage() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const canManage = fleetCanManage(user);
  const cards = useApi(() => fleetApi.listCards(), []);
  const topups = useApi(() => fleetApi.listTopUps(), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const drivers = useApi(() => fleetApi.listDrivers(), []);
  const [form, setForm] = useState(false);
  const [limit, setLimit] = useState<FleetFuelCard | null>(null);
  const [busy, setBusy] = useState(false);
  const plate = (id: string) => vehicles.data?.find((v) => v.id === id)?.plate ?? id;
  async function toggle(c: FleetFuelCard) {
    try {
      await fleetApi.setCardStatus(c.id, c.status === 'active' ? 'blocked' : 'active', user);
      toast(`${c.number}: ${t(tk('fleet_cstatus_', c.status === 'active' ? 'blocked' : 'active'))}`);
    } catch (e) {
      toast(err(e));
    }
  }
  async function sync() {
    setBusy(true);
    try {
      const r = await fleetApi.syncCardTransactions(user);
      toast(r.status === 'success' ? `${t('fleet_cardSyncDone')}: ${r.created}` : `${t('fleet_cardSyncQueued')}: ${t(tk('svc_status_', r.status))}`);
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }
  const month = new Date().toISOString().slice(0, 7);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_cards') }]}
        title={t('fleet_nav_cards')}
        subtitle={t('fleet_cardsSub')}
        actions={
          <>
            {canManage && <Button icon="refresh" loading={busy} onClick={sync}>{t('fleet_cardSync')}</Button>}
            {canManage && <Button type="primary" icon="plus" onClick={() => setForm(true)}>{t('fleet_newTopup')}</Button>}
          </>
        }
      />
      <FleetNav active="cards" />
      <Card title={t('fleet_cards')} flush actions={<ExportButton<FleetFuelCard> filename={t('fleet_cards')} rows={cards.data ?? []} columns={[
        { header: t('fleet_card'), value: (c) => c.number }, { header: t('fleet_provider'), value: (c) => t(tk('fleet_card_', c.provider)) }, { header: t('fleet_plate'), value: (c) => plate(c.vehicleId) },
        { header: t('fleet_cardLimit'), value: (c) => c.monthlyLimit, format: 'money', total: true }, { header: t('fleet_balance'), value: (c) => c.balance, format: 'money', total: true }, { header: t('status'), value: (c) => t(tk('fleet_cstatus_', c.status)) },
      ]} />}>
        <DataTable rows={cards.data} loading={cards.loading} rowKey={(c) => c.id} columns={[
          { header: t('fleet_card'), render: (c) => (<><b>{c.number}</b><div className="sub">{t(tk('fleet_card_', c.provider))} · {c.account}</div></>) },
          { header: t('fleet_plate'), render: (c) => <Link to={`/fleet/${c.vehicleId}`}><Plate value={plate(c.vehicleId)} /></Link> },
          { header: t('fleet_driver'), render: (c) => drivers.data?.find((d) => d.id === c.driverId)?.fullName ?? '—' },
          { header: t('fleet_cardLimit'), align: 'right', render: (c) => formatMoney(c.monthlyLimit) },
          { header: `${t('fleet_remainingLimit')} ${month}`, align: 'right', render: (c) => formatMoney(fleetApi.cardRemaining(c.id, month)) },
          { header: t('fleet_balance'), align: 'right', render: (c) => <b>{formatMoney(c.balance)}</b> },
          { header: t('status'), render: (c) => <Badge tone={c.status === 'active' ? 'ok' : 'danger'}>{t(tk('fleet_cstatus_', c.status))}</Badge> },
          { header: '', render: (c) => canManage ? <div className="flt-row"><Button size="small" onClick={() => setLimit(c)}>{t('fleet_cardLimit')}</Button><Button size="small" onClick={() => toggle(c)}>{c.status === 'active' ? t('fleet_block') : t('fleet_unblock')}</Button></div> : null },
        ]} />
      </Card>
      <Card title={t('fleet_topups')} flush>
        <DataTable rows={topups.data} loading={topups.loading} rowKey={(x) => x.id} onRowClick={(x) => navigate(`/fleet/topups/${x.id}`)} columns={[
          { header: '№', render: (x) => <span className="doc-num">{x.number}</span> },
          { header: t('fleet_topupPeriod'), render: (x) => x.period },
          { header: t('fleet_cards'), align: 'right', render: (x) => x.lines.length },
          { header: t('amount'), align: 'right', render: (x) => formatMoney(x.total) },
          { header: t('comment'), render: (x) => <span className="muted">{x.comment}</span> },
          { header: t('status'), render: (x) => <Badge tone={TOPUP_TONE[x.status]}>{t(tk('fleet_tu_', x.status))}</Badge> },
        ]} />
      </Card>
      {form && <TopUpModal onClose={() => setForm(false)} onSaved={(id) => navigate(`/fleet/topups/${id}`)} />}
      {limit && <LimitModal card={limit} onClose={() => setLimit(null)} />}
    </>
  );
}

export function TopUpDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useFleetErr();
  const canManage = fleetCanManage(user);
  const tq = useApi(() => fleetApi.getTopUp(id), [id]);
  const cards = useApi(() => fleetApi.listCards(), []);
  const vehicles = useApi(() => fleetApi.list(), []);
  const [busy, setBusy] = useState(false);
  if (tq.loading && !tq.data) return <Card><Loading /></Card>;
  const x = tq.data;
  if (!x) return <Card><Empty text={t('empty')} /></Card>;
  const card = (cid: string) => cards.data?.find((c) => c.id === cid);
  const plate = (vid?: string) => vehicles.data?.find((v) => v.id === vid)?.plate ?? '';
  async function reconcile() {
    setBusy(true);
    try {
      const r = await fleetApi.reconcileTopUp(id, user);
      toast(`${r.number}: ${t(tk('fleet_tu_', r.status))}`);
    } catch (e) {
      toast(err(e));
    } finally {
      setBusy(false);
    }
  }
  const doc = (): PrintDocument => ({
    entity: 'fleet_topup', entityId: x.id, title: t('fleet_topupPrintTitle'), number: x.number, date: x.createdAt.slice(0, 10),
    fields: [{ label: t('fleet_topupPeriod'), value: x.period }, { label: t('comment'), value: x.comment || '—' }, { label: t('status'), value: t(tk('fleet_tu_', x.status)) }],
    table: { columns: [{ header: '№', align: 'center', width: '6%' }, { header: t('fleet_card') }, { header: t('fleet_plate') }, { header: t('fleet_account') }, { header: t('amount'), align: 'right' }], rows: x.lines.map((l, i) => [String(i + 1), card(l.cardId)?.number ?? '', plate(card(l.cardId)?.vehicleId), card(l.cardId)?.account ?? '', formatMoney(l.amount)]), totals: ['', t('total'), '', '', formatMoney(x.total)] },
    signers: [{ role: t('fleet_initiator'), name: '' }, { role: t('fleet_accountantSign'), name: '' }],
  });
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('fleet_title'), to: '/fleet' }, { label: t('fleet_nav_cards'), to: '/fleet/cards' }, { label: x.number }]}
        title={`${x.number} · ${t('fleet_topupTitle')} ${x.period}`}
        subtitle={`${formatDateTime(x.createdAt)} · ${formatMoney(x.total)}`}
        actions={
          <>
            <Badge tone={TOPUP_TONE[x.status]}>{t(tk('fleet_tu_', x.status))}</Badge>
            {canManage && (x.status === 'sent' || x.status === 'failed') && <Button type="primary" icon="refresh" loading={busy} onClick={reconcile}>{t('fleet_reconcile')}</Button>}
            <PrintButton doc={doc} template="registry" />
          </>
        }
      />
      <FleetTaskBox entityId={id} />
      <div className="grid grid-main">
        <Card title={t('fleet_cards')} flush>
          <DataTable rows={x.lines} rowKey={(l) => l.cardId} columns={[
            { header: t('fleet_card'), render: (l) => card(l.cardId)?.number ?? l.cardId },
            { header: t('fleet_plate'), render: (l) => <Plate value={plate(card(l.cardId)?.vehicleId)} /> },
            { header: t('amount'), align: 'right', render: (l) => formatMoney(l.amount) },
            { header: t('fleet_iabs'), render: (l) => (l.state ? <Badge tone={l.state === 'success' ? 'ok' : l.state === 'failed' ? 'danger' : 'warn'}>{t(tk('fleet_line_', l.state))}</Badge> : <span className="muted">—</span>) },
            { header: '', render: (l) => (l.exchangeId ? <GuardedLink to={`/integrations?q=${l.exchangeId}`}>{l.exchangeId}</GuardedLink> : null) },
          ]} />
        </Card>
        <div className="flt-stack">
          <Card title={t('fleet_approvalRoute')}><RouteSteps entityId={x.id} /></Card>
          <Card title={t('history')}><Timeline events={x.history} /></Card>
        </div>
      </div>
    </>
  );
}

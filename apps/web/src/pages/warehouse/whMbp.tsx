// Учёт МБП (ТЗ 4.2.4.4): МБП в эксплуатации на внебалансе — по ЦБУ/подразделениям и МОЛ, сводно по регионам и банку,
// объединение однотипных по средней цене, списание по акту комиссии, инвентаризация, этикетки, дашборд и отчёты.
import { useState } from 'react';
import { formatDate, formatMoney, formatMoneyShort, formatNumber, localize, tk, warehouseApi, type MbpRecord } from '@xb/shared';
import { BarChart, Button, Card, Checkbox, DataTable, FilterBar, Input, Select, Stat, StatusBadge, useToast, type Column, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import { LabelPreview, OrgUnitSelect, UserSelect, useOrg, useP, useQueryParam, useWmsError, type WmsLabel } from './wmsShared';

const MBP_TONE: Record<MbpRecord['status'], Tone> = { in_use: 'ok', pending_writeoff: 'warn', written_off: 'muted', lost: 'danger' };

export function MbpTab() {
  const { t, lang } = useSession();
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const can = useCan();
  const org = useOrg();
  const toast = useToast();
  const err = useWmsError('warehouse_err_');
  const [unit, setUnit] = useState('');
  const [resp, setResp] = useState('');
  const [status, setStatus] = useState<MbpRecord['status'] | ''>('');
  const [search, setSearch] = useState(useQueryParam('q'));
  const [sel, setSel] = useState<string[]>([]);
  const [labels, setLabels] = useState<WmsLabel[] | null>(null);
  const sum = useApi(() => warehouseApi.mbpSummary());
  const list = useApi(() => warehouseApi.listMbp({ search, ...(unit ? { orgUnitKey: unit } : {}), ...(resp ? { responsibleId: resp } : {}), ...(status ? { status } : {}) }), [search, unit, resp, status]);
  const s = sum.data;
  const canEdit = can('warehouse', 'edit');
  const cols: Column<MbpRecord>[] = [
    ...(canEdit ? [{ header: '', render: (m: MbpRecord) => (m.status === 'in_use' ? <Checkbox checked={sel.includes(m.id)} onChange={(v) => setSel((x) => (v ? [...x, m.id] : x.filter((y) => y !== m.id)))} /> : null) }] : []),
    { header: t('number'), render: (m) => (<><span className="doc-num">{m.number}</span><div className="sub wms-mono">{m.barcode}</div></>) },
    { header: t('warehouse_item'), render: (m) => (<>{m.name}<div className="sub">{p('Выдано', 'Berilgan', 'Issued')} {formatDate(m.issuedAt)}</div></>) },
    { header: p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit'), render: (m) => org.unitName(m.orgUnitKey) },
    { header: p('МОЛ', 'MJS', 'Custodian'), render: (m) => lk.user(m.responsibleId)?.fullName ?? m.responsibleId },
    { header: t('qty'), align: 'right', render: (m) => `${formatNumber(m.qty)} ${m.unit}` },
    { header: p('Средняя цена', 'O‘rtacha narx', 'Avg. price'), align: 'right', render: (m) => formatMoney(m.unitCost) },
    { header: t('amount'), align: 'right', render: (m) => formatMoney(m.qty * m.unitCost) },
    { header: p('Внебаланс / МВЗ', 'Balansdan tashqari / XMM', 'Off-balance / CC'), render: (m) => <span className="wms-mono">{m.offBalanceAccount} · {org.ccCode(m.costCenterId)}</span> },
    { header: t('status'), render: (m) => <StatusBadge prefix="warehouse_mbpst_" status={m.status} tone={MBP_TONE[m.status]} /> },
  ];
  return (
    <div className="wms-pad">
      <div className="grid grid-4">
        <Stat label={p('МБП в эксплуатации', 'Foydalanishdagi MBP', 'LVI in use')} value={s ? formatNumber(s.total.qty) : '—'} foot={s ? `${s.total.records} ${p('записей', 'yozuv', 'records')}` : undefined} tone="accent" />
        <Stat label={p('Стоимость на внебалансе', 'Balansdan tashqari qiymat', 'Off-balance value')} value={s ? formatMoneyShort(s.total.amount, lang) : '—'} foot="96335000" />
        <Stat label={p('На списании', 'Hisobdan chiqarishda', 'Pending write-off')} value={s?.total.pendingWriteoff ?? '—'} tone={s?.total.pendingWriteoff ? 'alert' : undefined} />
        <Stat label={p('Проводки МБП (подтверждено)', 'MBP provodkalari (tasdiqlangan)', 'LVI postings (confirmed)')} value={s ? `${s.postings.confirmed} / ${s.postings.total}` : '—'} foot={s?.postings.pending ? `${p('ожидают', 'kutmoqda', 'pending')}: ${s.postings.pending}` : undefined} />
      </div>
      <div className="wms-split">
        <Card title={p('МБП по регионам (сводно по банку)', 'Hududlar bo‘yicha MBP (bank bo‘yicha jami)', 'LVI by region (bank total)')}>
          <BarChart data={(s?.byRegion ?? []).map((r) => ({ label: r.name ? localize(r.name, lang).replace(/областной филиал|филиал|viloyat filiali/gi, '').trim().slice(0, 14) : r.key, values: [r.amount] }))} series={[{ name: t('amount') }]} format={(n) => formatMoneyShort(n, lang)} />
        </Card>
        <Card title={p('По ЦБУ и подразделениям', 'BXM va bo‘linmalar bo‘yicha', 'By branch and unit')} flush>
          <DataTable rows={s?.byUnit ?? []} rowKey={(r) => r.key} columns={[
            { header: p('Подразделение', 'Bo‘linma', 'Unit'), render: (r) => (r.name ? localize(r.name, lang) : r.key) },
            { header: t('qty'), align: 'right', render: (r) => formatNumber(r.qty) },
            { header: t('amount'), align: 'right', render: (r) => formatMoneyShort(r.amount, lang) },
          ]} />
        </Card>
      </div>
      <Card flush title={p('Реестр МБП в эксплуатации', 'Foydalanishdagi MBP reestri', 'LVI in use register')}>
        <FilterBar>
          <Input placeholder={`${t('search')}: ${t('number')}, ${t('warehouse_item').toLowerCase()}, ${p('штрихкод', 'shtrixkod', 'barcode')}`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <OrgUnitSelect value={unit} onChange={setUnit} placeholder={`${p('ЦБУ / подразделение', 'BXM / bo‘linma', 'Branch / unit')}: ${t('all')}`} />
          <UserSelect value={resp} onChange={setResp} placeholder={`${p('МОЛ', 'MJS', 'Custodian')}: ${t('all')}`} />
          <Select<MbpRecord['status']> value={status} onChange={setStatus} placeholder={`${t('status')}: ${p('в эксплуатации', 'foydalanishda', 'in use')}`} options={(['in_use', 'pending_writeoff', 'written_off', 'lost'] as const).map((x) => ({ value: x, label: t(tk('warehouse_mbpst_', x)) }))} />
          {canEdit && <Button disabled={sel.length < 2} onClick={() => warehouseApi.mergeMbp(sel, user).then((m) => { setSel([]); toast(`${m.number}: ${p('объединено по средней цене', 'o‘rtacha narx bo‘yicha birlashtirildi', 'merged at average price')}`); }).catch((e) => toast(err(e)))}>{p('Объединить однотипные', 'Bir turdagilarni birlashtirish', 'Merge similar')} ({sel.length})</Button>}
          {canEdit && <Button icon="plus" onClick={() => navigate('/warehouse/writeoffs/new?kind=mbp')}>{p('Акт списания МБП', 'MBP dalolatnomasi', 'LVI write-off act')}</Button>}
          <Button icon="printer" disabled={!list.data?.length} onClick={() => setLabels((list.data ?? []).map((m) => ({ title: m.name, sub: `${m.number} · ${org.unitName(m.orgUnitKey)} · ${p('МВЗ', 'XMM', 'CC')} ${org.ccCode(m.costCenterId)}`, barcode: m.barcode, qr: `XB-MBP:${m.number}` })))}>{p('Этикетки', 'Yorliqlar', 'Labels')}</Button>
          <ExportButton filename={p('МБП в эксплуатации', 'Foydalanishdagi MBP', 'LVI in use')} sheets={() => {
            const rows = list.data ?? [];
            const sheet = (name: string, data: { key: string; label: string; qty: number; amount: number }[]) => ({ name, columns: [{ header: p('Разрез', 'Kesim', 'Dimension') }, { header: t('qty'), format: 'integer' as const, total: true }, { header: t('amount'), format: 'money' as const, total: true }], rows: data.map((d) => [d.label, d.qty, d.amount]), totalLabel: t('total') });
            return [
              { name: p('Реестр', 'Reestr', 'Register'), columns: [{ header: t('number') }, { header: t('warehouse_item') }, { header: p('Подразделение', 'Bo‘linma', 'Unit') }, { header: p('МОЛ', 'MJS', 'Custodian') }, { header: t('qty'), format: 'integer' as const, total: true }, { header: p('Средняя цена', 'O‘rtacha narx', 'Avg. price'), format: 'money' as const }, { header: t('amount'), format: 'money' as const, total: true }], rows: rows.map((m) => [m.number, m.name, org.unitName(m.orgUnitKey), lk.user(m.responsibleId)?.fullName ?? m.responsibleId, m.qty, m.unitCost, m.qty * m.unitCost]), totalLabel: t('total') },
              sheet(p('По подразделениям', 'Bo‘linmalar', 'By unit'), (s?.byUnit ?? []).map((r) => ({ key: r.key, label: r.name ? localize(r.name, lang) : r.key, qty: r.qty, amount: r.amount }))),
              sheet(p('По регионам', 'Hududlar', 'By region'), (s?.byRegion ?? []).map((r) => ({ key: r.key, label: r.name ? localize(r.name, lang) : r.key, qty: r.qty, amount: r.amount }))),
              sheet(p('По МОЛ', 'MJS bo‘yicha', 'By custodian'), (s?.byResponsible ?? []).map((r) => ({ key: r.key, label: lk.user(r.key)?.fullName ?? r.key, qty: r.qty, amount: r.amount }))),
            ];
          }} />
        </FilterBar>
        <DataTable rows={list.data} loading={list.loading} rowKey={(m) => m.id} columns={cols} />
      </Card>
      {labels && <LabelPreview labels={labels} entity="mbp" onClose={() => setLabels(null)} />}
    </div>
  );
}

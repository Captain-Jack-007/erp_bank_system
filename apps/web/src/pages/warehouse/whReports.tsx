// Склад: отчёты — поступления, оборотная ведомость (получено/выдано/списано), остатки на дату,
// выдача по подразделениям/МВЗ/сегментам с анализом количества, расход и списание за период. Экспорт и печать.
import { useState } from 'react';
import { formatDate, formatMoney, formatMoneyShort, formatNumber, today, tk, warehouseApi, WAREHOUSE_SETTINGS } from '@xb/shared';
import { BarChart, Card, DataTable, Field, FilterBar, Input, Select, Tabs } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useP, useQueryParam } from './wmsShared';

type Rep = 'receipts' | 'turnover' | 'onDate' | 'byUnit' | 'issues' | 'writeoffs' | 'stale';

export function ReportsTab() {
  const { t, lang } = useSession();
  const p = useP();
  const lk = useLookups();
  const initialRep = useQueryParam('rep');
  const [rep, setRep] = useState<Rep>(initialRep === 'stale' ? 'stale' : 'turnover');
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [wh, setWh] = useState('');
  const [by, setBy] = useState<'department' | 'costCenter' | 'segment'>('department');
  const locs = useApi(() => warehouseApi.listLocations());
  const receipts = useApi(() => (rep === 'receipts' ? warehouseApi.listReceipts({ status: 'posted', ...(wh ? { warehouseId: wh } : {}) }) : Promise.resolve([])), [rep, wh]);
  const turnover = useApi(() => (rep === 'turnover' ? warehouseApi.turnoverReport(from, to, wh || undefined) : Promise.resolve([])), [rep, from, to, wh]);
  const onDate = useApi(() => (rep === 'onDate' ? warehouseApi.stockOnDate(to, wh || undefined) : Promise.resolve([])), [rep, to, wh]);
  const byUnit = useApi(() => (rep === 'byUnit' ? warehouseApi.issueReport(from, to, by) : Promise.resolve([])), [rep, from, to, by]);
  const moves = useApi(() => (rep === 'issues' || rep === 'writeoffs' ? warehouseApi.listMovements({ type: rep === 'issues' ? 'issue' : 'writeoff', from, to, ...(wh ? { warehouseId: wh } : {}) }) : Promise.resolve([])), [rep, from, to, wh]);
  const stale = useApi(() => (rep === 'stale' ? warehouseApi.staleReport(wh || undefined) : Promise.resolve([])), [rep, wh]);
  const items = useApi(() => warehouseApi.listItems({ includeEmpty: true }));
  const item = (id: string) => items.data?.find((i) => i.id === id);
  const whCode = (id: string) => locs.data?.find((l) => l.id === id)?.code ?? id;
  const rc = (receipts.data ?? []).filter((r) => r.date >= from && r.date <= to);
  const title: Record<Rep, string> = {
    receipts: p('Отчёт по поступлениям', 'Kirimlar hisoboti', 'Receipts report'),
    turnover: p('Оборотная ведомость: получено / выдано / списано', 'Aylanma qaydnoma: olingan / berilgan / hisobdan chiqarilgan', 'Turnover: received / issued / written off'),
    onDate: p('Остатки на дату', 'Sanaga qoldiqlar', 'Stock on date'),
    byUnit: p('Выдача по подразделениям и сегментам', 'Bo‘linmalar va segmentlar bo‘yicha berish', 'Issues by unit and segment'),
    issues: p('Отчёт по расходу', 'Sarf hisoboti', 'Issues report'),
    writeoffs: p('Отчёт по списанию', 'Hisobdan chiqarish hisoboti', 'Write-off report'),
    stale: p('Залежалые запасы', 'Uzoq saqlangan zaxiralar', 'Slow-moving stock'),
  };
  const printDoc = (columns: string[], rows: string[][], totals?: string[]) => () => ({ entity: 'warehouse_report', entityId: `${rep}-${from}-${to}`, title: title[rep], date: today(), fields: [{ label: p('Период', 'Davr', 'Period'), value: `${from} — ${to}` }, { label: t('warehouse_warehouse'), value: wh ? whCode(wh) : t('all') }], table: { columns: columns.map((h, i) => ({ header: h, ...(i > 1 ? { align: 'right' as const } : {}) })), rows, ...(totals ? { totals } : {}) } });
  return (
    <div>
      <Tabs<Rep> value={rep} onChange={setRep} items={(Object.keys(title) as Rep[]).map((k) => ({ value: k, label: title[k].split(':')[0]! }))} />
      <FilterBar>
        {rep !== 'onDate' && rep !== 'stale' && <Field label={p('С', 'Dan', 'From')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>}
        {rep !== 'stale' && <Field label={rep === 'onDate' ? p('На дату', 'Sanaga', 'As of') : p('По', 'Gacha', 'To')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
        {rep !== 'byUnit' && <Field label={t('warehouse_warehouse')}><Select value={wh} onChange={setWh} placeholder={t('all')} options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>}
        {rep === 'byUnit' && <Field label={p('Разрез', 'Kesim', 'Dimension')}><Select<'department' | 'costCenter' | 'segment'> value={by} onChange={setBy} options={[{ value: 'department', label: p('Подразделение', 'Bo‘linma', 'Unit') }, { value: 'costCenter', label: p('МВЗ', 'XMM', 'Cost center') }, { value: 'segment', label: p('Сегмент', 'Segment', 'Segment') }]} /></Field>}
      </FilterBar>
      <div className="wms-pad">
        {rep === 'receipts' && (
          <Card title={title.receipts} actions={<span className="wms-row"><ExportButton filename={title.receipts} rows={rc} columns={[{ header: t('number'), value: (r) => r.number }, { header: t('date'), value: (r) => r.date }, { header: t('warehouse_supplier'), value: (r) => (r.supplierId ? lk.counterparty(r.supplierId)?.name ?? '' : '') }, { header: p('Накладная', 'Yuk xati', 'Waybill'), value: (r) => r.waybillNo }, { header: 'ЭСФ', value: (r) => r.einvoiceNumber ?? '' }, { header: t('amount'), value: (r) => r.amount, format: 'money', total: true }]} /><PrintButton template="registry" doc={printDoc([t('number'), t('date'), t('warehouse_supplier'), t('amount')], rc.map((r) => [r.number, r.date, r.supplierId ? lk.counterparty(r.supplierId)?.name ?? '' : '', formatMoney(r.amount)]), ['', '', t('total'), formatMoney(rc.reduce((s, r) => s + r.amount, 0))])} /></span>} flush>
            <DataTable rows={rc} rowKey={(r) => r.id} columns={[
              { header: t('number'), render: (r) => <span className="doc-num">{r.number}</span> }, { header: t('date'), render: (r) => r.date },
              { header: t('warehouse_supplier'), render: (r) => (r.supplierId ? lk.counterparty(r.supplierId)?.name : '—') }, { header: 'ЭСФ', render: (r) => r.einvoiceNumber ?? '—' },
              { header: t('amount'), align: 'right', render: (r) => formatMoney(r.amount) },
            ]} />
            <div className="wms-row end" style={{ padding: 12 }}><b>{t('total')}: {formatMoney(rc.reduce((s, r) => s + r.amount, 0))}</b></div>
          </Card>
        )}
        {rep === 'turnover' && (
          <Card title={title.turnover} actions={<span className="wms-row"><ExportButton filename={p('Оборотная ведомость', 'Aylanma qaydnoma', 'Turnover')} rows={turnover.data ?? []} columns={[{ header: t('warehouse_sku'), value: (r) => r.item.sku }, { header: t('warehouse_item'), value: (r) => r.item.name }, { header: t('warehouse_warehouse'), value: (r) => whCode(r.item.warehouseId) }, { header: p('Начало', 'Boshi', 'Opening'), value: (r) => r.opening, format: 'integer' }, { header: p('Получено', 'Olingan', 'Received'), value: (r) => r.receipts, format: 'integer', total: true }, { header: p('Выдано', 'Berilgan', 'Issued'), value: (r) => r.issues, format: 'integer', total: true }, { header: p('Списано', 'Hisobdan chiqarilgan', 'Written off'), value: (r) => r.writeoffs, format: 'integer', total: true }, { header: p('Перемещено', 'Ko‘chirilgan', 'Transferred'), value: (r) => r.transfers, format: 'integer' }, { header: p('Конец', 'Oxiri', 'Closing'), value: (r) => r.closing, format: 'integer' }, { header: t('warehouse_sum'), value: (r) => r.closingValue, format: 'money', total: true }]} /><PrintButton template="registry" doc={printDoc([t('warehouse_sku'), t('warehouse_item'), p('Начало', 'Boshi', 'Opening'), p('Получено', 'Olingan', 'Received'), p('Выдано', 'Berilgan', 'Issued'), p('Списано', 'Hisobdan chiqarilgan', 'Written off'), p('Конец', 'Oxiri', 'Closing')], (turnover.data ?? []).map((r) => [r.item.sku, r.item.name, formatNumber(r.opening), formatNumber(r.receipts), formatNumber(r.issues), formatNumber(r.writeoffs), formatNumber(r.closing)]))} /></span>} flush>
            <DataTable rows={turnover.data} loading={turnover.loading} rowKey={(r) => r.item.id} columns={[
              { header: t('warehouse_item'), render: (r) => (<>{r.item.name}<div className="sub">{r.item.sku} · {whCode(r.item.warehouseId)}</div></>) },
              { header: p('Начало', 'Boshi', 'Opening'), align: 'right', render: (r) => formatNumber(r.opening) },
              { header: p('Получено', 'Olingan', 'Received'), align: 'right', render: (r) => formatNumber(r.receipts) },
              { header: p('Выдано', 'Berilgan', 'Issued'), align: 'right', render: (r) => formatNumber(r.issues) },
              { header: p('Списано', 'Hisobdan chiqarilgan', 'Written off'), align: 'right', render: (r) => formatNumber(r.writeoffs) },
              { header: p('Конец', 'Oxiri', 'Closing'), align: 'right', render: (r) => <b>{formatNumber(r.closing)}</b> },
              { header: t('warehouse_sum'), align: 'right', render: (r) => formatMoney(r.closingValue) },
            ]} />
          </Card>
        )}
        {rep === 'onDate' && (
          <Card title={`${title.onDate}: ${to}`} actions={<ExportButton filename={`${title.onDate} ${to}`} rows={onDate.data ?? []} columns={[{ header: t('warehouse_sku'), value: (r) => r.item.sku }, { header: t('warehouse_item'), value: (r) => r.item.name }, { header: t('warehouse_warehouse'), value: (r) => whCode(r.item.warehouseId) }, { header: t('warehouse_qty'), value: (r) => r.qty, format: 'integer' }, { header: t('warehouse_sum'), value: (r) => r.value, format: 'money', total: true }]} />} flush>
            <DataTable rows={onDate.data} loading={onDate.loading} rowKey={(r) => r.item.id} columns={[
              { header: t('warehouse_item'), render: (r) => (<>{r.item.name}<div className="sub">{r.item.sku} · {whCode(r.item.warehouseId)}</div></>) },
              { header: t('warehouse_qty'), align: 'right', render: (r) => `${formatNumber(r.qty)} ${r.item.unit}` },
              { header: t('warehouse_sum'), align: 'right', render: (r) => formatMoney(r.value) },
            ]} />
          </Card>
        )}
        {rep === 'byUnit' && (
          <>
            <Card title={p('Анализ выданного количества по структурным подразделениям', 'Tarkibiy bo‘linmalar bo‘yicha berilgan miqdor tahlili', 'Issued quantity by unit')}>
              <BarChart data={(byUnit.data ?? []).slice(0, 10).map((r) => ({ label: r.label.slice(0, 14), values: [r.qty] }))} series={[{ name: t('qty') }]} format={(n) => formatNumber(n)} />
            </Card>
            <Card title={title.byUnit} actions={<ExportButton filename={title.byUnit} rows={byUnit.data ?? []} columns={[{ header: p('Разрез', 'Kesim', 'Dimension'), value: (r) => (by === 'segment' ? r.label : r.label) }, { header: p('Сегмент', 'Segment', 'Segment'), value: (r) => r.segment ?? '' }, { header: p('Операций', 'Operatsiyalar', 'Operations'), value: (r) => r.operations, format: 'integer' }, { header: t('qty'), value: (r) => r.qty, format: 'integer', total: true }, { header: t('amount'), value: (r) => r.amount, format: 'money', total: true }]} />} flush>
              <DataTable rows={byUnit.data} loading={byUnit.loading} rowKey={(r) => r.key} columns={[
                { header: p('Разрез', 'Kesim', 'Dimension'), render: (r) => (by === 'segment' ? t(tk('seg_', r.label)) : r.label) },
                { header: p('Сегмент', 'Segment', 'Segment'), render: (r) => (r.segment ? t(tk('seg_', r.segment)) : '—') },
                { header: p('Операций', 'Operatsiyalar', 'Operations'), align: 'right', render: (r) => r.operations },
                { header: t('qty'), align: 'right', render: (r) => formatNumber(r.qty) },
                { header: t('amount'), align: 'right', render: (r) => formatMoneyShort(r.amount, lang) },
              ]} />
            </Card>
          </>
        )}
        {rep === 'stale' && (
          <Card
            title={title.stale}
            actions={<span className="wms-row"><ExportButton filename={title.stale} rows={stale.data ?? []} columns={[{ header: p('Партия', 'Partiya', 'Batch'), value: (r) => r.batchNo }, { header: t('warehouse_sku'), value: (r) => r.sku }, { header: t('warehouse_item'), value: (r) => r.name }, { header: p('Категория', 'Toifa', 'Category'), value: (r) => t(tk('warehouse_cat_', r.category)) }, { header: t('warehouse_warehouse'), value: (r) => whCode(r.warehouseId) }, { header: p('Поступила', 'Kelgan', 'Received'), value: (r) => r.receivedAt }, { header: p('Дней на складе', 'Omborda kun', 'Days in stock'), value: (r) => r.ageDays, format: 'integer' }, { header: p('Порог, дней', 'Chegara, kun', 'Threshold, days'), value: (r) => r.threshold, format: 'integer' }, { header: p('Остаток', 'Qoldiq', 'Left'), value: (r) => r.qtyLeft, format: 'integer' }, { header: t('warehouse_sum'), value: (r) => r.value, format: 'money', total: true }]} /><PrintButton template="registry" doc={printDoc([p('Партия', 'Partiya', 'Batch'), t('warehouse_item'), p('Дней на складе', 'Omborda kun', 'Days in stock'), p('Порог, дней', 'Chegara, kun', 'Threshold, days'), p('Остаток', 'Qoldiq', 'Left'), t('warehouse_sum')], (stale.data ?? []).map((r) => [r.batchNo, `${r.sku} ${r.name}`, formatNumber(r.ageDays), formatNumber(r.threshold), `${formatNumber(r.qtyLeft)} ${r.unit}`, formatMoney(r.value)]), ['', '', '', '', t('total'), formatMoney((stale.data ?? []).reduce((x, r) => x + r.value, 0))])} /></span>}
            flush
          >
            <div className="wms-note" style={{ padding: '8px 18px' }}>
              {p(`Порог залежалости: ${WAREHOUSE_SETTINGS.staleDays} дн. (по категориям — в настройках склада).`, `Uzoq saqlanish chegarasi: ${WAREHOUSE_SETTINGS.staleDays} kun (toifalar bo‘yicha — ombor sozlamalarida).`, `Slow-moving threshold: ${WAREHOUSE_SETTINGS.staleDays} days (per category — in warehouse settings).`)}
            </div>
            <DataTable rows={stale.data} loading={stale.loading} rowKey={(r) => r.batchId} emptyText={p('Залежалых партий нет', 'Uzoq saqlangan partiyalar yo‘q', 'No slow-moving batches')} columns={[
              { header: p('Партия', 'Partiya', 'Batch'), render: (r) => <span className="wms-mono">{r.batchNo}</span> },
              { header: t('warehouse_item'), render: (r) => (<>{r.name}<div className="sub">{r.sku} · {whCode(r.warehouseId)} · {t(tk('warehouse_cat_', r.category))}</div></>) },
              { header: p('Поступила', 'Kelgan', 'Received'), render: (r) => formatDate(r.receivedAt) },
              { header: p('Дней / порог', 'Kun / chegara', 'Days / threshold'), align: 'right', render: (r) => `${formatNumber(r.ageDays)} / ${formatNumber(r.threshold)}` },
              { header: p('Остаток', 'Qoldiq', 'Left'), align: 'right', render: (r) => `${formatNumber(r.qtyLeft)} ${r.unit}` },
              { header: t('warehouse_sum'), align: 'right', render: (r) => formatMoney(r.value) },
            ]} />
            <div className="wms-row end" style={{ padding: 12 }}><b>{t('total')}: {formatMoney((stale.data ?? []).reduce((x, r) => x + r.value, 0))}</b></div>
          </Card>
        )}
        {(rep === 'issues' || rep === 'writeoffs') && (
          <Card title={title[rep]} actions={<ExportButton filename={title[rep]} rows={moves.data ?? []} columns={[{ header: t('number'), value: (m) => m.number }, { header: t('date'), value: (m) => m.at.slice(0, 10) }, { header: t('warehouse_item'), value: (m) => item(m.itemId)?.name ?? m.itemId }, { header: t('qty'), value: (m) => m.qty, format: 'integer', total: true }, { header: t('amount'), value: (m) => m.amount, format: 'money', total: true }, { header: p('МВЗ', 'XMM', 'CC'), value: (m) => m.costCenterId }, { header: p('Документ', 'Hujjat', 'Document'), value: (m) => m.docNumber ?? '' }]} />} flush>
            <DataTable rows={moves.data} loading={moves.loading} rowKey={(m) => m.id} columns={[
              { header: t('number'), render: (m) => (<><span className="doc-num">{m.number}</span><div className="sub">{m.docNumber}</div></>) },
              { header: t('date'), render: (m) => m.at.slice(0, 10) },
              { header: t('warehouse_item'), render: (m) => item(m.itemId)?.name ?? m.itemId },
              { header: t('qty'), align: 'right', render: (m) => formatNumber(m.qty) },
              { header: t('amount'), align: 'right', render: (m) => formatMoney(m.amount) },
              { header: p('МВЗ', 'XMM', 'CC'), render: (m) => <span className="wms-mono">{m.costCenterId}</span> },
            ]} />
            <div className="wms-row end" style={{ padding: 12 }}><b>{t('total')}: {formatMoney((moves.data ?? []).reduce((s, m) => s + m.amount, 0))}</b></div>
          </Card>
        )}
      </div>
    </div>
  );
}

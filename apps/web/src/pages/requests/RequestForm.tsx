// Форма заявки на обеспечение (PR-REQ-001…006, 010): тип, позиции со склада с доступным остатком, МВЗ
// подразделения сотрудника, проверка бюджета, многоэтапный маршрут.
import { useEffect, useMemo, useState } from 'react';
import { formatMoney, supplyApi, tk, type EmployeeRequestType, type SupplyItem } from '@xb/shared';
import { Button, Card, Field, Input, PageHeader, RouteSteps, Select, Textarea, useToast } from '../../components/ui';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { CostCenterSelect, useCostCenters, useErr } from '../procurement/shared';
import { REQ_TYPES } from './EmployeeRequestsPage';

const CATS: Record<string, string[]> = { stationery: ['office', 'forms'], household: ['household'], equipment: ['mbp', 'fixed', 'security'], it: ['it', 'fixed'], service: [] };

export function RequestFormPage() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const cc = useCostCenters();
  const unit = user.orgUnitKey && /^R\d\d/.test(user.orgUnitKey) ? user.orgUnitKey : user.departmentId;
  const locations = useApi(() => supplyApi.locations(), []);
  const [type, setType] = useState<EmployeeRequestType>('stationery');
  const [warehouseId, setWarehouseId] = useState('wh1');
  const stock = useApi(() => supplyApi.stock(warehouseId), [warehouseId]);
  const [costCenterKey, setCc] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!costCenterKey) {
      const def = user.costCenterKey ?? cc.forUnit(unit)[0]?.key;
      if (def) setCc(def);
    }
  }, [cc.rows, costCenterKey, unit, user.costCenterKey]);
  useEffect(() => setItems([]), [type, warehouseId]);
  const goods = type !== 'service';
  const options = (stock.data ?? []).filter((s) => !CATS[type]?.length || CATS[type]!.includes(s.category));
  const amount = items.reduce((s, i) => s + i.qty * i.unitCost, 0);
  const budget = useApi(() => supplyApi.budget(type, amount), [type, amount]);
  const ctx = useMemo(() => ({ type, amount, departmentId: user.departmentId, requesterId: user.id }), [type, amount, user]);
  const itemsOk = !goods || (items.length > 0 && items.every((i) => i.warehouseItemId && i.qty > 0 && i.qty <= (stock.data?.find((s) => s.id === i.warehouseItemId)?.available ?? 0)));
  const setItem = (idx: number, p: Partial<SupplyItem>) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, ...p } : x)));
  const pick = (idx: number, id: string) => {
    const s = stock.data?.find((x) => x.id === id);
    if (s) setItem(idx, { warehouseItemId: s.id, sku: s.sku, name: s.name, unit: s.unit, unitCost: s.unitCost });
  };

  async function save(submit: boolean) {
    if (!description.trim() || !costCenterKey || !itemsOk) {
      setShowErr(true);
      return;
    }
    setBusy(true);
    try {
      const r = await supplyApi.create({ type, description, items: goods ? items : [], warehouseId, costCenterKey, submit }, user);
      toast(`${r.number}: ${submit ? t('hist_submitted') : t('rstatus_draft')}`);
      navigate(`/requests/${r.id}`);
    } catch (e) {
      toast(`${t('actionFailed')}: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader crumbs={[{ label: t('navRequests'), to: '/requests' }, { label: t('newRequest') }]} title={t('newRequest')} subtitle={t('req_formSub')} />
      <Card title={t('details')}>
        <div className="form-grid">
          <Field label={t('requestType')} required>
            <Select<EmployeeRequestType> value={type} onChange={setType} options={REQ_TYPES.map((x) => ({ value: x, label: t(tk('rtype_', x)) }))} ariaLabel={t('requestType')} />
          </Field>
          <Field label={t('proc_costCenter')} required error={showErr && !costCenterKey ? t('formRequired') : undefined} hint={t('req_ccHint')}>
            <CostCenterSelect value={costCenterKey} onChange={setCc} unit={unit} ariaLabel={t('proc_costCenter')} />
          </Field>
          {goods && (
            <Field label={t('proc_warehouse')} required>
              <Select<string> value={warehouseId} onChange={setWarehouseId} options={(locations.data ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} ariaLabel={t('proc_warehouse')} />
            </Field>
          )}
          <Field label={goods ? t('req_purpose') : t('req_serviceDescr')} required error={showErr && !description.trim() ? t('formRequired') : undefined} className="span-2">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} ariaLabel={t('description')} />
          </Field>
        </div>
      </Card>
      {goods && (
        <Card title={t('items')} actions={<Button size="small" icon="plus" onClick={() => setItems((l) => [...l, { name: '', unit: '', qty: 1, unitCost: 0 }])}>{t('addItem')}</Button>} flush>
          <div className="table-wrap">
            <table className="table req-items">
              <thead>
                <tr>
                  <th style={{ width: '50%' }}>{t('req_stockItem')}</th>
                  <th className="right">{t('req_available')}</th>
                  <th style={{ width: 100 }}>{t('qty')}</th>
                  <th className="right">{t('amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const s = stock.data?.find((x) => x.id === it.warehouseItemId);
                  return (
                    <tr key={i}>
                      <td><Select<string> value={it.warehouseItemId ?? ''} onChange={(v) => pick(i, v)} placeholder="—" options={options.map((o) => ({ value: o.id, label: `${o.sku} · ${o.name}`, disabled: o.available <= 0 }))} ariaLabel={t('req_stockItem')} /></td>
                      <td className="right num">{s ? `${s.available} ${s.unit}` : '—'}</td>
                      <td><Input type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} ariaLabel={t('qty')} /></td>
                      <td className="right num">{formatMoney(it.qty * it.unitCost)}</td>
                      <td><Button size="small" type="text" icon="trash" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} title={t('proc_removeItem')} /></td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={3} className="right" style={{ fontWeight: 700 }}>{t('total')}</td>
                  <td className="right num" style={{ fontWeight: 700 }}>{formatMoney(amount)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {showErr && !itemsOk && <p className="error-text" style={{ padding: '0 14px 14px', margin: 0 }}>{t('req_itemsError')}</p>}
        </Card>
      )}
      <div className="grid grid-2">
        <Card title={t('proc_budgetCheck')}>
          {budget.data ? (
            <div className={budget.data.ok ? 'pc-note' : 'pc-danger'}>
              {t('proc_budgetAvailable')}: <b>{formatMoney(budget.data.available)}</b> · {t('amount')}: {formatMoney(amount)} — {budget.data.ok ? t('proc_budgetOk') : t('proc_budgetLack')}
            </div>
          ) : null}
        </Card>
        <Card title={t('route')}>
          <RouteSteps preview={{ entity: 'employee_request', context: ctx }} />
        </Card>
      </div>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/requests')}>{t('cancel')}</Button>
        <Button disabled={busy} onClick={() => save(false)}>{t('saveDraft')}</Button>
        <Button type="primary" disabled={busy} onClick={() => save(true)}>{t('submitForApproval')}</Button>
      </div>
    </>
  );
}

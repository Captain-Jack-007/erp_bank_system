// Склад: настройки уведомлений (PR-WMS-040) — порог залежалости (дней на складе) общий и по категориям номенклатуры,
// горизонт предупреждения о сроке годности. Порог используется отчётом «Залежалые запасы», фильтром партий,
// KPI и уведомлениями ежедневного мониторинга. Менять может главный бухгалтер / администратор (с подтверждением 2FA).
import { useEffect, useState } from 'react';
import { canEditWarehouseSettings, formatMoney, tk, warehouseApi, type WarehouseCategory, type WarehouseSettings } from '@xb/shared';
import { Button, Card, DataTable, Field, Input, useToast } from '../../components/ui';
import { FieldHistory } from '../../components/FieldHistory';
import { useStepUp } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useP, useWmsError } from './wmsShared';

const CATEGORIES: WarehouseCategory[] = ['office', 'it', 'forms', 'household', 'security', 'mbp', 'fixed'];

export function SettingsTab() {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const stepUp = useStepUp();
  const err = useWmsError('warehouse_err_');
  const settings = useApi(() => warehouseApi.getSettings());
  const stale = useApi(() => warehouseApi.staleReport());
  const canEdit = canEditWarehouseSettings(user);
  const [form, setForm] = useState<{ staleDays: string; expiryWarnDays: string; cats: Partial<Record<WarehouseCategory, string>> } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const s = settings.data;
  useEffect(() => {
    if (s && !form) setForm({ staleDays: String(s.staleDays), expiryWarnDays: String(s.expiryWarnDays), cats: Object.fromEntries(Object.entries(s.staleByCategory).map(([k, v]) => [k, String(v)])) });
  }, [s, form]);
  if (!s || !form) return <div className="wms-pad"><div className="skeleton" style={{ width: '50%' }} /></div>;
  const byCat = (c: WarehouseCategory) => (stale.data ?? []).filter((r) => r.category === c);

  async function save() {
    if (!form) return;
    setError('');
    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const patch: Partial<WarehouseSettings> = {
      staleDays: Number(form.staleDays),
      expiryWarnDays: Number(form.expiryWarnDays),
      staleByCategory: Object.fromEntries(CATEGORIES.map((c) => [c, num(form.cats[c] ?? '')]).filter(([, v]) => v !== undefined)) as WarehouseSettings['staleByCategory'],
    };
    if (!(await stepUp())) return;
    setBusy(true);
    try {
      await warehouseApi.updateSettings(patch, user);
      toast(t('saved'));
      setForm(null);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wms-pad">
      <Card
        title={p('Порог залежалости и сроки годности', 'Uzoq saqlanish chegarasi va yaroqlilik muddatlari', 'Slow-moving threshold and expiry')}
        actions={canEdit ? <Button type="primary" loading={busy} onClick={save}>{t('save')}</Button> : undefined}
      >
        <p className="wms-note">
          {p(
            'Партия считается залежалой, если пролежала на складе не меньше порога своей категории (пусто — общий порог). Порог применяется в отчёте «Залежалые запасы», фильтре партий, на главной модуля и в уведомлениях ежедневного мониторинга.',
            'Partiya o‘z toifasi chegarasidan kam bo‘lmagan muddat omborda turgan bo‘lsa, uzoq saqlangan hisoblanadi (bo‘sh — umumiy chegara). Chegara «Uzoq saqlangan zaxiralar» hisobotida, partiyalar filtrida, modul bosh sahifasida va kundalik monitoring xabarnomalarida qo‘llaniladi.',
            'A batch is slow-moving when it has stayed in stock at least as long as its category threshold (blank — the general threshold). The threshold drives the slow-moving stock report, the batch filter, the module KPI and daily monitoring alerts.',
          )}
        </p>
        <div className="form-grid">
          <Field label={p('Общий порог залежалости, дней', 'Umumiy uzoq saqlanish chegarasi, kun', 'General slow-moving threshold, days')} required>
            <Input type="number" value={form.staleDays} disabled={!canEdit} onChange={(e) => setForm({ ...form, staleDays: e.target.value })} ariaLabel="staleDays" />
          </Field>
          <Field label={p('Предупреждать о сроке годности за, дней', 'Yaroqlilik muddati haqida ogohlantirish, kun oldin', 'Warn about expiry, days ahead')} required>
            <Input type="number" value={form.expiryWarnDays} disabled={!canEdit} onChange={(e) => setForm({ ...form, expiryWarnDays: e.target.value })} ariaLabel="expiryWarnDays" />
          </Field>
        </div>
        {error && <div className="error-text">{error}</div>}
      </Card>
      <Card title={p('Порог по категориям номенклатуры', 'Nomenklatura toifalari bo‘yicha chegara', 'Threshold by item category')} flush>
        <DataTable<WarehouseCategory>
          rows={CATEGORIES}
          rowKey={(c) => c}
          columns={[
            { header: p('Категория', 'Toifa', 'Category'), render: (c) => t(tk('warehouse_cat_', c)) },
            {
              header: p('Порог, дней', 'Chegara, kun', 'Threshold, days'),
              render: (c) => (
                <Input type="number" value={form.cats[c] ?? ''} placeholder={String(form.staleDays)} disabled={!canEdit} onChange={(e) => setForm({ ...form, cats: { ...form.cats, [c]: e.target.value } })} ariaLabel={`stale-${c}`} />
              ),
            },
            { header: p('Действует сейчас', 'Hozir amalda', 'In effect now'), align: 'right', render: (c) => `${s.staleByCategory[c] ?? s.staleDays} ${p('дн.', 'kun', 'days')}` },
            { header: p('Залежалых партий', 'Uzoq saqlangan partiyalar', 'Slow-moving batches'), align: 'right', render: (c) => `${byCat(c).length} · ${formatMoney(byCat(c).reduce((x, r) => x + r.value, 0))}` },
          ]}
        />
      </Card>
      <Card title={t('audit_history')}>
        <FieldHistory entity="warehouse_settings" entityId="warehouse" />
      </Card>
    </div>
  );
}

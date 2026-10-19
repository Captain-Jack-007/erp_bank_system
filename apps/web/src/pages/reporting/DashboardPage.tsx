// BI-дашборд руководства (ТЗ 4.2.8, PR-REP-013/014): KPI с целевыми значениями и светофором по роли пользователя,
// тренды, переход к источнику, дашборд по направлениям (подразделения / филиалы).
import { useState } from 'react';
import { can, formatMoneyShort, formatNumber, localize, reportingApi, type ReportKpi, userMessage } from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, Field, Input, LineChart, Loading, Modal, PageHeader, Stat, useToast } from '../../components/ui';
import { Segmented } from '../../components/flow';
import { ExportButton } from '../../components/Export';
import { navigate } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useP } from '../taxes/common';

type Dim = 'department' | 'branch';

export function DashboardPage() {
  const { t, lang } = useSession();
  const p = useP();
  const user = useUser();
  const kpis = useApi(() => reportingApi.dashboard(user), [user.id]);
  const [dim, setDim] = useState<Dim>('department');
  const dirs = useApi(() => reportingApi.directions(dim, lang), [dim, lang]);
  const [editing, setEditing] = useState<ReportKpi | null>(null);
  const canTarget = can(user, 'reporting', 'edit') || user.role === 'finance';
  const fmt = (k: Pick<ReportKpi, 'unit'>, v: number) => (k.unit === 'money' ? formatMoneyShort(v, lang) : k.unit === 'percent' ? `${formatNumber(Math.round(v * 10) / 10)}%` : formatNumber(v));
  const list = kpis.data ?? [];
  const counts = { ok: list.filter((k) => k.status === 'ok').length, warn: list.filter((k) => k.status === 'warn').length, bad: list.filter((k) => k.status === 'bad').length };
  const groupLabel = (g: ReportKpi['group']) =>
    g === 'finance' ? p('Финансы и группа', 'Moliya va guruh', 'Finance & group') : g === 'budget' ? p('Бюджет', 'Byudjet', 'Budget') : g === 'cash' ? p('Наличность и НДО', 'Naqd pul va NPA', 'Cash') : g === 'tax' ? p('Налоги', 'Soliqlar', 'Taxes') : p('Операции', 'Operatsiyalar', 'Operations');
  const groups = [...new Set(list.map((k) => k.group))];
  const dirCols = dim === 'department'
    ? [
        { key: 'plan', label: p('План на год', 'Yillik reja', 'Annual plan'), money: true },
        { key: 'actual', label: p('Факт с начала года', 'Yil boshidan fakt', 'Actual YTD'), money: true },
        { key: 'execution', label: p('Исполнение, %', 'Ijro, %', 'Execution, %'), money: false },
        { key: 'procurement', label: p('Закупки', 'Xaridlar', 'Procurement'), money: true },
        { key: 'requests', label: p('Заявок', 'Arizalar', 'Requests'), money: false },
      ]
    : [
        { key: 'cash', label: p('Наличность', 'Naqd pul', 'Cash'), money: true },
        { key: 'ndoIncome', label: p('Доходы НДО', 'NPA daromadlari', 'Cash income'), money: true },
        { key: 'ndoCost', label: p('Себестоимость НДО', 'NPA tannarxi', 'Cash cost'), money: true },
        { key: 'taxes', label: p('Налоги по филиалу', 'Filial soliqlari', 'Branch taxes'), money: true },
      ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('reporting_title'), to: '/reporting' }, { label: p('KPI-дашборд', 'KPI dashbordi', 'KPI dashboard') }]}
        title={p('Дашборд руководства', 'Rahbariyat dashbordi', 'Management dashboard')}
        subtitle={`${t('tzLabel')} 4.2.8 · ${p('набор показателей зависит от роли; данные — из модулей системы', "ko‘rsatkichlar to‘plami rolga bog‘liq; ma'lumotlar tizim modullaridan", 'the KPI set depends on your role; data comes from system modules')}`}
        actions={<Button size="small" icon="refresh" onClick={() => { kpis.reload(); dirs.reload(); }}>{t('reporting_refresh')}</Button>}
      />
      <div className="grid grid-4">
        <Stat label={p('Показателей', 'Ko‘rsatkichlar', 'KPIs')} value={list.length || '—'} icon="chart" tone="accent" />
        <Stat label={p('В норме', 'Me’yorda', 'On target')} value={counts.ok} icon="check" />
        <Stat label={p('Внимание', 'Diqqat', 'Watch')} value={counts.warn} icon="clock" />
        <Stat label={p('Отклонение от цели', 'Maqsaddan og‘ish', 'Off target')} value={counts.bad} icon="alert" tone={counts.bad ? 'alert' : undefined} />
      </div>
      {kpis.loading && !kpis.data ? (
        <Card><Loading /></Card>
      ) : !list.length ? (
        <Card><Empty text={t('empty')} icon="chart" /></Card>
      ) : (
        groups.map((g) => (
          <Card key={g} title={groupLabel(g)}>
            <div className="grid grid-3">
              {list.filter((k) => k.group === g).map((k) => (
                <div key={k.id} className="card" style={{ padding: 14, margin: 0, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div className="muted small" style={{ minWidth: 0 }}>{localize(k.name, lang)}</div>
                    <Badge tone={k.status === 'ok' ? 'ok' : k.status === 'warn' ? 'warn' : 'danger'}>
                      {k.status === 'ok' ? p('норма', 'me’yor', 'ok') : k.status === 'warn' ? p('внимание', 'diqqat', 'watch') : p('отклонение', 'og‘ish', 'off')}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, margin: '6px 0' }} className="num">{fmt(k, k.value)}</div>
                  <div className="muted small">
                    {p('Цель', 'Maqsad', 'Target')}: {k.better === 'higher' ? '≥' : '≤'} {fmt(k, k.target)}
                  </div>
                  {k.trend && k.trend.length > 1 && (
                    <div style={{ marginTop: 6 }}>
                      <LineChart labels={k.trend.map((_, i) => String(i + 1))} series={[{ name: localize(k.name, lang) ?? k.id, values: k.trend }]} height={70} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <Button size="small" onClick={() => navigate(k.link)}>{p('Источник', 'Manba', 'Source')} →</Button>
                    {canTarget && <Button size="small" type="text" onClick={() => setEditing(k)}>{p('Цель', 'Maqsad', 'Target')}</Button>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
      <Card
        title={p('Дашборд по направлениям', 'Yo‘nalishlar bo‘yicha dashbord', 'Dashboard by direction')}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Segmented<Dim> value={dim} onChange={setDim} options={[{ value: 'department', label: p('Подразделения', 'Bo‘linmalar', 'Departments') }, { value: 'branch', label: p('Филиалы', 'Filiallar', 'Branches') }]} />
            <ExportButton filename={`dashboard-${dim}`} columns={[{ header: p('Направление', 'Yo‘nalish', 'Direction'), value: (r: { label: string }) => r.label }, ...dirCols.map((c) => ({ header: c.label, value: (r: { metrics: Record<string, number> }) => r.metrics[c.key] ?? 0, ...(c.money ? { format: 'money' as const, total: true } : {}) }))]} rows={dirs.data ?? []} />
          </div>
        }
        flush
      >
        <DataTable
          rows={dirs.data}
          loading={dirs.loading}
          rowKey={(r) => r.key}
          onRowClick={(r) => navigate(r.link)}
          columns={[
            { header: p('Направление', 'Yo‘nalish', 'Direction'), render: (r) => <b>{r.label}</b> },
            ...dirCols.map((c) => ({ header: c.label, align: 'right' as const, render: (r: { metrics: Record<string, number> }) => (c.money ? formatMoneyShort(r.metrics[c.key] ?? 0, lang) : c.key === 'execution' ? `${formatNumber(Math.round((r.metrics[c.key] ?? 0) * 10) / 10)}%` : formatNumber(r.metrics[c.key] ?? 0)) })),
          ]}
        />
      </Card>
      {editing && <TargetModal kpi={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TargetModal({ kpi, onClose }: { kpi: ReportKpi; onClose: () => void }) {
  const { t, lang } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const [value, setValue] = useState(String(kpi.target));
  const [error, setError] = useState('');
  async function save() {
    const n = Number(value.replace(/\s/g, '').replace(',', '.'));
    if (!value.trim() || !Number.isFinite(n)) {
      setError(t('reporting_err_target'));
      return;
    }
    try {
      await reportingApi.setTarget(kpi.id, n, user);
      toast(p('Целевое значение сохранено', 'Maqsadli qiymat saqlandi', 'Target saved'));
      onClose();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.startsWith('reporting_') ? t(m as never) : userMessage(m));
    }
  }
  return (
    <Modal
      title={`${p('Цель', 'Maqsad', 'Target')}: ${localize(kpi.name, lang)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('save')}</button>
        </>
      }
    >
      <Field label={`${p('Целевое значение', 'Maqsadli qiymat', 'Target value')} (${kpi.unit === 'money' ? 'UZS' : kpi.unit === 'percent' ? '%' : p('шт.', 'dona', 'pcs')})`} error={error} hint={kpi.better === 'higher' ? p('Чем больше, тем лучше', 'Qancha ko‘p bo‘lsa, shuncha yaxshi', 'Higher is better') : p('Чем меньше, тем лучше', 'Qancha kam bo‘lsa, shuncha yaxshi', 'Lower is better')}>
        <Input value={value} inputMode="decimal" onChange={(e) => { setValue(e.target.value); setError(''); }} />
      </Field>
    </Modal>
  );
}

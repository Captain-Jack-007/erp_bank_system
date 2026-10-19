// Экономика НДО (ТЗ 4.2.20): единый контур доходов, расходов, остатков, фондирования, аллокации и себестоимости
// налично-денежного обращения с качеством данных и закрытием периода.
import { useState } from 'react';
import { formatMoneyShort, localize, NDO_ERRORS, ndoApi, NDO_PERIODS, type NdoObject, userMessage } from '@xb/shared';
import { Badge, PageHeader, Select, Stat, Tabs, Card, useToast } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useP, useUrlTab } from '../taxes/common';
import { ClassesTab, DataTab, FactsTab, ObjectsTab, useNdoLabels } from './NdoTabsA';
import { AllocTab, BalancesTab, BudgetTab } from './NdoTabsB';
import { CloseTab, CostTab, DashboardTab, DevicesTab, ParamsTab, TariffsTab } from './NdoTabsC';

const TABS = ['dashboard', 'objects', 'classes', 'data', 'facts', 'budget', 'balances', 'alloc', 'cost', 'devices', 'tariffs', 'close', 'params'] as const;
type Tab = (typeof TABS)[number];

export function useNdoRun() {
  const toast = useToast();
  const { lang } = useSession();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async run(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
      setBusy(true);
      try {
        await fn();
        toast(ok);
        return true;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        toast(NDO_ERRORS[m] ? localize(NDO_ERRORS[m], lang) : userMessage(m));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

/** Названия объектов НДО. */
export function useNdoObjects() {
  const { lang } = useSession();
  const list = useApi(() => ndoApi.listObjects());
  const name = (key: string | undefined) => {
    if (!key) return '—';
    const o = list.data?.find((x) => x.key === key);
    return o ? localize(o.name, lang) : key;
  };
  return { list: list.data ?? ([] as NdoObject[]), name };
}

export function NdoPage() {
  const { t, lang } = useSession();
  const p = useP();
  const user = useUser();
  const lbl = useNdoLabels();
  const [tab, setTab] = useUrlTab<Tab>(TABS, 'dashboard');
  const [period, setPeriod] = useState('2026-09');
  const states = useApi(() => ndoApi.listPeriodStates());
  const res = useApi(() => ndoApi.results(period), [period]);
  const st = states.data?.find((s) => s.period === period);
  const r = res.data;
  const fn = (['input', 'calc', 'check', 'approve'] as const).filter((f) => ndoApi.can(user, f));
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('cash_title'), to: '/cash' }, { label: p('Экономика НДО', 'NPA iqtisodiyoti', 'Cash economics') }]}
        title={p('Доходы, расходы и себестоимость НДО', 'NPA daromadlari, xarajatlari va tannarxi', 'Cash function income, costs and unit cost')}
        subtitle={`${t('tzLabel')} 4.2.20 · ${p('единый контур: объекты, данные, бюджет, остатки и FTP, аллокация, себестоимость, P&L, тарифы, качество, закрытие', "yagona kontur: obyektlar, ma'lumotlar, byudjet, qoldiqlar va FTP, taqsimot, tannarx, P&L, tariflar, sifat, yopish", 'single scope: objects, data, budget, balances & FTP, allocation, cost, P&L, tariffs, quality, close')}`}
        actions={
          <>
            <Select<string> value={period} onChange={setPeriod} options={NDO_PERIODS.map((x) => ({ value: x, label: x }))} ariaLabel={p('Период', 'Davr', 'Period')} />
            {st && <Badge tone={st.status === 'closed' ? 'ok' : st.status === 'pending_approval' ? 'warn' : 'info'}>{st.status === 'closed' ? p('период закрыт', 'davr yopilgan', 'period closed') : st.status === 'pending_approval' ? p('на утверждении', 'tasdiqlashda', 'pending approval') : p('период открыт', 'davr ochiq', 'period open')}</Badge>}
            <Badge tone="muted">{p('Мои функции', 'Funksiyalarim', 'My functions')}: {fn.length ? fn.map((x) => lbl(x)).join(', ') : p('просмотр', "ko'rish", 'view')}</Badge>
          </>
        }
      />
      <div className="grid grid-4">
        <Stat label={p('Внешние доходы', 'Tashqi daromadlar', 'External income')} value={r ? formatMoneyShort(r.totals.income, lang) : '—'} icon="wallet" tone="accent" foot={r ? `${p('внутр. расчёты', 'ichki hisob-kitoblar', 'internal')}: ${formatMoneyShort(r.totals.incomeInternal, lang)}` : undefined} />
        <Stat label={p('Полная себестоимость', "To'liq tannarx", 'Full cost')} value={r ? formatMoneyShort(r.totals.total, lang) : '—'} icon="pie" foot={r ? `${p('фондирование', 'fondlash', 'funding')}: ${formatMoneyShort(r.totals.funding, lang)}` : undefined} />
        <Stat label={p('Экономический результат', 'Iqtisodiy natija', 'Economic result')} value={r ? formatMoneyShort(r.totals.result, lang) : '—'} icon="chart" tone={r && r.totals.result < 0 ? 'alert' : undefined} />
        <Stat label={p('Хэш результата', 'Natija xeshi', 'Result hash')} value={r ? r.hash.slice(0, 10) : '—'} icon="key" foot={r?.methodology} />
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'dashboard', label: p('Дашборд', 'Dashbord', 'Dashboard') },
            { value: 'objects', label: p('Объекты', 'Obyektlar', 'Objects') },
            { value: 'classes', label: p('Классификаторы', 'Klassifikatorlar', 'Classifiers') },
            { value: 'data', label: p('Данные и загрузки', "Ma'lumotlar va yuklashlar", 'Data & loads') },
            { value: 'facts', label: p('Факты и корректировки', 'Faktlar va tuzatishlar', 'Facts & adjustments') },
            { value: 'budget', label: p('Бюджет и план-факт', 'Byudjet va reja-fakt', 'Budget & plan-actual') },
            { value: 'balances', label: p('Остатки и фондирование', 'Qoldiqlar va fondlash', 'Balances & funding') },
            { value: 'alloc', label: p('Аллокация', 'Taqsimot', 'Allocation') },
            { value: 'cost', label: p('Себестоимость и P&L', 'Tannarx va P&L', 'Cost & P&L') },
            { value: 'devices', label: p('Устройства и OptiLoad', 'Qurilmalar va OptiLoad', 'Devices & OptiLoad') },
            { value: 'tariffs', label: p('Тарифы', 'Tariflar', 'Tariffs') },
            { value: 'close', label: p('Качество и закрытие', 'Sifat va yopish', 'Quality & close') },
            { value: 'params', label: p('Параметры и роли', 'Parametrlar va rollar', 'Parameters & roles') },
          ]}
        />
        {tab === 'dashboard' && <DashboardTab period={period} />}
        {tab === 'objects' && <ObjectsTab />}
        {tab === 'classes' && <ClassesTab />}
        {tab === 'data' && <DataTab period={period} />}
        {tab === 'facts' && <FactsTab period={period} />}
        {tab === 'budget' && <BudgetTab period={period} />}
        {tab === 'balances' && <BalancesTab period={period} />}
        {tab === 'alloc' && <AllocTab period={period} />}
        {tab === 'cost' && <CostTab period={period} />}
        {tab === 'devices' && <DevicesTab period={period} />}
        {tab === 'tariffs' && <TariffsTab period={period} />}
        {tab === 'close' && <CloseTab period={period} />}
        {tab === 'params' && <ParamsTab />}
      </Card>
    </>
  );
}

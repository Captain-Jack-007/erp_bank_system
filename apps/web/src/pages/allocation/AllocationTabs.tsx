// Аллокация (ТЗ 4.2.14): методы и цепочка step-down, библиотека драйверов (формулы, источники, маппинг, ручной ввод),
// сбор затрат с бухгалтерских счетов, What-if песочница, закрытие периода со снимком справочников.
import { useState } from 'react';
import {
  allocationApi,
  formatDateTime,
  formatDecimal,
  formatMoneyShort,
  formatNumber,
  importRegistry,
  type AllocationDriverDef,
  type AllocationGlCategory,
  type AllocationGlEntry,
  type AllocationMapping,
  type AllocationMethod,
  type AllocationScenario,
  type AllocationSnapshot,
  type AllocationWhatIf,
} from '@xb/shared';
import { Badge, BarChart, Button, Card, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, Select, Stat, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { ImportWizard } from '../../components/Import';
import { useCan, useStepUp } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { usePick } from '../budgeting/shared';
import { useAllocErr, useDriverName } from './AllocationPage';

export function useMethodLabel() {
  const p = usePick();
  return (m: AllocationMethod) => ({ direct: p('Прямой', "To'g'ridan-to'g'ri", 'Direct'), step_down: p('Каскадный (Step-Down)', 'Kaskadli (Step-Down)', 'Step-down'), reciprocal: p('Взаимный (матричный)', "O'zaro (matritsali)", 'Reciprocal (matrix)') })[m];
}

function useCenterTypeLabel() {
  const p = usePick();
  return (t: string) => ({ admin: p('Административный', "Ma'muriy", 'Administrative'), service: p('Обслуживающий', 'Xizmat ko‘rsatuvchi', 'Service'), business: p('Бизнес-центр', 'Biznes-markaz', 'Business centre') })[t] ?? t;
}

export function MethodTab() {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useAllocErr();
  const label = useMethodLabel();
  const typeLabel = useCenterTypeLabel();
  const lk = useLookups();
  const settings = useApi(() => allocationApi.getSettings());
  const centers = useApi(() => allocationApi.listCenters());
  const periods = allocationApi.periods;
  const cmp = useApi(() => allocationApi.compareMethods(periods[periods.length - 1]!));
  const [chain, setChain] = useState<string[] | null>(null);
  const editable = can('allocation', 'edit');
  const s = settings.data;
  const cur = chain ?? s?.chain ?? [];
  const name = (id: string) => centers.data?.find((c) => c.id === id);
  const move = (i: number, d: -1 | 1) => {
    const next = [...cur];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setChain(next);
  };
  const units = (centers.data ?? []).filter((c) => c.type === 'business');
  if (!s) return <Loading />;
  return (
    <div className="bud-split">
      <Card title={p('Метод распределения', 'Taqsimlash usuli', 'Allocation method')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(['direct', 'step_down', 'reciprocal'] as AllocationMethod[]).map((m) => (
            <label key={m} className="bud-switch" style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="alloc-method" checked={s.method === m} disabled={!editable} onChange={async () => { try { await allocationApi.updateSettings({ method: m }, user); toast(`${p('Метод', 'Usul', 'Method')}: ${label(m)}`); } catch (e) { toast(err(e)); } }} />
              <span>
                <b>{label(m)}</b>
                <div className="muted small">
                  {m === 'direct' && p('Затраты МВЗ направляются непосредственно в центры прибыли по драйверу пула.', 'MXJ xarajatlari pul drayveri bo‘yicha to‘g‘ridan-to‘g‘ri foyda markazlariga yo‘naltiriladi.', 'Cost-centre costs go straight to profit centres by the pool driver.')}
                  {m === 'step_down' && p('Обслуживающие центры по цепочке распределяют свои и полученные затраты на центры ниже по цепочке и бизнес-центры.', 'Xizmat markazlari zanjir bo‘yicha o‘z va olingan xarajatlarni quyi markazlar va biznes-markazlarga taqsimlaydi.', 'Service centres pass own and received costs down the chain and to business centres.')}
                  {m === 'reciprocal' && p('Учитывает взаимные услуги (ИТ ↔ АХД ↔ HR): система уравнений решается матричным методом Гаусса; для контроля — итерации до погрешности < 1 сум.', 'O‘zaro xizmatlarni hisobga oladi (AT ↔ MXD ↔ HR): tenglamalar tizimi Gauss matritsa usulida yechiladi; nazorat uchun — xatolik < 1 so‘m bo‘lguncha iteratsiyalar.', 'Accounts for reciprocal services (IT ↔ facilities ↔ HR): the equation system is solved by Gaussian matrix elimination; iterations to < 1 UZS error as a control.')}
                </div>
              </span>
            </label>
          ))}
          <div className="muted small">{p('Версия настроек', 'Sozlamalar versiyasi', 'Settings version')} {s.version} · {lk.user(s.updatedBy)?.fullName} · {formatDateTime(s.updatedAt)}</div>
          {!editable && <div className="muted small">{p('Изменять метод и цепочку может финансовый департамент без участия программистов.', 'Usul va zanjirni moliya departamenti dasturchilarsiz o‘zgartiradi.', 'The finance department changes the method and chain without programmers.')}</div>}
        </div>
      </Card>
      <Card
        title={p('Цепочка Step-Down', 'Step-Down zanjiri', 'Step-down chain')}
        actions={editable && chain ? <span style={{ display: 'flex', gap: 6 }}><Button size="small" onClick={() => setChain(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button size="small" type="primary" onClick={async () => { try { await allocationApi.updateSettings({ chain: cur }, user); setChain(null); toast(p('Цепочка сохранена', 'Zanjir saqlandi', 'Chain saved')); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button></span> : undefined}
      >
        <ol className="alloc-chain">
          {cur.map((id, i) => (
            <li key={id}>
              <span className="alloc-chain-n">{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{name(id) ? loc(name(id)!.name) : id}</b>
                <div className="sub">{name(id)?.code} · {typeLabel(name(id)?.type ?? '')}</div>
              </span>
              {editable && (
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <Button size="small" type="text" title={p('Выше', 'Yuqoriga', 'Up')} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                  <Button size="small" type="text" title={p('Ниже', 'Pastga', 'Down')} disabled={i === cur.length - 1} onClick={() => move(i, 1)}>↓</Button>
                </span>
              )}
            </li>
          ))}
          <li className="alloc-chain-end">→ {units.map((u) => u.code).join(' · ')}</li>
        </ol>
      </Card>
      <Card title={`${p('Сравнение методов', 'Usullarni taqqoslash', 'Method comparison')} · ${periods[periods.length - 1]}`} flush>
        {!cmp.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={units}
            rowKey={(u) => u.id}
            columns={[
              { header: p('Центр прибыли', 'Foyda markazi', 'Profit centre'), render: (u) => <>{loc(u.name)}<div className="sub">{u.code}</div></> },
              ...cmp.data.map((c) => ({ header: label(c.method), align: 'right' as const, render: (u: { id: string }) => formatMoneyShort(c.totals.find((x) => x.unitId === u.id)?.amount ?? 0, lang) })),
            ]}
          />
        )}
        {cmp.data && <div className="muted small" style={{ padding: '8px 18px 14px' }}>{p('Взаимный метод: итераций', 'O‘zaro usul: iteratsiyalar', 'Reciprocal: iterations')} {cmp.data.find((c) => c.method === 'reciprocal')?.iterations}, {p('погрешность', 'xatolik', 'residual')} {formatDecimal(cmp.data.find((c) => c.method === 'reciprocal')?.residual ?? 0, 2)} {p('сум', "so'm", 'UZS')}</div>}
      </Card>
      <Card title={p('Центры ответственности', 'Mas’uliyat markazlari', 'Responsibility centres')} flush>
        <DataTable
          rows={centers.data}
          rowKey={(c) => c.id}
          columns={[
            { header: p('Центр', 'Markaz', 'Centre'), render: (c) => <>{loc(c.name)}<div className="sub">{c.code}{c.orgUnitKey ? ` · ${c.orgUnitKey}` : ''}</div></> },
            { header: p('Тип', 'Turi', 'Type'), render: (c) => <Badge tone={c.type === 'business' ? 'ok' : c.type === 'service' ? 'info' : 'warn'}>{typeLabel(c.type)}</Badge> },
            { header: p('Подразделение', "Bo'linma", 'Department'), render: (c) => (c.departmentId ? lk.department(c.departmentId)?.code : '—') },
          ]}
        />
      </Card>
    </div>
  );
}

const SOURCE_LABEL: Record<AllocationDriverDef['source'], [string, string, string]> = {
  hr: ['HR-система (Laborlaw)', 'HR tizimi (Laborlaw)', 'HR system (Laborlaw)'],
  assets: ['Модуль ОС', 'AV moduli', 'Fixed assets module'],
  abs: ['АБС (Okub / iABS)', 'ABT (Okub / iABS)', 'Core banking (Okub / iABS)'],
  timesheets: ['Табели (ACMS)', 'Tabellar (ACMS)', 'Timesheets (ACMS)'],
  portfolio: ['Портфели (FTP / КХД)', 'Portfellar (FTP / KXO)', 'Portfolios (FTP / DWH)'],
  profit: ['Доходность (FTP)', 'Daromadlilik (FTP)', 'Profitability (FTP)'],
  manual: ['Ручной ввод', 'Qo‘lda kiritish', 'Manual'],
  formula: ['Формула', 'Formula', 'Formula'],
};

export function DriversTab({ periods }: { periods: string[] }) {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useAllocErr();
  const lk = useLookups();
  const drivers = useApi(() => allocationApi.listDrivers());
  const mapping = useApi(() => allocationApi.listMapping());
  const log = useApi(() => allocationApi.listDriverLog());
  const centers = useApi(() => allocationApi.listCenters());
  const [period, setPeriod] = useState(periods[periods.length - 1]!);
  const [edit, setEdit] = useState<{ id?: string; code: string; name: string; unit: string; formula: string } | null>(null);
  const [test, setTest] = useState<{ unitId: string; value: number }[] | null>(null);
  const [map, setMap] = useState<AllocationMapping | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = can('allocation', 'edit');
  const src = (s: AllocationDriverDef['source']) => p(...SOURCE_LABEL[s]);
  const centerCode = (id: string) => centers.data?.find((c) => c.id === id)?.code ?? id;
  const target = importRegistry.get('allocation_driver_values');
  return (
    <>
      <FilterBar>
        <Select value={period} onChange={setPeriod} ariaLabel={p('Период драйверов', 'Drayverlar davri', 'Driver period')} options={periods.map((x) => ({ value: x, label: x }))} />
        <span className="muted small" style={{ flex: 1 }}>{p('Драйверы получаются автоматически из систем-источников; при сбое интеграции — ручной ввод или загрузка файла с фиксацией в журнале аудита.', 'Drayverlar manba tizimlaridan avtomatik olinadi; integratsiya nosozligida — qo‘lda kiritish yoki fayl yuklash, audit jurnaliga yoziladi.', 'Drivers come automatically from source systems; on integration failure — manual entry or file upload, logged to the audit trail.')}</span>
        {editable && (
          <>
            <Button size="small" icon="refresh" loading={busy} onClick={async () => { setBusy(true); try { const r = await allocationApi.refreshDrivers(period, user); toast(`${p('Обновлено значений', 'Yangilangan qiymatlar', 'Values updated')}: ${r.updated} · ${r.exchanges.map((x) => `${x.system}:${x.status}`).join(', ')}`); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>{p('Обновить из источников', 'Manbalardan yangilash', 'Refresh from sources')}</Button>
            {target && <Button size="small" icon="upload" onClick={() => setImporting(true)}>{p('Загрузить файл', 'Fayl yuklash', 'Upload file')}</Button>}
            <Button size="small" type="primary" icon="plus" onClick={() => setEdit({ code: '', name: '', unit: 'idx', formula: '' })}>{p('Новый драйвер', 'Yangi drayver', 'New driver')}</Button>
          </>
        )}
      </FilterBar>
      <DataTable
        rows={drivers.data}
        loading={drivers.loading}
        rowKey={(d) => d.id}
        columns={[
          { header: p('Драйвер', 'Drayver', 'Driver'), render: (d) => <>{loc(d.name)}<div className="sub">{d.code} · {d.unit}</div></> },
          { header: p('Источник', 'Manba', 'Source'), render: (d) => <Badge tone={d.source === 'formula' ? 'info' : 'muted'}>{src(d.source)}</Badge> },
          { header: p('Формула / связь', 'Formula / bog‘lanish', 'Formula / mapping'), render: (d) => { const m = mapping.data?.find((x) => x.driverId === d.id); return <span className="small">{d.formula ? <code>{d.formula}</code> : m ? `${m.system} · ${m.operation} · ${m.field}` : '—'}</span>; } },
          {
            header: '',
            render: (d) => (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                {editable && !d.system && <Button size="small" type="text" icon="pen" title={p('Изменить формулу', 'Formulani o‘zgartirish', 'Edit formula')} onClick={() => setEdit({ id: d.id, code: d.code, name: loc(d.name), unit: d.unit, formula: d.formula ?? '' })} />}
                {editable && d.source !== 'formula' && <Button size="small" type="text" icon="plug" title={p('Маппинг источника', 'Manba mappingi', 'Source mapping')} onClick={() => setMap(mapping.data?.find((x) => x.driverId === d.id) ?? { driverId: d.id, system: '', operation: '', field: '', centerKeys: {}, updatedAt: '', updatedBy: user.id })} />}
              </span>
            ),
          },
        ]}
      />
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title={p('Связь с источниками (Mapping)', 'Manbalar bilan bog‘lanish (Mapping)', 'Source mapping')} flush>
          <DataTable
            rows={mapping.data}
            rowKey={(m) => m.driverId}
            columns={[
              { header: p('Драйвер', 'Drayver', 'Driver'), render: (m) => { const d = drivers.data?.find((x) => x.id === m.driverId); return d ? loc(d.name) : m.driverId; } },
              { header: p('Система', 'Tizim', 'System'), render: (m) => m.system },
              { header: p('Операция / поле', 'Operatsiya / maydon', 'Operation / field'), render: (m) => <span className="small">{m.operation} · {m.field}</span> },
              { header: p('Ключи центров', 'Markazlar kalitlari', 'Centre keys'), render: (m) => <span className="small">{Object.entries(m.centerKeys).map(([k, v]) => `${centerCode(k)}=${v}`).join(', ')}</span> },
              { header: p('Изменено', "O'zgartirilgan", 'Updated'), render: (m) => <span className="muted small">{lk.user(m.updatedBy)?.fullName}<br />{formatDateTime(m.updatedAt)}</span> },
            ]}
          />
        </Card>
        <Card title={p('Журнал изменений значений драйверов', 'Drayver qiymatlari o‘zgarishlari jurnali', 'Driver value change log')} flush>
          <DataTable
            rows={(log.data ?? []).slice(0, 50)}
            rowKey={(l) => l.id}
            emptyText={p('Изменений нет', "O'zgarishlar yo'q", 'No changes')}
            columns={[
              { header: p('Дата', 'Sana', 'Date'), render: (l) => <span className="num muted small">{formatDateTime(l.at)}</span> },
              { header: p('Период', 'Davr', 'Period'), render: (l) => l.period },
              { header: p('Центр · драйвер', 'Markaz · drayver', 'Centre · driver'), render: (l) => `${centerCode(l.centerId)} · ${drivers.data?.find((d) => d.id === l.driverId)?.code ?? l.driverId}` },
              { header: p('Было → стало', 'Edi → bo‘ldi', 'From → to'), align: 'right', render: (l) => `${formatNumber(l.from)} → ${formatNumber(l.to)}` },
              { header: p('Источник', 'Manba', 'Source'), render: (l) => <Badge tone={l.source === 'manual' ? 'warn' : 'info'}>{l.source === 'manual' ? p('Ручной ввод', 'Qo‘lda', 'Manual') : p('Авто', 'Avto', 'Auto')}</Badge> },
              { header: p('Кто / причина', 'Kim / sabab', 'Who / reason'), render: (l) => <span className="small">{l.userId === 'system' ? p('Система', 'Tizim', 'System') : lk.user(l.userId)?.fullName}{l.reason ? ` · ${l.reason}` : ''}</span> },
            ]}
          />
        </Card>
      </div>
      {edit && (
        <Modal
          title={edit.id ? edit.code : p('Новый драйвер (формула)', 'Yangi drayver (formula)', 'New driver (formula)')}
          onClose={() => { setEdit(null); setTest(null); }}
          footer={
            <>
              {edit.id && <Button danger onClick={async () => { try { await allocationApi.deleteDriver(edit.id!, user); setEdit(null); } catch (e) { toast(err(e)); } }}>{p('Удалить', "O'chirish", 'Delete')}</Button>}
              <Button onClick={async () => { try { setTest(await allocationApi.testFormula(edit.formula, period)); } catch (e) { toast(err(e)); } }}>{p('Проверить', 'Tekshirish', 'Test')}</Button>
              <Button type="primary" onClick={async () => { try { await allocationApi.saveDriver(edit, user); toast(p('Драйвер сохранён', 'Drayver saqlandi', 'Driver saved')); setEdit(null); setTest(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={p('Код', 'Kod', 'Code')} required><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} ariaLabel={p('Код драйвера', 'Drayver kodi', 'Driver code')} /></Field>
            <Field label={p('Единица', 'Birlik', 'Unit')}><Input value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} ariaLabel={p('Единица', 'Birlik', 'Unit')} /></Field>
            <Field label={p('Название', 'Nomi', 'Name')} required className="span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} ariaLabel={p('Название драйвера', 'Drayver nomi', 'Driver name')} /></Field>
            <Field label={p('Формула', 'Formula', 'Formula')} required className="span-2" hint={(drivers.data ?? []).filter((d) => d.source !== 'formula').map((d) => d.id).join(', ')}>
              <Input value={edit.formula} onChange={(e) => setEdit({ ...edit, formula: e.target.value })} placeholder="transactions / 1000 + headcount * 2" ariaLabel={p('Формула', 'Formula', 'Formula')} />
            </Field>
          </div>
          {test && (
            <DataTable rows={test} rowKey={(r) => r.unitId} columns={[{ header: p('Центр', 'Markaz', 'Centre'), render: (r) => centerCode(r.unitId) }, { header: period, align: 'right', render: (r) => formatNumber(r.value) }]} />
          )}
        </Modal>
      )}
      {map && (
        <Modal
          title={`${p('Маппинг', 'Mapping', 'Mapping')} · ${drivers.data?.find((d) => d.id === map.driverId)?.code}`}
          onClose={() => setMap(null)}
          footer={
            <>
              <Button onClick={() => setMap(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await allocationApi.saveMapping(map, user); toast(p('Маппинг сохранён', 'Mapping saqlandi', 'Mapping saved')); setMap(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={p('Система', 'Tizim', 'System')}><Input value={map.system} onChange={(e) => setMap({ ...map, system: e.target.value })} ariaLabel={p('Система', 'Tizim', 'System')} /></Field>
            <Field label={p('Операция', 'Operatsiya', 'Operation')}><Input value={map.operation} onChange={(e) => setMap({ ...map, operation: e.target.value })} ariaLabel={p('Операция', 'Operatsiya', 'Operation')} /></Field>
            <Field label={p('Поле', 'Maydon', 'Field')} className="span-2"><Input value={map.field} onChange={(e) => setMap({ ...map, field: e.target.value })} ariaLabel={p('Поле', 'Maydon', 'Field')} /></Field>
          </div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>{p('Ключи центров в источнике', 'Manbadagi markaz kalitlari', 'Centre keys in the source')}</div>
          <div className="bud-art-grid">
            {(centers.data ?? []).filter((c) => c.type === 'business').map((c) => (
              <label key={c.id} className="small">{c.code}<Input value={map.centerKeys[c.id] ?? ''} onChange={(e) => setMap({ ...map, centerKeys: { ...map.centerKeys, [c.id]: e.target.value } })} ariaLabel={`${c.code} key`} /></label>
            ))}
          </div>
        </Modal>
      )}
      {importing && target && (
        <Modal title={p('Загрузка значений драйверов', 'Drayver qiymatlarini yuklash', 'Upload driver values')} onClose={() => setImporting(false)} footer={<Button onClick={() => setImporting(false)}>{p('Закрыть', 'Yopish', 'Close')}</Button>}>
          <ImportWizard target={target} onDone={() => toast(p('Загрузка завершена', 'Yuklash yakunlandi', 'Upload complete'))} />
        </Modal>
      )}
    </>
  );
}

const GL_CAT: Record<AllocationGlCategory, [string, string, string]> = {
  payroll: ['ФОТ', 'Ish haqi fondi', 'Payroll'],
  depreciation: ['Амортизация', 'Amortizatsiya', 'Depreciation'],
  taxes: ['Налоги', 'Soliqlar', 'Taxes'],
  other: ['Прочие прямые расходы', 'Boshqa to‘g‘ridan-to‘g‘ri xarajatlar', 'Other direct expenses'],
};

export function GlTab({ periods, closed }: { periods: string[]; closed: string[] }) {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useAllocErr();
  const lk = useLookups();
  const [period, setPeriod] = useState(periods[periods.length - 1]!);
  const [cat, setCat] = useState<AllocationGlCategory | ''>('');
  const [by, setBy] = useState<'pool' | 'orgUnit' | 'employee'>('pool');
  const gl = useApi(() => allocationApi.listGl(period, { category: cat }), [period, cat]);
  const loads = useApi(() => allocationApi.listGlLoads());
  const pools = useApi(() => allocationApi.listPools());
  const [busy, setBusy] = useState(false);
  const short = (v: number) => formatMoneyShort(v, lang);
  const groups = new Map<string, { key: string; label: string; amount: number; n: number }>();
  for (const e of gl.data ?? []) {
    const key = by === 'pool' ? e.poolId : by === 'orgUnit' ? e.orgUnitKey : e.employee ?? '—';
    const label = by === 'pool' ? (pools.data?.find((x) => x.id === e.poolId) ? `${pools.data.find((x) => x.id === e.poolId)!.code} · ${loc(pools.data.find((x) => x.id === e.poolId)!.name)}` : e.poolId) : by === 'orgUnit' ? (e.orgUnitKey.startsWith('d') ? lk.department(e.orgUnitKey)?.code ?? e.orgUnitKey : e.orgUnitKey) : key;
    const g = groups.get(key) ?? { key, label, amount: 0, n: 0 };
    g.amount += e.amount;
    g.n++;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const lastLoad = loads.data?.find((l) => l.period === period);
  return (
    <>
      <FilterBar>
        <Select value={period} onChange={setPeriod} ariaLabel={p('Период ГК', 'BK davri', 'GL period')} options={periods.map((x) => ({ value: x, label: x }))} />
        <Select<AllocationGlCategory | ''> value={cat} onChange={setCat} ariaLabel={p('Категория', 'Toifa', 'Category')} options={[{ value: '', label: p('Все счета', 'Barcha hisoblar', 'All accounts') }, ...(Object.keys(GL_CAT) as AllocationGlCategory[]).map((c) => ({ value: c, label: p(...GL_CAT[c]) }))]} />
        <Select<'pool' | 'orgUnit' | 'employee'> value={by} onChange={setBy} ariaLabel={p('Разрез', 'Kesim', 'Breakdown')} options={[{ value: 'pool', label: p('По пулам (отделам)', 'Pullar (bo‘limlar) bo‘yicha', 'By pool (department)') }, { value: 'orgUnit', label: p('По подразделениям и ЦБУ', 'Bo‘linmalar va BXM bo‘yicha', 'By unit and branch office') }, { value: 'employee', label: p('По сотрудникам (ФОТ)', 'Xodimlar bo‘yicha (IHF)', 'By employee (payroll)') }]} />
        <span className="muted small" style={{ flex: 1 }}>{lastLoad ? `${p('Загружено из iABS', 'iABS dan yuklangan', 'Loaded from iABS')}: ${formatDateTime(lastLoad.at)} · ${lastLoad.entries} ${p('проводок', 'provodka', 'entries')}` : ''}</span>
        {can('allocation', 'edit') && !closed.includes(period) && (
          <Button size="small" type="primary" icon="refresh" loading={busy} onClick={async () => { setBusy(true); try { const l = await allocationApi.aggregateGl(period, user); toast(`${p('Собрано с бухсчетов', 'Buxgalteriya hisoblaridan yig‘ildi', 'Aggregated from GL')}: ${l.entries} · ${short(l.total)}`); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>
            {p('Собрать с бухсчетов (iABS)', 'Buxgalteriya hisoblaridan yig‘ish (iABS)', 'Aggregate from GL (iABS)')}
          </Button>
        )}
        <ExportButton<AllocationGlEntry>
          filename={`allocation-gl-${period}`}
          rows={gl.data ?? []}
          columns={[
            { header: p('Счёт', 'Hisob', 'Account'), value: (e) => e.account },
            { header: p('Категория', 'Toifa', 'Category'), value: (e) => p(...GL_CAT[e.category]) },
            { header: p('Пул', 'Pul', 'Pool'), value: (e) => pools.data?.find((x) => x.id === e.poolId)?.code ?? e.poolId },
            { header: p('Подразделение', "Bo'linma", 'Department'), value: (e) => e.departmentId },
            { header: p('ЦБУ / оргединица', 'BXM / tashkiliy birlik', 'Office / unit'), value: (e) => e.orgUnitKey },
            { header: p('Сотрудник (таб. №)', 'Xodim (tab. №)', 'Employee (ID)'), value: (e) => e.employee ?? '' },
            { header: p('Сумма', 'Summa', 'Amount'), value: (e) => e.amount, format: 'money', total: true },
          ]}
        />
      </FilterBar>
      <div className="grid grid-4" style={{ padding: 18 }}>
        {(Object.keys(GL_CAT) as AllocationGlCategory[]).map((c) => (
          <Stat key={c} label={p(...GL_CAT[c])} value={short((gl.data ?? []).filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0))} />
        ))}
      </div>
      <DataTable
        rows={rows}
        loading={gl.loading}
        rowKey={(r) => r.key}
        columns={[
          { header: by === 'pool' ? p('Пул / отдел', 'Pul / bo‘lim', 'Pool / department') : by === 'orgUnit' ? p('Подразделение / ЦБУ', 'Bo‘linma / BXM', 'Unit / office') : p('Сотрудник', 'Xodim', 'Employee'), render: (r) => r.label },
          { header: p('Проводок', 'Provodkalar', 'Entries'), align: 'right', render: (r) => r.n },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (r) => short(r.amount) },
          { header: '%', align: 'right', render: (r) => `${formatDecimal(total ? (r.amount / total) * 100 : 0)}%` },
        ]}
      />
    </>
  );
}

export function WhatIfTab({ periods }: { periods: string[] }) {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useAllocErr();
  const label = useMethodLabel();
  const driverName = useDriverName();
  const pools = useApi(() => allocationApi.listPools());
  const drivers = useApi(() => allocationApi.listDrivers());
  const units = useApi(() => allocationApi.listUnits());
  const saved = useApi(() => allocationApi.listScenarios());
  const [period, setPeriod] = useState(periods[periods.length - 1]!);
  const [name, setName] = useState('ИТ-расходы +20%');
  const [poolPct, setPoolPct] = useState<Record<string, string>>({ ap1: '20' });
  const [driverPct, setDriverPct] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<AllocationMethod | ''>('');
  const [res, setRes] = useState<AllocationWhatIf | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))).map(([k, v]) => [k, Number(v.replace(',', '.'))]));
  const short = (v: number) => formatMoneyShort(v, lang);
  const sign = (v: number) => (v > 0 ? '+' : '') + short(v);
  async function run() {
    setBusy(true);
    try {
      setRes(await allocationApi.whatIf(period, { poolPct: num(poolPct), driverPct: num(driverPct), ...(method ? { method } : {}) }));
    } finally {
      setBusy(false);
    }
  }
  const load = (s: AllocationScenario) => {
    setName(s.name);
    setPoolPct(Object.fromEntries(Object.entries(s.poolPct).map(([k, v]) => [k, String(v)])));
    setDriverPct(Object.fromEntries(Object.entries(s.driverPct).map(([k, v]) => [k, String(v)])));
    setMethod(s.method ?? '');
    setRes(null);
  };
  const unitName = (id: string) => units.data?.find((u) => u.id === id);
  return (
    <div className="bud-split">
      <Card title={p('Песочница сценария', 'Ssenariy qum qutisi', 'Scenario sandbox')}>
        <div className="form-grid">
          <Field label={p('Период', 'Davr', 'Period')}><Select value={period} onChange={(v) => { setPeriod(v); setRes(null); }} ariaLabel={p('Период сценария', 'Ssenariy davri', 'Scenario period')} options={periods.map((x) => ({ value: x, label: x }))} /></Field>
          <Field label={p('Метод (сценарий)', 'Usul (ssenariy)', 'Method (scenario)')}><Select<AllocationMethod | ''> value={method} onChange={setMethod} ariaLabel={p('Метод сценария', 'Ssenariy usuli', 'Scenario method')} options={[{ value: '', label: p('Как в правилах', 'Qoidalardagidek', 'As configured') }, ...(['direct', 'step_down', 'reciprocal'] as AllocationMethod[]).map((m) => ({ value: m, label: label(m) }))]} /></Field>
          <Field label={p('Название', 'Nomi', 'Name')} className="span-2"><Input value={name} onChange={(e) => setName(e.target.value)} ariaLabel={p('Название сценария', 'Ssenariy nomi', 'Scenario name')} /></Field>
        </div>
        <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>{p('Изменение сумм пулов, %', 'Pul summalari o‘zgarishi, %', 'Pool amount change, %')}</div>
        <div className="bud-art-grid">
          {(pools.data ?? []).map((pl) => (
            <label key={pl.id} className="small">{pl.code}<Input value={poolPct[pl.id] ?? ''} inputMode="decimal" placeholder="0" onChange={(e) => setPoolPct({ ...poolPct, [pl.id]: e.target.value })} ariaLabel={`${pl.code} %`} /></label>
          ))}
        </div>
        <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>{p('Изменение значений драйверов, %', 'Drayver qiymatlari o‘zgarishi, %', 'Driver value change, %')}</div>
        <div className="bud-art-grid">
          {(drivers.data ?? []).filter((d) => d.source !== 'formula').map((d) => (
            <label key={d.id} className="small">{loc(d.name)}<Input value={driverPct[d.id] ?? ''} inputMode="decimal" placeholder="0" onChange={(e) => setDriverPct({ ...driverPct, [d.id]: e.target.value })} ariaLabel={`${d.code} %`} /></label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Button type="primary" loading={busy} onClick={run}>{p('Смоделировать', 'Modellashtirish', 'Simulate')}</Button>
          <Button onClick={() => { setPoolPct({}); setDriverPct({}); setMethod(''); setRes(null); }}>{p('Вернуть исходное', 'Asl holatga qaytarish', 'Reset')}</Button>
          {can('allocation', 'edit') && <Button onClick={async () => { try { await allocationApi.saveScenario({ name, poolPct: num(poolPct), driverPct: num(driverPct), ...(method ? { method } : {}) }, user); toast(p('Сценарий сохранён', 'Ssenariy saqlandi', 'Scenario saved')); } catch (e) { toast(err(e)); } }}>{p('Сохранить сценарий', 'Ssenariyni saqlash', 'Save scenario')}</Button>}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>{p('Сценарий не меняет правила и не сохраняет расчёт — только моделирует.', 'Ssenariy qoidalarni o‘zgartirmaydi va hisobni saqlamaydi — faqat modellashtiradi.', 'A scenario does not change rules or save a run — it only simulates.')}</div>
        {!!saved.data?.length && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600 }}>{p('Сохранённые сценарии', 'Saqlangan ssenariylar', 'Saved scenarios')}</div>
            {saved.data.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <Button size="small" type="link" onClick={() => load(s)}>{s.name}</Button>
                <span className="muted small">{Object.entries(s.poolPct).map(([k, v]) => `${pools.data?.find((x) => x.id === k)?.code ?? k} ${v > 0 ? '+' : ''}${v}%`).concat(Object.entries(s.driverPct).map(([k, v]) => `${driverName(k)} ${v > 0 ? '+' : ''}${v}%`)).join(', ')}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title={p('Влияние на себестоимость и прибыль', 'Tannarx va foydaga ta’sir', 'Impact on cost and profit')}>
        {!res ? (
          <Empty text={p('Задайте изменения и нажмите «Смоделировать»', 'O‘zgarishlarni kiriting va «Modellashtirish»ni bosing', 'Set changes and press “Simulate”')} icon="pie" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="grid grid-3">
              <Stat label={p('База', 'Baza', 'Base')} value={short(res.base.total)} />
              <Stat label={p('Сценарий', 'Ssenariy', 'Scenario')} value={short(res.scenario.total)} tone="accent" />
              <Stat label={p('Отклонение', 'Og‘ish', 'Delta')} value={sign(res.scenario.total - res.base.total)} tone={res.scenario.total > res.base.total ? 'alert' : undefined} />
            </div>
            <BarChart
              data={res.units.map((u) => ({ label: unitName(u.unitId)?.code ?? u.unitId, values: [u.base, u.scenario] }))}
              series={[{ name: p('База', 'Baza', 'Base'), color: 'var(--border-strong)' }, { name: p('Сценарий', 'Ssenariy', 'Scenario'), color: 'var(--accent)' }]}
              format={short}
            />
            <DataTable
              rows={res.units}
              rowKey={(u) => u.unitId}
              columns={[
                { header: p('Центр прибыли', 'Foyda markazi', 'Profit centre'), render: (u) => unitName(u.unitId) ? loc(unitName(u.unitId)!.name) : u.unitId },
                { header: p('Затраты: база → сценарий', 'Xarajat: baza → ssenariy', 'Cost: base → scenario'), align: 'right', render: (u) => <>{short(u.base)} → {short(u.scenario)}<div className="sub" style={{ color: u.delta > 0 ? 'var(--danger)' : 'var(--ok)' }}>{sign(u.delta)}</div></> },
                { header: p('Прибыль филиала/направления', 'Filial/yo‘nalish foydasi', 'Branch/line profit'), align: 'right', render: (u) => <>{short(u.profitBase)} → {short(u.profitScenario)}</> },
              ]}
            />
            <div style={{ fontWeight: 600 }}>{p('Себестоимость продуктов (косвенная часть)', 'Mahsulotlar tannarxi (bilvosita qism)', 'Product cost (indirect part)')}</div>
            <DataTable
              rows={[...res.products].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8)}
              rowKey={(x) => x.productId}
              columns={[
                { header: p('Продукт', 'Mahsulot', 'Product'), render: (x) => loc(x.name) },
                { header: p('База', 'Baza', 'Base'), align: 'right', render: (x) => short(x.base) },
                { header: p('Сценарий', 'Ssenariy', 'Scenario'), align: 'right', render: (x) => short(x.scenario) },
                { header: 'Δ', align: 'right', render: (x) => <span style={{ color: x.delta > 0 ? 'var(--danger)' : 'var(--ok)' }}>{sign(x.delta)}</span> },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

export function ClosingTab({ periods }: { periods: string[] }) {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const stepUp = useStepUp();
  const toast = useToast();
  const err = useAllocErr();
  const lk = useLookups();
  const label = useMethodLabel();
  const snaps = useApi(() => allocationApi.listSnapshots());
  const runs = useApi(() => allocationApi.listRuns());
  const [view, setView] = useState<AllocationSnapshot | null>(null);
  const short = (v: number) => formatMoneyShort(v, lang);
  const open = periods.filter((x) => !snaps.data?.some((s) => s.period === x));
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('После закрытия периода правила, цепочка, драйверы, маппинг и суммы пулов замораживаются — отчёт за период не меняется при последующих изменениях справочников.', 'Davr yopilgandan so‘ng qoidalar, zanjir, drayverlar, mapping va pul summalari muzlatiladi — keyingi o‘zgarishlar davr hisobotiga ta’sir qilmaydi.', 'After a period is closed, rules, chain, drivers, mapping and pool amounts are frozen — later directory changes do not affect the period report.')}</span>
        {can('allocation', 'edit') &&
          open.map((per) => (
            <Button key={per} size="small" onClick={async () => { if (!(await stepUp(p('Закрытие периода аллокации', 'Allokatsiya davrini yopish', 'Close allocation period')))) return; try { await allocationApi.closePeriod(per, user); toast(`${per}: ${p('период закрыт', 'davr yopildi', 'period closed')}`); } catch (e) { toast(err(e)); } }}>
              {p('Закрыть', 'Yopish', 'Close')} {per}
            </Button>
          ))}
      </FilterBar>
      <DataTable
        rows={snaps.data}
        loading={snaps.loading}
        rowKey={(s) => s.period}
        onRowClick={setView}
        emptyText={p('Закрытых периодов нет', "Yopilgan davrlar yo'q", 'No closed periods')}
        columns={[
          { header: p('Период', 'Davr', 'Period'), render: (s) => <span className="doc-num">{s.period}</span> },
          { header: p('Расчёт', 'Hisob', 'Run'), render: (s) => s.runNumber },
          { header: p('Метод', 'Usul', 'Method'), render: (s) => label(s.settings.method) },
          { header: p('Закрыт', 'Yopilgan', 'Closed'), render: (s) => <span className="small">{formatDateTime(s.closedAt)} · {lk.user(s.closedBy)?.fullName}</span> },
          { header: p('Итого распределено', 'Jami taqsimlangan', 'Total allocated'), align: 'right', render: (s) => short(s.total) },
        ]}
      />
      {view && (
        <Modal title={`${p('Снимок периода', 'Davr surati', 'Period snapshot')} ${view.period}`} onClose={() => setView(null)} footer={<Button onClick={() => setView(null)}>{p('Закрыть', 'Yopish', 'Close')}</Button>}>
          <div className="grid grid-3">
            <Stat label={p('Пулов', 'Pullar', 'Pools')} value={view.pools.length} />
            <Stat label={p('Драйверов', 'Drayverlar', 'Drivers')} value={view.drivers.length} />
            <Stat label={p('Центров', 'Markazlar', 'Centres')} value={view.centers.length} />
          </div>
          <div className="muted small">{p('Цепочка', 'Zanjir', 'Chain')}: {view.settings.chain.join(' → ')} · {p('версия настроек', 'sozlamalar versiyasi', 'settings version')} {view.settings.version}</div>
          <DataTable
            rows={view.pools}
            rowKey={(x) => x.id}
            columns={[
              { header: p('Пул', 'Pul', 'Pool'), render: (x) => `${x.code} · ${loc(x.name)}` },
              { header: p('Драйвер (замороженный)', 'Drayver (muzlatilgan)', 'Driver (frozen)'), render: (x) => { const r = view.rules.find((y) => y.poolId === x.id); const d = view.drivers.find((y) => y.id === r?.driver); return d ? loc(d.name) : r?.driver; } },
              { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (x) => short(view.poolAmounts[x.id] ?? 0) },
            ]}
          />
          {runs.data && !runs.data.some((r) => r.id === view.runId) && <Badge tone="warn">{view.runNumber}</Badge>}
        </Modal>
      )}
    </>
  );
}

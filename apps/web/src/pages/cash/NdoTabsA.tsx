// НДО: объекты (версионируемый реестр), классификаторы, наборы данных и загрузки, факты и корректировки.
import { useState, type ReactNode } from 'react';
import { formatDateTime, formatMoney, formatNumber, ndoApi, orgApi, type NdoClassItem, type NdoObject, type NdoObjectType } from '@xb/shared';
import { Badge, Button, DataTable, Drawer, Field, Input, Modal, Select } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useP } from '../taxes/common';
import { useNdoObjects, useNdoRun } from './NdoPage';

export const NDO_TYPES: NdoObjectType[] = ['ekc', 'vault', 'cbu', 'cash_desk', 'mobile_desk', 'exchange', 'cit_route', 'vehicle', 'equipment', 'atm', 'cash_in', 'recycler'];
export function useTypeLabel() {
  const p = useP();
  const M: Record<NdoObjectType, [string, string, string]> = {
    ekc: ['ЕКЦ', 'YKM', 'Cash centre'], vault: ['Хранилище', 'Xazina', 'Vault'], cbu: ['ЦБУ / касса филиала', 'BXM / filial kassasi', 'Branch cash'], cash_desk: ['Кассовый пункт', 'Kassa punkti', 'Cash desk'],
    mobile_desk: ['Передвижная касса', "Ko'chma kassa", 'Mobile desk'], exchange: ['Пункт обмена', 'Ayirboshlash shoxobchasi', 'FX point'], cit_route: ['Маршрут инкассации', "Inkassatsiya yo'nalishi", 'CIT route'], vehicle: ['Транспорт', 'Transport', 'Vehicle'],
    equipment: ['Кассовое оборудование', 'Kassa uskunasi', 'Cash equipment'], atm: ['Банкомат', 'Bankomat', 'ATM'], cash_in: ['Cash-in', 'Cash-in', 'Cash-in'], recycler: ['Ресайклер', 'Resaykler', 'Recycler'],
  };
  return (t: NdoObjectType) => p(...M[t]);
}

/** Подписи технических кодов НДО (шаги, драйверы, процессы, состояния, системы, статусы). */
export function useNdoLabels() {
  const p = useP();
  const M: Record<string, [string, string, string]> = {
    ndo_internal: ['внутри НДО', 'NPA ichida', 'within cash'], bank_share: ['доля общебанковских', 'umumbank ulushi', 'bank-wide share'], final: ['на конечные объекты', 'yakuniy obyektlarga', 'to final objects'],
    volume: ['объём наличности', 'naqd pul hajmi', 'cash volume'], transactions: ['операции', 'operatsiyalar', 'transactions'], collections: ['инкассации', 'inkassatsiyalar', 'collections'], route_km: ['пробег, км', 'masofa, km', 'route km'], fte: ['численность (FTE)', 'xodimlar (FTE)', 'headcount (FTE)'], downtime_h: ['простой, ч', "to'xtash, soat", 'downtime, h'], incidents: ['инциденты', 'insidentlar', 'incidents'], loads: ['загрузки', 'yuklashlar', 'loads'],
    order: ['заказ', 'buyurtma', 'order'], receipt: ['получение', 'olish', 'receipt'], storage: ['хранение', 'saqlash', 'storage'], processing: ['обработка', 'ishlov berish', 'processing'], transport: ['перевозка', 'tashish', 'transport'], reinforcement: ['подкрепление', 'mustahkamlash', 'reinforcement'], collection: ['инкассация', 'inkassatsiya', 'collection'], acceptance: ['приём', 'qabul', 'acceptance'], issuance: ['выдача', 'berish', 'issuance'], return: ['возврат', 'qaytarish', 'return'], sale: ['обмен валюты', 'valyuta ayirboshlash', 'FX exchange'],
    vault: ['в хранилище', 'xazinada', 'in vault'], desk: ['в кассе', 'kassada', 'at desk'], device: ['в устройстве', 'qurilmada', 'in device'], transit: ['в пути', "yo'lda", 'in transit'],
    iabs: ['iABS / ГК', 'iABS / BK', 'iABS / GL'], cashsys: ['учёт наличных', 'naqd pul hisobi', 'cash system'], optiload: ['OptiLoad', 'OptiLoad', 'OptiLoad'], processing_sys: ['процессинг', 'protsessing', 'processing'], servicedesk: ['Service Desk', 'Service Desk', 'Service Desk'], laborlaw: ['Laborlaw (HR)', 'Laborlaw (HR)', 'Laborlaw (HR)'], erp_ftp: ['модуль FTP 4.2.15', 'FTP moduli 4.2.15', 'FTP module 4.2.15'], erp_alloc: ['модуль аллокации 4.2.14', 'taqsimot moduli 4.2.14', 'allocation module 4.2.14'],
    daily: ['ежедневно', 'har kuni', 'daily'], monthly: ['ежемесячно', 'har oy', 'monthly'], active: ['действует', 'amalda', 'active'], suspended: ['приостановлен', "to'xtatilgan", 'suspended'], closed: ['закрыт', 'yopilgan', 'closed'],
    draft: ['черновик', 'qoralama', 'draft'], pending: ['на согласовании', 'kelishuvda', 'pending'], rejected: ['отклонено', 'rad etilgan', 'rejected'], retired: ['архив', 'arxiv', 'retired'], approved: ['утверждено', 'tasdiqlangan', 'approved'],
    income: ['доход', 'daromad', 'income'], expense: ['расход', 'xarajat', 'expense'], direct: ['прямой', "to'g'ridan", 'direct'], indirect: ['косвенный', 'bilvosita', 'indirect'],
    input: ['ввод данных', "ma'lumot kiritish", 'data input'], calc: ['расчёт', 'hisob', 'calculation'], check: ['проверка', 'tekshiruv', 'check'], approve: ['утверждение', 'tasdiqlash', 'approval'],
    success: ['успешно', 'muvaffaqiyatli', 'success'], mismatch: ['расхождение', 'farq', 'mismatch'], failed: ['ошибка', 'xato', 'failed'], queued: ['в очереди', 'navbatda', 'queued'],
  };
  return (code: string | undefined, ctx?: 'system') => {
    if (!code) return '—';
    const k = ctx === 'system' && code === 'processing' ? 'processing_sys' : code;
    return M[k] ? p(...M[k]!) : code;
  };
}

const Bar = ({ children }: { children: ReactNode }) => <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>{children}</div>;

export function ObjectsTab() {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const typeLabel = useTypeLabel();
  const lbl = useNdoLabels();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<NdoObjectType | ''>('');
  const list = useApi(() => ndoApi.listObjects(asOf), [asOf]);
  const [edit, setEdit] = useState<NdoObject | 'new' | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((o) => !type || o.type === type);
  const canInput = ndoApi.can(user, 'input');
  return (
    <>
      <Bar>
        <Field label={p('На дату', 'Sanaga', 'As of')}><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Select<NdoObjectType> value={type} onChange={setType} options={NDO_TYPES.map((x) => ({ value: x, label: typeLabel(x) }))} placeholder={p('Все типы', 'Barcha turlar', 'All types')} ariaLabel={p('Тип', 'Tur', 'Type')} />
        {canInput && <Button size="small" icon="plus" onClick={() => setEdit('new')}>{p('Новый объект', 'Yangi obyekt', 'New object')}</Button>}
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton filename={`ndo-objects-${asOf}`} rows={rows} columns={[
            { header: p('Ключ', 'Kalit', 'Key'), value: (o) => o.key }, { header: p('Код', 'Kod', 'Code'), value: (o) => o.code }, { header: p('Наименование', 'Nomi', 'Name'), value: (o) => loc(o.name) }, { header: p('Тип', 'Tur', 'Type'), value: (o) => typeLabel(o.type) },
            { header: p('Статус', 'Holat', 'Status'), value: (o) => o.status }, { header: p('Оргединица', 'Tashkiliy birlik', 'Org unit'), value: (o) => o.orgUnitKey }, { header: p('МВЗ', 'XJM', 'Cost centre'), value: (o) => o.costCenterCode }, { header: p('ЦО', 'MM', 'Resp. centre'), value: (o) => o.respCenter },
            { header: p('Версия', 'Versiya', 'Version'), value: (o) => o.version }, { header: p('Действует с', 'Amal qiladi', 'Valid from'), value: (o) => o.validFrom },
          ]} />
        </span>
      </Bar>
      <DataTable rows={rows} loading={list.loading} rowKey={(o) => o.key} onRowClick={(o) => setHist(o.key)} columns={[
        { header: p('Объект', 'Obyekt', 'Object'), render: (o) => <><b>{loc(o.name)}</b><div className="sub">{o.key} · {o.code}</div></> },
        { header: p('Тип', 'Tur', 'Type'), render: (o) => typeLabel(o.type) },
        { header: p('Оргструктура / МВЗ', 'Tuzilma / XJM', 'Org / cost centre'), render: (o) => <><div>{o.orgUnitKey}</div><div className="sub">{o.costCenterCode} · {o.respCenter}</div></> },
        { header: p('Норматив остатка', "Qoldiq me'yori", 'Normative balance'), align: 'right', render: (o) => (o.normative ? formatMoney(o.normative) : '—') },
        { header: p('Статус', 'Holat', 'Status'), render: (o) => <Badge tone={o.status === 'active' ? 'ok' : o.status === 'suspended' ? 'warn' : 'muted'}>{lbl(o.status)}</Badge> },
        { header: p('Версия', 'Versiya', 'Version'), render: (o) => <span className="small">v{o.version} · {o.validFrom}</span> },
        { header: '', render: (o) => (canInput ? <Button size="small" onClick={(e) => { e.stopPropagation(); setEdit(o); }}>{p('Новая версия', 'Yangi versiya', 'New version')}</Button> : null) },
      ]} />
      {edit && <ObjectModal obj={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {hist && <VersionsDrawer objKey={hist} onClose={() => setHist(null)} />}
    </>
  );
}

function VersionsDrawer({ objKey, onClose }: { objKey: string; onClose: () => void }) {
  const p = useP();
  const { loc } = useSession();
  const lk = useLookups();
  const lbl = useNdoLabels();
  const v = useApi(() => ndoApi.objectVersions(objKey), [objKey]);
  return (
    <Drawer open title={`${p('История версий', 'Versiyalar tarixi', 'Version history')}: ${objKey}`} onClose={onClose} width={720}>
      <DataTable rows={v.data} rowKey={(o) => String(o.version)} columns={[
        { header: 'v', render: (o) => o.version },
        { header: p('Период действия', 'Amal davri', 'Validity'), render: (o) => `${o.validFrom} — ${o.validTo ?? '…'}` },
        { header: p('Наименование', 'Nomi', 'Name'), render: (o) => loc(o.name) },
        { header: p('МВЗ / статус', 'XJM / holat', 'Cost centre / status'), render: (o) => `${o.costCenterCode} · ${lbl(o.status)}` },
        { header: p('Изменил', "O'zgartirdi", 'Changed by'), render: (o) => <>{o.changedBy ? lk.user(o.changedBy)?.fullName : p('миграция', 'migratsiya', 'migration')}<div className="sub">{o.changeReason}</div></> },
      ]} />
    </Drawer>
  );
}

function ObjectModal({ obj, onClose }: { obj: NdoObject | null; onClose: () => void }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const typeLabel = useTypeLabel();
  const { run, busy } = useNdoRun();
  const units = useApi(() => orgApi.listOrgUnits());
  const ccs = useApi(() => orgApi.listCostCenters({ pageSize: 1000 }));
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    type: obj?.type ?? ('cash_desk' as NdoObjectType), code: obj?.code ?? '', nameRu: obj?.name.ru ?? '', nameUz: obj?.name.uz ?? '', status: obj?.status ?? ('active' as NdoObject['status']),
    orgUnitKey: obj?.orgUnitKey ?? 'R01-B01', costCenterCode: obj?.costCenterCode ?? 'MVZ-01-001-02', respCenter: obj?.respCenter ?? 'ЦО-НДО', normative: obj?.normative ? String(obj.normative) : '', validFrom: obj ? tomorrow : new Date().toISOString().slice(0, 10), reason: '',
  });
  const ccOpts = (ccs.data?.rows ?? []).filter((c) => c.orgUnitKey === f.orgUnitKey || c.code === f.costCenterCode).map((c) => ({ value: c.code, label: `${c.code} · ${loc(c.name)}` }));
  return (
    <Modal title={obj ? `${p('Новая версия объекта', 'Obyektning yangi versiyasi', 'New object version')} ${obj.key}` : p('Новый объект кассовой инфраструктуры', 'Yangi kassa infratuzilmasi obyekti', 'New cash infrastructure object')} onClose={onClose} footer={<><Button onClick={onClose}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" disabled={busy} onClick={async () => { if (await run(() => ndoApi.saveObject(obj?.key ?? null, { type: f.type, code: f.code, name: { ru: f.nameRu, uz: f.nameUz || f.nameRu, en: f.nameRu }, status: f.status, orgUnitKey: f.orgUnitKey, costCenterCode: f.costCenterCode, respCenter: f.respCenter, validFrom: f.validFrom, ...(f.normative ? { normative: Number(f.normative.replace(/\s/g, '')) } : {}), ...(f.reason ? { changeReason: f.reason } : {}) }, user), p('Объект сохранён', 'Obyekt saqlandi', 'Object saved'))) onClose(); }}>{p('Сохранить', 'Saqlash', 'Save')}</Button></>}>
      <div className="form-grid">
        <Field label={p('Тип', 'Tur', 'Type')} required><Select<NdoObjectType> value={f.type} disabled={!!obj} onChange={(v) => setF({ ...f, type: v })} options={NDO_TYPES.map((x) => ({ value: x, label: typeLabel(x) }))} /></Field>
        <Field label={p('Код', 'Kod', 'Code')} required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label={p('Наименование (рус.)', 'Nomi (rus.)', 'Name (Russian)')} required className="span-2"><Input value={f.nameRu} onChange={(e) => setF({ ...f, nameRu: e.target.value })} /></Field>
        <Field label={p('Наименование (узб.)', "Nomi (o'zb.)", 'Name (Uzbek)')} className="span-2"><Input value={f.nameUz} onChange={(e) => setF({ ...f, nameUz: e.target.value })} /></Field>
        <Field label={p('Оргединица', 'Tashkiliy birlik', 'Org unit')} required><Select<string> value={f.orgUnitKey} onChange={(v) => setF({ ...f, orgUnitKey: v })} options={(units.data ?? []).filter((u) => u.type !== 'department').map((u) => ({ value: u.key, label: `${u.key} · ${loc(u.name)}` }))} /></Field>
        <Field label={p('МВЗ', 'XJM', 'Cost centre')} required><Select<string> value={f.costCenterCode} onChange={(v) => setF({ ...f, costCenterCode: v })} options={ccOpts} /></Field>
        <Field label={p('Центр ответственности', "Mas'uliyat markazi", 'Responsibility centre')} required><Input value={f.respCenter} onChange={(e) => setF({ ...f, respCenter: e.target.value })} /></Field>
        <Field label={p('Статус', 'Holat', 'Status')} required><Select<NdoObject['status']> value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: 'active', label: p('действует', 'amalda', 'active') }, { value: 'suspended', label: p('приостановлен', "to'xtatilgan", 'suspended') }, { value: 'closed', label: p('закрыт', 'yopilgan', 'closed') }]} /></Field>
        <Field label={p('Норматив остатка, UZS', "Qoldiq me'yori, UZS", 'Normative balance, UZS')}><Input value={f.normative} inputMode="numeric" onChange={(e) => setF({ ...f, normative: e.target.value })} /></Field>
        <Field label={p('Действует с', 'Amal qiladi', 'Valid from')} required><Input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
        {obj && <Field label={p('Основание изменения', "O'zgartirish asosi", 'Change reason')} className="span-2"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
export function ClassesTab() {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const lbl = useNdoLabels();
  const [kind, setKind] = useState<NdoClassItem['kind']>('article');
  const list = useApi(() => ndoApi.listClasses(kind), [kind]);
  const { run } = useNdoRun();
  const [f, setF] = useState({ code: '', nameRu: '', direction: 'expense' as 'income' | 'expense', nature: 'direct' as 'direct' | 'indirect', validFrom: '2026-11-01' });
  const KIND: Record<NdoClassItem['kind'], string> = { process: p('Процессы и операции', 'Jarayonlar va operatsiyalar', 'Processes'), article: p('Статьи доходов и расходов', 'Daromad va xarajat moddalari', 'Income & expense articles'), currency: p('Валюты', 'Valyutalar', 'Currencies'), cash_state: p('Состояния наличных', 'Naqd pul holatlari', 'Cash states'), device_type: p('Типы устройств', 'Qurilma turlari', 'Device types'), driver: p('Драйверы', 'Drayverlar', 'Drivers') };
  return (
    <>
      <Bar>
        <Select<NdoClassItem['kind']> value={kind} onChange={setKind} options={(Object.keys(KIND) as NdoClassItem['kind'][]).map((k) => ({ value: k, label: KIND[k] }))} ariaLabel={p('Классификатор', 'Klassifikator', 'Classifier')} />
        {ndoApi.can(user, 'calc') && (
          <>
            <Input value={f.code} placeholder={p('Код', 'Kod', 'Code')} onChange={(e) => setF({ ...f, code: e.target.value })} style={{ width: 120 }} />
            <Input value={f.nameRu} placeholder={p('Наименование', 'Nomi', 'Name')} onChange={(e) => setF({ ...f, nameRu: e.target.value })} style={{ width: 220 }} />
            {kind === 'article' && <Select<'income' | 'expense'> value={f.direction} onChange={(v) => setF({ ...f, direction: v })} options={[{ value: 'expense', label: p('расход', 'xarajat', 'expense') }, { value: 'income', label: p('доход', 'daromad', 'income') }]} ariaLabel="direction" />}
            <Input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} ariaLabel={p('Действует с', 'Amal qiladi', 'Valid from')} />
            <Button size="small" onClick={() => run(() => ndoApi.saveClass({ kind, code: f.code.trim(), name: { ru: f.nameRu, uz: f.nameRu, en: f.nameRu }, ...(kind === 'article' ? { direction: f.direction, nature: f.nature, external: true } : {}), validFrom: f.validFrom }, user), p('Версия классификатора сохранена', 'Klassifikator versiyasi saqlandi', 'Classifier version saved'))}>{p('Добавить / новая версия', "Qo'shish / yangi versiya", 'Add / new version')}</Button>
          </>
        )}
      </Bar>
      <DataTable rows={list.data} loading={list.loading} rowKey={(c) => `${c.kind}-${c.code}`} columns={[
        { header: p('Код', 'Kod', 'Code'), render: (c) => <span className="doc-num">{c.code}</span> },
        { header: p('Наименование', 'Nomi', 'Name'), render: (c) => loc(c.name) },
        { header: p('Признаки', 'Belgilar', 'Attributes'), render: (c) => <span className="small">{[c.direction && lbl(c.direction), c.nature && lbl(c.nature), c.external === false ? p('внутренний расчёт', 'ichki hisob', 'internal settlement') : c.external ? p('внешний', 'tashqi', 'external') : '', c.unit].filter(Boolean).join(' · ') || '—'}</span> },
        { header: p('Версия', 'Versiya', 'Version'), render: (c) => `v${c.version} · ${c.validFrom}` },
      ]} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
export function DataTab({ period }: { period: string }) {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const objs = useNdoObjects();
  const lbl = useNdoLabels();
  const ds = useApi(() => ndoApi.listDatasets());
  const loads = useApi(() => ndoApi.listLoads(period), [period]);
  const errors = useApi(() => ndoApi.listErrors(period), [period]);
  const { busy, run } = useNdoRun();
  const [fix, setFix] = useState<Record<string, string>>({});
  const canInput = ndoApi.can(user, 'input');
  const last = (id: string) => loads.data?.find((l) => l.datasetId === id);
  const ST = { success: 'ok', mismatch: 'danger', failed: 'danger', queued: 'warn' } as const;
  return (
    <div style={{ display: 'grid', gap: 0 }}>
      <div className="muted small" style={{ padding: '12px 18px' }}>{p('Паспорт каждого набора: источник, владелец, периодичность, детализация, бизнес-ключи, правила преобразования и контрольные итоги. Повторная загрузка не создаёт дублей (бизнес-ключи), каждая запись прослеживается до первичного документа источника.', "Har bir to'plam pasporti: manba, egasi, davriyligi, tafsiloti, biznes kalitlari, o'zgartirish qoidalari va nazorat yig'indilari. Qayta yuklash dublikat yaratmaydi, har bir yozuv manbaning birlamchi hujjatigacha kuzatiladi.", 'Each dataset passport: source, owner, periodicity, granularity, business keys, transformation rules and control totals. Re-loading creates no duplicates (business keys); every record traces back to the source document.')}</div>
      <DataTable rows={ds.data} loading={ds.loading} rowKey={(d) => d.id} columns={[
        { header: p('Набор данных', "Ma'lumotlar to'plami", 'Dataset'), render: (d) => <><b>{loc(d.name)}</b><div className="sub">{d.id} · {lbl(d.system, 'system')}{d.integration ? ` → ${d.integration.systemId}/${d.integration.operation}` : ' (ERP)'}{d.mandatory ? ` · ${p('обязательный', 'majburiy', 'mandatory')}` : ''}</div></> },
        { header: p('Владелец / период.', 'Egasi / davriylik', 'Owner / periodicity'), render: (d) => <span className="small">{loc(d.owner)} · {lbl(d.periodicity)}</span> },
        { header: p('Детализация и ключи', 'Tafsilot va kalitlar', 'Granularity & keys'), render: (d) => <span className="small">{loc(d.granularity)}<div className="sub">{d.businessKeys.join(' + ')}</div></span> },
        { header: p('Контрольный итог', 'Nazorat yig‘indisi', 'Control total'), render: (d) => <span className="small">{loc(d.controlTotal)}</span> },
        { header: `${p('Загрузка', 'Yuklash', 'Load')} ${period}`, render: (d) => { const l = last(d.id); return l ? <><Badge tone={ST[l.status]}>{lbl(l.status)}</Badge><div className="sub">+{l.inserted} ~{l.updated} ={l.duplicates}{l.rejected ? ` ✖${l.rejected}` : ''}</div></> : <Badge tone="muted">{p('нет', "yo'q", 'none')}</Badge>; } },
        { header: '', render: (d) => (canInput ? <Button size="small" disabled={busy} onClick={() => run(() => ndoApi.loadDataset(d.id, period, user), `${d.id}: ${p('загрузка выполнена', 'yuklash bajarildi', 'load completed')}`)}>{last(d.id) ? p('Повторить', 'Takrorlash', 'Re-run') : p('Загрузить', 'Yuklash', 'Load')}</Button> : null) },
      ]} />
      <div style={{ padding: '14px 18px 6px', fontWeight: 650 }}>{p('Ошибочные записи на исправление', 'Tuzatish uchun xato yozuvlar', 'Error records for correction')}</div>
      <DataTable rows={errors.data} loading={errors.loading} emptyText={p('Ошибок нет', "Xatolar yo'q", 'No errors')} rowKey={(e) => e.id} columns={[
        { header: p('Источник', 'Manba', 'Source'), render: (e) => <><b>{e.datasetId}</b><div className="sub">{e.sourceRef}</div></> },
        { header: p('Причина', 'Sabab', 'Reason'), render: (e) => <>{e.reason === 'unknown_object' ? p('код объекта не найден в реестре НДО', 'obyekt kodi NPA reyestrida topilmadi', 'object code not found in the cash registry') : e.reason}: <b>{e.sourceCode}</b></> },
        { header: p('Значение', 'Qiymat', 'Value'), align: 'right', render: (e) => formatNumber(e.amount) },
        { header: p('Ответственный', "Mas'ul", 'Owner'), render: (e) => e.ownerRole },
        { header: p('Статус', 'Holat', 'Status'), render: (e) => (e.status === 'open' ? <Badge tone="danger">{p('открыта', 'ochiq', 'open')}</Badge> : <Badge tone="ok">{p('исправлена', 'tuzatildi', 'fixed')} → {e.fixedObjectKey}</Badge>) },
        { header: '', render: (e) => (canInput && e.status === 'open' ? <span style={{ display: 'flex', gap: 6 }}><Select<string> value={fix[e.id] ?? ''} onChange={(v) => setFix({ ...fix, [e.id]: v })} options={objs.list.filter((o) => ['atm', 'cash_in', 'recycler'].includes(o.type) || e.datasetId !== 'DS-SD').map((o) => ({ value: o.key, label: `${o.code} · ${objs.name(o.key)}` }))} placeholder={p('Сопоставить с объектом', 'Obyekt bilan moslash', 'Map to object')} ariaLabel={`fix ${e.id}`} /><Button size="small" disabled={!fix[e.id]} onClick={() => run(() => ndoApi.fixError(e.id, fix[e.id]!, user), p('Исправлено — повторите загрузку набора', 'Tuzatildi — to‘plamni qayta yuklang', 'Fixed — re-run the dataset load'))}>OK</Button></span> : null) },
      ]} />
      <div style={{ padding: '14px 18px 6px', fontWeight: 650 }}>{p('Журнал загрузок (технические метаданные)', 'Yuklashlar jurnali (texnik metama’lumotlar)', 'Load journal (technical metadata)')}</div>
      <DataTable rows={loads.data} loading={loads.loading} rowKey={(l) => l.id} columns={[
        { header: p('Когда', 'Qachon', 'When'), render: (l) => <span className="small">{formatDateTime(l.at)}</span> },
        { header: p('Набор', "To'plam", 'Dataset'), render: (l) => l.datasetId },
        { header: p('Статус', 'Holat', 'Status'), render: (l) => <Badge tone={ST[l.status]}>{lbl(l.status)}</Badge> },
        { header: p('Строк / +/~/=/✖', 'Satr / +/~/=/✖', 'Rows / +/~/=/✖'), render: (l) => <span className="small">{l.rows} / {l.inserted}/{l.updated}/{l.duplicates}/{l.rejected}</span> },
        { header: p('Контроль: источник / загружено', 'Nazorat: manba / yuklangan', 'Control: source / loaded'), align: 'right', render: (l) => <span className="small" style={{ color: l.controlLoaded !== l.controlSource ? 'var(--danger)' : undefined }}>{formatNumber(l.controlSource)} / {formatNumber(l.controlLoaded)}</span> },
        { header: p('Обмен / хэш', 'Almashinuv / xesh', 'Exchange / hash'), render: (l) => <span className="small">{l.exchangeId ?? 'ERP'} · {l.hash}</span> },
        { header: p('Кто', 'Kim', 'By'), render: (l) => <span className="small">{lk.user(l.by)?.fullName ?? l.by}</span> },
      ]} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function FactsTab({ period }: { period: string }) {
  const p = useP();
  const user = useUser();
  const lk = useLookups();
  const objs = useNdoObjects();
  const lbl = useNdoLabels();
  const [obj, setObj] = useState('');
  const [art, setArt] = useState('');
  const facts = useApi(() => ndoApi.listFacts(period, { ...(obj ? { objectKey: obj } : {}), ...(art ? { article: art } : {}) }), [period, obj, art]);
  const adjs = useApi(() => ndoApi.listAdjustments(period), [period]);
  const arts = useApi(() => ndoApi.listClasses('article'));
  const { busy, run } = useNdoRun();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ article: 'EXP-STAFF', objectKey: 'NDO-CBU-YUN', amount: '', reason: '' });
  const rows = facts.data ?? [];
  return (
    <>
      <Bar>
        <Select<string> value={obj} onChange={setObj} options={objs.list.map((o) => ({ value: o.key, label: `${o.code} · ${objs.name(o.key)}` }))} placeholder={p('Все объекты', 'Barcha obyektlar', 'All objects')} ariaLabel={p('Объект', 'Obyekt', 'Object')} />
        <Select<string> value={art} onChange={setArt} options={(arts.data ?? []).map((a) => ({ value: a.code, label: a.code }))} placeholder={p('Все статьи', 'Barcha moddalar', 'All articles')} ariaLabel={p('Статья', 'Modda', 'Article')} />
        <Badge tone="info">{rows.length} · {formatMoney(rows.reduce((s, x) => s + x.amount, 0))}</Badge>
        {ndoApi.can(user, 'input') && <Button size="small" icon="plus" onClick={() => setAdding(true)}>{p('Ручная корректировка', "Qo'lda tuzatish", 'Manual adjustment')}</Button>}
        <span style={{ marginLeft: 'auto' }}><ExportButton filename={`ndo-facts-${period}`} rows={rows} columns={[{ header: 'ID', value: (x) => x.id }, { header: p('Статья', 'Modda', 'Article'), value: (x) => x.article }, { header: p('Объект / пул', 'Obyekt / pul', 'Object / pool'), value: (x) => x.objectKey ?? x.pool ?? '' }, { header: p('Процесс', 'Jarayon', 'Process'), value: (x) => x.process ?? '' }, { header: p('Валюта', 'Valyuta', 'Currency'), value: (x) => x.currency }, { header: p('Сумма UZS', 'Summa UZS', 'Amount UZS'), value: (x) => x.amount, format: 'money', total: true }, { header: p('Внешний', 'Tashqi', 'External'), value: (x) => (x.external ? '1' : '0') }, { header: p('Первичная запись', 'Birlamchi yozuv', 'Source record'), value: (x) => x.sourceRef }]} /></span>
      </Bar>
      <DataTable rows={rows.slice(0, 200)} loading={facts.loading} rowKey={(x) => x.id} columns={[
        { header: p('Статья', 'Modda', 'Article'), render: (x) => <><span className="doc-num">{x.article}</span>{!x.external && <Badge tone="muted">{p('внутр.', 'ichki', 'internal')}</Badge>}</> },
        { header: p('Объект / пул', 'Obyekt / pul', 'Object / pool'), render: (x) => (x.objectKey ? objs.name(x.objectKey) : <Badge tone="warn">{x.pool}</Badge>) },
        { header: p('Процесс', 'Jarayon', 'Process'), render: (x) => lbl(x.process) },
        { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (x) => <>{formatMoney(x.amount)}{x.amountFx ? <div className="sub">{formatNumber(x.amountFx)} {x.currency}</div> : null}</> },
        { header: p('Первичная запись', 'Birlamchi yozuv', 'Source record'), render: (x) => <span className="small">{x.sourceRef}<div className="sub">{x.loadId}</div></span> },
      ]} />
      <div style={{ padding: '14px 18px 6px', fontWeight: 650 }}>{p('Журнал ручных корректировок (отдельный слой; первичные данные не изменяются)', "Qo'lda tuzatishlar jurnali (alohida qatlam; birlamchi ma'lumotlar o'zgarmaydi)", 'Manual adjustment journal (separate layer; primary data unchanged)')}</div>
      <DataTable rows={adjs.data} loading={adjs.loading} emptyText={p('Корректировок нет', "Tuzatishlar yo'q", 'No adjustments')} rowKey={(a) => a.id} columns={[
        { header: p('Статья / объект', 'Modda / obyekt', 'Article / object'), render: (a) => <><b>{a.article}</b><div className="sub">{objs.name(a.objectKey)}</div></> },
        { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (a) => formatMoney(a.amount) },
        { header: p('Основание', 'Asos', 'Reason'), render: (a) => a.reason },
        { header: p('Автор', 'Muallif', 'Author'), render: (a) => <span className="small">{lk.user(a.createdBy)?.fullName}<div className="sub">{formatDateTime(a.at)}</div></span> },
        { header: p('Статус', 'Holat', 'Status'), render: (a) => <Badge tone={a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'danger' : 'warn'}>{lbl(a.status)}{a.approvedBy ? ` · ${lk.user(a.approvedBy)?.fullName}` : ''}</Badge> },
        { header: '', render: (a) => (a.status === 'draft' && ndoApi.can(user, 'check') ? <span style={{ display: 'flex', gap: 6 }}><Button size="small" type="primary" disabled={busy} onClick={() => run(() => ndoApi.decideAdjustment(a.id, true, user), p('Утверждено', 'Tasdiqlandi', 'Approved'))}>{p('Утвердить', 'Tasdiqlash', 'Approve')}</Button><Button size="small" disabled={busy} onClick={() => run(() => ndoApi.decideAdjustment(a.id, false, user), p('Отклонено', 'Rad etildi', 'Rejected'))}>{p('Отклонить', 'Rad etish', 'Reject')}</Button></span> : null) },
      ]} />
      {adding && (
        <Modal title={p('Ручная корректировка', "Qo'lda tuzatish", 'Manual adjustment')} onClose={() => setAdding(false)} footer={<><Button onClick={() => setAdding(false)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => ndoApi.addAdjustment({ period, article: f.article, ...(f.objectKey ? { objectKey: f.objectKey } : {}), amount: Number(f.amount.replace(/\s/g, '')), reason: f.reason }, user), p('Корректировка создана — требуется утверждение другим сотрудником', 'Tuzatish yaratildi — boshqa xodim tasdiqlashi kerak', 'Adjustment created — another employee must approve'))) setAdding(false); }}>{p('Создать', 'Yaratish', 'Create')}</Button></>}>
          <div className="form-grid">
            <Field label={p('Статья', 'Modda', 'Article')} required><Select<string> value={f.article} onChange={(v) => setF({ ...f, article: v })} options={(arts.data ?? []).filter((a) => a.direction === 'expense').map((a) => ({ value: a.code, label: a.code }))} /></Field>
            <Field label={p('Объект (пусто — общий пул)', "Obyekt (bo'sh — umumiy pul)", 'Object (empty — common pool)')}><Select<string> value={f.objectKey} onChange={(v) => setF({ ...f, objectKey: v })} options={objs.list.map((o) => ({ value: o.key, label: o.code }))} placeholder="—" /></Field>
            <Field label={p('Сумма (±)', 'Summa (±)', 'Amount (±)')} required><Input value={f.amount} inputMode="numeric" onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label={p('Основание', 'Asos', 'Reason')} required><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

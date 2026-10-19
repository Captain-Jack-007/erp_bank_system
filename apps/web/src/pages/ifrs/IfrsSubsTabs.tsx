// МСФО: вкладки сбора данных дочерних, матрицы трансформации, НСИ и элиминаций (ТЗ 4.2.18 А–В).
import { useState } from 'react';
import {
  formatDateTime, formatMoney, formatNumber, IFRS_ALL_LINES, ifrsApi, ifrsSubsApi, signatureService, tk,
  type IfrsIntragroupCandidate, type IfrsLine, type IfrsNsiKind, type IfrsPackageView, userMessage } from '@xb/shared';
import { Badge, Button, Card, DataTable, Drawer, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { SignModal, SignatureBadge } from '../../components/SignModal';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ImportDrawer, useP } from '../taxes/common';

const ERR: Record<string, [string, string, string]> = {
  ifrs_err_forbidden: ['Недостаточно прав', 'Huquqlar yetarli emas', 'Insufficient rights'],
  ifrs_err_no_api: ['Для предприятия нет API-интеграции — используйте веб-форму или Excel', 'Korxona uchun API integratsiyasi yo‘q — veb-shakl yoki Excel dan foydalaning', 'No API integration for this entity — use the web form or Excel'],
  ifrs_err_pkg_accepted: ['Пакет за период уже принят', 'Davr uchun paket allaqachon qabul qilingan', 'Package for the period already accepted'],
  ifrs_err_fetch: ['Учётная система предприятия не ответила — повторите позже', 'Korxona hisob tizimi javob bermadi — keyinroq takrorlang', 'Entity system did not respond — retry later'],
  ifrs_err_period: ['Период в формате ГГГГ-ММ', 'Davr YYYY-MM formatida', 'Period must be YYYY-MM'],
  ifrs_err_pkg_exists: ['Пакет за период уже создан', 'Davr uchun paket allaqachon yaratilgan', 'Package for the period already exists'],
  ifrs_err_pkg_locked: ['Пакет отправлен — изменения недоступны', 'Paket yuborilgan — o‘zgartirib bo‘lmaydi', 'Package submitted — editing is locked'],
  ifrs_err_amount: ['Некорректное значение', 'Noto‘g‘ri qiymat', 'Invalid value'],
  ifrs_err_pkg_invalid: ['Есть ошибки валидации — исправьте перед отправкой', 'Tekshiruv xatolari bor — yuborishdan oldin tuzating', 'Validation errors — fix before sending'],
  ifrs_err_sign: ['Требуется подпись E-IMZO', 'E-IMZO imzosi talab qilinadi', 'E-IMZO signature required'],
  ifrs_err_pkg_state: ['Действие недоступно в текущем статусе', 'Joriy holatda amal mavjud emas', 'Action not available in the current status'],
  ifrs_err_sod: ['Принять пакет должен другой сотрудник (не отправитель)', 'Paketni boshqa xodim (yuboruvchi emas) qabul qilishi kerak', 'The package must be accepted by another employee (not the sender)'],
  ifrs_err_comment: ['Укажите причину возврата', 'Qaytarish sababini kiriting', 'Enter the reason'],
  ifrs_err_pattern: ['Шаблон счёта — 1–4 цифры (префикс)', 'Hisobvaraq shabloni — 1–4 raqam (prefiks)', 'Account pattern — 1–4 digits (prefix)'],
  ifrs_err_rule_exists: ['Такое правило уже есть', 'Bunday qoida mavjud', 'Rule already exists'],
  ifrs_err_entity: ['Выберите дочернее предприятие, консолидируемое построчно', 'Satrma-satr konsolidatsiyalanadigan sho‘ba korxonani tanlang', 'Choose a fully consolidated subsidiary'],
  ifrs_err_plan_locked: ['План утверждён на начало месяца и не меняется', 'Reja oy boshida tasdiqlangan va o‘zgarmaydi', 'Plan approved at the start of the month is locked'],
};
export function useIfrsErr() {
  const p = useP();
  return (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    const x = ERR[m];
    return x ? p(...x) : userMessage(m);
  };
}
export function useIfrsRun() {
  const toast = useToast();
  const err = useIfrsErr();
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
        toast(err(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}
export function useEntityName() {
  const ents = useApi(() => ifrsApi.listEntities());
  return (id: string) => ents.data?.find((e) => e.id === id)?.shortName ?? id;
}

const PKG_TONE = { draft: 'muted', submitted: 'warn', accepted: 'ok', returned: 'danger' } as const;

// ---------------------------------------------------------------------------------------------
export function PackagesTab() {
  const p = useP();
  const user = useUser();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const [period, setPeriod] = useState('');
  const list = useApi(() => ifrsSubsApi.listPackages(period ? { period } : {}), [period]);
  const { busy, run } = useIfrsRun();
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [newFor, setNewFor] = useState('e5');
  const ST = { draft: p('черновик', 'qoralama', 'draft'), submitted: p('отправлен', 'yuborilgan', 'submitted'), accepted: p('принят', 'qabul qilingan', 'accepted'), returned: p('возвращён', 'qaytarilgan', 'returned') };
  const SRC = { api: 'API/ETL', manual: p('веб-форма', 'veb-shakl', 'web form'), excel: 'Excel' };
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
        <Select<string> value={period} onChange={setPeriod} options={['2026-09', '2026-10'].map((x) => ({ value: x, label: x }))} placeholder={p('Все периоды', 'Barcha davrlar', 'All periods')} ariaLabel={p('Период', 'Davr', 'Period')} />
        {can && (
          <>
            {(['e1', 'e2', 'e3'] as const).map((e) => (
              <Button key={e} size="small" icon="download" disabled={busy} onClick={() => run(() => ifrsSubsApi.fetchPackage(e, '2026-10', user), `${ename(e)}: ${p('пакет за 2026-10 получен', '2026-10 paketi olindi', 'package for 2026-10 received')}`)}>
                {ename(e)} · {ifrsSubsApi.connectors[e]!.toUpperCase()}
              </Button>
            ))}
            <Select<string> value={newFor} onChange={setNewFor} options={['e4', 'e5', 'e1', 'e2'].map((e) => ({ value: e, label: ename(e) }))} ariaLabel={p('Предприятие', 'Korxona', 'Entity')} />
            <Button size="small" icon="plus" disabled={busy} onClick={() => run(() => ifrsSubsApi.createManualPackage(newFor, '2026-11', user), p('Веб-форма за 2026-11 создана', '2026-11 veb-shakli yaratildi', 'Web form for 2026-11 created'))}>{p('Веб-форма 2026-11', 'Veb-shakl 2026-11', 'Web form 2026-11')}</Button>
            <Button size="small" icon="upload" onClick={() => setImporting(true)}>{p('Импорт Excel (макет)', 'Excel import (maket)', 'Import Excel (template)')}</Button>
          </>
        )}
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(x) => x.id}
        onRowClick={(x) => setOpen(x.id)}
        columns={[
          { header: p('Предприятие', 'Korxona', 'Entity'), render: (x) => <><b>{ename(x.entityId)}</b><div className="sub">{x.connector.toUpperCase()} · {SRC[x.source]}</div></> },
          { header: p('Период', 'Davr', 'Period'), render: (x) => x.period },
          { header: p('Статус', 'Holat', 'Status'), render: (x) => <Badge tone={PKG_TONE[x.status]}>{ST[x.status]}</Badge> },
          { header: p('Счетов', 'Hisobvaraqlar', 'Accounts'), align: 'right', render: (x) => x.rows.length },
          { header: p('Активы', 'Aktivlar', 'Assets'), align: 'right', render: (x) => formatNumber(Math.round(x.totals.asset / 1e6)) },
          { header: p('Проверка', 'Tekshiruv', 'Validation'), render: (x) => (x.issues.some((i) => i.severity === 'error') ? <Badge tone="danger">{x.issues.filter((i) => i.severity === 'error').length} {p('ошибок', 'xato', 'errors')}</Badge> : x.issues.length ? <Badge tone="warn">{x.issues.length} {p('замеч.', 'izoh', 'warnings')}</Badge> : <Badge tone="ok">OK</Badge>) },
          { header: p('Обновлён', 'Yangilangan', 'Updated'), render: (x) => <span className="small">{formatDateTime(x.updatedAt)}</span> },
        ]}
      />
      <div className="muted small" style={{ padding: '10px 18px' }}>{p('Принятые пакеты за отчётный месяц (2026-09) — источник отчётности дочерних в консолидации; суммы в млн в функциональной валюте.', "Hisobot oyi (2026-09) uchun qabul qilingan paketlar konsolidatsiyada sho'ba korxonalar hisobotining manbai; summalar funksional valyutada mln.", 'Accepted packages for the reporting month (2026-09) feed the subsidiaries into consolidation; amounts in millions, functional currency.')}</div>
      {open && <PackageDrawer id={open} onClose={() => setOpen(null)} />}
      <ImportDrawer targetId="ifrs_sub_tb" open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function PackageDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const p = useP();
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const pkg = useApi(() => ifrsSubsApi.getPackage(id), [id]);
  const sig = useApi(async () => (pkg.data?.signatureId ? signatureService.get(pkg.data.signatureId) : undefined), [pkg.data?.signatureId]);
  const { busy, run } = useIfrsRun();
  const [signing, setSigning] = useState(false);
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const x = pkg.data;
  if (!x) return null;
  const editable = can && (x.status === 'draft' || x.status === 'returned');
  const errors = x.issues.filter((i) => i.severity === 'error');
  const ISSUE: Record<string, string> = {
    balance: p('Баланс не сходится (активы ≠ обязательства + капитал + прибыль)', 'Balans mos emas (aktivlar ≠ majburiyatlar + kapital + foyda)', 'Balance does not tie (assets ≠ liabilities + equity + profit)'),
    unmapped: p('Счёт не сопоставлен с МСФО — добавьте правило в матрицу', 'Hisobvaraq MHXS bilan moslanmagan — matritsaga qoida qo‘shing', 'Account not mapped to IFRS — add a rule to the matrix'),
    required: p('Нет обязательного счёта', 'Majburiy hisobvaraq yo‘q', 'Mandatory account missing'),
    negative: p('Отрицательное сальдо по активному счёту', 'Aktiv hisobvaraq bo‘yicha manfiy saldo', 'Negative balance on an asset account'),
    arap: p('Реестр дебиторки больше сальдо счёта 4010', 'Debitorlik reyestri 4010 saldosidan katta', 'Receivables register exceeds account 4010'),
    empty: p('Пакет пуст', 'Paket bo‘sh', 'Package is empty'),
  };
  return (
    <Drawer
      open
      width={880}
      title={`${ename(x.entityId)} · ${x.period}`}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {editable && Object.keys(edits).length > 0 && (
            <Button disabled={busy} onClick={async () => { for (const [acc, v] of Object.entries(edits)) await ifrsSubsApi.updatePackageRow(x.id, acc, Number(v.replace(/\s/g, '').replace(',', '.')), user); setEdits({}); }}>
              {p('Сохранить изменения', "O'zgarishlarni saqlash", 'Save changes')}
            </Button>
          )}
          {editable && <Button type="primary" icon="pen" disabled={busy || errors.length > 0 || Object.keys(edits).length > 0} onClick={() => setSigning(true)}>{p('Подписать и отправить', 'Imzolash va yuborish', 'Sign and submit')}</Button>}
          {can && x.status === 'submitted' && <Button disabled={busy} onClick={() => setReturning(true)}>{p('Вернуть', 'Qaytarish', 'Return')}</Button>}
          {can && x.status === 'submitted' && <Button type="primary" disabled={busy} onClick={() => run(() => ifrsSubsApi.acceptPackage(x.id, user), p('Пакет принят', 'Paket qabul qilindi', 'Package accepted'))}>{p('Принять', 'Qabul qilish', 'Accept')}</Button>}
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="small">
          <Badge tone={PKG_TONE[x.status]}>{x.status}</Badge> · {x.connector.toUpperCase()}
          {x.exchangeId && <> · {p('обмен', 'almashinuv', 'exchange')} {x.exchangeId}</>}
          {x.returnComment && <div style={{ color: 'var(--danger)', marginTop: 6 }}>{p('Возвращён', 'Qaytarilgan', 'Returned')}: {x.returnComment}</div>}
        </div>
        {sig.data && <SignatureBadge record={sig.data} />}
        {x.issues.length > 0 ? (
          <Card title={p('Автоматическая проверка', 'Avtomatik tekshiruv', 'Automatic validation')}>
            {x.issues.map((i, k) => (
              <div key={k} className="small" style={{ color: i.severity === 'error' ? 'var(--danger)' : 'var(--warn)' }}>
                {i.severity === 'error' ? '✖' : '⚠'} {ISSUE[i.code] ?? i.code}{i.account ? `: ${i.account}` : ''}{i.detail ? ` (${i.detail})` : ''}
              </div>
            ))}
          </Card>
        ) : (
          <Badge tone="ok">{p('Проверки пройдены', 'Tekshiruvlardan o‘tdi', 'All checks passed')}</Badge>
        )}
        <div className="grid grid-3">
          {(['asset', 'liability', 'equity', 'income', 'expense'] as const).map((c) => (
            <div key={c} className="small"><span className="muted">{{ asset: p('Активы', 'Aktivlar', 'Assets'), liability: p('Обязательства', 'Majburiyatlar', 'Liabilities'), equity: p('Капитал', 'Kapital', 'Equity'), income: p('Доходы', 'Daromadlar', 'Income'), expense: p('Расходы', 'Xarajatlar', 'Expenses') }[c]}:</span> <b>{formatMoney(x.totals[c])}</b></div>
          ))}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{p('Счёт', 'Hisobvaraq', 'Account')}</th><th>{p('Наименование', 'Nomi', 'Name')}</th><th>{p('Строка МСФО', 'MHXS satri', 'IFRS line')}</th><th className="right">{p('Сальдо', 'Saldo', 'Balance')}</th></tr></thead>
            <tbody>
              {x.rows.map((r) => {
                const rule = ifrsSubsApi.ruleFor(x.entityId, r.account);
                return (
                  <tr key={r.account}>
                    <td className="doc-num">{r.account}</td>
                    <td>{r.name}</td>
                    <td>{rule ? t(tk('ifrs_line_', rule.line)) : <Badge tone="danger">{p('не сопоставлен', 'moslanmagan', 'unmapped')}</Badge>}</td>
                    <td className="right num" style={{ width: 200 }}>{editable ? <Input value={edits[r.account] ?? String(r.balance)} inputMode="numeric" ariaLabel={`${p('Сальдо', 'Saldo', 'Balance')} ${r.account}`} onChange={(e) => setEdits({ ...edits, [r.account]: e.target.value })} style={{ height: 30, textAlign: 'right' }} /> : formatMoney(r.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {x.arap.length > 0 && (
          <Card title={p('Дебиторская и кредиторская задолженность', 'Debitorlik va kreditorlik qarzlari', 'Receivables and payables')} flush>
            <DataTable rows={x.arap} rowKey={(a) => `${a.tin}-${a.kind}-${a.amount}`} columns={[
              { header: p('Контрагент', 'Kontragent', 'Counterparty'), render: (a) => <>{a.counterparty}<div className="sub">{p('ИНН', 'STIR', 'TIN')} {a.tin}</div></> },
              { header: p('Вид', 'Turi', 'Kind'), render: (a) => (a.kind === 'receivable' ? p('дебиторка', 'debitorlik', 'receivable') : p('кредиторка', 'kreditorlik', 'payable')) },
              { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (a) => formatMoney(a.amount) },
              { header: p('Просрочка, дн.', 'Kechikish, kun', 'Overdue, days'), align: 'right', render: (a) => (a.overdueDays ? <span style={{ color: a.overdueDays > 30 ? 'var(--danger)' : undefined }}>{a.overdueDays}</span> : '—') },
            ]} />
          </Card>
        )}
        {x.portfolio.length > 0 && <div className="small muted">{p('Портфель', 'Portfel', 'Portfolio')}: {x.portfolio.map((pf) => `${pf.kind} ${formatMoney(pf.amount)} (${pf.count})`).join('; ')}</div>}
        <Card title={t('history')}>
          {x.history.map((h, k) => <div key={k} className="small">{formatDateTime(h.at)} · {h.userId === 'system' ? p('система', 'tizim', 'system') : lk.user(h.userId)?.fullName ?? h.userId} · {h.action}{h.comment ? ` — ${h.comment}` : ''}</div>)}
        </Card>
      </div>
      {signing && (
        <SignModal
          doc={{ entity: 'ifrs_package', entityId: x.id, title: `${ename(x.entityId)} ${x.period}`, content: { entity: x.entityId, period: x.period, rows: x.rows } }}
          onClose={() => setSigning(false)}
          onSigned={(rec) => run(() => ifrsSubsApi.submitPackage(x.id, rec.id, user), p('Пакет подписан и отправлен в банк', 'Paket imzolandi va bankka yuborildi', 'Package signed and sent to the bank'))}
        />
      )}
      {returning && (
        <Modal title={p('Вернуть пакет на доработку', 'Paketni qayta ishlashga qaytarish', 'Return package for rework')} onClose={() => setReturning(false)} footer={<><Button onClick={() => setReturning(false)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => ifrsSubsApi.returnPackage(x.id, comment, user), p('Пакет возвращён', 'Paket qaytarildi', 'Package returned'))) setReturning(false); }}>{p('Вернуть', 'Qaytarish', 'Return')}</Button></>}>
          <Field label={p('Причина', 'Sabab', 'Reason')} required><Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} /></Field>
        </Modal>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------
export function CoaTab() {
  const p = useP();
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const [entity, setEntity] = useState('e1');
  const rules = useApi(() => ifrsSubsApi.listRules());
  const accounts = useApi(() => ifrsSubsApi.listAccounts(entity), [entity]);
  const { run } = useIfrsRun();
  const [f, setF] = useState({ entityId: '*', pattern: '', line: 'opex' as IfrsLine, note: '' });
  const LINES = IFRS_ALL_LINES.filter((l) => l !== 'goodwill' && l !== 'share_associates').map((l) => ({ value: l, label: t(tk('ifrs_line_', l)) }));
  return (
    <div className="grid grid-2" style={{ padding: 14, alignItems: 'start' }}>
      <Card title={p('Матрица трансформации НСБУ → МСФО', 'MBHS → MHXS transformatsiya matritsasi', 'NAS → IFRS transformation matrix')} flush>
        {can && (
          <div className="toolbar" style={{ padding: 12, gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
            <Select<string> value={f.entityId} onChange={(v) => setF({ ...f, entityId: v })} options={[{ value: '*', label: p('все предприятия', 'barcha korxonalar', 'all entities') }, ...['e1', 'e2', 'e3', 'e4', 'e5'].map((e) => ({ value: e, label: ename(e) }))]} ariaLabel={p('Предприятие', 'Korxona', 'Entity')} />
            <Input value={f.pattern} placeholder={p('Счёт/префикс', 'Hisobvaraq/prefiks', 'Account/prefix')} onChange={(e) => setF({ ...f, pattern: e.target.value })} style={{ width: 130 }} />
            <Select<IfrsLine> value={f.line} onChange={(v) => setF({ ...f, line: v })} options={LINES} ariaLabel={p('Строка МСФО', 'MHXS satri', 'IFRS line')} />
            <Button size="small" type="primary" onClick={async () => { if (await run(() => ifrsSubsApi.addRule({ entityId: f.entityId, pattern: f.pattern.trim(), line: f.line, ...(f.note ? { note: f.note } : {}) }, user), p('Правило добавлено', "Qoida qo'shildi", 'Rule added'))) setF({ ...f, pattern: '' }); }}>{p('Добавить правило', "Qoida qo'shish", 'Add rule')}</Button>
          </div>
        )}
        <DataTable rows={rules.data} rowKey={(r) => r.id} columns={[
          { header: p('Предприятие', 'Korxona', 'Entity'), render: (r) => (r.entityId === '*' ? <span className="muted">{p('все', 'barchasi', 'all')}</span> : ename(r.entityId)) },
          { header: p('Шаблон', 'Shablon', 'Pattern'), render: (r) => <span className="doc-num">{r.pattern}*</span> },
          { header: p('Строка МСФО', 'MHXS satri', 'IFRS line'), render: (r) => <>{t(tk('ifrs_line_', r.line))}{r.note && <div className="sub">{loc(r.note)}</div>}</> },
          { header: '', render: (r) => (can && r.createdBy ? <Button size="small" danger onClick={() => run(() => ifrsSubsApi.removeRule(r.id, user), p('Правило удалено', "Qoida o'chirildi", 'Rule removed'))}>×</Button> : null) },
        ]} />
      </Card>
      <Card title={p('План счетов предприятия и результат сопоставления', 'Korxona hisobvaraqlar rejasi va moslashtirish natijasi', 'Entity chart of accounts and mapping result')} actions={<Select<string> value={entity} onChange={setEntity} options={['e1', 'e2', 'e3', 'e4', 'e5'].map((e) => ({ value: e, label: ename(e) }))} ariaLabel={p('Предприятие', 'Korxona', 'Entity')} />} flush>
        <DataTable rows={accounts.data} rowKey={(a) => a.code} columns={[
          { header: p('Счёт', 'Hisobvaraq', 'Account'), render: (a) => <span className="doc-num">{a.code}</span> },
          { header: p('Наименование', 'Nomi', 'Name'), render: (a) => loc(a.name) },
          {
            header: p('→ МСФО', '→ MHXS', '→ IFRS'),
            render: (a) => {
              const r = ifrsSubsApi.ruleFor(entity, a.code);
              return r ? <>{t(tk('ifrs_line_', r.line))} <span className="muted small">({r.pattern}*{r.entityId !== '*' ? ` · ${ename(r.entityId)}` : ''})</span></> : <Badge tone="danger">{p('нет правила', "qoida yo'q", 'no rule')}</Badge>;
            },
          },
        ]} />
      </Card>
    </div>
  );
}

export function NsiTab() {
  const p = useP();
  const { loc } = useSession();
  const user = useUser();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const [kind, setKind] = useState<IfrsNsiKind>('counterparty');
  const items = useApi(() => ifrsSubsApi.listNsi(kind), [kind]);
  const groups = useApi(() => ifrsSubsApi.listGroupClass());
  const { busy, run } = useIfrsRun();
  const opts = (groups.data ?? []).filter((g) => g.kind === kind).map((g) => ({ value: g.code, label: `${g.code} · ${loc(g.name)}` }));
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <Select<IfrsNsiKind> value={kind} onChange={setKind} options={[{ value: 'counterparty', label: p('Контрагенты', 'Kontragentlar', 'Counterparties') }, { value: 'expense', label: p('Статьи расходов', 'Xarajat moddalari', 'Expense items') }, { value: 'asset', label: p('Классы активов', 'Aktiv sinflari', 'Asset classes') }]} ariaLabel={p('Справочник', "Ma'lumotnoma", 'Classifier')} />
        {can && <Button size="small" type="primary" disabled={busy} onClick={() => run(() => ifrsSubsApi.autoMatchNsi(user), p('Автосопоставление выполнено', 'Avtomatik moslashtirish bajarildi', 'Auto-match completed'))}>{p('Автосопоставление (ИНН / ключевые слова)', "Avtomatik moslashtirish (STIR / kalit so'zlar)", 'Auto-match (TIN / keywords)')}</Button>}
        <span className="muted small">{p('Локальные справочники предприятий приводятся к единым классификаторам группы.', "Korxonalarning mahalliy ma'lumotnomalari guruhning yagona klassifikatorlariga keltiriladi.", 'Local entity classifiers are aligned to the group-wide classifiers.')}</span>
      </div>
      <DataTable rows={items.data} loading={items.loading} rowKey={(n) => n.id} columns={[
        { header: p('Предприятие', 'Korxona', 'Entity'), render: (n) => ename(n.entityId) },
        { header: p('Локальный код', 'Mahalliy kod', 'Local code'), render: (n) => <span className="doc-num">{n.localCode}</span> },
        { header: p('Наименование', 'Nomi', 'Name'), render: (n) => <>{n.localName}{n.tin && <div className="sub">{p('ИНН', 'STIR', 'TIN')} {n.tin}</div>}</> },
        { header: p('Единый классификатор', 'Yagona klassifikator', 'Group classifier'), render: (n) => <Select<string> value={n.groupCode ?? ''} disabled={!can} onChange={(v) => run(() => ifrsSubsApi.setNsi(n.id, v, user), p('Сопоставление сохранено', 'Moslashtirish saqlandi', 'Mapping saved'))} options={opts} placeholder="—" ariaLabel={`NSI ${n.localCode}`} /> },
        { header: '', render: (n) => (n.groupCode ? <Badge tone={n.matchedBy === 'auto' ? 'info' : 'ok'}>{n.matchedBy === 'auto' ? p('авто', 'avto', 'auto') : p('вручную', "qo'lda", 'manual')}</Badge> : <Badge tone="warn">{p('не сопоставлен', 'moslanmagan', 'unmatched')}</Badge>) },
      ]} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
export function ElimsTab() {
  const p = useP();
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan()('ifrs', 'edit');
  const ename = useEntityName();
  const cons = useApi(() => ifrsApi.getConsolidation());
  const ig = useApi(() => ifrsApi.listIntragroup());
  const cands = useApi(async () => ifrsSubsApi.detectIntragroup(await ifrsApi.listIntragroup()), [ig.data]);
  const divs = useApi(() => ifrsSubsApi.listDividends());
  const { busy, run } = useIfrsRun();
  const [adding, setAdding] = useState<IfrsIntragroupCandidate | null>(null);
  const [pl, setPl] = useState('0');
  const [div, setDiv] = useState({ entityId: 'e1', amount: '' });
  const SRC = { intragroup: p('Внутригрупповые остатки и обороты', 'Guruh ichidagi qoldiq va aylanmalar', 'Intragroup balances and turnover'), investment: p('Инвестиции и капитал, НКД', 'Investitsiyalar va kapital, NNU', 'Investments, equity, NCI'), associate: p('Ассоциированные (долевой метод)', 'Assotsiatsiyalangan (ulush usuli)', 'Associates (equity method)'), dividend: p('Внутригрупповые дивиденды', 'Guruh ichidagi dividendlar', 'Intragroup dividends') };
  const CAND = { matched: <Badge tone="ok">{p('элиминируется', 'eliminatsiya qilinadi', 'eliminated')}</Badge>, new: <Badge tone="warn">{p('новая — не элиминирована', 'yangi — eliminatsiya qilinmagan', 'new — not eliminated')}</Badge>, mismatch: <Badge tone="danger">{p('расхождение сторон', 'tomonlar farqi', 'counterparty mismatch')}</Badge> };
  const journal = cons.data?.journal ?? [];
  return (
    <div style={{ display: 'grid', gap: 14, padding: 14 }}>
      <Card title={p('Автовыявление внутригрупповых операций (реестры дебиторки/кредиторки)', 'Guruh ichidagi operatsiyalarni avtomatik aniqlash (debitorlik/kreditorlik reyestrlari)', 'Automatic intragroup detection (AR/AP registers)')} flush>
        <DataTable rows={cands.data} loading={cands.loading} rowKey={(c) => c.key} columns={[
          { header: p('Требование → обязательство', 'Talab → majburiyat', 'Claim → liability'), render: (c) => <><b>{ename(c.assetEntityId)}</b> → <b>{ename(c.liabilityEntityId)}</b><div className="sub">{c.description}</div></> },
          { header: p('У кредитора', 'Kreditorda', 'Asset side'), align: 'right', render: (c) => formatMoney(c.assetAmount) },
          { header: p('У должника', 'Qarzdorda', 'Liability side'), align: 'right', render: (c) => formatMoney(c.liabilityAmount) },
          { header: p('Разница', 'Farq', 'Difference'), align: 'right', render: (c) => formatMoney(c.difference) },
          { header: p('Статус', 'Holat', 'Status'), render: (c) => CAND[c.status] },
          { header: '', render: (c) => (can && c.status === 'new' ? <Button size="small" type="primary" onClick={() => { setAdding(c); setPl('0'); }}>{p('Включить в элиминации', 'Eliminatsiyaga kiritish', 'Add to eliminations')}</Button> : null) },
        ]} />
      </Card>
      <Card title={p('Внутригрупповые дивиденды', 'Guruh ichidagi dividendlar', 'Intragroup dividends')} flush>
        {can && (
          <div className="toolbar" style={{ padding: 12, gap: 8, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <Select<string> value={div.entityId} onChange={(v) => setDiv({ ...div, entityId: v })} options={['e1', 'e2', 'e3', 'e4'].map((e) => ({ value: e, label: ename(e) }))} ariaLabel={p('Предприятие', 'Korxona', 'Entity')} />
            <Input value={div.amount} inputMode="numeric" placeholder={p('Сумма (функц. валюта)', 'Summa (funks. valyuta)', 'Amount (functional ccy)')} onChange={(e) => setDiv({ ...div, amount: e.target.value })} style={{ width: 200 }} />
            <Button size="small" disabled={busy} onClick={async () => { if (await run(() => ifrsSubsApi.addDividend({ entityId: div.entityId, amount: Number(div.amount.replace(/\s/g, '')), declaredAt: new Date().toISOString().slice(0, 10) }, user), p('Дивиденды зарегистрированы, элиминация пересчитана', "Dividendlar ro'yxatga olindi, eliminatsiya qayta hisoblandi", 'Dividend registered, elimination recalculated'))) setDiv({ ...div, amount: '' }); }}>{p('Объявить дивиденды', "Dividend e'lon qilish", 'Declare dividend')}</Button>
          </div>
        )}
        <DataTable rows={divs.data} rowKey={(d) => d.id} columns={[
          { header: p('Предприятие', 'Korxona', 'Entity'), render: (d) => ename(d.entityId) },
          { header: p('Объявлены', "E'lon qilingan", 'Declared'), render: (d) => d.declaredAt },
          { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (d) => formatMoney(d.amount) },
          { header: '', render: (d) => (can ? <Button size="small" danger onClick={() => run(() => ifrsSubsApi.removeDividend(d.id, user), p('Удалено', "O'chirildi", 'Removed'))}>×</Button> : null) },
        ]} />
      </Card>
      <Card title={p('Журнал элиминаций и консолидационных проводок', 'Eliminatsiyalar va konsolidatsiya provodkalari jurnali', 'Elimination and consolidation journal')} flush actions={
        <ExportButton filename="ifrs-elimination-journal" sheets={() => [{ name: 'Journal', columns: [{ header: p('Источник', 'Manba', 'Source') }, { header: p('Ссылка', 'Havola', 'Ref') }, { header: p('Описание', 'Tavsif', 'Description') }, { header: p('Строка', 'Satr', 'Line') }, { header: p('Сумма', 'Summa', 'Amount'), format: 'money' }], rows: journal.flatMap((j) => j.lines.map((l) => [SRC[j.source], j.ref, loc(j.description), t(tk('ifrs_line_', l.line)), l.amount])) }]} />
      }>
        <DataTable rows={journal} loading={cons.loading} rowKey={(j) => `${j.source}-${j.ref}`} columns={[
          { header: p('Источник', 'Manba', 'Source'), render: (j) => <Badge tone="info">{SRC[j.source]}</Badge> },
          { header: p('Описание', 'Tavsif', 'Description'), render: (j) => <>{loc(j.description)}<div className="sub">{j.ref}</div></> },
          { header: p('Проводки (млн)', 'Provodkalar (mln)', 'Entries (mln)'), render: (j) => <span className="small">{j.lines.map((l) => `${t(tk('ifrs_line_', l.line))} ${formatNumber(Math.round(l.amount / 1e6))}`).join('; ')}</span> },
        ]} />
      </Card>
      {adding && (
        <Modal title={p('Включить операцию в элиминации', 'Operatsiyani eliminatsiyaga kiritish', 'Add operation to eliminations')} onClose={() => setAdding(null)} footer={<><Button onClick={() => setAdding(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button><Button type="primary" onClick={async () => { if (await run(() => ifrsApi.addIntragroup({ assetEntityId: adding.assetEntityId, liabilityEntityId: adding.liabilityEntityId, amount: Math.min(adding.assetAmount, adding.liabilityAmount), description: adding.description, plAmount: Number(pl.replace(/\s/g, '')) }, user), p('Операция включена, консолидация пересчитана', 'Operatsiya kiritildi, konsolidatsiya qayta hisoblandi', 'Added, consolidation recalculated'))) setAdding(null); }}>{p('Включить', 'Kiritish', 'Add')}</Button></>}>
          <p className="small">{ename(adding.assetEntityId)} → {ename(adding.liabilityEntityId)}: {formatMoney(Math.min(adding.assetAmount, adding.liabilityAmount))} ({p('прочие активы / прочие обязательства', 'boshqa aktivlar / boshqa majburiyatlar', 'other assets / other liabilities')})</p>
          <Field label={p('Внутригрупповой оборот за период (доход / расход)', 'Davr uchun guruh ichidagi aylanma (daromad / xarajat)', 'Intragroup turnover for the period (income / expense)')}><Input value={pl} inputMode="numeric" onChange={(e) => setPl(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}


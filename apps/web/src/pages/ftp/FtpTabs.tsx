// FTP (ТЗ 4.2.15): приём из КХД (контроль, сверка, версии), методологии (Single Pool / Matched Maturity, версии, утверждение,
// параллельный расчёт), регуляторные компоненты (ФОР, LCR, HQLA, параметры ЦБ) и стоимость ликвидности, правила применения
// ставок (валюта, филиал, направление, срок) и отчёт по филиалам, расчёты (расписание, на дату, Re-run с историей).
import { Fragment, useState } from 'react';
import {
  formatDate,
  formatDateTime,
  formatMoneyShort,
  ftpApi,
  today,
  type FtpBranchRow,
  type FtpCurrency,
  type FtpKhdBatch,
  type FtpKhdKind,
  type FtpLcrCategory,
  type FtpMethod,
  type FtpRateBreakdown,
  type FtpRateRule,
  type FtpRegParams,
  type FtpResults,
  type FtpRun,
  type FtpSide,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Empty, Field, FilterBar, Input, Loading, Modal, Select, Stat, Switch, useToast, type Tone } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { useCan, useStepUp } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { usePick, useErrText } from '../budgeting/shared';
import { fx, pct, signed } from './FtpPage';

export function useFtpErr() {
  const base = useErrText();
  const p = usePick();
  return (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    const map: Record<string, string> = {
      ftp_err_tenor: p('Срок: обозначение, 0 < мес. ≤ 360, ставка 0–60%', 'Muddat: belgi, 0 < oy ≤ 360, stavka 0–60%', 'Tenor: label, 0 < months ≤ 360, rate 0–60%'),
      ftp_err_tenor_dup: p('Такой срок уже есть в кривой', 'Bunday muddat egri chiziqda bor', 'This tenor already exists'),
      ftp_err_currency: p('Кривая для этой валюты уже есть', 'Bu valyuta uchun egri chiziq bor', 'A curve for this currency already exists'),
      ftp_err_date: p('Неверная дата', 'Noto‘g‘ri sana', 'Invalid date'),
      ftp_err_period: p('Период — ГГГГ-ММ', 'Davr — YYYY-MM', 'Period must be YYYY-MM'),
      ftp_err_market_unavailable: p('Источник рыночных данных недоступен — запрос в очереди', 'Bozor ma’lumotlari manbai mavjud emas — so‘rov navbatda', 'Market data source unavailable — request queued'),
      ftp_err_version: p('Версия не найдена или уже активна', 'Versiya topilmadi yoki faol', 'Version not found or already active'),
      ftp_err_four_eyes: p('Принцип «четырёх глаз»: утверждает другой сотрудник', '«To‘rt ko‘z» tamoyili: boshqa xodim tasdiqlaydi', 'Four-eyes principle: another employee must approve'),
      ftp_err_not_approved: p('У методологии нет утверждённой версии', 'Metodologiyada tasdiqlangan versiya yo‘q', 'The methodology has no approved version'),
      ftp_err_pool: p('Укажите единую ставку пула хотя бы для одной валюты', 'Kamida bitta valyuta uchun pul stavkasini kiriting', 'Enter a pool rate for at least one currency'),
      ftp_err_methodology: p('Укажите код и название методологии', 'Metodologiya kodi va nomini kiriting', 'Enter the methodology code and name'),
      ftp_err_reg: p('Проверьте параметры (0–200), дату и основание изменения', 'Parametrlarni (0–200), sana va asosni tekshiring', 'Check parameters (0–200), date and basis'),
      ftp_err_lp: p('Надбавка — от −200 до 500 б.п.', 'Ustama — −200 dan 500 b.p. gacha', 'Premium must be −200…500 bp'),
      ftp_err_amount: p('Сумма должна быть ≥ 0', 'Summa ≥ 0 bo‘lishi kerak', 'Amount must be ≥ 0'),
      ftp_err_rule: p('Правило: название, значение (корр. ≤ 1000 б.п., фикс. 0–60%), корректный диапазон сроков', 'Qoida: nom, qiymat (tuzatish ≤ 1000 b.p., qat’iy 0–60%), to‘g‘ri muddatlar', 'Rule: name, value (adjust ≤ 1000 bp, fixed 0–60%), valid tenor range'),
      ftp_err_reason: p('Укажите причину (от 5 символов)', 'Sababni ko‘rsating (5 belgidan)', 'Enter a reason (5+ chars)'),
      ftp_err_khd_unavailable: p('КХД недоступно — запрос поставлен в очередь', 'KXO mavjud emas — so‘rov navbatga qo‘yildi', 'DWH unavailable — request queued'),
      ftp_err_khd_state: p('Действие недоступно в текущем статусе пакета', 'Paketning joriy holatida amal mavjud emas', 'Action not available in the current batch status'),
      ftp_err_khd_comment: p('Есть расхождения сверх допуска — укажите комментарий', 'Ruxsatdan ortiq farqlar bor — izoh yozing', 'Differences exceed tolerance — enter a comment'),
    };
    return map[m] ?? base(e);
  };
}

const KHD_TONE: Record<FtpKhdBatch['status'], Tone> = { received: 'muted', validated: 'info', errors: 'danger', reconciled: 'info', accepted: 'ok', rejected: 'danger', superseded: 'muted' };

export function KhdTab() {
  const { loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useFtpErr();
  const list = useApi(() => ftpApi.listKhd());
  const products = useApi(() => ftpApi.listProducts());
  const [kind, setKind] = useState<FtpKhdKind>('results');
  const [period, setPeriod] = useState('2026-10');
  const [faulty, setFaulty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const editable = can('ftp', 'edit');
  const st = (s: FtpKhdBatch['status']) => ({ received: p('Получен', 'Qabul qilindi', 'Received'), validated: p('Проверен', 'Tekshirildi', 'Validated'), errors: p('Ошибки контроля', 'Nazorat xatolari', 'Control errors'), reconciled: p('Сверен', 'Solishtirildi', 'Reconciled'), accepted: p('Принят (действующая версия)', 'Qabul qilingan (amaldagi versiya)', 'Accepted (current version)'), rejected: p('Отклонён', 'Rad etildi', 'Rejected'), superseded: p('Заменён новой версией', 'Yangi versiya bilan almashtirildi', 'Superseded') })[s];
  const cur = list.data?.find((b) => b.id === open);
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1, minWidth: 240 }}>
          {p('Ставки и результаты FTP по кредитам и депозитам рассчитываются в КХД. XB-ERP принимает пакет, проверяет (формат, диапазоны, дубликаты, контрольные суммы), сверяет с контрольным расчётом, версионирует и применяет в отчётности.', 'Kreditlar va depozitlar bo‘yicha FTP stavkalari va natijalari KXO da hisoblanadi. XB-ERP paketni qabul qiladi, tekshiradi, nazorat hisobi bilan solishtiradi, versiyalaydi va hisobotda qo‘llaydi.', 'FTP rates and results for loans and deposits are calculated in the DWH. XB-ERP receives the batch, validates it, reconciles it with the control calculation, versions it and applies it in reporting.')}
        </span>
        {editable && (
          <>
            <Select<FtpKhdKind> value={kind} onChange={setKind} ariaLabel={p('Тип пакета', 'Paket turi', 'Batch type')} options={[{ value: 'results', label: p('Результаты FTP', 'FTP natijalari', 'FTP results') }, { value: 'rates', label: p('Ставки (кривые)', 'Stavkalar (egri chiziqlar)', 'Rates (curves)') }]} />
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} ariaLabel={p('Период', 'Davr', 'Period')} style={{ width: 100 }} />
            <Checkbox checked={faulty} onChange={setFaulty}>{p('Сбойный пакет (демо)', 'Nosoz paket (demo)', 'Faulty batch (demo)')}</Checkbox>
            <Button type="primary" size="small" icon="download" loading={busy} onClick={async () => { setBusy(true); try { const b = await ftpApi.requestKhd(kind, period, user, faulty); toast(`${b.number}: ${st(b.status)}`); setOpen(b.id); } catch (e) { toast(err(e)); } finally { setBusy(false); } }}>
              {p('Загрузить из КХД', 'KXO dan yuklash', 'Load from DWH')}
            </Button>
          </>
        )}
      </FilterBar>
      <DataTable
        rows={list.data}
        loading={list.loading}
        rowKey={(b) => b.id}
        onRowClick={(b) => setOpen(b.id)}
        columns={[
          { header: p('Пакет', 'Paket', 'Batch'), render: (b) => <span className="doc-num">{b.number}</span> },
          { header: p('Тип', 'Turi', 'Type'), render: (b) => (b.kind === 'results' ? p('Результаты', 'Natijalar', 'Results') : p('Ставки', 'Stavkalar', 'Rates')) },
          { header: p('Период / версия', 'Davr / versiya', 'Period / version'), render: (b) => `${b.period} · v${b.version}` },
          { header: p('Получен', 'Qabul qilingan', 'Received'), render: (b) => <span className="small muted">{formatDateTime(b.receivedAt)}</span> },
          { header: p('Записей', 'Yozuvlar', 'Rows'), align: 'right', render: (b) => b.rows.length },
          { header: p('Ошибки / расхождения', 'Xatolar / farqlar', 'Errors / differences'), align: 'right', render: (b) => `${b.issues.length} / ${b.recon ? b.recon.diffs.filter((d) => d.flagged).length : '—'}` },
          { header: p('Статус', 'Holat', 'Status'), render: (b) => <Badge tone={KHD_TONE[b.status]}>{st(b.status)}</Badge> },
        ]}
      />
      {cur && <KhdModal b={cur} st={st} productName={(id) => { const x = products.data?.find((q) => q.id === id); return x ? loc(x.name) : id ?? ''; }} onClose={() => setOpen(null)} />}
    </>
  );
}

function KhdModal({ b, st, productName, onClose }: { b: FtpKhdBatch; st: (s: FtpKhdBatch['status']) => string; productName: (id?: string) => string; onClose: () => void }) {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useFtpErr();
  const lk = useLookups();
  const [comment, setComment] = useState('');
  const editable = can('ftp', 'edit');
  const flagged = b.recon?.diffs.filter((d) => d.flagged) ?? [];
  const act = async (f: () => Promise<unknown>, msg: string) => {
    try {
      await f();
      toast(msg);
    } catch (e) {
      toast(err(e));
    }
  };
  return (
    <Modal
      title={`${b.number} · ${st(b.status)}`}
      onClose={onClose}
      footer={
        <>
          <ExportButton
            filename={b.number}
            rows={b.rows}
            columns={[
              { header: p('Ключ', 'Kalit', 'Key'), value: (r) => r.key },
              { header: p('Валюта', 'Valyuta', 'Currency'), value: (r) => r.currency },
              { header: p('Остаток', 'Qoldiq', 'Balance'), value: (r) => r.balance ?? 0, format: 'money', total: true },
              { header: p('Ставка FTP', 'FTP stavkasi', 'FTP rate'), value: (r) => r.ftpRate, format: 'number' },
              { header: p('Плата/кредит FTP', 'FTP to‘lov/kredit', 'FTP charge'), value: (r) => r.ftpCharge ?? 0, format: 'money', total: true },
            ]}
          />
          {editable && b.status === 'validated' && <Button type="primary" onClick={() => act(() => ftpApi.reconcileKhd(b.id, user), p('Сверка выполнена', 'Solishtirish bajarildi', 'Reconciliation done'))}>{p('Сверить с контрольным расчётом', 'Nazorat hisobi bilan solishtirish', 'Reconcile with control calculation')}</Button>}
          {editable && b.status === 'reconciled' && <Button type="primary" onClick={() => act(() => ftpApi.acceptKhd(b.id, comment, user), p('Версия принята и применена', 'Versiya qabul qilindi va qo‘llandi', 'Version accepted and applied'))}>{p('Принять версию', 'Versiyani qabul qilish', 'Accept version')}</Button>}
          {editable && !['accepted', 'rejected', 'superseded'].includes(b.status) && <Button danger onClick={() => act(() => ftpApi.rejectKhd(b.id, comment || p('Ошибки контроля', 'Nazorat xatolari', 'Control errors'), user), p('Пакет отклонён', 'Paket rad etildi', 'Batch rejected'))}>{p('Отклонить', 'Rad etish', 'Reject')}</Button>}
          <Button onClick={onClose}>{p('Закрыть', 'Yopish', 'Close')}</Button>
        </>
      }
    >
      <div className="grid grid-3">
        <Stat label={p('Записей / контроль', 'Yozuvlar / nazorat', 'Rows / control')} value={`${b.rows.length} / ${b.control.rows}`} tone={b.rows.length !== b.control.rows ? 'alert' : undefined} />
        <Stat label={p('Остатки (контрольная сумма)', 'Qoldiqlar (nazorat summasi)', 'Balances (control total)')} value={formatMoneyShort(b.control.balance, lang)} />
        <Stat label={p('Совпало в пределах допуска', 'Ruxsat doirasida mos keldi', 'Matched within tolerance')} value={b.recon ? `${b.recon.matched} / ${b.recon.diffs.length}` : '—'} tone={flagged.length ? 'alert' : undefined} />
      </div>
      {b.issues.length > 0 && (
        <>
          <b>{p('Ошибки контроля', 'Nazorat xatolari', 'Control errors')}</b>
          <DataTable rows={b.issues} rowKey={(i) => `${i.row}-${i.field}-${i.code}`} columns={[{ header: '#', render: (i) => i.row || '—' }, { header: p('Поле', 'Maydon', 'Field'), render: (i) => i.field }, { header: p('Ошибка', 'Xato', 'Error'), render: (i) => loc(i.message) }]} />
        </>
      )}
      {b.recon && (
        <>
          <b>{p('Сверка с контрольным расчётом', 'Nazorat hisobi bilan solishtirish', 'Reconciliation with control')} · {p('допуск', 'ruxsat', 'tolerance')} ±{b.recon.tolerance} {p('б.п.', 'b.p.', 'bp')}</b>
          <DataTable
            rows={[...b.recon.diffs].sort((a, c) => Math.abs(c.diffBp) - Math.abs(a.diffBp)).slice(0, 12)}
            rowKey={(d) => d.key}
            columns={[
              { header: p('Позиция', 'Pozitsiya', 'Item'), render: (d) => (b.kind === 'results' ? productName(d.key) : d.key) },
              { header: p('КХД', 'KXO', 'DWH'), align: 'right', render: (d) => pct(d.khdRate) },
              { header: p('Контроль', 'Nazorat', 'Control'), align: 'right', render: (d) => pct(d.ctrlRate) },
              { header: p('Разница, б.п.', 'Farq, b.p.', 'Diff, bp'), align: 'right', render: (d) => <Badge tone={d.flagged ? 'danger' : 'ok'}>{d.diffBp > 0 ? '+' : ''}{d.diffBp}</Badge> },
            ]}
          />
        </>
      )}
      {editable && ['validated', 'reconciled', 'errors', 'received'].includes(b.status) && (
        <Field label={p('Комментарий (обязателен при расхождениях или отклонении)', 'Izoh (farqlar yoki rad etishda majburiy)', 'Comment (required for differences or rejection)')}>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} ariaLabel={p('Комментарий', 'Izoh', 'Comment')} />
        </Field>
      )}
      {b.decidedBy && <div className="muted small">{st(b.status)} · {lk.user(b.decidedBy)?.fullName} · {b.decidedAt ? formatDateTime(b.decidedAt) : ''}{b.comment ? ` · ${b.comment}` : ''}</div>}
    </Modal>
  );
}

export function MethodologyTab({ results }: { results: FtpResults }) {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const stepUp = useStepUp();
  const toast = useToast();
  const err = useFtpErr();
  const lk = useLookups();
  const meth = useApi(() => ftpApi.listMethodologies());
  const units = useApi(() => ftpApi.listUnits());
  const cmp = useApi(() => ftpApi.compareMethodologies((meth.data ?? []).map((m) => m.id)), [meth.data?.length, meth.data?.map((m) => m.versions.length).join()]);
  const [draft, setDraft] = useState<null | { methodologyId: string; code: string; name: string; method: FtpMethod; validFrom: string; includeLp: boolean; includeRegulatory: boolean; applyRules: boolean; uzs: string; usd: string; eur: string; note: string }>(null);
  const editable = can('ftp', 'edit');
  const applied = ftpApi.appliedMethodologyId();
  const short = (v: number) => formatMoneyShort(v, lang);
  const methodLabel = (m: FtpMethod) => (m === 'single_pool' ? 'Single Pool' : 'Matched Maturity');
  const unitName = (id: string) => { const u = units.data?.find((x) => x.id === id); return u ? loc(u.name) : id; };
  return (
    <>
      <FilterBar>
        <span className="muted small" style={{ flex: 1 }}>{p('Хранится неограниченное число методологий и версий с датами вступления в силу; в расчётах автоматически применяется утверждённая версия, действующая на дату.', 'Cheklanmagan sondagi metodologiyalar va versiyalar kuchga kirish sanalari bilan saqlanadi; hisoblarda sanada amal qiladigan tasdiqlangan versiya avtomatik qo‘llanadi.', 'Unlimited methodologies and versions with effective dates are stored; calculations automatically apply the approved version effective on the date.')}</span>
        {editable && <Button size="small" icon="plus" onClick={() => setDraft({ methodologyId: '', code: '', name: '', method: 'matched_maturity', validFrom: today(), includeLp: true, includeRegulatory: true, applyRules: true, uzs: '', usd: '', eur: '', note: '' })}>{p('Новая методология', 'Yangi metodologiya', 'New methodology')}</Button>}
      </FilterBar>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(meth.data ?? []).map((m) => (
          <Card
            key={m.id}
            title={<span>{m.code} · {loc(m.name)} {m.id === applied && <Badge tone="ok">{p('Применяется', 'Qo‘llanmoqda', 'Applied')}</Badge>}</span>}
            actions={editable ? (
              <span style={{ display: 'flex', gap: 6 }}>
                {m.id !== applied && <Button size="small" onClick={async () => { try { await ftpApi.setAppliedMethodology(m.id, user); toast(`${m.code}: ${p('применяется в расчётах', 'hisoblarda qo‘llanadi', 'applied in calculations')}`); } catch (e) { toast(err(e)); } }}>{p('Применять', 'Qo‘llash', 'Apply')}</Button>}
                <Button size="small" icon="plus" onClick={() => { const v = m.versions.at(-1)!; setDraft({ methodologyId: m.id, code: m.code, name: loc(m.name), method: v.method, validFrom: today(), includeLp: v.includeLp, includeRegulatory: v.includeRegulatory, applyRules: v.applyRules, uzs: String(v.poolRates.UZS ?? ''), usd: String(v.poolRates.USD ?? ''), eur: String(v.poolRates.EUR ?? ''), note: '' }); }}>{p('Версия', 'Versiya', 'Version')}</Button>
              </span>
            ) : undefined}
            flush
          >
            <DataTable
              rows={[...m.versions].reverse()}
              rowKey={(v) => String(v.version)}
              columns={[
                { header: p('Версия', 'Versiya', 'Version'), render: (v) => <b>v{v.version}</b> },
                { header: p('Действует с', 'Amal qiladi', 'Effective from'), render: (v) => formatDate(v.validFrom) },
                { header: p('Метод', 'Usul', 'Method'), render: (v) => methodLabel(v.method) + (v.method === 'single_pool' ? ` (${Object.entries(v.poolRates).map(([c, r]) => `${c} ${fx(r ?? 0)}%`).join(', ')})` : '') },
                { header: p('Компоненты', 'Komponentlar', 'Components'), render: (v) => <span className="small">{[v.includeLp && 'LP', v.includeRegulatory && p('ФОР/LCR', 'MZF/LCR', 'Reserves/LCR'), v.applyRules && p('правила', 'qoidalar', 'rules')].filter(Boolean).join(' · ') || '—'}</span> },
                { header: p('Статус', 'Holat', 'Status'), render: (v) => <Badge tone={v.status === 'approved' ? 'ok' : v.status === 'draft' ? 'warn' : 'muted'}>{v.status === 'approved' ? p('Утверждена', 'Tasdiqlangan', 'Approved') : v.status === 'draft' ? p('Проект', 'Loyiha', 'Draft') : p('Выведена', 'Chiqarilgan', 'Retired')}</Badge> },
                { header: p('Автор / утвердил', 'Muallif / tasdiqladi', 'Author / approver'), render: (v) => <span className="small">{lk.user(v.createdBy)?.fullName}{v.approvedBy ? ` / ${lk.user(v.approvedBy)?.fullName}` : ''}</span> },
                { header: '', render: (v) => (editable && v.status === 'draft' ? <Button size="small" type="primary" onClick={async () => { if (!(await stepUp(p('Утверждение методологии FTP', 'FTP metodologiyasini tasdiqlash', 'Approve FTP methodology')))) return; try { await ftpApi.approveMethodologyVersion(m.id, v.version, user); toast(`${m.code} v${v.version}: ${p('утверждена', 'tasdiqlandi', 'approved')}`); } catch (e) { toast(err(e)); } }}>{p('Утвердить', 'Tasdiqlash', 'Approve')}</Button> : <span className="small muted">{v.note}</span>) },
              ]}
            />
          </Card>
        ))}
        <Card title={p('Параллельный расчёт и сравнение методологий', 'Metodologiyalarni parallel hisoblash va taqqoslash', 'Parallel calculation and comparison')} flush>
          {!cmp.data ? (
            <Loading />
          ) : (
            <DataTable
              rows={results.units}
              rowKey={(u) => u.unitId}
              columns={[
                { header: p('Направление', 'Yo‘nalish', 'Business line'), render: (u) => unitName(u.unitId) },
                ...cmp.data.map((r) => ({ header: `${(meth.data ?? []).find((m) => m.id === r.methodologyId)?.code ?? r.methodologyId} v${r.methodologyVersion}`, align: 'right' as const, render: (u: { unitId: string }) => short(r.units.find((x) => x.unitId === u.unitId)?.totalNii ?? 0) })),
              ]}
            />
          )}
          {cmp.data && <div className="muted small" style={{ padding: '8px 18px 14px' }}>{p('ЧПД банка одинаков во всех методологиях — меняется только распределение между направлениями и казначейством.', 'Bank SFD barcha metodologiyalarda bir xil — faqat yo‘nalishlar va g‘aznachilik o‘rtasidagi taqsimot o‘zgaradi.', 'Bank NII is the same under every methodology — only the split between lines and treasury changes.')}</div>}
        </Card>
        <Card title={p('Ставки по балансовым счетам (WAL)', 'Balans hisoblari bo‘yicha stavkalar (WAL)', 'Balance-sheet account rates (WAL)')} flush>
          <DataTable
            rows={results.accounts}
            rowKey={(a) => a.code}
            columns={[
              { header: p('Счёт', 'Hisob', 'Account'), render: (a) => <><b>{a.code}</b> {loc(a.name)}</> },
              { header: p('Валюта', 'Valyuta', 'Currency'), render: (a) => a.currency },
              { header: p('Остаток', 'Qoldiq', 'Balance'), align: 'right', render: (a) => short(a.balance) },
              { header: 'WAL', align: 'right', render: (a) => `${fx(a.wal, 1)} ${p('мес.', 'oy', 'mo')}` },
              { header: p('Ставка FTP по WAL', 'WAL bo‘yicha FTP stavkasi', 'FTP rate by WAL'), align: 'right', render: (a) => <b>{pct(a.rate)}</b> },
            ]}
          />
        </Card>
      </div>
      {draft && (
        <Modal
          title={draft.methodologyId ? `${draft.code}: ${p('новая версия', 'yangi versiya', 'new version')}` : p('Новая методология', 'Yangi metodologiya', 'New methodology')}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button onClick={() => setDraft(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => {
                const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : undefined);
                const poolRates = Object.fromEntries(([['UZS', draft.uzs], ['USD', draft.usd], ['EUR', draft.eur]] as [FtpCurrency, string][]).filter(([, v]) => num(v) !== undefined).map(([c, v]) => [c, num(v)!]));
                try {
                  await ftpApi.saveMethodologyVersion({ ...(draft.methodologyId ? { methodologyId: draft.methodologyId } : { code: draft.code, name: draft.name }), validFrom: draft.validFrom, method: draft.method, poolRates, includeLp: draft.includeLp, includeRegulatory: draft.includeRegulatory, applyRules: draft.applyRules, note: draft.note }, user);
                  toast(p('Проект версии создан — требуется утверждение другим сотрудником', 'Versiya loyihasi yaratildi — boshqa xodim tasdiqlashi kerak', 'Draft version created — approval by another employee required'));
                  setDraft(null);
                } catch (e) { toast(err(e)); }
              }}>{p('Сохранить проект', 'Loyihani saqlash', 'Save draft')}</Button>
            </>
          }
        >
          <div className="form-grid">
            {!draft.methodologyId && (
              <>
                <Field label={p('Код', 'Kod', 'Code')}><Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} ariaLabel={p('Код методологии', 'Metodologiya kodi', 'Methodology code')} /></Field>
                <Field label={p('Название', 'Nomi', 'Name')}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} ariaLabel={p('Название методологии', 'Metodologiya nomi', 'Methodology name')} /></Field>
              </>
            )}
            <Field label={p('Метод', 'Usul', 'Method')}><Select<FtpMethod> value={draft.method} onChange={(v) => setDraft({ ...draft, method: v })} options={[{ value: 'matched_maturity', label: 'Matched Maturity' }, { value: 'single_pool', label: 'Single Pool' }]} ariaLabel={p('Метод', 'Usul', 'Method')} /></Field>
            <Field label={p('Действует с', 'Amal qiladi', 'Effective from')}><Input type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} ariaLabel={p('Действует с', 'Amal qiladi', 'Effective from')} /></Field>
            {draft.method === 'single_pool' && (
              <>
                <Field label="UZS, %"><Input value={draft.uzs} inputMode="decimal" onChange={(e) => setDraft({ ...draft, uzs: e.target.value })} ariaLabel="UZS pool" /></Field>
                <Field label="USD, %"><Input value={draft.usd} inputMode="decimal" onChange={(e) => setDraft({ ...draft, usd: e.target.value })} ariaLabel="USD pool" /></Field>
                <Field label="EUR, %"><Input value={draft.eur} inputMode="decimal" onChange={(e) => setDraft({ ...draft, eur: e.target.value })} ariaLabel="EUR pool" /></Field>
              </>
            )}
            <Field label={p('Компоненты', 'Komponentlar', 'Components')} className="span-2">
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <Checkbox checked={draft.includeLp} onChange={(v) => setDraft({ ...draft, includeLp: v })}>Liquidity Premium</Checkbox>
                <Checkbox checked={draft.includeRegulatory} onChange={(v) => setDraft({ ...draft, includeRegulatory: v })}>{p('ФОР и LCR', 'MZF va LCR', 'Reserves and LCR')}</Checkbox>
                <Checkbox checked={draft.applyRules} onChange={(v) => setDraft({ ...draft, applyRules: v })}>{p('Правила применения', 'Qo‘llash qoidalari', 'Application rules')}</Checkbox>
              </div>
            </Field>
            <Field label={p('Основание / комментарий', 'Asos / izoh', 'Basis / note')} className="span-2"><Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} ariaLabel={p('Комментарий', 'Izoh', 'Note')} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

const LCR_CATS: FtpLcrCategory[] = ['retail_stable', 'retail_less_stable', 'corp_operational', 'corp_non_operational', 'financial'];

export function RegulatoryTab({ results }: { results: FtpResults }) {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useFtpErr();
  const lk = useLookups();
  const reg = useApi(() => ftpApi.listRegParams());
  const hqla = useApi(() => ftpApi.listHqla());
  const lp = useApi(() => ftpApi.listLp());
  const units = useApi(() => ftpApi.listUnits());
  const [edit, setEdit] = useState<FtpRegParams | null>(null);
  const [lpEdit, setLpEdit] = useState<{ label: string; bp: string; months?: string; isNew?: boolean } | null>(null);
  const [hEdit, setHEdit] = useState<{ id: string; amount: string } | null>(null);
  const editable = can('ftp', 'edit');
  const short = (v: number) => formatMoneyShort(v, lang);
  const L = results.liquidity;
  const catLabel = (c: FtpLcrCategory) => ({ retail_stable: p('Розница стабильные', 'Chakana barqaror', 'Retail stable'), retail_less_stable: p('Розница менее стабильные', 'Chakana kam barqaror', 'Retail less stable'), corp_operational: p('Юрлица операционные', 'Yuridik operatsion', 'Corporate operational'), corp_non_operational: p('Юрлица неоперационные', 'Yuridik operatsion bo‘lmagan', 'Corporate non-operational'), financial: p('Финансовые организации', 'Moliya tashkilotlari', 'Financial institutions'), none: '—' })[c];
  const cur = reg.data?.[0];
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid grid-4">
        <Stat label="HQLA" value={short(L.hqla)} foot={`L1 ${short(L.hqlaL1)} · L2 ${short(L.hqlaL2)}`} />
        <Stat label={p('Чистый отток 30 дней', '30 kunlik sof chiqim', 'Net outflow 30 days')} value={short(L.nco)} foot={`${p('отток', 'chiqim', 'out')} ${short(L.outflows)} · ${p('приток', 'kirim', 'in')} ${short(L.inflows)}`} />
        <Stat label="LCR" value={`${fx(L.lcrPct, 1)}%`} tone={cur && L.lcrPct < cur.lcrMin ? 'alert' : 'accent'} foot={`${p('норматив', 'me’yor', 'minimum')} ${cur?.lcrMin ?? 100}%`} />
        <Stat label={p('Стоимость ликвидности, год', 'Likvidlik qiymati, yil', 'Liquidity cost, annual')} value={short(L.reserveCost + L.lcrCost + L.lpCost)} foot={`${p('ФОР', 'MZF', 'Reserves')} ${short(L.reserveCost)} · LCR ${short(L.lcrCost)} · LP ${short(L.lpCost)}`} />
      </div>
      <Card title={p('Расходы на HQLA, ФОР и ликвидность по направлениям (Liquidity Cost)', 'Yo‘nalishlar bo‘yicha HQLA, MZF va likvidlik xarajatlari', 'HQLA, reserve and liquidity costs by line (Liquidity Cost)')} flush>
        <DataTable
          rows={results.units}
          rowKey={(u) => u.unitId}
          columns={[
            { header: p('Направление', 'Yo‘nalish', 'Business line'), render: (u) => { const x = units.data?.find((q) => q.id === u.unitId); return x ? loc(x.name) : u.unitId; } },
            { header: p('Обязательства', 'Majburiyatlar', 'Liabilities'), align: 'right', render: (u) => short(u.liabilities) },
            { header: p('ФОР + LCR (снижение кредита FTP)', 'MZF + LCR (FTP krediti kamayishi)', 'Reserves + LCR (FTP credit reduction)'), align: 'right', render: (u) => short(u.liquidityCost) },
            { header: p('LP по активам', 'Aktivlar bo‘yicha LP', 'LP on assets'), align: 'right', render: (u) => short(u.lpCharge) },
          ]}
        />
      </Card>
      <div className="bud-split" style={{ padding: 0 }}>
        <Card title={p('Активы HQLA', 'HQLA aktivlari', 'HQLA assets')} flush>
          <DataTable
            rows={hqla.data}
            rowKey={(h) => h.id}
            columns={[
              { header: p('Актив', 'Aktiv', 'Asset'), render: (h) => loc(h.name) },
              { header: p('Уровень', 'Daraja', 'Level'), render: (h) => h.level.toUpperCase() },
              { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (h) => (editable ? <span className="bud-editable" onClick={() => setHEdit({ id: h.id, amount: String(Math.round(h.amount / 1e9)) })}>{short(h.amount)}</span> : short(h.amount)) },
            ]}
          />
        </Card>
        <Card title={p('Надбавка за ликвидность по срокам (LP)', 'Muddatlar bo‘yicha likvidlik ustamasi (LP)', 'Liquidity premium by tenor (LP)')} actions={editable ? <Button size="small" icon="plus" onClick={() => setLpEdit({ label: '', bp: '', months: '', isNew: true })}>{p('Срок', 'Muddat', 'Tenor')}</Button> : undefined} flush>
          <DataTable
            rows={lp.data}
            rowKey={(x) => x.label}
            columns={[
              { header: p('Срок', 'Muddat', 'Tenor'), render: (x) => x.label },
              { header: p('Надбавка, б.п.', 'Ustama, b.p.', 'Premium, bp'), align: 'right', render: (x) => (editable ? <span className="bud-editable" onClick={() => setLpEdit({ label: x.label, bp: String(x.bp) })}>{x.bp}</span> : x.bp) },
            ]}
          />
        </Card>
      </div>
      <Card title={p('Параметры нормативов ЦБ (версии)', 'MB me’yorlari parametrlari (versiyalar)', 'Central bank parameters (versions)')} actions={editable && cur ? <Button size="small" icon="pen" onClick={() => setEdit({ ...cur, validFrom: today(), note: '' })}>{p('Новая версия параметров', 'Parametrlarning yangi versiyasi', 'New parameter version')}</Button> : undefined} flush>
        <DataTable
          rows={reg.data}
          rowKey={(r) => String(r.version)}
          columns={[
            { header: p('Версия', 'Versiya', 'Version'), render: (r) => <b>v{r.version}</b> },
            { header: p('Действует с', 'Amal qiladi', 'Effective from'), render: (r) => formatDate(r.validFrom) },
            { header: p('ФОР UZS / USD, %', 'MZF UZS / USD, %', 'Reserves UZS / USD, %'), render: (r) => `${r.reserve.UZS?.short}/${r.reserve.UZS?.long} · ${r.reserve.USD?.short}/${r.reserve.USD?.long}` },
            { header: p('Оттоки, %', 'Chiqimlar, %', 'Run-off, %'), render: (r) => <span className="small">{LCR_CATS.map((c) => r.runoff[c]).join(' / ')}</span> },
            { header: p('HQLA: дисконты / лимит L2', 'HQLA: diskontlar / L2 limiti', 'HQLA: haircuts / L2 cap'), render: (r) => `${r.haircut.l1}/${r.haircut.l2a}/${r.haircut.l2b} · ${r.l2Cap}%` },
            { header: p('Основание', 'Asos', 'Basis'), render: (r) => <span className="small">{r.note} · {lk.user(r.createdBy)?.fullName}</span> },
          ]}
        />
      </Card>
      {edit && (
        <Modal
          title={p('Новая версия регуляторных параметров', 'Regulyator parametrlarining yangi versiyasi', 'New regulatory parameter version')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { const { version: _v, createdBy: _c, createdAt: _a, ...rest } = edit; void _v; void _c; void _a; await ftpApi.saveRegParams(rest, user); toast(p('Параметры сохранены и применяются с указанной даты', 'Parametrlar saqlandi va ko‘rsatilgan sanadan qo‘llanadi', 'Parameters saved and applied from the date')); setEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={p('Действует с', 'Amal qiladi', 'Effective from')}><Input type="date" value={edit.validFrom} onChange={(e) => setEdit({ ...edit, validFrom: e.target.value })} ariaLabel={p('Действует с', 'Amal qiladi', 'Effective from')} /></Field>
            <Field label={p('Норматив LCR, %', 'LCR me’yori, %', 'LCR minimum, %')}><Input value={String(edit.lcrMin)} inputMode="decimal" onChange={(e) => setEdit({ ...edit, lcrMin: Number(e.target.value.replace(',', '.')) })} ariaLabel="LCR min" /></Field>
            {(['UZS', 'USD', 'EUR'] as FtpCurrency[]).map((c) => (
              <Field key={c} label={`${p('ФОР', 'MZF', 'Reserves')} ${c}: ${p('до 1 года / свыше', '1 yilgacha / ortiq', '<1Y / >1Y')}, %`}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Input value={String(edit.reserve[c]?.short ?? 0)} inputMode="decimal" onChange={(e) => setEdit({ ...edit, reserve: { ...edit.reserve, [c]: { short: Number(e.target.value.replace(',', '.')), long: edit.reserve[c]?.long ?? 0 } } })} ariaLabel={`${c} short`} />
                  <Input value={String(edit.reserve[c]?.long ?? 0)} inputMode="decimal" onChange={(e) => setEdit({ ...edit, reserve: { ...edit.reserve, [c]: { short: edit.reserve[c]?.short ?? 0, long: Number(e.target.value.replace(',', '.')) } } })} ariaLabel={`${c} long`} />
                </div>
              </Field>
            ))}
            {LCR_CATS.map((c) => (
              <Field key={c} label={`${p('Отток', 'Chiqim', 'Run-off')}: ${catLabel(c)}, %`}><Input value={String(edit.runoff[c])} inputMode="decimal" onChange={(e) => setEdit({ ...edit, runoff: { ...edit.runoff, [c]: Number(e.target.value.replace(',', '.')) } })} ariaLabel={c} /></Field>
            ))}
            <Field label={p('Дисконт L2A / L2B, %', 'L2A / L2B diskonti, %', 'Haircut L2A / L2B, %')}>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input value={String(edit.haircut.l2a)} inputMode="decimal" onChange={(e) => setEdit({ ...edit, haircut: { ...edit.haircut, l2a: Number(e.target.value.replace(',', '.')) } })} ariaLabel="l2a" />
                <Input value={String(edit.haircut.l2b)} inputMode="decimal" onChange={(e) => setEdit({ ...edit, haircut: { ...edit.haircut, l2b: Number(e.target.value.replace(',', '.')) } })} ariaLabel="l2b" />
              </div>
            </Field>
            <Field label={p('Доходность HQLA, %', 'HQLA daromadliligi, %', 'HQLA yield, %')}><Input value={String(edit.hqlaYield)} inputMode="decimal" onChange={(e) => setEdit({ ...edit, hqlaYield: Number(e.target.value.replace(',', '.')) })} ariaLabel="hqla yield" /></Field>
            <Field label={p('Основание (документ ЦБ)', 'Asos (MB hujjati)', 'Basis (CB document)')} required className="span-2"><Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} ariaLabel={p('Основание', 'Asos', 'Basis')} /></Field>
          </div>
        </Modal>
      )}
      {lpEdit && (
        <Modal
          title={`LP · ${lpEdit.label || p('новый срок', 'yangi muddat', 'new tenor')}`}
          onClose={() => setLpEdit(null)}
          footer={
            <>
              <Button onClick={() => setLpEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await ftpApi.updateLp(lpEdit.label, Number(lpEdit.bp), user, lpEdit.isNew ? Number((lpEdit.months ?? '').replace(',', '.')) : undefined); toast(p('Надбавка сохранена', 'Ustama saqlandi', 'Premium saved')); setLpEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          {lpEdit.isNew && (
            <div className="form-grid">
              <Field label={p('Обозначение', 'Belgi', 'Label')}><Input value={lpEdit.label} onChange={(e) => setLpEdit({ ...lpEdit, label: e.target.value })} ariaLabel="label" /></Field>
              <Field label={p('Срок, мес.', 'Muddat, oy', 'Tenor, months')}><Input value={lpEdit.months ?? ''} inputMode="decimal" onChange={(e) => setLpEdit({ ...lpEdit, months: e.target.value })} ariaLabel="months" /></Field>
            </div>
          )}
          <Field label={p('Надбавка, б.п.', 'Ustama, b.p.', 'Premium, bp')}><Input value={lpEdit.bp} inputMode="numeric" onChange={(e) => setLpEdit({ ...lpEdit, bp: e.target.value })} ariaLabel="bp" /></Field>
        </Modal>
      )}
      {hEdit && (
        <Modal
          title="HQLA"
          onClose={() => setHEdit(null)}
          footer={
            <>
              <Button onClick={() => setHEdit(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await ftpApi.updateHqla(hEdit.id, Number(hEdit.amount.replace(',', '.')) * 1e9, user); toast(p('Сохранено', 'Saqlandi', 'Saved')); setHEdit(null); } catch (e) { toast(err(e)); } }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <Field label={p('Сумма, млрд сум', 'Summa, mlrd so‘m', 'Amount, bln UZS')}><Input value={hEdit.amount} inputMode="decimal" onChange={(e) => setHEdit({ ...hEdit, amount: e.target.value })} ariaLabel="amount" /></Field>
        </Modal>
      )}
    </div>
  );
}

type RuleDraft = { id?: string; name: string; active: boolean; priority: string; currency: FtpCurrency | ''; branchKey: string; unitId: string; side: FtpSide | ''; tenorFrom: string; tenorTo: string; kind: 'adjust' | 'fixed'; value: string; validFrom: string };
const REGIONS = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12', 'R13', 'R14'];

export function RulesTab() {
  const { loc, lang } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useFtpErr();
  const rules = useApi(() => ftpApi.listRules());
  const units = useApi(() => ftpApi.listUnits());
  const branches = useApi(() => ftpApi.branchReport());
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [q, setQ] = useState<{ currency: FtpCurrency; side: FtpSide; tenor: string; unitId: string; branchKey: string }>({ currency: 'UZS', side: 'asset', tenor: '36', unitId: 'fu2', branchKey: 'R14' });
  const [res, setRes] = useState<FtpRateBreakdown | null>(null);
  const editable = can('ftp', 'edit');
  const short = (v: number) => formatMoneyShort(v, lang);
  const unitName = (id?: string) => { const u = units.data?.find((x) => x.id === id); return u ? loc(u.name) : '—'; };
  const toDraft = (r: FtpRateRule): RuleDraft => ({ id: r.id, name: r.name, active: r.active, priority: String(r.priority), currency: r.currency ?? '', branchKey: r.branchKey ?? '', unitId: r.unitId ?? '', side: r.side ?? '', tenorFrom: r.tenorFrom !== undefined ? String(r.tenorFrom) : '', tenorTo: r.tenorTo !== undefined ? String(r.tenorTo) : '', kind: r.kind, value: String(r.value), validFrom: r.validFrom });
  const opt = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        title={p('Правила применения ставок FTP (валюта, филиал, направление, срок)', 'FTP stavkalarini qo‘llash qoidalari (valyuta, filial, yo‘nalish, muddat)', 'FTP rate application rules (currency, branch, line, tenor)')}
        actions={editable ? <Button size="small" icon="plus" onClick={() => setDraft({ name: '', active: true, priority: '50', currency: '', branchKey: '', unitId: '', side: '', tenorFrom: '', tenorTo: '', kind: 'adjust', value: '', validFrom: today() })}>{p('Правило', 'Qoida', 'Rule')}</Button> : undefined}
        flush
      >
        <DataTable
          rows={rules.data}
          rowKey={(r) => r.id}
          onRowClick={editable ? (r) => setDraft(toDraft(r)) : undefined}
          columns={[
            { header: p('Правило', 'Qoida', 'Rule'), render: (r) => <>{r.name}<div className="sub">{p('приоритет', 'ustuvorlik', 'priority')} {r.priority} · {p('с', 'dan', 'from')} {formatDate(r.validFrom)}</div></> },
            { header: p('Условия', 'Shartlar', 'Conditions'), render: (r) => <span className="small">{[r.currency, r.branchKey, r.unitId && unitName(r.unitId), r.side, (r.tenorFrom !== undefined || r.tenorTo !== undefined) && `${r.tenorFrom ?? 0}–${r.tenorTo ?? '∞'} ${p('мес.', 'oy', 'mo')}`].filter(Boolean).join(' · ') || p('все', 'barchasi', 'all')}</span> },
            { header: p('Действие', 'Amal', 'Action'), align: 'right', render: (r) => (r.kind === 'adjust' ? `${r.value > 0 ? '+' : ''}${r.value} ${p('б.п.', 'b.p.', 'bp')}` : `= ${fx(r.value)}%`) },
            { header: p('Активно', 'Faol', 'Active'), render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? p('Да', 'Ha', 'Yes') : p('Нет', 'Yo‘q', 'No')}</Badge> },
          ]}
        />
      </Card>
      <div className="bud-split" style={{ padding: 0 }}>
        <Card title={p('Определение ставки по критериям', 'Mezonlar bo‘yicha stavkani aniqlash', 'Rate lookup by criteria')}>
          <div className="form-grid">
            <Field label={p('Валюта', 'Valyuta', 'Currency')}><Select<FtpCurrency> value={q.currency} onChange={(v) => setQ({ ...q, currency: v })} options={(['UZS', 'USD', 'EUR'] as FtpCurrency[]).map((c) => ({ value: c, label: c }))} ariaLabel={p('Валюта', 'Valyuta', 'Currency')} /></Field>
            <Field label={p('Сторона', 'Tomon', 'Side')}><Select<FtpSide> value={q.side} onChange={(v) => setQ({ ...q, side: v })} options={[{ value: 'asset', label: p('Актив', 'Aktiv', 'Asset') }, { value: 'liability', label: p('Пассив', 'Passiv', 'Liability') }]} ariaLabel={p('Сторона ставки', 'Stavka tomoni', 'Rate side')} /></Field>
            <Field label={p('Срок, мес.', 'Muddat, oy', 'Tenor, months')}><Input value={q.tenor} inputMode="decimal" onChange={(e) => setQ({ ...q, tenor: e.target.value })} ariaLabel={p('Срок, мес.', 'Muddat, oy', 'Tenor, months')} /></Field>
            <Field label={p('Направление', 'Yo‘nalish', 'Business line')}><Select value={q.unitId} onChange={(v) => setQ({ ...q, unitId: v })} options={(units.data ?? []).map((u) => ({ value: u.id, label: loc(u.name) }))} ariaLabel={p('Направление ставки', 'Stavka yo‘nalishi', 'Rate business line')} /></Field>
            <Field label={p('Филиал', 'Filial', 'Branch')} className="span-2"><Select value={q.branchKey} onChange={(v) => setQ({ ...q, branchKey: v })} placeholder="—" options={REGIONS.map((r) => ({ value: r, label: r }))} ariaLabel={p('Филиал ставки', 'Stavka filiali', 'Rate branch')} /></Field>
          </div>
          <Button type="primary" onClick={async () => setRes(await ftpApi.resolveRate({ currency: q.currency, side: q.side, tenorMonths: Number(q.tenor.replace(',', '.')) || 12, unitId: q.unitId, ...(q.branchKey ? { branchKey: q.branchKey } : {}), ...(q.side === 'liability' ? { lcrCategory: 'retail_less_stable' as const } : {}) }))}>{p('Определить ставку', 'Stavkani aniqlash', 'Resolve rate')}</Button>
          {res && (
            <dl className="kv" style={{ gridTemplateColumns: '1fr auto', marginTop: 10 }}>
              <dt>{res.baseLabel} ({res.methodology}{res.curveVersion ? `, ${p('кривая', 'egri chiziq', 'curve')} v${res.curveVersion}` : ''})</dt>
              <dd className="num">{pct(res.base)}</dd>
              <dt>Liquidity Premium</dt>
              <dd className="num">{signed(res.lp)}</dd>
              <dt>{p('ФОР / LCR', 'MZF / LCR', 'Reserves / LCR')}</dt>
              <dd className="num">{signed(-res.reserveCost)} / {signed(-res.lcrCost)}</dd>
              {res.rules.map((r) => (
                <Fragment key={r.id}><dt>{r.name}</dt><dd className="num">{r.kind === 'adjust' ? `${r.value > 0 ? '+' : ''}${r.value} ${p('б.п.', 'b.p.', 'bp')}` : `= ${fx(r.value)}%`}</dd></Fragment>
              ))}
              <dt><b>{p('Ставка FTP', 'FTP stavkasi', 'FTP rate')}</b></dt>
              <dd className="num"><b>{pct(res.rate)}</b></dd>
            </dl>
          )}
        </Card>
        <Card title={p('Трансфертные доходы и расходы по филиалам', 'Filiallar bo‘yicha transfer daromadlari va xarajatlari', 'Transfer income and expense by branch')} actions={<ExportButton<FtpBranchRow> filename="ftp-branches" rows={branches.data ?? []} columns={[{ header: p('Филиал', 'Filial', 'Branch'), value: (b) => b.branchKey }, { header: p('Активы', 'Aktivlar', 'Assets'), value: (b) => b.assets, format: 'money', total: true }, { header: p('Пассивы', 'Passivlar', 'Liabilities'), value: (b) => b.liabilities, format: 'money', total: true }, { header: p('Расход FTP', 'FTP xarajati', 'FTP expense'), value: (b) => b.ftpExpense, format: 'money', total: true }, { header: p('Доход FTP', 'FTP daromadi', 'FTP income'), value: (b) => b.ftpIncome, format: 'money', total: true }, { header: p('Маржа направлений', 'Yo‘nalishlar marjasi', 'Line margin'), value: (b) => b.clientNii, format: 'money', total: true }]} />} flush>
          {!branches.data ? <Loading /> : (
            <DataTable
              rows={branches.data}
              rowKey={(b) => b.branchKey}
              columns={[
                { header: p('Филиал', 'Filial', 'Branch'), render: (b) => <b>{b.branchKey}</b> },
                { header: p('Ставка по активам / пассивам', 'Aktiv / passiv stavkasi', 'Asset / liability rate'), align: 'right', render: (b) => `${pct(b.avgAssetFtp)} / ${pct(b.avgLiabFtp)}` },
                { header: p('Расход / доход FTP', 'FTP xarajat / daromad', 'FTP expense / income'), align: 'right', render: (b) => `${short(b.ftpExpense)} / ${short(b.ftpIncome)}` },
                { header: p('Маржа', 'Marja', 'Margin'), align: 'right', render: (b) => short(b.clientNii) },
              ]}
            />
          )}
        </Card>
      </div>
      {draft && (
        <Modal
          title={draft.id ? draft.name : p('Новое правило', 'Yangi qoida', 'New rule')}
          onClose={() => setDraft(null)}
          footer={
            <>
              {draft.id && <Button danger onClick={async () => { try { await ftpApi.deleteRule(draft.id!, user); setDraft(null); } catch (e) { toast(err(e)); } }}>{p('Удалить', "O'chirish", 'Delete')}</Button>}
              <Button onClick={() => setDraft(null)}>{p('Отмена', 'Bekor qilish', 'Cancel')}</Button>
              <Button type="primary" onClick={async () => {
                try {
                  await ftpApi.saveRule({ ...(draft.id ? { id: draft.id } : {}), name: draft.name, active: draft.active, priority: Number(draft.priority) || 50, ...(draft.currency ? { currency: draft.currency } : {}), ...(draft.branchKey ? { branchKey: draft.branchKey } : {}), ...(draft.unitId ? { unitId: draft.unitId } : {}), ...(draft.side ? { side: draft.side } : {}), ...(opt(draft.tenorFrom) !== undefined ? { tenorFrom: opt(draft.tenorFrom)! } : {}), ...(opt(draft.tenorTo) !== undefined ? { tenorTo: opt(draft.tenorTo)! } : {}), kind: draft.kind, value: Number(draft.value.replace(',', '.')), validFrom: draft.validFrom }, user);
                  toast(p('Правило сохранено', 'Qoida saqlandi', 'Rule saved'));
                  setDraft(null);
                } catch (e) { toast(err(e)); }
              }}>{p('Сохранить', 'Saqlash', 'Save')}</Button>
            </>
          }
        >
          <div className="form-grid">
            <Field label={p('Название', 'Nomi', 'Name')} className="span-2"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} ariaLabel={p('Название правила', 'Qoida nomi', 'Rule name')} /></Field>
            <Field label={p('Валюта', 'Valyuta', 'Currency')}><Select<FtpCurrency | ''> value={draft.currency} onChange={(v) => setDraft({ ...draft, currency: v })} options={[{ value: '', label: p('любая', 'har qanday', 'any') }, ...(['UZS', 'USD', 'EUR'] as FtpCurrency[]).map((c) => ({ value: c, label: c }))]} ariaLabel="currency" /></Field>
            <Field label={p('Филиал', 'Filial', 'Branch')}><Select value={draft.branchKey} onChange={(v) => setDraft({ ...draft, branchKey: v })} options={[{ value: '', label: p('любой', 'har qanday', 'any') }, ...REGIONS.map((r) => ({ value: r, label: r }))]} ariaLabel="branch" /></Field>
            <Field label={p('Направление', 'Yo‘nalish', 'Business line')}><Select value={draft.unitId} onChange={(v) => setDraft({ ...draft, unitId: v })} options={[{ value: '', label: p('любое', 'har qanday', 'any') }, ...(units.data ?? []).map((u) => ({ value: u.id, label: loc(u.name) }))]} ariaLabel="unit" /></Field>
            <Field label={p('Сторона', 'Tomon', 'Side')}><Select<FtpSide | ''> value={draft.side} onChange={(v) => setDraft({ ...draft, side: v })} options={[{ value: '', label: p('любая', 'har qanday', 'any') }, { value: 'asset', label: p('Актив', 'Aktiv', 'Asset') }, { value: 'liability', label: p('Пассив', 'Passiv', 'Liability') }]} ariaLabel="side" /></Field>
            <Field label={p('Срок от, мес.', 'Muddat dan, oy', 'Tenor from, mo')}><Input value={draft.tenorFrom} inputMode="decimal" onChange={(e) => setDraft({ ...draft, tenorFrom: e.target.value })} ariaLabel="from" /></Field>
            <Field label={p('Срок до, мес.', 'Muddat gacha, oy', 'Tenor to, mo')}><Input value={draft.tenorTo} inputMode="decimal" onChange={(e) => setDraft({ ...draft, tenorTo: e.target.value })} ariaLabel="to" /></Field>
            <Field label={p('Действие', 'Amal', 'Action')}><Select<'adjust' | 'fixed'> value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} options={[{ value: 'adjust', label: p('Корректировка, б.п.', 'Tuzatish, b.p.', 'Adjustment, bp') }, { value: 'fixed', label: p('Фиксированная ставка, %', 'Qat’iy stavka, %', 'Fixed rate, %') }]} ariaLabel="kind" /></Field>
            <Field label={p('Значение', 'Qiymat', 'Value')}><Input value={draft.value} inputMode="decimal" onChange={(e) => setDraft({ ...draft, value: e.target.value })} ariaLabel="value" /></Field>
            <Field label={p('Приоритет', 'Ustuvorlik', 'Priority')}><Input value={draft.priority} inputMode="numeric" onChange={(e) => setDraft({ ...draft, priority: e.target.value })} ariaLabel="priority" /></Field>
            <Field label={p('Действует с', 'Amal qiladi', 'Effective from')}><Input type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} ariaLabel="valid from" /></Field>
            <Field label={p('Активно', 'Faol', 'Active')}><Switch checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} ariaLabel="active" /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function RunsTab() {
  const { lang, loc } = useSession();
  const p = usePick();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useFtpErr();
  const lk = useLookups();
  const runs = useApi(() => ftpApi.listRuns());
  const sched = useApi(() => ftpApi.getSchedule());
  const units = useApi(() => ftpApi.listUnits());
  const [asOf, setAsOf] = useState(today());
  const [open, setOpen] = useState<FtpRun | null>(null);
  const [reason, setReason] = useState('');
  const editable = can('ftp', 'edit');
  const short = (v: number) => formatMoneyShort(v, lang);
  const kindLabel = (k: FtpRun['kind']) => ({ daily: p('Ежедневный', 'Kundalik', 'Daily'), monthly: p('Ежемесячный', 'Oylik', 'Monthly'), adhoc: p('На дату', 'Sanaga', 'As of date') })[k];
  const prev = open?.rerunOf ? runs.data?.find((r) => r.id === open.rerunOf) : undefined;
  return (
    <>
      <FilterBar>
        {sched.data && (
          <>
            <label className="bud-switch"><Switch checked={sched.data.daily} disabled={!editable} onChange={(v) => ftpApi.updateSchedule({ daily: v }, user)} ariaLabel="daily" /> {p('Ежедневно', 'Har kuni', 'Daily')} {sched.data.dailyTime}</label>
            <label className="bud-switch"><Switch checked={sched.data.monthly} disabled={!editable} onChange={(v) => ftpApi.updateSchedule({ monthly: v }, user)} ariaLabel="monthly" /> {p('Ежемесячно (на конец месяца)', 'Har oy (oy oxiriga)', 'Monthly (month-end)')}</label>
          </>
        )}
        <span style={{ flex: 1 }} />
        {editable && (
          <>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} ariaLabel={p('Дата расчёта', 'Hisob sanasi', 'Calculation date')} style={{ width: 160 }} />
            <Button type="primary" size="small" icon="refresh" onClick={async () => { try { const r = await ftpApi.runAsOf(asOf, user); toast(`${r.number}: ${p('расчёт выполнен на', 'hisob bajarildi', 'run completed as of')} ${formatDate(r.asOf)}`); setOpen(r); } catch (e) { toast(err(e)); } }}>{p('Рассчитать на дату', 'Sanaga hisoblash', 'Calculate as of date')}</Button>
          </>
        )}
        <ExportButton<FtpRun> filename="ftp-runs" rows={runs.data ?? []} columns={[{ header: '№', value: (r) => r.number }, { header: p('На дату', 'Sanaga', 'As of'), value: (r) => r.asOf }, { header: p('Тип', 'Turi', 'Type'), value: (r) => kindLabel(r.kind) }, { header: p('Методология', 'Metodologiya', 'Methodology'), value: (r) => `${r.methodologyId} v${r.methodologyVersion}` }, { header: p('ЧПД', 'SFD', 'NII'), value: (r) => r.bank.nii, format: 'money' }, { header: p('Статус', 'Holat', 'Status'), value: (r) => r.status }]} />
      </FilterBar>
      <DataTable
        rows={runs.data}
        loading={runs.loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => { setOpen(r); setReason(''); }}
        columns={[
          { header: '№', render: (r) => <span className="doc-num">{r.number}</span> },
          { header: p('На дату', 'Sanaga', 'As of'), render: (r) => formatDate(r.asOf) },
          { header: p('Тип', 'Turi', 'Type'), render: (r) => kindLabel(r.kind) },
          { header: p('Методология / кривые', 'Metodologiya / egri chiziqlar', 'Methodology / curves'), render: (r) => <span className="small">{r.methodologyId} v{r.methodologyVersion} · {Object.entries(r.curveVersions).map(([c, v]) => `${c} v${v}`).join(', ')}</span> },
          { header: p('ЧПД, год', 'SFD, yil', 'NII, annual'), align: 'right', render: (r) => short(r.bank.nii) },
          { header: p('Запуск', 'Ishga tushirish', 'Run by'), render: (r) => <span className="small">{r.userId === 'system' ? p('Регламент', 'Reglament', 'Schedule') : lk.user(r.userId)?.fullName} · {formatDateTime(r.createdAt)}</span> },
          { header: p('Статус', 'Holat', 'Status'), render: (r) => <Badge tone={r.status === 'current' ? 'ok' : 'muted'}>{r.status === 'current' ? p('Актуальный', 'Dolzarb', 'Current') : p('Заменён (история)', 'Almashtirilgan (tarix)', 'Superseded (history)')}</Badge> },
        ]}
      />
      {open && (
        <Modal
          title={`${open.number} · ${formatDate(open.asOf)}`}
          onClose={() => setOpen(null)}
          footer={
            <>
              {editable && <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={p('Причина перерасчёта', 'Qayta hisoblash sababi', 'Re-run reason')} ariaLabel={p('Причина перерасчёта', 'Qayta hisoblash sababi', 'Re-run reason')} />}
              {editable && <Button type="primary" icon="refresh" onClick={async () => { try { const r = await ftpApi.rerun(open.id, reason, user); toast(`${r.number}: Re-run`); setOpen(r); setReason(''); } catch (e) { toast(err(e)); } }}>Re-run</Button>}
              <Button onClick={() => setOpen(null)}>{p('Закрыть', 'Yopish', 'Close')}</Button>
            </>
          }
        >
          <div className="grid grid-3">
            <Stat label={p('ЧПД банка', 'Bank SFD', 'Bank NII')} value={short(open.bank.nii)} foot={prev ? `${p('было', 'edi', 'was')} ${short(prev.bank.nii)}` : undefined} />
            <Stat label={p('Маржа фондирования', 'Moliyalashtirish marjasi', 'Funding margin')} value={short(open.bank.fundingNii)} foot={prev ? `${p('было', 'edi', 'was')} ${short(prev.bank.fundingNii)}` : undefined} />
            <Stat label="NIM" value={pct(open.bank.nimPct)} />
          </div>
          {open.rerunOf && <div className="muted small">Re-run · {p('предыдущая версия', 'oldingi versiya', 'previous version')}: {prev?.number ?? open.rerunOf}{open.reason ? ` · ${open.reason}` : ''}</div>}
          <DataTable
            rows={open.units}
            rowKey={(u) => u.unitId}
            columns={[
              { header: p('Направление', 'Yo‘nalish', 'Business line'), render: (u) => { const x = units.data?.find((q) => q.id === u.unitId); return x ? loc(x.name) : u.unitId; } },
              { header: p('Доход / расход FTP', 'FTP daromad / xarajat', 'FTP income / expense'), align: 'right', render: (u) => `${short(u.ftpIncome)} / ${short(u.ftpExpense)}` },
              { header: p('ЧПД', 'SFD', 'NII'), align: 'right', render: (u) => short(u.totalNii) },
              ...(prev ? [{ header: 'Δ', align: 'right' as const, render: (u: FtpRun['units'][number]) => short(u.totalNii - (prev.units.find((x) => x.unitId === u.unitId)?.totalNii ?? 0)) }] : []),
            ]}
          />
          {!open.units.length && <Empty text="—" />}
        </Modal>
      )}
    </>
  );
}

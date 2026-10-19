// P2-WMS: общие экранные элементы модулей «Склад», «Основные средства», «Терминалы»:
// выбор МВЗ/оргединицы/сотрудника, блок согласования, подпись E-IMZO, проводки, сверка, штрихкод EAN-13, этикетки.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  approvalsApi, dictionaries, formatDateTime, formatMoney, localize, orgApi, pick, serviceAudit, tk, warehouseApi,
  type ApprovalEntity, type CostCenter, type InboxItem, type OrgUnit, type SignableDoc, type TKey, type WmsModule, type WmsPosting, type WmsReconRow,
} from '@xb/shared';
import { Badge, Button, Card, DataTable, Empty, RouteSteps, Select, StatusBadge, useToast, type Column, type Tone } from '../../components/ui';
import { SignModal } from '../../components/SignModal';
import { QrCode } from '../../components/QrCode';
import { TaskRow } from '../Approvals';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useLocation } from '../../lib/router';
import './wms.css';

/** Строка интерфейса на трёх языках (uzc — транслитерация uz). */
export function useP(): (ru: string, uz: string, en: string) => string {
  const { lang } = useSession();
  return (ru, uz, en) => pick(lang, ru, uz, en);
}

/** Текст ошибки API модуля: код из message (до «:») → ключ словаря `${prefix}${код}`. */
export function useWmsError(prefix: 'warehouse_err_' | 'assets_err_' | 'terminals_err_'): (e: unknown) => string {
  const { t } = useSession();
  return (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.split(':')[0] ?? '';
    const key = tk(prefix, code);
    if (key in dictionaries.ru) return t(key as TKey);
    for (const p of ['warehouse_err_', 'assets_err_', 'terminals_err_']) {
      const k = tk(p, code);
      if (k in dictionaries.ru) return t(k as TKey);
    }
    return msg && msg !== 'validation' ? msg : t('formRequired');
  };
}

/** Параметр из адреса (#/path?x=…). */
export function useQueryParam(name: string): string {
  const path = useLocation();
  return new URLSearchParams(path.split('?')[1] ?? '').get(name) ?? '';
}

/** Оргструктура и МВЗ (кэш на экран). */
export function useOrg() {
  const { lang } = useSession();
  const units = useApi(() => orgApi.listOrgUnits(), []);
  const ccs = useApi(() => orgApi.listCostCenters({ pageSize: 5000 }).then((p) => p.rows), []);
  const u = units.data ?? [];
  const c = ccs.data ?? [];
  const unit = (k?: string) => u.find((x) => x.key === k);
  const cc = (k?: string) => c.find((x) => x.key === k);
  return {
    units: u,
    ccs: c,
    unit,
    cc,
    unitName: (k?: string) => (k ? (unit(k) ? localize(unit(k)!.name, lang) : k) : '—'),
    ccLabel: (k?: string) => (k ? (cc(k) ? `${cc(k)!.code} · ${localize(cc(k)!.name, lang)}` : k) : '—'),
    ccCode: (k?: string) => (k ? (cc(k)?.code ?? k) : '—'),
  };
}

const inUnit = (c: CostCenter, key?: string) => !key || c.orgUnitKey === key || c.orgUnitKey.startsWith(`${key}-`);

export function OrgUnitSelect({ value, onChange, types, placeholder, ariaLabel }: { value: string; onChange: (v: string) => void; types?: OrgUnit['type'][]; placeholder?: string; ariaLabel?: string }) {
  const { lang } = useSession();
  const org = useOrg();
  return (
    <Select
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? '—'}
      ariaLabel={ariaLabel}
      options={org.units.filter((u) => !types || types.includes(u.type)).map((u) => ({ value: u.key, label: `${u.code} · ${localize(u.name, lang)}` }))}
    />
  );
}

/** Выбор МВЗ: только действующие, по умолчанию — в пределах выбранной оргединицы. */
export function CostCenterSelect({ value, onChange, orgUnitKey, ariaLabel }: { value: string; onChange: (v: string) => void; orgUnitKey?: string; ariaLabel?: string }) {
  const { lang } = useSession();
  const org = useOrg();
  const list = org.ccs.filter((c) => c.status === 'active' && inUnit(c, orgUnitKey));
  return <Select value={value} onChange={onChange} placeholder="—" ariaLabel={ariaLabel} options={(list.length ? list : org.ccs.filter((c) => c.status === 'active')).map((c) => ({ value: c.key, label: `${c.code} · ${localize(c.name, lang)}` }))} />;
}

export function UserSelect({ value, onChange, filter, ariaLabel, placeholder }: { value: string; onChange: (v: string) => void; filter?: (u: { id: string; role: string; active?: boolean }) => boolean; ariaLabel?: string; placeholder?: string }) {
  const lk = useLookups();
  const { loc } = useSession();
  return <Select value={value} onChange={onChange} placeholder={placeholder ?? '—'} ariaLabel={ariaLabel} options={lk.users.filter((u) => u.active !== false && (!filter || filter(u))).map((u) => ({ value: u.id, label: `${u.fullName} · ${loc(u.position)}` }))} />;
}

/** Мультивыбор сотрудников (члены комиссии): чипы + выпадающий список. */
export function UsersPicker({ value, onChange, exclude = [], ariaLabel }: { value: string[]; onChange: (v: string[]) => void; exclude?: string[]; ariaLabel?: string }) {
  const lk = useLookups();
  return (
    <div className="wms-row">
      <div className="wms-chips">
        {value.map((id) => (
          <button key={id} type="button" className="chip" onClick={() => onChange(value.filter((x) => x !== id))} title="×">
            {lk.user(id)?.fullName ?? id} ×
          </button>
        ))}
      </div>
      <Select value="" placeholder="+" ariaLabel={ariaLabel} onChange={(v) => v && onChange([...value, v])} options={lk.users.filter((u) => u.active !== false && !value.includes(u.id) && !exclude.includes(u.id)).map((u) => ({ value: u.id, label: u.fullName }))} />
    </div>
  );
}

export function Kv({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <span key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </span>
      ))}
    </dl>
  );
}

/** Маршрут согласования документа и задача текущего пользователя (кнопки «Согласовать / Отклонить / Вернуть»). */
export function ApprovalBlock({ entityId, preview, title }: { entityId: string; preview?: { entity: ApprovalEntity; context?: Record<string, unknown> }; title?: string }) {
  const user = useUser();
  const p = useP();
  const route = useApi(() => approvalsApi.getRoute(entityId), [entityId]);
  const mine = useApi(() => approvalsApi.inbox(user, 'mine').then((list) => list.filter((i: InboxItem) => i.task.entityId === entityId)), [entityId, user.id]);
  const deleg = useApi(() => approvalsApi.inbox(user, 'delegated').then((list) => list.filter((i: InboxItem) => i.task.entityId === entityId)), [entityId, user.id]);
  const items = [...(mine.data ?? []), ...(deleg.data ?? [])];
  return (
    <Card title={title ?? p('Маршрут согласования', 'Kelishuv yo‘nalishi', 'Approval route')}>
      {route.data ? <RouteSteps entityId={entityId} /> : preview ? <RouteSteps preview={preview} /> : <Empty text={p('Документ ещё не отправлен на согласование', 'Hujjat hali kelishuvga yuborilmagan', 'Not submitted for approval yet')} />}
      {items.map((i) => (
        <div key={i.task.id} style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
          <TaskRow task={i.task} item={i} compact />
        </div>
      ))}
    </Card>
  );
}

/** Кнопка «Подписать E-IMZO»: модальное окно подписи → обработчик получает ID подписи. */
export function SignAction({ doc, label, onSigned, disabled, type = 'primary', errPrefix = 'warehouse_err_' }: { doc: SignableDoc; label: string; onSigned: (signatureId: string) => Promise<unknown>; disabled?: boolean; type?: 'primary' | 'default'; errPrefix?: 'warehouse_err_' | 'assets_err_' | 'terminals_err_' }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const err = useWmsError(errPrefix);
  return (
    <>
      <Button type={type} icon="pen" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <SignModal
          doc={doc}
          onClose={() => setOpen(false)}
          onSigned={(rec) => {
            void onSigned(rec.id).catch((e) => toast(err(e)));
          }}
        />
      )}
    </>
  );
}

const POSTING_TONE: Record<string, Tone> = { unsigned: 'warn', sending: 'info', confirmed: 'ok', error: 'danger', queued: 'warn', reversed: 'muted' };

/** Проводки документа/модуля с передачей в iABS: статус, повтор, подпись E-IMZO (если требуется). */
export function PostingsTable({ docId, module, rows: given, title }: { docId?: string; module?: WmsModule | ''; rows?: WmsPosting[]; title?: string }) {
  const { t } = useSession();
  const p = useP();
  const user = useUser();
  const toast = useToast();
  const org = useOrg();
  const err = useWmsError('warehouse_err_');
  const list = useApi(() => (given ? Promise.resolve(given) : warehouseApi.listPostings({ ...(docId ? { docId } : {}), ...(module ? { module } : {}) })), [docId ?? '', module ?? '', given?.length ?? -1]);
  const cols: Column<WmsPosting>[] = [
    { header: '№', render: (r) => <span className="doc-num">{r.number}</span> },
    { header: p('Дата', 'Sana', 'Date'), render: (r) => <span className="muted">{r.date}</span> },
    { header: p('Документ', 'Hujjat', 'Document'), render: (r) => (<>{r.docNumber}<div className="sub">{t(tk('warehouse_mod_', r.module))} · {r.docType}</div></>) },
    {
      header: p('Дт / Кт / МВЗ', 'Dt / Kt / XMM', 'Dr / Cr / CC'),
      render: (r) => (
        <ul className="wms-entries wms-mono">
          {r.entries.map((e, i) => (
            <li key={i} title={e.text}>
              {e.debit} / {e.credit} · {org.ccCode(e.costCenterId)} · {formatMoney(e.amount)}
            </li>
          ))}
        </ul>
      ),
    },
    { header: p('Сумма', 'Summa', 'Amount'), align: 'right', render: (r) => <b>{formatMoney(r.amount)}</b> },
    { header: p('iABS', 'iABS', 'iABS'), render: (r) => (<><StatusBadge prefix="warehouse_pst_" status={r.status} tone={POSTING_TONE[r.status]} />{r.error && <div className="sub" style={{ color: 'var(--danger)' }}>{r.error}</div>}</>) },
    {
      header: '',
      render: (r) =>
        r.status === 'error' || r.status === 'queued' ? (
          <Button size="small" icon="refresh" onClick={() => warehouseApi.retryPosting(r.id, user).then(() => toast(p('Повторная передача выполнена', 'Qayta yuborildi', 'Resent'))).catch((e) => toast(err(e)))}>
            {p('Повторить', 'Takrorlash', 'Retry')}
          </Button>
        ) : r.status === 'unsigned' ? (
          <SignAction doc={{ entity: 'wms_posting', entityId: r.id, title: `${r.number} · ${r.docNumber}`, content: r.entries }} label={p('Подписать', 'Imzolash', 'Sign')} onSigned={(sid) => warehouseApi.signPosting(r.id, sid, user).then(() => toast(p('Проводки подписаны и переданы в iABS', 'Provodkalar imzolandi va iABSga yuborildi', 'Postings signed and sent to iABS')))} />
        ) : null,
    },
  ];
  return (
    <Card title={title ?? p('Бухгалтерские проводки (iABS)', 'Buxgalteriya provodkalari (iABS)', 'Accounting postings (iABS)')} flush>
      <DataTable rows={list.data} loading={list.loading} rowKey={(r) => r.id} columns={cols} emptyText={p('Проводок нет', 'Provodkalar yo‘q', 'No postings')} />
    </Card>
  );
}

/** Сверка учётных данных с балансом iABS по счетам. */
export function ReconTable({ rows, loading }: { rows: WmsReconRow[] | undefined; loading?: boolean }) {
  const { loc } = useSession();
  const p = useP();
  const cols: Column<WmsReconRow>[] = [
    { header: p('Счёт', 'Hisob', 'Account'), render: (r) => (<><span className="wms-mono">{r.account}</span><div className="sub">{loc(r.name)}</div></>) },
    { header: 'XB-ERP', align: 'right', render: (r) => formatMoney(r.erp) },
    { header: 'iABS', align: 'right', render: (r) => formatMoney(r.iabs) },
    { header: p('Расхождение', 'Farq', 'Difference'), align: 'right', render: (r) => (r.diff ? <b style={{ color: 'var(--danger)' }}>{formatMoney(r.diff)}</b> : <Badge tone="ok">0</Badge>) },
  ];
  return <DataTable rows={rows} loading={loading} rowKey={(r) => r.account} columns={cols} />;
}

// ---------- EAN-13 ----------
const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R_CODES = L_CODES.map((c) => c.split('').map((b) => (b === '0' ? '1' : '0')).join(''));
const G_CODES = R_CODES.map((c) => c.split('').reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13Bits(code: string): string | null {
  if (!/^\d{13}$/.test(code)) return null;
  const d = code.split('').map(Number);
  const par = PARITY[d[0]!]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L_CODES : G_CODES)[d[i]!];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R_CODES[d[i]!];
  return bits + '101';
}

export function Ean13({ code, height = 46 }: { code: string; height?: number }) {
  const bits = ean13Bits(code);
  if (!bits) return <span className="wms-mono">{code}</span>;
  const w = bits.length + 18;
  return (
    <svg className="wms-barcode" viewBox={`0 0 ${w} ${height + 12}`} width={w * 2} role="img" aria-label={`EAN-13 ${code}`}>
      <rect width={w} height={height + 12} fill="#fff" />
      {bits.split('').map((b, i) => (b === '1' ? <rect key={i} x={9 + i} y={2} width={1} height={i < 3 || (i >= 45 && i < 50) || i >= 92 ? height + 4 : height} fill="#000" /> : null))}
      <text x={w / 2} y={height + 11} fontSize={8} textAnchor="middle" fontFamily="monospace" fill="#000">
        {code}
      </text>
    </svg>
  );
}

export interface WmsLabel {
  title: string;
  sub: string;
  barcode?: string;
  qr: string;
}

/** Печать этикеток (штрихкод EAN-13 + QR): предпросмотр поверх приложения и печать только листа. */
export function LabelPreview({ labels, onClose, entity }: { labels: WmsLabel[]; onClose: () => void; entity: string }) {
  const { t, user } = useSession();
  useEffect(() => {
    document.body.classList.add('xb-printing');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('xb-printing');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return createPortal(
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label={t('svc_printPreview')}>
      <div className="print-toolbar">
        <b>{t('svc_printPreview')}</b>
        <div className="svc-row">
          <Button
            type="primary"
            icon="printer"
            onClick={() => {
              if (user) serviceAudit({ userId: user.id, action: 'print.document', entity, entityId: labels.map((l) => l.barcode ?? l.qr).join(','), details: `labels · ${labels.length}` });
              window.print();
            }}
          >
            {t('svc_printButton')}
          </Button>
          <Button icon="x" onClick={onClose}>
            {t('svc_printClose')}
          </Button>
        </div>
      </div>
      <div className="print-scroll">
        <div className="print-stage" style={{ overflowX: 'auto' }}>
          <div className="wms-labels" data-testid="wms-labels">
            {labels.map((l, i) => (
              <div key={i} className="wms-label">
                <div>
                  <div className="wms-label-title">{l.title}</div>
                  <div className="wms-label-sub">{l.sub}</div>
                </div>
                <QrCode value={l.qr} size={64} margin={1} />
                {l.barcode && <Ean13 code={l.barcode} height={34} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Формат даты-времени или прочерк. */
export const dt = (s?: string) => (s ? formatDateTime(s) : '—');

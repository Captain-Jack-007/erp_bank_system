// Печатные формы A4: шапка банка, заголовок, номер/дата, поля, таблица, подписи (штамп E-IMZO) и QR проверки.
// Шаблоны: 'card' — карточка документа, 'act' — акт, 'registry' — реестр (таблица, альбомная ориентация).
//   <PrintButton doc={printDoc} template="act" />          — кнопка + предпросмотр + window.print()
//   <PrintView doc={printDoc} template="card" />           — встроенный предпросмотр листа
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { checkSignature, dlpCheck, dlpDenied, formatDate, formatDateTime, serviceAudit, signatureService, tk, verifyPath, type PrintDocument, type SignatureRecord } from '@xb/shared';
import { Button, useToast } from './ui';
import { moduleForPath } from '../lib/access';
import { useLocation } from '../lib/router';
import { QrCode } from './QrCode';
import { useSession } from '../lib/session';

export type PrintTemplate = 'card' | 'act' | 'registry';

/** Абсолютная ссылка на страницу проверки документа (для QR). */
export function verifyUrl(entity: string, entityId: string): string {
  return `${window.location.origin}${window.location.pathname}#${verifyPath(entity, entityId)}`;
}

function Stamp({ sig }: { sig: SignatureRecord }) {
  const { t } = useSession();
  const check = checkSignature(sig);
  return (
    <div className={`print-stamp ${check.status === 'valid' ? '' : 'bad'}`} data-testid="print-stamp">
      <b>{t('svc_stampTitle')}</b>
      E-IMZO · {sig.owner}
      <br />
      {t('svc_sigSerial')}: {sig.certSerial}
      <br />
      {t('svc_sigTime')}: {formatDateTime(sig.signedAt)}
      <br />
      {t(tk('svc_sigStatus_', check.status))}
    </div>
  );
}

function Signers({ doc }: { doc: PrintDocument }) {
  if (!doc.signers?.length) return null;
  return (
    <div className="print-signers">
      {doc.signers.map((s, i) => {
        const sig = s.signatureId ? signatureService.get(s.signatureId) : undefined;
        return (
          <div key={i} className="print-signer">
            <span className="print-signer-role">{s.role}</span>
            {s.position && <span>{s.position}</span>}
            <div className="print-signer-line">
              <span />
              <span>{s.name}</span>
            </div>
            {sig && <Stamp sig={sig} />}
          </div>
        );
      })}
    </div>
  );
}

function Table({ doc }: { doc: PrintDocument }) {
  const tb = doc.table;
  if (!tb) return null;
  const cls = (i: number) => (tb.columns[i]?.align === 'right' ? 'r' : tb.columns[i]?.align === 'center' ? 'c' : undefined);
  return (
    <table className="print-table">
      <thead>
        <tr>
          {tb.columns.map((c, i) => (
            <th key={i} style={c.width ? { width: c.width } : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tb.rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((v, i) => (
              <td key={i} className={cls(i)}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {tb.totals && (
        <tfoot>
          <tr>
            {tb.totals.map((v, i) => (
              <td key={i} className={cls(i)}>
                {v}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Лист A4 с выбранным шаблоном. */
export function PrintSheet({ doc, template }: { doc: PrintDocument; template: PrintTemplate }) {
  const { t, user } = useSession();
  const landscape = template === 'registry' && doc.landscape !== false;
  const url = verifyUrl(doc.entity, doc.entityId);
  const numberLine = [doc.number ? `${t('svc_printNo')} ${doc.number}` : '', doc.date ? `${t('svc_printFrom')} ${formatDate(doc.date)}` : ''].filter(Boolean).join(' ');
  return (
    <article className={`print-sheet ${landscape ? 'landscape' : ''}`} data-template={template} data-testid="print-sheet">
      <header className="print-head">
        <div className="print-brand">
          <div className="print-mark">XB</div>
          <div>
            <div className="print-bank">{t('svc_printBankFull')}</div>
            <div className="print-bank-sub">{t('svc_printBankLine')}</div>
          </div>
        </div>
        <div className="print-docno">
          {doc.number && <div>{numberLine}</div>}
          <div>ID: {doc.entityId}</div>
        </div>
      </header>

      <div className="print-title">{doc.title}</div>
      {template !== 'card' && numberLine && <div className="print-subtitle">{numberLine}</div>}
      {template === 'act' && (doc.place || doc.date) && (
        <div className="print-place">
          <span>{doc.place ?? ''}</span>
          <span>{doc.date ? formatDate(doc.date) : ''}</span>
        </div>
      )}

      {doc.fields && doc.fields.length > 0 && (
        <table className="print-fields">
          <tbody>
            {doc.fields.map((f, i) => (
              <tr key={i}>
                <td>{f.label}</td>
                <td>{f.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {doc.paragraphs?.map((p, i) => (
        <p key={i} className="print-p">
          {p}
        </p>
      ))}
      <Table doc={doc} />
      <Signers doc={doc} />

      <footer className="print-foot">
        <div>
          {t('svc_printPage')} · {formatDateTime(new Date().toISOString())}
          {user ? ` · ${user.fullName}` : ''}
        </div>
        <div className="print-qr">
          <div className="print-qr-text">{t('svc_printQrHint')}</div>
          <QrCode value={url} size={84} margin={2} title={url} />
        </div>
      </footer>
    </article>
  );
}

/** Масштабирование листа под ширину контейнера (A4 = 794 px; на телефоне — уменьшаем). */
function Scaled({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const update = () => {
      if (!outer.current || !inner.current) return;
      const w = inner.current.scrollWidth;
      const s = Math.min(1, (outer.current.clientWidth - 8) / w);
      setScale(s);
      setH(inner.current.scrollHeight * s);
    };
    update();
    const ro = new ResizeObserver(update);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="print-stage" ref={outer} style={{ height: h }}>
      <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
        {children}
      </div>
    </div>
  );
}

/** Встроенный предпросмотр листа на странице. */
export function PrintView({ doc, template }: { doc: PrintDocument; template: PrintTemplate }) {
  return (
    <div className="print-inline">
      <Scaled>
        <PrintSheet doc={doc} template={template} />
      </Scaled>
    </div>
  );
}

/** Модальный предпросмотр поверх приложения; «Печать» печатает только лист (body.xb-printing). */
export function PrintPreview({ doc, template, onClose }: { doc: PrintDocument; template: PrintTemplate; onClose: () => void }) {
  const { t, user } = useSession();
  const landscape = template === 'registry' && doc.landscape !== false;
  useEffect(() => {
    // Альбомная ориентация для реестров: @page задаётся на время предпросмотра.
    const style = document.createElement('style');
    style.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 14mm 12mm; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [landscape]);
  useEffect(() => {
    document.body.classList.add('xb-printing');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('xb-printing');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const print = () => {
    if (user) serviceAudit({ userId: user.id, action: 'print.document', entity: doc.entity, entityId: doc.entityId, details: `${template} · ${doc.number ?? doc.title}` });
    window.print();
  };
  return createPortal(
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label={t('svc_printPreview')}>
      <div className="print-toolbar">
        <b>{t('svc_printPreview')}</b>
        <div className="svc-row">
          <Button type="primary" icon="printer" onClick={print}>
            {t('svc_printButton')}
          </Button>
          <Button icon="x" onClick={onClose}>
            {t('svc_printClose')}
          </Button>
        </div>
      </div>
      <div className="print-scroll">
        <Scaled>
          <PrintSheet doc={doc} template={template} />
        </Scaled>
      </div>
    </div>,
    document.body,
  );
}

/** Кнопка «Печать» с предпросмотром. */
export function PrintButton({ doc, template = 'card', size = 'small', label }: { doc: PrintDocument | (() => PrintDocument); template?: PrintTemplate; size?: 'small' | 'middle'; label?: string }) {
  const { t, user } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState<PrintDocument | null>(null);
  const moduleId = moduleForPath(useLocation())?.id;
  return (
    <>
      <Button
        size={size}
        icon="printer"
        onClick={() => {
          // P3-GEN (PR-SEC-072): DLP — печать по категории данных и уровню доступа
          const d = dlpCheck(user, moduleId, 'print');
          if (!d.allowed) {
            dlpDenied(moduleId, 'print', typeof doc === 'function' ? 'print' : doc.title);
            toast(`${t('dlp_denied')} (${t(`dlp_cat_${d.category}` as never)})`);
            return;
          }
          setOpen(typeof doc === 'function' ? doc() : doc);
        }}
      >
        {label ?? t('svc_print')}
      </Button>
      {open && <PrintPreview doc={open} template={template} onClose={() => setOpen(null)} />}
    </>
  );
}

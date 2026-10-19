// Печатные формы: три шаблона на живых данных договоров (карточка, акт, реестр), подпись E-IMZO,
// вложения к документу и страница проверки по QR (/verify/:entity/:id).
import { useEffect, useMemo, useState } from 'react';
import {
  api, directory, formatDate, formatMoney, signatureService, tk,
  type Contract, type Counterparty, type PrintDocument, type SignableDoc,
} from '@xb/shared';
import { Button, Card, Empty, Loading, PageHeader, Tabs } from '../../components/ui';
import { PrintPreview, PrintView, type PrintTemplate } from '../../components/PrintView';
import { SignaturesPanel, SignatureItem } from '../../components/SignModal';
import { Attachments } from '../../components/Attachments';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import type { ModuleRoute } from '../../lib/routes';

const VAT = 0.12;

/** Строки демо-акта: доли суммы договора (детерминированно). */
function actLines(c: Contract) {
  const base = Math.round(c.amount / 1.12 / 1000) * 1000;
  const a = Math.round((base * 0.5) / 1000) * 1000;
  const b = Math.round((base * 0.3) / 1000) * 1000;
  return [
    { key: 'svc_demoLine1', qty: 1, price: a },
    { key: 'svc_demoLine2', qty: 2, price: Math.round(b / 2) },
    { key: 'svc_demoLine3', qty: 1, price: base - a - Math.round(b / 2) * 2 },
  ] as const;
}

/** Каноническое содержимое акта (не зависит от языка интерфейса — хэш подписи стабилен). */
export function actContent(c: Contract, cp?: Counterparty) {
  const lines = actLines(c).map((l) => ({ item: l.key, qty: l.qty, price: l.price }));
  const net = lines.reduce((s, l) => s + l.qty * l.price, 0);
  return { type: 'act', number: `${c.number}-A1`, date: c.startDate.slice(0, 10), contract: c.number, contractorTin: cp?.tin ?? '', lines, net, vat: Math.round(net * VAT), total: net + Math.round(net * VAT) };
}

let seeded = false;
function seedDemo(c: Contract, cp?: Counterparty) {
  if (seeded) return;
  seeded = true;
  const doc: SignableDoc = { entity: 'act', entityId: `${c.id}-A1`, title: `${c.number}-A1`, content: actContent(c, cp) };
  const legal = directory.users().find((u) => u.role === 'legal');
  // Подпись прошлогодним (ныне истёкшим) сертификатом — пример статуса «Сертификат истёк».
  if (legal) signatureService.seed(doc, legal, '2025-06-10T10:00:00Z', 1);
}

function PrintFormsPage() {
  const { t, loc } = useSession();
  const contracts = useApi(() => api.listContracts(), []);
  const cps = useApi(() => api.listCounterparties(), []);
  const deps = useApi(() => api.listDepartments(), []);
  const [tab, setTab] = useState<PrintTemplate>('act');
  const [preview, setPreview] = useState(false);
  const c = contracts.data?.find((x) => x.status === 'active') ?? contracts.data?.[0];
  const cp = c ? cps.data?.find((x) => x.id === c.counterpartyId) : undefined;
  const actDoc: SignableDoc | null = c ? { entity: 'act', entityId: `${c.id}-A1`, title: `${t('svc_demoActTitle')} ${c.number}-A1`, content: actContent(c, cp) } : null;
  useEffect(() => {
    if (c && cps.data) seedDemo(c, cp);
  }, [c, cp, cps.data]);
  const sigs = useApi(() => (actDoc ? signatureService.list(actDoc.entity, actDoc.entityId) : Promise.resolve([])), [actDoc?.entityId]);

  const doc: PrintDocument | null = useMemo(() => {
    if (!c || !contracts.data) return null;
    const cpName = (id: string) => cps.data?.find((x) => x.id === id)?.name ?? id;
    const depName = (id: string) => {
      const d = deps.data?.find((x) => x.id === id);
      return d ? loc(d.name) : id;
    };
    if (tab === 'card')
      return {
        entity: 'contract',
        entityId: c.id,
        title: t('svc_demoCard'),
        number: c.number,
        date: c.startDate.slice(0, 10),
        fields: [
          { label: t('svc_demoContract'), value: c.number },
          { label: t('svc_demoSubject'), value: c.subject },
          { label: t('counterparty'), value: `${cp?.name ?? '—'} (${t('svc_demoTin')} ${cp?.tin ?? '—'})` },
          { label: t('department'), value: depName(c.departmentId) },
          { label: t('amount'), value: formatMoney(c.amount, c.currency) },
          { label: t('svc_demoPeriod'), value: `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` },
          { label: t('status'), value: t(tk('cstatus_', c.status)) },
        ],
        table: {
          columns: [{ header: '№', align: 'center', width: '8%' }, { header: t('svc_demoDue') }, { header: t('amount'), align: 'right' }, { header: t('svc_demoPaid'), align: 'center' }],
          rows: c.payments.map((p, i) => [String(i + 1), formatDate(p.dueDate), formatMoney(p.amount, c.currency), p.paid ? t('svc_yes') : t('svc_no')]),
          totals: ['', t('svc_total'), formatMoney(c.payments.reduce((s, p) => s + p.amount, 0), c.currency), ''],
        },
        signers: [
          { role: t('svc_demoAgreed'), name: directory.users().find((u) => u.role === 'legal')?.fullName ?? '' , position: t('role_legal') },
          { role: t('svc_demoAgreed'), name: directory.users().find((u) => u.role === 'finance')?.fullName ?? '', position: t('role_finance') },
        ],
      };
    if (tab === 'act') {
      const content = actContent(c, cp);
      const last = sigs.data?.[sigs.data.length - 1];
      return {
        entity: 'act',
        entityId: `${c.id}-A1`,
        title: t('svc_demoActTitle'),
        number: content.number,
        date: content.date,
        place: t('svc_demoPlace'),
        fields: [
          { label: t('svc_demoContract'), value: `${c.number} — ${c.subject}` },
          { label: t('svc_demoContractor'), value: `${cp?.name ?? '—'} (${t('svc_demoTin')} ${cp?.tin ?? '—'})` },
          { label: t('svc_demoCustomer'), value: t('svc_printBankFull') },
        ],
        paragraphs: [t('svc_demoActText')],
        table: {
          columns: [{ header: '№', align: 'center', width: '6%' }, { header: t('svc_demoWork') }, { header: t('svc_demoUnit'), align: 'center' }, { header: t('svc_demoQty'), align: 'right' }, { header: t('svc_demoPrice'), align: 'right' }, { header: t('amount'), align: 'right' }],
          rows: [
            ...content.lines.map((l, i) => [String(i + 1), t(l.item as 'svc_demoLine1'), t('svc_demoUnitSvc'), String(l.qty), formatMoney(l.price), formatMoney(l.qty * l.price)]),
            ['', t('svc_demoVat'), '', '', '', formatMoney(content.vat)],
          ],
          totals: ['', t('svc_demoTotalVat'), '', '', '', formatMoney(content.total)],
        },
        signers: [
          { role: t('svc_demoContractor'), name: cp?.name ?? '', position: t('svc_demoDirector') },
          { role: t('svc_demoCustomer'), name: last?.owner ?? directory.users().find((u) => u.role === 'dept_head')?.fullName ?? '', position: t('svc_demoHead'), ...(last ? { signatureId: last.id } : {}) },
        ],
      };
    }
    const list = contracts.data;
    return {
      entity: 'registry',
      entityId: 'contracts',
      title: t('svc_demoRegistry'),
      date: new Date().toISOString().slice(0, 10),
      landscape: true,
      table: {
        columns: [{ header: '№', align: 'center', width: '4%' }, { header: t('svc_demoContract') }, { header: t('svc_demoSubject') }, { header: t('counterparty') }, { header: t('svc_demoPeriod') }, { header: t('status') }, { header: t('amount'), align: 'right' }],
        rows: list.map((x, i) => [String(i + 1), x.number, x.subject, cpName(x.counterpartyId), `${formatDate(x.startDate)} – ${formatDate(x.endDate)}`, t(tk('cstatus_', x.status)), formatMoney(x.amount, x.currency)]),
        totals: ['', t('svc_total'), '', '', '', String(list.length), formatMoney(list.filter((x) => x.currency === 'UZS').reduce((s, x) => s + x.amount, 0))],
      },
    };
  }, [c, cp, contracts.data, cps.data, deps.data, tab, t, loc, sigs.data]);

  return (
    <>
      <PageHeader
        title={t('svc_printTemplates')}
        subtitle={t('svc_printTemplatesSub')}
        actions={
          <Button type="primary" icon="printer" disabled={!doc} onClick={() => setPreview(true)}>
            {t('svc_printPreview')}
          </Button>
        }
      />
      <Tabs<PrintTemplate>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'card', label: t('svc_tplCard') },
          { value: 'act', label: t('svc_tplAct') },
          { value: 'registry', label: t('svc_tplRegistry') },
        ]}
      />
      <div className="grid grid-main">
        <div>{!doc ? <Loading /> : <PrintView doc={doc} template={tab} />}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {actDoc && <SignaturesPanel doc={actDoc} />}
          {actDoc && <Attachments entity={actDoc.entity} entityId={actDoc.entityId} />}
        </div>
      </div>
      {preview && doc && <PrintPreview doc={doc} template={tab} onClose={() => setPreview(false)} />}
    </>
  );
}

function VerifyPage({ entity, id }: { entity: string; id: string }) {
  const { t } = useSession();
  const sigs = useApi(() => signatureService.list(entity, id), [entity, id]);
  return (
    <>
      <PageHeader title={t('svc_verifyTitle')} subtitle={`${t('svc_verifyDoc')}: ${sigs.data?.[0]?.docTitle ?? `${entity} / ${id}`}`} />
      <Card title={t('svc_signatures')}>
        {sigs.loading && !sigs.data ? (
          <Loading />
        ) : !sigs.data?.length ? (
          <Empty text={t('svc_verifyNotFound')} icon="shield" />
        ) : (
          <div className="svc-sig-list">
            {sigs.data.map((s) => (
              <SignatureItem key={s.id} record={s} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export const routes: ModuleRoute[] = [
  { path: '/print-forms', render: () => <PrintFormsPage /> },
  { path: '/verify/:entity/:id', render: (p) => <VerifyPage entity={p.entity!} id={p.id!} /> },
];

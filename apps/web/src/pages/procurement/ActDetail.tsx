// Акт выполненных работ / оказанных услуг (PR-PROC-070…082): форма, описание, объём и стоимость, период,
// проверка соответствия договору, согласование (маршрут work_act) и подпись E-IMZO, ЭСФ, МВЗ из заявки,
// двустороннее подписание через Didox, оценка качества, недостатки и акт об их устранении.
import { useMemo, useState } from 'react';
import {
  api, contractsApi, formatDate, formatMoney, procApi, tk,
  type Contract, type PrintDocument, type ProcWorkAct, type WorkActLine,
} from '@xb/shared';
import { Button, Card, DataTable, Empty, Field, Input, Loading, Modal, PageHeader, RouteSteps, Select, Textarea, Timeline, useToast } from '../../components/ui';
import { Attachments } from '../../components/Attachments';
import { PrintButton } from '../../components/PrintView';
import { SignModal, SignaturesPanel } from '../../components/SignModal';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { Kv, ToneBadge, plusDays, todayIso, useCostCenters, useErr, useIsBuyer } from './shared';
import { PostingsCard } from './PostingsCard';
import { ClaimModal } from './AcceptanceDetail';

const emptyLine = (): WorkActLine => ({ description: '', unit: 'усл', qty: 1, unitPrice: 0 });

export function ActFormModal({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useErr();
  const invoices = useApi(() => contractsApi.contractInvoices(contract.id), [contract.id]);
  const [periodFrom, setFrom] = useState(contract.startDate.slice(0, 10) > todayIso() ? contract.startDate.slice(0, 10) : todayIso().slice(0, 8) + '01');
  const [periodTo, setTo] = useState(todayIso() < contract.endDate.slice(0, 10) ? todayIso() : contract.endDate.slice(0, 10));
  const [description, setDescription] = useState(contract.subject);
  const [lines, setLines] = useState<WorkActLine[]>([emptyLine()]);
  const [vatRate, setVat] = useState(12);
  const [einvoiceId, setEinvoiceId] = useState('');
  const [error, setError] = useState('');
  const check = procApi.actCheck({ id: '', contractId: contract.id, lines, vatRate, periodFrom, periodTo });
  const set = (i: number, patch: Partial<WorkActLine>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async (submit: boolean) => {
    try {
      const a = await procApi.createAct({ contractId: contract.id, periodFrom, periodTo, description, lines, vatRate, ...(einvoiceId ? { einvoiceId } : {}), submit }, user);
      toast(`${a.number}: ${submit ? t('hist_submitted') : t('proc_act_draft')}`);
      onClose();
      navigate(`/procurement/acts/${a.id}`);
    } catch (e) {
      setError(err(e));
    }
  };
  return (
    <Modal
      title={`${t('proc_newAct')}: ${contract.number}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={() => save(false)}>{t('saveDraft')}</Button>
          <Button type="primary" onClick={() => save(true)}>{t('submitForApproval')}</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('proc_periodFrom')} required>
          <Input type="date" value={periodFrom} onChange={(e) => setFrom(e.target.value)} ariaLabel={t('proc_periodFrom')} />
        </Field>
        <Field label={t('proc_periodTo')} required>
          <Input type="date" value={periodTo} onChange={(e) => setTo(e.target.value)} ariaLabel={t('proc_periodTo')} />
        </Field>
        <Field label={t('proc_actDescription')} required className="span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} ariaLabel={t('proc_actDescription')} />
        </Field>
        <Field label={t('proc_vat')}>
          <Select<string> value={String(vatRate)} onChange={(v) => setVat(Number(v))} options={[{ value: '12', label: '12%' }, { value: '0', label: t('proc_noVat') }]} ariaLabel={t('proc_vat')} />
        </Field>
        <Field label={t('proc_einvoice')}>
          <Select<string> value={einvoiceId} onChange={setEinvoiceId} placeholder="—" options={(invoices.data ?? []).filter((i) => i.direction === 'incoming').map((i) => ({ value: i.id, label: `${i.number} · ${formatDate(i.date)}` }))} ariaLabel={t('proc_einvoice')} />
        </Field>
      </div>
      <div className="table-wrap">
        <table className="table pc-mini-table">
          <thead>
            <tr>
              <th>{t('proc_workDescription')}</th>
              <th>{t('unit')}</th>
              <th>{t('qty')}</th>
              <th>{t('unitPrice')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} ariaLabel={t('proc_workDescription')} /></td>
                <td><Input value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} ariaLabel={t('unit')} style={{ width: 70 }} /></td>
                <td><Input type="number" value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} ariaLabel={t('qty')} style={{ width: 70 }} /></td>
                <td><Input type="number" value={l.unitPrice || ''} onChange={(e) => set(i, { unitPrice: Number(e.target.value) })} ariaLabel={t('unitPrice')} style={{ width: 130 }} /></td>
                <td><Button size="small" type="text" icon="trash" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} title={t('proc_removeItem')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="small" icon="plus" onClick={() => setLines((l) => [...l, emptyLine()])}>{t('addItem')}</Button>
      <div className={check.withinAmount && check.withinPeriod ? 'pc-note' : 'pc-danger'}>
        {t('proc_actTotal')}: <b>{formatMoney(check.amount)}</b> · {t('proc_contractRemaining')}: {formatMoney(check.remaining)}
        {!check.withinAmount && <> · {t('proc_err_act_amount')}</>}
        {!check.withinPeriod && <> · {t('proc_err_act_period')}</>}
      </div>
      {error && <span className="error-text">{error}</span>}
    </Modal>
  );
}

export function actContentOf(a: ProcWorkAct) {
  return { type: 'work_act', number: a.number, contract: a.contractId, period: [a.periodFrom, a.periodTo], description: a.description, lines: a.lines, vat: a.vatRate };
}

export function ActDetailPage({ id }: { id: string }) {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const cc = useCostCenters();
  const act = useApi(() => procApi.getAct(id), [id]);
  const contract = useApi(async () => (act.data ? api.getContract(act.data.contractId) : undefined), [act.data?.contractId]);
  const [modal, setModal] = useState<'sign' | 'rate' | 'defect' | 'claim' | null>(null);
  const [score, setScore] = useState('5');
  const [comment, setComment] = useState('');
  const [due, setDue] = useState(plusDays(14));
  const [busy, setBusy] = useState(false);
  const isBuyer = useIsBuyer();
  const a = act.data;
  const content = useMemo(() => (a ? actContentOf(a) : null), [a]);
  if (act.loading && !a) return <Card><Loading /></Card>;
  if (!a || !content) return <Card><Empty text={t('empty')} /></Card>;
  const c = contract.data;
  const totals = procApi.actTotals(a);
  const check = procApi.actCheck(a);
  // закупки, договорной отдел/бухгалтерия или подразделение-заказчик договора; претензии — закупки/договоры
  const customer = !!c && can('procurement', 'edit') && (user.departmentId === c.departmentId || !!c.initiatorDeptIds?.includes(user.departmentId));
  const editor = isBuyer || can('contracts', 'edit') || customer;
  const claimer = isBuyer || can('contracts', 'edit');
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      setModal(null);
      setComment('');
    } catch (e) {
      toast(`${t('actionFailed')}: ${err(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const printDoc = (): PrintDocument => ({
    entity: 'work_act',
    entityId: a.id,
    title: t('proc_actPrintTitle'),
    number: a.number,
    date: a.createdAt.slice(0, 10),
    place: t('svc_demoPlace'),
    fields: [
      { label: t('navContracts'), value: c ? `${c.number} — ${c.subject}` : a.contractId },
      { label: t('proc_contractor'), value: c ? lk.counterparty(c.counterpartyId)?.name ?? '' : '' },
      { label: t('period'), value: `${formatDate(a.periodFrom)} — ${formatDate(a.periodTo)}` },
      { label: t('proc_costCenter'), value: cc.label(a.costCenterKey) },
    ],
    paragraphs: [a.description],
    table: {
      columns: [{ header: '№', align: 'center', width: '6%' }, { header: t('proc_workDescription') }, { header: t('unit'), align: 'center' }, { header: t('qty'), align: 'right' }, { header: t('unitPrice'), align: 'right' }, { header: t('amount'), align: 'right' }],
      rows: [...a.lines.map((l, i) => [String(i + 1), l.description, l.unit, String(l.qty), formatMoney(l.unitPrice), formatMoney(l.qty * l.unitPrice)]), ['', `${t('proc_vat')} ${a.vatRate}%`, '', '', '', formatMoney(totals.vat)]],
      totals: ['', t('total'), '', '', '', formatMoney(totals.total)],
    },
    signers: [
      { role: t('proc_contractor'), name: a.contractorSigned ? `${a.contractorSigned.name} (Didox ${a.contractorSigned.extId})` : c ? lk.counterparty(c.counterpartyId)?.name ?? '' : '' },
      { role: t('proc_customer'), name: lk.user(a.createdBy)?.fullName ?? '', ...(a.customerSignatureId ? { signatureId: a.customerSignatureId } : {}) },
    ],
  });
  const fixDoc = (d: ProcWorkAct['defects'][number]): PrintDocument => ({
    entity: 'work_act_fix', entityId: `${a.id}-${d.id}`, title: t('proc_fixActTitle'), number: d.fixActNumber ?? '', date: (d.fixedAt ?? a.createdAt).slice(0, 10), place: t('svc_demoPlace'),
    fields: [{ label: t('proc_actPrintTitle'), value: a.number }, { label: t('proc_defect'), value: d.description }, { label: t('deadline'), value: formatDate(d.dueDate) }, { label: t('proc_fixedAt'), value: d.fixedAt ? formatDate(d.fixedAt) : '—' }],
    signers: [{ role: t('proc_contractor'), name: c ? lk.counterparty(c.counterpartyId)?.name ?? '' : '' }, { role: t('proc_customer'), name: user.fullName }],
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('navProcurement'), to: '/procurement?tab=acceptance' }, { label: a.number }]}
        title={`${t('proc_newAct')} ${a.number}`}
        subtitle={c ? `${c.number} · ${lk.counterparty(c.counterpartyId)?.name ?? ''}` : a.contractId}
        actions={
          <>
            <ToneBadge status={a.status} label={t(tk('proc_act_', a.status))} />
            <PrintButton doc={printDoc} template="act" />
            {a.status === 'draft' && a.createdBy === user.id && <Button type="primary" disabled={busy} onClick={() => run(() => procApi.submitAct(a.id, user), t('hist_submitted'))}>{t('submitForApproval')}</Button>}
            {a.status === 'approved' && editor && <Button type="primary" icon="pen" onClick={() => setModal('sign')}>{t('proc_signCustomer')}</Button>}
            {a.status === 'signed' && editor && <Button type="primary" disabled={busy} onClick={() => run(() => procApi.sendActToContractor(a.id, user), t('proc_actSent'))}>{t('proc_sendContractor')}</Button>}
            {a.status === 'sent' && editor && <Button disabled={busy} icon="refresh" onClick={() => run(() => procApi.syncActStatus(a.id, user), t('proc_actCompleted'))}>{t('proc_syncContractor')}</Button>}
            {['signed', 'sent', 'completed'].includes(a.status) && editor && <Button onClick={() => setModal('rate')}>{t('proc_rateQuality')}</Button>}
            {editor && a.status !== 'draft' && <Button onClick={() => setModal('defect')}>{t('proc_addDefect')}</Button>}
            {claimer && c && <Button onClick={() => setModal('claim')}>{t('proc_newClaim')}</Button>}
          </>
        }
      />
      <div className="grid grid-main">
        <div className="pc-stack">
          <Card title={t('details')}>
            <Kv
              items={[
                [t('navContracts'), c ? <Link to={`/contracts/${c.id}`}>{c.number}</Link> : a.contractId],
                [t('period'), `${formatDate(a.periodFrom)} — ${formatDate(a.periodTo)}`],
                [t('proc_actDescription'), a.description],
                [t('proc_costCenter'), cc.label(a.costCenterKey)],
                [t('proc_einvoice'), a.einvoiceId ? <Link to={`/einvoices/${a.einvoiceId}`}>{a.einvoiceId}</Link> : '—'],
                [t('proc_contractorSign'), a.contractorSigned ? `${a.contractorSigned.name} · ${formatDate(a.contractorSigned.at)} · ${a.contractorSigned.extId}` : '—'],
                [t('proc_quality'), a.quality ? `${a.quality.score}/5 — ${a.quality.comment}` : '—'],
              ]}
            />
          </Card>
          <Card title={t('proc_works')} flush>
            <DataTable
              rows={a.lines}
              rowKey={(l) => l.description}
              columns={[
                { header: t('proc_workDescription'), render: (l) => l.description },
                { header: t('qty'), align: 'right', render: (l) => `${l.qty} ${l.unit}` },
                { header: t('unitPrice'), align: 'right', render: (l) => formatMoney(l.unitPrice) },
                { header: t('amount'), align: 'right', render: (l) => formatMoney(l.qty * l.unitPrice) },
              ]}
            />
            <div className="pc-pad" style={{ textAlign: 'right' }}>
              {t('proc_net')}: <b className="num">{formatMoney(totals.net)}</b> · {t('proc_vat')}: <b className="num">{formatMoney(totals.vat)}</b> · {t('total')}: <b className="num">{formatMoney(totals.total)}</b>
            </div>
          </Card>
          <Card title={t('proc_contractCheck')}>
            <div className={check.withinAmount && check.withinPeriod ? 'pc-note' : 'pc-danger'}>
              {t('proc_contractAmount')}: {formatMoney(check.contractAmount)} · {t('proc_previousActs')}: {formatMoney(check.previous)} · {t('proc_contractRemaining')}: {formatMoney(check.remaining)} · {check.withinPeriod ? t('proc_periodOk') : t('proc_err_act_period')}
            </div>
          </Card>
          <Card title={t('proc_defects')}>
            {!a.defects.length ? <p className="muted" style={{ margin: 0 }}>{t('proc_noDefects')}</p> : (
              <DataTable
                rows={a.defects}
                rowKey={(d) => d.id}
                columns={[
                  { header: t('proc_defect'), render: (d) => d.description },
                  { header: t('deadline'), render: (d) => formatDate(d.dueDate) },
                  { header: t('status'), render: (d) => <ToneBadge status={d.status === 'fixed' ? 'done' : 'open'} label={t(tk('proc_df_', d.status))} /> },
                  { header: '', render: (d) => (d.status === 'open' ? (editor ? <Button size="small" onClick={() => run(() => procApi.fixDefect(a.id, d.id, user), t('proc_defectFixed'))}>{t('proc_fixDefect')}</Button> : null) : <PrintButton doc={() => fixDoc(d)} template="act" label={d.fixActNumber ?? ''} />) },
                ]}
              />
            )}
          </Card>
          <PostingsCard docId={a.id} />
        </div>
        <div className="pc-stack">
          <Card title={t('route')}>
            <RouteSteps entityId={a.id} />
          </Card>
          <SignaturesPanel doc={{ entity: 'work_act', entityId: a.id, title: `${t('proc_newAct')} ${a.number}`, content }} canSign={false} />
          <Attachments entity="work_act" entityId={a.id} />
          <Card title={t('history')}>
            <Timeline events={a.history} />
          </Card>
        </div>
      </div>
      {modal === 'sign' && <SignModal doc={{ entity: 'work_act', entityId: a.id, title: `${t('proc_actPrintTitle')} ${a.number}`, content }} onClose={() => setModal(null)} onSigned={(rec) => void procApi.signAct(a.id, rec.id, user).then(() => toast(t('proc_actSigned'))).catch((e) => toast(err(e)))} />}
      {(modal === 'rate' || modal === 'defect') && (
        <Modal
          title={t(modal === 'rate' ? 'proc_rateQuality' : 'proc_addDefect')}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button onClick={() => setModal(null)}>{t('cancel')}</Button>
              <Button type="primary" disabled={busy} onClick={() => (modal === 'rate' ? run(() => procApi.rateAct(a.id, Number(score), comment, user), t('saved')) : run(() => procApi.addDefect(a.id, comment, due, user), t('saved')))}>{t('save')}</Button>
            </>
          }
        >
          {modal === 'rate' ? (
            <Field label={t('proc_score')} required>
              <Select<string> value={score} onChange={setScore} options={['5', '4', '3', '2', '1'].map((s) => ({ value: s, label: `${s} / 5` }))} ariaLabel={t('proc_score')} />
            </Field>
          ) : (
            <Field label={t('deadline')} required>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} ariaLabel={t('deadline')} />
            </Field>
          )}
          <Field label={modal === 'rate' ? t('comment') : t('proc_defect')} required={modal === 'defect'}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} ariaLabel={t('comment')} />
          </Field>
        </Modal>
      )}
      {modal === 'claim' && c && <ClaimModal contract={c} actId={a.id} amount={0} type="defect" onClose={() => setModal(null)} />}
    </>
  );
}

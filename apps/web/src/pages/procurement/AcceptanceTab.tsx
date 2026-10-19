// Приёмка товаров и услуг (ТЗ 4.2.1.3–4.2.1.4): ожидают приёмки, акты приёмки, акты выполненных работ, претензии.
import { useState } from 'react';
import { api, formatDate, formatMoney, procApi, tk, type Contract } from '@xb/shared';
import { Button, Card, DataTable, Field, Modal, Textarea, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { Link, navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ToneBadge, useErr, useIsBuyer } from './shared';
import { AcceptanceFormModal } from './AcceptanceDetail';
import { ActFormModal } from './ActDetail';

const GOODS_KINDS = ['fixed_assets'];

export function AcceptanceTab() {
  const { t } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const contracts = useApi(() => api.listContracts({ status: 'active' }), []);
  const acceptances = useApi(() => procApi.listAcceptances(), []);
  const acts = useApi(() => procApi.listActs(), []);
  const claims = useApi(() => procApi.listClaims(), []);
  const [goodsFor, setGoodsFor] = useState<Contract | null>(null);
  const [actFor, setActFor] = useState<Contract | null>(null);
  const [claimAct, setClaimAct] = useState<{ id: string; action: 'satisfied' | 'rejected' } | null>(null);
  const [text, setText] = useState('');
  const isBuyer = useIsBuyer();
  const editor = isBuyer || can('contracts', 'edit') || can('warehouse', 'edit');
  const supply = (contracts.data ?? []).filter((c) => !['bank_services', 'other_receivables', 'swift'].includes(c.kind ?? 'services') && c.status === 'active');

  return (
    <div className="pc-stack pc-pad">
      <Card title={t('proc_toAccept')} flush>
        <DataTable
          rows={supply}
          loading={contracts.loading}
          rowKey={(c) => c.id}
          columns={[
            { header: t('number'), render: (c) => <Link to={`/contracts/${c.id}`}>{c.number}</Link> },
            { header: t('subject'), render: (c) => <>{c.subject}<div className="sub">{lk.counterparty(c.counterpartyId)?.name} · {t(tk('con_kind_', c.kind ?? 'services'))}</div></> },
            { header: t('amount'), align: 'right', render: (c) => formatMoney(c.amount, c.currency) },
            {
              header: '',
              render: (c) =>
                isBuyer || can('contracts', 'edit') ? (
                  GOODS_KINDS.includes(c.kind ?? '') ? (
                    <Button size="small" onClick={() => setGoodsFor(c)}>{t('proc_newAcceptance')}</Button>
                  ) : (
                    <Button size="small" onClick={() => setActFor(c)}>{t('proc_newAct')}</Button>
                  )
                ) : null,
            },
          ]}
        />
      </Card>

      <Card title={t('proc_acceptances')} actions={<ExportButton filename={t('proc_acceptances')} rows={acceptances.data ?? []} columns={[{ header: t('number'), value: (a) => a.number }, { header: t('date'), value: (a) => a.date }, { header: t('navContracts'), value: (a) => contracts.data?.find((c) => c.id === a.contractId)?.number ?? a.contractId }, { header: t('amount'), value: (a) => a.lines.reduce((s, l) => s + l.acceptedQty * l.unitPrice, 0), format: 'money', total: true }, { header: t('status'), value: (a) => t(tk('proc_acc_', a.status)) }]} />} flush>
        <DataTable
          rows={acceptances.data}
          loading={acceptances.loading}
          rowKey={(a) => a.id}
          onRowClick={(a) => navigate(`/procurement/acceptance/${a.id}`)}
          columns={[
            { header: t('number'), render: (a) => <span className="doc-num">{a.number}</span> },
            { header: t('date'), render: (a) => formatDate(a.date) },
            { header: t('navContracts'), render: (a) => a.contractId },
            { header: t('amount'), align: 'right', render: (a) => formatMoney(a.lines.reduce((s, l) => s + l.acceptedQty * l.unitPrice, 0)) },
            { header: t('proc_discrepancies'), align: 'right', render: (a) => procApi.acceptanceDiscrepancies(a).length },
            { header: t('status'), render: (a) => <ToneBadge status={a.status} label={t(tk('proc_acc_', a.status))} /> },
          ]}
        />
      </Card>

      <Card title={t('proc_acts')} actions={<ExportButton filename={t('proc_acts')} rows={acts.data ?? []} columns={[{ header: t('number'), value: (a) => a.number }, { header: t('period'), value: (a) => `${a.periodFrom} — ${a.periodTo}` }, { header: t('description'), value: (a) => a.description }, { header: t('amount'), value: (a) => procApi.actTotals(a).total, format: 'money', total: true }, { header: t('status'), value: (a) => t(tk('proc_act_', a.status)) }]} />} flush>
        <DataTable
          rows={acts.data}
          loading={acts.loading}
          rowKey={(a) => a.id}
          onRowClick={(a) => navigate(`/procurement/acts/${a.id}`)}
          columns={[
            { header: t('number'), render: (a) => <span className="doc-num">{a.number}</span> },
            { header: t('description'), render: (a) => <>{a.description}<div className="sub">{formatDate(a.periodFrom)} — {formatDate(a.periodTo)}</div></> },
            { header: t('amount'), align: 'right', render: (a) => formatMoney(procApi.actTotals(a).total) },
            { header: t('proc_quality'), align: 'right', render: (a) => (a.quality ? `${a.quality.score}/5` : '—') },
            { header: t('status'), render: (a) => <ToneBadge status={a.status} label={t(tk('proc_act_', a.status))} /> },
          ]}
        />
      </Card>

      <Card title={t('proc_claims')} actions={<ExportButton filename={t('proc_claims')} rows={claims.data ?? []} columns={[{ header: t('number'), value: (c) => c.number }, { header: t('counterparty'), value: (c) => lk.counterparty(c.counterpartyId)?.name ?? '' }, { header: t('proc_claimType'), value: (c) => t(tk('proc_claim_', c.type)) }, { header: t('amount'), value: (c) => c.amount, format: 'money', total: true }, { header: t('status'), value: (c) => t(tk('proc_cls_', c.status)) }]} />} flush>
        <DataTable
          rows={claims.data}
          loading={claims.loading}
          rowKey={(c) => c.id}
          columns={[
            { header: t('number'), render: (c) => <span className="doc-num">{c.number}</span> },
            { header: t('counterparty'), render: (c) => <>{lk.counterparty(c.counterpartyId)?.name}<div className="sub">{t(tk('proc_claim_', c.type))} · {t('deadline')}: {formatDate(c.dueDate)}</div></> },
            { header: t('description'), render: (c) => <>{c.description}{c.response && <div className="sub">{c.response}</div>}</> },
            { header: t('amount'), align: 'right', render: (c) => formatMoney(c.amount) },
            { header: t('status'), render: (c) => <ToneBadge status={c.status} label={t(tk('proc_cls_', c.status))} /> },
            {
              header: '',
              render: (c) =>
                editor ? (
                  <span className="pc-row">
                    {c.status === 'open' && <Button size="small" onClick={async () => { try { await procApi.updateClaim(c.id, 'send', '', user); toast(t('proc_claimSent')); } catch (e) { toast(err(e)); } }}>{t('proc_claimSend')}</Button>}
                    {c.status === 'sent' && (
                      <>
                        <Button size="small" onClick={() => setClaimAct({ id: c.id, action: 'satisfied' })}>{t('proc_claimSatisfied')}</Button>
                        <Button size="small" onClick={() => setClaimAct({ id: c.id, action: 'rejected' })}>{t('proc_claimRejected')}</Button>
                      </>
                    )}
                    {(c.status === 'satisfied' || c.status === 'rejected') && <Button size="small" onClick={async () => { try { await procApi.updateClaim(c.id, 'close', '', user); toast(t('proc_claimClosed')); } catch (e) { toast(err(e)); } }}>{t('proc_claimClose')}</Button>}
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>

      {goodsFor && <AcceptanceFormModal contract={goodsFor} onClose={() => setGoodsFor(null)} />}
      {actFor && <ActFormModal contract={actFor} onClose={() => setActFor(null)} />}
      {claimAct && (
        <Modal
          title={t(claimAct.action === 'satisfied' ? 'proc_claimSatisfied' : 'proc_claimRejected')}
          onClose={() => setClaimAct(null)}
          footer={
            <>
              <Button onClick={() => setClaimAct(null)}>{t('cancel')}</Button>
              <Button type="primary" onClick={async () => { try { await procApi.updateClaim(claimAct.id, claimAct.action, text, user); setClaimAct(null); setText(''); toast(t('saved')); } catch (e) { toast(err(e)); } }}>{t('save')}</Button>
            </>
          }
        >
          <Field label={t('proc_claimResponse')} required>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} ariaLabel={t('proc_claimResponse')} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

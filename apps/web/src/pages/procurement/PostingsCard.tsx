// Бухгалтерские проводки документа: просмотр, подпись E-IMZO и отправка пакетом в iABS (PR-PROC-039/040/057/066, PR-CON-050).
import { useState } from 'react';
import { contractsApi, formatDate, formatMoney, procApi, tk, type ProcPosting } from '@xb/shared';
import { Button, Card, Empty, useToast } from '../../components/ui';
import { SignModal } from '../../components/SignModal';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { ToneBadge, useErr } from './shared';

export function PostingsCard({ docId, contractId, hideEmpty }: { docId?: string; contractId?: string; hideEmpty?: boolean }) {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const list = useApi(() => procApi.listPostings({ ...(docId ? { docId } : {}), ...(contractId ? { contractId } : {}) }), [docId, contractId]);
  const accounts = useApi(() => contractsApi.listAccounts(), []);
  const [signing, setSigning] = useState<ProcPosting | null>(null);
  const accName = (code: string) => {
    const a = accounts.data?.find((x) => x.code === code);
    return a ? `${code} · ${loc(a.name)}` : code;
  };
  const editor = can('contracts', 'edit') || can('warehouse', 'edit');
  if (hideEmpty && !list.data?.length) return null;
  return (
    <Card title={t('proc_postings')}>
      {!list.data?.length ? (
        <Empty text={t('proc_noPostings')} />
      ) : (
        <div className="pc-stack" style={{ gap: 12 }}>
          {list.data.map((p) => (
            <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <div className="pc-row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <b className="doc-num">{p.number}</b> · {formatDate(p.date)} · {t(tk('proc_psrc_', p.source))} · {p.docNumber}
                </span>
                <span className="pc-row">
                  <ToneBadge status={p.status} label={t(tk('proc_pst_', p.status))} />
                  {editor && p.status === 'draft' && <Button size="small" icon="pen" onClick={() => setSigning(p)}>{t('svc_sign')}</Button>}
                  {editor && (p.status === 'signed' || p.status === 'failed') && (
                    <Button size="small" type="primary" onClick={async () => { try { const s = await procApi.sendPosting(p.id, user); toast(`${p.number}: ${t(tk('proc_pst_', s))}`); } catch (e) { toast(err(e)); } }}>
                      {t('proc_sendIabs')}
                    </Button>
                  )}
                </span>
              </div>
              <div className="table-wrap">
                <table className="table pc-mini-table">
                  <thead>
                    <tr>
                      <th>{t('proc_debit')}</th>
                      <th>{t('proc_credit')}</th>
                      <th className="right">{t('amount')}</th>
                      <th>{t('proc_purpose')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.entries.map((e, i) => (
                      <tr key={i}>
                        <td className="small">{accName(e.debit)}</td>
                        <td className="small">{accName(e.credit)}</td>
                        <td className="right num">{formatMoney(e.amount)}</td>
                        <td className="small muted">{e.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      {signing && (
        <SignModal
          doc={{ entity: 'posting', entityId: signing.id, title: `${t('proc_postings')} ${signing.number}`, content: { number: signing.number, entries: signing.entries } }}
          onClose={() => setSigning(null)}
          onSigned={(rec) => void procApi.signPosting(signing.id, rec.id, user).catch((e) => toast(err(e)))}
        />
      )}
    </Card>
  );
}

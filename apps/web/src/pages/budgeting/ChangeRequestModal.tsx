import { useEffect, useMemo, useState } from 'react';
import { budgetingApi, formatMoney, type BudgetingChangeType, userError } from '@xb/shared';
import { Field, Modal, RouteSteps, useToast } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';

/** Запрос на изменение бюджета: перенос между статьями или увеличение статьи. Уходит на согласование. */
export function ChangeRequestModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const articles = useApi(() => budgetingApi.listArticles());
  const lines = useApi(() => budgetingApi.listLines());
  const [type, setType] = useState<BudgetingChangeType>('transfer');
  const [departmentId, setDepartmentId] = useState(user.departmentId);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amountMln, setAmountMln] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const deptIds = useMemo(() => [...new Set((lines.data ?? []).map((l) => l.departmentId))], [lines.data]);
  const deptArticles = (lines.data ?? []).filter((l) => l.departmentId === departmentId).map((l) => l.articleId);
  const available = useApi(() => (fromId ? budgetingApi.availableToTransfer(departmentId, fromId) : Promise.resolve(0)), [departmentId, fromId]);
  const amount = Math.round(Number(amountMln.replace(/\s/g, '').replace(',', '.')) * 1_000_000);

  useEffect(() => {
    if (lines.data && !deptIds.includes(departmentId) && deptIds[0]) setDepartmentId(deptIds[0]);
  }, [lines.data, deptIds, departmentId]);

  async function submit() {
    if (!toId || !(amount > 0) || !reason.trim() || (type === 'transfer' && !fromId)) return setError(t('formRequired'));
    if (type === 'transfer' && fromId === toId) return setError(t('budgeting_sameArticle'));
    if (type === 'transfer' && amount > (available.data ?? 0)) return setError(t('budgeting_insufficient'));
    setBusy(true);
    try {
      const ch = await budgetingApi.requestChange(
        { type, departmentId, ...(type === 'transfer' ? { fromArticleId: fromId } : {}), toArticleId: toId, amount, reason: reason.trim() },
        user,
      );
      toast(`${ch.number}: ${t('budgeting_submitted')}`);
      onDone();
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }

  const artLabel = (id: string) => {
    const a = articles.data?.find((x) => x.id === id);
    return a ? `${a.code} · ${loc(a.name)}` : id;
  };

  return (
    <Modal
      title={t('budgeting_newChange')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{t('submitForApproval')}</button>
        </>
      }
    >
      <Field label={t('budgeting_changeType')} required>
        <select className="select" value={type} onChange={(e) => { setType(e.target.value as BudgetingChangeType); setError(''); }}>
          <option value="transfer">{t('budgeting_type_transfer')}</option>
          <option value="increase">{t('budgeting_type_increase')}</option>
        </select>
      </Field>
      <Field label={t('budgeting_costCenter')} required>
        <select className="select" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setFromId(''); }}>
          {deptIds.map((id) => (
            <option key={id} value={id}>{lk.department(id) ? loc(lk.department(id)!.name) : id}</option>
          ))}
        </select>
      </Field>
      {type === 'transfer' && (
        <Field label={t('budgeting_from')} required hint={fromId ? `${t('budgeting_available')}: ${formatMoney(available.data ?? 0)}` : undefined}>
          <select className="select" value={fromId} onChange={(e) => { setFromId(e.target.value); setError(''); }}>
            <option value="">—</option>
            {deptArticles.map((id) => (
              <option key={id} value={id}>{artLabel(id)}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('budgeting_to')} required>
        <select className="select" value={toId} onChange={(e) => { setToId(e.target.value); setError(''); }}>
          <option value="">—</option>
          {(articles.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>{artLabel(a.id)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('budgeting_amountMln')} required hint={amount > 0 ? formatMoney(amount) : undefined}>
        <input className="input" inputMode="decimal" value={amountMln} onChange={(e) => { setAmountMln(e.target.value); setError(''); }} />
      </Field>
      <Field label={t('budgeting_reason')} required>
        <textarea className="textarea" value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} />
      </Field>
      {error && <span className="error-text">{error}</span>}
      <RouteSteps preview={{ entity: 'budget_change', context: { amount, departmentId, subtype: type, requesterId: user.id } }} />
      <span className="muted small">{t('budgeting_ruleHint')}</span>
    </Modal>
  );
}

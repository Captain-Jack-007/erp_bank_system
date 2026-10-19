import { useState } from 'react';
import { terminalsApi, tk, type TerminalIssue } from '@xb/shared';
import { Button, Field, Modal, Select, Textarea, useToast } from '../../components/ui';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useWmsError } from '../warehouse/wmsShared';

const ISSUES: TerminalIssue[] = ['no_cash', 'card_reader', 'printer', 'network', 'cash_jam', 'power'];

/** Заявка на обслуживание терминала (мониторинг устройств). */
export function TicketModal({ terminalId, onClose }: { terminalId?: string; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const err = useWmsError('terminals_err_');
  const devices = useApi(() => terminalsApi.list());
  const [tid, setTid] = useState(terminalId ?? '');
  const [issue, setIssue] = useState<TerminalIssue>('network');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!tid || !desc.trim()) return setError(t('formRequired'));
    setBusy(true);
    try {
      const tk2 = await terminalsApi.createTicket({ terminalId: tid, issue, description: desc.trim() }, user);
      toast(`${tk2.number}: ${t('terminals_ticketCreated')}`);
      onClose();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('terminals_newTicket')} onClose={onClose} footer={<><Button onClick={onClose}>{t('cancel')}</Button><Button type="primary" disabled={busy} onClick={submit}>{t('create')}</Button></>}>
      <Field label={t('terminals_code')} required>
        <Select value={tid} onChange={(v) => { setTid(v); setError(''); }} disabled={!!terminalId} placeholder="—" options={(devices.data ?? []).map((d) => ({ value: d.id, label: `${d.code} · ${d.branch}` }))} />
      </Field>
      <Field label={t('terminals_issue')} required>
        <Select<TerminalIssue> value={issue} onChange={setIssue} options={ISSUES.map((x) => ({ value: x, label: t(tk('terminals_issue_', x)) }))} />
      </Field>
      <Field label={t('description')} required error={error}>
        <Textarea value={desc} onChange={(e) => { setDesc(e.target.value); setError(''); }} />
      </Field>
    </Modal>
  );
}

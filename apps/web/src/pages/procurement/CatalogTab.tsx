// Номенклатурный справочник закупок (PR-PROC-003): товары, услуги, работы со справочной ценой и спецификацией.
import { useState } from 'react';
import { DqError, formatBytes, formatDateTime, formatMoney, orgApi, procApi, tk, type DqIssue, type ProcCatalogItem, type ProcItemCategory, type ProcurementKind } from '@xb/shared';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Modal, RouteSteps, Select, Textarea, Upload, useToast } from '../../components/ui';
import { DqMessages } from '../masterdata/shared';
import { Link } from '../../lib/router';
import { ExportButton } from '../../components/Export';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { useErr, useIsBuyer } from './shared';
import { PROC_KINDS } from './ProcurementForm';

const CATEGORIES: ProcItemCategory[] = ['it_hw', 'software', 'office', 'furniture', 'household', 'security', 'vehicles', 'construction', 'services', 'utilities'];

export function CatalogTab() {
  const { t, loc } = useSession();
  const can = useCan();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ProcurementKind | ''>('');
  const [cat, setCat] = useState<ProcItemCategory | ''>('');
  const list = useApi(() => procApi.listCatalog({ q, kind, category: cat }), [q, kind, cat]);
  const [edit, setEdit] = useState<ProcCatalogItem | 'new' | null>(null);
  const editor = useIsBuyer();
  return (
    <div className="pc-stack pc-pad">
      <Card
        title={t('proc_tab_catalog')}
        actions={
          <span className="pc-row">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} />
            <Select<ProcurementKind | ''> value={kind} onChange={setKind} ariaLabel={t('proc_kind')} options={[{ value: '', label: `${t('proc_kind')}: ${t('all')}` }, ...PROC_KINDS.map((k) => ({ value: k, label: t(tk('proc_kind_', k)) }))]} />
            <Select<ProcItemCategory | ''> value={cat} onChange={setCat} ariaLabel={t('proc_category')} options={[{ value: '', label: `${t('proc_category')}: ${t('all')}` }, ...CATEGORIES.map((c) => ({ value: c, label: t(tk('proc_cat_', c)) }))]} />
            <ExportButton filename={t('proc_tab_catalog')} rows={list.data ?? []} columns={[{ header: t('proc_code'), value: (c) => c.code }, { header: t('itemName'), value: (c) => loc(c.name) }, { header: t('proc_kind'), value: (c) => t(tk('proc_kind_', c.kind)) }, { header: t('proc_category'), value: (c) => t(tk('proc_cat_', c.category)) }, { header: t('unit'), value: (c) => c.unit }, { header: t('proc_refPrice'), value: (c) => c.refPrice, format: 'money' }]} />
            {editor && <Button size="small" type="primary" icon="plus" onClick={() => setEdit('new')}>{t('proc_addCatalog')}</Button>}
          </span>
        }
        flush
      >
        <DataTable
          rows={list.data}
          loading={list.loading}
          rowKey={(c) => c.id}
          onRowClick={editor ? (c) => setEdit(c) : undefined}
          columns={[
            { header: t('proc_code'), render: (c) => <span className="doc-num">{c.code}</span> },
            { header: t('itemName'), render: (c) => <>{loc(c.name)}{c.spec && <div className="sub">{c.spec}</div>}</> },
            { header: t('proc_kind'), render: (c) => t(tk('proc_kind_', c.kind)) },
            { header: t('proc_category'), render: (c) => t(tk('proc_cat_', c.category)) },
            { header: t('unit'), render: (c) => c.unit },
            { header: t('proc_refPrice'), align: 'right', render: (c) => formatMoney(c.refPrice) },
            { header: t('proc_attrs'), render: (c) => <span className="pc-row">{c.origin === 'import' && <Badge tone="info">{t('proc_import')}</Badge>}{c.install && <Badge tone="muted">{t('proc_install')}</Badge>}{c.license && <Badge tone="muted">{t('proc_license')}</Badge>}{c.fixedAsset && <Badge tone="muted">{t('proc_fixedAsset')}</Badge>}{c.mdmStatus === 'pending' ? <Badge tone="warn">{t('proc_mdm_status_pending')}</Badge> : c.mdmStatus === 'rejected' ? <Badge tone="danger">{t('proc_mdm_status_rejected')}</Badge> : !c.active && <Badge tone="danger">{t('proc_inactive')}</Badge>}{c.pendingChangeId && c.mdmStatus !== 'pending' && <Badge tone="warn">{t('proc_mdm_changePending')}</Badge>}</span> },
          ]}
        />
      </Card>
      {edit && <CatalogModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CatalogModal({ item, onClose }: { item: ProcCatalogItem | null; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const toast = useToast();
  const err = useErr();
  const [f, setF] = useState<Omit<ProcCatalogItem, 'id'> & { id?: string }>(item ?? { code: '', name: { ru: '', uz: '', en: '' }, kind: 'goods', category: 'office', unit: 'шт', refPrice: 0, active: true });
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<DqIssue[]>([]);
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useApi(() => (item ? orgApi.listChanges({ entity: 'nomenclature', targetKey: item.id }) : Promise.resolve([])), [item?.id ?? '']);
  const locked = !!item?.pendingChangeId;
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function submit() {
    setError('');
    setIssues([]);
    setBusy(true);
    try {
      const req = await procApi.saveCatalogItem(f, user, { reason, ...(file ? { attachment: file } : {}) });
      toast(`${req.number}: ${t('mdm_submitted')}`);
      onClose();
    } catch (e) {
      if (e instanceof DqError) setIssues(e.issues);
      else setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? item.code : t('proc_addCatalog')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} disabled={locked} onClick={submit}>{t('mdm_submit')}</Button>
        </>
      }
    >
      <div className="banner info">{t('proc_mdm_hint')}</div>
      {locked && <div className="banner warn">{t('mdm_pending_exists')}</div>}
      <div className="form-grid">
        <Field label={t('proc_code')} required><Input value={f.code} onChange={(e) => set({ code: e.target.value })} ariaLabel={t('proc_code')} /></Field>
        <Field label={t('unit')} required><Input value={f.unit} onChange={(e) => set({ unit: e.target.value })} ariaLabel={t('unit')} /></Field>
        <Field label={`${t('itemName')} (RU)`} required className="span-2"><Input value={f.name.ru} onChange={(e) => set({ name: { ...f.name, ru: e.target.value } })} ariaLabel="ru" /></Field>
        <Field label={`${t('itemName')} (UZ)`} required className="span-2"><Input value={f.name.uz} onChange={(e) => set({ name: { ...f.name, uz: e.target.value } })} ariaLabel="uz" /></Field>
        <Field label={`${t('itemName')} (EN)`} className="span-2"><Input value={f.name.en ?? ''} onChange={(e) => set({ name: { ...f.name, en: e.target.value } })} ariaLabel="en" /></Field>
        <Field label={t('proc_kind')} required><Select<ProcurementKind> value={f.kind} onChange={(v) => set({ kind: v })} options={PROC_KINDS.map((k) => ({ value: k, label: t(tk('proc_kind_', k)) }))} ariaLabel={t('proc_kind')} /></Field>
        <Field label={t('proc_category')} required><Select<ProcItemCategory> value={f.category} onChange={(v) => set({ category: v })} options={CATEGORIES.map((c) => ({ value: c, label: t(tk('proc_cat_', c)) }))} ariaLabel={t('proc_category')} /></Field>
        <Field label={t('proc_refPrice')} required><Input type="number" value={f.refPrice || ''} onChange={(e) => set({ refPrice: Number(e.target.value) })} ariaLabel={t('proc_refPrice')} /></Field>
        <Field label={t('budgetLine')}><Select<string> value={f.budgetLineId ?? ''} onChange={(v) => set({ budgetLineId: v || undefined })} placeholder="—" options={lk.budgetLines.map((b) => ({ value: b.id, label: b.code }))} ariaLabel={t('budgetLine')} /></Field>
        <Field label={t('proc_spec')} className="span-2"><Textarea value={f.spec ?? ''} onChange={(e) => set({ spec: e.target.value })} ariaLabel={t('proc_spec')} /></Field>
        <Field label={t('proc_warehouseSku')}><Input value={f.warehouseSku ?? ''} onChange={(e) => set({ warehouseSku: e.target.value || undefined })} ariaLabel={t('proc_warehouseSku')} /></Field>
        <div className="pc-row">
          <Checkbox checked={f.origin === 'import'} onChange={(v) => set({ origin: v ? 'import' : 'local' })}>{t('proc_import')}</Checkbox>
          <Checkbox checked={!!f.install} onChange={(v) => set({ install: v })}>{t('proc_install')}</Checkbox>
          <Checkbox checked={!!f.license} onChange={(v) => set({ license: v })}>{t('proc_license')}</Checkbox>
          <Checkbox checked={!!f.fixedAsset} onChange={(v) => set({ fixedAsset: v })}>{t('proc_fixedAsset')}</Checkbox>
          <Checkbox checked={f.active} onChange={(v) => set({ active: v })}>{t('proc_active')}</Checkbox>
        </div>
      </div>
      <div className="form-grid">
        <Field label={t('mdm_attachment')} required hint={t('mdm_attachment_hint')}>
          <Upload accept=".pdf,.p7s,.sig,application/pdf" ariaLabel={t('mdm_attachment')} onFiles={(files) => { const x = files[0]!; setFile({ name: x.name, size: x.size }); }}>
            <Button icon="paperclip" size="small">{file ? `${file.name} · ${formatBytes(file.size)}` : t('mdm_attach')}</Button>
          </Upload>
        </Field>
        <Field label={t('mdm_route')}>
          <RouteSteps preview={{ entity: 'mdm_change', context: { objectType: 'nomenclature', itemKind: f.kind, category: f.category } }} />
        </Field>
      </div>
      <Field label={t('mdm_reason')} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t('mdm_reason_ph')} ariaLabel={t('mdm_reason')} />
      </Field>
      <DqMessages issues={issues} />
      {error && <span className="error-text">{error}</span>}
      {!!history.data?.length && (
        <Field label={t('proc_mdm_requests')}>
          <ul className="cat-list">
            {history.data.map((h) => (
              <li key={h.id}>
                <Link to={`/master-data/changes/${h.id}`}>{h.number}</Link> · {t(tk('mdm_action_', h.action))} · <Badge tone={h.status === 'approved' ? 'ok' : h.status === 'rejected' ? 'danger' : 'warn'}>{t(tk('mdm_status_', h.status))}</Badge>
                <span className="muted small"> · {formatDateTime(h.requestedAt)}{h.decisionComment ? ` — ${h.decisionComment}` : ''}</span>
              </li>
            ))}
          </ul>
        </Field>
      )}
    </Modal>
  );
}

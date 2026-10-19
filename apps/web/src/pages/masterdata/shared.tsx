// Общие части экранов MDM: оргединицы, подписи, форма заявки на изменение справочника (PR-MDM-003)
// с барьером качества данных (Data Quality Firewall) и подтверждающим документом.
import { useMemo, useState } from 'react';
import {
  BUSINESS_SEGMENTS, DqError, orgApi, tk, validateCostCenter, validateOrgUnit, formatBytes,
  type BusinessSegment, type CostCenter, type DqIssue, type MdmChangeAction, type MdmEntity, type OrgUnit, type OrgUnitType, type TKey, userError } from '@xb/shared';
import { Badge, Button, Drawer, Field, Input, Select, Textarea, Upload, useToast } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';

export const ORG_TYPES: OrgUnitType[] = ['head_office', 'region', 'branch_office', 'department'];
const TYPE_TONE: Record<OrgUnitType, 'ok' | 'info' | 'warn' | 'muted'> = { head_office: 'ok', region: 'info', branch_office: 'warn', department: 'muted' };

export function OrgTypeBadge({ type }: { type: OrgUnitType }) {
  const { t } = useSession();
  return <Badge tone={TYPE_TONE[type]}>{t(tk('org_type_', type))}</Badge>;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Текущие оргединицы + подписи. */
export function useOrgUnits(asOf?: string) {
  const { loc } = useSession();
  // asOf === 'skip' — не загружать (данные переданы родителем)
  const units = useApi(() => (asOf === 'skip' ? Promise.resolve([] as OrgUnit[]) : orgApi.listOrgUnits(asOf ? { asOf } : {})), [asOf ?? '']);
  const list = units.data ?? [];
  return {
    loading: units.loading && !units.data,
    list,
    get: (key?: string) => list.find((u) => u.key === key),
    label: (key?: string) => {
      const u = list.find((x) => x.key === key);
      return u ? loc(u.name) : key ?? '—';
    },
    options: list.map((u) => ({ value: u.key, label: `${u.code} · ${loc(u.name)}` })),
  };
}

export function useExpenseGroups() {
  const { loc } = useSession();
  const g = useApi(() => orgApi.listExpenseGroups());
  const list = g.data ?? [];
  return { list, label: (id?: string) => { const x = list.find((y) => y.id === id); return x ? loc(x.name) : '—'; }, options: list.map((x) => ({ value: x.id, label: `${x.code} · ${loc(x.name)}` })) };
}

/** Подписи полей МВЗ/оргединиц — для форм, истории изменений и журнала. */
export function useFieldLabel() {
  const { t } = useSession();
  return (field: string) => {
    const key = tk('mdf_', field) as TKey;
    const v = t(key);
    return v === key ? field : v;
  };
}

export function DqMessages({ issues }: { issues: DqIssue[] }) {
  const { t } = useSession();
  const label = useFieldLabel();
  if (!issues.length) return null;
  return (
    <div className="dq-box" role="alert">
      <div className="dq-title"><Icon name="alert" size={15} /> {t('dq_title')}</div>
      <ul>
        {issues.map((i, n) => (
          <li key={n} className={i.severity}>
            {i.field !== '*' && <b>{label(i.field)}: </b>}
            {t(i.code as TKey)}
            {i.detail ? ` (${i.detail})` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ChangeDrawerProps {
  entity: MdmEntity;
  action: MdmChangeAction;
  target?: OrgUnit | CostCenter;
  defaults?: { orgUnitKey?: string; parentKey?: string };
  onClose: () => void;
}

/** Заявка на создание/изменение/закрытие оргединицы или МВЗ. Применяется после утверждения (SCD2). */
export function ChangeDrawer({ entity, action, target, defaults, onClose }: ChangeDrawerProps) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const lk = useLookups();
  const units = useOrgUnits();
  const groups = useExpenseGroups();
  const cc = entity === 'cost_center' ? (target as CostCenter | undefined) : undefined;
  const ou = entity === 'org_unit' ? (target as OrgUnit | undefined) : undefined;
  const [f, setF] = useState(() => ({
    code: target?.code ?? '',
    nameRu: target?.name.ru ?? '',
    nameUz: target?.name.uz ?? '',
    orgUnitKey: cc?.orgUnitKey ?? defaults?.orgUnitKey ?? '',
    cbuCode: target?.cbuCode ?? '',
    segment: (cc?.segment ?? '') as BusinessSegment | '',
    expenseGroupId: cc?.expenseGroupId ?? '',
    responsibleId: cc?.responsibleId ?? '',
    type: (ou?.type ?? (entity === 'org_unit' ? 'branch_office' : '')) as OrgUnitType | '',
    parentKey: ou?.parentKey ?? defaults?.parentKey ?? '',
    headUserId: ou?.headUserId ?? '',
    address: ou?.address ?? '',
  }));
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [issues, setIssues] = useState<DqIssue[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const payload = useMemo<Record<string, unknown>>(() => {
    if (action === 'close') return {};
    const name = { ru: f.nameRu.trim(), uz: f.nameUz.trim() };
    if (entity === 'cost_center')
      return { code: f.code.trim(), name, orgUnitKey: f.orgUnitKey, cbuCode: f.cbuCode.trim(), segment: f.segment, expenseGroupId: f.expenseGroupId, ...(f.responsibleId ? { responsibleId: f.responsibleId } : {}) };
    return { code: f.code.trim(), name, type: f.type, parentKey: f.parentKey || null, ...(f.cbuCode.trim() ? { cbuCode: f.cbuCode.trim() } : {}), ...(f.headUserId ? { headUserId: f.headUserId } : {}), ...(f.address.trim() ? { address: f.address.trim() } : {}) };
  }, [f, entity, action]);

  // Живая проверка качества данных (предупреждения видны сразу, ошибки — после попытки отправки).
  const live = useMemo(() => {
    if (action === 'close') return [];
    return entity === 'cost_center' ? validateCostCenter(payload as never, target?.key, effectiveFrom) : validateOrgUnit(payload as never, target?.key, effectiveFrom);
  }, [payload, entity, action, target?.key, effectiveFrom]);
  const shown = tried ? [...issues, ...live.filter((l) => !issues.some((i) => i.field === l.field && i.code === l.code))] : live.filter((i) => i.severity === 'warning');
  const fieldErr = (field: string) => {
    const i = shown.find((x) => x.field === field && x.severity === 'error');
    return i ? t(i.code as TKey) : undefined;
  };

  async function submit() {
    setTried(true);
    setBusy(true);
    try {
      // для изменения отправляем только изменённые поля
      let body = payload;
      if (action === 'update' && target) {
        const cur = target as unknown as Record<string, unknown>;
        body = Object.fromEntries(Object.entries(payload).filter(([k, v]) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(v ?? null)));
      }
      const req = await orgApi.submitChange({ entity, action, ...(target ? { targetKey: target.key } : {}), payload: body, effectiveFrom, reason, ...(file ? { attachment: file } : {}) }, user);
      toast(`${req.number}: ${t('mdm_submitted')}`);
      onClose();
    } catch (e) {
      if (e instanceof DqError) setIssues(e.issues);
      else toast(`${t('actionFailed')}: ${userError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const title = `${t(tk('mdm_action_', action))}: ${t(tk('mdm_entity_', entity))}${target ? ` · ${target.code}` : ''}`;
  return (
    <Drawer
      open
      width={640}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={submit}>{t('mdm_submit')}</Button>
        </>
      }
    >
      <div className="banner info">{t('mdm_flow_hint')}</div>
      {action !== 'close' && entity === 'cost_center' && (
        <div className="form-grid">
          <Field label={t('mdf_orgUnitKey')} required error={fieldErr('orgUnitKey')} className="span-2">
            <Select<string>
              value={f.orgUnitKey}
              placeholder="—"
              options={units.options}
              ariaLabel={t('mdf_orgUnitKey')}
              onChange={(v) => {
                const u = units.get(v);
                set({ orgUnitKey: v, cbuCode: u?.cbuCode ?? f.cbuCode, ...(action === 'create' ? { code: orgApi.suggestCostCenterCode(v) } : {}) });
              }}
            />
          </Field>
          <Field label={t('mdf_code')} required error={fieldErr('code')} hint="MVZ-RR-UUU-NN">
            <Input value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} ariaLabel={t('mdf_code')} />
          </Field>
          <Field label={t('mdf_cbuCode')} required error={fieldErr('cbuCode')} hint={t('dq_cbu_hint')}>
            <Input value={f.cbuCode} onChange={(e) => set({ cbuCode: e.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" maxLength={5} ariaLabel={t('mdf_cbuCode')} />
          </Field>
          <Field label={t('mdf_nameRu')} required error={fieldErr('nameRu')}>
            <Input value={f.nameRu} onChange={(e) => set({ nameRu: e.target.value })} ariaLabel={t('mdf_nameRu')} />
          </Field>
          <Field label={t('mdf_nameUz')} required error={fieldErr('nameUz')}>
            <Input value={f.nameUz} onChange={(e) => set({ nameUz: e.target.value })} ariaLabel={t('mdf_nameUz')} />
          </Field>
          <Field label={t('mdf_segment')} required error={fieldErr('segment')}>
            <Select<string> value={f.segment} onChange={(v) => set({ segment: v as BusinessSegment })} placeholder="—" options={BUSINESS_SEGMENTS.map((s) => ({ value: s, label: t(tk('seg_', s)) }))} ariaLabel={t('mdf_segment')} />
          </Field>
          <Field label={t('mdf_expenseGroupId')} required error={fieldErr('expenseGroupId')}>
            <Select<string> value={f.expenseGroupId} onChange={(v) => set({ expenseGroupId: v })} placeholder="—" options={groups.options} ariaLabel={t('mdf_expenseGroupId')} />
          </Field>
          <Field label={t('mdf_responsibleId')} className="span-2">
            <Select<string> value={f.responsibleId} onChange={(v) => set({ responsibleId: v })} placeholder="—" options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: `${u.fullName} · ${loc(u.position)}` }))} ariaLabel={t('mdf_responsibleId')} />
          </Field>
        </div>
      )}
      {action !== 'close' && entity === 'org_unit' && (
        <div className="form-grid">
          <Field label={t('mdf_type')} required error={fieldErr('type')}>
            <Select<string> value={f.type} onChange={(v) => set({ type: v as OrgUnitType })} placeholder="—" options={ORG_TYPES.filter((x) => x !== 'head_office').map((x) => ({ value: x, label: t(tk('org_type_', x)) }))} ariaLabel={t('mdf_type')} />
          </Field>
          <Field label={t('mdf_parentKey')} required error={fieldErr('parentKey')}>
            <Select<string> value={f.parentKey} onChange={(v) => set({ parentKey: v })} placeholder="—" options={units.list.filter((u) => u.type !== 'department' && u.key !== target?.key).map((u) => ({ value: u.key, label: `${u.code} · ${loc(u.name)}` }))} ariaLabel={t('mdf_parentKey')} />
          </Field>
          <Field label={t('mdf_code')} required error={fieldErr('code')}>
            <Input value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} ariaLabel={t('mdf_code')} />
          </Field>
          <Field label={t('mdf_cbuCode')} required={f.type === 'branch_office'} error={fieldErr('cbuCode')} hint={t('dq_cbu_hint')}>
            <Input value={f.cbuCode} onChange={(e) => set({ cbuCode: e.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" maxLength={5} ariaLabel={t('mdf_cbuCode')} />
          </Field>
          <Field label={t('mdf_nameRu')} required error={fieldErr('nameRu')}>
            <Input value={f.nameRu} onChange={(e) => set({ nameRu: e.target.value })} ariaLabel={t('mdf_nameRu')} />
          </Field>
          <Field label={t('mdf_nameUz')} required error={fieldErr('nameUz')}>
            <Input value={f.nameUz} onChange={(e) => set({ nameUz: e.target.value })} ariaLabel={t('mdf_nameUz')} />
          </Field>
          <Field label={t('mdf_headUserId')}>
            <Select<string> value={f.headUserId} onChange={(v) => set({ headUserId: v })} placeholder="—" options={lk.users.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: u.fullName }))} ariaLabel={t('mdf_headUserId')} />
          </Field>
          <Field label={t('mdf_address')}>
            <Input value={f.address} onChange={(e) => set({ address: e.target.value })} ariaLabel={t('mdf_address')} />
          </Field>
        </div>
      )}
      {action === 'close' && <div className="banner danger">{t(entity === 'org_unit' ? 'mdm_close_unit_hint' : 'mdm_close_cc_hint')}</div>}
      <div className="form-grid">
        <Field label={t('mdm_effective_from')} required error={fieldErr('effectiveFrom')} hint={t('mdm_effective_hint')}>
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} ariaLabel={t('mdm_effective_from')} />
        </Field>
        <Field label={t('mdm_attachment')} required error={fieldErr('attachment')} hint={t('mdm_attachment_hint')}>
          <Upload
            accept=".pdf,.p7s,.sig,application/pdf"
            ariaLabel={t('mdm_attachment')}
            onFiles={(files) => {
              const x = files[0]!;
              setFile({ name: x.name, size: x.size });
            }}
          >
            <Button icon="paperclip" size="small">{file ? `${file.name} · ${formatBytes(file.size)}` : t('mdm_attach')}</Button>
          </Upload>
        </Field>
      </div>
      <Field label={t('mdm_reason')} required error={fieldErr('reason')}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t('mdm_reason_ph')} ariaLabel={t('mdm_reason')} />
      </Field>
      <DqMessages issues={shown} />
    </Drawer>
  );
}

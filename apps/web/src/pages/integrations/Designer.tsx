// P4-GEN (ТЗ PR-GEN-020): конструктор интеграций на экране «Интеграции». Сотрудник банка описывает систему,
// протокол, адрес, аутентификацию, операции с маппингом полей, расписание и политику повторов; сохранение
// (с подтверждением кодом 2FA и аудитом) регистрирует систему в integrationHub — она появляется в мониторе
// и вызывается как любая другая. Тестовый вызов идёт на имитируемую конечную точку; OpenAPI — выгрузка JSON.
import { useState } from 'react';
import {
  CUSTOM_AUTHS, CUSTOM_FIELD_TYPES, CUSTOM_METHODS, CUSTOM_PROTOCOLS, CustomIntegrationError, formatDateTime, integrationDesignerApi, IntegrationUnavailableError, tk,
  type CustomAuth, type CustomField, type CustomFieldType, type CustomIntegration, type CustomIntegrationInput, type CustomMethod, type CustomOperation, type CustomProtocol, type ExchangeRecord, type TKey,
} from '@xb/shared';
import { Badge, Button, Card, Checkbox, CodeEditor, DataTable, Drawer, Empty, Field, Input, Select, StatusBadge, Switch, useToast } from '../../components/ui';
import { downloadBytes, safeFilename } from '../../components/download';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useCan, useStepUp } from '../../lib/access';
import '../../p4gen.css';

const emptyField = (): CustomField => ({ name: '', type: 'string', required: false, mapTo: '' });
const emptyOp = (n: number): CustomOperation => ({ id: `op${n}.call`, name: '', direction: 'out', method: 'POST', target: '/', request: [emptyField()], response: [emptyField()] });

function FieldsEditor({ title, list, onChange, errPrefix, errors }: { title: string; list: CustomField[]; onChange: (l: CustomField[]) => void; errPrefix: string; errors: Record<string, string> }) {
  const { t } = useSession();
  const set = (i: number, patch: Partial<CustomField>) => onChange(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="p4-fields">
      <div className="p4-fields-head">
        <b className="small">{title}</b>
        <Button size="small" icon="plus" onClick={() => onChange([...list, emptyField()])}>
          {t('p4g_int_addField')}
        </Button>
      </div>
      {errors[errPrefix] && <div className="field-error small">{t(errors[errPrefix] as TKey)}</div>}
      {list.map((f, i) => (
        <div key={i} className={`p4-field-row ${errors[`${errPrefix}${i}`] ? 'bad' : ''}`}>
          <Input value={f.name} onChange={(e) => set(i, { name: e.target.value.trim() })} placeholder={t('p4g_int_fieldName')} ariaLabel={`${title} ${i + 1}: ${t('p4g_int_fieldName')}`} />
          <Select<CustomFieldType> value={f.type} onChange={(v) => set(i, { type: v })} ariaLabel={t('p4g_int_fieldType')} options={CUSTOM_FIELD_TYPES.map((x) => ({ value: x, label: t(tk('p4g_int_type_', x)) }))} />
          <Input value={f.mapTo} onChange={(e) => set(i, { mapTo: e.target.value.trim() })} placeholder={t('p4g_int_mapTo')} ariaLabel={`${title} ${i + 1}: ${t('p4g_int_mapTo')}`} />
          <Checkbox checked={f.required} onChange={(v) => set(i, { required: v })}>
            {t('p4g_int_required')}
          </Checkbox>
          <Button size="small" icon="trash" title={t('p4g_int_remove')} onClick={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      {errors[`${errPrefix}`] === undefined && Object.keys(errors).some((k) => k.startsWith(errPrefix) && k !== errPrefix) && <div className="field-error small">{t('p4g_int_err_field')}</div>}
    </div>
  );
}

function EditorDrawer({ initial, onClose }: { initial: CustomIntegration | null; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const stepUp = useStepUp();
  const [v, setV] = useState<CustomIntegrationInput>(() => {
    if (!initial) return integrationDesignerApi.blank();
    const { id, name, owner, description, protocol, endpoint, auth, operations, schedule, retry, enabled } = initial;
    return JSON.parse(JSON.stringify({ id, name, owner, description, protocol, endpoint, auth, operations, schedule, retry, enabled })) as CustomIntegrationInput;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const setOp = (i: number, patch: Partial<CustomOperation>) => setV({ ...v, operations: v.operations.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const err = (k: string) => (errors[k] ? t(errors[k] as TKey) : undefined);
  const targetLabel = v.protocol === 'rest' ? t('p4g_int_path') : v.protocol === 'soap' ? 'SOAPAction' : v.protocol === 'file' ? t('p4g_int_fileMask') : t('p4g_int_queue');

  async function save() {
    if (!(await stepUp(`${t('p4g_int_save')}: ${v.name || '—'}`))) return;
    setBusy(true);
    try {
      const c = await integrationDesignerApi.save(v, user.id);
      toast(`${c.name}: ${t('p4g_int_saved')} (v${c.version})`);
      onClose();
    } catch (e) {
      if (e instanceof CustomIntegrationError) {
        setErrors(e.issues);
        toast(t('p4g_int_fix'));
      } else toast(t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      width={760}
      title={initial ? `${t('p4g_int_edit')} · ${initial.name}` : t('p4g_int_new')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" icon="check" loading={busy} onClick={save} className="ci-save">
            {t('p4g_int_save')}
          </Button>
        </>
      }
    >
      <div className="p4-designer" data-testid="ci-editor">
        <h3 className="p4-sub">{t('p4g_int_general')}</h3>
        <div className="grid grid-2">
          <Field label={t('p4g_int_name')} required error={err('name')}>
            <Input name="ci-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} ariaLabel={t('p4g_int_name')} />
          </Field>
          <Field label={t('p4g_int_owner')}>
            <Input name="ci-owner" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })} maxLength={80} ariaLabel={t('p4g_int_owner')} />
          </Field>
          <Field label={t('p4g_int_protocol')}>
            <Select<CustomProtocol>
              value={v.protocol}
              ariaLabel={t('p4g_int_protocol')}
              onChange={(p) => setV({ ...v, protocol: p, endpoint: p === 'file' ? 'sftp://' : p === 'mq' ? 'amqps://' : v.endpoint.startsWith('http') ? v.endpoint : 'https://' })}
              options={CUSTOM_PROTOCOLS.map((x) => ({ value: x, label: t(tk('p4g_int_proto_', x)) }))}
            />
          </Field>
          <Field label={t('p4g_int_auth')}>
            <Select<CustomAuth> value={v.auth} onChange={(a) => setV({ ...v, auth: a })} ariaLabel={t('p4g_int_auth')} options={CUSTOM_AUTHS.map((x) => ({ value: x, label: t(tk('p4g_int_auth_', x)) }))} />
          </Field>
        </div>
        <Field label={t('p4g_int_endpoint')} required error={err('endpoint')} hint={t(tk('p4g_int_endpointHint_', v.protocol))}>
          <Input name="ci-endpoint" value={v.endpoint} onChange={(e) => setV({ ...v, endpoint: e.target.value })} ariaLabel={t('p4g_int_endpoint')} />
        </Field>
        <Field label={t('p4g_int_description')}>
          <Input name="ci-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={200} ariaLabel={t('p4g_int_description')} />
        </Field>

        <div className="p4-fields-head">
          <h3 className="p4-sub">{t('p4g_int_operations')}</h3>
          <Button size="small" icon="plus" onClick={() => setV({ ...v, operations: [...v.operations, emptyOp(v.operations.length + 1)] })} className="ci-add-op">
            {t('p4g_int_addOp')}
          </Button>
        </div>
        {err('operations') && <div className="field-error small">{err('operations')}</div>}
        {v.operations.map((o, i) => (
          <div key={i} className="p4-op" data-testid="ci-op">
            <div className="grid grid-2">
              <Field label={t('p4g_int_opId')} required error={err(`op${i}.id`)}>
                <Input value={o.id} onChange={(e) => setOp(i, { id: e.target.value.trim() })} ariaLabel={`${t('p4g_int_opId')} ${i + 1}`} />
              </Field>
              <Field label={t('p4g_int_opName')} required error={err(`op${i}.name`)}>
                <Input value={o.name} onChange={(e) => setOp(i, { name: e.target.value })} ariaLabel={`${t('p4g_int_opName')} ${i + 1}`} />
              </Field>
              <Field label={t('p4g_int_direction')}>
                <Select<'out' | 'in'> value={o.direction} onChange={(d) => setOp(i, { direction: d })} ariaLabel={t('p4g_int_direction')} options={(['out', 'in'] as const).map((x) => ({ value: x, label: t(tk('svc_intDirection_', x)) }))} />
              </Field>
              {v.protocol === 'rest' && (
                <Field label={t('p4g_int_method')}>
                  <Select<CustomMethod> value={o.method} onChange={(m) => setOp(i, { method: m })} ariaLabel={t('p4g_int_method')} options={CUSTOM_METHODS.map((x) => ({ value: x, label: x }))} />
                </Field>
              )}
              <Field label={targetLabel} required error={err(`op${i}.target`)}>
                <Input value={o.target} onChange={(e) => setOp(i, { target: e.target.value })} ariaLabel={`${targetLabel} ${i + 1}`} />
              </Field>
            </div>
            <FieldsEditor title={t('p4g_int_request')} list={o.request} onChange={(l) => setOp(i, { request: l })} errPrefix={`op${i}.req`} errors={errors} />
            <FieldsEditor title={t('p4g_int_response')} list={o.response} onChange={(l) => setOp(i, { response: l })} errPrefix={`op${i}.res`} errors={errors} />
            {v.operations.length > 1 && (
              <Button size="small" danger icon="trash" onClick={() => setV({ ...v, operations: v.operations.filter((_, j) => j !== i) })}>
                {t('p4g_int_removeOp')}
              </Button>
            )}
          </div>
        ))}

        <h3 className="p4-sub">{t('p4g_int_scheduleRetry')}</h3>
        <div className="grid grid-2">
          <Field label={t('p4g_int_schedule')} error={err('schedule')}>
            <Select<'online' | 'interval' | 'daily'>
              value={v.schedule.kind}
              ariaLabel={t('p4g_int_schedule')}
              onChange={(k) => setV({ ...v, schedule: k === 'online' ? { kind: 'online' } : k === 'interval' ? { kind: 'interval', minutes: 60 } : { kind: 'daily', time: '09:00' } })}
              options={(['online', 'interval', 'daily'] as const).map((x) => ({ value: x, label: t(tk('p4g_int_sched_', x)) }))}
            />
          </Field>
          {v.schedule.kind === 'interval' && (
            <Field label={t('p4g_int_minutes')}>
              <Input type="number" value={v.schedule.minutes} onChange={(e) => setV({ ...v, schedule: { kind: 'interval', minutes: Number(e.target.value) } })} ariaLabel={t('p4g_int_minutes')} />
            </Field>
          )}
          {v.schedule.kind === 'daily' && (
            <Field label={t('p4g_int_time')}>
              <Input type="time" value={v.schedule.time} onChange={(e) => setV({ ...v, schedule: { kind: 'daily', time: e.target.value } })} ariaLabel={t('p4g_int_time')} />
            </Field>
          )}
          <Field label={t('p4g_int_attempts')} error={err('retry')}>
            <Input name="ci-attempts" type="number" value={v.retry.maxAttempts} onChange={(e) => setV({ ...v, retry: { ...v.retry, maxAttempts: Number(e.target.value) } })} ariaLabel={t('p4g_int_attempts')} />
          </Field>
          <Field label={t('p4g_int_backoff')}>
            <Input name="ci-backoff" type="number" value={v.retry.backoffMs} onChange={(e) => setV({ ...v, retry: { ...v.retry, backoffMs: Number(e.target.value) } })} ariaLabel={t('p4g_int_backoff')} />
          </Field>
        </div>
        <label className="svc-row" style={{ gap: 10 }}>
          <Switch checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} ariaLabel={t('p4g_int_enabled')} />
          {t('p4g_int_enabled')}
        </label>
      </div>
    </Drawer>
  );
}

function TestDrawer({ item, onClose }: { item: CustomIntegration; onClose: () => void }) {
  const { t } = useSession();
  const user = useUser();
  const [opId, setOpId] = useState(item.operations[0]!.id);
  const [payload, setPayload] = useState(() => JSON.stringify(integrationDesignerApi.sample(item, item.operations[0]!.id), null, 2));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ExchangeRecord | null>(null);
  async function send() {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return setError(t('svc_intBadJson'));
    }
    setError('');
    setBusy(true);
    try {
      setLast(await integrationDesignerApi.testCall(item.id, opId, body, user.id));
    } catch (e) {
      setError(e instanceof IntegrationUnavailableError ? t('p4g_int_disabledErr') : t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      open
      width={600}
      title={`${t('svc_intTest')} · ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('svc_close')}</Button>
          <Button type="primary" icon="plug" loading={busy} onClick={send} className="ci-send">
            {t('svc_intSend')}
          </Button>
        </>
      }
    >
      <Field label={t('svc_intOperation')}>
        <Select
          value={opId}
          ariaLabel={t('svc_intOperation')}
          onChange={(x) => {
            setOpId(x);
            setPayload(JSON.stringify(integrationDesignerApi.sample(item, x), null, 2));
            setLast(null);
          }}
          options={item.operations.map((o) => ({ value: o.id, label: `${o.name} (${o.id})` }))}
        />
      </Field>
      <p className="small muted" style={{ margin: 0 }}>
        {t('p4g_int_simulated')}: <span className="svc-mono">{item.endpoint}</span> · {t('p4g_int_attempts')}: {item.retry.maxAttempts}
      </p>
      <Field label={t('svc_intPayload')} error={error}>
        <CodeEditor value={payload} onChange={setPayload} ariaLabel={t('svc_intPayload')} />
      </Field>
      {last && (
        <div className="svc-sig" data-testid="ci-result" data-status={last.status}>
          <div className="svc-sig-head">
            <span className="svc-mono">{last.id}</span>
            <StatusBadge prefix="svc_status_" status={last.status} tone={last.status === 'success' ? 'ok' : last.status === 'queued' ? 'warn' : 'danger'} />
          </div>
          <div className="small muted">
            {t('svc_intAttempts')}: {last.attempts.length}
            {last.error && ` · ${t(tk('svc_err_', last.error))}${last.errorMessage ? ` — ${last.errorMessage}` : ''}`}
          </div>
          {last.response && <pre className="svc-pre">{JSON.stringify(last.response, null, 2)}</pre>}
        </div>
      )}
    </Drawer>
  );
}

export function IntegrationDesigner() {
  const { t } = useSession();
  const user = useUser();
  const toast = useToast();
  const stepUp = useStepUp();
  const canEdit = useCan()('integrations', 'edit');
  const list = useApi(() => integrationDesignerApi.list());
  const [editing, setEditing] = useState<CustomIntegration | 'new' | null>(null);
  const [testing, setTesting] = useState<CustomIntegration | null>(null);
  const schedule = (c: CustomIntegration) => (c.schedule.kind === 'online' ? t('p4g_int_sched_online') : c.schedule.kind === 'interval' ? `${t('p4g_int_sched_interval')}: ${c.schedule.minutes} min` : `${t('p4g_int_sched_daily')}: ${c.schedule.time}`);
  return (
    <Card
      flush
      title={
        <div className="svc-spread" style={{ width: '100%' }}>
          <h2>{t('p4g_int_designer')}</h2>
          {canEdit && (
            <Button type="primary" icon="plus" onClick={() => setEditing('new')} className="ci-new">
              {t('p4g_int_new')}
            </Button>
          )}
        </div>
      }
    >
      <p className="small muted" style={{ margin: '0 16px 12px' }}>{t('p4g_int_designerHint')}</p>
      {list.data && !list.data.length ? (
        <Empty text={t('p4g_int_empty')} icon="plug" />
      ) : (
        <DataTable
          rows={list.data}
          loading={list.loading}
          rowKey={(c) => c.id}
          columns={[
            { header: t('svc_intSystem'), render: (c) => <div data-testid="ci-row" data-system={c.systemId}><div>{c.name}</div><div className="sub svc-mono">{c.systemId} · v{c.version}</div></div> },
            { header: t('p4g_int_protocol'), render: (c) => <><div>{t(tk('p4g_int_proto_', c.protocol))}</div><div className="sub svc-mono">{c.endpoint}</div></> },
            { header: t('p4g_int_operations'), render: (c) => c.operations.map((o) => o.id).join(', ') },
            { header: t('p4g_int_schedule'), render: (c) => <><div>{schedule(c)}</div>{c.nextRunAt && <div className="sub">{t('p4g_int_nextRun')}: {formatDateTime(c.nextRunAt)}</div>}</> },
            { header: t('svc_intStatus'), render: (c) => <Badge tone={c.enabled ? 'ok' : 'muted'}>{c.enabled ? t('p4g_int_on') : t('p4g_int_off')}</Badge> },
            {
              header: t('svc_actions'),
              render: (c) => (
                <div className="svc-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  {canEdit && (
                    <Switch
                      checked={c.enabled}
                      ariaLabel={`${t('p4g_int_enabled')} ${c.systemId}`}
                      onChange={async (on) => {
                        if (!(await stepUp(`${on ? t('p4g_int_on') : t('p4g_int_off')}: ${c.name}`))) return;
                        await integrationDesignerApi.setEnabled(c.id, on, user.id);
                        toast(`${c.name}: ${on ? t('p4g_int_on') : t('p4g_int_off')}`);
                      }}
                    />
                  )}
                  {canEdit && <Button size="small" icon="pen" title={t('p4g_int_edit')} onClick={() => setEditing(c)} />}
                  {canEdit && <Button size="small" icon="plug" title={t('svc_intTest')} onClick={() => setTesting(c)} className="ci-test" />}
                  <Button
                    size="small"
                    icon="download"
                    title="OpenAPI"
                    className="ci-openapi"
                    onClick={() => {
                      downloadBytes(safeFilename(`openapi-${c.systemId}`, 'json'), 'application/json', JSON.stringify(integrationDesignerApi.openApi(c), null, 2));
                      toast(t('p4g_int_openapiDone'));
                    }}
                  >
                    OpenAPI
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      {editing && <EditorDrawer initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {testing && <TestDrawer item={testing} onClose={() => setTesting(null)} />}
    </Card>
  );
}

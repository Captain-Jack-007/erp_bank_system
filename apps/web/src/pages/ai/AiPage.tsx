import { useEffect, useRef, useState } from 'react';
import { aiApi, api, formatDateTime, tk, type AiContractCheck, type AiRecognition } from '@xb/shared';
import { Badge, Card, DataTable, Empty, Field, Loading, PageHeader, Stat, Tabs, type Tone } from '../../components/ui';
import { Icon } from '../../components/icons';
import { Link } from '../../lib/router';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';

type Tab = 'chat' | 'recognize' | 'contracts' | 'audit';

export function AiPage() {
  const { t } = useSession();
  const [tab, setTab] = useState<Tab>('chat');
  const audit = useApi(() => aiApi.listAudit());
  const count = (a: string) => audit.data?.filter((x) => x.action === a).length ?? 0;

  return (
    <>
      <PageHeader title={t('ai_title')} subtitle={t('ai_subtitle')} />
      <div className="grid grid-4">
        <Stat label={t('ai_stat_requests')} value={audit.data?.length ?? 0} icon="sparkles" tone="accent" />
        <Stat label={t('ai_stat_docs')} value={count('recognize')} icon="file" />
        <Stat label={t('ai_stat_checks')} value={count('check_contract')} icon="check" />
        <Stat label={t('ai_stat_model')} value={<span style={{ fontSize: 16 }}>{t('ai_model_name')}</span>} icon="terminal" />
      </div>
      <div className="ai-note">
        <Icon name="alert" size={16} />
        <span>{t('ai_demo_note')}</span>
      </div>
      <Card flush>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'chat', label: t('ai_tab_chat') },
            { value: 'recognize', label: t('ai_tab_recognize') },
            { value: 'contracts', label: t('ai_tab_contracts') },
            { value: 'audit', label: t('ai_tab_audit'), count: audit.data?.length },
          ]}
        />
        {tab === 'chat' && <ChatTab />}
        {tab === 'recognize' && <RecognizeTab />}
        {tab === 'contracts' && <ContractsTab />}
        {tab === 'audit' && <AuditTab />}
      </Card>
    </>
  );
}

function ChatTab() {
  const { t, lang } = useSession();
  const user = useUser();
  const chat = useApi(() => aiApi.listChat());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const suggestions = [t('ai_suggest_1'), t('ai_suggest_2'), t('ai_suggest_3'), t('ai_suggest_4'), t('ai_suggest_5')];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.data?.length, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setText('');
    setBusy(true);
    try {
      await aiApi.ask(question, user, lang);
    } finally {
      setBusy(false);
    }
  }

  const messages = chat.data ?? [];
  return (
    <div className="chat">
      <div className="chat-log">
        <div className="msg assistant">
          <div className="bubble">{t('ai_welcome')}</div>
        </div>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="bubble">
              <div>{m.text}</div>
              {m.answer?.table && (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="table chat-table">
                    <thead>
                      <tr>{m.answer.table.headers.map((h) => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {m.answer.table.rows.map((r, i) => (
                        <tr key={i}>{r.map((c, j) => <td key={j} className={/\d/.test(c) && j > 0 ? 'num' : undefined}>{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!!m.answer?.links.length && (
                <div className="chat-links">
                  {m.answer.links.slice(0, 6).map((l) => (
                    <Link key={l.to + l.label} to={l.to} className="chip">
                      {l.label} →
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="msg-time">{formatDateTime(m.at)}</div>
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="bubble muted">{t('ai_thinking')}</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="chat-suggest">
        {suggestions.map((s) => (
          <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input className="input" value={text} placeholder={t('ai_placeholder')} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>
          <Icon name="sparkles" size={16} /> {t('ai_send')}
        </button>
        {messages.length > 0 && (
          <button type="button" className="btn" onClick={() => aiApi.clearChat()}>
            {t('ai_clear')}
          </button>
        )}
      </form>
    </div>
  );
}

function confTone(c: number): Tone {
  return c >= 0.9 ? 'ok' : c >= 0.7 ? 'warn' : 'danger';
}

function RecognizeTab() {
  const { t } = useSession();
  const user = useUser();
  const samples = useApi(() => aiApi.listSamples());
  const [selected, setSelected] = useState<string>('s1');
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<AiRecognition | null>(null);
  const [busy, setBusy] = useState(false);
  const sample = samples.data?.find((s) => s.id === selected);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await aiApi.recognize(pasted.trim() ? { text: pasted } : { sampleId: selected }, user));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-body">
      <div className="grid grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('ai_samples')}>
            <div className="user-list">
              {samples.data?.map((s) => (
                <button
                  key={s.id}
                  className={`user-option ${selected === s.id && !pasted.trim() ? 'on' : ''}`}
                  onClick={() => {
                    setSelected(s.id);
                    setPasted('');
                    setResult(null);
                  }}
                >
                  <div className="task-icon" style={{ width: 32, height: 32 }}>
                    <Icon name="file" size={16} />
                  </div>
                  <div className="name" style={{ fontWeight: 500 }}>{s.fileName}</div>
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('ai_or_paste')}>
            <textarea className="textarea" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          </Field>
          <div>
            <button className="btn btn-primary" onClick={run} disabled={busy}>
              <Icon name="sparkles" size={16} /> {t('ai_recognize')}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <pre className="ocr-text">{pasted.trim() || sample?.text}</pre>
        </div>
      </div>

      {busy && <Loading />}
      {result && (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 15 }}>{t('ai_result')}</h3>
            <Badge tone="info">{t(tk('ai_kind_', result.kind))}</Badge>
            <span className="muted small">
              {t('ai_confidence')}: {Math.round(result.kindConfidence * 100)}%
            </span>
          </div>
          <div className="card" style={{ boxShadow: 'none' }}>
            <DataTable
              rows={result.fields}
              rowKey={(f) => f.key}
              columns={[
                { header: t('ai_field'), render: (f) => t(tk('ai_field_', f.key)) },
                { header: t('ai_value'), render: (f) => <b className="num">{f.value}</b> },
                {
                  header: t('ai_confidence'),
                  render: (f) => (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <Badge tone={confTone(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
                      {f.confidence < 0.7 && <span className="error-text">{t('ai_low_conf')}</span>}
                    </span>
                  ),
                },
              ]}
            />
          </div>
          <div className="toolbar">
            <span className="muted">{t('ai_next_step')}:</span>
            {result.suggestion.kind === 'none' ? (
              <span>{t('ai_suggest_none')}</span>
            ) : (
              <Link to={result.suggestion.to} className="btn btn-sm">
                {t(tk('ai_suggest_', result.suggestion.kind))} →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const LEVEL_TONE: Record<string, Tone> = { high: 'danger', medium: 'warn', low: 'muted' };

function ContractsTab() {
  const { t } = useSession();
  const user = useUser();
  const lk = useLookups();
  const contracts = useApi(() => api.listContracts());
  const [id, setId] = useState('k3');
  const [result, setResult] = useState<(AiContractCheck & { text: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await aiApi.checkContract(id, user));
    } finally {
      setBusy(false);
    }
  }

  const scoreTone: Tone = !result ? 'muted' : result.score >= 80 ? 'ok' : result.score >= 50 ? 'warn' : 'danger';
  return (
    <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="toolbar">
        <select className="select" style={{ width: 'min(520px, 100%)' }} value={id} onChange={(e) => { setId(e.target.value); setResult(null); }}>
          {contracts.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.number} · {c.subject} · {lk.counterparty(c.counterpartyId)?.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={run} disabled={busy}>
          <Icon name="sparkles" size={16} /> {t('ai_check')}
        </button>
      </div>
      {busy && <Loading />}
      {result && (
        <div className="grid grid-main">
          <div className="card" style={{ boxShadow: 'none' }}>
            <div className="card-head">
              <h2>{t('ai_findings')}</h2>
              <Badge tone={scoreTone}>
                {t('ai_score')}: {result.score}/100
              </Badge>
            </div>
            {result.findings.length === 0 ? (
              <Empty text={t('ai_no_findings')} icon="check" />
            ) : (
              result.findings.map((f) => (
                <div key={f.code} className="task">
                  <Badge tone={LEVEL_TONE[f.level] ?? 'muted'}>{t(tk('ai_level_', f.level))}</Badge>
                  <div className="task-body">
                    <div style={{ fontWeight: 500 }}>{t(tk('ai_finding_', f.code))}</div>
                    {f.quote && <div className="task-meta">«{f.quote}»</div>}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="card" style={{ boxShadow: 'none' }}>
            <div className="card-head">
              <h2>{t('ai_contract_text')}</h2>
              <Link to={`/contracts/${id}`} className="small">{t('open')} →</Link>
            </div>
            <pre className="ocr-text" style={{ margin: 16 }}>{result.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditTab() {
  const { t } = useSession();
  const lk = useLookups();
  const audit = useApi(() => aiApi.listAudit());
  return (
    <DataTable
      rows={audit.data}
      loading={audit.loading}
      rowKey={(a) => a.id}
      columns={[
        { header: t('date'), render: (a) => <span className="num muted">{formatDateTime(a.at)}</span> },
        { header: t('ai_user'), render: (a) => lk.user(a.userId)?.fullName ?? a.userId },
        { header: t('type'), render: (a) => <Badge tone="info">{t(tk('ai_audit_action_', a.action))}</Badge> },
        { header: t('ai_request'), render: (a) => a.summary },
        { header: t('ai_duration'), align: 'right', render: (a) => a.durationMs },
      ]}
    />
  );
}

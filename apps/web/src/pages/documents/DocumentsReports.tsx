// СЭД: сводная папка АУР и закрытие операционного дня (PR-DOC-004…006, 016), отчёт по исполнительской
// дисциплине и акты о нарушениях (PR-DOC-013, 026, 027).
import { useState } from 'react';
import { documentsApi, formatDate, formatDateTime, formatMoney, pick, today, type DocumentDisciplineRow, type DocumentRecord } from '@xb/shared';
import { Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, Stat, Tabs, Textarea, type Column } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { PrintButton } from '../../components/PrintView';
import { navigate } from '../../lib/router';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { documentViolationPrint } from './shared';
import { Note, useAction, yearStart } from './p2docs';

export function AurPage() {
  const { t, lang } = useSession();
  const user = useUser();
  const can = useCan();
  const { busy, run } = useAction();
  const [day, setDay] = useState(today());
  const [justify, setJustify] = useState(false);
  const docs = useApi(() => documentsApi.list({ type: 'aur' }), []);
  const rec = useApi(() => documentsApi.getAurDay(day), [day]);
  const dayDocs = (docs.data ?? []).filter((d) => d.aur?.opDay === day);
  const r = rec.data;
  const canClose = can('documents', 'approve') || can('einvoices', 'edit');

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('documents_title'), to: '/documents' }, { label: pick(lang, 'Сводная папка АУР', 'MBX yig‘ma papkasi', 'Admin expense folder') }]}
        title={pick(lang, 'Сводная папка АУР за операционный день', 'Operatsion kun uchun MBX yig‘ma papkasi', 'Admin expense folder for the operational day')}
        subtitle={pick(lang, 'Сведение документов единых административно-управленческих расходов, сверка с ежедневным бухгалтерским журналом АБС и архивирование после закрытия дня', 'Ma’muriy-boshqaruv xarajatlari hujjatlarini yig‘ish, ABS kundalik jurnali bilan solishtirish va kun yopilgach arxivlash', 'Collecting admin expense documents, reconciling with the daily core-banking journal and archiving after day close')}
        actions={
          <ExportButton
            filename={`AUR-${day}`}
            columns={[
              { header: t('documents_regNumber'), value: (d: DocumentRecord) => d.number },
              { header: t('documents_subject'), value: (d: DocumentRecord) => d.subject },
              { header: pick(lang, 'МВЗ', 'XJM', 'Cost centre'), value: (d: DocumentRecord) => d.aur?.costCenterKey ?? '' },
              { header: pick(lang, 'Статья', 'Modda', 'Article'), value: (d: DocumentRecord) => d.aur?.article ?? '' },
              { header: pick(lang, 'Сумма', 'Summa', 'Amount'), value: (d: DocumentRecord) => d.aur?.amount ?? 0, format: 'money', total: true },
            ]}
            rows={dayDocs}
          />
        }
      />
      <Card>
        <div className="toolbar">
          <Field label={pick(lang, 'Операционный день', 'Operatsion kun', 'Operational day')}>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} ariaLabel={pick(lang, 'Операционный день', 'Operatsion kun', 'Operational day')} />
          </Field>
          <Button icon="refresh" disabled={busy || !dayDocs.length || r?.closed} onClick={() => run(() => documentsApi.aurReconcile(day, user), pick(lang, 'Сверка выполнена', 'Solishtirish bajarildi', 'Reconciled'))}>
            {pick(lang, 'Сверить с журналом АБС', 'ABS jurnali bilan solishtirish', 'Reconcile with core-banking journal')}
          </Button>
          {canClose && r && !r.closed && (
            <Button type="primary" icon="archive" disabled={busy} onClick={() => (r.diff !== 0 ? setJustify(true) : void run(() => documentsApi.aurCloseDay(day, user), pick(lang, 'Операционный день закрыт', 'Operatsion kun yopildi', 'Day closed')))}>
              {pick(lang, 'Закрыть день и архивировать', 'Kunni yopish va arxivlash', 'Close day and archive')}
            </Button>
          )}
        </div>
      </Card>
      {r && (
        <>
          <div className="grid grid-4">
            <Stat label={pick(lang, 'Документов в папке', 'Papkadagi hujjatlar', 'Documents in folder')} value={r.docs.length} icon="file" />
            <Stat label={pick(lang, 'Оборот по документам', 'Hujjatlar bo‘yicha aylanma', 'Documents turnover')} value={formatMoney(r.docsTotal)} icon="receipt" />
            <Stat label={pick(lang, 'Оборот по журналу АБС', 'ABS jurnali aylanmasi', 'Journal turnover')} value={formatMoney(r.journalTotal)} icon="book" />
            <Stat label={pick(lang, 'Расхождение', 'Farq', 'Difference')} value={formatMoney(r.diff)} {...(r.diff ? { tone: 'alert' as const } : {})} icon="alert" />
          </div>
          {r.closed ? (
            <Note tone="ok" icon="check">{pick(lang, `День закрыт ${r.closedAt ? formatDateTime(r.closedAt) : ''}; сводная папка передана в архив: ${r.archiveRef}`, `Kun yopildi ${r.closedAt ? formatDateTime(r.closedAt) : ''}; yig‘ma papka arxivga topshirildi: ${r.archiveRef}`, `Day closed ${r.closedAt ? formatDateTime(r.closedAt) : ''}; folder archived: ${r.archiveRef}`)}</Note>
          ) : r.diff !== 0 ? (
            <Note tone="warn">{pick(lang, 'Обороты не совпадают: проверьте проводки журнала без документа-основания', 'Aylanmalar mos emas: asos hujjatsiz provodkalarni tekshiring', 'Turnovers differ: check journal entries without a source document')}</Note>
          ) : (
            <Note tone="ok" icon="check">{pick(lang, 'Документы и журнал совпадают', 'Hujjatlar va jurnal mos', 'Documents and journal match')}</Note>
          )}
        </>
      )}
      <div className="grid grid-2">
        <Card title={pick(lang, 'Документы АУР за день', 'Kunlik MBX hujjatlari', 'Admin expense documents')} flush>
          <DataTable
            rows={dayDocs}
            loading={docs.loading}
            rowKey={(d) => d.id}
            onRowClick={(d) => navigate(`/documents/${d.id}`)}
            columns={[
              { header: t('documents_regNumber'), render: (d) => <span className="doc-num">{d.number}</span> },
              { header: t('documents_subject'), render: (d) => <span className="small">{d.subject}</span> },
              { header: pick(lang, 'МВЗ', 'XJM', 'Cost centre'), render: (d) => <span className="small">{d.aur?.costCenterKey}</span> },
              { header: pick(lang, 'Сумма', 'Summa', 'Amount'), align: 'right', render: (d) => formatMoney(d.aur?.amount ?? 0) },
              { header: pick(lang, 'Сверка', 'Solishtirish', 'Match'), render: (d) => (r ? (r.docs.find((x) => x.id === d.id)?.matched ? <Badge tone="ok">OK</Badge> : <Badge tone="danger">—</Badge>) : <span className="muted">—</span>) },
            ]}
          />
        </Card>
        <Card title={pick(lang, 'Бухгалтерский журнал АБС (счета АУР)', 'ABS buxgalteriya jurnali (MBX hisoblari)', 'Core-banking journal (admin expense accounts)')} flush>
          <DataTable
            rows={r?.journal}
            rowKey={(j) => j.ref}
            emptyText={pick(lang, 'Нажмите «Сверить с журналом АБС»', '«ABS jurnali bilan solishtirish» tugmasini bosing', 'Click "Reconcile"')}
            columns={[
              { header: pick(lang, 'Проводка / документ', 'Provodka / hujjat', 'Entry / document'), render: (j) => <span className="doc-num">{j.ref}</span> },
              { header: pick(lang, 'Счёт', 'Hisob', 'Account'), render: (j) => j.account },
              { header: pick(lang, 'Сумма', 'Summa', 'Amount'), align: 'right', render: (j) => formatMoney(j.amount) },
              { header: pick(lang, 'Сверка', 'Solishtirish', 'Match'), render: (j) => (j.matched ? <Badge tone="ok">OK</Badge> : <Badge tone="danger">{pick(lang, 'Нет документа', 'Hujjat yo‘q', 'No document')}</Badge>) },
            ]}
          />
        </Card>
      </div>
      {justify && r && <JustifyModal day={day} diff={r.diff} onClose={() => setJustify(false)} />}
    </>
  );
}

function JustifyModal({ day, diff, onClose }: { day: string; diff: number; onClose: () => void }) {
  const { t, lang } = useSession();
  const user = useUser();
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title={pick(lang, 'Закрытие дня с расхождением', 'Kunni farq bilan yopish', 'Close day with a difference')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="primary" loading={busy} onClick={async () => { if (!text.trim()) return setError(t('formRequired')); if (await run(() => documentsApi.aurCloseDay(day, user, text.trim()), pick(lang, 'День закрыт', 'Kun yopildi', 'Day closed'))) onClose(); }}>
            {pick(lang, 'Закрыть день', 'Kunni yopish', 'Close day')}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{pick(lang, 'Расхождение', 'Farq', 'Difference')}: <b className="num">{formatMoney(diff)}</b></p>
      <Field label={pick(lang, 'Обоснование', 'Asos', 'Justification')} required error={error}>
        <Textarea value={text} onChange={(e) => { setText(e.target.value); setError(''); }} rows={3} ariaLabel="justification" />
      </Field>
    </Modal>
  );
}

type DTab = 'executors' | 'acts';

export function DisciplinePage() {
  const { t, lang, loc } = useSession();
  const lk = useLookups();
  const [tab, setTab] = useState<DTab>('executors');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [dep, setDep] = useState('');
  const rows = useApi(() => documentsApi.discipline({ from, to, ...(dep ? { departmentId: dep } : {}) }), [from, to, dep]);
  const acts = useApi(() => documentsApi.violations());
  const list = rows.data ?? [];
  const totals = list.reduce((a, r) => ({ total: a.total + r.total, overdue: a.overdue + r.overdue, black: a.black + r.black, onTime: a.onTime + r.onTime, closed: a.closed + r.closed }), { total: 0, overdue: 0, black: 0, onTime: 0, closed: 0 });
  const userName = (id: string) => lk.user(id)?.fullName ?? id;
  const depName = (id: string) => (lk.department(id) ? loc(lk.department(id)!.name) : id);

  const cols: Column<DocumentDisciplineRow>[] = [
    { header: t('documents_executor'), render: (r) => <><b>{userName(r.executorId)}</b><div className="sub">{depName(r.departmentId)}</div></> },
    { header: pick(lang, 'Всего на контроле', 'Nazoratda jami', 'On control'), align: 'right', render: (r) => r.total },
    { header: pick(lang, 'Исполнено в срок', 'Muddatida ijro', 'On time'), align: 'right', render: (r) => r.onTime },
    { header: pick(lang, 'В работе', 'Ishda', 'Open'), align: 'right', render: (r) => r.open },
    { header: pick(lang, 'С просрочкой', 'Kechikkan', 'Overdue'), align: 'right', render: (r) => <span style={r.overdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.overdue}</span> },
    { header: pick(lang, '«Чёрные»', '«Qora»', 'Black'), align: 'right', render: (r) => r.black },
    { header: pick(lang, 'Дней просрочки', 'Kechikish kunlari', 'Days overdue'), align: 'right', render: (r) => r.overdueDays },
    { header: pick(lang, 'Снижение бонуса', 'Bonus kamayishi', 'Bonus cut'), align: 'right', render: (r) => (r.bonusCutPct ? <span style={{ color: 'var(--danger)' }}>−{r.bonusCutPct}%</span> : '0%') },
    { header: pick(lang, 'Автопринятие (24 ч)', 'Avto-qabul (24 s)', 'Auto-accepted'), align: 'right', render: (r) => r.autoAccepted },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('documents_title'), to: '/documents' }, { label: pick(lang, 'Исполнительская дисциплина', 'Ijro intizomi', 'Executive discipline') }]}
        title={pick(lang, 'Исполнительская дисциплина', 'Ijro intizomi', 'Executive discipline')}
        subtitle={pick(lang, 'Контроль сроков по исполнителям и подразделениям, акты о нарушениях и влияние на KPI (5% бонуса за каждый день просрочки)', 'Ijrochilar va bo‘linmalar bo‘yicha muddatlar nazorati, buzilish dalolatnomalari va KPI ga ta’siri (har bir kechikish kuni uchun bonusning 5%)', 'Deadline control by executor and unit, breach acts and KPI impact (5% of bonus per overdue day)')}
        actions={
          <ExportButton
            filename={pick(lang, 'Исполнительская дисциплина', 'Ijro intizomi', 'Executive discipline')}
            columns={[
              { header: t('documents_executor'), value: (r: DocumentDisciplineRow) => userName(r.executorId) },
              { header: t('department'), value: (r: DocumentDisciplineRow) => depName(r.departmentId) },
              { header: pick(lang, 'Всего', 'Jami', 'Total'), value: (r: DocumentDisciplineRow) => r.total, format: 'integer', total: true },
              { header: pick(lang, 'В срок', 'Muddatida', 'On time'), value: (r: DocumentDisciplineRow) => r.onTime, format: 'integer', total: true },
              { header: pick(lang, 'С просрочкой', 'Kechikkan', 'Overdue'), value: (r: DocumentDisciplineRow) => r.overdue, format: 'integer', total: true },
              { header: pick(lang, 'Дней просрочки', 'Kechikish kunlari', 'Days overdue'), value: (r: DocumentDisciplineRow) => r.overdueDays, format: 'integer', total: true },
              { header: pick(lang, 'Снижение бонуса, %', 'Bonus kamayishi, %', 'Bonus cut, %'), value: (r: DocumentDisciplineRow) => r.bonusCutPct, format: 'integer' },
            ]}
            rows={list}
          />
        }
      />
      <div className="grid grid-4">
        <Stat label={pick(lang, 'Документов на контроле', 'Nazoratdagi hujjatlar', 'On control')} value={totals.total} icon="file" />
        <Stat label={pick(lang, 'Исполнено в срок', 'Muddatida ijro', 'On time')} value={totals.closed ? `${Math.round((totals.onTime / totals.closed) * 100)}%` : '—'} icon="check" />
        <Stat label={pick(lang, 'С просрочкой', 'Kechikkan', 'Overdue')} value={totals.overdue} {...(totals.overdue ? { tone: 'alert' as const } : {})} icon="alert" />
        <Stat label={pick(lang, 'Акты о нарушениях', 'Buzilish dalolatnomalari', 'Breach acts')} value={acts.data?.length ?? '—'} icon="file" />
      </div>
      <Card flush>
        <Tabs<DTab> value={tab} onChange={setTab} items={[{ value: 'executors', label: pick(lang, 'По исполнителям', 'Ijrochilar bo‘yicha', 'By executor') }, { value: 'acts', label: pick(lang, 'Акты о нарушениях', 'Buzilish dalolatnomalari', 'Breach acts'), count: acts.data?.length }]} />
        {tab === 'executors' ? (
          <>
            <div className="p2-filter-wide">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} ariaLabel={pick(lang, 'Период с', 'Davr boshi', 'From')} />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} ariaLabel={pick(lang, 'Период по', 'Davr oxiri', 'To')} />
              <Select value={dep} onChange={setDep} placeholder={`${t('department')}: ${t('all')}`} options={lk.departments.map((d) => ({ value: d.id, label: loc(d.name) }))} />
            </div>
            <DataTable rows={rows.data} loading={rows.loading} columns={cols} rowKey={(r) => r.executorId} />
          </>
        ) : (
          <DataTable
            rows={acts.data}
            loading={acts.loading}
            rowKey={(d) => d.id}
            columns={[
              { header: pick(lang, 'Акт', 'Dalolatnoma', 'Act'), render: (d) => <><span className="doc-num">{d.violation!.actNumber}</span><div className="sub">{formatDate(d.violation!.at)}</div></> },
              { header: pick(lang, 'Документ', 'Hujjat', 'Document'), render: (d) => <a href={`#/documents/${d.id}`}>{d.number}</a> },
              { header: t('documents_executor'), render: (d) => userName(d.violation!.executorId) },
              { header: pick(lang, 'Просрочка', 'Kechikish', 'Overdue'), align: 'right', render: (d) => `${d.violation!.overdueDays} ${pick(lang, 'дн.', 'kun', 'd')}` },
              { header: pick(lang, 'Бонус', 'Bonus', 'Bonus'), align: 'right', render: (d) => `−${d.violation!.bonusCutPct}%` },
              { header: '', render: (d) => <PrintButton doc={documentViolationPrint(d, lang, userName(d.executorId), depName(d.departmentId))!} label={pick(lang, 'Печать', 'Chop etish', 'Print')} /> },
            ]}
          />
        )}
      </Card>
    </>
  );
}

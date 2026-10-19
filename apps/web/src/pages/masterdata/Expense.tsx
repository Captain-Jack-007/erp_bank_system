// Группы расходов и статьи (PR-MDM-005) + «амнистия» — переотнесение ошибочно классифицированной статьи
// к другой группе с записью в журнал аудита (PR-MDM-004).
import { useState } from 'react';
import { DqError, budgetingApi, formatMoneyShort, orgApi, type BudgetArticle } from '@xb/shared';
import { Badge, Button, Card, Field, Modal, Select, Textarea, useToast } from '../../components/ui';
import { FieldHistory } from '../../components/FieldHistory';
import { useCan } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useExpenseGroups } from './shared';

export function ExpenseTab() {
  const { t, loc } = useSession();
  const allowed = useCan();
  const canEdit = allowed('master-data', 'edit');
  const groups = useExpenseGroups();
  const articles = useApi(() => orgApi.listBudgetArticles());
  const bArticles = useApi(() => budgetingApi.listArticles(), []);
  const bLines = useApi(() => budgetingApi.listLines(), []);
  const [remap, setRemap] = useState<BudgetArticle | null>(null);
  // План/факт группы — по статьям модуля «Бюджетирование», связанным с кодом статьи MDM (mdmCode): переотнесение
  // статьи сразу переносит её расходы в другую группу (PR-MDM-004/005).
  const lineOf = (a: BudgetArticle): { planned: number; spent: number } | undefined => {
    const ids = (bArticles.data ?? []).filter((b) => b.mdmCode === a.code).map((b) => b.id);
    if (!ids.length) return undefined;
    const ls = (bLines.data ?? []).filter((l) => ids.includes(l.articleId));
    return { planned: ls.reduce((s, l) => s + l.plan.reduce((x, v) => x + v, 0), 0), spent: ls.reduce((s, l) => s + l.actual.reduce((x, v) => x + v, 0), 0) };
  };
  return (
    <div className="expense-grid">
      {groups.list.map((g) => {
        const list = (articles.data ?? []).filter((a) => a.groupId === g.id);
        const planned = list.reduce((s, a) => s + (lineOf(a)?.planned ?? 0), 0);
        const spent = list.reduce((s, a) => s + (lineOf(a)?.spent ?? 0), 0);
        return (
          <Card key={g.id} title={<div><span className="doc-num">{g.code}</span> <b>{loc(g.name)}</b> <Badge tone="muted">{list.length}</Badge></div>}>
            <div className="muted small exp-totals" style={{ marginBottom: 6 }}>{t('planned')}: <b className="num">{formatMoneyShort(planned)}</b> · {t('spent')}: <b className="num">{formatMoneyShort(spent)}</b></div>
            {!list.length ? (
              <span className="muted small">{t('exp_no_articles')}</span>
            ) : (
              <ul className="article-list">
                {list.map((a) => (
                  <li key={a.id}>
                    <div>
                      <span className="doc-num">{a.code}</span>
                      <div>{loc(a.name)}</div>
                      {lineOf(a) && <div className="muted small num">{formatMoneyShort(lineOf(a)!.spent)} / {formatMoneyShort(lineOf(a)!.planned)}</div>}
                    </div>
                    {canEdit && (
                      <Button size="small" type="link" onClick={() => setRemap(a)}>
                        {t('exp_remap')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {remap && <RemapModal article={remap} onClose={() => setRemap(null)} />}
    </div>
  );
}

function RemapModal({ article, onClose }: { article: BudgetArticle; onClose: () => void }) {
  const { t, loc } = useSession();
  const user = useUser();
  const toast = useToast();
  const groups = useExpenseGroups();
  const [groupId, setGroupId] = useState(article.groupId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title={`${t('exp_remap')}: ${article.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            onClick={async () => {
              setError('');
              if (groupId === article.groupId) return setError(t('exp_same_group'));
              try {
                await orgApi.remapArticle(article.id, groupId, reason, user);
                toast(`${article.code}: ${t('exp_remapped')}`);
                onClose();
              } catch (e) {
                setError(e instanceof DqError ? t('dq_required') : t('actionFailed'));
              }
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <p className="muted small" style={{ margin: 0 }}>{loc(article.name)} · {t('exp_remap_hint')}</p>
      <Field label={t('mdf_expenseGroupId')} required>
        <Select<string> value={groupId} onChange={setGroupId} options={groups.options} ariaLabel={t('mdf_expenseGroupId')} />
      </Field>
      <Field label={t('mdm_reason')} required error={error || undefined}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} ariaLabel={t('mdm_reason')} />
      </Field>
      <Field label={t('audit_history')}>
        <FieldHistory entity="budget_article" entityId={article.id} fieldLabel={(f) => (f === 'groupId' ? t('mdf_expenseGroupId') : f)} />
      </Field>
    </Modal>
  );
}

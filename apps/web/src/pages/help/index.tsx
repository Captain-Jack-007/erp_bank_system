// P4-GEN (ТЗ PR-TEC-007): встроенная справка пользователя на ru / uz (латиница и кириллица) / en.
// Оглавление с поиском: «Начало работы» (вход, 2FA, языки, интерфейс, согласования) и статья на каждый модуль
// меню; статья — назначение, основные экраны, пошаговые операции, роли и права (из действующей матрицы).
// Контекстная справка: кнопка «?» в верхней панели открывает /help/<id модуля>. Печать — через PrintView.
import { useMemo, useState } from 'react';
import { ACCESS_LEVELS, helpApi, registerModuleAccess, roleAccess, ROLES, tk, type AccessLevel, type HelpArticle, type Role } from '@xb/shared';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader } from '../../components/ui';
import { PrintButton } from '../../components/PrintView';
import { Icon } from '../../components/icons';
import { Link, navigate } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { useCan } from '../../lib/access';
import type { ModuleRoute } from '../../lib/routes';
import { MODULES, NAV_GROUPS, type ModuleDef } from '../../modules';
import '../../p4gen.css';

// Справка доступна всем ролям.
registerModuleAccess('help', Object.fromEntries(ROLES.map((r) => [r, 'view' as AccessLevel])));

function useTitles() {
  const { t, loc } = useSession();
  const mod = (id: string) => MODULES.find((m) => m.id === id);
  const modLabel = (m: ModuleDef) => (typeof m.name === 'string' ? t(m.name) : loc(m.name));
  return (a: HelpArticle | string): string => {
    const id = typeof a === 'string' ? a : a.id;
    const art = typeof a === 'string' ? undefined : a;
    if (art?.title) return loc(art.title);
    const m = mod(id);
    return m ? modLabel(m) : id;
  };
}

/** Весь текст статьи на текущем языке — для поиска и печати. */
function articleText(a: HelpArticle, loc: (v: { ru: string; uz: string; en?: string }) => string): string[] {
  return [loc(a.summary), ...(a.screens ?? []).map(loc), ...a.tasks.flatMap((x) => [loc(x.title), ...x.steps.map(loc)]), ...(a.tips ?? []).map(loc)];
}

/** Роли модуля по уровням из действующей матрицы прав. */
function rolesByLevel(moduleId: string): { level: AccessLevel; roles: Role[] }[] {
  const out: { level: AccessLevel; roles: Role[] }[] = [];
  for (const level of [...ACCESS_LEVELS].reverse()) {
    if (level === 'none') continue;
    const roles = ROLES.filter((r) => roleAccess(r, moduleId) === level);
    if (roles.length) out.push({ level, roles });
  }
  return out;
}

function Toc({ articles, current, query }: { articles: HelpArticle[]; current?: string; query: string }) {
  const { t, loc } = useSession();
  const title = useTitles();
  const can = useCan();
  const q = query.trim().toLowerCase();
  const byId = new Map(articles.map((a) => [a.id, a]));
  const matches = (id: string) => {
    if (!q) return true;
    const a = byId.get(id);
    return title(a ?? id).toLowerCase().includes(q) || (a ? articleText(a, loc).some((s) => s.toLowerCase().includes(q)) : false);
  };
  const groups: { key: string; label: string; ids: string[] }[] = [
    { key: 'start', label: t('p4g_help_start'), ids: helpApi.startIds },
    ...NAV_GROUPS.map((g) => ({ key: g, label: g === 'core' ? t('p4g_help_core') : t(tk('navGroup_', g)), ids: MODULES.filter((m) => m.group === g && m.id !== 'approvals').map((m) => m.id) })),
  ];
  const visible = groups.map((g) => ({ ...g, ids: g.ids.filter(matches) })).filter((g) => g.ids.length);
  return (
    <nav className="p4-help-toc" aria-label={t('p4g_help_toc')}>
      {!visible.length && <Empty text={t('p4g_help_nothing')} icon="search" />}
      {visible.map((g) => (
        <div key={g.key} className="p4-help-group">
          <div className="p4-help-group-title">{g.label}</div>
          {g.ids.map((id) => {
            const m = MODULES.find((x) => x.id === id);
            return (
              <Link key={id} to={`/help/${id}`} className={`p4-help-link ${current === id ? 'on' : ''}`} data-help-id={id}>
                <span>{title(byId.get(id) ?? id)}</span>
                {m && !can(m.id) && <span className="p4-help-noacc">{t('p4g_help_noAccess')}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SearchResults({ articles, query }: { articles: HelpArticle[]; query: string }) {
  const { t, loc } = useSession();
  const title = useTitles();
  const q = query.trim().toLowerCase();
  const hits = articles
    .map((a) => ({ a, text: articleText(a, loc), title: title(a) }))
    .map((x) => ({ ...x, snippet: x.text.find((s) => s.toLowerCase().includes(q)) }))
    .filter((x) => x.title.toLowerCase().includes(q) || x.snippet);
  return (
    <Card title={`${t('p4g_help_results')}: ${hits.length}`}>
      {!hits.length ? (
        <Empty text={t('p4g_help_nothing')} icon="search" />
      ) : (
        <ul className="p4-help-hits">
          {hits.map((h) => (
            <li key={h.a.id} data-testid="help-hit">
              <Link to={`/help/${h.a.id}`}>{h.title}</Link>
              {h.snippet && <div className="small muted">{h.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ArticleView({ id, article }: { id: string; article?: HelpArticle }) {
  const { t, loc } = useSession();
  const title = useTitles();
  const module = MODULES.find((m) => m.id === id);
  const roles = module ? rolesByLevel(module.id) : [];
  const roleNames = (rs: Role[]) => rs.map((r) => t(tk('role_', r))).join(', ');
  const name = article ? title(article) : title(id);
  const printDoc = () => ({
    entity: 'help',
    entityId: id,
    title: `${t('p4g_help_title')}: ${name}`,
    paragraphs: article
      ? [
          `${t('p4g_help_purpose')}. ${loc(article.summary)}`,
          ...(article.screens?.length ? [`${t('p4g_help_screens')}: ${article.screens.map(loc).join('; ')}.`] : []),
          ...article.tasks.map((x) => `${loc(x.title)}: ${x.steps.map((s, i) => `${i + 1}) ${loc(s)}`).join(' ')}`),
          ...(article.tips ?? []).map((x) => `${t('p4g_help_tips')}: ${loc(x)}`),
        ]
      : [t('p4g_help_noArticle')],
    ...(roles.length ? { table: { columns: [{ header: t('p4g_help_level') }, { header: t('p4g_help_rolesCol') }], rows: roles.map((r) => [t(tk('acc_level_', r.level)), roleNames(r.roles)]) } } : {}),
  });
  return (
    <article className="p4-help-article" data-testid="help-article" data-id={id}>
      <div className="p4-help-head">
        <div>
          <div className="small muted">{module?.tz ? `${t('tzLabel')} ${module.tz}` : t('p4g_help_start')}</div>
          <h2>{name}</h2>
        </div>
        <div className="p4-help-actions">
          {module && module.id !== 'help' && (
            <Button size="small" icon="arrowLeft" onClick={() => navigate(module.path)} className="help-back">
              {t('p4g_help_back')}
            </Button>
          )}
          <PrintButton doc={printDoc} label={t('svc_print')} />
          <Button size="small" icon="alert" onClick={() => navigate(`/service-desk?new=1&m=${encodeURIComponent(id)}`)}>
            {t('p4g_help_report')}
          </Button>
        </div>
      </div>
      {!article ? (
        <p className="muted">{t('p4g_help_noArticle')}</p>
      ) : (
        <>
          <section>
            <h3>{t('p4g_help_purpose')}</h3>
            <p>{loc(article.summary)}</p>
          </section>
          {article.screens?.length ? (
            <section>
              <h3>{t('p4g_help_screens')}</h3>
              <ul>
                {article.screens.map((s, i) => (
                  <li key={i}>{loc(s)}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {article.tasks.map((x, i) => (
            <section key={i} className="p4-help-task">
              <h3>
                <Icon name="check" size={16} /> {loc(x.title)}
              </h3>
              <ol>
                {x.steps.map((s, j) => (
                  <li key={j}>{loc(s)}</li>
                ))}
              </ol>
            </section>
          ))}
          {article.tips?.length ? (
            <section className="p4-help-tip">
              <h3>{t('p4g_help_tips')}</h3>
              {article.tips.map((s, i) => (
                <p key={i}>{loc(s)}</p>
              ))}
            </section>
          ) : null}
        </>
      )}
      {module && (
        <section>
          <h3>{t('p4g_help_roles')}</h3>
          <p className="small muted">{t('p4g_help_rolesHint')}</p>
          <div className="p4-help-roles" data-testid="help-roles">
            {roles.map((r) => (
              <div key={r.level} className="p4-help-role-row">
                <Badge tone={r.level === 'admin' ? 'danger' : r.level === 'approve' ? 'warn' : r.level === 'edit' ? 'info' : 'muted'}>{t(tk('acc_level_', r.level))}</Badge>
                <span>{roleNames(r.roles)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {article?.related?.length ? (
        <section>
          <h3>{t('p4g_help_related')}</h3>
          <div className="p4-help-related">
            {article.related.map((r) => (
              <Link key={r} to={`/help/${r}`}>
                {title(r)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function HelpPage({ id }: { id?: string }) {
  const { t } = useSession();
  const list = useApi(() => helpApi.list());
  const [query, setQuery] = useState('');
  const articles = list.data ?? [];
  const article = useMemo(() => articles.find((a) => a.id === id), [articles, id]);
  return (
    <>
      <PageHeader title={t('p4g_help_title')} subtitle={`${t('tzLabel')} PR-TEC-007 · ${t('p4g_help_subtitle')}`} />
      <div className={`p4-help ${id ? 'has-article' : ''}`}>
        <aside className="p4-help-side">
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('p4g_help_search')} ariaLabel={t('p4g_help_search')} className="help-search" />
          {list.loading && !list.data ? <Loading /> : <Toc articles={articles} current={id} query={query} />}
        </aside>
        <div className="p4-help-main">
          {id && (
            <Link to="/help" className="p4-help-toclink small">
              ← {t('p4g_help_toc')}
            </Link>
          )}
          {query.trim() ? <SearchResults articles={articles} query={query} /> : id ? list.data ? <ArticleView id={id} article={article} /> : <Loading /> : (
            <Card title={t('p4g_help_welcome')}>
              <p style={{ marginTop: 0 }}>{t('p4g_help_intro')}</p>
              <div className="p4-help-related">
                {helpApi.startIds.map((s) => (
                  <Link key={s} to={`/help/${s}`}>
                    <StartTitle id={s} articles={articles} />
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function StartTitle({ id, articles }: { id: string; articles: HelpArticle[] }) {
  const title = useTitles();
  const a = articles.find((x) => x.id === id);
  return <>{title(a ?? id)}</>;
}

export const routes: ModuleRoute[] = [
  { path: '/help', render: () => <HelpPage /> },
  { path: '/help/:id', render: (p) => <HelpPage id={p.id} /> },
];

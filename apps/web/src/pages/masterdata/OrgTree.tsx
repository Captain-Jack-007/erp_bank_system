// Оргструктура: дерево «головной офис → филиалы → ЦБУ/отделы» на выбранную дату (SCD Type 2 — структура
// «как была» на любую дату в прошлом, PR-MDM-002).
import { useMemo, useState } from 'react';
import { formatDate, orgApi, type OrgUnit } from '@xb/shared';
import { Button, Empty, Input, Loading } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useCan } from '../../lib/access';
import { navigate } from '../../lib/router';
import { useSession } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ChangeDrawer, OrgTypeBadge, todayIso, useOrgUnits } from './shared';

export function OrgTreeTab({ today }: { today?: { units: ReturnType<typeof useOrgUnits>; counts: Record<string, number> | undefined } }) {
  const { t, loc } = useSession();
  const lk = useLookups();
  const allowed = useCan();
  const canEdit = allowed('master-data', 'edit');
  const [asOf, setAsOf] = useState(todayIso());
  const isHistoric = asOf !== todayIso();
  const histUnits = useOrgUnits(isHistoric ? asOf : 'skip');
  const histCounts = useApi(() => (isHistoric ? orgApi.costCenterCounts(asOf) : Promise.resolve(undefined)), [asOf]);
  const units = !isHistoric && today ? today.units : histUnits;
  const counts = { data: !isHistoric && today ? today.counts : histCounts.data };
  const [open, setOpen] = useState<Set<string>>(() => new Set(['HO']));
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const children = useMemo(() => {
    const m = new Map<string | null, OrgUnit[]>();
    for (const u of units.list) {
      const arr = m.get(u.parentKey) ?? [];
      arr.push(u);
      m.set(u.parentKey, arr);
    }
    const order = { department: 0, region: 1, branch_office: 2, head_office: 3 } as const;
    for (const arr of m.values()) arr.sort((a, b) => order[a.type] - order[b.type] || a.code.localeCompare(b.code));
    return m;
  }, [units.list]);

  // поиск: совпадения + их предки
  const visible = useMemo(() => {
    if (!q.trim()) return null;
    const needle = q.trim().toLowerCase();
    const hit = units.list.filter((u) => `${u.code} ${u.name.ru} ${u.name.uz} ${u.cbuCode ?? ''}`.toLowerCase().includes(needle));
    const keep = new Set<string>();
    for (const h of hit) {
      let cur: OrgUnit | undefined = h;
      while (cur) {
        keep.add(cur.key);
        cur = cur.parentKey ? units.get(cur.parentKey) : undefined;
      }
    }
    return keep;
  }, [q, units.list]);

  const total = (key: string): number => (counts.data?.[key] ?? 0) + (children.get(key) ?? []).reduce((s, c) => s + total(c.key), 0);

  const rows: { u: OrgUnit; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of children.get(parent) ?? []) {
      if (visible && !visible.has(u.key)) continue;
      rows.push({ u, depth });
      if (visible || open.has(u.key)) walk(u.key, depth + 1);
    }
  };
  walk(null, 0);

  const toggle = (key: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  return (
    <>
      <div className="toolbar" style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('search')}: ${t('org_search_hint')}`} />
        <span className="as-of">
          <span className="muted small">{t('org_as_of')}</span>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || todayIso())} ariaLabel={t('org_as_of')} />
        </span>
        <Button size="small" onClick={() => setOpen(new Set(units.list.map((u) => u.key)))}>{t('org_expand')}</Button>
        <Button size="small" onClick={() => setOpen(new Set(['HO']))}>{t('org_collapse')}</Button>
        <div style={{ flex: 1 }} />
        {canEdit && !isHistoric && <Button type="primary" icon="plus" onClick={() => setCreating(true)}>{t('org_new')}</Button>}
      </div>
      {isHistoric && <div className="banner info" style={{ margin: 14 }}>{t('org_historic').replace('{date}', formatDate(asOf))}</div>}
      {units.loading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty text={t('search_nothing')} />
      ) : (
        <div className="table-wrap">
          <table className="table tree-table">
            <thead>
              <tr>
                <th>{t('org_unit')}</th>
                <th>{t('code')}</th>
                <th>{t('org_type')}</th>
                <th>{t('mdf_cbuCode')}</th>
                <th>{t('mdf_headUserId')}</th>
                <th className="right">{t('md_tab_cc')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ u, depth }) => {
                const kids = (children.get(u.key) ?? []).length;
                return (
                  <tr key={u.key} className="clickable" data-key={u.key} onClick={() => navigate(`/master-data/org/${u.key}`)}>
                    <td>
                      <div className="tree-cell" style={{ paddingLeft: depth * 18 }}>
                        {kids ? (
                          <button
                            type="button"
                            className="tree-toggle"
                            aria-label={`${loc(u.name)}: ${open.has(u.key) ? t('org_collapse') : '+'}`}
                            aria-expanded={!!visible || open.has(u.key)}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(u.key);
                            }}
                          >
                            <Icon name="chevronRight" size={14} style={{ transform: visible || open.has(u.key) ? 'rotate(90deg)' : undefined }} />
                          </button>
                        ) : (
                          <span className="tree-leaf" />
                        )}
                        <span style={{ fontWeight: depth < 2 ? 600 : 400 }}>{loc(u.name)}</span>
                        {kids > 0 && <span className="muted small"> · {kids}</span>}
                      </div>
                    </td>
                    <td className="doc-num">{u.code}</td>
                    <td><OrgTypeBadge type={u.type} /></td>
                    <td className="num">{u.cbuCode ?? '—'}</td>
                    <td>{u.headUserId ? lk.user(u.headUserId)?.fullName ?? u.headUserId : '—'}</td>
                    <td className="right num">{total(u.key)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <ChangeDrawer entity="org_unit" action="create" onClose={() => setCreating(false)} />}
    </>
  );
}

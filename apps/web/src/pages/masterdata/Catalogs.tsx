// Классификаторы MDM (PR-MDM-001): регионы, бизнес-сегменты, каналы продаж, типы оргединиц, продукты банка (FTP),
// реестр проектов (Бюджетирование) — единый каталог со ссылками на ведущие модули.
import { BUSINESS_SEGMENTS, SALES_CHANNELS, budgetingApi, formatMoneyShort, ftpApi, tk } from '@xb/shared';
import { Link } from '../../lib/router';
import { useApi } from '../../lib/useApi';
import { Card } from '../../components/ui';
import { useSession } from '../../lib/session';
import { ORG_TYPES, useOrgUnits } from './shared';

export function CatalogsTab() {
  const { t, loc } = useSession();
  const units = useOrgUnits();
  const regions = units.list.filter((u) => u.type === 'region');
  const products = useApi(() => ftpApi.listProducts(), []);
  const projects = useApi(() => budgetingApi.listProjects(), []);
  return (
    <div className="catalog-grid">
      <Card title={t('cat_regions')}>
        <ul className="cat-list">
          {regions.map((r) => (
            <li key={r.key}>
              <span className="doc-num">{r.regionCode}</span> {loc(r.name)}
              <span className="muted small"> · {units.list.filter((u) => u.parentKey === r.key && u.type === 'branch_office').length} {t('cat_offices')}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('cat_segments')}>
        <ul className="cat-list">
          {BUSINESS_SEGMENTS.map((s) => (
            <li key={s}><span className="doc-num">{s.toUpperCase()}</span> {t(tk('seg_', s))}</li>
          ))}
        </ul>
      </Card>
      <Card title={t('cat_channels')}>
        <ul className="cat-list">
          {SALES_CHANNELS.map((c) => (
            <li key={c}><span className="doc-num">{c.toUpperCase()}</span> {t(tk('channel_', c))}</li>
          ))}
        </ul>
      </Card>
      <Card title={t('cat_org_types')}>
        <ul className="cat-list">
          {ORG_TYPES.map((x) => (
            <li key={x}>{t(tk('org_type_', x))} <span className="muted small">· {units.list.filter((u) => u.type === x).length}</span></li>
          ))}
        </ul>
      </Card>
      <Card title={t('cat_products')}>
        <ul className="cat-list">
          {(products.data ?? []).map((p) => (
            <li key={p.id}>
              <Link to={`/ftp/products/${p.id}`}>{loc(p.name)}</Link>
              <span className="muted small"> · {p.currency} · {p.side === 'asset' ? '↑' : '↓'} {formatMoneyShort(p.balance)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('cat_projects')}>
        <ul className="cat-list">
          {(projects.data ?? []).map((p) => (
            <li key={p.id}>
              <span className="doc-num">{p.code}</span> <Link to={`/budgeting/projects/${p.id}`}>{p.name}</Link>
              <span className="muted small"> · {formatMoneyShort(p.budget)}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">{t('cat_products_note')}</p>
      </Card>
    </div>
  );
}

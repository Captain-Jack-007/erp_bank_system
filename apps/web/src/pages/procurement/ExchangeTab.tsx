// Биржевые закупки через УзРТСБ (PR-PROC-027…032): заявки «биржа», лоты, статусы, итоги, котировки.
import { useState } from 'react';
import { api, formatDateTime, formatMoney, procApi, procurementTotal, tk } from '@xb/shared';
import { Button, Card, DataTable, useToast } from '../../components/ui';
import { ExportButton } from '../../components/Export';
import { navigate } from '../../lib/router';
import { useCan, GuardedLink } from '../../lib/access';
import { useSession, useUser } from '../../lib/session';
import { useApi, useLookups } from '../../lib/useApi';
import { ToneBadge, useErr, useIsBuyer } from './shared';

export function ExchangeTab() {
  const { t, loc } = useSession();
  const user = useUser();
  const can = useCan();
  const toast = useToast();
  const err = useErr();
  const lk = useLookups();
  const reqs = useApi(() => api.listProcurement().then((r) => r.filter((x) => x.method === 'exchange' || x.exchange)), []);
  const quotes = useApi(() => procApi.listQuotes(), []);
  const catalog = useApi(() => procApi.listCatalog(), []);
  const [busy, setBusy] = useState(false);
  const isBuyer = useIsBuyer();

  return (
    <div className="pc-stack pc-pad">
      <div className="pc-note">
        {t('proc_exHint')} <GuardedLink to="/integrations" hideIfDenied>{t('proc_openIntegrations')}</GuardedLink>
      </div>
      <Card title={t('proc_exLots')} flush>
        <DataTable
          rows={reqs.data}
          loading={reqs.loading}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/procurement/${r.id}`)}
          columns={[
            { header: t('number'), render: (r) => <span className="doc-num">{r.number}</span> },
            { header: t('title'), render: (r) => r.title },
            { header: t('proc_exLot'), render: (r) => r.exchange?.lotNo ?? '—' },
            { header: t('proc_exStart'), align: 'right', render: (r) => formatMoney(r.exchange?.startPrice ?? procurementTotal(r.items)) },
            { header: t('proc_exPrice'), align: 'right', render: (r) => (r.exchange?.price ? formatMoney(r.exchange.price) : '—') },
            { header: t('winner'), render: (r) => (r.exchange?.winnerId ? lk.counterparty(r.exchange.winnerId)?.name : '—') },
            { header: t('status'), render: (r) => (r.exchange ? <ToneBadge status={r.exchange.status === 'won' ? 'approved' : r.exchange.status === 'failed' ? 'rejected' : 'pending'} label={t(tk('proc_ex_', r.exchange.status))} /> : <ToneBadge status={r.status} label={t(tk('pstatus_', r.status))} />) },
          ]}
        />
      </Card>
      <Card
        title={t('proc_quotes')}
        actions={
          <span className="pc-row">
            {isBuyer && (
              <Button
                size="small"
                icon="refresh"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await procApi.fetchQuotes(user);
                    toast(t('proc_quotesFetched'));
                  } catch (e) {
                    toast(`${t('actionFailed')}: ${err(e)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('proc_fetchQuotes')}
              </Button>
            )}
            <ExportButton
              filename={t('proc_quotes')}
              rows={quotes.data ?? []}
              columns={[
                { header: t('itemName'), value: (q) => loc(catalog.data?.find((c) => c.id === q.catalogId)?.name ?? { ru: q.catalogId, uz: q.catalogId }) },
                { header: t('proc_qMin'), value: (q) => q.min, format: 'money' },
                { header: t('proc_qAvg'), value: (q) => q.avg, format: 'money' },
                { header: t('proc_qMax'), value: (q) => q.max, format: 'money' },
                { header: t('proc_qDeals'), value: (q) => q.deals, format: 'integer' },
              ]}
            />
          </span>
        }
        flush
      >
        <DataTable
          rows={quotes.data}
          loading={quotes.loading}
          rowKey={(q) => q.catalogId}
          emptyText={t('proc_noQuotes')}
          columns={[
            { header: t('itemName'), render: (q) => { const c = catalog.data?.find((x) => x.id === q.catalogId); return c ? <>{loc(c.name)}<div className="sub">{c.code} · {t('proc_refPrice')}: {formatMoney(c.refPrice)}</div></> : q.catalogId; } },
            { header: t('proc_qMin'), align: 'right', render: (q) => formatMoney(q.min) },
            { header: t('proc_qAvg'), align: 'right', render: (q) => formatMoney(q.avg) },
            { header: t('proc_qMax'), align: 'right', render: (q) => formatMoney(q.max) },
            { header: t('proc_qDeals'), align: 'right', render: (q) => q.deals },
            { header: t('date'), render: (q) => <span className="muted small">{formatDateTime(q.at)}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

// API модуля «Анализ операций»: всё считается из журнала согласований, помесячной статистики модулей,
// активности пользователей и текущих задач движка согласований.
import { clone, delay } from '../../bus';
import { approvalEngine } from '../../engine';
import { localize, pick } from '../../i18n';
import { matches, registerSearchProvider } from '../../search';
import type { ApprovalEntity, Role } from '../../types';
import { OPERATIONS_MODULES, OPERATIONS_MONTHS, OPERATIONS_SLA, operationsActivitySeed, operationsLogSeed, operationsMonthlySeed } from './data';
import type { OperationsAnalysis, OperationsApprovalLog, OperationsFilter } from './types';

export { OPERATIONS_MODULES, OPERATIONS_SLA };

const db = {
  monthly: clone(operationsMonthlySeed),
  log: clone(operationsLogSeed),
  activity: clone(operationsActivitySeed),
};

const hoursOf = (l: OperationsApprovalLog) => (new Date(l.finishedAt).getTime() - new Date(l.startedAt).getTime()) / 3_600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function p90(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]!;
}

export function computeOperationsAnalysis(filter: OperationsFilter): OperationsAnalysis {
  const months = OPERATIONS_MONTHS.slice(-filter.months);
  const moduleInfo = filter.module ? OPERATIONS_MODULES.find((m) => m.key === filter.module) : undefined;
  const entityFilter: ApprovalEntity | null | undefined = filter.module ? (moduleInfo?.entity ?? null) : undefined;

  const inPeriod = (iso: string) => months.includes(iso.slice(0, 7));
  const logs = db.log.filter((l) => inPeriod(l.startedAt) && (entityFilter === undefined || l.entity === entityFilter));
  const monthly = db.monthly.filter((m) => months.includes(m.month) && (!filter.module || m.module === filter.module));
  const live = approvalEngine.all().filter((t) => t.status === 'pending' && (entityFilter === undefined || t.entity === entityFilter));
  const nowMs = Date.now();

  // Нагрузка по модулям
  const modules = filter.module ? OPERATIONS_MODULES.filter((m) => m.key === filter.module) : OPERATIONS_MODULES;
  const byModule = modules
    .map((m) => {
      const values = months.map((mo) => db.monthly.find((r) => r.month === mo && r.module === m.key)?.created ?? 0);
      return { module: m.key, values, total: values.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.total - a.total);

  // Динамика: создано / закрыто / накопленный остаток
  let backlog = 0;
  const trend = months.map((month) => {
    const rs = monthly.filter((m) => m.month === month);
    const created = rs.reduce((s, r) => s + r.created, 0);
    const closed = rs.reduce((s, r) => s + r.closed, 0);
    backlog += created - closed;
    return { month, created, closed, backlog };
  });

  // Длительность согласования по типам документов: сумма этапов на документ ≈ сумма средних по шагам
  const entities = [...new Set(logs.map((l) => l.entity))];
  const cycle = entities
    .map((entity) => {
      const ls = logs.filter((l) => l.entity === entity);
      const steps = [...new Set(ls.map((l) => l.step))];
      const avgPerStep = steps.map((s) => avg(ls.filter((l) => l.step === s).map(hoursOf)));
      const p90PerStep = steps.map((s) => p90(ls.filter((l) => l.step === s).map(hoursOf)));
      return {
        entity,
        count: ls.length,
        avgHours: round1(avgPerStep.reduce((a, b) => a + b, 0)),
        p90Hours: round1(p90PerStep.reduce((a, b) => a + b, 0)),
        rejectPct: round1((ls.filter((l) => l.decision === 'rejected').length / ls.length) * 100),
      };
    })
    .sort((a, b) => b.avgHours - a.avgHours);

  // Узкие места: по ролям этапов
  const roles = [...new Set([...logs.map((l) => l.role), ...live.map((t) => t.assigneeRole)])] as Role[];
  const bottlenecks = roles
    .map((role) => {
      const ls = logs.filter((l) => l.role === role);
      const sla = OPERATIONS_SLA[role];
      const breaches = ls.filter((l) => hoursOf(l) > sla).length;
      const open = live.filter((t) => t.assigneeRole === role);
      return {
        role,
        steps: ls.length,
        avgHours: round1(avg(ls.map(hoursOf))),
        slaHours: sla,
        breaches,
        breachPct: ls.length ? round1((breaches / ls.length) * 100) : 0,
        openNow: open.length,
        overdueNow: open.filter((t) => new Date(t.dueAt).getTime() < nowMs).length,
      };
    })
    .sort((a, b) => b.breachPct - a.breachPct);

  // Активность подразделений
  const acts = db.activity.filter((a) => months.includes(a.month));
  const deptIds = [...new Set(acts.map((a) => a.departmentId))];
  const departments = deptIds
    .map((departmentId) => {
      const rs = acts.filter((a) => a.departmentId === departmentId);
      const actions = rs.reduce((s, r) => s + r.actions, 0);
      const activeUsers = Math.round(avg(rs.map((r) => r.activeUsers)));
      return { departmentId, actions, activeUsers, perUser: activeUsers ? Math.round(actions / activeUsers / months.length) : 0 };
    })
    .sort((a, b) => b.actions - a.actions);

  const allHours = logs.map(hoursOf);
  const totalBreaches = logs.filter((l) => hoursOf(l) > OPERATIONS_SLA[l.role]).length;
  return {
    months,
    kpis: {
      processed: monthly.reduce((s, r) => s + r.closed, 0),
      avgCycleHours: round1(avg(allHours)),
      slaBreachPct: logs.length ? round1((totalBreaches / logs.length) * 100) : 0,
      openNow: live.length,
      overdueNow: live.filter((t) => new Date(t.dueAt).getTime() < nowMs).length,
    },
    byModule,
    trend,
    cycle,
    bottlenecks,
    departments,
  };
}

export const operationsApi = {
  modules: OPERATIONS_MODULES,
  getAnalysis: (filter: OperationsFilter) => delay(computeOperationsAnalysis(filter)),
};

// Глобальный поиск: модули системы → анализ операций с фильтром по модулю.
registerSearchProvider((q, lang) =>
  OPERATIONS_MODULES.filter((m) => matches(q, m.name.ru, m.name.uz)).map((m) => ({
    group: 'operations_title',
    title: localize(m.name, lang),
    subtitle: pick(lang, 'Нагрузка, SLA и узкие места', 'Yuklama, SLA va tor joylar', 'Workload, SLA and bottlenecks'),
    to: `/operations?module=${m.key}`,
  })),
);

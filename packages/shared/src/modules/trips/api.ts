// API модуля «Командировки» (ТЗ 4.2.11): заявление, расчёт аванса по нормам (суточные городов/стран с валютой и
// временем в пути, проживание и класс проезда по грейду должности, прочие расходы), маршрут Руководитель → HR →
// Финансы (движок) с проверкой бюджетного лимита (модуль бюджетирования), приказ в журнале приказов СЭД с ЭЦП,
// выплата аванса (касса / карта через АБС), авансовый отчёт со сканами, проверка HR против норм (E-IMZO),
// окончательный расчёт и проводки в АБС, журнал, нормы, отчёты.
import { clone, delay, emit, historyEvent, nextId, nextNumber, now, today } from '../../bus';
import { audit } from '../../audit';
import { directory } from '../../directory';
import { approvalEngine, ROUTE_RATES } from '../../engine';
import { formatNumber } from '../../format';
import { pick, tk, translate } from '../../i18n';
import { notify } from '../../notifications';
import { matches, registerSearchProvider } from '../../search';
import { can, registerModuleAccess } from '../../security';
import { filesApi } from '../../services/files';
import { utf8Encode } from '../../services/bytes';
import { integrationHub, IntegrationUnavailableError } from '../../services/integrations';
import { signatureService } from '../../services/signature';
import type { ID, Lang, Localized, User } from '../../types';
import { archiveApi, registerArchiveSource } from '../archive/api';
import { budgetingApi, BudgetingControlError } from '../budgeting/api';
import { documentsApi } from '../documents/api';
import { registerDocsIntegrationOps } from '../documents/integrationOps';
import { tripApprovalSeed, tripDestinations, tripGradeNorms, tripSeed } from './data';
import { registerTripBookingSystems, TRIP_BOOKING_SYSTEMS, TRIP_ROUTE_KM, type TripProviderOffer } from './booking';
import type {
  NewTripInput,
  TripBooking,
  TripBookingKind,
  TripBookingOffer,
  TripCommitted,
  TripNormIssue,
  TripBudgetCheck,
  TripBudgetRow,
  TripCalc,
  TripDestination,
  TripDeviation,
  TripExpenseLine,
  TripFilter,
  TripGrade,
  TripGradeNorm,
  TripJournalStatus,
  TripNorms,
  TripPosting,
  TripReportRow,
  TripRequest,
  TripSettlement,
  TripStats,
} from './types';
import { apiError } from '../../errors';

registerDocsIntegrationOps();
registerTripBookingSystems();
// Права по умолчанию для ролей без явной настройки: любой сотрудник оформляет свои командировки, финансы согласуют
// (этап «Финансы: бюджетный лимит») и видят отчёты, кассир — выдача аванса наличными.
registerModuleAccess('trips', { finance: 'approve', procurement: 'edit', legal: 'edit', treasury: 'edit', data_entry: 'edit', analyst: 'edit', cash_operator: 'edit', storekeeper: 'edit', archivist: 'edit', tax_officer: 'edit', support: 'edit', auditor: 'view' });

const db: TripRequest[] = clone(tripSeed);
const byId = (id: ID) => db.find((t) => t.id === id);
const norms = { destinations: clone(tripDestinations), grades: clone(tripGradeNorms) };
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const who = (u: User) => ({ id: u.id, fullName: u.fullName, role: u.role });
/** Статья бюджета «Командировочные расходы» (модуль бюджетирования). */
export const TRIP_BUDGET_ARTICLE = 'ba7';
export const TRIP_EXPENSE_CATEGORIES = ['transport', 'hotel', 'per_diem', 'visa', 'insurance', 'hospitality', 'other'] as const;

export function tripDestination(id: string): TripDestination | undefined {
  return norms.destinations.find((d) => d.id === id);
}

/** Город и страна направления на языке интерфейса. */
export function tripPlace(d: TripDestination | undefined, lang: Lang): { city: string; country: string } {
  if (!d) return { city: '', country: '' };
  return { city: pick(lang, d.city, d.cityUz, d.cityEn), country: pick(lang, d.country, d.countryUz, d.countryEn) };
}
const destText = (id: string) => {
  const d = tripDestination(id);
  return d ? `${d.city} ${d.cityUz} ${d.cityEn ?? ''} ${d.country} ${d.countryUz}` : '';
};

/** Грейд должности сотрудника: руководство (руководители подразделений и директора) / специалисты. */
export function tripGradeOf(userId: ID): TripGrade {
  const u = directory.user(userId);
  if (!u) return 'specialist';
  if (['dept_head', 'finance', 'admin', 'treasury'].includes(u.role) || /директор|начальник|главн|управляющ/i.test(u.position.ru)) return 'management';
  return 'specialist';
}
export function tripGradeNorm(grade: TripGrade): TripGradeNorm {
  return norms.grades.find((g) => g.grade === grade) ?? norms.grades[norms.grades.length - 1]!;
}
const rateOf = (d: TripDestination | undefined) => (d?.currency === 'USD' ? ROUTE_RATES.USD : 1);

/** Количество дней командировки включительно (день выезда и приезда). */
export function tripDays(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 86_400_000) + 1 : 0;
}

/** Расчёт аванса: суточные × (дни + дни в пути) + проживание × ночи + проезд + прочие плановые расходы. */
export function tripCalc(input: Pick<NewTripInput, 'destinationId' | 'startDate' | 'endDate' | 'transportCost' | 'hotelNightly'> & Partial<Pick<NewTripInput, 'travelDays' | 'planLines' | 'transportClass' | 'employeeId'>>): TripCalc {
  const dest = tripDestination(input.destinationId);
  const days = tripDays(input.startDate, input.endDate);
  const nights = Math.max(0, days - 1);
  const rate = rateOf(dest);
  const grade = tripGradeNorm(input.employeeId ? tripGradeOf(input.employeeId) : 'specialist');
  const perDiemRate = Math.round((dest?.perDiem ?? 0) * rate);
  const perDiemDays = days > 0 ? days + Math.max(0, Math.floor(input.travelDays ?? 0)) : 0;
  const perDiemTotal = perDiemRate * perDiemDays;
  const hotelTotal = input.hotelNightly * nights;
  const hotelLimit = Math.round((dest?.hotelLimit ?? 0) * rate * grade.hotelFactor);
  const other = (input.planLines ?? []).reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0);
  const hospitality = (input.planLines ?? []).filter((l) => l.category === 'hospitality').reduce((s, l) => s + l.amount, 0);
  return {
    days,
    nights,
    perDiemDays,
    perDiemRate,
    perDiemTotal,
    hotelTotal,
    hotelLimit,
    transport: input.transportCost,
    other,
    total: perDiemTotal + hotelTotal + input.transportCost + other,
    hotelOverLimit: !!dest && input.hotelNightly > hotelLimit,
    classAllowed: !input.transportClass || grade.allowedClasses.includes(input.transportClass),
    hospitalityOver: hospitality > grade.hospitalityLimit,
    rate,
  };
}

/** Каноническое содержимое авансового отчёта для подписи E-IMZO (проверка HR). */
export function tripReportSignContent(t: Pick<TripRequest, 'number' | 'report'>) {
  return { trip: t.number, lines: t.report?.lines ?? [] };
}

export function tripSettlement(trip: Pick<TripRequest, 'advance' | 'report'>): TripSettlement {
  const spent = trip.report?.lines.reduce((s, l) => s + l.amount, 0) ?? 0;
  return { advance: trip.advance, spent, balance: spent - trip.advance };
}

/** Статус для журнала: «в командировке», «ждёт отчёта». */
export function tripJournalStatus(t: Pick<TripRequest, 'status' | 'startDate' | 'endDate'>, d = today()): TripJournalStatus {
  if (t.status === 'approved' && t.startDate <= d && t.endDate >= d) return 'on_trip';
  if (t.status === 'approved' && t.endDate < d) return 'report_due';
  return t.status;
}

/** Проверка отчёта против норм и лимитов (PR-TRV-010): отклонения по категориям. */
export function tripDeviations(t: TripRequest, lines: TripExpenseLine[], filesCount: number): TripDeviation[] {
  const c = tripCalc(t);
  const sum = (cat: TripExpenseLine['category']) => lines.filter((l) => l.category === cat).reduce((s, l) => s + l.amount, 0);
  const out: TripDeviation[] = [];
  const perDiemLimit = c.perDiemRate * c.perDiemDays;
  if (sum('per_diem') > perDiemLimit) out.push({ code: 'per_diem_over', category: 'per_diem', amount: sum('per_diem'), limit: perDiemLimit });
  const hotelLimit = c.hotelLimit * c.nights;
  if (sum('hotel') > hotelLimit) out.push({ code: 'hotel_over', category: 'hotel', amount: sum('hotel'), limit: hotelLimit });
  const transportLimit = Math.round(t.transportCost * 1.15);
  if (sum('transport') > transportLimit) out.push({ code: 'transport_over', category: 'transport', amount: sum('transport'), limit: transportLimit });
  const hosp = tripGradeNorm(tripGradeOf(t.employeeId)).hospitalityLimit;
  if (sum('hospitality') > hosp) out.push({ code: 'hospitality_over', category: 'hospitality', amount: sum('hospitality'), limit: hosp });
  for (const cat of ['visa', 'insurance', 'hospitality'] as const) if (sum(cat) > 0 && !(t.planLines ?? []).some((p) => p.category === cat)) out.push({ code: 'category_unplanned', category: cat, amount: sum(cat), limit: 0 });
  for (const l of lines) if (l.category !== 'per_diem' && !l.hasReceipt) out.push({ code: 'no_receipt', category: l.category, amount: l.amount, limit: 0 });
  const needFiles = lines.filter((l) => l.hasReceipt).length;
  if (needFiles > 0 && filesCount === 0) out.push({ code: 'no_files', category: 'other', amount: needFiles, limit: 0 });
  return out;
}

/** Проводки окончательного расчёта (PR-TRV-011). */
export function tripPostings(t: TripRequest): TripPosting[] {
  const s = tripSettlement(t);
  const out: TripPosting[] = [{ debit: '56806000', credit: '16405000', amount: s.spent, purpose: `${t.number}: командировочные расходы` }];
  if (s.balance < 0) out.push({ debit: '10101000', credit: '16405000', amount: -s.balance, purpose: `${t.number}: возврат остатка аванса` });
  if (s.balance > 0) out.push({ debit: '16405000', credit: '10101000', amount: s.balance, purpose: `${t.number}: возмещение перерасхода` });
  return out.filter((p) => p.amount > 0);
}

// ---------- Бронирование билетов и гостиниц (P4, PR-TRV-015) ----------

const ACTIVE_BOOKING = ['queued', 'confirmed'] as const;
const isActive = (b: TripBooking) => (ACTIVE_BOOKING as readonly string[]).includes(b.status);
const isTransport = (k: TripBookingKind) => k === 'air' || k === 'rail';

/** Ожидаемые расходы командировки с учётом бронирований (активные брони заменяют плановые оценки; штрафы за отмену — расход). */
export function tripCommitted(t: TripRequest, extra?: Pick<TripBooking, 'kind' | 'price'>): TripCommitted {
  const c = tripCalc(t);
  const list = [...(t.bookings ?? []).filter(isActive), ...(extra ? [extra] : [])];
  const tr = list.filter((b) => isTransport(b.kind));
  const ht = list.filter((b) => b.kind === 'hotel');
  const penalties = (t.bookings ?? []).filter((b) => b.status === 'cancelled').reduce((s, b) => s + (b.penalty ?? 0), 0);
  const transport = tr.length ? tr.reduce((s, b) => s + b.price, 0) : c.transport;
  const hotel = ht.length ? ht.reduce((s, b) => s + b.price, 0) : c.hotelTotal;
  const total = transport + hotel + c.perDiemTotal + c.other + penalties;
  return { transport, hotel, perDiem: c.perDiemTotal, other: c.other, penalties, total, booked: list.reduce((s, b) => s + b.price, 0) + penalties, transportBooked: !!tr.length, hotelBooked: !!ht.length };
}

/** Проверка предложения против норм: класс проезда по грейду, проезд ≤ план +15%, проживание ≤ лимит за ночь. */
export function tripOfferNorm(t: TripRequest, o: Pick<TripProviderOffer, 'kind' | 'transportClass' | 'unitPrice' | 'price'>): { norm: number; issues: TripNormIssue[] } {
  const c = tripCalc(t);
  const issues: TripNormIssue[] = [];
  if (o.kind === 'hotel') {
    if (o.unitPrice > c.hotelLimit) issues.push('hotel_over_limit');
    return { norm: c.hotelLimit, issues };
  }
  const grade = tripGradeNorm(tripGradeOf(t.employeeId));
  if (o.transportClass && !grade.allowedClasses.includes(o.transportClass)) issues.push('class_not_allowed');
  const norm = Math.round(t.transportCost * 1.15);
  if (o.price > norm) issues.push('price_over_norm');
  return { norm, issues };
}

/** Бронирует сотрудник по своей командировке, координатор командировок (HR) или администратор. */
export function canBookTrip(user: User, t: Pick<TripRequest, 'employeeId' | 'status' | 'endDate'>): boolean {
  return t.status === 'approved' && t.endDate >= today() && (t.employeeId === user.id || directory.hasRole(user, 'hr') || directory.hasRole(user, 'admin'));
}

/** Кэш последних предложений поиска (бронь создаётся только по предложению провайдера, цена не принимается от клиента). */
const offerCache = new Map<string, TripProviderOffer>();
const offerKey = (tripId: ID, offerId: string) => `${tripId}|${offerId}`;

async function bookingTopUp(t: TripRequest, committed: number): Promise<{ topUp: number; blocked: boolean }> {
  const reserved = t.budget?.reserved ?? 0;
  const topUp = Math.max(0, Math.max(committed, t.advance) - reserved);
  if (!topUp) return { topUp: 0, blocked: false };
  try {
    const r = await budgetingApi.checkLimit({ articleId: TRIP_BUDGET_ARTICLE, departmentId: t.departmentId, amount: Math.max(committed, t.advance), source: 'trip', ref: t.id });
    // Нет строки бюджета по статье — как при подаче заявки: лимит не установлен, бронь без резерва.
    return { topUp, blocked: !!r.lineId && r.blocked };
  } catch {
    return { topUp, blocked: false };
  }
}

/** Резерв бюджета по ожидаемым расходам командировки (дорезерв при росте, пересчёт при отмене). */
async function syncTripReserve(t: TripRequest, actor: User): Promise<void> {
  const target = Math.max(t.advance, tripCommitted(t).total);
  const reserved = t.budget?.reserved ?? 0;
  if (target === reserved) return;
  if (target < reserved) await budgetingApi.release(t.id, actor);
  const r = await budgetingApi.reserve({ articleId: TRIP_BUDGET_ARTICLE, departmentId: t.departmentId, amount: target, source: 'trip', ref: t.id, refLabel: t.number }, actor);
  t.budget = { ...(t.budget ?? (await checkBudget(t))), reserved: target, checkedAt: now() };
  t.history.push(historyEvent(actor.id, 'status_changed', `Бюджет: резерв по командировке ${formatNumber(target)} сум (с учётом бронирований${r.txn.amount ? `, дорезерв ${formatNumber(r.txn.amount)}` : ''})`));
}

const KIND_RU: Record<TripBookingKind, string> = { air: 'авиабилет', rail: 'ж/д билет', hotel: 'гостиница' };

/** Подтверждение брони: номер PNR, документ (электронный билет / ваучер) во вложениях командировки, уведомление. */
async function confirmBooking(t: TripRequest, b: TripBooking, response: Record<string, unknown> | undefined): Promise<void> {
  b.status = 'confirmed';
  b.pnr = String(response?.pnr ?? '');
  b.documentNo = String(response?.document ?? '');
  b.confirmedAt = now();
  const emp = directory.user(t.employeeId);
  const author = directory.user(b.createdBy) ?? directory.admins()[0]!;
  const docTitle = b.kind === 'hotel' ? 'ВАУЧЕР НА ПРОЖИВАНИЕ' : 'МАРШРУТ-КВИТАНЦИЯ ЭЛЕКТРОННОГО БИЛЕТА';
  const text = [
    `${docTitle} ${b.documentNo}`,
    `PNR: ${b.pnr}`,
    `Командировка: ${t.number}`,
    `Пассажир / гость: ${emp?.fullName ?? t.employeeId}`,
    `${b.title}`,
    `${b.details}`,
    `Поставщик: ${b.provider}`,
    `Стоимость: ${formatNumber(b.price)} сум`,
    `Условия возврата: ${b.refundable ? `возвратный, штраф ${b.penaltyPct}%` : 'невозвратный'}`,
    `Выдан: ${now()}`,
  ].join('\n');
  try {
    const f = await filesApi.upload({ entity: 'business_trip', entityId: t.id, name: `${b.kind === 'hotel' ? 'Voucher' : 'E-ticket'}_${b.documentNo}.txt`, mime: 'text/plain', data: utf8Encode(text), category: 'booking', comment: `${b.pnr} · ${b.title}` }, author);
    b.fileId = f.id;
  } catch {
    /* вложение не создано — документ доступен на печать с карточки */
  }
  t.history.push(historyEvent(b.createdBy, 'status_changed', `Бронь подтверждена (${KIND_RU[b.kind]}): ${b.title}, PNR ${b.pnr}, документ ${b.documentNo}, ${formatNumber(b.price)} сум`));
  notify({ userIds: [t.employeeId], kind: 'system', level: 'success', title: L(`${t.number}: бронь подтверждена (${b.pnr})`, `${t.number}: bron tasdiqlandi (${b.pnr})`, `${t.number}: booking confirmed (${b.pnr})`), body: `${b.title} · ${b.documentNo}`, link: `/trips/${t.id}` });
}

/** Синхронизация броней в очереди шины: после восстановления системы бронь подтверждается автоматически. */
async function syncBookings(t: TripRequest): Promise<boolean> {
  let changed = false;
  for (const b of (t.bookings ?? []).filter((x) => x.status === 'queued' || (x.status === 'failed' && x.exchangeId))) {
    const rec = await integrationHub.getExchange(b.exchangeId);
    if (!rec) continue;
    if (rec.status === 'success' && b.status !== 'confirmed') {
      await confirmBooking(t, b, rec.response);
      changed = true;
    } else if (rec.status === 'failed' && b.status === 'queued') {
      b.status = 'failed';
      changed = true;
    } else if (rec.status === 'queued' && b.status === 'failed') {
      b.status = 'queued';
      changed = true;
    }
  }
  return changed;
}

// ---------- Бюджетный лимит (модуль бюджетирования) ----------

async function checkBudget(t: Pick<TripRequest, 'id' | 'departmentId' | 'advance'>): Promise<TripBudgetCheck> {
  try {
    const r = await budgetingApi.checkLimit({ articleId: TRIP_BUDGET_ARTICLE, departmentId: t.departmentId, amount: t.advance, source: 'trip', ref: t.id });
    if (!r.lineId) return { checkedAt: now(), status: 'no_line', available: 0, amount: t.advance, limit: 0, blocked: false };
    return { checkedAt: now(), status: r.status, available: r.annual.available, amount: t.advance, limit: r.annual.limit, blocked: r.blocked };
  } catch {
    return { checkedAt: now(), status: 'unavailable', available: 0, amount: t.advance, limit: 0, blocked: false };
  }
}

// ---------- Согласование ----------

const reportId = (id: ID) => `${id}:report`;
const baseId = (entityId: ID) => entityId.split(':')[0]!;

approvalEngine.register('business_trip', {
  onHistory: (id, e) => byId(baseId(id))?.history.push(id.endsWith(':report') ? { ...e, comment: `Авансовый отчёт: ${e.comment ?? (e.action === 'approved' ? 'согласован' : e.action)}` } : e),
  onFinal: (id, ok) => {
    const t = byId(baseId(id));
    if (!t) return;
    if (id.endsWith(':report')) {
      if (ok) void closeTrip(t);
      else if (t.report) {
        t.status = 'approved';
        t.report.returnedReason = t.history.filter((h) => h.action === 'rejected').slice(-1)[0]?.comment ?? '';
      }
      return;
    }
    t.status = ok ? 'approved' : 'rejected';
    if (ok) void afterApproval(t);
    else void budgetingApi.release(t.id, directory.user(t.employeeId) ?? directory.admins()[0]!).catch(() => undefined);
  },
  onReturned: (id, comment) => {
    const t = byId(baseId(id));
    if (!t) return;
    if (id.endsWith(':report')) {
      t.status = 'approved';
      if (t.report) t.report.returnedReason = comment;
    } else t.status = 'draft';
  },
  getContext: (id) => {
    const t = byId(baseId(id));
    return t ? { subtype: id.endsWith(':report') ? 'report' : 'application', departmentId: t.departmentId } : undefined;
  },
});
approvalEngine.seed(tripApprovalSeed);

/** После согласования: резерв бюджета, приказ в журнале приказов СЭД (PR-TRV-003). */
async function afterApproval(t: TripRequest): Promise<void> {
  const emp = directory.user(t.employeeId);
  const actor = directory.byRole('hr')[0] ?? directory.admins()[0]!;
  try {
    const r = await budgetingApi.reserve({ articleId: TRIP_BUDGET_ARTICLE, departmentId: t.departmentId, amount: t.advance, source: 'trip', ref: t.id, refLabel: t.number }, actor);
    t.budget = { ...(t.budget ?? (await checkBudget(t))), reserved: r.txn.amount, checkedAt: now() };
    t.history.push(historyEvent('system', 'status_changed', `Бюджет: зарезервировано ${formatNumber(r.txn.amount)} сум по статье «Командировочные расходы»`));
  } catch {
    t.history.push(historyEvent('system', 'status_changed', 'Бюджет: резерв не выполнен (нет лимита или требуется подтверждение превышения)'));
  }
  const dest = tripDestination(t.destinationId);
  try {
    const doc = await documentsApi.registerInternal({
      type: 'order',
      subject: `Приказ о направлении в командировку: ${emp?.fullName ?? t.employeeId}, ${dest?.city ?? ''}`,
      summary: `${t.startDate} — ${t.endDate}. Цель: ${t.purpose}. Аванс ${formatNumber(t.advance)} сум.`,
      body: `Направить ${emp?.fullName ?? ''} (${emp?.position.ru ?? ''}) в командировку в г. ${dest?.city ?? ''} (${dest?.country ?? ''}) с ${t.startDate} по ${t.endDate}. Основание: заявление ${t.number}.`,
      departmentId: 'd6',
      executorId: actor.id,
      correspondent: 'Департамент по работе с персоналом',
    }, actor);
    t.order = { number: doc.number, documentId: doc.id, createdAt: now() };
    t.history.push(historyEvent('system', 'status_changed', `Сформирован приказ ${doc.number} (журнал приказов)`));
  } catch {
    t.order = { number: nextNumber('PR'), createdAt: now() };
  }
  notify({ userIds: [t.employeeId], kind: 'approved', level: 'success', title: L(`${t.number}: командировка согласована`, `${t.number}: xizmat safari kelishildi`, `${t.number}: trip approved`), body: L(`Приказ ${t.order?.number ?? ''}; оформите заявку на выплату аванса`, `Buyruq ${t.order?.number ?? ''}; avans to'lovi uchun ariza bering`, `Order ${t.order?.number ?? ''}; request the advance payment`), link: `/trips/${t.id}` });
  emit();
}

/** Окончательный расчёт после проверки отчёта: проводки в АБС, списание бюджета, архив (PR-TRV-011). */
async function closeTrip(t: TripRequest): Promise<void> {
  const accountant = directory.byRole('accountant')[0] ?? directory.admins()[0]!;
  t.status = 'closed';
  if (t.report) {
    t.report.acceptedBy = t.report.acceptedBy ?? accountant.id;
    t.report.acceptedAt = now();
  }
  const s = tripSettlement(t);
  t.postings = tripPostings(t);
  t.settledAt = now();
  t.history.push(historyEvent(accountant.id, 'status_changed', s.balance > 0 ? 'Отчёт принят, перерасход возмещён сотруднику' : s.balance < 0 ? 'Отчёт принят, остаток аванса удержан' : 'Отчёт принят'));
  try {
    const rec = await integrationHub.call('iabs', 'postings.batch', { batch: `TRV-${t.number}`, entries: t.postings.map((p) => ({ debit: p.debit, credit: p.credit, amount: p.amount })), controlSum: t.postings.reduce((x, p) => x + p.amount, 0) }, { idempotencyKey: `trv-post-${t.id}`, userId: accountant.id });
    t.postingExchangeId = rec.id;
  } catch {
    /* очередь шины */
  }
  try {
    await budgetingApi.consume({ articleId: TRIP_BUDGET_ARTICLE, departmentId: t.departmentId, amount: s.spent, source: 'trip', ref: t.id, refLabel: t.number }, accountant);
    await budgetingApi.release(t.id, accountant);
    t.budget = t.budget ? { ...t.budget, consumed: s.spent } : t.budget;
  } catch {
    /* лимит не задан */
  }
  notify({ userIds: [t.employeeId], kind: 'approved', level: 'success', title: L(`${t.number}: авансовый отчёт принят`, `${t.number}: avans hisoboti qabul qilindi`, `${t.number}: expense report accepted`), link: `/trips/${t.id}` });
  emit();
}

function openTask(t: TripRequest, user: User) {
  const dest = tripDestination(t.destinationId);
  approvalEngine.open({
    entity: 'business_trip',
    entityId: t.id,
    number: t.number,
    title: `Командировка: ${dest?.city ?? ''}, ${t.startDate.slice(8, 10)}.${t.startDate.slice(5, 7)}–${t.endDate.slice(8, 10)}.${t.endDate.slice(5, 7)}`,
    requesterId: user.id,
    amount: t.advance,
    context: { subtype: 'application', departmentId: t.departmentId },
  });
}

/** Сотрудник видит свои командировки; руководитель, HR, бухгалтерия, финансы и админ — все (по матрице прав). */
const seesAll = (user: User) => can(user, 'trips', 'approve') || ['accountant', 'finance', 'hr', 'admin'].some((r) => directory.hasRole(user, r as never));
export function canSeeTrip(user: User, t: Pick<TripRequest, 'employeeId'> & Partial<Pick<TripRequest, 'advancePayment'>>): boolean {
  // Кассир видит командировки, по которым заявлена выдача аванса наличными (PR-TRV-008).
  const cashDesk = t.advancePayment?.method === 'cash' && can(user, 'cash', 'edit');
  return seesAll(user) || t.employeeId === user.id || cashDesk;
}
/** Ведение норм: бухгалтерия, HR, администратор. */
export function canEditTripNorms(user: User): boolean {
  return can(user, 'trips', 'admin') || (can(user, 'trips', 'approve') && (directory.hasRole(user, 'accountant') || directory.hasRole(user, 'hr')));
}

registerSearchProvider((q, lang) =>
  db
    .filter((t) => matches(q, t.number, t.purpose, destText(t.destinationId)))
    .map((t) => ({
      group: 'trips_title',
      title: `${t.number} · ${tripPlace(tripDestination(t.destinationId), lang).city}`,
      subtitle: `${t.purpose} · ${translate(lang, tk('trips_status_', t.status))}`,
      to: `/trips/${t.id}`,
    })),
);

registerArchiveSource('trips', {
  name: L('Командировки: приказы и авансовые отчёты', 'Xizmat safarlari: buyruqlar va avans hisobotlari', 'Business trips: orders and expense reports'),
  pending: () => db.filter((t) => t.status === 'closed' && !t.archivedAt).length,
  pull: async (user) => {
    const list = db.filter((t) => t.status === 'closed' && !t.archivedAt);
    for (const t of list) {
      try {
        const r = await archiveApi.receiveElectronic({ source: 'trips', sourceRef: t.id, docNumber: t.number, docDate: t.endDate, title: `Авансовый отчёт ${t.number}: ${directory.user(t.employeeId)?.fullName ?? ''}, ${tripDestination(t.destinationId)?.city ?? ''}`, kind: 'Авансовый отчёт', departmentId: 'd6', responsibleId: t.employeeId, createdAt: t.report?.submittedAt ?? t.createdAt, pages: (t.report?.lines.length ?? 1) + 1, content: { number: t.number, report: t.report?.lines ?? [], advance: t.advance }, fileEntity: { entity: 'business_trip', entityId: t.id }, signatureEntity: { entity: 'business_trip_report', entityId: t.id }, signatureContent: tripReportSignContent(t) }, user);
        t.archivedAt = now();
        t.history.push(historyEvent(user.id, 'status_changed', `Передан в архив: ${r.number}`));
      } catch {
        /* ошибка — в журнале архива */
      }
    }
    emit();
    return list.length;
  },
});

const inPeriod = (t: TripRequest, from?: string, to?: string) => (!from || t.endDate >= from) && (!to || t.startDate <= to);
const spentOf = (t: TripRequest) => (t.report ? tripSettlement(t).spent : 0);

export const tripsApi = {
  destinations: (): Promise<TripDestination[]> => delay(norms.destinations),

  norms: (): Promise<TripNorms> => delay({ destinations: norms.destinations, grades: norms.grades, usdRate: ROUTE_RATES.USD }),

  /** Изменить норму по направлению (суточные, лимит проживания, валюта) — PR-TRV-013. */
  async updateDestinationNorm(id: string, patch: Partial<Pick<TripDestination, 'perDiem' | 'hotelLimit' | 'currency'>>, user: User): Promise<void> {
    if (!canEditTripNorms(user)) throw apiError('NOT_ALLOWED');
    const d = tripDestination(id);
    if (!d) throw apiError('NOT_FOUND');
    if ((patch.perDiem !== undefined && !(patch.perDiem > 0)) || (patch.hotelLimit !== undefined && !(patch.hotelLimit > 0))) throw apiError('INVALID_NORM');
    const before = { perDiem: String(d.perDiem), hotelLimit: String(d.hotelLimit), currency: d.currency };
    Object.assign(d, patch);
    audit.log({ action: 'update', entity: 'trip_norm', entityId: d.id, entityLabel: d.city, changes: (['perDiem', 'hotelLimit', 'currency'] as const).map((k) => ({ field: k, from: before[k], to: String(d[k]) })).filter((c) => c.from !== c.to), user: who(user) });
    emit();
    await delay(null);
  },

  /** Изменить лимиты грейда (классы проезда, коэффициент проживания, представительские). */
  async updateGradeNorm(grade: TripGrade, patch: Partial<Omit<TripGradeNorm, 'grade'>>, user: User): Promise<void> {
    if (!canEditTripNorms(user)) throw apiError('NOT_ALLOWED');
    const g = norms.grades.find((x) => x.grade === grade);
    if (!g) throw apiError('NOT_FOUND');
    if ((patch.hotelFactor !== undefined && !(patch.hotelFactor > 0)) || (patch.hospitalityLimit !== undefined && patch.hospitalityLimit < 0) || (patch.allowedClasses && !patch.allowedClasses.length)) throw apiError('INVALID_NORM');
    const before = { hotelFactor: String(g.hotelFactor), hospitalityLimit: String(g.hospitalityLimit), allowedClasses: g.allowedClasses.join(',') };
    Object.assign(g, patch);
    const after = { hotelFactor: String(g.hotelFactor), hospitalityLimit: String(g.hospitalityLimit), allowedClasses: g.allowedClasses.join(',') };
    audit.log({ action: 'update', entity: 'trip_norm', entityId: grade, entityLabel: grade, changes: (Object.keys(before) as (keyof typeof before)[]).map((k) => ({ field: k, from: before[k], to: after[k] })).filter((c) => c.from !== c.to), user: who(user) });
    emit();
    await delay(null);
  },

  list(user: User, filter: TripFilter = {}): Promise<TripRequest[]> {
    const q = filter.search?.trim().toLowerCase();
    return delay(
      db
        .filter((t) => canSeeTrip(user, t))
        .filter((t) => !filter.status || (filter.status === 'on_trip' || filter.status === 'report_due' ? tripJournalStatus(t) === filter.status : t.status === filter.status))
        .filter((t) => !filter.destinationType || tripDestination(t.destinationId)?.type === filter.destinationType)
        .filter((t) => !filter.employeeId || t.employeeId === filter.employeeId)
        .filter((t) => !filter.departmentId || t.departmentId === filter.departmentId)
        .filter((t) => inPeriod(t, filter.from, filter.to))
        .filter((t) => !q || t.number.toLowerCase().includes(q) || t.purpose.toLowerCase().includes(q) || destText(t.destinationId).toLowerCase().includes(q))
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    );
  },

  async get(id: ID): Promise<TripRequest | undefined> {
    const t = byId(id);
    if (t?.bookings?.length && (await syncBookings(t))) emit();
    return delay(t);
  },

  stats(user: User): Promise<TripStats> {
    const d = today();
    const month = d.slice(0, 7);
    const mine = db.filter((t) => canSeeTrip(user, t));
    return delay({
      onTripNow: mine.filter((t) => tripJournalStatus(t, d) === 'on_trip').length,
      pending: mine.filter((t) => t.status === 'pending').length,
      advancesMonth: mine.filter((t) => ['approved', 'report_pending', 'closed'].includes(t.status) && t.startDate.startsWith(month)).reduce((s, t) => s + t.advance, 0),
      reportsDue: mine.filter((t) => t.status === 'approved' && t.endDate < d).length,
      reportsOnCheck: mine.filter((t) => t.status === 'report_pending').length,
    });
  },

  /** Проверка бюджетного лимита для формы / карточки (без резерва). */
  checkBudget: (departmentId: ID, amount: number, ref = 'new'): Promise<TripBudgetCheck> => checkBudget({ id: ref, departmentId, advance: amount }).then((r) => delay(r)),

  async create(input: NewTripInput, user: User): Promise<TripRequest> {
    if (!can(user, 'trips', 'edit')) throw apiError('NOT_ALLOWED');
    const calc = tripCalc(input);
    if (calc.days <= 0) throw apiError('INVALID_DATES');
    if (!tripDestination(input.destinationId) || !input.purpose.trim() || input.transportCost < 0 || input.hotelNightly < 0 || (input.travelDays ?? 0) < 0) throw apiError('INVALID_INPUT');
    if ((input.planLines ?? []).some((l) => !l.description.trim() || !(l.amount > 0))) throw apiError('INVALID_PLAN_LINE');
    if (input.employeeId !== user.id && !can(user, 'trips', 'approve')) throw apiError('NOT_ALLOWED');
    const t: TripRequest = {
      id: nextId('tr'),
      number: nextNumber('KM'),
      employeeId: input.employeeId,
      departmentId: input.departmentId,
      destinationId: input.destinationId,
      startDate: input.startDate,
      endDate: input.endDate,
      purpose: input.purpose,
      transport: input.transport,
      ...(input.transportClass ? { transportClass: input.transportClass } : {}),
      transportCost: input.transportCost,
      hotelNightly: input.hotelNightly,
      ...(input.travelDays ? { travelDays: input.travelDays } : {}),
      ...(input.planLines?.length ? { planLines: input.planLines } : {}),
      advance: calc.total,
      status: input.submit ? 'pending' : 'draft',
      createdAt: now(),
      history: [historyEvent(user.id, 'created')],
    };
    // P3 (PR-BUD-014): hard-check бюджета до создания отправляемой заявки — сверх лимита заявка не формируется
    if (input.submit && (await checkBudget(t)).blocked) throw new Error('trips_err_budget_blocked');
    db.push(t);
    audit.log({ action: 'create', entity: 'business_trip', entityId: t.id, entityLabel: t.number, details: `${t.destinationId} ${t.startDate}..${t.endDate} · ${t.advance}`, user: who(user) });
    if (input.submit) await submitInternal(t, user);
    emit();
    return delay(t);
  },

  async submit(id: ID, user: User): Promise<void> {
    const t = byId(id);
    if (!t || !['draft', 'rejected'].includes(t.status)) throw apiError('TRIP_CANNOT_BE_SUBMITTED');
    if (t.employeeId !== user.id && !directory.hasRole(user, 'admin')) throw apiError('NOT_ALLOWED');
    await submitInternal(t, user);
    emit();
    await delay(null);
  },

  /** Заявка на выплату аванса: наличными через кассу или на карту через АБС (PR-TRV-007, 008). */
  async requestAdvance(id: ID, user: User, method: 'cash' | 'card'): Promise<void> {
    const t = byId(id);
    if (!t || t.status !== 'approved') throw apiError('ADVANCE_NOT_AVAILABLE');
    if (t.employeeId !== user.id && !directory.hasRole(user, 'accountant') && !directory.hasRole(user, 'admin')) throw apiError('NOT_ALLOWED');
    if (t.advancePayment && t.advancePayment.status !== 'failed') throw apiError('ADVANCE_ALREADY_REQUESTED');
    t.advancePayment = { method, requestNo: nextNumber('ZA'), status: 'requested', requestedAt: now(), requestedBy: user.id, ...(method === 'card' ? { card: `8600 **** **** ${String(1000 + (Number(t.employeeId.replace(/\D/g, '')) * 733) % 9000)}` } : {}) };
    t.history.push(historyEvent(user.id, 'status_changed', `Заявка на выплату аванса ${t.advancePayment.requestNo}: ${method === 'cash' ? 'наличными через кассу' : 'на банковскую карту'}`));
    notify({ roles: method === 'cash' ? ['cash_operator', 'accountant'] : ['accountant'], kind: 'task', level: 'info', title: L(`${t.advancePayment.requestNo}: выплата аванса ${formatNumber(t.advance)} сум`, `${t.advancePayment.requestNo}: avans to'lovi ${formatNumber(t.advance)} so'm`, `${t.advancePayment.requestNo}: advance payment ${formatNumber(t.advance)} UZS`), body: t.number, link: `/trips/${t.id}` });
    emit();
    await delay(null);
  },

  /** Выплатить аванс: на карту — платёж через АБС (бухгалтерия); наличными — выдача кассой. */
  async payAdvance(id: ID, user: User): Promise<void> {
    const t = byId(id);
    const p = t?.advancePayment;
    if (!t || !p || !['requested', 'queued'].includes(p.status)) throw apiError('NOTHING_TO_PAY');
    if (p.method === 'cash' ? !can(user, 'cash', 'edit') && !directory.hasRole(user, 'accountant') : !directory.hasRole(user, 'accountant') && !directory.hasRole(user, 'admin')) throw apiError('NOT_ALLOWED');
    if (p.method === 'card') {
      const rec = await integrationHub.call('iabs', 'payment.send', { doc: p.requestNo, account: `22618000${String(Number(t.employeeId.replace(/\D/g, '')) * 1_000_003).padStart(12, '0').slice(-12)}`, mfo: '00873', amount: t.advance, purpose: `Аванс на командировку ${t.number}` }, { idempotencyKey: `trv-adv-${t.id}`, userId: user.id });
      p.exchangeId = rec.id;
      if (rec.status !== 'success') {
        p.status = rec.status === 'queued' ? 'queued' : 'failed';
        emit();
        return delay(null).then(() => undefined);
      }
    }
    p.status = 'paid';
    p.paidAt = now();
    p.paidBy = user.id;
    t.history.push(historyEvent(user.id, 'status_changed', p.method === 'cash' ? 'Аванс выдан наличными из кассы' : `Аванс перечислен на карту ${p.card ?? ''}`));
    audit.log({ action: 'update', entity: 'business_trip', entityId: t.id, entityLabel: t.number, details: `advance paid ${p.method} ${t.advance}`, user: who(user) });
    emit();
    await delay(null);
  },

  /** Подпись приказа о командировке E-IMZO (запись создаёт платформенный SignModal). */
  async signOrder(id: ID, user: User, signatureId: ID): Promise<void> {
    const t = byId(id);
    const s = signatureService.get(signatureId);
    if (!t?.order || !s || s.entity !== 'trip_order' || s.entityId !== id || s.userId !== user.id) throw apiError('SIGNATURE_NOT_FOUND');
    if (!can(user, 'trips', 'approve')) throw apiError('NOT_ALLOWED');
    t.order.signatureIds = [...(t.order.signatureIds ?? []), s.id];
    t.history.push(historyEvent(user.id, 'approved', `Приказ ${t.order.number} подписан ЭЦП E-IMZO (серт. ${s.certSerial})`));
    emit();
    await delay(null);
  },

  /** Авансовый отчёт после поездки: строки по категориям + сканы/фото чеков (PR-TRV-009). */
  async submitReport(id: ID, user: User, lines: TripExpenseLine[]): Promise<void> {
    const t = byId(id);
    if (!t || t.status !== 'approved') throw apiError('REPORT_NOT_EXPECTED');
    if (t.employeeId !== user.id && !directory.hasRole(user, 'admin')) throw apiError('NOT_ALLOWED');
    if (!lines.length || lines.some((l) => !(l.amount > 0))) throw apiError('EMPTY_REPORT');
    const files = filesApi.count('business_trip', t.id);
    if (lines.some((l) => l.hasReceipt) && files === 0) throw apiError('RECEIPTS_REQUIRED');
    const deviations = tripDeviations(t, lines, files);
    t.report = { submittedAt: now(), lines, deviations };
    t.status = 'report_pending';
    const s = tripSettlement(t);
    t.history.push(historyEvent(user.id, 'status_changed', `Подан авансовый отчёт на ${formatNumber(s.spent)} сум${deviations.length ? `; отклонений от норм: ${deviations.length}` : ''}`));
    approvalEngine.open({ entity: 'business_trip', entityId: reportId(t.id), number: t.number, title: `Авансовый отчёт: ${tripDestination(t.destinationId)?.city ?? ''}, ${t.startDate.slice(8, 10)}.${t.startDate.slice(5, 7)}–${t.endDate.slice(8, 10)}.${t.endDate.slice(5, 7)}`, requesterId: user.id, amount: s.spent, context: { subtype: 'report', departmentId: t.departmentId } });
    emit();
    await delay(null);
  },

  /** Проверка HR: подпись E-IMZO и согласование текущего этапа отчёта (PR-TRV-010). */
  async hrConfirm(id: ID, user: User, signatureId: ID, comment?: string): Promise<void> {
    const t = byId(id);
    const s = signatureService.get(signatureId);
    if (!t?.report || t.status !== 'report_pending') throw apiError('NO_REPORT_ON_CHECK');
    if (!s || s.entity !== 'business_trip_report' || s.entityId !== id || s.userId !== user.id) throw apiError('SIGNATURE_NOT_FOUND');
    const task = approvalEngine.openFor(reportId(id));
    if (!task || !approvalEngine.check(task.id, user).canApprove || task.assigneeRole !== 'hr') throw apiError('NOT_ALLOWED');
    t.report.hrCheckedBy = user.id;
    t.report.hrCheckedAt = now();
    t.report.signatureIds = [...(t.report.signatureIds ?? []), s.id];
    approvalEngine.decide(task.id, user, 'approve', comment?.trim() || `Проверено HR, подписано ЭЦП (серт. ${s.certSerial})`);
    audit.log({ action: 'approve', entity: 'business_trip', entityId: t.id, entityLabel: t.number, details: `HR check, E-IMZO ${s.certSerial}`, user: who(user) });
    emit();
    await delay(null);
  },

  /** Совместимость: бухгалтерия принимает отчёт — согласование своего этапа маршрута отчёта. */
  async acceptReport(id: ID, user: User): Promise<void> {
    const t = byId(id);
    if (!t || t.status !== 'report_pending' || !t.report) throw apiError('NO_REPORT_TO_ACCEPT');
    const task = approvalEngine.openFor(reportId(id));
    if (!task) throw apiError('NO_REPORT_TO_ACCEPT');
    approvalEngine.decide(task.id, user, 'approve');
    emit();
    await delay(null);
  },

  // ---------- Бронирование (P4, PR-TRV-015) ----------

  /** Поиск предложений в системе бронирования (интеграционная шина, синхронный запрос) с проверкой норм и бюджета. */
  async searchOffers(id: ID, kind: TripBookingKind, user: User): Promise<TripBookingOffer[]> {
    const t = byId(id);
    if (!t) throw new Error('Not found');
    if (!canBookTrip(user, t)) throw new Error('trips_err_booking_not_allowed');
    const dest = tripDestination(t.destinationId);
    const systemId = TRIP_BOOKING_SYSTEMS[kind];
    const c = tripCalc(t);
    const payload: Record<string, unknown> =
      kind === 'hotel'
        ? { city: dest?.city ?? '', checkIn: t.startDate, checkOut: t.endDate, nights: Math.max(1, c.nights), abroad: dest?.type === 'abroad', usdRate: ROUTE_RATES.USD }
        : { from: 'Ташкент', to: dest?.city ?? '', date: t.startDate, back: t.endDate, distanceKm: TRIP_ROUTE_KM[t.destinationId] ?? 500, abroad: dest?.type === 'abroad' };
    let offers: TripProviderOffer[];
    let stale = false;
    try {
      const rec = await integrationHub.call(systemId, 'offers.search', payload, { mode: 'sync', userId: user.id });
      offers = ((rec.response?.offers as TripProviderOffer[] | undefined) ?? []).map((o) => ({ ...o }));
    } catch (e) {
      if (!(e instanceof IntegrationUnavailableError)) throw e;
      // Система недоступна: показываем предложения последнего поиска (бронь по ним встанет в очередь шины).
      offers = [...offerCache.entries()].filter(([k, o]) => k.startsWith(`${t.id}|`) && o.kind === kind).map(([, o]) => ({ ...o }));
      if (!offers.length) throw new Error('trips_err_booking_unavailable');
      stale = true;
    }
    const out: TripBookingOffer[] = await Promise.all(
      offers.map(async (o) => {
        offerCache.set(offerKey(t.id, o.id), o);
        const n = tripOfferNorm(t, o);
        const replaced = { ...t, bookings: (t.bookings ?? []).filter((b) => !(isActive(b) && (isTransport(kind) ? isTransport(b.kind) : b.kind === 'hotel'))) };
        const committedAfter = tripCommitted(replaced, { kind, price: o.price }).total;
        const b = await bookingTopUp(t, committedAfter);
        return { ...o, systemId, norm: n.norm, issues: n.issues, committedAfter, topUp: b.topUp, budget: b.blocked ? ('blocked' as const) : b.topUp ? ('topup' as const) : ('ok' as const), ...(stale ? { stale: true } : {}) };
      }),
    );
    return delay(out.sort((a, b) => a.issues.length - b.issues.length || a.price - b.price));
  },

  /** Забронировать предложение: проверка норм (обоснование сверх нормы), резерв бюджета, бронь в системе бронирования. */
  async book(id: ID, offerId: string, user: User, justification = ''): Promise<TripBooking> {
    const t = byId(id);
    if (!t) throw new Error('Not found');
    if (!canBookTrip(user, t)) throw new Error('trips_err_booking_not_allowed');
    const o = offerCache.get(offerKey(t.id, offerId));
    if (!o) throw new Error('trips_err_booking_offer_expired');
    if ((t.bookings ?? []).some((b) => isActive(b) && (isTransport(o.kind) ? isTransport(b.kind) : b.kind === 'hotel'))) throw new Error('trips_err_booking_exists');
    const n = tripOfferNorm(t, o);
    if (n.issues.includes('class_not_allowed')) throw new Error('trips_err_booking_class');
    if (n.issues.length && justification.trim().length < 10) throw new Error('trips_err_booking_justify');
        const b: TripBooking = {
      id: nextId('bk'), kind: o.kind, systemId: TRIP_BOOKING_SYSTEMS[o.kind], offerId: o.id, provider: o.provider, title: o.title, details: o.details,
      ...(o.transportClass ? { transportClass: o.transportClass } : {}), ...(o.nights ? { nights: o.nights } : {}),
      unitPrice: o.unitPrice, price: o.price, refundable: o.refundable, penaltyPct: o.penaltyPct, norm: n.norm, issues: n.issues,
      ...(n.issues.length ? { justification: justification.trim() } : {}),
      status: 'queued', exchangeId: '', createdAt: now(), createdBy: user.id,
    };
    // Бюджет: резерв по статье «Командировочные расходы» доводится до ожидаемых расходов (hard-check блокирует бронь).
    t.bookings = [...(t.bookings ?? []), b];
    try {
      await syncTripReserve(t, user);
    } catch (e) {
      if (e instanceof BudgetingControlError && e.code === 'not_found') {
        /* лимит по статье не задан — бронь без резерва */
      } else {
        t.bookings = t.bookings.filter((x) => x.id !== b.id);
        throw new Error('trips_err_budget_blocked');
      }
    }
    const rec = await integrationHub.call(b.systemId, 'booking.create', { offerId: o.id, trip: t.number, traveller: t.employeeId, price: o.price, kind: o.kind }, { idempotencyKey: `trv-book-${t.id}-${o.id}`, userId: user.id });
    b.exchangeId = rec.id;
    if (rec.status === 'success') await confirmBooking(t, b, rec.response);
    else {
      b.status = rec.status === 'queued' || rec.status === 'pending' ? 'queued' : 'failed';
      t.history.push(historyEvent(user.id, 'commented', b.status === 'queued' ? `Система бронирования недоступна: бронь (${KIND_RU[b.kind]}) поставлена в очередь интеграционной шины` : `Ошибка бронирования (${KIND_RU[b.kind]}): ${rec.error ?? ''}`));
    }
    if (n.issues.length) notify({ roles: ['hr'], kind: 'system', level: 'warning', title: L(`${t.number}: бронь сверх нормы`, `${t.number}: me'yordan ortiq bron`, `${t.number}: booking above norm`), body: `${b.title} · ${formatNumber(b.price)} · ${b.justification ?? ''}`, link: `/trips/${t.id}` });
    audit.log({ action: 'create', entity: 'business_trip', entityId: t.id, entityLabel: t.number, details: `booking ${b.kind} ${b.offerId} · ${b.price} · ${b.status}${n.issues.length ? ` · over norm: ${n.issues.join(',')}` : ''}`, user: who(user) });
    emit();
    return delay(clone(b));
  },

  /** Повторить бронь после ошибки (тот же ключ идемпотентности) или проверить очередь шины. */
  async retryBooking(id: ID, bookingId: ID, user: User): Promise<void> {
    const t = byId(id);
    const b = t?.bookings?.find((x) => x.id === bookingId);
    if (!t || !b) throw new Error('Not found');
    if (!canBookTrip(user, t)) throw new Error('trips_err_booking_not_allowed');
    if (b.status === 'failed') {
      const rec = await integrationHub.retry(b.exchangeId, user.id);
      if (rec.status === 'success') await confirmBooking(t, b, rec.response);
      else if (rec.status === 'queued') b.status = 'queued';
    } else await syncBookings(t);
    emit();
    await delay(null);
  },

  /** Отмена брони: запрос в систему бронирования, возврат по правилам тарифа, штраф — в расходы, пересчёт резерва. */
  async cancelBooking(id: ID, bookingId: ID, user: User, reason: string): Promise<TripBooking> {
    const t = byId(id);
    const b = t?.bookings?.find((x) => x.id === bookingId);
    if (!t || !b) throw new Error('Not found');
    if (!(t.employeeId === user.id || directory.hasRole(user, 'hr') || directory.hasRole(user, 'admin'))) throw new Error('trips_err_booking_not_allowed');
    if (b.status !== 'confirmed') throw new Error('trips_err_booking_not_cancellable');
    if (!reason.trim()) throw new Error('trips_err_booking_reason');
    let rec;
    try {
      rec = await integrationHub.call(b.systemId, 'booking.cancel', { pnr: b.pnr, price: b.price, refundable: b.refundable, penaltyPct: b.penaltyPct }, { mode: 'sync', idempotencyKey: `trv-cancel-${b.id}`, userId: user.id });
    } catch (e) {
      if (e instanceof IntegrationUnavailableError) throw new Error('trips_err_booking_unavailable');
      throw e;
    }
    b.status = 'cancelled';
    b.cancelExchangeId = rec.id;
    b.refundAmount = Number(rec.response?.refund ?? 0);
    b.penalty = Number(rec.response?.penalty ?? 0);
    b.refundDoc = String(rec.response?.refundDoc ?? '');
    b.cancelReason = reason.trim();
    b.cancelledAt = now();
    b.cancelledBy = user.id;
    t.history.push(historyEvent(user.id, 'status_changed', `Бронь отменена (${KIND_RU[b.kind]}): ${b.title}, PNR ${b.pnr}; возврат ${formatNumber(b.refundAmount)} сум${b.penalty ? `, штраф ${formatNumber(b.penalty)} сум` : ''} (${b.refundDoc}). Причина: ${b.cancelReason}`));
    try {
      await syncTripReserve(t, user);
    } catch {
      /* резерв не пересчитан — останется прежним */
    }
    audit.log({ action: 'update', entity: 'business_trip', entityId: t.id, entityLabel: t.number, details: `booking cancelled ${b.pnr} · refund ${b.refundAmount} · penalty ${b.penalty}`, user: who(user) });
    emit();
    return delay(clone(b));
  },

  /** Отчёты: по подразделениям / сотрудникам / направлениям, план (аванс) — факт (отчёт), средняя стоимость (PR-TRV-014). */
  report(by: 'department' | 'employee' | 'destination', filter: { from?: string; to?: string } = {}): Promise<TripReportRow[]> {
    const list = db.filter((t) => ['approved', 'report_pending', 'closed'].includes(t.status) && inPeriod(t, filter.from, filter.to));
    const key = (t: TripRequest) => (by === 'department' ? t.departmentId : by === 'employee' ? t.employeeId : t.destinationId);
    const map = new Map<string, TripReportRow>();
    for (const t of list) {
      const k = key(t);
      const r = map.get(k) ?? { key: k, trips: 0, days: 0, planned: 0, actual: 0, avgCost: 0, avgPerDay: 0 };
      r.trips++;
      r.days += tripDays(t.startDate, t.endDate);
      r.planned += t.advance;
      r.actual += t.report ? spentOf(t) : t.advance;
      map.set(k, r);
    }
    return delay([...map.values()].map((r) => ({ ...r, avgCost: Math.round(r.actual / r.trips), avgPerDay: r.days ? Math.round(r.actual / r.days) : 0 })).sort((a, b) => b.actual - a.actual));
  },

  /** Исполнение бюджета командировочных расходов по подразделениям: лимит статьи и план/факт командировок. */
  async budgetReport(): Promise<TripBudgetRow[]> {
    const deps = [...new Set(db.map((t) => t.departmentId))];
    const rows: TripBudgetRow[] = [];
    for (const departmentId of deps) {
      const trips = db.filter((t) => t.departmentId === departmentId && ['approved', 'report_pending', 'closed'].includes(t.status));
      let limit = 0;
      let used = 0;
      try {
        const lines = await budgetingApi.listLines({ departmentId });
        const line = lines.find((l) => l.articleId === TRIP_BUDGET_ARTICLE);
        if (line) {
          limit = line.planYear;
          used = line.actualYtd;
        }
      } catch {
        /* модуль бюджетирования недоступен */
      }
      const planned = trips.reduce((s, t) => s + t.advance, 0);
      const actual = trips.reduce((s, t) => s + (t.report ? spentOf(t) : 0), 0);
      rows.push({ departmentId, limit, used, tripsPlanned: planned, tripsActual: actual, available: limit ? limit - used - planned : 0 });
    }
    return delay(rows.sort((a, b) => b.tripsPlanned - a.tripsPlanned));
  },
};

async function submitInternal(t: TripRequest, user: User): Promise<void> {
  t.budget = await checkBudget(t);
  if (t.budget.blocked) {
    // P3 (PR-BUD-014): hard-check статьи «Командировочные расходы» — заявка не отправляется (остаётся черновиком)
    t.status = 'draft';
    t.history.push(historyEvent(user.id, 'commented', `Бюджетный лимит превышен: доступно ${formatNumber(t.budget.available)} сум`));
    emit();
    throw new Error('trips_err_budget_blocked');
  }
  // Сверка с кадровой системой: сотрудник действует, должность и грейд (Laborlaw).
  void integrationHub.call('laborlaw', 'employee.get', { employee: t.employeeId }, { userId: user.id, background: true }).catch(() => undefined);
  t.status = 'pending';
  t.history.push(historyEvent(user.id, 'submitted'));
  openTask(t, user);
}

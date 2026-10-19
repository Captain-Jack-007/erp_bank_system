// Типы модуля «Командировки» (ТЗ 4.2.11): заявление с подтверждающими документами, маршрут Руководитель → HR →
// Финансы с проверкой бюджетного лимита, приказ (журнал приказов СЭД, E-IMZO), суточные по нормам городов/стран
// с временем в пути и валютой, лимиты класса транспорта и проживания по должностям (грейдам), прочие расходы
// (виза, страховка, представительские), аванс наличными / на карту, авансовый отчёт со сканами, проверка HR,
// окончательный расчёт с проводками, журнал, нормы, отчёты.
import type { HistoryEvent, ID, ISODate } from '../../types';

export type TripDestinationType = 'domestic' | 'abroad';
export type TripTransport = 'air' | 'rail' | 'car' | 'bus';
/** Класс проезда: эконом / бизнес (авиа), плацкарт / купе / СВ (ж/д), служебный или личный транспорт, автобус. */
export type TripTransportClass = 'economy' | 'business' | 'rail_seat' | 'rail_coupe' | 'rail_sv' | 'car' | 'bus';
export type TripStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'report_pending' | 'closed';
/** Для журнала: «в командировке» — согласована и даты поездки включают сегодня. */
export type TripJournalStatus = TripStatus | 'on_trip' | 'report_due';
export type TripExpenseCategory = 'transport' | 'hotel' | 'per_diem' | 'visa' | 'insurance' | 'hospitality' | 'other';
/** Грейд должности для лимитов: руководство / специалисты. */
export type TripGrade = 'management' | 'specialist';
export type TripCurrency = 'UZS' | 'USD';

/** Норма по направлению: суточные и лимит проживания (демо-значения). */
export interface TripDestination {
  id: string;
  type: TripDestinationType;
  city: string;
  country: string;
  cityUz: string; // название на узбекском (латиница) — для интерфейса на uz
  countryUz: string;
  cityEn?: string;
  countryEn?: string;
  currency: TripCurrency;
  perDiem: number; // в валюте нормы, в сутки
  hotelLimit: number; // в валюте нормы, за ночь
}

/** Лимиты по грейду: допустимые классы проезда, коэффициент к лимиту проживания, представительские. */
export interface TripGradeNorm {
  grade: TripGrade;
  allowedClasses: TripTransportClass[];
  hotelFactor: number;
  hospitalityLimit: number; // сум на поездку
}

export interface TripPlanLine {
  category: Extract<TripExpenseCategory, 'visa' | 'insurance' | 'hospitality' | 'other'>;
  description: string;
  amount: number;
}

export interface TripExpenseLine {
  category: TripExpenseCategory;
  description: string;
  amount: number;
  hasReceipt: boolean;
}

/** Отклонение отчёта от норм и лимитов (PR-TRV-010). */
export interface TripDeviation {
  code: 'per_diem_over' | 'hotel_over' | 'transport_over' | 'no_receipt' | 'no_files' | 'hospitality_over' | 'category_unplanned';
  category: TripExpenseCategory;
  amount: number;
  limit: number;
}

export interface TripReport {
  submittedAt: ISODate;
  lines: TripExpenseLine[];
  deviations?: TripDeviation[];
  hrCheckedBy?: ID;
  hrCheckedAt?: ISODate;
  signatureIds?: ID[];
  returnedReason?: string;
  acceptedBy?: ID;
  acceptedAt?: ISODate;
}

export interface TripBudgetCheck {
  checkedAt: ISODate;
  status: 'ok' | 'warning' | 'exceeded' | 'no_line' | 'unavailable';
  available: number;
  amount: number;
  limit: number;
  blocked: boolean;
  reserved?: number;
  consumed?: number;
}

export interface TripOrder {
  number: string;
  documentId?: ID;
  createdAt: ISODate;
  signatureIds?: ID[];
}

export interface TripAdvancePayment {
  method: 'cash' | 'card';
  requestNo: string;
  status: 'requested' | 'paid' | 'queued' | 'failed';
  requestedAt: ISODate;
  requestedBy: ID;
  card?: string; // маска карты
  paidAt?: ISODate;
  paidBy?: ID;
  exchangeId?: ID;
}

export interface TripPosting {
  debit: string;
  credit: string;
  amount: number;
  purpose: string;
}

/** P4 (PR-TRV-015): бронирование через системы бронирования (интеграционная шина). */
export type TripBookingKind = 'air' | 'rail' | 'hotel';
export type TripBookingStatus = 'queued' | 'confirmed' | 'failed' | 'cancelled';
/** Почему предложение вне норм: класс не разрешён грейду, цена проезда выше плана +15%, проживание выше лимита за ночь. */
export type TripNormIssue = 'class_not_allowed' | 'price_over_norm' | 'hotel_over_limit';

/** Предложение из поиска с проверкой норм и бюджета (для экрана выбора). */
export interface TripBookingOffer {
  id: string;
  kind: TripBookingKind;
  systemId: string;
  provider: string;
  title: string;
  details: string;
  transportClass?: TripTransportClass;
  stars?: number;
  nights?: number;
  /** Цена за ночь (гостиница) или за маршрут туда-обратно, UZS. */
  unitPrice: number;
  price: number;
  refundable: boolean;
  penaltyPct: number;
  /** Норма, с которой сравнивается цена: лимит проживания за ночь или план проезда +15%. */
  norm: number;
  issues: TripNormIssue[];
  /** Ожидаемые расходы командировки, если выбрать это предложение. */
  committedAfter: number;
  /** Сколько нужно дозарезервировать в бюджете сверх текущего резерва. */
  topUp: number;
  budget: 'ok' | 'topup' | 'blocked';
  /** Система бронирования недоступна — предложение из последнего поиска, бронь встанет в очередь шины. */
  stale?: boolean;
}

export interface TripBooking {
  id: ID;
  kind: TripBookingKind;
  systemId: string;
  offerId: string;
  provider: string;
  title: string;
  details: string;
  transportClass?: TripTransportClass;
  nights?: number;
  unitPrice: number;
  price: number;
  refundable: boolean;
  penaltyPct: number;
  norm: number;
  issues: TripNormIssue[];
  justification?: string;
  status: TripBookingStatus;
  pnr?: string;
  /** Номер электронного билета / ваучера. */
  documentNo?: string;
  /** Файл документа во вложениях командировки. */
  fileId?: ID;
  exchangeId: ID;
  cancelExchangeId?: ID;
  refundAmount?: number;
  penalty?: number;
  refundDoc?: string;
  cancelReason?: string;
  createdAt: ISODate;
  createdBy: ID;
  confirmedAt?: ISODate;
  cancelledAt?: ISODate;
  cancelledBy?: ID;
}

/** Ожидаемые расходы с учётом бронирований: забронированный проезд/проживание заменяют плановые оценки. */
export interface TripCommitted {
  transport: number;
  hotel: number;
  perDiem: number;
  other: number;
  penalties: number;
  total: number;
  booked: number;
  transportBooked: boolean;
  hotelBooked: boolean;
}

export interface TripRequest {
  id: ID;
  number: string;
  employeeId: ID;
  departmentId: ID;
  destinationId: string;
  startDate: ISODate;
  endDate: ISODate;
  purpose: string;
  transport: TripTransport;
  transportClass?: TripTransportClass;
  transportCost: number; // оценка стоимости проезда туда-обратно, сум
  hotelNightly: number; // планируемая стоимость проживания за ночь, сум
  /** Дополнительные дни в пути (время в пути сверх дат командировки). */
  travelDays?: number;
  planLines?: TripPlanLine[];
  advance: number; // сумма аванса, сум
  status: TripStatus;
  budget?: TripBudgetCheck;
  order?: TripOrder;
  advancePayment?: TripAdvancePayment;
  report?: TripReport;
  postings?: TripPosting[];
  postingExchangeId?: ID;
  bookings?: TripBooking[];
  settledAt?: ISODate;
  archivedAt?: ISODate;
  createdAt: ISODate;
  history: HistoryEvent[];
}

export interface TripCalc {
  days: number;
  nights: number;
  perDiemDays: number;
  perDiemRate: number; // сум в сутки
  perDiemTotal: number;
  hotelTotal: number;
  hotelLimit: number; // сум за ночь с учётом грейда
  transport: number;
  other: number;
  total: number;
  hotelOverLimit: boolean;
  classAllowed: boolean;
  hospitalityOver: boolean;
  rate: number; // курс валюты нормы
}

export interface TripSettlement {
  advance: number;
  spent: number;
  /** > 0 — банк доплачивает сотруднику, < 0 — сотрудник возвращает остаток. */
  balance: number;
}

export interface TripFilter {
  status?: TripStatus | 'on_trip' | 'report_due';
  destinationType?: TripDestinationType;
  employeeId?: ID;
  departmentId?: ID;
  search?: string;
  from?: string;
  to?: string;
}

export interface NewTripInput {
  employeeId: ID;
  departmentId: ID;
  destinationId: string;
  startDate: ISODate;
  endDate: ISODate;
  purpose: string;
  transport: TripTransport;
  transportClass?: TripTransportClass;
  transportCost: number;
  hotelNightly: number;
  travelDays?: number;
  planLines?: TripPlanLine[];
  submit: boolean;
}

export interface TripStats {
  onTripNow: number;
  pending: number;
  advancesMonth: number;
  reportsDue: number;
  reportsOnCheck: number;
}

export interface TripNorms {
  destinations: TripDestination[];
  grades: TripGradeNorm[];
  usdRate: number;
}

export interface TripReportRow {
  key: string; // departmentId / employeeId / destinationId
  trips: number;
  days: number;
  planned: number;
  actual: number;
  avgCost: number;
  avgPerDay: number;
}

export interface TripBudgetRow {
  departmentId: ID;
  limit: number;
  used: number;
  tripsPlanned: number;
  tripsActual: number;
  available: number;
}

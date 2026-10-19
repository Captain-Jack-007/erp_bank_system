// Типы модуля «Автопарк» (ТЗ 4.2.6): транспорт и генераторы, водители, закрепления, путевые листы,
// расходы (ГСМ, ТО, ремонт, страхование, прочие, штрафы), топливные карты, проводки, отчёты.
import type { HistoryEvent, ID, ISODate } from '../../types';

/** Автомобиль или генератор (учитываются в едином реестре, PR-FLT-001, 4.2.6.1). */
export type FleetKind = 'vehicle' | 'generator';
/** Тип ТС (PR-FLT-006): легковой, грузовой, специальный; для генераторов — 'generator'. */
export type FleetVehicleType = 'car' | 'truck' | 'special' | 'bus' | 'generator';
export type FleetFuel = 'petrol' | 'diesel' | 'methane' | 'propane' | 'electric';
/** Статусы ТС (PR-FLT-016…021) + промежуточный «на списании» (заявка на списание ОС в согласовании). */
export type FleetStatus = 'in_operation' | 'repair' | 'inspection' | 'reserve' | 'writeoff_pending' | 'written_off';
export type FleetPurpose = 'collection' | 'business' | 'management' | 'service' | 'power';

export interface FleetVehicle {
  id: ID;
  kind: FleetKind;
  /** Госномер (для генератора — инвентарный номер). */
  plate: string;
  brand: string;
  model: string;
  year: number;
  vin: string;
  techPassportNo: string;
  vehicleType: FleetVehicleType;
  purpose: FleetPurpose;
  fuel: FleetFuel;
  /** Базовая норма: л (кВт·ч) на 100 км; для генератора — л на моточас. */
  fuelNorm: number;
  /** Зимняя надбавка к норме, % (ноябрь–март). */
  winterPct: number;
  /** Надбавка за работу в городе, %. */
  cityPct: number;
  /** Месячный лимит топлива, л и сум (PR-FLT-008, 4.2.6.1). */
  limitLitres: number;
  limitSum: number;
  /** Балансовая стоимость (если ТС не связано с карточкой ОС), сум. */
  bookValue: number;
  /** Связь с основным средством (модуль «Основные средства»). */
  assetId?: ID;
  /** Закреплённое подразделение / филиал (ключ оргединицы) и МВЗ (PR-FLT-010, 011). */
  orgUnitKey: string;
  costCenterKey: string;
  /** Счёт затрат (закреплённый счёт, 4.2.6.1). */
  expenseAccount: string;
  status: FleetStatus;
  /** Одометр, км (генератор — моточасы). */
  mileage: number;
  primaryDriverId?: ID;
  reserveDriverId?: ID;
  /** Плановое ТО: интервалы по пробегу (км / моточасы) и по времени (мес.), последнее ТО (PR-FLT-054). */
  serviceIntervalKm: number;
  serviceIntervalMonths: number;
  lastServiceKm: number;
  lastServiceDate: ISODate;
  /** Объём бака, л (для контроля остатков). */
  tankLitres: number;
  createdAt: ISODate;
  /** Статус до заявки на списание (для отката при отклонении). */
  statusBeforeWriteoff?: FleetStatus;
  writeoffReason?: string;
  /** Акт списания ОС-4 (модуль «Основные средства»). */
  writeoffActId?: ID;
}

/** Списание ТС: для связанного ОС — акт ОС-4 с комиссией (модуль «Основные средства»). */
export interface FleetWriteoffInput {
  reason: string;
  kind?: 'liquidation' | 'unusable';
  protocolNo?: string;
  chairmanId?: ID;
  memberIds?: ID[];
}

/** Расчётные поля карточки (не хранятся). */
export interface FleetVehicleView extends FleetVehicle {
  onTrip: boolean;
  openTripId?: ID;
  /** Путевой лист, ожидающий подписи диспетчера / возвращённый. */
  pendingTripId?: ID;
  insuranceUntil?: ISODate;
  inspectionUntil?: ISODate;
  techPassportUntil?: ISODate;
  nextServiceKm: number;
  nextServiceDate: ISODate;
  /** Балансовая (остаточная) стоимость: из карточки ОС, если связана, иначе bookValue. */
  balanceValue: number;
  assetInventoryNo?: string;
  driverName?: string;
  reserveDriverName?: string;
}

export interface FleetStatusEvent {
  id: ID;
  vehicleId: ID;
  from: FleetStatus | null;
  to: FleetStatus;
  at: ISODate;
  userId: ID;
  reason?: string;
}

// ---------- Документы ТС (PR-FLT-023…028, 070…076) ----------

export type FleetDocType = 'tech_passport' | 'osago' | 'kasko' | 'power_of_attorney' | 'inspection';

export interface FleetDocument {
  id: ID;
  vehicleId: ID;
  type: FleetDocType;
  number: string;
  /** Страховщик / орган выдачи. */
  issuer: string;
  validFrom: ISODate;
  validUntil?: ISODate;
  /** Стоимость полиса / услуги, сум. */
  cost: number;
  /** Доверенность — на водителя. */
  driverId?: ID;
  /** replaced — заменён новым (продление). */
  status: 'active' | 'replaced';
  replacedById?: ID;
  createdAt: ISODate;
  createdBy: ID;
}

// ---------- Водители (PR-FLT-035…041) ----------

export interface FleetDriver {
  id: ID;
  /** Связь с учётной записью (роль «водитель») — для самообслуживания и подписи E-IMZO. */
  userId?: ID;
  fullName: string;
  personnelNo: string;
  phone: string;
  licenseNo: string;
  licenseCategories: string[];
  licenseUntil: ISODate;
  medicalUntil: ISODate;
  orgUnitKey: string;
  active: boolean;
}

// ---------- Закрепление и смена водителя (PR-FLT-029…034, 042…045) ----------

export type FleetAssignmentRole = 'primary' | 'reserve';
export type FleetAssignmentBasis = 'order' | 'power_of_attorney';
export type FleetAssignmentStatus = 'draft' | 'pending' | 'returned' | 'rejected' | 'approved' | 'completed' | 'cancelled';

export interface FleetHandoverAct {
  number: string;
  date: ISODate;
  odometer: number;
  fuelLevel: number;
  /** Состояние: кузов, салон, шины, комплектность, документы и ключи — true = в порядке. */
  checklist: Record<FleetChecklistItem, boolean>;
  defects: string;
  completedBy: ID;
  completedAt: ISODate;
}

export type FleetChecklistItem = 'body' | 'interior' | 'tires' | 'equipment' | 'documents' | 'keys';

export interface FleetAssignment {
  id: ID;
  number: string;
  vehicleId: ID;
  driverId: ID;
  /** Водитель, от которого передаётся ТС (смена водителя). */
  fromDriverId?: ID;
  role: FleetAssignmentRole;
  basis: FleetAssignmentBasis;
  effectiveFrom: ISODate;
  /** Период закрепления (заполняется при следующей смене). */
  effectiveTo?: ISODate;
  reason: string;
  status: FleetAssignmentStatus;
  createdBy: ID;
  createdAt: ISODate;
  act?: FleetHandoverAct;
  history: HistoryEvent[];
}

// ---------- Путевые листы (PR-FLT-085…101) ----------

export type FleetTripStatus = 'pending' | 'returned' | 'rejected' | 'open' | 'closed' | 'cancelled';

export interface FleetTrip {
  id: ID;
  number: string;
  vehicleId: ID;
  driverId: ID;
  status: FleetTripStatus;
  /** Дата выезда (YYYY-MM-DD) — для журнала и отчётов. */
  date: ISODate;
  departTime: string; // HH:MM
  returnDate: ISODate;
  returnTime: string; // HH:MM
  routeFrom: string;
  routeTo: string;
  waypoints: string;
  purpose: string;
  /** Поездка по городу — надбавка к норме. */
  city: boolean;
  odoStart: number;
  odoEnd?: number;
  /** Остаток топлива при выезде / возврате, л. */
  fuelStart: number;
  fuelEnd?: number;
  /** Фактический расход, л (остаток при выезде + заправки − остаток при возврате). */
  fuelUsed?: number;
  /** Нормативный расход с надбавками, л. */
  fuelNormUsed?: number;
  overrunReason?: string;
  costCenterKey: string;
  createdBy: ID;
  createdAt: ISODate;
  dispatcherId?: ID;
  dispatchedAt?: ISODate;
  closedBy?: ID;
  closedAt?: ISODate;
  history: HistoryEvent[];
}

// ---------- Генераторы: журнал работы ----------

export interface FleetRunLog {
  id: ID;
  vehicleId: ID;
  date: ISODate;
  hoursStart: number;
  hoursEnd: number;
  fuelUsed: number;
  fuelNormUsed: number;
  note: string;
  userId: ID;
}

// ---------- ГСМ (PR-FLT-046…052) ----------

export type FleetFuelSource = 'manual' | 'card' | 'driver';

export interface FleetFuelUp {
  id: ID;
  number: string;
  vehicleId: ID;
  driverId?: ID;
  tripId?: ID;
  date: ISODate;
  station: string;
  fuel: FleetFuel;
  litres: number;
  amount: number;
  cardId?: ID;
  source: FleetFuelSource;
  /** Внешний ID транзакции процессинга (дедупликация). */
  externalId?: string;
  overLimit?: boolean;
  overLimitReason?: string;
  costCenterKey: string;
  createdBy: ID;
}

export type FleetCardProvider = 'uzcard' | 'humo' | 'fuel_company';

export interface FleetFuelCard {
  id: ID;
  /** Маскированный номер. */
  number: string;
  provider: FleetCardProvider;
  /** Счёт карты (20 цифр) — для зачисления через iABS. */
  account: string;
  vehicleId: ID;
  driverId?: ID;
  monthlyLimit: number;
  balance: number;
  status: 'active' | 'blocked';
}

export type FleetTopUpStatus = 'draft' | 'pending' | 'returned' | 'rejected' | 'approved' | 'sent' | 'done' | 'failed';

export interface FleetTopUpLine {
  cardId: ID;
  amount: number;
  exchangeId?: ID;
  state?: 'pending' | 'success' | 'queued' | 'failed';
}

/** Распоряжение на зачисление средств на топливные карты в пределах лимитов (4.2.6.1, PR-FLT-051). */
export interface FleetTopUp {
  id: ID;
  number: string;
  period: string; // YYYY-MM
  lines: FleetTopUpLine[];
  total: number;
  status: FleetTopUpStatus;
  comment: string;
  createdBy: ID;
  createdAt: ISODate;
  history: HistoryEvent[];
}

// ---------- ТО и ремонт (PR-FLT-053…069) ----------

export type FleetServiceKind = 'maintenance' | 'repair';
export type FleetServiceStatus = 'open' | 'done' | 'cancelled';

export interface FleetWorkLine {
  name: string;
  hours: number;
  cost: number;
}

export interface FleetPartLine {
  name: string;
  qty: number;
  unit: string;
  price: number;
}

export interface FleetService {
  id: ID;
  number: string;
  vehicleId: ID;
  kind: FleetServiceKind;
  status: FleetServiceStatus;
  date: ISODate;
  doneDate?: ISODate;
  odometer: number;
  /** Описание неисправности (ремонт) / вид планового ТО. */
  fault: string;
  works: FleetWorkLine[];
  parts: FleetPartLine[];
  /** Исполнитель — СТО (контрагент). */
  contractorId?: ID;
  warranty: boolean;
  warrantyNote: string;
  /** Обращение водителя о неисправности, из которого создан ремонт. */
  faultReportId?: ID;
  costCenterKey: string;
  createdBy: ID;
  /** Перевели ли ТС в статус «В ремонте» при открытии. */
  tookOffline: boolean;
}

// ---------- Неисправности от водителя (PR-FLT-108) ----------

export interface FleetFaultReport {
  id: ID;
  number: string;
  vehicleId: ID;
  driverId: ID;
  date: ISODate;
  description: string;
  severity: 'low' | 'medium' | 'high';
  status: 'new' | 'in_repair' | 'closed';
  serviceId?: ID;
  createdBy: ID;
}

// ---------- Прочие расходы и штрафы (PR-FLT-077…084) ----------

export type FleetExpenseKind = 'wash' | 'parking' | 'tires' | 'accessories' | 'other';

export interface FleetExpense {
  id: ID;
  number: string;
  vehicleId: ID;
  kind: FleetExpenseKind;
  date: ISODate;
  amount: number;
  description: string;
  contractorId?: ID;
  driverId?: ID;
  costCenterKey: string;
  createdBy: ID;
}

export type FleetFineStatus = 'unpaid' | 'paid' | 'disputed' | 'cancelled';

export interface FleetFine {
  id: ID;
  vehicleId: ID;
  driverId?: ID;
  date: ISODate;
  protocolNo: string;
  violation: string;
  amount: number;
  status: FleetFineStatus;
  source: 'ubdd' | 'manual';
  /** Удержать с водителя. */
  recoverFromDriver: boolean;
  paidAt?: ISODate;
  exchangeId?: ID;
  costCenterKey: string;
}

// ---------- Проводки (PR-FLT-052, 059, 068, 076, 083) ----------

export type FleetPostingSource = 'fuel' | 'maintenance' | 'repair' | 'insurance' | 'other' | 'fine' | 'topup';
export type FleetPostingStatus = 'draft' | 'sending' | 'posted' | 'queued' | 'failed';

export interface FleetPosting {
  id: ID;
  number: string;
  date: ISODate;
  source: FleetPostingSource;
  sourceId: ID;
  sourceNumber: string;
  vehicleId: ID;
  costCenterKey: string;
  debit: string;
  credit: string;
  amount: number;
  description: string;
  status: FleetPostingStatus;
  batch?: string;
  exchangeId?: ID;
  error?: string;
  postedAt?: ISODate;
}

// ---------- Предупреждения и отчёты ----------

export type FleetAlertKind =
  | 'insurance'
  | 'kasko'
  | 'inspection'
  | 'tech_passport'
  | 'power_of_attorney'
  | 'service'
  | 'overconsumption'
  | 'license'
  | 'medical'
  | 'limit';

export interface FleetAlert {
  id: string;
  kind: FleetAlertKind;
  vehicleId?: ID;
  driverId?: ID;
  due?: ISODate;
  /** Просрочено (а не только скоро истекает). */
  expired: boolean;
  detail: string;
}

export interface FleetSettings {
  /** Горизонт предупреждений об истечении сроков, дней. */
  alertHorizonDays: number;
  /** Допустимое отклонение от нормы расхода, %. */
  overrunTolerancePct: number;
  /** Справочные цены топлива, сум/л (для оценки экономии/перерасхода, если нет заправок). */
  fuelPrices: Record<FleetFuel, number>;
}

export type FleetPeriodType = 'month' | 'quarter' | 'year';

export interface FleetPeriod {
  type: FleetPeriodType;
  /** 2026-10 | 2026-Q4 | 2026 */
  value: string;
  from: ISODate;
  to: ISODate;
}

export interface FleetCostBreakdown {
  fuel: number;
  maintenance: number;
  repair: number;
  insurance: number;
  other: number;
  fines: number;
  total: number;
}

export interface FleetVehicleReportRow extends FleetCostBreakdown {
  vehicleId: ID;
  plate: string;
  model: string;
  kind: FleetKind;
  fuelType: FleetFuel;
  costCenterKey: string;
  km: number;
  trips: number;
  fuelLitres: number;
  normLitres: number;
  /** Фактический расход по закрытым путевым листам/журналу работы, л. */
  usedLitres: number;
  /** Перерасход (+) / экономия (−) против нормы в сумах по средней цене литра за период. */
  deviationSum: number;
  limitLitres: number;
  limitSum: number;
  odoStart: number;
  odoEnd: number;
  days: number;
  usedDays: number;
  downtimeDays: number;
  idleDays: number;
  utilizationPct: number;
  costPerKm: number;
}

export interface FleetDriverReportRow {
  driverId: ID;
  name: string;
  trips: number;
  km: number;
  usedLitres: number;
  normLitres: number;
  overrunLitres: number;
  savingLitres: number;
  overrunSum: number;
  savingSum: number;
  fuelSum: number;
  fines: number;
  finesCount: number;
  expenses: number;
}

export interface FleetFuelTypeRow {
  fuel: FleetFuel;
  litres: number;
  amount: number;
  vehicles: number;
}

export interface FleetServiceReportRow {
  serviceId: ID;
  number: string;
  vehicleId: ID;
  plate: string;
  kind: FleetServiceKind;
  date: ISODate;
  contractor: string;
  warranty: boolean;
  works: number;
  parts: number;
  total: number;
  status: FleetServiceStatus;
}

export interface FleetReport {
  period: FleetPeriod;
  vehicles: FleetVehicleReportRow[];
  drivers: FleetDriverReportRow[];
  fuelTypes: FleetFuelTypeRow[];
  services: FleetServiceReportRow[];
  otherByKind: Record<FleetExpenseKind, number>;
  totals: FleetCostBreakdown & { km: number; fuelLitres: number; usedLitres: number; normLitres: number };
}

export interface FleetDashboard {
  period: FleetPeriod;
  byStatus: Record<FleetStatus, number>;
  onTrip: number;
  vehicles: number;
  generators: number;
  costs: FleetCostBreakdown;
  topVehicles: { vehicleId: ID; plate: string; total: number }[];
  topCategories: { key: keyof Omit<FleetCostBreakdown, 'total'>; total: number }[];
  needService: { vehicleId: ID; plate: string; detail: string; due?: ISODate; overdue: boolean }[];
  expiringDocs: FleetAlert[];
  km: number;
  fuelLitres: number;
  pendingTrips: number;
  openTrips: number;
  draftPostings: number;
}

export interface FleetStats {
  vehicles: number;
  generators: number;
  onTrip: number;
  maintenance: number;
  kmMonth: number;
  fuelMonth: number;
  alerts: number;
}

// ---------- Входные данные операций ----------

export interface FleetVehicleInput {
  kind: FleetKind;
  plate: string;
  brand: string;
  model: string;
  year: number;
  vin: string;
  techPassportNo: string;
  vehicleType: FleetVehicleType;
  purpose: FleetPurpose;
  fuel: FleetFuel;
  fuelNorm: number;
  winterPct: number;
  cityPct: number;
  limitLitres: number;
  limitSum: number;
  bookValue: number;
  orgUnitKey: string;
  costCenterKey: string;
  expenseAccount: string;
  mileage: number;
  serviceIntervalKm: number;
  serviceIntervalMonths: number;
  tankLitres: number;
  status?: FleetStatus;
}

export interface FleetTripInput {
  vehicleId: ID;
  driverId: ID;
  date: ISODate;
  departTime: string;
  returnDate: ISODate;
  returnTime: string;
  routeFrom: string;
  routeTo: string;
  waypoints: string;
  purpose: string;
  city: boolean;
  odoStart: number;
  fuelStart: number;
}

export interface FleetTripCloseInput {
  returnDate: ISODate;
  returnTime: string;
  odoEnd: number;
  fuelEnd: number;
  overrunReason?: string;
}

/** Совместимость: «закрыть путевой лист одной операцией» (быстрый ввод диспетчером). */
export interface NewFleetTripInput {
  vehicleId: ID;
  date: ISODate;
  route: string;
  purpose: string;
  odoEnd: number;
  fuelUsed: number;
}

export interface FleetFuelUpInput {
  vehicleId: ID;
  driverId?: ID;
  tripId?: ID;
  date: ISODate;
  station: string;
  fuel: FleetFuel;
  litres: number;
  amount: number;
  cardId?: ID;
  overLimitReason?: string;
  costCenterKey?: string;
}

export interface FleetServiceInput {
  vehicleId: ID;
  kind: FleetServiceKind;
  date: ISODate;
  odometer: number;
  fault: string;
  works: FleetWorkLine[];
  parts: FleetPartLine[];
  contractorId?: ID;
  warranty: boolean;
  warrantyNote: string;
  takeOffline: boolean;
  faultReportId?: ID;
  costCenterKey?: string;
}

export interface FleetDocumentInput {
  vehicleId: ID;
  type: FleetDocType;
  number: string;
  issuer: string;
  validFrom: ISODate;
  validUntil?: ISODate;
  cost: number;
  driverId?: ID;
}

export interface FleetDriverInput {
  userId?: ID;
  fullName: string;
  personnelNo: string;
  phone: string;
  licenseNo: string;
  licenseCategories: string[];
  licenseUntil: ISODate;
  medicalUntil: ISODate;
  orgUnitKey: string;
  active: boolean;
}

export interface FleetAssignmentInput {
  vehicleId: ID;
  driverId: ID;
  role: FleetAssignmentRole;
  basis: FleetAssignmentBasis;
  effectiveFrom: ISODate;
  reason: string;
}

export interface FleetExpenseInput {
  vehicleId: ID;
  kind: FleetExpenseKind;
  date: ISODate;
  amount: number;
  description: string;
  contractorId?: ID;
  driverId?: ID;
  costCenterKey?: string;
}

export interface FleetFineInput {
  vehicleId: ID;
  driverId?: ID;
  date: ISODate;
  protocolNo: string;
  violation: string;
  amount: number;
}

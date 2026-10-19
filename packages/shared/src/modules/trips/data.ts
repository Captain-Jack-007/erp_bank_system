// Демо-данные модуля trips (вымышленные; нормы суточных и лимиты — демонстрационные).
import type { ApprovalTask } from '../../types';
import type { TripDestination, TripGradeNorm, TripRequest } from './types';

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

export const tripDestinations: TripDestination[] = [
  { id: 'samarkand', type: 'domestic', city: 'Самарканд', country: 'Узбекистан', cityUz: 'Samarqand', countryUz: "O'zbekiston", cityEn: 'Samarkand', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 650_000 },
  { id: 'bukhara', type: 'domestic', city: 'Бухара', country: 'Узбекистан', cityUz: 'Buxoro', countryUz: "O'zbekiston", cityEn: 'Bukhara', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 600_000 },
  { id: 'nukus', type: 'domestic', city: 'Нукус', country: 'Узбекистан', cityUz: 'Nukus', countryUz: "O'zbekiston", cityEn: 'Nukus', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 550_000 },
  { id: 'fergana', type: 'domestic', city: 'Фергана', country: 'Узбекистан', cityUz: "Farg'ona", countryUz: "O'zbekiston", cityEn: 'Fergana', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 550_000 },
  { id: 'namangan', type: 'domestic', city: 'Наманган', country: 'Узбекистан', cityUz: 'Namangan', countryUz: "O'zbekiston", cityEn: 'Namangan', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 500_000 },
  { id: 'andijan', type: 'domestic', city: 'Андижан', country: 'Узбекистан', cityUz: 'Andijon', countryUz: "O'zbekiston", cityEn: 'Andijan', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 500_000 },
  { id: 'karshi', type: 'domestic', city: 'Карши', country: 'Узбекистан', cityUz: 'Qarshi', countryUz: "O'zbekiston", cityEn: 'Karshi', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 500_000 },
  { id: 'termez', type: 'domestic', city: 'Термез', country: 'Узбекистан', cityUz: 'Termiz', countryUz: "O'zbekiston", cityEn: 'Termez', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 500_000 },
  { id: 'urgench', type: 'domestic', city: 'Ургенч', country: 'Узбекистан', cityUz: 'Urganch', countryUz: "O'zbekiston", cityEn: 'Urgench', countryEn: 'Uzbekistan', currency: 'UZS', perDiem: 165_000, hotelLimit: 550_000 },
  { id: 'almaty', type: 'abroad', city: 'Алматы', country: 'Казахстан', cityUz: 'Olmaota', countryUz: "Qozog'iston", cityEn: 'Almaty', countryEn: 'Kazakhstan', currency: 'USD', perDiem: 65, hotelLimit: 150 },
  { id: 'moscow', type: 'abroad', city: 'Москва', country: 'Россия', cityUz: 'Moskva', countryUz: 'Rossiya', cityEn: 'Moscow', countryEn: 'Russia', currency: 'USD', perDiem: 80, hotelLimit: 190 },
  { id: 'beijing', type: 'abroad', city: 'Пекин', country: 'Китай', cityUz: 'Pekin', countryUz: 'Xitoy', cityEn: 'Beijing', countryEn: 'China', currency: 'USD', perDiem: 85, hotelLimit: 175 },
  { id: 'istanbul', type: 'abroad', city: 'Стамбул', country: 'Турция', cityUz: 'Istanbul', countryUz: 'Turkiya', cityEn: 'Istanbul', countryEn: 'Türkiye', currency: 'USD', perDiem: 80, hotelLimit: 165 },
  { id: 'dubai', type: 'abroad', city: 'Дубай', country: 'ОАЭ', cityUz: 'Dubay', countryUz: 'BAA', cityEn: 'Dubai', countryEn: 'UAE', currency: 'USD', perDiem: 110, hotelLimit: 220 },
];

export const tripGradeNorms: TripGradeNorm[] = [
  { grade: 'management', allowedClasses: ['economy', 'business', 'rail_coupe', 'rail_sv', 'car', 'bus', 'rail_seat'], hotelFactor: 1.5, hospitalityLimit: 5_000_000 },
  { grade: 'specialist', allowedClasses: ['economy', 'rail_seat', 'rail_coupe', 'car', 'bus'], hotelFactor: 1, hospitalityLimit: 1_000_000 },
];

export const tripSeed: TripRequest[] = [
  {
    id: 'tr1', number: 'KM-2026-0318', employeeId: 'u1', departmentId: 'd1', destinationId: 'samarkand', startDate: '2026-10-27', endDate: '2026-10-30',
    purpose: 'Запуск ИТ-инфраструктуры нового центра банковских услуг', transport: 'rail', transportClass: 'rail_coupe', transportCost: 520_000, hotelNightly: 600_000,
    advance: 2_980_000, status: 'pending', createdAt: '2026-10-15T09:00:00Z',
    history: [
      { at: '2026-10-15T09:00:00Z', userId: 'u1', action: 'created' },
      { at: '2026-10-15T09:05:00Z', userId: 'u1', action: 'submitted' },
    ],
  },
  {
    id: 'tr2', number: 'KM-2026-0309', employeeId: 'u3', departmentId: 'd4', destinationId: 'beijing', startDate: '2026-10-05', endDate: '2026-10-10',
    purpose: 'Переговоры с производителями платёжных терминалов, выставка', transport: 'air', transportClass: 'economy', transportCost: 9_800_000, hotelNightly: 2_100_000,
    planLines: [{ category: 'visa', description: 'Визовый сбор КНР', amount: 900_000 }, { category: 'insurance', description: 'Медицинская страховка', amount: 250_000 }],
    advance: 27_901_500, status: 'approved', createdAt: '2026-09-20T07:30:00Z',
    order: { number: 'VN-2026-01890', createdAt: '2026-09-22T10:00:00Z' },
    advancePayment: { method: 'card', requestNo: 'ZA-2026-0201', status: 'paid', requestedAt: '2026-09-22T10:05:00Z', requestedBy: 'u3', card: '8600 **** **** 4412', paidAt: '2026-09-22T12:00:00Z', paidBy: 'u7' },
    history: [
      { at: '2026-09-20T07:30:00Z', userId: 'u3', action: 'created' },
      { at: '2026-09-21T08:00:00Z', userId: 'u3', action: 'approved', comment: 'Руководитель' },
      { at: '2026-09-21T12:00:00Z', userId: 'u13', action: 'approved', comment: 'HR' },
      { at: '2026-09-22T09:00:00Z', userId: 'u4', action: 'approved', comment: 'Финансы: лимит подтверждён' },
      { at: '2026-09-22T12:00:00Z', userId: 'u7', action: 'status_changed', comment: 'Аванс перечислен на корпоративную карту.' },
    ],
  },
  {
    id: 'tr3', number: 'KM-2026-0297', employeeId: 'u4', departmentId: 'd3', destinationId: 'nukus', startDate: '2026-09-22', endDate: '2026-09-24',
    purpose: 'Проверка исполнения бюджета филиала', transport: 'air', transportClass: 'economy', transportCost: 1_650_000, hotelNightly: 500_000,
    advance: 3_145_000, status: 'report_pending', createdAt: '2026-09-15T06:00:00Z',
    order: { number: 'VN-2026-01861', createdAt: '2026-09-16T09:00:00Z' },
    advancePayment: { method: 'cash', requestNo: 'ZA-2026-0188', status: 'paid', requestedAt: '2026-09-16T09:10:00Z', requestedBy: 'u4', paidAt: '2026-09-16T15:00:00Z', paidBy: 'u12' },
    report: {
      submittedAt: '2026-09-26T08:00:00Z',
      lines: [
        { category: 'transport', description: 'Авиабилеты Ташкент — Нукус — Ташкент', amount: 1_720_000, hasReceipt: true },
        { category: 'hotel', description: 'Гостиница, 2 ночи', amount: 980_000, hasReceipt: true },
        { category: 'per_diem', description: 'Суточные, 3 дня', amount: 495_000, hasReceipt: false },
        { category: 'other', description: 'Такси аэропорт — гостиница', amount: 80_000, hasReceipt: true },
      ],
    },
    history: [
      { at: '2026-09-15T06:00:00Z', userId: 'u4', action: 'created' },
      { at: '2026-09-16T08:00:00Z', userId: 'u7', action: 'approved' },
      { at: '2026-09-26T08:00:00Z', userId: 'u4', action: 'status_changed', comment: 'Подан авансовый отчёт' },
    ],
  },
  {
    id: 'tr4', number: 'KM-2026-0281', employeeId: 'u5', departmentId: 'd5', destinationId: 'almaty', startDate: '2026-09-08', endDate: '2026-09-10',
    purpose: 'Семинар по регулированию платёжных систем', transport: 'air', transportClass: 'economy', transportCost: 3_900_000, hotelNightly: 1_800_000,
    advance: 9_966_750, status: 'closed', createdAt: '2026-08-28T06:00:00Z',
    order: { number: 'VN-2026-01802', createdAt: '2026-08-29T09:00:00Z' },
    advancePayment: { method: 'card', requestNo: 'ZA-2026-0164', status: 'paid', requestedAt: '2026-08-29T09:00:00Z', requestedBy: 'u5', card: '8600 **** **** 1177', paidAt: '2026-08-29T13:00:00Z', paidBy: 'u7' },
    report: {
      submittedAt: '2026-09-12T08:00:00Z', acceptedBy: 'u7', acceptedAt: '2026-09-14T09:00:00Z', hrCheckedBy: 'u13', hrCheckedAt: '2026-09-13T10:00:00Z',
      lines: [
        { category: 'transport', description: 'Авиабилеты Ташкент — Алматы — Ташкент', amount: 3_760_000, hasReceipt: true },
        { category: 'hotel', description: 'Гостиница, 2 ночи', amount: 3_600_000, hasReceipt: true },
        { category: 'per_diem', description: 'Суточные, 3 дня', amount: 2_550_000, hasReceipt: false },
      ],
    },
    postings: [
      { debit: '56806000', credit: '16405000', amount: 9_910_000, purpose: 'KM-2026-0281: командировочные расходы' },
      { debit: '10101000', credit: '16405000', amount: 56_750, purpose: 'KM-2026-0281: возврат остатка аванса' },
    ],
    settledAt: '2026-09-14T09:00:00Z',
    history: [
      { at: '2026-08-28T06:00:00Z', userId: 'u5', action: 'created' },
      { at: '2026-08-29T08:00:00Z', userId: 'u7', action: 'approved' },
      { at: '2026-09-14T09:00:00Z', userId: 'u7', action: 'status_changed', comment: 'Авансовый отчёт принят, остаток возвращён' },
    ],
  },
  {
    id: 'tr5', number: 'KM-2026-0321', employeeId: 'u6', departmentId: 'd2', destinationId: 'fergana', startDate: '2026-11-10', endDate: '2026-11-12',
    purpose: 'Приёмка ремонта помещения ЦБУ', transport: 'car', transportClass: 'car', transportCost: 900_000, hotelNightly: 450_000,
    advance: 2_295_000, status: 'draft', createdAt: '2026-10-17T11:00:00Z',
    history: [{ at: '2026-10-17T11:00:00Z', userId: 'u6', action: 'created' }],
  },
  {
    id: 'tr6', number: 'KM-2026-0315', employeeId: 'u10', departmentId: 'd10', destinationId: 'andijan', startDate: day(-1), endDate: day(2),
    purpose: 'Мониторинг залогового имущества корпоративных заёмщиков', transport: 'rail', transportClass: 'rail_coupe', transportCost: 460_000, hotelNightly: 500_000,
    advance: 2_620_000, status: 'approved', createdAt: ago(9),
    order: { number: 'VN-2026-01922', createdAt: ago(6) },
    advancePayment: { method: 'card', requestNo: 'ZA-2026-0219', status: 'paid', requestedAt: ago(6), requestedBy: 'u10', card: '8600 **** **** 9031', paidAt: ago(5), paidBy: 'u7' },
    history: [
      { at: ago(9), userId: 'u10', action: 'created' },
      { at: ago(7), userId: 'u21', action: 'approved', comment: 'Руководитель' },
      { at: ago(7), userId: 'u13', action: 'approved', comment: 'HR' },
      { at: ago(6), userId: 'u4', action: 'approved', comment: 'Финансы: лимит подтверждён' },
    ],
  },
];

export const tripApprovalSeed: ApprovalTask[] = [
  {
    id: 'a_tr1', entity: 'business_trip', entityId: 'tr1', title: 'Командировка: Самарканд, 27–30.10', number: 'KM-2026-0318',
    amount: 2_980_000, requesterId: 'u1', assigneeRole: 'dept_head', step: 1, totalSteps: 3,
    createdAt: '2026-10-15T09:05:00Z', dueAt: '2026-10-20T18:00:00Z', status: 'pending',
  },
  {
    id: 'a_tr3r', entity: 'business_trip', entityId: 'tr3:report', title: 'Авансовый отчёт: Нукус, 22–24.09', number: 'KM-2026-0297',
    amount: 3_275_000, requesterId: 'u4', assigneeRole: 'hr', step: 1, totalSteps: 2,
    createdAt: '2026-09-26T08:00:00Z', dueAt: '2026-09-28T18:00:00Z', status: 'pending',
  },
];

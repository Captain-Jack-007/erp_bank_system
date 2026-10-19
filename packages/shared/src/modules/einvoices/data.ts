// Демо-данные модуля einvoices (вымышленные). Моменты поступления задаются относительно текущего времени,
// чтобы светофор 10-дневного срока (ПКМ № 489) и 5-дневный срок подразделений были наглядны в любой день.
import type { ApprovalTask } from '../../types';
import type { EinvoiceDoc, EinvoiceKind, EinvoiceLine } from './types';

const DAY = 86_400_000;
/** Момент «days дней и hours часов назад» (ISO). */
export const einvoiceAgo = (days: number, hours = 0): string => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();
const inDays = (days: number): string => new Date(Date.now() + days * DAY).toISOString();

const unitIT = { ru: 'Департамент информационных технологий', uz: 'Axborot texnologiyalari departamenti', en: 'Information Technology Department' };
const unitADM = { ru: 'Административно-хозяйственный департамент', uz: "Ma'muriy-xo'jalik departamenti", en: 'Administration and Facilities Department' };
const unitSAM = { ru: 'Самаркандский областной филиал', uz: 'Samarqand viloyat filiali', en: 'Samarkand regional branch' };

export const einvoiceSeed: EinvoiceDoc[] = [
  {
    id: 'ei1', number: 'EF-2026-0412', direction: 'incoming', kind: 'invoice', source: 'soliq', date: '2026-10-16', receivedAt: einvoiceAgo(1, 3), counterpartyId: 'c3', contractId: 'k1', status: 'new', vatRate: 12,
    operatorId: 'OP-7F3A-1120',
    lines: [
      { name: 'Стол рабочий 1400×700', qty: 30, unit: 'шт', unitPrice: 2_142_857 },
      { name: 'Кресло офисное', qty: 30, unit: 'шт', unitPrice: 1_562_500 },
    ],
    history: [{ at: einvoiceAgo(1, 3), userId: 'u7', action: 'created', comment: 'Получен через API Налогового комитета' }],
  },
  {
    id: 'ei2', number: 'EF-2026-0409', direction: 'incoming', kind: 'invoice', source: 'soliq', date: '2026-10-12', receivedAt: einvoiceAgo(6, 2), counterpartyId: 'c1', contractId: 'k2', status: 'pending', vatRate: 12,
    operatorId: 'OP-7F3A-1098',
    lines: [{ name: 'Техническое обслуживание серверов, III квартал 2026', qty: 1, unit: 'усл', unitPrice: 276_785_714 }],
    assignment: { orgUnitKey: 'd1', unitName: unitIT, unitType: 'department', assigneeIds: ['u2'], routedAt: einvoiceAgo(6, 1), routedBy: 'u7', dueAt: einvoiceAgo(1, 1), decision: 'confirmed', decidedAt: einvoiceAgo(5), decidedBy: 'u2' },
    history: [
      { at: einvoiceAgo(6, 2), userId: 'u7', action: 'created', comment: 'Получен через API Налогового комитета' },
      { at: einvoiceAgo(6, 1), userId: 'u7', action: 'status_changed', comment: 'Направлен в подразделение: Департамент информационных технологий' },
      { at: einvoiceAgo(5), userId: 'u2', action: 'approved', comment: 'Подразделение подтвердило: работы выполнены' },
      { at: einvoiceAgo(5), userId: 'u2', action: 'submitted' },
    ],
  },
  {
    id: 'ei3', number: 'EF-2026-0398', direction: 'incoming', kind: 'invoice', source: 'soliq', date: '2026-10-01', receivedAt: '2026-10-01T10:00:00Z', counterpartyId: 'c2', status: 'signed', vatRate: 12,
    operatorId: 'OP-7F3A-1011', signedBy: 'u7', signedAt: '2026-10-02T11:20:00Z',
    lines: [{ name: 'Лицензии СЭД, продление', qty: 1, unit: 'усл', unitPrice: 37_500_000 }],
    postings: [
      { debit: '56802000', credit: '29802000', amount: 37_500_000, purpose: 'Лицензии СЭД, продление' },
      { debit: '19905000', credit: '29802000', amount: 4_500_000, purpose: 'НДС к зачёту' },
    ],
    postedAt: '2026-10-02T11:25:00Z',
    history: [
      { at: '2026-10-01T10:00:00Z', userId: 'u7', action: 'created', comment: 'Получен через API Налогового комитета' },
      { at: '2026-10-02T11:20:00Z', userId: 'u7', action: 'approved', comment: 'Подписано ЭЦП E-IMZO' },
    ],
  },
  {
    id: 'ei4', number: 'EF-2026-0401', direction: 'incoming', kind: 'invoice', source: 'soliq', date: '2026-10-05', receivedAt: '2026-10-05T07:40:00Z', counterpartyId: 'c4', status: 'rejected', vatRate: 12,
    operatorId: 'OP-7F3A-1044', rejectReason: 'Неверный ИНН покупателя в документе.',
    lines: [{ name: 'Ремонт кондиционеров', qty: 6, unit: 'шт', unitPrice: 950_000 }],
    history: [
      { at: '2026-10-05T07:40:00Z', userId: 'u7', action: 'created', comment: 'Получен через API Налогового комитета' },
      { at: '2026-10-06T08:15:00Z', userId: 'u7', action: 'rejected', comment: 'Неверный ИНН покупателя в документе.' },
    ],
  },
  {
    id: 'ei8', number: 'EF-2026-0415', direction: 'incoming', kind: 'invoice', source: 'soliq', date: '2026-10-17', receivedAt: einvoiceAgo(0, 5), counterpartyId: 'c2', contractId: 'k4', status: 'new', vatRate: 12,
    operatorId: 'OP-7F3A-1131',
    lines: [{ name: 'Сопровождение СЭД, дополнительные работы', qty: 40, unit: 'ч', unitPrice: 650_000 }],
    history: [{ at: einvoiceAgo(0, 5), userId: 'u7', action: 'created', comment: 'Получен через API Налогового комитета' }],
  },
  {
    id: 'ei9', number: 'AVR-2026-0233', direction: 'incoming', kind: 'work_act', source: 'soliq', date: '2026-10-13', receivedAt: einvoiceAgo(4, 4), counterpartyId: 'c3', contractId: 'k1', status: 'routed', vatRate: 12,
    operatorId: 'OP-7F3A-1102',
    lines: [{ name: 'Сборка и установка мебели в ЦБУ «Регистан»', qty: 1, unit: 'усл', unitPrice: 9_800_000 }],
    assignment: { orgUnitKey: 'd2', unitName: unitADM, unitType: 'department', assigneeIds: ['u6'], routedAt: einvoiceAgo(4, 3), routedBy: 'u7', dueAt: inDays(0.6), comment: 'Проверить фактическое выполнение работ' },
    history: [
      { at: einvoiceAgo(4, 4), userId: 'u7', action: 'created', comment: 'Акт получен через API Налогового комитета' },
      { at: einvoiceAgo(4, 3), userId: 'u7', action: 'status_changed', comment: 'Направлен в подразделение: Административно-хозяйственный департамент' },
    ],
  },
  {
    id: 'ei10', number: 'SV-2026-0057', direction: 'incoming', kind: 'reconciliation_act', source: 'soliq', date: '2026-10-09', receivedAt: einvoiceAgo(8, 6), counterpartyId: 'c1', contractId: 'k2', status: 'new', vatRate: 0,
    operatorId: 'OP-7F3A-1077',
    lines: [{ name: 'Сальдо взаиморасчётов на 30.09.2026', qty: 1, unit: 'док', unitPrice: 310_000_000 }],
    reconciliation: {
      periodFrom: '2026-07-01', periodTo: '2026-09-30', opening: 0,
      lines: [
        { date: '2026-07-15', doc: 'EF-2026-0311', debit: 310_000_000, credit: 0 },
        { date: '2026-08-10', doc: 'ПП 2026-0811', debit: 0, credit: 310_000_000 },
        { date: '2026-09-30', doc: 'EF-2026-0409', debit: 310_000_000, credit: 0 },
      ],
      closing: 310_000_000,
    },
    history: [{ at: einvoiceAgo(8, 6), userId: 'u7', action: 'created', comment: 'Акт сверки получен через API Налогового комитета' }],
  },
  {
    id: 'ei11', number: 'EF-2026-0377', direction: 'incoming', kind: 'invoice', source: 'soliq', date: '2026-10-04', receivedAt: einvoiceAgo(12, 2), counterpartyId: 'c3', status: 'routed', vatRate: 12,
    operatorId: 'OP-7F3A-1003',
    lines: [{ name: 'Шкафы для документов (ЦБУ «Ургут»)', qty: 8, unit: 'шт', unitPrice: 3_150_000 }],
    assignment: { orgUnitKey: 'R09', unitName: unitSAM, unitType: 'region', assigneeIds: ['u21'], routedAt: einvoiceAgo(12, 1), routedBy: 'u7', dueAt: einvoiceAgo(7, 1), comment: 'Подтвердить получение мебели филиалом' },
    history: [
      { at: einvoiceAgo(12, 2), userId: 'u7', action: 'created', comment: 'Получен через API Налогового комитета' },
      { at: einvoiceAgo(12, 1), userId: 'u7', action: 'status_changed', comment: 'Направлен в подразделение: Самаркандский областной филиал' },
    ],
  },
  {
    id: 'ei12', number: 'AVR-2026-0219', direction: 'incoming', kind: 'work_act', source: 'soliq', date: '2026-10-03', receivedAt: '2026-10-03T08:00:00Z', counterpartyId: 'c1', contractId: 'k2', status: 'signed', vatRate: 12,
    operatorId: 'OP-7F3A-1019', signedBy: 'u7', signedAt: '2026-10-07T09:00:00Z',
    lines: [{ name: 'Аварийный ремонт системы охлаждения ЦОД', qty: 1, unit: 'усл', unitPrice: 14_000_000 }],
    assignment: { orgUnitKey: 'd1', unitName: unitIT, unitType: 'department', assigneeIds: ['u2'], routedAt: '2026-10-03T09:00:00Z', routedBy: 'u7', dueAt: '2026-10-08T09:00:00Z', decision: 'confirmed', decidedAt: '2026-10-05T10:00:00Z', decidedBy: 'u2' },
    postings: [
      { debit: '56802000', credit: '29802000', amount: 14_000_000, purpose: 'Аварийный ремонт системы охлаждения ЦОД' },
      { debit: '19905000', credit: '29802000', amount: 1_680_000, purpose: 'НДС к зачёту' },
    ],
    postedAt: '2026-10-07T09:05:00Z',
    paymentOrder: { number: 'MO-2026-0912', createdAt: '2026-10-07T10:00:00Z', createdBy: 'u7', debit: '29802000', credit: '10301000', account: '20208000300123456001', mfo: '00873', amount: 15_680_000, purpose: 'Оплата по акту AVR-2026-0219, договор DG-2026-0287', status: 'paid', transactionId: 'TRX-55102', paidAt: '2026-10-08T06:30:00Z' },
    history: [
      { at: '2026-10-03T08:00:00Z', userId: 'u7', action: 'created', comment: 'Акт получен через API Налогового комитета' },
      { at: '2026-10-05T10:00:00Z', userId: 'u2', action: 'approved', comment: 'Подразделение подтвердило выполнение работ' },
      { at: '2026-10-07T09:00:00Z', userId: 'u7', action: 'approved', comment: 'Подписано ЭЦП E-IMZO' },
      { at: '2026-10-08T06:30:00Z', userId: 'u7', action: 'status_changed', comment: 'Мемориальный ордер MO-2026-0912 исполнен (TRX-55102)' },
    ],
  },
  {
    id: 'ei5', number: 'XB-ESF-2026-0087', direction: 'outgoing', kind: 'invoice', source: 'manual', date: '2026-10-14', receivedAt: '2026-10-14T06:00:00Z', counterpartyId: 'c5', status: 'sent', vatRate: 12, issuerUnitKey: 'd2', basis: 'lease', basisRef: 'Договор аренды № 14/2026',
    operatorId: 'OP-7F3A-1105', signedBy: 'u7', signedAt: '2026-10-14T06:20:00Z',
    lines: [{ name: 'Аренда нежилого помещения, октябрь 2026', qty: 1, unit: 'мес', unitPrice: 48_000_000 }],
    history: [
      { at: '2026-10-14T06:00:00Z', userId: 'u7', action: 'created' },
      { at: '2026-10-14T06:20:00Z', userId: 'u7', action: 'approved', comment: 'Подписано ЭЦП E-IMZO' },
      { at: '2026-10-14T06:21:00Z', userId: 'u7', action: 'status_changed', comment: 'Отправлено оператору ЭСФ' },
    ],
  },
  {
    id: 'ei6', number: 'XB-ESF-2026-0084', direction: 'outgoing', kind: 'invoice', source: 'manual', date: '2026-10-03', receivedAt: '2026-10-03T06:00:00Z', counterpartyId: 'c1', status: 'accepted', vatRate: 12, issuerUnitKey: 'd8', basis: 'service',
    operatorId: 'OP-7F3A-1027', signedBy: 'u7', signedAt: '2026-10-03T06:20:00Z',
    lines: [{ name: 'Аренда банковской ячейки (корпоративная)', qty: 12, unit: 'мес', unitPrice: 1_250_000 }],
    history: [
      { at: '2026-10-03T06:00:00Z', userId: 'u7', action: 'created' },
      { at: '2026-10-03T06:30:00Z', userId: 'u7', action: 'status_changed', comment: 'Отправлено оператору ЭСФ' },
      { at: '2026-10-04T10:00:00Z', userId: 'u7', action: 'status_changed', comment: 'Покупатель подтвердил получение' },
    ],
  },
  {
    id: 'ei7', number: 'XB-ESF-2026-0089', direction: 'outgoing', kind: 'invoice', source: 'manual', date: '2026-10-17', receivedAt: '2026-10-17T05:00:00Z', counterpartyId: 'c3', status: 'draft', vatRate: 12, issuerUnitKey: 'R09', basis: 'service',
    operatorId: '—',
    lines: [{ name: 'Комиссия за расчётно-кассовое обслуживание, октябрь', qty: 1, unit: 'усл', unitPrice: 3_400_000 }],
    history: [{ at: '2026-10-17T05:00:00Z', userId: 'u7', action: 'created' }],
  },
];

export const einvoiceApprovalSeed: ApprovalTask[] = [
  {
    id: 'a_ei1', entity: 'einvoice', entityId: 'ei2', title: 'ЭСФ от OOO «Alfa Texnika Servis»', number: 'EF-2026-0409',
    amount: 310_000_000, requesterId: 'u2', assigneeRole: 'accountant', step: 1, totalSteps: 2,
    createdAt: einvoiceAgo(5), dueAt: einvoiceAgo(3), status: 'pending',
  },
];

/** Очередь документов, которые «пришлёт» API Налогового комитета при следующем приёме (детерминированно). */
export interface EinvoiceInboxSeed {
  kind: EinvoiceKind;
  number: string;
  counterpartyId: string;
  contractId?: string;
  lines: EinvoiceLine[];
  vatRate: number;
}

export const einvoiceSoliqQueue: EinvoiceInboxSeed[] = [
  { kind: 'invoice', number: 'EF-2026-0421', counterpartyId: 'c1', contractId: 'k2', vatRate: 12, lines: [{ name: 'Замена блоков питания серверов', qty: 4, unit: 'шт', unitPrice: 2_750_000 }] },
  { kind: 'work_act', number: 'AVR-2026-0241', counterpartyId: 'c2', contractId: 'k4', vatRate: 12, lines: [{ name: 'Доработка модуля маршрутизации СЭД', qty: 24, unit: 'ч', unitPrice: 650_000 }] },
  { kind: 'reconciliation_act', number: 'SV-2026-0061', counterpartyId: 'c3', contractId: 'k1', vatRate: 0, lines: [{ name: 'Сальдо взаиморасчётов на 30.09.2026', qty: 1, unit: 'док', unitPrice: 0 }] },
  { kind: 'invoice', number: 'EF-2026-0426', counterpartyId: 'c5', contractId: 'k3', vatRate: 12, lines: [{ name: 'Лизинговый платёж, октябрь 2026', qty: 1, unit: 'мес', unitPrice: 41_500_000 }] },
  { kind: 'work_act', number: 'AVR-2026-0247', counterpartyId: 'c4', vatRate: 12, lines: [{ name: 'Обслуживание кондиционеров ЦБУ «Чиланзар»', qty: 6, unit: 'шт', unitPrice: 420_000 }] },
  { kind: 'invoice', number: 'EF-2026-0430', counterpartyId: 'c3', contractId: 'k1', vatRate: 12, lines: [{ name: 'Тумбы мобильные', qty: 30, unit: 'шт', unitPrice: 890_000 }] },
];

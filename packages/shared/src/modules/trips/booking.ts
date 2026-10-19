// P4 (PR-TRV-015): системы бронирования авиа/ж-д билетов и гостиниц в справочнике интеграционной шины.
// Имитация провайдера: поиск предложений по маршруту/городу и датам (тариф от расстояния и класса), создание брони
// с номером PNR и документом (электронный билет / ваучер), отмена с возвратом по правилам тарифа. Обмен виден в мониторе
// /integrations: журнал, повторы, очередь при недоступности, идемпотентность, сверка сумм.
import { INTEGRATION_SYSTEMS, type IntegrationOperation, type IntegrationSystem } from '../../services/integrations';
import type { Localized } from '../../types';
import type { TripBookingKind, TripTransportClass } from './types';

type Payload = Record<string, unknown>;
const L = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const num = (p: Payload, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : Number(p[k] ?? 0));
const missing = (p: Payload, keys: string[]) => {
  const miss = keys.filter((k) => p[k] === undefined || p[k] === null || p[k] === '');
  return miss.length ? { code: 'validation' as const, message: `Missing: ${miss.join(', ')}` } : null;
};
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

/** Система бронирования для вида брони. */
export const TRIP_BOOKING_SYSTEMS: Record<TripBookingKind, string> = { air: 'booking_avia', rail: 'booking_rail', hotel: 'booking_hotel' };

/** Расстояние от Ташкента, км — тарифная база провайдеров (демо). */
export const TRIP_ROUTE_KM: Record<string, number> = {
  samarkand: 300, bukhara: 570, nukus: 1100, fergana: 320, namangan: 300, andijan: 360, karshi: 520, termez: 700, urgench: 1000,
  almaty: 800, moscow: 2800, beijing: 3800, istanbul: 3900, dubai: 2500,
};

/** Предложение провайдера (ответ offers.search). Цена — итог за весь период/маршрут туда-обратно, UZS. */
export interface TripProviderOffer {
  id: string;
  kind: TripBookingKind;
  provider: string;
  title: string;
  details: string;
  transportClass?: TripTransportClass;
  stars?: number;
  nights?: number;
  unitPrice: number;
  price: number;
  refundable: boolean;
  penaltyPct: number;
}

const AIR_CARRIERS = ['XB Air (демо)', 'Silk Avia (демо)', 'Orient Wings (демо)'];
const HOTELS = ['City Inn', 'Registan Plaza', 'Grand Silk', 'Business Hotel'];

function airOffers(p: Payload): TripProviderOffer[] {
  const km = num(p, 'distanceKm');
  const abroad = p.abroad === true;
  const base = Math.round((250_000 + km * 1_100) * (abroad ? 1.4 : 1)) * 2; // туда-обратно
  const out: TripProviderOffer[] = [];
  AIR_CARRIERS.forEach((carrier, i) => {
    const k = 0.9 + (hash(`${p.to}|${p.date}|${carrier}`) % 35) / 100;
    const flight = `${['XB', 'SV', 'OW'][i]}-${100 + (hash(`${p.to}${carrier}`) % 800)}`;
    const dep = `${String(6 + ((i * 5 + km) % 14)).padStart(2, '0')}:${['05', '30', '45'][i]}`;
    const eco = Math.round((base * k) / 1000) * 1000;
    out.push({ id: `air-${flight}-eco`, kind: 'air', provider: carrier, title: `${flight} · ${p.from} — ${p.to}`, details: `${p.date} ${dep} / ${p.back}`, transportClass: 'economy', unitPrice: eco, price: eco, refundable: i !== 2, penaltyPct: i === 0 ? 10 : i === 1 ? 25 : 100 });
    if (i < 2) {
      const bus = Math.round((eco * 2.7) / 1000) * 1000;
      out.push({ id: `air-${flight}-bus`, kind: 'air', provider: carrier, title: `${flight} · ${p.from} — ${p.to}`, details: `${p.date} ${dep} / ${p.back}`, transportClass: 'business', unitPrice: bus, price: bus, refundable: true, penaltyPct: 0 });
    }
  });
  return out;
}

function railOffers(p: Payload): TripProviderOffer[] {
  const km = num(p, 'distanceKm');
  if (p.abroad === true || km > 1_200) return []; // ж/д продажа — по Узбекистану
  const seat = Math.round(((80_000 + km * 230) * 2) / 1000) * 1000;
  const train = `№ ${700 + (hash(String(p.to)) % 90)}`;
  const classes: [TripTransportClass, number][] = [['rail_seat', 1], ['rail_coupe', 1.6], ['rail_sv', 2.6]];
  return classes.map(([cls, f], i) => {
    const price = Math.round((seat * f * (0.95 + (hash(`${p.date}${cls}`) % 15) / 100)) / 1000) * 1000;
    return { id: `rail-${train.replace(/\D/g, '')}-${cls}`, kind: 'rail' as const, provider: 'Railway e-ticket (демо)', title: `${train} · ${p.from} — ${p.to}`, details: `${p.date} ${String(7 + i * 4).padStart(2, '0')}:20 / ${p.back}`, transportClass: cls, unitPrice: price, price, refundable: true, penaltyPct: i === 0 ? 15 : 10 };
  });
}

function hotelOffers(p: Payload): TripProviderOffer[] {
  const nights = Math.max(1, num(p, 'nights'));
  const abroad = p.abroad === true;
  return HOTELS.map((h, i) => {
    const stars = 3 + (i % 3);
    const nightly = abroad ? Math.round((90 + i * 55 + (hash(`${p.city}${h}`) % 30)) * num(p, 'usdRate')) : 380_000 + i * 190_000 + (hash(`${p.city}${h}`) % 60) * 1_000;
    const unit = Math.round(nightly / 1000) * 1000;
    return { id: `htl-${hash(`${p.city}${h}`) % 10_000}`, kind: 'hotel' as const, provider: 'HotelBook (демо)', title: `${h} ${'★'.repeat(stars)} · ${p.city}`, details: `${p.checkIn} — ${p.checkOut}`, stars, nights, unitPrice: unit, price: unit * nights, refundable: i !== 3, penaltyPct: i === 3 ? 100 : i === 2 ? 0 : i === 1 ? 10 : 20 };
  });
}

function ops(kind: TripBookingKind): IntegrationOperation[] {
  const docPrefix = kind === 'hotel' ? 'VCH' : kind === 'air' ? 'ETK' : 'RZD';
  return [
    {
      id: 'offers.search', direction: 'in', schemaVersion: '1.0', name: L('Поиск предложений', 'Takliflarni qidirish', 'Search offers'),
      sample: () => (kind === 'hotel' ? { city: 'Самарканд', checkIn: '2026-10-27', checkOut: '2026-10-30', nights: 3, abroad: false, usdRate: 12_650 } : { from: 'Ташкент', to: 'Самарканд', date: '2026-10-27', back: '2026-10-30', distanceKm: 300, abroad: false }),
      validate: (p) => missing(p, kind === 'hotel' ? ['city', 'checkIn', 'checkOut'] : ['from', 'to', 'date']),
      respond: (p) => ({ offers: kind === 'air' ? airOffers(p) : kind === 'rail' ? railOffers(p) : hotelOffers(p) }),
      count: () => 1,
    },
    {
      id: 'booking.create', direction: 'out', schemaVersion: '1.0', name: L('Создать бронь и выписать документ', 'Bron yaratish va hujjat berish', 'Create booking and issue document'),
      sample: () => ({ offerId: 'air-XB-301-eco', trip: 'KM-2026-0318', traveller: 'u1', price: 1_850_000 }),
      validate: (p) => missing(p, ['offerId', 'trip', 'traveller', 'price']),
      amount: (p) => num(p, 'price'),
      count: () => 1,
      respond: (p) => {
        const h = hash(`${p.offerId}|${p.trip}|${p.traveller}`);
        return { accepted: true, pnr: `${String.fromCharCode(65 + (h % 26))}${String.fromCharCode(65 + ((h >> 5) % 26))}${(h % 9000) + 1000}`, document: `${docPrefix}-${String(h % 10_000_000).padStart(7, '0')}`, acceptedAmount: num(p, 'price') };
      },
    },
    {
      id: 'booking.cancel', direction: 'out', schemaVersion: '1.0', name: L('Отмена брони и возврат', 'Bronni bekor qilish va qaytarish', 'Cancel booking and refund'),
      sample: () => ({ pnr: 'AB1234', price: 1_850_000, refundable: true, penaltyPct: 10 }),
      validate: (p) => missing(p, ['pnr', 'price']),
      amount: (p) => num(p, 'price'),
      respond: (p) => {
        const price = num(p, 'price');
        const penalty = p.refundable === true ? Math.round((price * num(p, 'penaltyPct')) / 100) : price;
        return { cancelled: true, refund: price - penalty, penalty, refundDoc: `RF-${hash(String(p.pnr)) % 1_000_000}` };
      },
    },
  ];
}

const passport = (target: string, endpoint: string): IntegrationSystem['passport'] => ({
  source: 'XB-ERP',
  target,
  owner: L('Департамент по работе с персоналом (координатор командировок)', 'Xodimlar bilan ishlash departamenti (safar koordinatori)', 'HR Department (travel coordinator)'),
  protocol: 'REST/JSON',
  format: 'JSON (OpenAPI v1), UTF-8, ISO 8601 +05:00',
  endpoint,
  auth: 'OAuth 2.0 client credentials, mTLS',
  schedule: L('Онлайн', 'Onlayn', 'Online'),
  volume: L('до 500 запросов/сутки', 'kuniga 500 tagacha so‘rov', 'up to 500 requests/day'),
  sla: '99.0%, ≤ 5 s',
  idempotency: 'Idempotency-Key (UUID) в заголовке',
  errorCodes: 'timeout, http_500, http_503, validation, idempotency_conflict',
  controlTotals: L('Количество и сумма броней за сутки', 'Kunlik bronlar soni va summasi', 'Daily bookings count and amount'),
});

let registered = false;
/** Регистрирует системы бронирования в справочнике шины (идемпотентно). */
export function registerTripBookingSystems(): void {
  if (registered) return;
  registered = true;
  const add = (s: IntegrationSystem) => {
    if (!INTEGRATION_SYSTEMS.some((x) => x.id === s.id)) INTEGRATION_SYSTEMS.push(s);
  };
  add({
    id: 'booking_avia', tz: '4.2.11', kind: 'external', hosts: 'GDS / агрегатор авиабилетов (демо)', modules: ['trips'], latency: [300, 900],
    name: L('Бронирование авиабилетов', 'Aviachiptalarni bron qilish', 'Air ticket booking'),
    purpose: L('Поиск и бронирование авиабилетов, электронный билет, возврат', 'Aviachiptalarni qidirish va bron qilish, elektron chipta, qaytarish', 'Search and book flights, e-ticket, refunds'),
    passport: passport('GDS (демо)', 'https://gds.example/api/v1'),
    operations: ops('air'),
  });
  add({
    id: 'booking_rail', tz: '4.2.11', kind: 'external', hosts: 'Ж/д электронные билеты (демо)', modules: ['trips'], latency: [300, 900],
    name: L('Бронирование ж/д билетов', 'Temir yo‘l chiptalarini bron qilish', 'Rail ticket booking'),
    purpose: L('Поиск поездов, покупка и возврат электронных ж/д билетов', 'Poyezdlarni qidirish, elektron chiptalarni sotib olish va qaytarish', 'Search trains, buy and refund e-tickets'),
    passport: passport('Railway e-ticket (демо)', 'https://rail.example/api/v1'),
    operations: ops('rail'),
  });
  add({
    id: 'booking_hotel', tz: '4.2.11', kind: 'external', hosts: 'Агрегатор гостиниц (демо)', modules: ['trips'], latency: [300, 900],
    name: L('Бронирование гостиниц', 'Mehmonxonalarni bron qilish', 'Hotel booking'),
    purpose: L('Поиск гостиниц по городу и датам, ваучер на проживание, отмена', 'Shahar va sanalar bo‘yicha mehmonxona qidirish, vaucher, bekor qilish', 'Search hotels by city and dates, voucher, cancellation'),
    passport: passport('HotelBook (демо)', 'https://hotels.example/api/v1'),
    operations: ops('hotel'),
  });
}

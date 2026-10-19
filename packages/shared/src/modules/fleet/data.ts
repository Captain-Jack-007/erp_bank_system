// Демо-данные модуля «Автопарк» (вымышленные номера, водители, полисы и АЗС).
import type {
  FleetAssignment, FleetDocument, FleetDriver, FleetExpense, FleetFaultReport, FleetFine, FleetFuelCard, FleetFuelUp,
  FleetRunLog, FleetService, FleetSettings, FleetStatusEvent, FleetTopUp, FleetTrip, FleetVehicle,
} from './types';

const base = { winterPct: 10, cityPct: 15, createdAt: '2025-01-15', expenseAccount: '56811000' };

export const fleetVehiclesSeed: FleetVehicle[] = [
  { ...base, id: 'fv1', kind: 'vehicle', plate: '01 A 123 BC', brand: 'Chevrolet', model: 'Malibu', year: 2023, vin: 'XWBJA69V0PA012345', techPassportNo: 'AAF 1023456', vehicleType: 'car', purpose: 'management', fuel: 'petrol', fuelNorm: 9.5, limitLitres: 120, limitSum: 1_300_000, bookValue: 385_000_000, orgUnitKey: 'd2', costCenterKey: 'CC0007', status: 'in_operation', mileage: 48_200, primaryDriverId: 'fd1', reserveDriverId: 'fd7', serviceIntervalKm: 10_000, serviceIntervalMonths: 12, lastServiceKm: 40_000, lastServiceDate: '2026-06-18', tankLitres: 70 },
  { ...base, id: 'fv2', kind: 'vehicle', plate: '01 B 456 DA', brand: 'Isuzu', model: 'NPR 82 (бронированный инкассаторский)', year: 2021, vin: 'JALC4B16107012001', techPassportNo: 'AAE 7745120', vehicleType: 'special', purpose: 'collection', fuel: 'diesel', fuelNorm: 14, limitLitres: 400, limitSum: 4_800_000, bookValue: 640_000_000, orgUnitKey: 'd8', costCenterKey: 'CC0025', status: 'in_operation', mileage: 186_400, primaryDriverId: 'fd2', serviceIntervalKm: 10_000, serviceIntervalMonths: 6, lastServiceKm: 180_000, lastServiceDate: '2026-08-02', tankLitres: 100 },
  { ...base, id: 'fv3', kind: 'vehicle', plate: '01 C 789 EF', brand: 'Isuzu', model: 'NPR 82 (бронированный инкассаторский)', year: 2022, vin: 'JALC4B16107012077', techPassportNo: 'AAE 8890311', vehicleType: 'special', purpose: 'collection', fuel: 'diesel', fuelNorm: 14, limitLitres: 350, limitSum: 4_200_000, bookValue: 712_000_000, orgUnitKey: 'd8', costCenterKey: 'CC0025', status: 'in_operation', mileage: 141_050, primaryDriverId: 'fd3', serviceIntervalKm: 10_000, serviceIntervalMonths: 6, lastServiceKm: 130_000, lastServiceDate: '2026-03-20', tankLitres: 100 },
  { ...base, id: 'fv4', kind: 'vehicle', plate: '30 D 321 GH', brand: 'Chevrolet', model: 'Cobalt', year: 2020, vin: 'XWB5V3195LA543210', techPassportNo: 'AAD 3321907', vehicleType: 'car', purpose: 'business', fuel: 'methane', fuelNorm: 8, limitLitres: 200, limitSum: 900_000, bookValue: 96_000_000, orgUnitKey: 'd2', costCenterKey: 'CC0007', status: 'repair', mileage: 212_700, primaryDriverId: 'fd4', serviceIntervalKm: 15_000, serviceIntervalMonths: 12, lastServiceKm: 200_000, lastServiceDate: '2026-02-11', tankLitres: 60 },
  { ...base, id: 'fv5', kind: 'vehicle', plate: '40 E 654 JK', brand: 'Isuzu', model: 'Bus 12 мест', year: 2024, vin: 'JAANLR85E07100552', techPassportNo: 'AAG 0012788', vehicleType: 'bus', purpose: 'service', fuel: 'diesel', fuelNorm: 11.5, limitLitres: 250, limitSum: 3_000_000, bookValue: 520_000_000, orgUnitKey: 'd2', costCenterKey: 'CC0007', status: 'in_operation', mileage: 32_900, primaryDriverId: 'fd5', serviceIntervalKm: 15_000, serviceIntervalMonths: 12, lastServiceKm: 30_000, lastServiceDate: '2026-05-20', tankLitres: 80 },
  { ...base, id: 'fv6', kind: 'vehicle', plate: '01 F 987 LM', brand: 'BYD', model: 'Song Plus EV', year: 2025, vin: 'LGXCE4CB5R0011223', techPassportNo: 'AAH 1110456', vehicleType: 'car', purpose: 'business', fuel: 'electric', fuelNorm: 17, winterPct: 20, cityPct: 0, limitLitres: 200, limitSum: 300_000, bookValue: 455_000_000, orgUnitKey: 'd1', costCenterKey: 'CC0002', status: 'in_operation', mileage: 14_300, primaryDriverId: 'fd6', serviceIntervalKm: 20_000, serviceIntervalMonths: 12, lastServiceKm: 0, lastServiceDate: '2025-11-01', tankLitres: 80 },
  { ...base, id: 'fv7', kind: 'vehicle', plate: '01 G 112 NA', brand: 'Chevrolet', model: 'Lacetti', year: 2020, vin: 'XWBJF69D0LA778899', techPassportNo: 'AAD 0098712', vehicleType: 'car', purpose: 'business', fuel: 'petrol', fuelNorm: 9, limitLitres: 0, limitSum: 0, bookValue: 4_334_000, assetId: 'as5', orgUnitKey: 'd2', costCenterKey: 'CC0007', status: 'writeoff_pending', statusBeforeWriteoff: 'reserve', writeoffActId: 'wo1', writeoffReason: 'Пробег 410 000 км, ремонт экономически нецелесообразен', mileage: 410_000, serviceIntervalKm: 10_000, serviceIntervalMonths: 12, lastServiceKm: 400_000, lastServiceDate: '2025-12-01', tankLitres: 60 },
  { ...base, id: 'fv8', kind: 'vehicle', plate: '30 H 555 PA', brand: 'Isuzu', model: 'D-Max', year: 2023, vin: 'MPATFS86JPT004455', techPassportNo: 'ВРМ 0004455', vehicleType: 'truck', purpose: 'service', fuel: 'diesel', fuelNorm: 11, limitLitres: 200, limitSum: 2_400_000, bookValue: 410_000_000, orgUnitKey: 'R09', costCenterKey: 'CC0194', status: 'reserve', mileage: 88_000, primaryDriverId: 'fd8', serviceIntervalKm: 10_000, serviceIntervalMonths: 12, lastServiceKm: 80_000, lastServiceDate: '2026-04-10', tankLitres: 76 },
  { ...base, id: 'fg1', kind: 'generator', plate: 'GEN-HO-001', brand: 'Cummins', model: 'C150 D5 (150 кВА)', year: 2022, vin: 'CUM-C150-22-0471', techPassportNo: 'ПГ-2022-0471', vehicleType: 'generator', purpose: 'power', fuel: 'diesel', fuelNorm: 24, winterPct: 5, cityPct: 0, limitLitres: 600, limitSum: 7_200_000, bookValue: 268_000_000, orgUnitKey: 'd2', costCenterKey: 'CC0007', expenseAccount: '56811000', status: 'in_operation', mileage: 1_274, serviceIntervalKm: 250, serviceIntervalMonths: 12, lastServiceKm: 1_250, lastServiceDate: '2026-09-15', tankLitres: 400 },
  { ...base, id: 'fg2', kind: 'generator', plate: 'GEN-R01-004', brand: 'FG Wilson', model: 'P33-3 (30 кВА)', year: 2019, vin: 'FGW-P33-19-1180', techPassportNo: 'ПГ-2019-1180', vehicleType: 'generator', purpose: 'power', fuel: 'diesel', fuelNorm: 6.5, winterPct: 5, cityPct: 0, limitLitres: 200, limitSum: 2_400_000, bookValue: 38_000_000, orgUnitKey: 'R01-B04', costCenterKey: 'CC0058', status: 'in_operation', mileage: 842, serviceIntervalKm: 250, serviceIntervalMonths: 12, lastServiceKm: 700, lastServiceDate: '2025-10-20', tankLitres: 120 },
];

export const fleetDriversSeed: FleetDriver[] = [
  { id: 'fd1', userId: 'u15', fullName: 'Норкулов Бахтиёр', personnelNo: 'T-02015', phone: '+998 90 111-15-15', licenseNo: 'AB 1234567', licenseCategories: ['B', 'C'], licenseUntil: '2029-04-12', medicalUntil: '2026-11-05', orgUnitKey: 'd2', active: true },
  { id: 'fd2', fullName: 'Садыков Фарход', personnelNo: 'T-08102', phone: '+998 90 222-02-02', licenseNo: 'AC 2210983', licenseCategories: ['B', 'C', 'D'], licenseUntil: '2027-06-01', medicalUntil: '2027-01-15', orgUnitKey: 'd8', active: true },
  { id: 'fd3', fullName: 'Ибрагимов Тимур', personnelNo: 'T-08107', phone: '+998 90 333-07-07', licenseNo: 'AA 0987123', licenseCategories: ['B', 'C'], licenseUntil: '2026-10-10', medicalUntil: '2027-03-01', orgUnitKey: 'd8', active: true },
  { id: 'fd4', fullName: 'Нурматов Бобур', personnelNo: 'T-02031', phone: '+998 90 444-31-31', licenseNo: 'AD 5566778', licenseCategories: ['B'], licenseUntil: '2028-02-20', medicalUntil: '2027-05-10', orgUnitKey: 'd2', active: true },
  { id: 'fd5', fullName: 'Алиев Санжар', personnelNo: 'T-02044', phone: '+998 90 555-44-44', licenseNo: 'AE 3344556', licenseCategories: ['B', 'D'], licenseUntil: '2027-09-30', medicalUntil: '2026-12-20', orgUnitKey: 'd2', active: true },
  { id: 'fd6', fullName: 'Юлдашев Азамат', personnelNo: 'T-01088', phone: '+998 90 666-88-88', licenseNo: 'AF 7788990', licenseCategories: ['B'], licenseUntil: '2030-01-15', medicalUntil: '2027-08-01', orgUnitKey: 'd1', active: true },
  { id: 'fd7', fullName: 'Рахматов Шухрат', personnelNo: 'T-02052', phone: '+998 90 777-52-52', licenseNo: 'AG 1122334', licenseCategories: ['B', 'C', 'D'], licenseUntil: '2028-05-05', medicalUntil: '2027-02-02', orgUnitKey: 'd2', active: true },
  { id: 'fd8', fullName: 'Каримов Ильхом', personnelNo: 'T-09011', phone: '+998 90 888-11-11', licenseNo: 'AH 4455667', licenseCategories: ['B', 'C'], licenseUntil: '2028-11-11', medicalUntil: '2027-04-04', orgUnitKey: 'R09', active: true },
];

const doc = (id: string, vehicleId: string, type: FleetDocument['type'], number: string, issuer: string, validFrom: string, validUntil: string | undefined, cost = 0, driverId?: string): FleetDocument => ({
  id, vehicleId, type, number, issuer, validFrom, ...(validUntil ? { validUntil } : {}), cost, ...(driverId ? { driverId } : {}), status: 'active', createdAt: validFrom, createdBy: 'u6',
});
const INS1 = "Ishonch Sug'urta (демо)";
const INS2 = "Alfa Sug'urta (демо)";
const GAI = 'РЭО УБДД г. Ташкента (демо)';

export const fleetDocumentsSeed: FleetDocument[] = [
  doc('fdoc1', 'fv1', 'tech_passport', 'AAF 1023456', GAI, '2023-03-15', undefined),
  doc('fdoc2', 'fv1', 'osago', 'OSG 2026 004411', INS1, '2026-03-01', '2027-02-28', 380_000),
  doc('fdoc3', 'fv1', 'kasko', 'KSK 2026 000101', INS2, '2026-03-01', '2027-02-28', 6_400_000),
  doc('fdoc4', 'fv1', 'inspection', 'TO-01-55211', GAI, '2026-02-10', '2027-02-10', 150_000),
  doc('fdoc5', 'fv1', 'power_of_attorney', 'DOV-2026-015', 'АКБ (демо)', '2026-01-10', '2026-12-31', 0, 'fd1'),
  doc('fdoc6', 'fv2', 'tech_passport', 'AAE 7745120', GAI, '2021-05-20', undefined),
  doc('fdoc7', 'fv2', 'osago', 'OSG 2025 118230', INS1, '2025-11-03', '2026-11-02', 520_000),
  doc('fdoc8', 'fv2', 'kasko', 'KSK 2026 000044', INS2, '2026-01-16', '2027-01-15', 9_800_000),
  doc('fdoc9', 'fv2', 'inspection', 'TO-01-49871', GAI, '2025-12-15', '2026-12-15', 150_000),
  doc('fdoc10', 'fv3', 'tech_passport', 'AAE 8890311', GAI, '2022-02-11', undefined),
  doc('fdoc11', 'fv3', 'osago', 'OSG 2026 000377', INS1, '2026-01-21', '2027-01-20', 520_000),
  doc('fdoc12', 'fv3', 'kasko', 'KSK 2026 000045', INS2, '2026-01-01', '2026-12-31', 10_200_000),
  doc('fdoc13', 'fv3', 'inspection', 'TO-01-40012', GAI, '2025-10-25', '2026-10-25', 150_000),
  doc('fdoc14', 'fv4', 'tech_passport', 'AAD 3321907', GAI, '2020-07-01', undefined),
  doc('fdoc15', 'fv4', 'osago', 'OSG 2026 002210', INS1, '2026-05-12', '2027-05-11', 310_000),
  doc('fdoc16', 'fv4', 'inspection', 'TO-30-11877', 'РЭО УБДД Ташкентской обл. (демо)', '2026-04-01', '2027-04-01', 150_000),
  doc('fdoc17', 'fv5', 'tech_passport', 'AAG 0012788', GAI, '2024-07-25', undefined),
  doc('fdoc18', 'fv5', 'osago', 'OSG 2026 007788', INS1, '2026-07-31', '2027-07-30', 450_000),
  doc('fdoc19', 'fv5', 'inspection', 'TO-01-60021', GAI, '2026-07-30', '2027-07-30', 150_000),
  doc('fdoc20', 'fv6', 'tech_passport', 'AAH 1110456', GAI, '2025-09-02', undefined),
  doc('fdoc21', 'fv6', 'osago', 'OSG 2025 120001', INS1, '2025-10-30', '2026-10-29', 410_000),
  doc('fdoc22', 'fv6', 'kasko', 'KSK 2025 000990', INS2, '2025-10-30', '2026-10-29', 7_300_000),
  doc('fdoc23', 'fv6', 'inspection', 'TO-01-70112', GAI, '2025-09-02', '2028-09-01', 0),
  doc('fdoc24', 'fv7', 'tech_passport', 'AAD 0098712', GAI, '2020-11-05', undefined),
  doc('fdoc25', 'fv7', 'osago', 'OSG 2025 099120', INS1, '2025-12-01', '2026-11-30', 290_000),
  doc('fdoc26', 'fv8', 'tech_passport', 'ВРМ 0004455', 'РЭО УБДД Самаркандской обл. (демо)', '2026-05-11', '2026-11-10'),
  doc('fdoc27', 'fv8', 'osago', 'OSG 2025 101230', INS1, '2025-10-13', '2026-10-12', 470_000),
  doc('fdoc28', 'fv8', 'inspection', 'TO-09-22014', 'РЭО УБДД Самаркандской обл. (демо)', '2026-03-01', '2027-03-01', 150_000),
  doc('fdoc29', 'fv8', 'power_of_attorney', 'DOV-2026-071', 'АКБ (демо)', '2026-05-11', '2026-10-30', 0, 'fd8'),
  doc('fdoc30', 'fg1', 'tech_passport', 'ПГ-2022-0471', 'Cummins (паспорт изделия)', '2022-04-01', undefined),
  doc('fdoc31', 'fg2', 'tech_passport', 'ПГ-2019-1180', 'FG Wilson (паспорт изделия)', '2019-08-12', undefined),
];

/** Закрытые путевые листы: км и расход; одометр восстанавливается цепочкой до текущего пробега. */
type TripSpec = [id: string, number: string, date: string, from: string, to: string, waypoints: string, purpose: string, km: number, fuel: number, city: boolean];
const TRIPS: Record<string, { driver: string; cc: string; specs: TripSpec[] }> = {
  fv1: { driver: 'fd1', cc: 'CC0007', specs: [
    ['ft11', 'PL-2026-3150', '2026-09-08', 'Головной офис', 'Министерство финансов', '', 'Деловая поездка руководства', 64, 6.4, true],
    ['ft12', 'PL-2026-3201', '2026-09-22', 'Головной офис', 'Филиал Чирчик', '', 'Совещание в филиале', 96, 9.8, false],
    ['ft13', 'PL-2026-3270', '2026-10-06', 'Головной офис', 'Центральный банк', '', 'Деловая поездка руководства', 52, 5.6, true],
    ['ft3', 'PL-2026-3312', '2026-10-15', 'Головной офис', 'Министерство финансов', '', 'Деловая поездка руководства', 80, 7.4, true],
  ] },
  fv2: { driver: 'fd2', cc: 'CC0025', specs: [
    ['ft21', 'PL-2026-3166', '2026-09-10', 'Головной офис', 'Головной офис', 'ЦБУ Чиланзар, ЦБУ Юнусабад', 'Инкассация', 85, 12.6, true],
    ['ft22', 'PL-2026-3220', '2026-09-24', 'Головной офис', 'Головной офис', 'ЦБУ Сергели, ЦБУ Яккасарай', 'Инкассация', 110, 16.0, true],
    ['ft1', 'PL-2026-3301', '2026-10-14', 'Головной офис', 'Головной офис', 'ЦБУ Чиланзар, ЦБУ Юнусабад', 'Инкассация', 90, 13.5, true],
    ['ft4', 'PL-2026-3318', '2026-10-16', 'Головной офис', 'Головной офис', 'ЦБУ Мирабад, ЦБУ Яккасарай, Филиал Чирчик', 'Инкассация', 390, 62.0, false],
  ] },
  fv3: { driver: 'fd3', cc: 'CC0025', specs: [
    ['ft31', 'PL-2026-3190', '2026-09-17', 'Головной офис', 'Головной офис', 'ЦБУ Сергели', 'Инкассация', 75, 10.2, true],
    ['ft2', 'PL-2026-3305', '2026-10-14', 'Головной офис', 'Головной офис', 'ЦБУ Сергели', 'Инкассация', 70, 9.6, true],
    ['ft32', 'PL-2026-3316', '2026-10-16', 'Головной офис', 'Головной офис', 'ЦБУ Мирабад', 'Инкассация', 100, 13.6, true],
  ] },
  fv4: { driver: 'fd4', cc: 'CC0007', specs: [
    ['ft41', 'PL-2026-3171', '2026-09-12', 'Головной офис', 'Филиал Ангрен', '', 'Доставка документов', 120, 9.4, false],
    ['ft42', 'PL-2026-3255', '2026-10-03', 'Головной офис', 'ЦБУ Яккасарай', '', 'Хозяйственные нужды', 85, 7.0, true],
  ] },
  fv5: { driver: 'fd5', cc: 'CC0007', specs: [
    ['ft51', 'PL-2026-3195', '2026-09-19', 'Головной офис', 'Филиал Ангрен', '', 'Доставка сотрудников на обучение', 220, 25.0, false],
    ['ft5', 'PL-2026-3320', '2026-10-16', 'Головной офис', 'Филиал Чирчик', '', 'Доставка сотрудников на обучение', 80, 9.1, false],
  ] },
  fv6: { driver: 'fd6', cc: 'CC0002', specs: [
    ['ft61', 'PL-2026-3240', '2026-09-29', 'Головной офис', 'ЦОД', '', 'Выезд ИТ-специалистов', 55, 9.0, true],
    ['ft6', 'PL-2026-3324', '2026-10-17', 'Головной офис', 'ЦОД', '', 'Выезд ИТ-специалистов', 40, 6.9, true],
  ] },
  fv8: { driver: 'fd8', cc: 'CC0194', specs: [
    ['ft81', 'PL-2026-3140', '2026-09-05', 'Самаркандский филиал', 'Самаркандский филиал', 'ЦБУ Ургут, ЦБУ Каттакурган', 'Хозяйственные нужды', 160, 17.0, false],
  ] },
};

function buildTrips(): FleetTrip[] {
  const out: FleetTrip[] = [];
  for (const v of fleetVehiclesSeed) {
    const t = TRIPS[v.id];
    if (!t) continue;
    let odo = v.mileage - t.specs.reduce((s, x) => s + x[7], 0);
    let fuel = Math.round(v.tankLitres * 0.6);
    for (const [id, number, date, from, to, wp, purpose, km, used, city] of t.specs) {
      const start = Math.max(fuel, Math.ceil(used + 8));
      const fuelEnd = Math.round((start - used) * 10) / 10;
      const norm = Math.round((km / 100) * v.fuelNorm * (1 + (city ? v.cityPct : 0) / 100) * 10) / 10;
      out.push({
        id, number, vehicleId: v.id, driverId: t.driver, status: 'closed', date, departTime: '09:00', returnDate: date, returnTime: km > 200 ? '19:30' : '17:30',
        routeFrom: from, routeTo: to, waypoints: wp, purpose, city, odoStart: odo, odoEnd: odo + km, fuelStart: start, fuelEnd, fuelUsed: Math.round((start - fuelEnd) * 10) / 10, fuelNormUsed: norm,
        ...(used > norm * 1.1 ? { overrunReason: 'Пробки и простои с работающим двигателем на маршруте' } : {}),
        costCenterKey: t.cc, createdBy: 'u6', createdAt: `${date}T08:15:00Z`, dispatcherId: 'u6', dispatchedAt: `${date}T08:40:00Z`, closedBy: 'u6', closedAt: `${date}T${km > 200 ? '19:45' : '17:45'}:00Z`,
        history: [
          { at: `${date}T08:15:00Z`, userId: 'u6', action: 'created' },
          { at: `${date}T08:40:00Z`, userId: 'u6', action: 'approved' },
          { at: `${date}T17:45:00Z`, userId: 'u6', action: 'status_changed', comment: 'closed' },
        ],
      });
      odo += km;
      // после поездки — дозаправка до 60 % бака (заправки — отдельными документами)
      fuel = Math.max(fuelEnd, Math.round(v.tankLitres * 0.6));
    }
  }
  // Открытый путевой лист: инкассаторская машина в рейсе.
  out.push({
    id: 'ft7', number: 'PL-2026-3330', vehicleId: 'fv2', driverId: 'fd2', status: 'open', date: '2026-10-18', departTime: '08:30', returnDate: '2026-10-18', returnTime: '18:00',
    routeFrom: 'Головной офис', routeTo: 'Головной офис', waypoints: 'ЦБУ Юнусабад, ЦБУ Чиланзар, ЦБУ Сергели', purpose: 'Инкассация', city: true, odoStart: 186_400, fuelStart: 60,
    costCenterKey: 'CC0025', createdBy: 'u6', createdAt: '2026-10-18T07:50:00Z', dispatcherId: 'u6', dispatchedAt: '2026-10-18T08:05:00Z',
    history: [{ at: '2026-10-18T07:50:00Z', userId: 'u6', action: 'created' }, { at: '2026-10-18T08:05:00Z', userId: 'u6', action: 'approved' }],
  });
  // Ожидает подписи диспетчера: путевой лист, открытый водителем.
  out.push({
    id: 'ft8', number: 'PL-2026-3334', vehicleId: 'fv1', driverId: 'fd1', status: 'pending', date: '2026-10-18', departTime: '14:00', returnDate: '2026-10-18', returnTime: '18:00',
    routeFrom: 'Головной офис', routeTo: 'Ташкентский областной филиал (Нурафшан)', waypoints: '', purpose: 'Доставка документов', city: false, odoStart: 48_200, fuelStart: 42,
    costCenterKey: 'CC0007', createdBy: 'u15', createdAt: '2026-10-18T09:10:00Z',
    history: [{ at: '2026-10-18T09:10:00Z', userId: 'u15', action: 'submitted' }],
  });
  return out;
}

export const fleetTripsSeed: FleetTrip[] = buildTrips();

export const fleetRunLogsSeed: FleetRunLog[] = [
  { id: 'frl1', vehicleId: 'fg1', date: '2026-09-14', hoursStart: 1_243, hoursEnd: 1_249, fuelUsed: 150, fuelNormUsed: 144, note: 'Плановое отключение электроснабжения', userId: 'u6' },
  { id: 'frl2', vehicleId: 'fg1', date: '2026-10-09', hoursStart: 1_266, hoursEnd: 1_274, fuelUsed: 190, fuelNormUsed: 192, note: 'Авария на подстанции', userId: 'u6' },
  { id: 'frl3', vehicleId: 'fg2', date: '2026-10-01', hoursStart: 830, hoursEnd: 842, fuelUsed: 80, fuelNormUsed: 78, note: 'Отключение электроэнергии в ЦБУ', userId: 'u6' },
];

const fu = (id: string, number: string, vehicleId: string, date: string, station: string, fuel: FleetFuelUp['fuel'], litres: number, price: number, cc: string, opts: Partial<FleetFuelUp> = {}): FleetFuelUp => ({
  id, number, vehicleId, date, station, fuel, litres, amount: Math.round(litres * price), source: 'manual', costCenterKey: cc, createdBy: 'u6', ...opts,
});
const P = 10_500, D = 11_800, M = 4_200, E = 1_200;

export const fleetFuelUpsSeed: FleetFuelUp[] = [
  fu('ff1', 'GSM-2026-0911', 'fv1', '2026-09-07', 'АЗС №12, Юнусабад (демо)', 'petrol', 40, P, 'CC0007', { source: 'card', cardId: 'fc1', driverId: 'fd1', externalId: 'TX-90071' }),
  fu('ff2', 'GSM-2026-0934', 'fv1', '2026-09-21', 'АЗС №12, Юнусабад (демо)', 'petrol', 35, P, 'CC0007', { source: 'card', cardId: 'fc1', driverId: 'fd1', externalId: 'TX-90133' }),
  fu('ff3', 'GSM-2026-1006', 'fv1', '2026-10-05', 'АЗС №7, Мирабад (демо)', 'petrol', 40, P, 'CC0007', { source: 'card', cardId: 'fc1', driverId: 'fd1', externalId: 'TX-90250' }),
  fu('ff4', 'GSM-2026-1031', 'fv1', '2026-10-14', 'АЗС №12, Юнусабад (демо)', 'petrol', 30, P, 'CC0007', { source: 'card', cardId: 'fc1', driverId: 'fd1', externalId: 'TX-90311' }),
  fu('ff5', 'GSM-2026-0915', 'fv2', '2026-09-09', 'АЗС №3, Шайхантахур (демо)', 'diesel', 120, D, 'CC0025', { source: 'card', cardId: 'fc2', driverId: 'fd2', externalId: 'TX-90082' }),
  fu('ff6', 'GSM-2026-0940', 'fv2', '2026-09-23', 'АЗС №3, Шайхантахур (демо)', 'diesel', 110, D, 'CC0025', { source: 'card', cardId: 'fc2', driverId: 'fd2', externalId: 'TX-90141' }),
  fu('ff7', 'GSM-2026-1022', 'fv2', '2026-10-13', 'АЗС №3, Шайхантахур (демо)', 'diesel', 100, D, 'CC0025', { source: 'card', cardId: 'fc2', driverId: 'fd2', externalId: 'TX-90290' }),
  fu('ff8', 'GSM-2026-1040', 'fv2', '2026-10-16', 'АЗС №9, Чирчик (демо)', 'diesel', 90, D, 'CC0025', { source: 'card', cardId: 'fc2', driverId: 'fd2', externalId: 'TX-90330' }),
  fu('ff9', 'GSM-2026-0928', 'fv3', '2026-09-16', 'АЗС №5, Сергели (демо)', 'diesel', 90, D, 'CC0025', { source: 'card', cardId: 'fc3', driverId: 'fd3', externalId: 'TX-90120' }),
  fu('ff10', 'GSM-2026-1024', 'fv3', '2026-10-13', 'АЗС №5, Сергели (демо)', 'diesel', 80, D, 'CC0025', { source: 'card', cardId: 'fc3', driverId: 'fd3', externalId: 'TX-90295' }),
  fu('ff11', 'GSM-2026-0919', 'fv4', '2026-09-11', 'АГЗС Яккасарай (демо)', 'methane', 60, M, 'CC0007', { driverId: 'fd4' }),
  fu('ff12', 'GSM-2026-1002', 'fv4', '2026-10-02', 'АГЗС Яккасарай (демо)', 'methane', 50, M, 'CC0007', { driverId: 'fd4' }),
  fu('ff13', 'GSM-2026-0931', 'fv5', '2026-09-18', 'АЗС №1, Чиланзар (демо)', 'diesel', 70, D, 'CC0007', { driverId: 'fd5' }),
  fu('ff14', 'GSM-2026-1035', 'fv5', '2026-10-15', 'АЗС №1, Чиланзар (демо)', 'diesel', 60, D, 'CC0007', { source: 'card', cardId: 'fc4', driverId: 'fd5', externalId: 'TX-90321' }),
  fu('ff15', 'GSM-2026-0948', 'fv6', '2026-09-28', 'ЭЗС Tashkent City (демо)', 'electric', 45, E, 'CC0002', { driverId: 'fd6' }),
  fu('ff16', 'GSM-2026-1038', 'fv6', '2026-10-16', 'ЭЗС Tashkent City (демо)', 'electric', 40, E, 'CC0002', { driverId: 'fd6' }),
  fu('ff17', 'GSM-2026-0905', 'fv8', '2026-09-04', 'АЗС №2, Самарканд (демо)', 'diesel', 60, D, 'CC0194', { driverId: 'fd8' }),
  fu('ff18', 'GSM-2026-0925', 'fg1', '2026-09-15', 'Доставка топлива, ООО «Avto Park Lizing» (демо)', 'diesel', 400, D, 'CC0007'),
  fu('ff19', 'GSM-2026-1012', 'fg1', '2026-10-10', 'Доставка топлива, ООО «Avto Park Lizing» (демо)', 'diesel', 350, D, 'CC0007'),
  fu('ff20', 'GSM-2026-1003', 'fg2', '2026-10-02', 'АЗС №5, Сергели (демо)', 'diesel', 120, D, 'CC0058'),
];

export const fleetCardsSeed: FleetFuelCard[] = [
  { id: 'fc1', number: '8600 •••• •••• 4411', provider: 'uzcard', account: '22602000900100004411', vehicleId: 'fv1', driverId: 'fd1', monthlyLimit: 1_300_000, balance: 160_000, status: 'active' },
  { id: 'fc2', number: '9860 •••• •••• 7302', provider: 'humo', account: '22602000900100007302', vehicleId: 'fv2', driverId: 'fd2', monthlyLimit: 4_800_000, balance: 2_558_000, status: 'active' },
  { id: 'fc3', number: 'UNG-0003391', provider: 'fuel_company', account: '22602000900100003391', vehicleId: 'fv3', driverId: 'fd3', monthlyLimit: 4_200_000, balance: 3_256_000, status: 'active' },
  { id: 'fc4', number: '8600 •••• •••• 9015', provider: 'uzcard', account: '22602000900100009015', vehicleId: 'fv5', driverId: 'fd5', monthlyLimit: 3_000_000, balance: 1_792_000, status: 'active' },
];

export const fleetTopUpsSeed: FleetTopUp[] = [
  {
    id: 'tu1', number: 'TU-2026-0901', period: '2026-10', status: 'done', comment: 'Лимиты на октябрь', createdBy: 'u6', createdAt: '2026-09-30T10:00:00Z', total: 12_300_000,
    lines: [{ cardId: 'fc1', amount: 1_300_000, state: 'success' }, { cardId: 'fc2', amount: 4_800_000, state: 'success' }, { cardId: 'fc3', amount: 4_200_000, state: 'success' }, { cardId: 'fc4', amount: 2_000_000, state: 'success' }],
    history: [{ at: '2026-09-30T10:00:00Z', userId: 'u6', action: 'submitted' }, { at: '2026-09-30T12:00:00Z', userId: 'u2', action: 'approved' }, { at: '2026-09-30T15:00:00Z', userId: 'u7', action: 'approved' }],
  },
  {
    id: 'tu2', number: 'TU-2026-1017', period: '2026-11', status: 'pending', comment: 'Лимиты на ноябрь', createdBy: 'u6', createdAt: '2026-10-17T10:00:00Z', total: 11_600_000,
    lines: [{ cardId: 'fc1', amount: 1_300_000 }, { cardId: 'fc2', amount: 4_000_000 }, { cardId: 'fc3', amount: 3_800_000 }, { cardId: 'fc4', amount: 2_500_000 }],
    history: [{ at: '2026-10-17T10:00:00Z', userId: 'u6', action: 'submitted' }],
  },
];

export const fleetServicesSeed: FleetService[] = [
  { id: 'fs1', number: 'TR-2026-0412', vehicleId: 'fv4', kind: 'repair', status: 'open', date: '2026-10-16', odometer: 212_700, fault: 'Пробуксовка сцепления, ошибка ГБО на холостом ходу', works: [{ name: 'Замена сцепления', hours: 4, cost: 1_200_000 }, { name: 'Диагностика ГБО', hours: 1, cost: 250_000 }], parts: [{ name: 'Комплект сцепления', qty: 1, unit: 'шт', price: 2_900_000 }, { name: 'Фильтр газовый', qty: 1, unit: 'шт', price: 450_000 }], contractorId: 'c5', warranty: false, warrantyNote: '', costCenterKey: 'CC0007', createdBy: 'u6', tookOffline: true },
  { id: 'fs2', number: 'TO-2026-0388', vehicleId: 'fv2', kind: 'maintenance', status: 'done', date: '2026-08-02', doneDate: '2026-08-02', odometer: 180_000, fault: 'ТО-180 000', works: [{ name: 'Замена масла и фильтров', hours: 2, cost: 350_000 }], parts: [{ name: 'Масло моторное 10W-40', qty: 10, unit: 'л', price: 145_000 }, { name: 'Комплект фильтров', qty: 1, unit: 'компл.', price: 550_000 }], contractorId: 'c5', warranty: false, warrantyNote: '', costCenterKey: 'CC0025', createdBy: 'u6', tookOffline: false },
  { id: 'fs3', number: 'TO-2026-0301', vehicleId: 'fv1', kind: 'maintenance', status: 'done', date: '2026-06-18', doneDate: '2026-06-18', odometer: 40_000, fault: 'ТО-40 000', works: [{ name: 'Плановое ТО-40 000', hours: 2, cost: 500_000 }], parts: [{ name: 'Масло моторное 5W-30', qty: 5, unit: 'л', price: 160_000 }, { name: 'Фильтры (масляный, воздушный, салонный)', qty: 1, unit: 'компл.', price: 600_000 }], contractorId: 'c5', warranty: false, warrantyNote: '', costCenterKey: 'CC0007', createdBy: 'u6', tookOffline: false },
  { id: 'fs4', number: 'TR-2026-0397', vehicleId: 'fv5', kind: 'repair', status: 'done', date: '2026-09-30', doneDate: '2026-10-01', odometer: 32_480, fault: 'Ошибка датчика ABS переднего правого колеса', works: [{ name: 'Замена датчика ABS', hours: 1, cost: 300_000 }], parts: [{ name: 'Датчик ABS', qty: 1, unit: 'шт', price: 1_100_000 }], contractorId: 'c5', warranty: true, warrantyNote: 'Гарантия производителя до 2027-07-25, акт № GW-1187', costCenterKey: 'CC0007', createdBy: 'u6', tookOffline: false },
  { id: 'fs5', number: 'TO-2026-0402', vehicleId: 'fg1', kind: 'maintenance', status: 'done', date: '2026-09-15', doneDate: '2026-09-15', odometer: 1_250, fault: 'ТО-1250 моточасов', works: [{ name: 'Замена масла и фильтров ДГУ', hours: 3, cost: 600_000 }], parts: [{ name: 'Масло 15W-40', qty: 20, unit: 'л', price: 35_000 }, { name: 'Фильтры топливный и масляный', qty: 1, unit: 'компл.', price: 300_000 }], contractorId: 'c5', warranty: false, warrantyNote: '', costCenterKey: 'CC0007', createdBy: 'u6', tookOffline: false },
  { id: 'fs6', number: 'TR-2026-0371', vehicleId: 'fv3', kind: 'repair', status: 'done', date: '2026-09-25', doneDate: '2026-09-26', odometer: 140_850, fault: 'Стук в рулевой рейке', works: [{ name: 'Замена рулевых тяг', hours: 3, cost: 700_000 }], parts: [{ name: 'Тяга рулевая', qty: 2, unit: 'шт', price: 650_000 }], contractorId: 'c5', warranty: false, warrantyNote: '', costCenterKey: 'CC0025', createdBy: 'u6', tookOffline: true },
];

export const fleetFaultsSeed: FleetFaultReport[] = [
  { id: 'fr1', number: 'NS-2026-0051', vehicleId: 'fv5', driverId: 'fd5', date: '2026-10-17', description: 'Стук в передней подвеске на неровностях', severity: 'medium', status: 'new', createdBy: 'u6' },
];

export const fleetExpensesSeed: FleetExpense[] = [
  { id: 'fx1', number: 'PR-2026-0921', vehicleId: 'fv3', kind: 'tires', date: '2026-09-25', amount: 1_200_000, description: 'Сезонная замена шин', contractorId: 'c5', costCenterKey: 'CC0025', createdBy: 'u6' },
  { id: 'fx2', number: 'PR-2026-1010', vehicleId: 'fv1', kind: 'wash', date: '2026-10-10', amount: 80_000, description: 'Мойка кузова и салона', driverId: 'fd1', costCenterKey: 'CC0007', createdBy: 'u6' },
  { id: 'fx3', number: 'PR-2026-1001', vehicleId: 'fv2', kind: 'parking', date: '2026-10-01', amount: 300_000, description: 'Охраняемая стоянка, октябрь', costCenterKey: 'CC0025', createdBy: 'u6' },
  { id: 'fx4', number: 'PR-2026-0929', vehicleId: 'fv6', kind: 'accessories', date: '2026-09-29', amount: 450_000, description: 'Видеорегистратор', costCenterKey: 'CC0002', createdBy: 'u6' },
  { id: 'fx5', number: 'PR-2026-1012', vehicleId: 'fv5', kind: 'wash', date: '2026-10-12', amount: 120_000, description: 'Мойка', driverId: 'fd5', costCenterKey: 'CC0007', createdBy: 'u6' },
  { id: 'fx6', number: 'PR-2026-0920', vehicleId: 'fv2', kind: 'wash', date: '2026-09-20', amount: 150_000, description: 'Мойка и химчистка салона', costCenterKey: 'CC0025', createdBy: 'u6' },
];

export const fleetFinesSeed: FleetFine[] = [
  { id: 'fn1', vehicleId: 'fv1', driverId: 'fd1', date: '2026-09-18', protocolNo: 'UB 2026 0918 4411', violation: 'Превышение скорости до 20 км/ч', amount: 375_000, status: 'paid', source: 'ubdd', recoverFromDriver: false, paidAt: '2026-09-20', costCenterKey: 'CC0007' },
  { id: 'fn2', vehicleId: 'fv5', driverId: 'fd5', date: '2026-10-11', protocolNo: 'UB 2026 1011 6540', violation: 'Нарушение правил остановки и стоянки', amount: 225_000, status: 'unpaid', source: 'ubdd', recoverFromDriver: true, costCenterKey: 'CC0007' },
];

const act = (number: string, date: string, odometer: number, fuelLevel: number): FleetAssignment['act'] => ({
  number, date, odometer, fuelLevel, checklist: { body: true, interior: true, tires: true, equipment: true, documents: true, keys: true }, defects: '', completedBy: 'u6', completedAt: `${date}T10:00:00Z`,
});
const asg = (id: string, number: string, vehicleId: string, driverId: string, role: FleetAssignment['role'], basis: FleetAssignment['basis'], from: string, to: string | undefined, odo: number, fromDriverId?: string): FleetAssignment => ({
  id, number, vehicleId, driverId, role, basis, effectiveFrom: from, ...(to ? { effectiveTo: to } : {}), ...(fromDriverId ? { fromDriverId } : {}), reason: 'Закрепление по распоряжению АХД', status: 'completed', createdBy: 'u6', createdAt: `${from}T09:00:00Z`,
  act: act(`AP-${number.slice(3)}`, from, odo, 40),
  history: [{ at: `${from}T09:00:00Z`, userId: 'u6', action: 'submitted' }, { at: `${from}T09:30:00Z`, userId: 'u2', action: 'approved' }, { at: `${from}T10:00:00Z`, userId: 'u6', action: 'status_changed', comment: 'act' }],
});

export const fleetAssignmentsSeed: FleetAssignment[] = [
  asg('fa1', 'RS-2026-0004', 'fv1', 'fd1', 'primary', 'power_of_attorney', '2026-01-10', undefined, 29_800),
  asg('fa2', 'RS-2026-0019', 'fv1', 'fd7', 'reserve', 'order', '2026-03-01', undefined, 33_100),
  asg('fa3', 'RS-2025-0101', 'fv2', 'fd2', 'primary', 'order', '2025-06-01', undefined, 158_200),
  asg('fa0', 'RS-2024-0012', 'fv3', 'fd7', 'primary', 'order', '2024-02-01', '2025-09-14', 52_000),
  asg('fa4', 'RS-2025-0144', 'fv3', 'fd3', 'primary', 'order', '2025-09-15', undefined, 104_300, 'fd7'),
  asg('fa5', 'RS-2025-0020', 'fv4', 'fd4', 'primary', 'order', '2025-02-01', undefined, 171_000),
  asg('fa6', 'RS-2024-0090', 'fv5', 'fd5', 'primary', 'order', '2024-08-01', undefined, 120),
  asg('fa7', 'RS-2025-0170', 'fv6', 'fd6', 'primary', 'order', '2025-09-05', undefined, 30),
  asg('fa8', 'RS-2026-0071', 'fv8', 'fd8', 'primary', 'power_of_attorney', '2026-05-11', undefined, 61_000),
  {
    id: 'fa9', number: 'RS-2026-0118', vehicleId: 'fv5', driverId: 'fd7', role: 'reserve', basis: 'order', effectiveFrom: '2026-10-20', reason: 'Резервный водитель на период отпуска основного', status: 'pending', createdBy: 'u6', createdAt: '2026-10-17T11:00:00Z',
    history: [{ at: '2026-10-17T11:00:00Z', userId: 'u6', action: 'submitted' }],
  },
];

export const fleetStatusEventsSeed: FleetStatusEvent[] = [
  ...fleetVehiclesSeed.map((v, i): FleetStatusEvent => ({ id: `fse${i + 1}`, vehicleId: v.id, from: null, to: 'in_operation', at: '2025-01-15T09:00:00Z', userId: 'u6' })),
  { id: 'fse21', vehicleId: 'fv3', from: 'in_operation', to: 'repair', at: '2026-09-25T09:00:00Z', userId: 'u6', reason: 'TR-2026-0371' },
  { id: 'fse22', vehicleId: 'fv3', from: 'repair', to: 'in_operation', at: '2026-09-26T16:00:00Z', userId: 'u6', reason: 'TR-2026-0371' },
  { id: 'fse23', vehicleId: 'fv7', from: 'in_operation', to: 'reserve', at: '2026-06-01T09:00:00Z', userId: 'u6', reason: 'Высокий пробег' },
  { id: 'fse24', vehicleId: 'fv7', from: 'reserve', to: 'writeoff_pending', at: '2026-10-15T08:30:00Z', userId: 'u6', reason: 'Пробег 410 000 км, ремонт экономически нецелесообразен' },
  { id: 'fse25', vehicleId: 'fv8', from: 'in_operation', to: 'reserve', at: '2026-09-30T09:00:00Z', userId: 'u6', reason: 'Сезонное снижение потребности' },
  { id: 'fse26', vehicleId: 'fv4', from: 'in_operation', to: 'repair', at: '2026-10-16T09:00:00Z', userId: 'u6', reason: 'TR-2026-0412' },
];

export const fleetSettingsSeed: FleetSettings = {
  alertHorizonDays: 30,
  overrunTolerancePct: 10,
  fuelPrices: { petrol: P, diesel: D, methane: M, propane: 6_500, electric: E },
};

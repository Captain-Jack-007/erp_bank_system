// Демо-оргструктура банка и МВЗ — генерируется детерминированно (одинаково при каждом запуске).
// Головной офис → 14 региональных филиалов (12 областей, г. Ташкент, Республика Каракалпакстан)
// → ~40 ЦБУ и отделы филиалов → МВЗ (~300). Все названия ЦБУ — по городам/районам, реквизиты вымышлены.
import type { BudgetArticle, BusinessSegment, CostCenter, ExpenseGroup, Localized, OrgUnit, Position } from '../types';

const BASE_FROM = '2018-01-01';
const SEED_AT = '2026-01-05T09:00:00Z';

interface RegionSeed {
  code: string;
  branch: Localized; // название регионального филиала
  short: Localized; // короткое название региона (для подписей)
  offices: [ru: string, uz: string][];
}

export const REGIONS: RegionSeed[] = [
  { code: '01', branch: { ru: 'Ташкентский городской филиал', uz: 'Toshkent shahar filiali' }, short: { ru: 'г. Ташкент', uz: 'Toshkent sh.' }, offices: [['Юнусабад', 'Yunusobod'], ['Чиланзар', 'Chilonzor'], ['Мирабад', 'Mirobod'], ['Сергели', 'Sergeli'], ['Яккасарай', 'Yakkasaroy']] },
  { code: '02', branch: { ru: 'Ташкентский областной филиал', uz: 'Toshkent viloyat filiali' }, short: { ru: 'Ташкентская обл.', uz: 'Toshkent vil.' }, offices: [['Чирчик', 'Chirchiq'], ['Ангрен', 'Angren'], ['Алмалык', 'Olmaliq']] },
  { code: '03', branch: { ru: 'Андижанский областной филиал', uz: 'Andijon viloyat filiali' }, short: { ru: 'Андижан', uz: 'Andijon' }, offices: [['Андижан-центр', 'Andijon markaz'], ['Асака', 'Asaka'], ['Ханабад', 'Xonobod']] },
  { code: '04', branch: { ru: 'Бухарский областной филиал', uz: 'Buxoro viloyat filiali' }, short: { ru: 'Бухара', uz: 'Buxoro' }, offices: [['Бухара-центр', 'Buxoro markaz'], ['Гиждуван', "G'ijduvon"], ['Каган', 'Kogon']] },
  { code: '05', branch: { ru: 'Джизакский областной филиал', uz: 'Jizzax viloyat filiali' }, short: { ru: 'Джизак', uz: 'Jizzax' }, offices: [['Джизак-центр', 'Jizzax markaz'], ['Заамин', 'Zomin']] },
  { code: '06', branch: { ru: 'Кашкадарьинский областной филиал', uz: 'Qashqadaryo viloyat filiali' }, short: { ru: 'Кашкадарья', uz: 'Qashqadaryo' }, offices: [['Карши', 'Qarshi'], ['Шахрисабз', 'Shahrisabz'], ['Китаб', 'Kitob']] },
  { code: '07', branch: { ru: 'Навоийский областной филиал', uz: 'Navoiy viloyat filiali' }, short: { ru: 'Навои', uz: 'Navoiy' }, offices: [['Навои-центр', 'Navoiy markaz'], ['Зарафшан', 'Zarafshon']] },
  { code: '08', branch: { ru: 'Наманганский областной филиал', uz: 'Namangan viloyat filiali' }, short: { ru: 'Наманган', uz: 'Namangan' }, offices: [['Наманган-центр', 'Namangan markaz'], ['Чуст', 'Chust'], ['Пап', 'Pop']] },
  { code: '09', branch: { ru: 'Самаркандский областной филиал', uz: 'Samarqand viloyat filiali' }, short: { ru: 'Самарканд', uz: 'Samarqand' }, offices: [['Самарканд-центр', 'Samarqand markaz'], ['Каттакурган', "Kattaqo'rg'on"], ['Ургут', 'Urgut'], ['Регистан', 'Registon']] },
  { code: '10', branch: { ru: 'Сурхандарьинский областной филиал', uz: 'Surxondaryo viloyat filiali' }, short: { ru: 'Сурхандарья', uz: 'Surxondaryo' }, offices: [['Термез', 'Termiz'], ['Денау', 'Denov']] },
  { code: '11', branch: { ru: 'Сырдарьинский областной филиал', uz: 'Sirdaryo viloyat filiali' }, short: { ru: 'Сырдарья', uz: 'Sirdaryo' }, offices: [['Гулистан', 'Guliston'], ['Янгиер', 'Yangiyer']] },
  { code: '12', branch: { ru: 'Ферганский областной филиал', uz: "Farg'ona viloyat filiali" }, short: { ru: 'Фергана', uz: "Farg'ona" }, offices: [['Фергана-центр', "Farg'ona markaz"], ['Коканд', "Qo'qon"], ['Маргилан', "Marg'ilon"]] },
  { code: '13', branch: { ru: 'Хорезмский областной филиал', uz: 'Xorazm viloyat filiali' }, short: { ru: 'Хорезм', uz: 'Xorazm' }, offices: [['Ургенч', 'Urganch'], ['Хива', 'Xiva']] },
  { code: '14', branch: { ru: 'Филиал по Республике Каракалпакстан', uz: "Qoraqalpog'iston Respublikasi filiali" }, short: { ru: 'Каракалпакстан', uz: "Qoraqalpog'iston" }, offices: [['Нукус', 'Nukus'], ['Беруни', 'Beruniy'], ['Кунград', "Qo'ng'irot"]] },
];

/** Подразделения головного офиса (ключи совпадают с departments в data.ts). */
const HO_DEPTS: { key: string; code: string; name: Localized; segment: BusinessSegment; head?: string }[] = [
  { key: 'd1', code: 'IT', name: { ru: 'Департамент информационных технологий', uz: 'Axborot texnologiyalari departamenti', en: 'Information Technology Department' }, segment: 'it', head: 'u2' },
  { key: 'd2', code: 'ADM', name: { ru: 'Административно-хозяйственный департамент', uz: "Ma'muriy-xo'jalik departamenti", en: 'Administration and Facilities Department' }, segment: 'support', head: 'u6' },
  { key: 'd3', code: 'FIN', name: { ru: 'Финансовый департамент', uz: 'Moliya departamenti', en: 'Finance Department' }, segment: 'treasury', head: 'u4' },
  { key: 'd4', code: 'PRC', name: { ru: 'Отдел закупок', uz: "Xaridlar bo'limi", en: 'Procurement Department' }, segment: 'support', head: 'u3' },
  { key: 'd5', code: 'LEG', name: { ru: 'Юридический департамент', uz: 'Yuridik departament', en: 'Legal Department' }, segment: 'support', head: 'u5' },
  { key: 'd6', code: 'HR', name: { ru: 'Департамент по работе с персоналом', uz: 'Xodimlar bilan ishlash departamenti', en: 'Human Resources Department' }, segment: 'support', head: 'u13' },
  { key: 'd7', code: 'ACC', name: { ru: 'Главная бухгалтерия', uz: 'Bosh buxgalteriya', en: 'Chief Accounting Office' }, segment: 'support', head: 'u7' },
  { key: 'd8', code: 'TRS', name: { ru: 'Казначейство', uz: "G'aznachilik", en: 'Treasury' }, segment: 'treasury', head: 'u8' },
  { key: 'd9', code: 'RET', name: { ru: 'Розничный бизнес', uz: 'Chakana biznes', en: 'Retail Banking' }, segment: 'retail' },
  { key: 'd10', code: 'CORP', name: { ru: 'Корпоративный бизнес', uz: 'Korporativ biznes', en: 'Corporate Banking' }, segment: 'corporate' },
  { key: 'd11', code: 'AUD', name: { ru: 'Служба внутреннего аудита', uz: 'Ichki audit xizmati', en: 'Internal Audit Service' }, segment: 'support', head: 'u19' },
];

const BRANCH_DEPTS: { suffix: string; name: Localized; segment: BusinessSegment; centres: [Localized, BusinessSegment, string][] }[] = [
  {
    suffix: 'RET', name: { ru: 'Отдел розничного бизнеса', uz: "Chakana biznes bo'limi" }, segment: 'retail',
    centres: [[{ ru: 'Розничные продукты и маркетинг', uz: 'Chakana mahsulotlar va marketing' }, 'retail', 'eg2'], [{ ru: 'Карты и платежи', uz: "Kartalar va to'lovlar" }, 'retail', 'eg6']],
  },
  {
    suffix: 'CORP', name: { ru: 'Отдел корпоративного бизнеса', uz: "Korporativ biznes bo'limi" }, segment: 'corporate',
    centres: [[{ ru: 'Кредитование юридических лиц', uz: 'Yuridik shaxslarni kreditlash' }, 'corporate', 'eg6'], [{ ru: 'РКО малого бизнеса', uz: 'Kichik biznesga hisob-kassa xizmati' }, 'sme', 'eg6']],
  },
  {
    suffix: 'OPS', name: { ru: 'Операционный отдел', uz: "Operatsion bo'lim" }, segment: 'support',
    centres: [[{ ru: 'Касса и инкассация', uz: 'Kassa va inkassatsiya' }, 'retail', 'eg5'], [{ ru: 'Хозяйственная служба', uz: "Xo'jalik xizmati" }, 'support', 'eg5']],
  },
];

const OFFICE_CENTRES: [Localized, BusinessSegment, string][] = [
  [{ ru: 'Фронт-офис', uz: 'Front-ofis' }, 'retail', 'eg6'],
  [{ ru: 'Касса', uz: 'Kassa' }, 'retail', 'eg6'],
  [{ ru: 'Банкоматы и терминалы', uz: 'Bankomatlar va terminallar' }, 'retail', 'eg1'],
  [{ ru: 'Хозяйственные расходы', uz: "Xo'jalik xarajatlari" }, 'support', 'eg5'],
];

const HO_CENTRES: [Localized, string][] = [
  [{ ru: 'Аппарат департамента', uz: 'Departament apparati' }, 'eg4'],
  [{ ru: 'Операционные расходы', uz: 'Operatsion xarajatlar' }, 'eg5'],
  [{ ru: 'Проекты развития', uz: 'Rivojlanish loyihalari' }, 'eg6'],
];

export const expenseGroups: ExpenseGroup[] = [
  { id: 'eg1', code: 'EG-IT', name: { ru: 'ИТ-расходы', uz: 'AT xarajatlari', en: 'IT expenses' } },
  { id: 'eg2', code: 'EG-MKT', name: { ru: 'Маркетинговые расходы', uz: 'Marketing xarajatlari', en: 'Marketing expenses' } },
  { id: 'eg3', code: 'EG-DEV', name: { ru: 'Собственная разработка ПО', uz: "Bankning o'z dasturiy ishlanmalari", en: 'In-house software development' } },
  { id: 'eg4', code: 'EG-PERS', name: { ru: 'Расходы на персонал', uz: 'Xodimlar xarajatlari', en: 'Personnel expenses' } },
  { id: 'eg5', code: 'EG-ADM', name: { ru: 'Административно-хозяйственные расходы', uz: "Ma'muriy-xo'jalik xarajatlari", en: 'Administrative expenses' } },
  { id: 'eg6', code: 'EG-OTH', name: { ru: 'Прочие операционные расходы', uz: 'Boshqa operatsion xarajatlar', en: 'Other operating expenses' } },
];

export const budgetArticles: BudgetArticle[] = [
  { id: 'ba1', code: '2026-IT-HW', name: { ru: 'ИТ-оборудование', uz: 'AT uskunalari', en: 'IT equipment' }, groupId: 'eg1' },
  { id: 'ba2', code: '2026-IT-SW', name: { ru: 'Программное обеспечение и лицензии', uz: "Dasturiy ta'minot va litsenziyalar", en: 'Software and licences' }, groupId: 'eg1' },
  { id: 'ba3', code: '2026-IT-DEV', name: { ru: 'Разработка ПО силами банка', uz: "Bank dasturchilari tomonidan ishlab chiqish" }, groupId: 'eg3' },
  { id: 'ba4', code: '2026-MKT-ADV', name: { ru: 'Реклама и продвижение', uz: 'Reklama va targ‘ibot' }, groupId: 'eg2' },
  { id: 'ba5', code: '2026-MKT-EVT', name: { ru: 'Мероприятия для клиентов', uz: 'Mijozlar uchun tadbirlar' }, groupId: 'eg2' },
  { id: 'ba6', code: '2026-HR-TRN', name: { ru: 'Обучение персонала', uz: "Xodimlarni o'qitish" }, groupId: 'eg4' },
  { id: 'ba7', code: '2026-ADM-FURN', name: { ru: 'Мебель и оснащение офисов', uz: 'Mebel va ofis jihozlari', en: 'Office furniture and fittings' }, groupId: 'eg5' },
  { id: 'ba8', code: '2026-ADM-AUTO', name: { ru: 'Автотранспорт и ГСМ', uz: "Avtotransport va yoqilg'i", en: 'Vehicles and fuel' }, groupId: 'eg5' },
  // ошибочно классифицирована (подписки на облачные сервисы отнесены к хозрасходам) — пример для «амнистии»
  { id: 'ba9', code: '2026-ADM-CLOUD', name: { ru: 'Подписки на облачные сервисы', uz: 'Bulutli xizmatlarga obunalar' }, groupId: 'eg5' },
  { id: 'ba10', code: '2026-OTH-COM', name: { ru: 'Связь и почтовые расходы', uz: 'Aloqa va pochta xarajatlari' }, groupId: 'eg6' },
];

export const positions: Position[] = [
  { id: 'p1', code: 'SPEC', name: { ru: 'Ведущий специалист', uz: 'Yetakchi mutaxassis', en: 'Lead Specialist' }, defaultRole: 'employee' },
  { id: 'p2', code: 'DIR', name: { ru: 'Директор департамента', uz: 'Departament direktori' }, defaultRole: 'dept_head' },
  { id: 'p3', code: 'PRC-HEAD', name: { ru: 'Начальник отдела закупок', uz: "Xaridlar bo'limi boshlig'i", en: 'Head of Procurement' }, defaultRole: 'procurement' },
  { id: 'p4', code: 'CFO', name: { ru: 'Финансовый директор', uz: 'Moliya direktori', en: 'Chief Financial Officer' }, defaultRole: 'finance' },
  { id: 'p5', code: 'LAW', name: { ru: 'Главный юрист', uz: 'Bosh yurist', en: 'Chief Legal Counsel' }, defaultRole: 'legal' },
  { id: 'p6', code: 'SYSADM', name: { ru: 'Администратор системы', uz: 'Tizim administratori', en: 'System Administrator' }, defaultRole: 'admin' },
  { id: 'p7', code: 'CHACC', name: { ru: 'Главный бухгалтер', uz: 'Bosh buxgalter', en: 'Chief Accountant' }, defaultRole: 'accountant' },
  { id: 'p8', code: 'TRS-HEAD', name: { ru: 'Начальник казначейства', uz: "G'aznachilik boshlig'i", en: 'Head of Treasury' }, defaultRole: 'treasury' },
  { id: 'p9', code: 'OPER', name: { ru: 'Оператор ввода данных', uz: "Ma'lumot kiritish operatori", en: 'Data Entry Operator' }, defaultRole: 'data_entry' },
  { id: 'p10', code: 'DEPUTY', name: { ru: 'Заместитель директора департамента', uz: "Departament direktori o'rinbosari", en: 'Deputy Department Director' }, defaultRole: 'approver' },
  { id: 'p11', code: 'ANL', name: { ru: 'Аналитик', uz: 'Tahlilchi', en: 'Analyst' }, defaultRole: 'analyst' },
  { id: 'p12', code: 'CASH', name: { ru: 'Кассир-операционист НДО', uz: 'NDO kassir-operatsionisti', en: 'Teller, Mini-Bank Office' }, defaultRole: 'cash_operator' },
  { id: 'p13', code: 'HRM', name: { ru: 'Менеджер по персоналу', uz: "Xodimlar bo'yicha menejer", en: 'HR Manager' }, defaultRole: 'hr' },
  { id: 'p14', code: 'STORE', name: { ru: 'Заведующий складом', uz: 'Ombor mudiri', en: 'Warehouse Manager' }, defaultRole: 'storekeeper' },
  { id: 'p15', code: 'DRV', name: { ru: 'Водитель', uz: 'Haydovchi', en: 'Driver' }, defaultRole: 'driver' },
  { id: 'p16', code: 'ARCH', name: { ru: 'Архивариус', uz: 'Arxivchi', en: 'Archivist' }, defaultRole: 'archivist' },
  { id: 'p17', code: 'TAX', name: { ru: 'Специалист по налогам', uz: "Soliqlar bo'yicha mutaxassis", en: 'Tax Specialist' }, defaultRole: 'tax_officer' },
  { id: 'p18', code: 'SUP', name: { ru: 'Инженер технической поддержки', uz: "Texnik qo'llab-quvvatlash muhandisi", en: 'Technical Support Engineer' }, defaultRole: 'support' },
  { id: 'p19', code: 'AUD', name: { ru: 'Внутренний аудитор', uz: 'Ichki auditor', en: 'Internal Auditor' }, defaultRole: 'auditor' },
  { id: 'p20', code: 'BR-HEAD', name: { ru: 'Управляющий филиалом', uz: 'Filial boshqaruvchisi', en: 'Branch Manager' }, defaultRole: 'dept_head' },
  { id: 'p21', code: 'ACC', name: { ru: 'Бухгалтер', uz: 'Buxgalter', en: 'Accountant' }, defaultRole: 'accountant' }, // P4-SEC
];

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function version<T extends object>(key: string, n: number, validFrom: string, validTo: string | null, reason: string, fields: T) {
  return { id: `${key}~v${n}`, key, version: n, validFrom, validTo, changedBy: 'u6', changedAt: `${validFrom}T08:00:00Z`, changeReason: reason, ...fields };
}

const INITIAL = 'Первичная загрузка оргструктуры';

export function buildOrgUnits(): OrgUnit[] {
  const out: OrgUnit[] = [];
  out.push(version('HO', 1, BASE_FROM, null, INITIAL, { code: '00000', type: 'head_office' as const, name: { ru: 'Головной офис', uz: 'Bosh ofis', en: 'Head office' }, parentKey: null, regionCode: '01', cbuCode: '00000', address: 'Toshkent sh., Shahrisabz ko‘ch., 1-uy (demo)' }));
  for (const d of HO_DEPTS) {
    const fields = { code: d.code, type: 'department' as const, name: d.name, parentKey: 'HO', regionCode: '01', cbuCode: '00000', ...(d.head ? { headUserId: d.head } : {}) };
    if (d.key === 'd6') {
      // пример SCD2: переименование управления кадров в департамент
      out.push(version(d.key, 1, BASE_FROM, '2023-12-31', INITIAL, { ...fields, name: { ru: 'Управление кадров', uz: 'Kadrlar boshqarmasi' } }));
      out.push(version(d.key, 2, '2024-01-01', null, 'Приказ № 14-к о реорганизации кадровой службы (демо)', fields));
    } else out.push(version(d.key, 1, BASE_FROM, null, INITIAL, fields));
  }
  for (const r of REGIONS) {
    const rk = `R${r.code}`;
    const branchCbu = `${r.code}000`;
    out.push(version(rk, 1, BASE_FROM, null, INITIAL, { code: branchCbu, type: 'region' as const, name: r.branch, parentKey: 'HO', regionCode: r.code, cbuCode: branchCbu, ...(r.code === '09' ? { headUserId: 'u21' } : {}) }));
    for (const bd of BRANCH_DEPTS) {
      out.push(version(`${rk}-${bd.suffix}`, 1, BASE_FROM, null, INITIAL, { code: `${r.code}-${bd.suffix}`, type: 'department' as const, name: { ru: `${bd.name.ru} — ${r.short.ru}`, uz: `${bd.name.uz} — ${r.short.uz}` }, parentKey: rk, regionCode: r.code, cbuCode: branchCbu }));
    }
    r.offices.forEach(([ru, uz], i) => {
      const key = `${rk}-B${pad(i + 1, 2)}`;
      const cbu = `${r.code}${pad(i + 1, 3)}`;
      const fields = { code: cbu, type: 'branch_office' as const, name: { ru: `ЦБУ «${ru}»`, uz: `BXM «${uz}»` }, parentKey: rk, regionCode: r.code, cbuCode: cbu, address: `${r.short.uz}, ${uz} (demo)` };
      if (key === 'R01-B05') {
        out.push(version(key, 1, BASE_FROM, '2025-06-30', INITIAL, { ...fields, name: { ru: 'ЦБУ «Шота Руставели»', uz: 'BXM «Shota Rustaveli»' } }));
        out.push(version(key, 2, '2025-07-01', null, 'Переименование по решению Правления № 31 (демо)', fields));
      } else if (key === 'R02-B03') {
        out.push(version(key, 1, BASE_FROM, '2024-12-31', INITIAL, { ...fields, parentKey: 'R01' }));
        out.push(version(key, 2, '2025-01-01', null, 'Передача ЦБУ в Ташкентский областной филиал (демо)', fields));
      } else if (key === 'R09-B04') {
        out.push(version(key, 1, '2026-03-01', null, 'Открытие нового ЦБУ (демо)', fields));
      } else out.push(version(key, 1, BASE_FROM, null, INITIAL, fields));
    });
  }
  // закрытый ЦБУ — есть только в истории (структура «на дату» до 30.09.2025)
  out.push(version('R12-B04', 1, BASE_FROM, '2025-09-30', INITIAL, { code: '12004', type: 'branch_office' as const, name: { ru: 'ЦБУ «Кувасай»', uz: 'BXM «Quvasoy»' }, parentKey: 'R12', regionCode: '12', cbuCode: '12004', address: "Farg'ona, Quvasoy (demo)" }));
  return out;
}

const RESPONSIBLES = ['u1', 'u2', 'u3', 'u4', 'u7', 'u8', 'u9', 'u12', 'u14', 'u21'];

export function buildCostCenters(units: OrgUnit[]): CostCenter[] {
  const out: CostCenter[] = [];
  let n = 0;
  const add = (unit: OrgUnit, seq: number, name: Localized, segment: BusinessSegment, groupId: string, opts: { closedAt?: string; noResponsible?: boolean } = {}) => {
    n++;
    const unitNo = unit.type === 'department' && unit.parentKey === 'HO' ? pad(Number(unit.key.slice(1)), 3) : unit.cbuCode!.slice(2);
    const sfx = unit.type === 'department' && unit.parentKey !== 'HO' ? `${unit.key.split('-')[1]!.slice(0, 1)}${seq}` : pad(seq, 2);
    const key = `CC${pad(n, 4)}`;
    const region = unit.type === 'department' && unit.parentKey === 'HO' ? '00' : unit.regionCode;
    const code = `MVZ-${region}-${unitNo}-${sfx}`;
    const responsibleId = opts.noResponsible ? undefined : RESPONSIBLES[n % RESPONSIBLES.length];
    const fields = {
      code,
      name: { ru: `${name.ru} · ${unit.name.ru}`, uz: `${name.uz} · ${unit.name.uz}` },
      orgUnitKey: unit.key,
      cbuCode: unit.cbuCode!,
      segment,
      expenseGroupId: groupId,
      ...(responsibleId ? { responsibleId } : {}),
      status: (opts.closedAt ? 'closed' : 'active') as CostCenter['status'],
    };
    if (opts.closedAt) {
      out.push(version(key, 1, BASE_FROM, opts.closedAt, INITIAL, { ...fields, status: 'active' as const }));
      out.push(version(key, 2, nextDay(opts.closedAt), null, 'Закрытие МВЗ в связи с закрытием ЦБУ (демо)', fields));
    } else if (n === 120) {
      // пример амнистии: МВЗ банкоматов перенесено из хозрасходов в ИТ-расходы
      out.push(version(key, 1, BASE_FROM, '2025-12-31', INITIAL, { ...fields, expenseGroupId: 'eg5' }));
      out.push(version(key, 2, '2026-01-01', null, 'Re-mapping: банкоматы относятся к ИТ-расходам (демо)', fields));
    } else out.push(version(key, 1, unit.validFrom, null, INITIAL, fields));
  };
  const current = units.filter((u) => u.validTo === null);
  for (const u of current.filter((x) => x.type === 'department' && x.parentKey === 'HO')) {
    const seg = HO_DEPTS.find((d) => d.key === u.key)?.segment ?? 'support';
    HO_CENTRES.forEach(([name, g], i) => add(u, i + 1, name, seg, g));
    if (u.key === 'd1') {
      add(u, 4, { ru: 'Собственная разработка ПО', uz: "O'z dasturiy ishlanmalar" }, 'it', 'eg3');
      add(u, 5, { ru: 'Инфраструктура ЦОД', uz: 'MMM infratuzilmasi' }, 'it', 'eg1');
    }
  }
  for (const r of REGIONS) {
    const branch = current.find((u) => u.key === `R${r.code}`)!;
    add(branch, 1, { ru: 'Аппарат филиала', uz: 'Filial apparati' }, 'support', 'eg4');
    for (const bd of BRANCH_DEPTS) {
      const dep = current.find((u) => u.key === `R${r.code}-${bd.suffix}`)!;
      bd.centres.forEach(([name, seg, g], i) => add(dep, i + 1, name, seg, g));
    }
    for (const off of current.filter((u) => u.parentKey === `R${r.code}` && u.type === 'branch_office')) {
      OFFICE_CENTRES.forEach(([name, seg, g], i) => add(off, i + 1, name, seg, g, { noResponsible: n % 37 === 5 }));
    }
  }
  // дубль наименования внутри одной оргединицы — находка для проверки качества данных
  const yunusobod = current.find((u) => u.key === 'R01-B01')!;
  add(yunusobod, 5, OFFICE_CENTRES[1]![0], 'retail', 'eg6');
  // МВЗ закрытого ЦБУ «Кувасай»: три закрыты, одно по ошибке осталось активным (находка для проверки качества данных)
  const closed = units.find((u) => u.key === 'R12-B04')!;
  OFFICE_CENTRES.forEach(([name, seg, g], i) => add(closed, i + 1, name, seg, g, i < 3 ? { closedAt: '2025-09-30' } : {}));
  return out;
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const SEGMENTS: BusinessSegment[] = ['retail', 'corporate', 'sme', 'treasury', 'support', 'it'];
export const SALES_CHANNELS = ['branch', 'internet', 'mobile', 'agent', 'call_center'] as const;
export { SEED_AT };

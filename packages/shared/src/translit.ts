// Транслитерация узбекского текста: латиница → кириллица (ТЗ 4.3.5 — интерфейс на узбекском в обеих графиках).
// Узбекская кириллица не хранится в словарях отдельно: она генерируется из латиницы этой функцией,
// поэтому переводчики поддерживают только один узбекский словарь.
//
// Правила (орфография 1995 г. и обратное соответствие кириллице):
//   o‘/oʻ/o'/o`/o’ → ў, g‘ → ғ, sh → ш, ch → ч, ng → нг, yo → ё, yu → ю, ya → я, ye → е,
//   e в начале слова и после гласной → э, x → х, q → қ, h → ҳ, j → ж, y → й,
//   ts в заимствованиях (-tsiya, -tsion, -tsent…) и -ksiya/-psiya → ц, ʼ/’ (тутуқ) → ъ.
// Сохраняются: регистр, цифры, пунктуация, плейсхолдеры {v}, адреса e-mail/URL,
// латинские коды и международные аббревиатуры (XB-ERP, IFRS, FTP, CSV, SLA, POS…),
// слова с буквами c/w (их нет в узбекской латинице — это иностранные слова: Active Directory, Excel).

const MAP: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н',
  o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з', c: 'ц', w: 'в',
};
const VOWELS = new Set(['а', 'о', 'у', 'ў', 'э', 'е', 'ё', 'ю', 'я']); // e после них → э
const MOD = /[‘ʻ'`’]/; // знак после o / g
const TUTUQ = /[ʼ'’`‘ʻ]/; // разделительный знак (тутуқ)

/** Узбекские аббревиатуры, которые пишутся кириллицей (STIR → СТИР). Остальные — латиницей как есть. */
const UZ_ABBR = new Set([
  'AT', 'ATB', 'AV', 'AJ', 'EHF', 'ERI', 'JShDS', 'JShShIR', 'KKZ', 'MB', 'MBHS', 'MHXS', 'MChJ', 'QQS', 'STIR',
  'TT', 'TXK', 'YaTT', 'OSAGO', 'XK', 'DUK', 'UK', 'MFO', 'BHM', 'ShJ', 'XT', 'SFD', 'IIB', 'DSQ', 'HR',
]);
/** Слова, которые никогда не транслитерируются. */
const KEEP = new Set(['E-IMZO', 'XB-ERP', 'iABS', 'MinIO', 'Didox']);
/** Единицы измерения со смешанным регистром. */
const UNITS: Record<string, string> = { kVt: 'кВт', MVt: 'МВт', kVA: 'кВА', Gb: 'Гб', Mb: 'Мб' };

/** Целые слова с мягким знаком и прочими особенностями заимствований. */
const WHOLE: Record<string, string> = {
  yanvar: 'январь', fevral: 'февраль', aprel: 'апрель', iyun: 'июнь', iyul: 'июль', sentabr: 'сентябрь',
  sentyabr: 'сентябрь', oktabr: 'октябрь', noyabr: 'ноябрь', dekabr: 'декабрь', model: 'модель', rol: 'роль',
  parol: 'пароль', kontrol: 'контроль', portfel: 'портфель', avtomobil: 'автомобиль', dizel: 'дизель',
  mebel: 'мебель', rubl: 'рубль', fayl: 'файл', aksiz: 'акциз', sex: 'цех', medal: 'медаль', aktual: 'актуал',
};
/** Основы, к которым дальше присоединяются аффиксы (kompyuterlar → компьютерлар). */
const STEMS: [string, string][] = [
  ['sentyabr', 'сентябр'], ['sentabr', 'сентябр'], ['oktabr', 'октябр'], ['kompyuter', 'компьютер'], ['obyekt', 'объект'],
  ['subyekt', 'субъект'], ['obyom', 'объём'], ['konsepsiya', 'концепция'], ['prinsip', 'принцип'],
  ['aksiz', 'акциз'], ['sertifikat', 'сертификат'], ['inssident', 'инцидент'], ['intsident', 'инцидент'],
  ['dotsent', 'доцент'], ['koeffitsiyent', 'коэффициент'], ['koeffitsient', 'коэффициент'], ['patsiyent', 'пациент'],
  ['restrukturizatsiya', 'реструктуризация'], ['pensiya', 'пенсия'], ['valyuta', 'валюта'],
];
const TS_NEXT = ['iya', 'io', 'ent', 'enz', 'es', 'ep', 'ikl', 'ifr', 'iyent', 'ient'];

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Применить регистр исходного слова к результату: ВСЁ / Первая / как есть. */
function applyCase(src: string, out: string): string {
  const letters = src.replace(/[^A-Za-z]/g, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) return out.toUpperCase();
  if (/^[A-Z]/.test(src)) return upperFirst(out);
  return out;
}

/** Транслитерация одного «простого» слова (только буквы и апострофы, регистр — из исходника). */
function word(src: string): string {
  const low = src.toLowerCase();
  if (WHOLE[low]) return applyCase(src, WHOLE[low]);
  for (const [stem, cyr] of STEMS) {
    if (low.startsWith(stem)) return applyCase(src, cyr + core(low.slice(stem.length), src.slice(stem.length), true));
  }
  return core(low, src, false);
}

/** Посимвольный разбор с сохранением регистра каждой буквы. */
function core(low: string, src: string, continued: boolean): string {
  let out = '';
  let i = 0;
  const allCaps = src.replace(/[^A-Za-z]/g, '').length > 1 && src === src.toUpperCase();
  const emit = (cyr: string, at: number) => {
    const ch = src.charAt(at);
    out += ch !== ch.toLowerCase() ? (allCaps || cyr.length === 1 ? cyr.toUpperCase() : upperFirst(cyr)) : cyr;
  };
  const prevLow = () => out.charAt(out.length - 1).toLowerCase();
  while (i < low.length) {
    const c = low.charAt(i);
    const n = low.charAt(i + 1);
    const rest = low.slice(i);
    // o‘ / g‘
    if ((c === 'o' || c === 'g') && MOD.test(n)) {
      emit(c === 'o' ? 'ў' : 'ғ', i);
      i += 2;
      continue;
    }
    // y + гласная: yo‘ → йў, yo → ё, yu → ю, ya → я, ye → е
    if (c === 'y' && (n === 'o' || n === 'u' || n === 'a' || n === 'e')) {
      if (n === 'o' && MOD.test(low.charAt(i + 2))) {
        emit('й', i);
        i += 1;
        continue;
      }
      emit(n === 'o' ? 'ё' : n === 'u' ? 'ю' : n === 'a' ? 'я' : 'е', i);
      i += 2;
      continue;
    }
    if (c === 's' && n === 'h') {
      emit('ш', i);
      i += 2;
      continue;
    }
    if (c === 'c' && n === 'h') {
      emit('ч', i);
      i += 2;
      continue;
    }
    // s'h → сҳ (Is'hoq)
    if (c === 's' && TUTUQ.test(n) && low.charAt(i + 2) === 'h') {
      emit('с', i);
      emit('ҳ', i + 2);
      i += 3;
      continue;
    }
    // ts → ц в заимствованиях и в начале слова
    if (c === 't' && n === 's' && ((i === 0 && !continued) || TS_NEXT.some((x) => low.startsWith(x, i + 2)))) {
      emit('ц', i);
      i += 2;
      continue;
    }
    // -ksiya / -psiya / -ksion → кц / пц (funksiya → функция, opsiya → опция)
    if ((c === 'k' || c === 'p') && n === 's' && (rest.startsWith('siya', 1) || rest.startsWith('sion', 1))) {
      emit(c === 'k' ? 'к' : 'п', i);
      emit('ц', i + 1);
      i += 2;
      continue;
    }
    if (c === 'e') {
      const atStart = i === 0 && !continued;
      emit(atStart || VOWELS.has(prevLow()) ? 'э' : 'е', i);
      i += 1;
      continue;
    }
    if (TUTUQ.test(c)) {
      out += 'ъ';
      i += 1;
      continue;
    }
    const m = MAP[c];
    if (m) emit(m, i);
    else out += src.charAt(i);
    i += 1;
  }
  return out;
}

/** Слово (часть дефисного составного): решает, транслитерировать ли его. */
function token(src: string): string {
  if (KEEP.has(src)) return src;
  if (UNITS[src]) return UNITS[src]!;
  if (/\d/.test(src)) {
    // код + узбекский аффикс через апостроф: 2FA'siz → 2FA'сиз
    const m = /^([A-Za-z0-9]*\d[A-Za-z0-9]*)([‘ʻ'`’ʼ])([a-z]+)$/.exec(src);
    return m ? `${m[1]}${m[2]}${core(m[3]!, m[3]!, true)}` : src; // коды: A4, u6, IFRS9
  }
  if (/[cw]/i.test(src.replace(/ch/gi, ''))) return src; // иностранные слова
  // Обычное слово: строчные или с заглавной первой буквой (включая Sh/Ch/Ya/O‘…)
  if (/^(?:[A-Z]|Sh|Ch|Ya|Yo|Yu|Ye|O[‘ʻ'`’]|G[‘ʻ'`’])?[a-z‘ʻ'`’ʼ]*$/.test(src)) return word(src);
  // Слово, набранное ПРОПИСНЫМИ (6+ букв), — обычное слово, а не аббревиатура
  if (src.length >= 6 && /^[A-Z‘ʻ'`’ʼ]+$/.test(src)) return word(src);
  // Аббревиатура (+ аффикс): STIR, YaTT, MBdagi, TXKga, USDdan
  const m = /^(.*[A-Z])([a-z‘ʻ'`’ʼ]*)$/.exec(src);
  if (m) {
    const [, abbr, suffix] = m as unknown as [string, string, string];
    // CamelCase-имена (HttpOnly, SameSite, OneID, MinIO) — иностранные, не трогаем целиком
    if (!UZ_ABBR.has(abbr) && /[a-z]/.test(abbr)) return src;
    const head = UZ_ABBR.has(abbr) ? core(abbr.toLowerCase(), abbr.toUpperCase(), false).toUpperCase() : abbr;
    return head + (suffix ? core(suffix, suffix, true) : '');
  }
  return src;
}

// Слова: буквы/цифры, апострофы внутри слова, дефисные составные.
const WORD = /[A-Za-z0-9](?:[A-Za-z0-9]|[‘ʻ'`’ʼ](?=[A-Za-z])|[‘ʻ'`’](?<=[oOgG][‘ʻ'`’]))*/g;
// Не трогаем: плейсхолдеры, e-mail, URL, домены.
const PROTECT = /(\{[^}]*\}|\S+@\S+|https?:\/\/\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:uz|com|ru|org|net|gov)\b\S*)/;

function segment(text: string): string {
  // Составное слово целиком (XB-ERP, E-IMZO) может быть в списке KEEP; иначе — по частям.
  return text.replace(/[A-Za-z0-9‘ʻ'`’ʼ]+(?:-[A-Za-z0-9‘ʻ'`’ʼ]+)*/g, (run) =>
    KEEP.has(run) ? run : run.split('-').map((p) => p.replace(WORD, token)).join('-'),
  );
}

const cache = new Map<string, string>();

/** Узбекская латиница → узбекская кириллица. */
export function toCyrillic(text: string): string {
  if (!text) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const res = text
    .split(PROTECT)
    .map((part, i) => (i % 2 === 1 ? part : segment(part)))
    .join('');
  if (cache.size < 20000) cache.set(text, res);
  return res;
}

const BACK: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g‘', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'q',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: 'o‘', ф: 'f', х: 'x', ҳ: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: 'ʼ', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya',
};

/** Обратное преобразование: узбекская кириллица → латиница (для поиска и разбора введённого текста). */
export function toLatin(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const low = ch.toLowerCase();
    let lat = BACK[low];
    if (lat === undefined) {
      out += ch;
      continue;
    }
    // е в начале слова и после гласной — ye
    if (low === 'е' && (i === 0 || !/[а-яёўқғҳ]/i.test(text.charAt(i - 1)) || /[аеёиоуўэюя]/i.test(text.charAt(i - 1)))) lat = 'ye';
    if (ch !== low) lat = lat.length > 1 && text.charAt(i + 1) === text.charAt(i + 1).toUpperCase() && /[А-ЯЁЎҚҒҲ]/.test(text.charAt(i + 1)) ? lat.toUpperCase() : lat.charAt(0).toUpperCase() + lat.slice(1);
    out += lat;
  }
  return out;
}

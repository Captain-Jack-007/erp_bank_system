// P4-GEN (ТЗ PR-TEC-007): содержание встроенной справки пользователя — русский, узбекский (латиница; кириллица
// генерируется автоматически) и английский. Статьи «Начало работы» + по статье на каждый модуль меню
// (apps/web/src/modules.tsx): назначение, основные экраны, пошаговые ключевые операции. Роли и права в статье
// модуля строятся из действующей матрицы прав (security.ts), а не пишутся вручную.
import type { Localized } from '../types';

export interface HelpTask {
  title: Localized;
  steps: Localized[];
}

export interface HelpArticle {
  /** id статьи: id модуля из modules.tsx или start-*. */
  id: string;
  kind: 'start' | 'module';
  /** Для статей «Начало работы»; у модулей заголовок — название пункта меню. */
  title?: Localized;
  summary: Localized;
  screens?: Localized[];
  tasks: HelpTask[];
  tips?: Localized[];
  /** Связанные статьи. */
  related?: string[];
}

const T = (ru: string, uz: string, en: string): Localized => ({ ru, uz, en });
const task = (title: Localized, ...steps: Localized[]): HelpTask => ({ title, steps });

export const HELP_ARTICLES: HelpArticle[] = [
  // ---------------- Начало работы ----------------
  {
    id: 'start-login', kind: 'start',
    title: T('Вход в систему', 'Tizimga kirish', 'Signing in'),
    summary: T(
      'XB-ERP открывается в браузере. Вход выполняется по логину и паролю банка, доменной учётной записью (Active Directory) или через OneID; после проверки пароля всегда требуется второй фактор — одноразовый код.',
      'XB-ERP brauzerda ochiladi. Kirish bank logini va paroli, domen hisob yozuvi (Active Directory) yoki OneID orqali amalga oshiriladi; parol tekshirilgandan so‘ng har doim ikkinchi omil — bir martalik kod talab qilinadi.',
      'XB-ERP runs in the browser. You sign in with your bank login and password, a domain account (Active Directory) or OneID; after the password check a second factor — a one-time code — is always required.',
    ),
    tasks: [
      task(T('Вход по логину и паролю банка', 'Bank logini va paroli bilan kirish', 'Sign in with bank login and password'),
        T('На экране входа выберите вкладку «Учётная запись банка».', 'Kirish ekranida «Bank hisob yozuvi» yorlig‘ini tanlang.', 'On the sign-in screen choose the “Bank account” tab.'),
        T('Введите логин (например, b.azizov) и пароль, нажмите «Войти».', 'Loginni (masalan, b.azizov) va parolni kiriting, «Kirish» tugmasini bosing.', 'Enter your login (e.g. b.azizov) and password and press “Sign in”.'),
        T('Введите 6-значный код из SMS (в демо он показан под полем) и нажмите «Подтвердить».', 'SMS orqali kelgan 6 xonali kodni kiriting (demoda u maydon ostida ko‘rsatiladi) va «Tasdiqlash» tugmasini bosing.', 'Enter the 6-digit SMS code (shown under the field in the demo) and press “Verify”.'),
        T('Если срок пароля истёк, система сначала попросит задать новый пароль по парольной политике.', 'Agar parol muddati tugagan bo‘lsa, tizim avval parol siyosatiga muvofiq yangi parol o‘rnatishni so‘raydi.', 'If your password has expired, the system first asks you to set a new one according to the password policy.'),
      ),
      task(T('Вход доменной учётной записью (AD)', 'Domen hisob yozuvi (AD) bilan kirish', 'Sign in with a domain account (AD)'),
        T('Выберите вкладку «Доменная учётная запись (AD)».', '«Domen hisob yozuvi (AD)» yorlig‘ini tanlang.', 'Choose the “Domain account (AD)” tab.'),
        T('Введите логин в виде XALQ\\логин, логин@xalq.local или просто логин и доменный пароль.', 'Loginni XALQ\\login, login@xalq.local yoki shunchaki login ko‘rinishida va domen parolini kiriting.', 'Enter the login as XALQ\\login, login@xalq.local or just the login, and the domain password.'),
        T('Пароль проверяет каталог Active Directory; затем введите одноразовый код, как при обычном входе.', 'Parolni Active Directory katalogi tekshiradi; so‘ng odatdagidek bir martalik kodni kiriting.', 'Active Directory checks the password; then enter the one-time code as usual.'),
        T('Если учётная запись отключена в AD, вход будет отклонён — обратитесь в Service Desk.', 'Agar hisob yozuvi AD da o‘chirilgan bo‘lsa, kirish rad etiladi — Service Desk ga murojaat qiling.', 'If the account is disabled in AD, sign-in is refused — contact the Service Desk.'),
      ),
      task(T('Смена пароля и завершение сеанса', 'Parolni almashtirish va seansni yakunlash', 'Changing the password and signing out'),
        T('Нажмите значок ключа в верхней панели, введите текущий и новый пароль дважды.', 'Yuqori paneldagi kalit belgisini bosing, joriy va yangi parolni ikki marta kiriting.', 'Click the key icon in the top bar and enter your current and new password twice.'),
        T('Для выхода нажмите значок «Выйти» справа вверху.', 'Chiqish uchun yuqori o‘ngdagi «Chiqish» belgisini bosing.', 'To sign out click the “Sign out” icon in the top right corner.'),
        T('При бездействии система предупредит за минуту и завершит сеанс автоматически.', 'Harakatsiz qolganda tizim bir daqiqa oldin ogohlantiradi va seansni avtomatik yakunlaydi.', 'After inactivity the system warns you a minute in advance and ends the session automatically.'),
      ),
    ],
    tips: [
      T('После трёх неверных попыток учётная запись блокируется на время, заданное политикой безопасности; разблокирует администратор.', 'Uch marta noto‘g‘ri urinishdan so‘ng hisob yozuvi xavfsizlik siyosatida belgilangan vaqtga bloklanadi; administrator blokdan chiqaradi.', 'After three failed attempts the account is locked for the period set in the security policy; an administrator can unlock it.'),
    ],
    related: ['start-2fa', 'start-languages', 'users'],
  },
  {
    id: 'start-2fa', kind: 'start',
    title: T('Двухфакторная аутентификация и подтверждение операций', 'Ikki bosqichli autentifikatsiya va amallarni tasdiqlash', 'Two-factor authentication and confirming operations'),
    summary: T(
      'Второй фактор (одноразовый код) нужен при каждом входе, а также для операций высокого риска: сброс матрицы и отзыв прав, политика безопасности, интеграции, синхронизация пользователей с AD, аварийный режим.',
      'Ikkinchi omil (bir martalik kod) har bir kirishda, shuningdek yuqori xavfli amallar uchun kerak: huquqlar matritsasini qaytarish va huquqlarni bekor qilish, xavfsizlik siyosati, integratsiyalar, foydalanuvchilarni AD bilan sinxronlash, avariya rejimi.',
      'The second factor (one-time code) is required at every sign-in and for high-risk operations: resetting the permission matrix and revoking rights, the security policy, integrations, AD user sync and emergency mode.',
    ),
    tasks: [
      task(T('Подтверждение операции кодом', 'Amalni kod bilan tasdiqlash', 'Confirming an operation with a code'),
        T('Нажмите кнопку действия (например, «Сохранить» в конструкторе интеграций).', 'Amal tugmasini bosing (masalan, integratsiyalar konstruktorida «Saqlash»).', 'Press the action button (e.g. “Save” in the integration designer).'),
        T('В окне «Подтверждение операции» введите новый одноразовый код.', '«Amalni tasdiqlash» oynasida yangi bir martalik kodni kiriting.', 'In the “Confirm operation” window enter the new one-time code.'),
        T('Нажмите «Подтвердить». Неверный код записывается в журнал аудита, операция не выполняется.', '«Tasdiqlash» tugmasini bosing. Noto‘g‘ri kod audit jurnaliga yoziladi, amal bajarilmaydi.', 'Press “Confirm”. A wrong code is written to the audit log and the operation is not performed.'),
      ),
    ],
    tips: [T('Код действует 5 минут. Если код не пришёл, нажмите «Отправить код повторно».', 'Kod 5 daqiqa amal qiladi. Kod kelmasa, «Kodni qayta yuborish» tugmasini bosing.', 'The code is valid for 5 minutes. If it did not arrive, press “Resend code”.')],
    related: ['start-login', 'security'],
  },
  {
    id: 'start-languages', kind: 'start',
    title: T('Языки интерфейса', 'Interfeys tillari', 'Interface languages'),
    summary: T(
      'Интерфейс, справочники, отчёты и эта справка доступны на русском, узбекском (латиница и кириллица) и английском. Один термин используется во всех модулях в одном значении (единый словарь).',
      'Interfeys, ma’lumotnomalar, hisobotlar va ushbu yordam rus, o‘zbek (lotin va kirill) va ingliz tillarida mavjud. Bitta atama barcha modullarda bir xil ma’noda ishlatiladi (yagona lug‘at).',
      'The interface, reference data, reports and this help are available in Russian, Uzbek (Latin and Cyrillic) and English. Each term has the same meaning across all modules (single dictionary).',
    ),
    tasks: [
      task(T('Переключение языка', 'Tilni almashtirish', 'Switching the language'),
        T('В верхней панели (или на экране входа) нажмите RU, O‘Z, ЎЗ или EN.', 'Yuqori panelda (yoki kirish ekranida) RU, O‘Z, ЎЗ yoki EN ni bosing.', 'In the top bar (or on the sign-in screen) press RU, O‘Z, ЎЗ or EN.'),
        T('Интерфейс переключается сразу, без перезагрузки; выбор запоминается.', 'Interfeys qayta yuklamasdan darhol almashadi; tanlov eslab qolinadi.', 'The interface switches immediately without reloading; the choice is remembered.'),
        T('Суммы, даты и числа форматируются по правилам выбранного языка.', 'Summalar, sanalar va raqamlar tanlangan til qoidalariga ko‘ra formatlanadi.', 'Amounts, dates and numbers are formatted according to the selected language.'),
      ),
    ],
    related: ['start-interface'],
  },
  {
    id: 'start-interface', kind: 'start',
    title: T('Интерфейс: меню, поиск, уведомления, справка', 'Interfeys: menyu, qidiruv, bildirishnomalar, yordam', 'Interface: menu, search, notifications, help'),
    summary: T(
      'Слева — меню модулей (видны только модули, к которым у вас есть доступ). Сверху — глобальный поиск, язык, уведомления, кнопка справки «?» и профиль.',
      'Chapda — modullar menyusi (faqat sizga ruxsat berilgan modullar ko‘rinadi). Yuqorida — global qidiruv, til, bildirishnomalar, «?» yordam tugmasi va profil.',
      'On the left is the module menu (only modules you can access are shown). At the top: global search, language, notifications, the “?” help button and your profile.',
    ),
    tasks: [
      task(T('Найти документ', 'Hujjatni topish', 'Finding a document'),
        T('Нажмите Ctrl+K или поле поиска в верхней панели.', 'Ctrl+K ni yoki yuqori paneldagi qidiruv maydonini bosing.', 'Press Ctrl+K or click the search field in the top bar.'),
        T('Введите номер, название или контрагента; результаты сгруппированы по модулям.', 'Raqam, nom yoki kontragentni kiriting; natijalar modullar bo‘yicha guruhlangan.', 'Type a number, title or counterparty; results are grouped by module.'),
        T('Выберите результат — откроется карточка документа.', 'Natijani tanlang — hujjat kartochkasi ochiladi.', 'Pick a result to open the document card.'),
      ),
      task(T('Открыть справку по текущему экрану', 'Joriy ekran bo‘yicha yordamni ochish', 'Opening help for the current screen'),
        T('Нажмите «?» в верхней панели — откроется статья по модулю, в котором вы находитесь.', 'Yuqori paneldagi «?» ni bosing — siz turgan modul bo‘yicha maqola ochiladi.', 'Press “?” in the top bar to open the article for the module you are in.'),
        T('Кнопка «Вернуться к модулю» возвращает на исходный экран; «Печать» выводит статью на A4.', '«Modulga qaytish» tugmasi dastlabki ekranga qaytaradi; «Chop etish» maqolani A4 ga chiqaradi.', '“Back to module” returns to the original screen; “Print” prints the article on A4.'),
      ),
      task(T('Сообщить о проблеме', 'Muammo haqida xabar berish', 'Reporting a problem'),
        T('Откройте «Service Desk» в меню или кнопку «Сообщить о проблеме» в справке.', 'Menyudagi «Service Desk» ni yoki yordamdagi «Muammo haqida xabar berish» tugmasini oching.', 'Open “Service Desk” in the menu or “Report a problem” in help.'),
        T('Заполните тип, приоритет, тему и описание и нажмите «Отправить» — заявка зарегистрируется в Service Desk банка.', 'Turi, ustuvorligi, mavzusi va tavsifini to‘ldiring va «Yuborish» ni bosing — ariza bank Service Desk ida ro‘yxatga olinadi.', 'Fill in type, priority, subject and description and press “Send” — the ticket is registered in the bank’s Service Desk.'),
      ),
    ],
    related: ['service-desk', 'notifications'],
  },

  // ---------------- Основное ----------------
  {
    id: 'dashboard', kind: 'module',
    summary: T('Главная страница: ваши задачи согласования, ключевые показатели (заявки в работе, действующие договоры, просроченные платежи), исполнение бюджета по статьям и последние заявки на закупку.', 'Bosh sahifa: kelishuv vazifalaringiz, asosiy ko‘rsatkichlar (ishdagi arizalar, amaldagi shartnomalar, muddati o‘tgan to‘lovlar), moddalar bo‘yicha byudjet ijrosi va so‘nggi xarid arizalari.', 'Home page: your approval tasks, key indicators (requests in progress, active contracts, overdue payments), budget execution by line and recent purchase requests.'),
    screens: [T('Показатели «Ждут вашего решения», «Заявки на закупку в работе», «Действующие договоры», «Просроченные платежи»', '«Qaroringizni kutmoqda», «Ishdagi xarid arizalari», «Amaldagi shartnomalar», «Muddati o‘tgan to‘lovlar» ko‘rsatkichlari', 'Indicators “Awaiting your decision”, “Purchase requests in progress”, “Active contracts”, “Overdue payments”'), T('Карточки «Мои задачи», «Бюджет по статьям», «Последние заявки на закупку»', '«Mening vazifalarim», «Moddalar bo‘yicha byudjet», «So‘nggi xarid arizalari» kartochkalari', 'Cards “My tasks”, “Budget by line”, “Recent purchase requests”')],
    tasks: [task(T('Перейти к задаче', 'Vazifaga o‘tish', 'Going to a task'), T('В карточке «Мои задачи» нажмите на документ.', '«Mening vazifalarim» kartochkasida hujjatni bosing.', 'In “My tasks” click the document.'), T('Откроется карточка документа с кнопками решения.', 'Qaror tugmalari bilan hujjat kartochkasi ochiladi.', 'The document card opens with decision buttons.'))],
    related: ['approvals'],
  },
  {
    id: 'approvals', kind: 'module',
    summary: T('Единая очередь согласований всех модулей: заявки, договоры, платежи, акты, командировки, бюджетные изменения, регламентные окна и другие документы. Маршрут строится движком согласований по шаблонам.', 'Barcha modullarning yagona kelishuv navbati: arizalar, shartnomalar, to‘lovlar, dalolatnomalar, xizmat safarlari, byudjet o‘zgarishlari, reglament oynalari va boshqa hujjatlar. Yo‘nalish kelishuv dvigateli tomonidan shablonlar bo‘yicha tuziladi.', 'A single approval queue for all modules: requests, contracts, payments, acts, trips, budget changes, maintenance windows and more. Routes are built by the approval engine from templates.'),
    screens: [T('«Согласования» — вкладки по типам документов с количеством задач', '«Kelishuvlar» — hujjat turlari bo‘yicha vazifalar soni bilan yorliqlar', '“Approvals” — tabs by document type with task counts'), T('«Заместители» — временная передача права согласования', '«O‘rinbosarlar» — kelishuv huquqini vaqtincha topshirish', '“Deputies” — temporary delegation of approval rights'), T('Ход маршрута в карточке документа (шаги, сроки, решения)', 'Hujjat kartochkasida yo‘nalish borishi (bosqichlar, muddatlar, qarorlar)', 'Route progress in the document card (steps, deadlines, decisions)')],
    tasks: [
      task(T('Согласовать, отклонить или вернуть документ', 'Hujjatni kelishish, rad etish yoki qaytarish', 'Approve, reject or return a document'),
        T('Откройте «Согласования» и выберите вкладку типа документа.', '«Kelishuvlar» ni oching va hujjat turi yorlig‘ini tanlang.', 'Open “Approvals” and choose the document-type tab.'),
        T('Нажмите «Открыть», чтобы проверить документ, или «Маршрут», чтобы увидеть шаги.', 'Hujjatni tekshirish uchun «Ochish» ni yoki bosqichlarni ko‘rish uchun «Yo‘nalish» ni bosing.', 'Press “Open” to check the document or “Route” to see the steps.'),
        T('Нажмите «Согласовать». Для «Отклонить» и «Вернуть на доработку» обязательно укажите причину.', '«Kelishish» ni bosing. «Rad etish» va «Qayta ishlashga qaytarish» uchun sababni ko‘rsatish shart.', 'Press “Approve”. “Reject” and “Return for rework” require a reason.'),
        T('Инициатор не может согласовать собственный документ; решение и время пишутся в историю.', 'Tashabbuskor o‘z hujjatini kelisha olmaydi; qaror va vaqt tarixga yoziladi.', 'The initiator cannot approve their own document; the decision and time go to the history.'),
      ),
      task(T('Назначить заместителя на время отпуска', 'Ta’til vaqtiga o‘rinbosar tayinlash', 'Assigning a deputy for leave'),
        T('Откройте «Согласования» → «Заместители».', '«Kelishuvlar» → «O‘rinbosarlar» ni oching.', 'Open “Approvals” → “Deputies”.'),
        T('Нажмите «Назначить заместителя», выберите сотрудника и период.', '«O‘rinbosar tayinlash» ni bosing, xodim va davrni tanlang.', 'Press “Assign deputy”, choose the employee and the period.'),
        T('В этот период задачи будут поступать заместителю с отметкой «за» вас.', 'Bu davrda vazifalar o‘rinbosarga siz «nomingizdan» belgisi bilan keladi.', 'During the period tasks go to the deputy marked “on behalf of” you.'),
      ),
    ],
    tips: [T('Сроки задач контролируются по SLA: при приближении срока и просрочке приходят уведомления, затем — эскалация руководителю.', 'Vazifa muddatlari SLA bo‘yicha nazorat qilinadi: muddat yaqinlashganda va o‘tganda bildirishnomalar keladi, so‘ng — rahbarga eskalatsiya.', 'Task deadlines follow the SLA: you are notified when a deadline approaches or passes, then the task is escalated to the manager.')],
    related: ['routes', 'notifications'],
  },
  {
    id: 'notifications', kind: 'module',
    summary: T('Центр уведомлений: новые задачи, возвраты, решения, сроки, эскалации и системные сообщения (регламентные работы, аварийный режим, статусы обращений в Service Desk).', 'Bildirishnomalar markazi: yangi vazifalar, qaytarishlar, qarorlar, muddatlar, eskalatsiyalar va tizim xabarlari (reglament ishlari, avariya rejimi, Service Desk murojaatlari holati).', 'Notification centre: new tasks, returns, decisions, deadlines, escalations and system messages (maintenance, emergency mode, Service Desk ticket status).'),
    screens: [T('Вкладки «Все» и «Непрочитанные»', '«Hammasi» va «O‘qilmagan» yorliqlari', 'Tabs “All” and “Unread”'), T('«Настройки уведомлений» — какие события присылать в приложение и на почту', '«Bildirishnoma sozlamalari» — qaysi hodisalar ilovaga va pochtaga yuborilishi', '“Notification settings” — which events to deliver in-app and by e-mail'), T('«Письма (демо-почта)» — отправленные письма', '«Xatlar (demo-pochta)» — yuborilgan xatlar', '“E-mails (demo mailbox)” — sent e-mails')],
    tasks: [task(T('Настроить уведомления', 'Bildirishnomalarni sozlash', 'Configuring notifications'), T('Откройте колокольчик → «Все уведомления» или пункт меню «Уведомления».', 'Qo‘ng‘iroqcha → «Barcha bildirishnomalar» yoki «Bildirishnomalar» menyu bandini oching.', 'Open the bell → “All notifications” or the “Notifications” menu item.'), T('В карточке «Настройки уведомлений» отметьте нужные события для приложения и почты.', '«Bildirishnoma sozlamalari» kartochkasida ilova va pochta uchun kerakli hodisalarni belgilang.', 'In “Notification settings” tick the events for in-app and e-mail.'), T('Нажмите «Отметить все прочитанными», чтобы очистить счётчик.', 'Hisoblagichni tozalash uchun «Barchasini o‘qilgan deb belgilash» ni bosing.', 'Press “Mark all as read” to clear the counter.'))],
  },
  {
    id: 'ai', kind: 'module',
    summary: T('ИИ-ассистент работает внутри периметра банка: отвечает на вопросы по данным системы, распознаёт документы и проверяет договоры. Все запросы журналируются.', 'AI yordamchi bank perimetri ichida ishlaydi: tizim ma’lumotlari bo‘yicha savollarga javob beradi, hujjatlarni taniydi va shartnomalarni tekshiradi. Barcha so‘rovlar jurnalga yoziladi.', 'The AI assistant runs inside the bank perimeter: it answers questions about system data, recognises documents and checks contracts. All requests are logged.'),
    screens: [T('«Ассистент» — диалог', '«Yordamchi» — muloqot', '“Assistant” — chat'), T('«Распознавание документов»', '«Hujjatlarni tanib olish»', '“Document recognition”'), T('«Проверка договоров»', '«Shartnomalarni tekshirish»', '“Contract check”'), T('«Журнал запросов»', '«So‘rovlar jurnali»', '“Request log”')],
    tasks: [task(T('Задать вопрос ассистенту', 'Yordamchiga savol berish', 'Asking the assistant'), T('Откройте вкладку «Ассистент» и введите вопрос (например, об исполнении бюджета).', '«Yordamchi» yorlig‘ini oching va savolni kiriting (masalan, byudjet ijrosi haqida).', 'Open the “Assistant” tab and type a question (e.g. about budget execution).'), T('Ответ строится по данным, к которым у вас есть доступ; источник указан в ответе.', 'Javob sizga ruxsat berilgan ma’lumotlar asosida tuziladi; manba javobda ko‘rsatiladi.', 'The answer uses only data you can access; the source is shown.'), T('Ответ ассистента — подсказка: решения принимает сотрудник.', 'Yordamchi javobi — maslahat: qarorni xodim qabul qiladi.', 'The assistant’s answer is advice: decisions are made by the employee.'))],
  },
  {
    id: 'master-data', kind: 'module',
    summary: T('Справочники (MDM): контрагенты, подразделения и филиалы, МВЗ, группы расходов, классификаторы, статьи бюджета, пользователи. Изменения ключевых справочников проходят через заявки на изменение и контроль качества данных.', 'Ma’lumotnomalar (MDM): kontragentlar, bo‘linmalar va filiallar, XJM, xarajat guruhlari, klassifikatorlar, byudjet moddalari, foydalanuvchilar. Asosiy ma’lumotnomalardagi o‘zgarishlar o‘zgartirish arizalari va ma’lumotlar sifati nazorati orqali o‘tadi.', 'Master data (MDM): counterparties, units and branches, cost centres, expense groups, classifiers, budget lines and users. Changes to key reference data go through change requests and data-quality checks.'),
    screens: [T('Вкладки «Контрагенты», «Подразделения и филиалы», «МВЗ», «Группы расходов», «Заявки на изменение», «Качество данных», «Классификаторы», «Статьи бюджета», «Пользователи»', '«Kontragentlar», «Bo‘linmalar va filiallar», «XJM», «Xarajat guruhlari», «O‘zgartirish arizalari», «Ma’lumotlar sifati», «Klassifikatorlar», «Byudjet moddalari», «Foydalanuvchilar» yorliqlari', 'Tabs “Counterparties”, “Units and branches”, “Cost centres”, “Expense groups”, “Change requests”, “Data quality”, “Classifiers”, “Budget lines”, “Users”')],
    tasks: [
      task(T('Добавить контрагента', 'Kontragent qo‘shish', 'Adding a counterparty'), T('Откройте вкладку «Контрагенты» и нажмите «Добавить контрагента».', '«Kontragentlar» yorlig‘ini oching va «Kontragent qo‘shish» ni bosing.', 'Open “Counterparties” and press “Add counterparty”.'), T('Укажите ИНН (9 цифр), наименование, тип и контакты; дубликат по ИНН не сохранится.', 'STIR (9 raqam), nom, tur va kontaktlarni ko‘rsating; STIR bo‘yicha dublikat saqlanmaydi.', 'Enter the TIN (9 digits), name, type and contacts; a TIN duplicate is not saved.'), T('Сохраните — запись появится в реестре и в поиске.', 'Saqlang — yozuv reestrda va qidiruvda paydo bo‘ladi.', 'Save — the record appears in the register and in search.')),
      task(T('Изменить МВЗ или оргединицу', 'XJM yoki tashkiliy birlikni o‘zgartirish', 'Changing a cost centre or org unit'), T('Откройте карточку МВЗ или оргединицы и нажмите «Изменить».', 'XJM yoki tashkiliy birlik kartochkasini oching va «O‘zgartirish» ni bosing.', 'Open the cost-centre or org-unit card and press “Change”.'), T('Укажите новые значения, дату «Действует с», основание и нажмите «Отправить на утверждение».', 'Yangi qiymatlar, «Amal qiladi» sanasi, asosni ko‘rsating va «Tasdiqlashga yuborish» ni bosing.', 'Enter the new values, the “Effective from” date and the reason, then press “Submit for approval”.'), T('Другой сотрудник на вкладке «Заявки на изменение» нажимает «Утвердить и применить» — создаётся новая версия записи, история сохраняется.', 'Boshqa xodim «O‘zgartirish arizalari» yorlig‘ida «Tasdiqlash va qo‘llash» ni bosadi — yozuvning yangi versiyasi yaratiladi, tarix saqlanadi.', 'Another employee presses “Approve and apply” on “Change requests” — a new version of the record is created and history is kept.')),
    ],
    related: ['import'],
  },

  // ---------------- Закупки и договоры ----------------
  {
    id: 'procurement', kind: 'module',
    summary: T('Закупки и тендеры: заявки на закупку с согласованием, сводные заявки, тендеры, биржевые закупки (УзРТСБ), приёмка, реестр поставщиков, номенклатура и мониторинг.', 'Xaridlar va tenderlar: kelishuvli xarid arizalari, yig‘ma arizalar, tenderlar, birja xaridlari (O‘zRTXB), qabul qilish, yetkazib beruvchilar reestri, nomenklatura va monitoring.', 'Procurement and tenders: purchase requests with approval, consolidated requests, tenders, exchange purchases (UzRTSB), acceptance, supplier register, catalogue and monitoring.'),
    screens: [T('Вкладки «Заявки на закупку», «Сводные заявки», «Тендеры», «Биржа», «Приёмка», «Поставщики», «Номенклатура», «Мониторинг»', '«Xarid arizalari», «Yig‘ma arizalar», «Tenderlar», «Birja», «Qabul qilish», «Yetkazib beruvchilar», «Nomenklatura», «Monitoring» yorliqlari', 'Tabs “Purchase requests”, “Consolidated”, “Tenders”, “Exchange”, “Acceptance”, “Suppliers”, “Catalogue”, “Monitoring”'), T('Карточка заявки: позиции, бюджет, маршрут согласования, история', 'Ariza kartochkasi: pozitsiyalar, byudjet, kelishuv yo‘nalishi, tarix', 'Request card: items, budget, approval route, history')],
    tasks: [
      task(T('Создать и отправить заявку на закупку', 'Xarid arizasini yaratish va yuborish', 'Creating and submitting a purchase request'),
        T('Нажмите «Новая заявка».', '«Yangi ariza» ni bosing.', 'Press “New request”.'),
        T('Заполните название, статью бюджета, способ закупки и позиции (наименование, количество, цена).', 'Nom, byudjet moddasi, xarid usuli va pozitsiyalarni (nomi, miqdori, narxi) to‘ldiring.', 'Fill in the title, budget line, procurement method and items (name, quantity, price).'),
        T('Проверьте маршрут согласования внизу формы и нажмите «Отправить на согласование» (или «Сохранить черновик»).', 'Shakl pastidagi kelishuv yo‘nalishini tekshiring va «Kelishuvga yuborish» (yoki «Qoralamani saqlash») ni bosing.', 'Check the approval route at the bottom and press “Submit for approval” (or “Save draft”).'),
        T('Заявка проходит руководителя, финансы и отдел закупок; статус виден в реестре.', 'Ariza rahbar, moliya va xaridlar bo‘limidan o‘tadi; holat reestrda ko‘rinadi.', 'The request goes through the manager, finance and procurement; the status is shown in the register.'),
      ),
      task(T('Провести тендер и заключить договор', 'Tender o‘tkazish va shartnoma tuzish', 'Running a tender and signing a contract'),
        T('В согласованной заявке нажмите «Объявить тендер».', 'Kelishilgan arizada «Tender e’lon qilish» ni bosing.', 'In an approved request press “Announce tender”.'),
        T('На вкладке «Тендеры» сравните предложения и нажмите «Выбрать победителем».', '«Tenderlar» yorlig‘ida takliflarni solishtiring va «G‘olib deb tanlash» ni bosing.', 'On “Tenders” compare bids and press “Choose winner”.'),
        T('Нажмите «Заключить договор» — договор создаётся в модуле «Договоры» и уходит на согласование.', '«Shartnoma tuzish» ni bosing — shartnoma «Shartnomalar» modulida yaratiladi va kelishuvga yuboriladi.', 'Press “Create contract” — the contract is created in “Contracts” and sent for approval.'),
      ),
    ],
    related: ['contracts', 'approvals'],
  },
  {
    id: 'contracts', kind: 'module',
    summary: T('Договоры: реестр, согласование, этапы и платежи, мониторинг исполнения, электронные договоры с подписью E-IMZO, отчёты и резервы.', 'Shartnomalar: reestr, kelishuv, bosqichlar va to‘lovlar, ijro monitoringi, E-IMZO imzoli elektron shartnomalar, hisobotlar va zaxiralar.', 'Contracts: register, approval, stages and payments, execution monitoring, e-contracts signed with E-IMZO, reports and reserves.'),
    screens: [T('Вкладки «Договоры», «Дашборд», «Мониторинг исполнения», «Табло: оплата к 25-му», «Платежи», «Электронные договоры», «Отчёты», «Резервы», «Подразделения», «Настройки»', '«Shartnomalar», «Dashbord», «Ijro monitoringi», «Tablo: 25-gacha to‘lov», «To‘lovlar», «Elektron shartnomalar», «Hisobotlar», «Zaxiralar», «Bo‘linmalar», «Sozlamalar» yorliqlari', 'Tabs “Contracts”, “Dashboard”, “Execution monitoring”, “Board: payment by the 25th”, “Payments”, “E-contracts”, “Reports”, “Reserves”, “Units”, “Settings”')],
    tasks: [
      task(T('Зарегистрировать договор', 'Shartnomani ro‘yxatdan o‘tkazish', 'Registering a contract'), T('Нажмите «Новый договор».', '«Yangi shartnoma» ni bosing.', 'Press “New contract”.'), T('Укажите контрагента, сумму, валюту, сроки и график платежей.', 'Kontragent, summa, valyuta, muddatlar va to‘lov jadvalini ko‘rsating.', 'Enter the counterparty, amount, currency, dates and payment schedule.'), T('Отправьте на согласование: юрист → финансы.', 'Kelishuvga yuboring: yurist → moliya.', 'Submit for approval: legal → finance.')),
      task(T('Отметить оплату по договору', 'Shartnoma bo‘yicha to‘lovni belgilash', 'Recording a contract payment'), T('Откройте карточку договора.', 'Shartnoma kartochkasini oching.', 'Open the contract card.'), T('В графике платежей нажмите «Отметить оплату» (платёж может требовать согласования казначейства).', 'To‘lov jadvalida «To‘lovni belgilash» ni bosing (to‘lov g‘aznachilik kelishuvini talab qilishi mumkin).', 'In the payment schedule press “Mark as paid” (a payment may require treasury approval).'), T('Исполнение бюджета на главной обновится автоматически.', 'Bosh sahifadagi byudjet ijrosi avtomatik yangilanadi.', 'Budget execution on the home page updates automatically.')),
    ],
    related: ['procurement', 'einvoices'],
  },
  {
    id: 'einvoices', kind: 'module',
    summary: T('Электронные счета-фактуры, акты выполненных работ и акты сверки через API Налогового комитета: приём входящих, решение (принять/отклонить), оформление исходящих, отчёты и контроль сроков.', 'Soliq qo‘mitasi API orqali elektron hisob-fakturalar, bajarilgan ishlar dalolatnomalari va solishtirma dalolatnomalar: kiruvchilarni qabul qilish, qaror (qabul/rad), chiquvchilarni rasmiylashtirish, hisobotlar va muddatlar nazorati.', 'E-invoices, work-completion acts and reconciliation acts via the Tax Committee API: receiving incoming documents, deciding (accept/reject), issuing outgoing documents, reports and deadline control.'),
    screens: [T('Вкладки «Входящие», «Исходящие», «Мне на решение»', '«Kiruvchi», «Chiquvchi», «Mening qarorimga» yorliqlari', 'Tabs “Incoming”, “Outgoing”, “For my decision”'), T('«Отчёты и дашборд исполнения» — сроки 1–5, 6–8, 9–10 день, нарушенные', '«Hisobotlar va ijro dashbordi» — 1–5, 6–8, 9–10 kun muddatlari, buzilganlar', '“Reports and execution dashboard” — days 1–5, 6–8, 9–10 and overdue')],
    tasks: [
      task(T('Получить и принять входящий счёт-фактуру', 'Kiruvchi hisob-fakturani olish va qabul qilish', 'Receiving and accepting an incoming e-invoice'), T('Нажмите «Получить из Налогового комитета».', '«Soliq qo‘mitasidan olish» ni bosing.', 'Press “Fetch from Tax Committee”.'), T('Откройте документ на вкладке «Входящие» и проверьте сумму и НДС.', '«Kiruvchi» yorlig‘ida hujjatni oching, summa va QQS ni tekshiring.', 'Open the document on “Incoming” and check the amount and VAT.'), T('Подпишите (E-IMZO) для принятия или нажмите «Отклонить» с причиной.', 'Qabul qilish uchun imzolang (E-IMZO) yoki sabab bilan «Rad etish» ni bosing.', 'Sign (E-IMZO) to accept or press “Reject” with a reason.')),
      task(T('Оформить исходящий документ', 'Chiquvchi hujjatni rasmiylashtirish', 'Issuing an outgoing document'), T('Нажмите «Новый исходящий документ».', '«Yangi chiquvchi hujjat» ni bosing.', 'Press “New outgoing document”.'), T('Заполните покупателя (ИНН), позиции и ставку НДС.', 'Xaridor (STIR), pozitsiyalar va QQS stavkasini to‘ldiring.', 'Fill in the buyer (TIN), items and VAT rate.'), T('Подпишите и отправьте — статус доставки виден в реестре и в журнале интеграций.', 'Imzolang va yuboring — yetkazish holati reestrda va integratsiyalar jurnalida ko‘rinadi.', 'Sign and send — delivery status is shown in the register and in the integration log.')),
    ],
    related: ['taxes', 'integrations'],
  },

  // ---------------- Операции ----------------
  {
    id: 'warehouse', kind: 'module',
    summary: T('Складской учёт ТМЗ и МБП: остатки, карточки, поступления, выдача по заявкам, списание, партии FIFO, инвентаризация, журнал движений, бухгалтерские проводки, мониторинг и отчёты.', 'TMZ va MBP ombor hisobi: qoldiqlar, kartochkalar, kirimlar, arizalar bo‘yicha berish, hisobdan chiqarish, FIFO partiyalari, inventarizatsiya, harakatlar jurnali, buxgalteriya o‘tkazmalari, monitoring va hisobotlar.', 'Warehouse accounting of inventory and low-value items: balances, cards, receipts, issues by request, write-offs, FIFO batches, stock-taking, movement log, accounting entries, monitoring and reports.'),
    screens: [T('Вкладки «Обзор», «Остатки», «Карточки», «Поступления», «Выдача», «Списание», «Партии (FIFO)», «Инвентаризация», «Учёт МБП», «Журнал движений», «Проводки», «Мониторинг», «Отчёты», «Склады»', '«Umumiy», «Qoldiqlar», «Kartochkalar», «Kirimlar», «Berish», «Hisobdan chiqarish», «Partiyalar (FIFO)», «Inventarizatsiya», «MBP hisobi», «Harakatlar jurnali», «O‘tkazmalar», «Monitoring», «Hisobotlar», «Omborlar» yorliqlari', 'Tabs “Overview”, “Balances”, “Cards”, “Receipts”, “Issues”, “Write-offs”, “Batches (FIFO)”, “Stock-taking”, “Low-value items”, “Movement log”, “Entries”, “Monitoring”, “Reports”, “Warehouses”')],
    tasks: [
      task(T('Оприходовать поступление', 'Kirimni kirim qilish', 'Posting a receipt'), T('Нажмите «Поступление».', '«Kirim» ni bosing.', 'Press “Receipt”.'), T('Выберите поставщика/договор, склад и позиции с количеством и ценой.', 'Yetkazib beruvchi/shartnoma, ombor va miqdor hamda narxli pozitsiyalarni tanlang.', 'Choose the supplier/contract, warehouse and items with quantity and price.'), T('Проведите документ — остатки и проводки обновятся.', 'Hujjatni o‘tkazing — qoldiqlar va o‘tkazmalar yangilanadi.', 'Post the document — balances and entries update.')),
      task(T('Выдать ТМЦ по заявке', 'Ariza bo‘yicha TMB berish', 'Issuing items by request'), T('Нажмите «Заявка на выдачу», укажите подразделение и позиции.', '«Berish arizasi» ni bosing, bo‘linma va pozitsiyalarni ko‘rsating.', 'Press “Issue request”, choose the unit and items.'), T('Заявка согласуется руководителем ЦБУ.', 'Ariza BXM rahbari tomonidan kelishiladi.', 'The request is approved by the branch head.'), T('Кладовщик выдаёт по FIFO; движение попадает в журнал.', 'Omborchi FIFO bo‘yicha beradi; harakat jurnalga tushadi.', 'The storekeeper issues by FIFO; the movement is logged.')),
    ],
    related: ['procurement', 'assets'],
  },
  {
    id: 'assets', kind: 'module',
    summary: T('Основные средства и НМА (включая ИТ-активы): реестр, операции (передача, модернизация), списание по акту ОС-4, амортизация, инвентаризация, мониторинг и отчёты.', 'Asosiy vositalar va NMA (shu jumladan AT aktivlari): reestr, operatsiyalar (topshirish, modernizatsiya), AV-4 dalolatnomasi bo‘yicha hisobdan chiqarish, amortizatsiya, inventarizatsiya, monitoring va hisobotlar.', 'Fixed and intangible assets (including IT assets): register, operations (transfer, upgrade), write-off by act OS-4, depreciation, stock-taking, monitoring and reports.'),
    screens: [T('Вкладки «Реестр ОС», «Обзор», «Операции», «Списание (ОС-4)», «Амортизация», «Инвентаризация», «Мониторинг», «Отчёты», «Группы и правила»', '«AV reestri», «Umumiy», «Operatsiyalar», «Hisobdan chiqarish (AV-4)», «Amortizatsiya», «Inventarizatsiya», «Monitoring», «Hisobotlar», «Guruhlar va qoidalar» yorliqlari', 'Tabs “Asset register”, “Overview”, “Operations”, “Write-off (OS-4)”, “Depreciation”, “Stock-taking”, “Monitoring”, “Reports”, “Groups and rules”')],
    tasks: [
      task(T('Поставить ОС на учёт', 'AV ni hisobga qo‘yish', 'Registering an asset'), T('Нажмите «Поставить на учёт».', '«Hisobga qo‘yish» ni bosing.', 'Press “Register asset”.'), T('Укажите группу, стоимость, дату ввода, МОЛ и место нахождения.', 'Guruh, qiymat, foydalanishga topshirish sanasi, MJS va joylashuvni ko‘rsating.', 'Enter the group, cost, commissioning date, custodian and location.'), T('Сохраните — инвентарный номер и график амортизации рассчитываются автоматически.', 'Saqlang — inventar raqami va amortizatsiya jadvali avtomatik hisoblanadi.', 'Save — the inventory number and depreciation schedule are calculated automatically.')),
      task(T('Начислить амортизацию', 'Amortizatsiya hisoblash', 'Charging depreciation'), T('Нажмите «Начислить амортизацию» и выберите период.', '«Amortizatsiya hisoblash» ni bosing va davrni tanlang.', 'Press “Charge depreciation” and select the period.'), T('Проверьте суммы по группам на вкладке «Амортизация».', '«Amortizatsiya» yorlig‘ida guruhlar bo‘yicha summalarni tekshiring.', 'Check the totals by group on “Depreciation”.')),
    ],
    related: ['warehouse'],
  },
  {
    id: 'fleet', kind: 'module',
    summary: T('Автопарк: транспорт и генераторы, водители, путевые листы, расходы, топливные карты, закрепления ТС, проводки, отчёты и предупреждения о ТО и документах.', 'Avtopark: transport va generatorlar, haydovchilar, yo‘l varaqalari, xarajatlar, yoqilg‘i kartalari, TV biriktirish, o‘tkazmalar, hisobotlar va TX hamda hujjatlar bo‘yicha ogohlantirishlar.', 'Fleet: vehicles and generators, drivers, waybills, expenses, fuel cards, vehicle assignments, entries, reports and alerts on maintenance and documents.'),
    screens: [T('Вкладки «Обзор», «Транспорт», «Водители», «Путевые листы», «Расходы», «Топливные карты», «Закрепления», «Проводки», «Отчёты», «Предупреждения»', '«Umumiy», «Transport», «Haydovchilar», «Yo‘l varaqalari», «Xarajatlar», «Yoqilg‘i kartalari», «Biriktirishlar», «O‘tkazmalar», «Hisobotlar», «Ogohlantirishlar» yorliqlari', 'Tabs “Overview”, “Vehicles”, “Drivers”, “Waybills”, “Expenses”, “Fuel cards”, “Assignments”, “Entries”, “Reports”, “Alerts”')],
    tasks: [task(T('Открыть и закрыть путевой лист', 'Yo‘l varaqasini ochish va yopish', 'Opening and closing a waybill'), T('Нажмите «Открыть путевой лист», выберите ТС, водителя и маршрут.', '«Yo‘l varaqasini ochish» ni bosing, TV, haydovchi va marshrutni tanlang.', 'Press “Open waybill”, choose the vehicle, driver and route.'), T('Путевой лист подписывает диспетчер (согласование).', 'Yo‘l varaqasini dispetcher imzolaydi (kelishuv).', 'The dispatcher signs the waybill (approval).'), T('По возвращении внесите пробег и топливо и закройте лист — расход рассчитается по норме.', 'Qaytgach, yurilgan masofa va yoqilg‘ini kiriting va varaqani yoping — sarf me’yor bo‘yicha hisoblanadi.', 'On return enter mileage and fuel and close the waybill — consumption is calculated by norm.'))],
  },
  {
    id: 'terminals', kind: 'module',
    summary: T('Терминалы (банкоматы, инфокиоски) как основные средства: реестр устройств, заявки на обслуживание, синхронизация с iABS «Учёт терминалов», модели и правила.', 'Terminallar (bankomatlar, infokiosklar) asosiy vosita sifatida: qurilmalar reestri, xizmat ko‘rsatish arizalari, iABS «Terminallar hisobi» bilan sinxronlash, modellar va qoidalar.', 'Terminals (ATMs, kiosks) as fixed assets: device register, service requests, sync with iABS “Terminal accounting”, models and rules.'),
    screens: [T('Вкладки «Устройства», «Заявки на обслуживание», «Синхронизация iABS», «Модели и правила iABS»', '«Qurilmalar», «Xizmat arizalari», «iABS sinxronlash», «iABS modellari va qoidalari» yorliqlari', 'Tabs “Devices”, “Service requests”, “iABS sync”, “iABS models and rules”')],
    tasks: [task(T('Создать заявку на обслуживание терминала', 'Terminalga xizmat ko‘rsatish arizasini yaratish', 'Creating a terminal service request'), T('Нажмите «Новая заявка».', '«Yangi ariza» ni bosing.', 'Press “New request”.'), T('Выберите устройство, тип неисправности и приоритет.', 'Qurilma, nosozlik turi va ustuvorlikni tanlang.', 'Choose the device, fault type and priority.'), T('Отслеживайте статус на вкладке «Заявки на обслуживание».', '«Xizmat arizalari» yorlig‘ida holatni kuzating.', 'Track the status on “Service requests”.'))],
  },
  {
    id: 'cash', kind: 'module',
    summary: T('Касса и инкассация: остатки и лимиты наличности по подразделениям, заявки на подкрепление/вывоз, инкассация, доходы и себестоимость кассового обслуживания; «Экономика НДО» — полный контур себестоимости и P&L.', 'Kassa va inkassatsiya: bo‘linmalar bo‘yicha naqd pul qoldiqlari va limitlari, mustahkamlash/olib chiqish arizalari, inkassatsiya, kassa xizmati daromadlari va tannarxi; «NPA iqtisodiyoti» — tannarx va P&L ning to‘liq konturi.', 'Cash and collection: cash balances and limits by unit, replenishment/withdrawal requests, collection, income and cost of cash services; “Cash economics” — full cost and P&L contour.'),
    screens: [T('Вкладки «Остатки и лимиты», «Заявки», «Инкассация», «Доходы и себестоимость»', '«Qoldiqlar va limitlar», «Arizalar», «Inkassatsiya», «Daromad va tannarx» yorliqlari', 'Tabs “Balances and limits”, “Requests”, “Collection”, “Income and cost”'), T('«Экономика НДО»: объекты, данные и загрузки, бюджет, аллокация, себестоимость и P&L, тарифы, качество и закрытие периода', '«NPA iqtisodiyoti»: obyektlar, ma’lumotlar va yuklashlar, byudjet, taqsimlash, tannarx va P&L, tariflar, sifat va davrni yopish', '“Cash economics”: objects, data and loads, budget, allocation, cost and P&L, tariffs, quality and period close')],
    tasks: [task(T('Создать заявку на подкрепление наличностью', 'Naqd pul bilan mustahkamlash arizasini yaratish', 'Creating a cash replenishment request'), T('Нажмите «Новая заявка».', '«Yangi ariza» ni bosing.', 'Press “New request”.'), T('Выберите подразделение, валюту и сумму; система покажет остаток и лимит.', 'Bo‘linma, valyuta va summani tanlang; tizim qoldiq va limitni ko‘rsatadi.', 'Choose the unit, currency and amount; the system shows the balance and limit.'), T('После согласования заявка попадает в план инкассации.', 'Kelishuvdan so‘ng ariza inkassatsiya rejasiga tushadi.', 'After approval the request goes into the collection plan.'))],
  },

  // ---------------- Документы и персонал ----------------
  {
    id: 'documents', kind: 'module',
    summary: T('Документооборот: регистрация входящих, исходящих и внутренних документов, резолюции и поручения, контроль исполнения, согласование, исполнительская дисциплина и сводная папка АУР.', 'Hujjat aylanishi: kiruvchi, chiquvchi va ichki hujjatlarni ro‘yxatga olish, rezolyutsiyalar va topshiriqlar, ijro nazorati, kelishuv, ijro intizomi va BBA yig‘ma papkasi.', 'Document management: registering incoming, outgoing and internal documents, resolutions and assignments, execution control, approval, execution discipline and the management summary folder.'),
    screens: [T('Вкладки «Все», «Входящие», «Исходящие», «Внутренние», «Мои на исполнении»', '«Hammasi», «Kiruvchi», «Chiquvchi», «Ichki», «Mening ijroimda» yorliqlari', 'Tabs “All”, “Incoming”, “Outgoing”, “Internal”, “Assigned to me”'), T('«Исполнительская дисциплина», «Сводная папка АУР», «Загрузить письма»', '«Ijro intizomi», «BBA yig‘ma papkasi», «Xatlarni yuklash»', '“Execution discipline”, “Management folder”, “Upload letters”')],
    tasks: [
      task(T('Зарегистрировать документ', 'Hujjatni ro‘yxatdan o‘tkazish', 'Registering a document'), T('Нажмите «Зарегистрировать документ».', '«Hujjatni ro‘yxatdan o‘tkazish» ni bosing.', 'Press “Register document”.'), T('Выберите вид (входящий/исходящий/внутренний), корреспондента, тему, срок и приложите файл.', 'Turini (kiruvchi/chiquvchi/ichki), korrespondent, mavzu, muddatni tanlang va faylni biriktiring.', 'Choose the type (incoming/outgoing/internal), correspondent, subject, deadline and attach the file.'), T('Сохраните — присвоится регистрационный номер.', 'Saqlang — ro‘yxat raqami beriladi.', 'Save — a registration number is assigned.')),
      task(T('Исполнить поручение', 'Topshiriqni ijro etish', 'Executing an assignment'), T('Откройте вкладку «Мои на исполнении» и документ.', '«Mening ijroimda» yorlig‘ini va hujjatni oching.', 'Open “Assigned to me” and the document.'), T('Примите документ в течение 24 часов, подготовьте ответ.', 'Hujjatni 24 soat ichida qabul qiling, javob tayyorlang.', 'Accept the document within 24 hours and prepare a reply.'), T('Отметьте исполнение — контроль снимется, статус станет «Исполнен».', 'Ijroni belgilang — nazorat olib tashlanadi, holat «Ijro etilgan» bo‘ladi.', 'Mark as executed — control is removed and the status becomes “Executed”.')),
    ],
    related: ['archive'],
  },
  {
    id: 'archive', kind: 'module',
    summary: T('Архив (ARXIV 360): формирование и сдача дел по номенклатуре, приём документов, поиск, выдача дел и контроль возврата, сроки хранения, акты уничтожения и передачи в госархив.', 'Arxiv (ARXIV 360): nomenklatura bo‘yicha ishlarni shakllantirish va topshirish, hujjatlarni qabul qilish, qidiruv, ishlarni berish va qaytarishni nazorat qilish, saqlash muddatlari, yo‘q qilish va davlat arxiviga topshirish dalolatnomalari.', 'Archive (ARXIV 360): forming and handing over files by nomenclature, receiving documents, search, issuing files and return control, retention periods, destruction and state-archive transfer acts.'),
    screens: [T('Вкладки «Дела», «Формирование и сдача», «Приём документов», «Поиск документов», «Выдача дел», «Акты», «Номенклатура», «Отчёты»', '«Ishlar», «Shakllantirish va topshirish», «Hujjatlarni qabul qilish», «Hujjatlarni qidirish», «Ishlarni berish», «Dalolatnomalar», «Nomenklatura», «Hisobotlar» yorliqlari', 'Tabs “Files”, “Forming and handover”, “Document intake”, “Document search”, “File issue”, “Acts”, “Nomenclature”, “Reports”')],
    tasks: [task(T('Выдать дело и проконтролировать возврат', 'Ishni berish va qaytarilishini nazorat qilish', 'Issuing a file and controlling its return'), T('На вкладке «Выдача дел» создайте выдачу: дело, получатель, срок возврата.', '«Ishlarni berish» yorlig‘ida berishni yarating: ish, oluvchi, qaytarish muddati.', 'On “File issue” create an issue: file, recipient, return date.'), T('При возврате отметьте «Возвращено»; просроченные возвраты видны в показателях.', 'Qaytarilganda «Qaytarildi» ni belgilang; muddati o‘tganlar ko‘rsatkichlarda ko‘rinadi.', 'On return mark “Returned”; overdue returns appear in the indicators.'))],
    related: ['documents'],
  },
  {
    id: 'requests', kind: 'module',
    summary: T('Заявки сотрудников на обеспечение материалами, оборудованием и услугами: создание, согласование руководителем, исполнение снабжением или складом.', 'Xodimlarning materiallar, uskunalar va xizmatlar bilan ta’minlash arizalari: yaratish, rahbar kelishuvi, ta’minot yoki ombor tomonidan ijro.', 'Employee requests for materials, equipment and services: creation, manager approval, fulfilment by supply or the warehouse.'),
    screens: [T('Реестр заявок с фильтрами и статусами', 'Filtr va holatlar bilan arizalar reestri', 'Request register with filters and statuses'), T('Карточка заявки: позиции, маршрут, история', 'Ariza kartochkasi: pozitsiyalar, yo‘nalish, tarix', 'Request card: items, route, history')],
    tasks: [task(T('Подать заявку', 'Ariza berish', 'Submitting a request'), T('Нажмите «Новая заявка».', '«Yangi ariza» ni bosing.', 'Press “New request”.'), T('Выберите категорию, опишите потребность, укажите количество и срок.', 'Toifani tanlang, ehtiyojni tavsiflang, miqdor va muddatni ko‘rsating.', 'Choose a category, describe the need, enter quantity and date.'), T('Отправьте на согласование — руководитель получит задачу, вы — уведомление о решении.', 'Kelishuvga yuboring — rahbar vazifa oladi, siz esa qaror haqida bildirishnoma olasiz.', 'Submit for approval — your manager gets a task and you get notified of the decision.'))],
  },
  {
    id: 'trips', kind: 'module',
    summary: T('Командировки: заявление → руководитель → HR → финансы, приказ, аванс, авансовый отчёт, нормы и лимиты, отчёты.', 'Xizmat safarlari: ariza → rahbar → HR → moliya, buyruq, bo‘nak, bo‘nak hisoboti, me’yor va limitlar, hisobotlar.', 'Business trips: application → manager → HR → finance, order, advance, expense report, norms and limits, reports.'),
    screens: [T('Реестр командировок и показатели «Сейчас в командировке», «На согласовании», «Авансы за месяц», «Ждут авансового отчёта»', 'Safarlar reestri va «Hozir safarda», «Kelishuvda», «Oylik bo‘naklar», «Bo‘nak hisobotini kutmoqda» ko‘rsatkichlari', 'Trip register and indicators “On a trip now”, “In approval”, “Advances this month”, “Awaiting expense report”'), T('«Нормы и лимиты», «Отчёты»', '«Me’yor va limitlar», «Hisobotlar»', '“Norms and limits”, “Reports”')],
    tasks: [
      task(T('Оформить командировку', 'Xizmat safarini rasmiylashtirish', 'Arranging a trip'), T('Нажмите «Новая командировка».', '«Yangi xizmat safari» ni bosing.', 'Press “New business trip”.'), T('Укажите город, даты, цель и расходы — суточные считаются по нормам.', 'Shahar, sanalar, maqsad va xarajatlarni ko‘rsating — sutkaliklar me’yor bo‘yicha hisoblanadi.', 'Enter the city, dates, purpose and expenses — per diems are calculated by norm.'), T('Нажмите «Отправить на согласование».', '«Kelishuvga yuborish» ni bosing.', 'Press “Submit for approval”.')),
      task(T('Подать авансовый отчёт', 'Bo‘nak hisobotini topshirish', 'Submitting the expense report'), T('После возвращения откройте командировку со статусом «Ждёт отчёта».', 'Qaytgach, «Hisobotni kutmoqda» holatidagi safarni oching.', 'After returning open the trip with status “Awaiting report”.'), T('Внесите фактические расходы, приложите документы и нажмите «Подать авансовый отчёт».', 'Haqiqiy xarajatlarni kiriting, hujjatlarni biriktiring va «Bo‘nak hisobotini topshirish» ni bosing.', 'Enter actual expenses, attach documents and press “Submit expense report”.'), T('Бухгалтерия принимает отчёт, командировка закрывается.', 'Buxgalteriya hisobotni qabul qiladi, safar yopiladi.', 'Accounting accepts the report and the trip is closed.')),
    ],
  },

  // ---------------- Финансы ----------------
  {
    id: 'budgeting', kind: 'module',
    summary: T('Бюджетирование и мониторинг: строки бюджета, изменения бюджета с согласованием, бюджетный контроль (превышения), скользящий прогноз, сценарии, ZBB, CAPEX и инвестпроекты, МВЗ и филиалы, закрытие периодов.', 'Byudjetlashtirish va monitoring: byudjet qatorlari, kelishuvli byudjet o‘zgarishlari, byudjet nazorati (oshishlar), sirpanchiq prognoz, ssenariylar, ZBB, CAPEX va investloyihalar, XJM va filiallar, davrlarni yopish.', 'Budgeting and monitoring: budget lines, budget changes with approval, budget control (overruns), rolling forecast, scenarios, ZBB, CAPEX and investment projects, cost centres and branches, period close.'),
    screens: [T('Вкладки «Обзор», «Строки бюджета», «Изменения бюджета», «Бюджетный контроль», «Скользящий прогноз», «Сценарии», «ZBB», «CAPEX и инвестпроекты», «МВЗ и филиалы», «Закрытие периодов»', '«Umumiy», «Byudjet qatorlari», «Byudjet o‘zgarishlari», «Byudjet nazorati», «Sirpanchiq prognoz», «Ssenariylar», «ZBB», «CAPEX va investloyihalar», «XJM va filiallar», «Davrlarni yopish» yorliqlari', 'Tabs “Overview”, “Budget lines”, “Budget changes”, “Budget control”, “Rolling forecast”, “Scenarios”, “ZBB”, “CAPEX and projects”, “Cost centres and branches”, “Period close”')],
    tasks: [task(T('Изменить бюджет', 'Byudjetni o‘zgartirish', 'Changing the budget'), T('Нажмите «Изменить бюджет».', '«Byudjetni o‘zgartirish» ni bosing.', 'Press “Change budget”.'), T('Выберите строку, сумму перераспределения и обоснование.', 'Qator, qayta taqsimlash summasi va asoslashni tanlang.', 'Choose the line, reallocation amount and justification.'), T('Изменение проходит руководителя и финансы; после утверждения план обновляется.', 'O‘zgarish rahbar va moliyadan o‘tadi; tasdiqlangandan so‘ng reja yangilanadi.', 'The change goes through the manager and finance; after approval the plan updates.'))],
    related: ['allocation'],
  },
  {
    id: 'allocation', kind: 'module',
    summary: T('Аллокация косвенных затрат на бизнес-направления по драйверам: правила, методы и цепочка, библиотека драйверов, сбор данных из ГК, what-if, история расчётов и закрытие периодов.', 'Bilvosita xarajatlarni drayverlar bo‘yicha biznes yo‘nalishlarga taqsimlash: qoidalar, usullar va zanjir, drayverlar kutubxonasi, BK dan ma’lumot yig‘ish, what-if, hisob-kitoblar tarixi va davrlarni yopish.', 'Allocation of indirect costs to business lines by drivers: rules, methods and chain, driver library, GL data collection, what-if, run history and period close.'),
    screens: [T('Вкладки «Расчёт», «Правила и драйверы», «Методы и цепочка», «Библиотека драйверов», «Сбор данных (ГК)», «What-if», «История расчётов», «Закрытие периодов»', '«Hisob-kitob», «Qoidalar va drayverlar», «Usullar va zanjir», «Drayverlar kutubxonasi», «Ma’lumot yig‘ish (BK)», «What-if», «Hisob-kitoblar tarixi», «Davrlarni yopish» yorliqlari', 'Tabs “Run”, “Rules and drivers”, “Methods and chain”, “Driver library”, “Data collection (GL)”, “What-if”, “Run history”, “Period close”')],
    tasks: [task(T('Выполнить расчёт аллокации', 'Taqsimlash hisob-kitobini bajarish', 'Running an allocation'), T('На вкладке «Расчёт» выберите период.', '«Hisob-kitob» yorlig‘ida davrni tanlang.', 'On “Run” select the period.'), T('Проверьте пулы затрат и драйверы, запустите расчёт.', 'Xarajat pullari va drayverlarni tekshiring, hisob-kitobni ishga tushiring.', 'Check cost pools and drivers and start the run.'), T('Результат сохраняется в «Истории расчётов» с версией правил.', 'Natija qoidalar versiyasi bilan «Hisob-kitoblar tarixi» da saqlanadi.', 'The result is saved in “Run history” with the rule version.'))],
  },
  {
    id: 'ftp', kind: 'module',
    summary: T('Трансфертное ценообразование (FTP) методом сопоставимых сроков: кривая фондирования и сценарии, продукты, направления, приём результатов из КХД, методологии, регуляторика, правила ставок и история расчётов.', 'Muddatlarni solishtirish usuli bilan transfer narxlash (FTP): moliyalashtirish egri chizig‘i va ssenariylar, mahsulotlar, yo‘nalishlar, KXO dan natijalarni qabul qilish, metodologiyalar, regulyatorika, stavka qoidalari va hisob-kitoblar tarixi.', 'Funds transfer pricing (FTP) using matched maturity: funding curve and scenarios, products, business lines, loading results from the corporate DWH, methodologies, regulation, rate rules and run history.'),
    screens: [T('Вкладки «Кривая и сценарий», «Продукты», «Направления», «Приём из КХД», «Методологии», «Регуляторика и ликвидность», «Правила ставок», «Расчёты и история»', '«Egri chiziq va ssenariy», «Mahsulotlar», «Yo‘nalishlar», «KXO dan qabul», «Metodologiyalar», «Regulyatorika va likvidlik», «Stavka qoidalari», «Hisob-kitoblar va tarix» yorliqlari', 'Tabs “Curve and scenario”, “Products”, “Business lines”, “DWH intake”, “Methodologies”, “Regulation and liquidity”, “Rate rules”, “Runs and history”')],
    tasks: [task(T('Загрузить результаты FTP из КХД', 'KXO dan FTP natijalarini yuklash', 'Loading FTP results from the DWH'), T('Откройте «Приём из КХД» и выберите период.', '«KXO dan qabul» ni oching va davrni tanlang.', 'Open “DWH intake” and select the period.'), T('Запустите загрузку — обмен идёт через интеграционную шину с контрольной суммой.', 'Yuklashni ishga tushiring — almashinuv nazorat summasi bilan integratsiya shinasi orqali o‘tadi.', 'Start the load — the exchange goes through the integration bus with a control sum.'), T('Проверьте результат по продуктам и направлениям.', 'Natijani mahsulotlar va yo‘nalishlar bo‘yicha tekshiring.', 'Check the result by product and business line.'))],
  },
  {
    id: 'taxes', kind: 'module',
    summary: T('Налоги: налоговый календарь, расчёт и подача отчётности, платежи, реестры и налоговая база, налог на прибыль, контроль и сдача, настройки ставок.', 'Soliqlar: soliq kalendari, hisobotni hisoblash va topshirish, to‘lovlar, reestrlar va soliq bazasi, foyda solig‘i, nazorat va topshirish, stavkalar sozlamalari.', 'Taxes: tax calendar, calculation and filing of returns, payments, registers and tax base, profit tax, control and filing, rate settings.'),
    screens: [T('Вкладки «Календарь», «Отчёты», «Настройки ставок»', '«Kalendar», «Hisobotlar», «Stavkalar sozlamalari» yorliqlari', 'Tabs “Calendar”, “Returns”, “Rate settings”'), T('«Реестры и база», «Налог на прибыль», «Контроль и сдача»', '«Reestrlar va baza», «Foyda solig‘i», «Nazorat va topshirish»', '“Registers and base”, “Profit tax”, “Control and filing”')],
    tasks: [task(T('Подготовить и сдать отчёт', 'Hisobotni tayyorlash va topshirish', 'Preparing and filing a return'), T('В «Календаре» откройте отчёт с ближайшим сроком.', '«Kalendar» da eng yaqin muddatli hisobotni oching.', 'In the “Calendar” open the return with the nearest deadline.'), T('Проверьте расчёт базы и суммы по реестрам.', 'Reestrlar bo‘yicha baza va summalar hisobini tekshiring.', 'Check the base and amounts from the registers.'), T('Подпишите и отправьте в Налоговый комитет; статус и платёж отслеживаются в «Контроль и сдача».', 'Imzolang va Soliq qo‘mitasiga yuboring; holat va to‘lov «Nazorat va topshirish» da kuzatiladi.', 'Sign and send to the Tax Committee; status and payment are tracked in “Control and filing”.'))],
    related: ['einvoices'],
  },
  {
    id: 'ifrs', kind: 'module',
    summary: T('МСФО и дочерние предприятия: трансформация НСБУ → МСФО, корректировки, консолидация группы, сбор данных дочерних, элиминации, денежные потоки, KPI и закрытие периода.', 'MHXS va sho‘ba korxonalar: BMHS → MHXS transformatsiyasi, tuzatishlar, guruh konsolidatsiyasi, sho‘ba korxonalar ma’lumotlarini yig‘ish, eliminatsiyalar, pul oqimlari, KPI va davrni yopish.', 'IFRS and subsidiaries: local GAAP → IFRS transformation, adjustments, group consolidation, subsidiary data collection, eliminations, cash flows, KPIs and period close.'),
    screens: [T('Вкладки «Финансовое положение», «Прибыли и убытки», «Структура группы», «Трансформация НСБУ → МСФО», «Корректировки», «Закрытие периода», «Сбор данных дочерних», «План счетов и маппинг», «Элиминации и дивиденды», «Денежные потоки», «KPI», «Красные флажки» и др.', '«Moliyaviy holat», «Foyda va zararlar», «Guruh tuzilmasi», «BMHS → MHXS transformatsiyasi», «Tuzatishlar», «Davrni yopish», «Sho‘ba korxonalar ma’lumotlari», «Hisoblar rejasi va mapping», «Eliminatsiyalar va dividendlar», «Pul oqimlari», «KPI», «Qizil bayroqlar» va boshqalar', 'Tabs “Financial position”, “Profit and loss”, “Group structure”, “Local GAAP → IFRS”, “Adjustments”, “Period close”, “Subsidiary data”, “Chart of accounts and mapping”, “Eliminations and dividends”, “Cash flows”, “KPI”, “Red flags” and others')],
    tasks: [task(T('Закрыть период консолидации', 'Konsolidatsiya davrini yopish', 'Closing the consolidation period'), T('Откройте «Закрытие периода» и проверьте чек-лист шагов.', '«Davrni yopish» ni oching va qadamlar ro‘yxatini tekshiring.', 'Open “Period close” and review the step checklist.'), T('Загрузите пакеты дочерних («Сбор данных дочерних») и выполните элиминации.', 'Sho‘ba korxonalar paketlarini yuklang («Sho‘ba korxonalar ma’lumotlari») va eliminatsiyalarni bajaring.', 'Load subsidiary packages (“Subsidiary data”) and run eliminations.'), T('Закройте шаги по очереди — отчётность группы фиксируется.', 'Qadamlarni navbat bilan yoping — guruh hisoboti qayd etiladi.', 'Close the steps in order — group reporting is fixed.'))],
  },

  // ---------------- Аналитика ----------------
  {
    id: 'reporting', kind: 'module',
    summary: T('Отчётность и аналитика: каталог управленческих отчётов, конструктор отчётов, рассылки по расписанию, журнал доставки и KPI-дашборд. Отчёты выгружаются в Excel/CSV и печатаются.', 'Hisobot va tahlil: boshqaruv hisobotlari katalogi, hisobot konstruktori, jadval bo‘yicha jo‘natmalar, yetkazish jurnali va KPI dashbordi. Hisobotlar Excel/CSV ga yuklanadi va chop etiladi.', 'Reporting and analytics: management report catalogue, report builder, scheduled distributions, delivery log and KPI dashboard. Reports export to Excel/CSV and print.'),
    screens: [T('Вкладки «Каталог отчётов», «Конструктор», «Рассылки», «Журнал доставки»; кнопка «KPI-дашборд»', '«Hisobotlar katalogi», «Konstruktor», «Jo‘natmalar», «Yetkazish jurnali» yorliqlari; «KPI-dashbord» tugmasi', 'Tabs “Report catalogue”, “Builder”, “Distributions”, “Delivery log”; “KPI dashboard” button')],
    tasks: [task(T('Построить отчёт и настроить рассылку', 'Hisobot tuzish va jo‘natmani sozlash', 'Building a report and setting up distribution'), T('В «Каталоге отчётов» откройте отчёт, задайте параметры (период, подразделение).', '«Hisobotlar katalogi» da hisobotni oching, parametrlarni (davr, bo‘linma) belgilang.', 'In the “Report catalogue” open a report and set parameters (period, unit).'), T('Нажмите «Экспорт» для Excel/CSV или «Печать».', 'Excel/CSV uchun «Eksport» ni yoki «Chop etish» ni bosing.', 'Press “Export” for Excel/CSV or “Print”.'), T('На вкладке «Рассылки» добавьте получателей и расписание.', '«Jo‘natmalar» yorlig‘ida oluvchilar va jadvalni qo‘shing.', 'On “Distributions” add recipients and a schedule.'))],
  },
  {
    id: 'operations', kind: 'module',
    summary: T('Анализ операций и себестоимость продуктов: прямые и косвенные расходы, ожидаемые убытки (EL), стоимость ресурсов FTP, трансфертная маржа по сегментам, каналам и филиалам.', 'Operatsiyalar tahlili va mahsulotlar tannarxi: to‘g‘ridan-to‘g‘ri va bilvosita xarajatlar, kutilayotgan zararlar (EL), FTP resurslari qiymati, segmentlar, kanallar va filiallar bo‘yicha transfer marja.', 'Operations analysis and product costing: direct and indirect costs, expected loss (EL), FTP funding cost, transfer margin by segment, channel and branch.'),
    screens: [T('Вкладки «Себестоимость продуктов», «Сегменты, каналы, филиалы», «Трансфертная маржа», «Ожидаемые убытки (EL)», «Методы и нормы», «Ставки и надбавки FTP», «Профили ЦБУ», «Процессы XB-ERP»', '«Mahsulotlar tannarxi», «Segmentlar, kanallar, filiallar», «Transfer marja», «Kutilayotgan zararlar (EL)», «Usullar va me’yorlar», «FTP stavkalari va ustamalari», «BXM profillari», «XB-ERP jarayonlari» yorliqlari', 'Tabs “Product cost”, “Segments, channels, branches”, “Transfer margin”, “Expected loss (EL)”, “Methods and norms”, “FTP rates and add-ons”, “Branch profiles”, “XB-ERP processes”')],
    tasks: [task(T('Проанализировать прибыльность продукта', 'Mahsulot rentabelligini tahlil qilish', 'Analysing product profitability'), T('Откройте «Себестоимость продуктов» и выберите период.', '«Mahsulotlar tannarxi» ni oching va davrni tanlang.', 'Open “Product cost” and select the period.'), T('Сравните доходы, прямые и косвенные расходы и EL по продукту.', 'Mahsulot bo‘yicha daromadlar, to‘g‘ri va bilvosita xarajatlar hamda EL ni solishtiring.', 'Compare income, direct and indirect costs and EL by product.'), T('Детализируйте по сегментам и филиалам на соседней вкладке.', 'Qo‘shni yorliqda segmentlar va filiallar bo‘yicha batafsil ko‘ring.', 'Drill down by segment and branch on the next tab.'))],
    related: ['ftp', 'allocation'],
  },

  // ---------------- Администрирование ----------------
  {
    id: 'users', kind: 'module',
    summary: T('Пользователи: учётные записи, должности и роли, блокировки, кадровые события (приём, перевод, отпуск, увольнение) и синхронизация с Active Directory (AD/LDAP) с предпросмотром различий.', 'Foydalanuvchilar: hisob yozuvlari, lavozimlar va rollar, bloklashlar, kadrlar voqealari (qabul, o‘tkazish, ta’til, ishdan bo‘shatish) va farqlarni oldindan ko‘rish bilan Active Directory (AD/LDAP) bilan sinxronlash.', 'Users: accounts, positions and roles, lockouts, HR events (hire, transfer, leave, dismissal) and synchronisation with Active Directory (AD/LDAP) with a diff preview.'),
    screens: [T('Вкладки «Пользователи», «Кадровые события», «Active Directory»', '«Foydalanuvchilar», «Kadrlar voqealari», «Active Directory» yorliqlari', 'Tabs “Users”, “HR events”, “Active Directory”'), T('Показатели: всего учётных записей, активные, заблокированы, деактивированы', 'Ko‘rsatkichlar: jami hisob yozuvlari, faol, bloklangan, o‘chirilgan', 'Indicators: total accounts, active, locked, deactivated')],
    tasks: [
      task(T('Создать пользователя', 'Foydalanuvchi yaratish', 'Creating a user'), T('Нажмите «Новый пользователь».', '«Yangi foydalanuvchi» ni bosing.', 'Press “New user”.'), T('Заполните ФИО, логин, e-mail, должность (роль подставится по должности) и подразделение.', 'F.I.Sh., login, e-mail, lavozim (rol lavozim bo‘yicha qo‘yiladi) va bo‘linmani to‘ldiring.', 'Fill in name, login, e-mail, position (the role follows the position) and unit.'), T('Сохраните — изменение попадёт в журнал аудита.', 'Saqlang — o‘zgarish audit jurnaliga tushadi.', 'Save — the change goes to the audit log.')),
      task(T('Синхронизировать пользователей с AD', 'Foydalanuvchilarni AD bilan sinxronlash', 'Syncing users with AD'),
        T('Откройте вкладку «Active Directory» и нажмите «Загрузить изменения из AD».', '«Active Directory» yorlig‘ini oching va «AD dan o‘zgarishlarni yuklash» ni bosing.', 'Open the “Active Directory” tab and press “Load changes from AD”.'),
        T('Проверьте предпросмотр: новые, изменённые и отключённые учётные записи с полями «было → стало».', 'Oldindan ko‘rishni tekshiring: yangi, o‘zgargan va o‘chirilgan hisob yozuvlari «edi → bo‘ldi» maydonlari bilan.', 'Review the preview: new, changed and disabled accounts with “before → after” fields.'),
        T('Отметьте строки и нажмите «Применить выбранное», подтвердите кодом 2FA.', 'Qatorlarni belgilang va «Tanlanganni qo‘llash» ni bosing, 2FA kodi bilan tasdiqlang.', 'Tick the rows, press “Apply selected” and confirm with a 2FA code.'),
        T('При необходимости измените сопоставление «группа AD → роль» в таблице ниже (тоже с подтверждением).', 'Kerak bo‘lsa, quyidagi jadvalda «AD guruhi → rol» moslashuvini o‘zgartiring (tasdiqlash bilan).', 'If needed, edit the “AD group → role” mapping in the table below (also confirmed).'),
      ),
    ],
    related: ['roles', 'start-login'],
  },
  {
    id: 'roles', kind: 'module',
    summary: T('Роли и права: матрица доступа «роль × модуль» (просмотр, редактирование, согласование, администрирование), должности с ролью по умолчанию и access review (конфликты SoD, неиспользуемые права).', 'Rollar va huquqlar: «rol × modul» kirish matritsasi (ko‘rish, tahrirlash, kelishish, boshqarish), standart rolli lavozimlar va access review (SoD ziddiyatlari, ishlatilmagan huquqlar).', 'Roles and permissions: the “role × module” access matrix (view, edit, approve, admin), positions with default roles and access review (SoD conflicts, unused rights).'),
    screens: [T('Вкладки «Матрица прав», «Должности», «Access review»', '«Huquqlar matritsasi», «Lavozimlar», «Access review» yorliqlari', 'Tabs “Permission matrix”, “Positions”, “Access review”')],
    tasks: [task(T('Изменить права роли', 'Rol huquqlarini o‘zgartirish', 'Changing role permissions'), T('На вкладке «Матрица прав» выберите уровень в ячейке «роль × модуль».', '«Huquqlar matritsasi» yorlig‘ida «rol × modul» katakchasida darajani tanlang.', 'On “Permission matrix” choose the level in the “role × module” cell.'), T('Изменение применяется сразу и записывается в журнал аудита; сброс матрицы к значениям по умолчанию подтверждается кодом 2FA.', 'O‘zgarish darhol qo‘llanadi va audit jurnaliga yoziladi; matritsani standart qiymatlarga qaytarish 2FA kodi bilan tasdiqlanadi.', 'The change applies immediately and is audited; resetting the matrix to defaults requires a 2FA code.'), T('Сессии пользователей этой роли получат новый идентификатор (ротация).', 'Ushbu roldagi foydalanuvchilar seanslari yangi identifikator oladi (rotatsiya).', 'Sessions of users with the role get a new ID (rotation).'))],
    related: ['users', 'security'],
  },
  {
    id: 'security', kind: 'module',
    summary: T('Безопасность: парольная политика, параметры сессий и входа, активные сессии, DLP (экспорт и печать по категориям данных), сервисные учётные записи интеграций.', 'Xavfsizlik: parol siyosati, seans va kirish parametrlari, faol seanslar, DLP (ma’lumot toifalari bo‘yicha eksport va chop etish), integratsiyalarning servis hisob yozuvlari.', 'Security: password policy, session and sign-in parameters, active sessions, DLP (export and print by data category), integration service accounts.'),
    screens: [T('Карточки «Парольная политика», «Сессии и вход», «Активные сессии», «DLP», «Сервисные учётные записи интеграций»', '«Parol siyosati», «Seanslar va kirish», «Faol seanslar», «DLP», «Integratsiyalar servis hisob yozuvlari» kartochkalari', 'Cards “Password policy”, “Sessions and sign-in”, “Active sessions”, “DLP”, “Integration service accounts”')],
    tasks: [task(T('Изменить политику и завершить чужую сессию', 'Siyosatni o‘zgartirish va boshqa seansni yakunlash', 'Changing the policy and ending a session'), T('Измените параметры (длина пароля, срок, попытки, тайм-аут) — значения ниже минимума ТЗ не сохранятся.', 'Parametrlarni o‘zgartiring (parol uzunligi, muddat, urinishlar, taym-aut) — TT minimumidan past qiymatlar saqlanmaydi.', 'Change parameters (password length, expiry, attempts, timeout) — values below the specification minimum are not saved.'), T('Нажмите «Сохранить политику» и подтвердите кодом.', '«Siyosatni saqlash» ni bosing va kod bilan tasdiqlang.', 'Press “Save policy” and confirm with a code.'), T('В «Активных сессиях» нажмите «Завершить» напротив сессии.', '«Faol seanslar» da seans qarshisidagi «Yakunlash» ni bosing.', 'In “Active sessions” press “End” next to the session.'))],
  },
  {
    id: 'routes', kind: 'module',
    summary: T('Маршруты согласования: шаблоны по типам документов с условиями (сумма, подтип, подразделение), шагами (роль, пользователь, руководитель инициатора, роль в филиале), сроками SLA, порогом Правления, проверкой маршрута.', 'Kelishuv yo‘nalishlari: shartlar (summa, kichik tur, bo‘linma), bosqichlar (rol, foydalanuvchi, tashabbuskor rahbari, filialdagi rol), SLA muddatlari, Boshqaruv chegarasi va yo‘nalish tekshiruvi bilan hujjat turlari bo‘yicha shablonlar.', 'Approval routes: templates by document type with conditions (amount, subtype, unit), steps (role, user, initiator’s manager, branch role), SLA deadlines, board threshold and a route checker.'),
    screens: [T('Список шаблонов, «Проверка маршрута», «Коллегиальные органы», «Массовое согласование»', 'Shablonlar ro‘yxati, «Yo‘nalishni tekshirish», «Kollegial organlar», «Ommaviy kelishuv»', 'Template list, “Route check”, “Committees”, “Bulk approval”')],
    tasks: [task(T('Создать шаблон маршрута', 'Yo‘nalish shablonini yaratish', 'Creating a route template'), T('Нажмите «Новый шаблон» и выберите тип документа.', '«Yangi shablon» ni bosing va hujjat turini tanlang.', 'Press “New template” and choose the document type.'), T('Задайте условия, шаги и SLA, сохраните (создаётся новая версия).', 'Shartlar, bosqichlar va SLA ni belgilang, saqlang (yangi versiya yaratiladi).', 'Set conditions, steps and SLA and save (a new version is created).'), T('В «Проверке маршрута» введите сумму и подтип — увидите, кто будет согласовывать.', '«Yo‘nalishni tekshirish» da summa va kichik turni kiriting — kim kelishishini ko‘rasiz.', 'In “Route check” enter an amount and subtype to see who will approve.'))],
    related: ['approvals'],
  },
  {
    id: 'audit', kind: 'module',
    summary: T('Журнал аудита: все действия пользователей и системы (вход, изменения, согласования, экспорт, права) с цепочкой хэшей для контроля целостности; срок хранения 7 лет; выгрузка для SIEM.', 'Audit jurnali: foydalanuvchilar va tizimning barcha harakatlari (kirish, o‘zgarishlar, kelishuvlar, eksport, huquqlar) yaxlitlikni nazorat qilish uchun xesh zanjiri bilan; saqlash muddati 7 yil; SIEM uchun yuklash.', 'Audit log: all user and system actions (sign-in, changes, approvals, exports, rights) with a hash chain for integrity control; 7-year retention; SIEM export.'),
    screens: [T('Фильтры по пользователю, действию, объекту и датам; кнопки «Проверить целостность», CSV, XLSX, SIEM · CEF, SIEM · JSON', 'Foydalanuvchi, harakat, obyekt va sanalar bo‘yicha filtrlar; «Yaxlitlikni tekshirish», CSV, XLSX, SIEM · CEF, SIEM · JSON tugmalari', 'Filters by user, action, object and dates; buttons “Check integrity”, CSV, XLSX, SIEM · CEF, SIEM · JSON')],
    tasks: [task(T('Найти изменения по объекту', 'Obyekt bo‘yicha o‘zgarishlarni topish', 'Finding changes to an object'), T('Задайте фильтр по объекту или пользователю и периоду.', 'Obyekt yoki foydalanuvchi va davr bo‘yicha filtrni belgilang.', 'Filter by object or user and period.'), T('Откройте запись — видно «было → стало» по полям.', 'Yozuvni oching — maydonlar bo‘yicha «edi → bo‘ldi» ko‘rinadi.', 'Open a record to see “before → after” per field.'), T('Нажмите «Проверить целостность» для контроля цепочки хэшей.', 'Xesh zanjirini nazorat qilish uchun «Yaxlitlikni tekshirish» ni bosing.', 'Press “Check integrity” to verify the hash chain.'))],
  },
  {
    id: 'integrations', kind: 'module',
    summary: T('Интеграции (раздел 5 ТЗ): монитор внешних и внутренних систем, журнал обмена, очередь при недоступности, карантин, сверка контрольных итогов и конструктор новых интеграций (REST/SOAP/файл/MQ) с выгрузкой OpenAPI.', 'Integratsiyalar (TT 5-bo‘limi): tashqi va ichki tizimlar monitori, almashinuv jurnali, mavjud bo‘lmaganda navbat, karantin, nazorat yakunlarini solishtirish va OpenAPI yuklash bilan yangi integratsiyalar konstruktori (REST/SOAP/fayl/MQ).', 'Integrations (section 5): monitor of external and internal systems, exchange log, queue when unavailable, quarantine, control-total reconciliation and a designer for new integrations (REST/SOAP/file/MQ) with OpenAPI export.'),
    screens: [T('Вкладки «Системы», «Журнал обмена», «Карантин», «Сверка», «Конструктор»', '«Tizimlar», «Almashinuv jurnali», «Karantin», «Solishtirish», «Konstruktor» yorliqlari', 'Tabs “Systems”, “Exchange log”, “Quarantine”, “Reconciliation”, “Designer”')],
    tasks: [
      task(T('Создать новую интеграцию в конструкторе', 'Konstruktorda yangi integratsiya yaratish', 'Creating a new integration in the designer'),
        T('Откройте вкладку «Конструктор» и нажмите «Новая интеграция».', '«Konstruktor» yorlig‘ini oching va «Yangi integratsiya» ni bosing.', 'Open the “Designer” tab and press “New integration”.'),
        T('Укажите название системы, владельца, протокол (REST, SOAP, файл, MQ), адрес и способ аутентификации.', 'Tizim nomi, egasi, protokol (REST, SOAP, fayl, MQ), manzil va autentifikatsiya usulini ko‘rsating.', 'Enter the system name, owner, protocol (REST, SOAP, file, MQ), endpoint and authentication.'),
        T('Добавьте операции: идентификатор, метод/цель, поля запроса и ответа с сопоставлением полям XB-ERP.', 'Operatsiyalarni qo‘shing: identifikator, usul/maqsad, so‘rov va javob maydonlari XB-ERP maydonlariga moslashtirilgan holda.', 'Add operations: identifier, method/target, request and response fields mapped to XB-ERP fields.'),
        T('Задайте расписание и политику повторов, нажмите «Сохранить» и подтвердите кодом 2FA — система появится в мониторе.', 'Jadval va takrorlash siyosatini belgilang, «Saqlash» ni bosing va 2FA kodi bilan tasdiqlang — tizim monitorda paydo bo‘ladi.', 'Set the schedule and retry policy, press “Save” and confirm with a 2FA code — the system appears in the monitor.'),
        T('Нажмите «Тестовый вызов», чтобы обратиться к имитируемой конечной точке, и «OpenAPI», чтобы скачать описание.', 'Imitatsiya qilingan nuqtaga murojaat qilish uchun «Test chaqiruvi» ni, tavsifni yuklab olish uchun «OpenAPI» ni bosing.', 'Press “Test call” to call the simulated endpoint and “OpenAPI” to download the description.'),
      ),
      task(T('Разобрать сообщение в карантине', 'Karantindagi xabarni ko‘rib chiqish', 'Handling a quarantined message'), T('Откройте «Карантин» и сообщение.', '«Karantin» va xabarni oching.', 'Open “Quarantine” and the message.'), T('Нажмите «Исправить и отправить», исправьте JSON и отправьте, или «Отклонить» с причиной.', '«Tuzatish va yuborish» ni bosing, JSON ni tuzating va yuboring yoki sabab bilan «Rad etish» ni bosing.', 'Press “Fix and resend”, correct the JSON and send, or “Reject” with a reason.')),
    ],
    related: ['monitoring'],
  },
  {
    id: 'import', kind: 'module',
    summary: T('Импорт и миграция данных: загрузка справочников и данных модулей из Excel/CSV с проверкой, протоколом ошибок и журналом загрузок.', 'Ma’lumotlarni import qilish va ko‘chirish: ma’lumotnomalar va modul ma’lumotlarini Excel/CSV dan tekshiruv, xatolar bayonnomasi va yuklashlar jurnali bilan yuklash.', 'Data import and migration: loading reference and module data from Excel/CSV with validation, an error report and a load log.'),
    screens: [T('Вкладки по целям импорта (контрагенты, МВЗ, номенклатура, карточки склада, транспорт, точки кривой FTP и др.), «Журнал загрузок»', 'Import maqsadlari bo‘yicha yorliqlar (kontragentlar, XJM, nomenklatura, ombor kartochkalari, transport, FTP egri nuqtalari va h.k.), «Yuklashlar jurnali»', 'Tabs per import target (counterparties, cost centres, catalogue, warehouse cards, vehicles, FTP curve points, etc.), “Load log”')],
    tasks: [task(T('Загрузить файл', 'Faylni yuklash', 'Loading a file'), T('Выберите вкладку цели и скачайте шаблон.', 'Maqsad yorlig‘ini tanlang va shablonni yuklab oling.', 'Choose the target tab and download the template.'), T('Загрузите заполненный файл — система проверит строки и покажет ошибки.', 'To‘ldirilgan faylni yuklang — tizim qatorlarni tekshiradi va xatolarni ko‘rsatadi.', 'Upload the filled file — the system validates rows and shows errors.'), T('Импортируйте корректные строки; протокол сохранится в журнале.', 'To‘g‘ri qatorlarni import qiling; bayonnoma jurnalda saqlanadi.', 'Import the valid rows; the report is saved in the log.'))],
  },
  {
    id: 'print-forms', kind: 'module',
    summary: T('Шаблоны печатных форм: карточка документа, акт и реестр формата A4 с реквизитами банка, подписями E-IMZO и QR-кодом для проверки подлинности.', 'Bosma shakllar shablonlari: bank rekvizitlari, E-IMZO imzolari va haqiqiylikni tekshirish uchun QR-kod bilan A4 formatdagi hujjat kartochkasi, dalolatnoma va reestr.', 'Print form templates: A4 document card, act and register with bank details, E-IMZO signatures and a QR code for authenticity checks.'),
    screens: [T('Вкладки «Карточка документа», «Акт», «Реестр»; карточки «Электронные подписи», «Вложения»', '«Hujjat kartochkasi», «Dalolatnoma», «Reestr» yorliqlari; «Elektron imzolar», «Ilovalar» kartochkalari', 'Tabs “Document card”, “Act”, “Register”; cards “E-signatures”, “Attachments”')],
    tasks: [task(T('Напечатать и проверить документ', 'Hujjatni chop etish va tekshirish', 'Printing and verifying a document'), T('Нажмите «Предпросмотр печати», затем «Печать».', '«Chop etishni oldindan ko‘rish» ni, so‘ng «Chop etish» ni bosing.', 'Press “Print preview”, then “Print”.'), T('QR-код на листе ведёт на страницу проверки подписи и данных документа.', 'Varaqdagi QR-kod imzo va hujjat ma’lumotlarini tekshirish sahifasiga olib boradi.', 'The QR code on the sheet leads to the signature and document check page.'))],
  },
  {
    id: 'monitoring', kind: 'module',
    summary: T('Мониторинг и диагностика: состояние компонентов и интеграций с порогами, режим работы (нормальный/аварийный), инциденты с уведомлением дежурного и регистрацией в Service Desk, технический журнал, диагностический отчёт.', 'Monitoring va diagnostika: chegaralar bilan komponentlar va integratsiyalar holati, ish rejimi (oddiy/avariya), navbatchini xabardor qilish va Service Desk da ro‘yxatga olish bilan insidentlar, texnik jurnal, diagnostika hisoboti.', 'Monitoring and diagnostics: component and integration health with thresholds, operating mode (normal/emergency), incidents with duty notification and Service Desk registration, technical log and diagnostic report.'),
    screens: [T('Вкладки «Состояние», «Инциденты», «Технический журнал», «Пороги оповещений»', '«Holat», «Insidentlar», «Texnik jurnal», «Ogohlantirish chegaralari» yorliqlari', 'Tabs “Health”, “Incidents”, “Technical log”, “Alert thresholds”')],
    tasks: [task(T('Проверить состояние и выгрузить отчёт', 'Holatni tekshirish va hisobotni yuklash', 'Checking health and exporting a report'), T('Нажмите «Проверить сейчас» — при отказе откроется инцидент и придёт уведомление дежурному.', '«Hozir tekshirish» ni bosing — nosozlikda insident ochiladi va navbatchiga bildirishnoma keladi.', 'Press “Check now” — a failure opens an incident and notifies the duty engineer.'), T('Нажмите «Диагностический отчёт» — скачаются JSON и Excel.', '«Diagnostika hisoboti» ni bosing — JSON va Excel yuklanadi.', 'Press “Diagnostic report” — JSON and Excel are downloaded.'))],
    related: ['maintenance', 'service-desk'],
  },

  // ---------------- P4-GEN: новые разделы ----------------
  {
    id: 'help', kind: 'module',
    summary: T('Справка пользователя: оглавление с поиском, статьи «Начало работы» и по каждому модулю, печать статьи. Кнопка «?» в верхней панели открывает статью текущего модуля.', 'Foydalanuvchi yordami: qidiruvli mundarija, «Ishni boshlash» va har bir modul bo‘yicha maqolalar, maqolani chop etish. Yuqori paneldagi «?» tugmasi joriy modul maqolasini ochadi.', 'User help: searchable table of contents, “Getting started” and per-module articles, article printing. The “?” button in the top bar opens the current module’s article.'),
    screens: [T('Оглавление с поиском и группами меню', 'Qidiruv va menyu guruhlari bilan mundarija', 'Table of contents with search and menu groups'), T('Статья: назначение, экраны, пошаговые операции, роли', 'Maqola: vazifasi, ekranlar, bosqichma-bosqich amallar, rollar', 'Article: purpose, screens, step-by-step operations, roles')],
    tasks: [task(T('Найти и напечатать статью', 'Maqolani topish va chop etish', 'Finding and printing an article'), T('Введите слово в поле поиска (например, «аванс»).', 'Qidiruv maydoniga so‘z kiriting (masalan, «bo‘nak»).', 'Type a word in the search field (e.g. “advance”).'), T('Откройте найденную статью.', 'Topilgan maqolani oching.', 'Open the article found.'), T('Нажмите «Печать» — статья откроется в предпросмотре A4.', '«Chop etish» ni bosing — maqola A4 oldindan ko‘rishda ochiladi.', 'Press “Print” — the article opens in the A4 preview.'))],
  },
  {
    id: 'service-desk', kind: 'module',
    summary: T('Service Desk: обращения пользователей (инцидент или запрос) регистрируются в Service Desk банка через интеграционную шину; статусы синхронизируются и показываются в приложении, при изменении приходит уведомление.', 'Service Desk: foydalanuvchilar murojaatlari (insident yoki so‘rov) integratsiya shinasi orqali bank Service Desk ida ro‘yxatga olinadi; holatlar sinxronlanadi va ilovada ko‘rsatiladi, o‘zgarganda bildirishnoma keladi.', 'Service Desk: user tickets (incident or request) are registered in the bank’s Service Desk through the integration bus; statuses are synced and shown in the app, with a notification on each change.'),
    screens: [T('Реестр обращений с номером Service Desk и статусом', 'Service Desk raqami va holati bilan murojaatlar reestri', 'Ticket register with Service Desk number and status'), T('Карточка обращения: история статусов, исполнитель, решение', 'Murojaat kartochkasi: holatlar tarixi, ijrochi, yechim', 'Ticket card: status history, assignee, resolution')],
    tasks: [
      task(T('Создать обращение', 'Murojaat yaratish', 'Creating a ticket'), T('Нажмите «Новое обращение».', '«Yangi murojaat» ni bosing.', 'Press “New ticket”.'), T('Выберите тип (инцидент/запрос), категорию, приоритет, модуль; опишите проблему.', 'Turini (insident/so‘rov), toifasini, ustuvorligini, modulni tanlang; muammoni tavsiflang.', 'Choose type (incident/request), category, priority and module; describe the problem.'), T('Нажмите «Отправить» — заявке присвоится номер SD-…; если Service Desk недоступен, обращение встанет в очередь и уйдёт автоматически.', '«Yuborish» ni bosing — arizaga SD-… raqami beriladi; Service Desk mavjud bo‘lmasa, murojaat navbatga qo‘yiladi va avtomatik yuboriladi.', 'Press “Send” — the ticket gets an SD-… number; if the Service Desk is unavailable it is queued and sent automatically.')),
      task(T('Отследить и закрыть обращение', 'Murojaatni kuzatish va yopish', 'Tracking and closing a ticket'), T('Нажмите «Обновить статусы» (статусы также обновляются автоматически).', '«Holatlarni yangilash» ni bosing (holatlar avtomatik ham yangilanadi).', 'Press “Refresh statuses” (statuses also refresh automatically).'), T('Когда статус станет «Решено», проверьте решение и нажмите «Подтвердить решение».', 'Holat «Hal qilindi» bo‘lganda, yechimni tekshiring va «Yechimni tasdiqlash» ni bosing.', 'When the status becomes “Resolved”, check the solution and press “Confirm resolution”.')),
    ],
    related: ['monitoring', 'maintenance'],
  },
  {
    id: 'maintenance', kind: 'module',
    summary: T('Регламентные работы и режимы ИС: планирование технологических окон не позднее чем за 5 рабочих дней с согласованием, уведомления и баннер для пользователей до и во время окна, аварийный режим «только чтение».', 'Reglament ishlari va AT rejimlari: kelishuv bilan kamida 5 ish kuni oldin texnologik oynalarni rejalashtirish, oyna oldidan va davomida foydalanuvchilar uchun bildirishnomalar va banner, «faqat o‘qish» avariya rejimi.', 'Maintenance and operating modes: planning maintenance windows at least 5 working days ahead with approval, notifications and a banner for users before and during the window, and a read-only emergency mode.'),
    screens: [T('Вкладки «Регламентные окна» и «Аварийный режим»', '«Reglament oynalari» va «Avariya rejimi» yorliqlari', 'Tabs “Maintenance windows” and “Emergency mode”'), T('Карточка окна: системы, влияние, маршрут согласования, история', 'Oyna kartochkasi: tizimlar, ta’sir, kelishuv yo‘nalishi, tarix', 'Window card: systems, impact, approval route, history')],
    tasks: [
      task(T('Запланировать регламентное окно', 'Reglament oynasini rejalashtirish', 'Planning a maintenance window'),
        T('Нажмите «Запланировать окно».', '«Oynani rejalashtirish» ni bosing.', 'Press “Plan window”.'),
        T('Укажите тему, начало и окончание (не раньше даты, показанной в подсказке — 5 рабочих дней), затрагиваемые системы и влияние.', 'Mavzu, boshlanish va tugash vaqtini (maslahatda ko‘rsatilgan sanadan oldin emas — 5 ish kuni), ta’sirlangan tizimlar va ta’sirni ko‘rsating.', 'Enter the subject, start and end (not earlier than the date in the hint — 5 working days), affected systems and impact.'),
        T('Нажмите «Отправить на согласование» — задача уйдёт руководителю ИТ (Заказчику).', '«Kelishuvga yuborish» ni bosing — vazifa AT rahbariga (Buyurtmachiga) yuboriladi.', 'Press “Submit for approval” — the task goes to the IT head (the Customer).'),
        T('После согласования все пользователи получат уведомление (и напоминание за 24 часа), за 72 часа и во время работ на всех экранах появится баннер; при влиянии «только чтение» или «полная остановка» на время окна изменение данных доступно только администратору.', 'Kelishuvdan so‘ng barcha foydalanuvchilar bildirishnoma (va 24 soat oldin eslatma) oladi, 72 soat oldin va ishlar davomida barcha ekranlarda banner paydo bo‘ladi; «faqat o‘qish» yoki «to‘liq to‘xtatish» ta’sirida oyna davomida ma’lumotlarni faqat administrator o‘zgartira oladi.', 'After approval all users are notified (with a reminder 24 hours ahead); a banner appears on every screen 72 hours before and during the work; with “read-only” or “full outage” impact only an administrator can change data during the window.'),
      ),
      task(T('Включить аварийный режим', 'Avariya rejimini yoqish', 'Turning on emergency mode'), T('Откройте вкладку «Аварийный режим», укажите причину.', '«Avariya rejimi» yorlig‘ini oching, sababni ko‘rsating.', 'Open the “Emergency mode” tab and enter the reason.'), T('Включите переключатель и подтвердите кодом 2FA.', 'Kalitni yoqing va 2FA kodi bilan tasdiqlang.', 'Turn the switch on and confirm with a 2FA code.'), T('Все пользователи увидят красный баннер «только чтение»; изменять данные может только администратор (Service Desk и справка доступны), в Service Desk регистрируется инцидент. Для выхода выключите переключатель.', 'Barcha foydalanuvchilar «faqat o‘qish» qizil bannerini ko‘radi; ma’lumotlarni faqat administrator o‘zgartira oladi (Service Desk va yordam mavjud), Service Desk da insident ro‘yxatga olinadi. Chiqish uchun kalitni o‘chiring.', 'All users see the red “read-only” banner; only an administrator can change data (Service Desk and help stay available), and an incident is registered in the Service Desk. Turn the switch off to exit.')),
    ],
    related: ['monitoring', 'service-desk', 'approvals'],
  },
];

/** Порядок статей «Начало работы» в оглавлении. */
export const HELP_START_IDS = ['start-login', 'start-2fa', 'start-languages', 'start-interface', 'approvals'];

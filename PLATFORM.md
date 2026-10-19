# XB-ERP · Платформенные сервисы (для разработчиков модулей)

Краткий путеводитель по общим сервисам ядра. Точные сигнатуры — в исходниках по указанным путям.

## Доступ и безопасность — `packages/shared/src/security.ts`, `apps/web/src/lib/access.tsx`
- Роли: `ROLES`, `ROLE_CATEGORIES`; уровни доступа `none < view < edit < approve < admin`.
- `can(user, moduleId, level)` — в shared; `useCan()(moduleId, level)` — в web. Каждая кнопка действия проверяет право через них.
- Новый модуль: `registerModuleAccess(moduleId, { role: level, ... })`.
- Подтверждение рискованных действий кодом 2FA: `const stepUp = useStepUp(); if (!(await stepUp())) return;`.
- Демо-пароль `DEMO_PASSWORD`; быстрый демо-вход на экране входа.
- P4-SEC: режим сборки `IS_DEMO_BUILD` / `XB_BUILD_MODE` (демо по умолчанию; промышленная — `__XB_MODE__="production"`, см. README). Ссылки на другие разделы — `<GuardedLink to=…>` (`lib/access.tsx`): без права — текст или ничего (`hideIfDenied`).
- P4-SEC: операции под контролем двух лиц проверяют свежий step-up на стороне API — `consumeStepUp(userId)`; ПДн на экране — `showPd/maskPd/canSeePd` (`privacy.ts`, право `pd_full`).
- Ошибки API — коды: `throw apiError('NOT_FOUND')`, словарь `errorsI18n.ts` (ключи `err_<КОД>`); на экране — `useErrorText()` / `userError(e)`; тосты «Не удалось…: КОД» переводятся автоматически (PR-TEC-008).

## Оргструктура и МВЗ — `packages/shared/src/org.ts` (`orgApi`)
- Иерархия: головной офис → региональные филиалы → ЦБУ → подразделения; МВЗ привязаны к оргединицам. Версионирование SCD-2 (validFrom/validTo), «на дату».
- `orgApi.listOrgUnits(...)`, `orgApi.listCostCenters(filter)`, `orgApi.getCostCenter(id)` и др. Сегменты `BUSINESS_SEGMENTS`, каналы `SALES_CHANNELS`.
- Каждая операция, для которой ТЗ требует МВЗ, хранит `costCenterId`.

## Согласования — `packages/shared/src/engine.ts` (`approvalEngine`, `approvalsApi`)
- Совместимый API: `register(entity, { onHistory, onFinal, onReturned? })`, `open({ entity, entityId, number, title, requesterId, amount?, currency?, context? })`, `seed`, `list`, `openFor`, `decide`.
- Шаблоны маршрутов с условиями (`context`: сумма, подтип, подразделение/филиал…) и шагами (роль, конкретный пользователь, руководитель инициатора, роль в филиале), параллельные шаги, SLA, эскалация, коллегиальный орган.
- Действия: согласовать, отклонить (причина), вернуть на доработку (`onReturned`), повторно отправить, комментарий, запрос информации, заместители. Инициатор не согласует свой документ.
- Новый тип документа: добавить в `ApprovalEntity` (types.ts), шаблон маршрута в `engine.ts`, ключ `entity_<тип>` в словарь, ссылку в `apps/web/src/lib/approvalLinks.ts`.
- Web: `<RouteSteps entityId=... />` (маршрут документа) или `<RouteSteps preview={{ entity, context }} />` (до отправки); `RouteDrawer` в `components/flow.tsx`.

## Уведомления — `packages/shared/src/notifications.ts`
- `notify({ userIds | role, title, body, link, level, kind })`; заголовки — строка, `Localized` или `{ key, params }`.
- Колокольчик и `/notifications` уже подключены; сканер сроков запускается приложением.

## Аудит — `packages/shared/src/audit.ts`
- `audit.log({ userId, action, entity, entityId, changes?, result?, details? })`, `diffFields(before, after, fields?)`.
- Web: `<FieldHistory entity entityId />` — история изменений по полям на карточке.

## Документные сервисы — `packages/shared/src/services/*`, `apps/web/src/components/*`
- Экспорт: `<ExportButton>` (Excel/CSV/печать), `exportXlsx(filename, sheets)`, `toSheet(name, columns, rows)` — `components/Export.tsx`.
- Импорт: `<ImportWizard target>` + `importRegistry` (регистрация своих целей импорта) — `components/Import.tsx`, `services/importer.ts`.
- Печать/PDF: `<PrintButton doc template>` / `<PrintPreview>`; шаблоны `card`, `act`, `registry`; QR ведёт на `/verify/:entity/:id` — `components/PrintView.tsx`, `services/print.ts`.
- QR: `<QrCode value>`.
- Вложения: `<Attachments entity entityId>` — `services/files.ts` (`filesApi`).
- ЭЦП E-IMZO: `<SignModal>`, `<SignatureBadge>`, `<SignaturesPanel>`; `signatureService`, `checkSignature` — `services/signature.ts`.
- Интеграции: `integrationHub.call(systemId, operation, payload, options)` — очередь при недоступности, повторы, идемпотентность, карантин, сверка; монитор `/integrations` — `services/integrations.ts`.

## Языки — `packages/shared/src/i18n.ts`, `dict.ts`, `translit.ts`
- `Lang`: `ru`, `uz` (латиница), `uzc` (кириллица — генерируется из `uz`), `en`. `defineDict({ ru, uz, en })` обязателен для каждого словаря.
- Встроенные строки: `pick(lang, ru, uz, en)`. Данные `Localized` могут иметь `en`; `loc()`/`localize()` выбирает язык.
- Деньги и числа: `formatMoney`, `formatMoneyShort`, `formatDecimal` учитывают текущий язык.

## UI-кит — `apps/web/src/components/ui.tsx`
Button, Input, Select, Textarea, Checkbox, Switch, Pagination, Drawer, Steps, Upload, Dropdown, Modal, Tabs, DataTable, FilterBar, Card, Stat, Badge/StatusBadge, Field, Timeline, Progress, BarChart, LineChart, RouteSteps. Новые экраны используют только их (подготовка к переходу на Ant Design).

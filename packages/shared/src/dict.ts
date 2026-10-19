// Помощник для словарей модулей: узбекский и английский словари обязаны содержать те же ключи, что и русский.
// Узбекская кириллица не пишется вручную — она генерируется из uz (см. translit.ts).
export function defineDict<T extends Record<string, string>>(dict: {
  ru: T;
  uz: { [K in keyof T]: string };
  en: { [K in keyof T]: string };
}) {
  return dict;
}

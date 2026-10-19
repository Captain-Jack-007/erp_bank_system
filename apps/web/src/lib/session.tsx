// Сессия: текущий пользователь и язык интерфейса.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getSecurityPolicy, isLang, localize, securityApi, setFormatLang, translate, type Lang, type Localized, type TKey, type User } from '@xb/shared';

interface Session {
  user: User | null;
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Быстрый демо-вход по выбору пользователя (без пароля — только демо-стенд). */
  login: (userId: string) => Promise<void>;
  /** Завершить вход после пароля + 2FA или OneID (пользователь уже аутентифицирован API). */
  completeLogin: (user: User) => void;
  /** Завершить сеанс; reason (кроме manual) показывается на экране входа (PR-SEC-012/038). */
  logout: (reason?: string) => void;
  t: (key: TKey) => string;
  loc: (value: Localized) => string;
}

const SessionContext = createContext<Session | null>(null);

/** Таймаут бездействия из политики сессий (настраивается в «Безопасность»). */
export const SESSION_IDLE_MS = (): number => getSecurityPolicy().session.idleMinutes * 60_000;

// localStorage используется только для удобства (запомнить язык и демо-пользователя).
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** Описание браузера и ОС для журнала и реестра сессий (IP в продуктиве определяет сервер). */
export function browserLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${os ? ` / ${os}` : ''} · ${typeof window !== 'undefined' ? `${window.screen?.width ?? 0}×${window.screen?.height ?? 0}` : ''}`;
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно — работаем без него */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = read('xb.lang');
    const initial: Lang = isLang(saved) ? saved : 'ru';
    setFormatLang(initial);
    return initial;
  });

  useEffect(() => {
    securityApi.setSessionClient({ ip: '10.12.0.15 (demo)', device: browserLabel() });
    const saved = read('xb.user');
    if (!saved) return setReady(true);
    // Сессия истекла по бездействию (P1-ORG, PR-SEC-011): не восстанавливаем.
    const last = Number(read('xb.lastActive') || 0);
    if (last && Date.now() - last > SESSION_IDLE_MS()) {
      write('xb.user', null);
      write('xb.lastActive', null);
      return setReady(true);
    }
    securityApi
      .restoreSession(saved, read('xb.sid'))
      .then((u) => {
        write('xb.sid', securityApi.currentSessionId());
        setUser(u);
      })
      .catch(() => write('xb.user', null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'uzc' ? 'uz-Cyrl' : lang === 'uz' ? 'uz-Latn' : lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setFormatLang(next); // до перерисовки: форматтеры (млн/mn, разделители, сум/UZS) читают язык синхронно
    setLangState(next);
    write('xb.lang', next);
  }, []);

  const completeLogin = useCallback((u: User) => {
    write('xb.user', u.id);
    write('xb.sid', securityApi.currentSessionId());
    write('xb.lastActive', String(Date.now()));
    write('xb.endReason', null);
    setUser(u);
  }, []);

  const login = useCallback(async (userId: string) => {
    const u = await api.login(userId, 'demo');
    completeLogin(u);
  }, [completeLogin]);

  const logout = useCallback((reason: string = 'manual') => {
    // сессия, уже аннулированная сервером (лимит, рабочее время, блокировка…), повторно не закрывается
    if (reason === 'manual' || reason === 'timeout') void api.logout(reason).catch(() => undefined);
    write('xb.endReason', reason === 'manual' ? null : reason);
    write('xb.user', null);
    write('xb.sid', null);
    write('xb.lastActive', null);
    setUser(null);
    window.location.hash = '/';
  }, []);

  const value = useMemo<Session>(
    () => ({
      user,
      lang,
      setLang,
      login,
      completeLogin,
      logout,
      t: (key) => translate(lang, key),
      loc: (v) => localize(v, lang),
    }),
    [user, lang, setLang, login, completeLogin, logout],
  );

  if (!ready) return null;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Для экранов, доступных только после входа. */
export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('No user');
  return user;
}

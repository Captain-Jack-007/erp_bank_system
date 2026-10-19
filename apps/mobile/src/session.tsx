import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, localize, setFormatLang, translate, type Lang, type Localized, type TKey, type User } from '@xb/shared';

interface Session {
  user: User | null;
  lang: Lang;
  setLang: (lang: Lang) => void;
  login: (userId: string) => Promise<User>;
  logout: () => void;
  t: (key: TKey) => string;
  loc: (value: Localized) => string;
}

const SessionContext = createContext<Session | null>(null);

// Сессия хранится в памяти. С бэкендом — токен в expo-secure-store.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [lang, setLangState] = useState<Lang>('ru');
  const setLang = (l: Lang) => {
    setFormatLang(l);
    setLangState(l);
  };

  const login = useCallback(async (userId: string) => {
    const u = await api.login(userId);
    setUser(u);
    return u;
  }, []);
  const logout = useCallback(() => setUser(null), []);

  const value = useMemo<Session>(
    () => ({ user, lang, setLang, login, logout, t: (k) => translate(lang, k), loc: (v) => localize(v, lang) }),
    [user, lang, login, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

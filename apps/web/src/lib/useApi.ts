// Загрузка данных через Api с автообновлением после любых изменений (api.subscribe).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@xb/shared';

export interface ApiState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => api.subscribe(reload), [reload]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadRef
      .current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, loading, error, reload };
}

/** Справочники, нужные почти на каждом экране, — загружаются один раз. */
export function useLookups() {
  const deps = useApi(() => api.listDepartments());
  const users = useApi(() => api.listUsers());
  const cps = useApi(() => api.listCounterparties());
  const budget = useApi(() => api.listBudgetLines());
  return {
    department: (id: string) => deps.data?.find((d) => d.id === id),
    user: (id: string) => users.data?.find((u) => u.id === id),
    counterparty: (id: string) => cps.data?.find((c) => c.id === id),
    budgetLine: (id: string) => budget.data?.find((b) => b.id === id),
    departments: deps.data ?? [],
    budgetLines: budget.data ?? [],
    counterparties: cps.data ?? [],
    users: users.data ?? [],
  };
}

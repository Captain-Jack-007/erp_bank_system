import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@xb/shared';

export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
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
      .then((v) => alive && setData(v))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, loading, reload };
}

import type { ReactNode } from 'react';

/** Маршрут экрана. Порядок в списке важен: '/x/new' должен идти раньше '/x/:id'. */
export interface ModuleRoute {
  path: string;
  render: (params: Record<string, string>) => ReactNode;
}

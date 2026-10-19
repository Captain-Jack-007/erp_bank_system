import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { matchPath, useLocation } from './lib/router';
import { SessionProvider, useSession } from './lib/session';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { ALL_ROUTES } from './modules';
import { moduleForPath, NoAccessPage, SessionGuard, StepUpProvider, useCan } from './lib/access';

function Router() {
  const { user } = useSession();
  const path = useLocation();
  const allowed = useCan();
  if (!user) return <LoginPage />;

  let page: ReactNode = <NotFoundPage />;
  for (const r of ALL_ROUTES) {
    const params = matchPath(r.path, path);
    if (params) {
      page = r.render(params);
      break;
    }
  }
  // Защита маршрутов (RBAC, P1-ORG): модуль без права «просмотр» → страница «Нет доступа».
  const owner = moduleForPath(path);
  if (owner && !allowed(owner.id, 'view')) page = <NoAccessPage moduleId={owner.id} />;
  return (
    <Layout path={path}>
      <div className="page" key={path}>
        {page}
      </div>
      <SessionGuard />
    </Layout>
  );
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <StepUpProvider>
          <Router />
        </StepUpProvider>
      </ToastProvider>
    </SessionProvider>
  );
}

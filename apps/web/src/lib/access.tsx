// Права доступа и защита сессии в вебе (P1-ORG):
//   useCan()        — (moduleId, level) => boolean по матрице прав ядра (обновляется после изменений матрицы)
//   moduleForPath() — какой модуль владеет маршрутом (для защиты маршрутов)
//   <StepUpProvider> + useStepUp() — повторный ввод одноразового кода для операций высокого риска (PR-GEN-043)
//   <SessionGuard>  — завершение сессии при бездействии с предупреждением за минуту (PR-SEC-011)
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, audit, AuthError, can, errorText, getSecurityPolicy, IS_DEMO_BUILD, monitoringApi, securityApi, type AccessLevel, integrationDesignerApi, maintenanceApi, serviceDeskApi } from '@xb/shared';
import { Button, Field, Input, Modal } from '../components/ui';
import { Link, matchPath } from './router';
import { browserLabel, useSession } from './session';
import { MODULES, type ModuleDef } from '../modules';
import '../platform.css';

/** Перерисовка при любом изменении данных (в т.ч. матрицы прав). */
function useDataTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => api.subscribe(() => setTick((n) => n + 1)), []);
  return tick;
}

/** Проверка права текущего пользователя: const canEdit = useCan()('warehouse', 'edit'). */
export function useCan(): (moduleId: string, level?: AccessLevel) => boolean {
  const { user } = useSession();
  useDataTick();
  return useCallback((moduleId: string, level: AccessLevel = 'view') => can(user, moduleId, level), [user]);
}

/** Модуль, которому принадлежит маршрут (по шаблонам маршрутов модуля, затем по префиксу пути). */
export function moduleForPath(fullPath: string): ModuleDef | undefined {
  const path = fullPath.split('?')[0]!;
  for (const m of MODULES) if (m.routes.some((r) => matchPath(r.path, path))) return m;
  return MODULES.filter((m) => m.path !== '/' && (path === m.path || path.startsWith(m.path + '/'))).sort((a, b) => b.path.length - a.path.length)[0];
}

// ---------- Step-up (подтверждение операции высокого риска) ----------

type StepUpFn = (action: string) => Promise<boolean>;
const StepUpContext = createContext<StepUpFn>(async () => true);

/** Запросить повторное подтверждение одноразовым кодом: if (!(await stepUp(t('…')))) return; */
export const useStepUp = (): StepUpFn => useContext(StepUpContext);

interface Pending {
  action: string;
  challengeId: string;
  demoCode: string;
  resolve: (ok: boolean) => void;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const { t } = useSession();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback<StepUpFn>(async (action) => {
    const ch = await securityApi.requestStepUp(action);
    return new Promise<boolean>((resolve) => {
      setCode('');
      setError('');
      setPending({ action, challengeId: ch.challengeId, demoCode: ch.demoCode, resolve });
    });
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  async function confirm() {
    if (!pending) return;
    if (!/^\d{6}$/.test(code.trim())) return setError(t('auth_otp_format'));
    setBusy(true);
    try {
      await securityApi.verifyStepUp(pending.challengeId, code);
      close(true);
    } catch (e) {
      setError(e instanceof AuthError && e.code === 'otp_expired' ? t('auth_otp_expired') : t('auth_otp_invalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepUpContext.Provider value={request}>
      {children}
      {pending && (
        <Modal
          title={t('stepup_title')}
          onClose={() => close(false)}
          footer={
            <>
              <Button onClick={() => close(false)}>{t('cancel')}</Button>
              <Button type="primary" loading={busy} onClick={confirm}>{t('stepup_confirm')}</Button>
            </>
          }
        >
          <div className="stepup">
            <p style={{ margin: 0 }}>{t('stepup_text')}</p>
            <div className="stepup-action">{pending.action}</div>
            <Field label={t('auth_otp_label')} required error={error}>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} autoFocus autoComplete="one-time-code" onPressEnter={confirm} ariaLabel={t('auth_otp_label')} className="otp-input" />
            </Field>
            {IS_DEMO_BUILD && pending.demoCode ? (
              <div className="demo-hint">
                {t('auth_demo_code')}: <b className="demo-code num">{pending.demoCode}</b>
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>{t('auth_prod_otp_hint')}</p>
            )}
          </div>
        </Modal>
      )}
    </StepUpContext.Provider>
  );
}

// ---------- Таймаут бездействия ----------

export function SessionGuard() {
  const { t, logout, user } = useSession();
  const [warnLeft, setWarnLeft] = useState<number | null>(null);
  const last = useRef(Date.now());
  const warnRef = useRef<number | null>(null);
  warnRef.current = warnLeft;

  useEffect(() => {
    audit.setClient({ ip: '10.12.0.15 (demo)', device: browserLabel() });
  }, []);

  useEffect(() => {
    if (!user) return;
    last.current = Date.now();
    let lastWrite = 0;
    const onActivity = () => {
      if (warnRef.current !== null) return; // во время предупреждения продлить можно только кнопкой
      last.current = Date.now();
      if (last.current - lastWrite > 5000) {
        lastWrite = last.current;
        try {
          window.localStorage.setItem('xb.lastActive', String(last.current));
        } catch {
          /* без хранилища */
        }
      }
    };
    // P3-GEN (PR-GEN-060/061): фоновая проверка состояния компонентов — инцидент и уведомление дежурному ≤ 5 мин
    let ticks = 0;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = window.setInterval(() => {
      // P3-GEN: проверка сессии на «сервере» — лимит параллельных сессий, длительность, рабочее время,
      // блокировка/деактивация, ротация ID после изменения полномочий (PR-SEC-012/038/039)
      const chk = securityApi.checkSession(securityApi.currentSessionId());
      if (!chk.ok) {
        window.clearInterval(timer);
        setWarnLeft(null);
        logout(chk.reason);
        return;
      }
      if (chk.rotated) {
        try {
          window.localStorage.setItem('xb.sid', chk.id);
        } catch {
          /* без хранилища */
        }
      }
      if (++ticks % 30 === 0) void monitoringApi.scan().catch(() => undefined);
      // P4-GEN: расписание интеграций из конструктора, напоминания о регламентных окнах, статусы Service Desk
      if (ticks % 30 === 0) {
        void integrationDesignerApi.runDue().catch(() => undefined);
        maintenanceApi.tick();
        void serviceDeskApi.sync({ userId: user.id }).catch(() => undefined);
      }
      const p = getSecurityPolicy().session;
      const idle = Date.now() - last.current;
      const limit = p.idleMinutes * 60_000;
      if (idle >= limit) {
        window.clearInterval(timer);
        setWarnLeft(null);
        logout('timeout');
      } else if (idle >= limit - p.warnSeconds * 1000) setWarnLeft(Math.ceil((limit - idle) / 1000));
      else setWarnLeft(null);
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(timer);
    };
  }, [user, logout]);

  if (warnLeft === null) return null;
  const extend = () => {
    last.current = Date.now();
    try {
      window.localStorage.setItem('xb.lastActive', String(last.current));
    } catch {
      /* без хранилища */
    }
    setWarnLeft(null);
  };
  return (
    <Modal
      title={t('idle_title')}
      onClose={extend}
      footer={
        <>
          <Button onClick={() => logout('manual')}>{t('logout')}</Button>
          <Button type="primary" onClick={extend}>{t('idle_continue')}</Button>
        </>
      }
    >
      <p style={{ margin: 0 }} className="idle-text">
        {t('idle_text')} <b className="num">{warnLeft}</b> {t('idle_seconds')}
      </p>
    </Modal>
  );
}

// ---------- Нет доступа ----------

export function NoAccessPage({ moduleId }: { moduleId: string }) {
  const { t } = useSession();
  useEffect(() => {
    audit.log({ action: 'view', entity: 'module', entityId: moduleId, result: 'failure', details: 'access denied' });
  }, [moduleId]);
  return (
    <div className="no-access">
      <div className="no-access-icon">403</div>
      <h1>{t('noaccess_title')}</h1>
      <p className="muted">{t('noaccess_text')}</p>
      <a className="btn btn-primary" href="#/">{t('noaccess_home')}</a>
    </div>
  );
}

// ---------- P4-SEC: ссылки с учётом прав и тексты ошибок ----------

/**
 * Ссылка на раздел с учётом матрицы прав: если у пользователя нет права на модуль маршрута — показывается
 * обычный текст (или ссылка fallback на разрешённую страницу), а не переход на «Нет доступа».
 */
export function GuardedLink({ to, children, fallback, level = 'view', className, hideIfDenied }: { to: string; children: ReactNode; fallback?: string; level?: AccessLevel; className?: string; hideIfDenied?: boolean }) {
  const allowed = useCan();
  const mod = moduleForPath(to);
  if (!mod || allowed(mod.id, level)) return <Link to={to} className={className}>{children}</Link>;
  if (fallback) {
    const fb = moduleForPath(fallback);
    if (!fb || allowed(fb.id, 'view')) return <Link to={fallback} className={className}>{children}</Link>;
  }
  if (hideIfDenied) return null;
  return <span className={`guarded-text ${className ?? ''}`.trim()} data-guarded={mod.id}>{children}</span>;
}

/** Текст ошибки API для пользователя (коды → словарь; технические подробности не показываются). PR-TEC-008. */
export function useErrorText(): (e: unknown) => string {
  const { lang } = useSession();
  return useCallback((e: unknown) => errorText(lang, e), [lang]);
}

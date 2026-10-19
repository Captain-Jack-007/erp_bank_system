// Минимальный hash-роутер без зависимостей: #/procurement/pr1
import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

export function useLocation(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

/** Параметры после «?» в hash: #/master-data?tab=users → tab=users */
export function useQuery(): URLSearchParams {
  const path = useLocation();
  const i = path.indexOf('?');
  return new URLSearchParams(i >= 0 ? path.slice(i + 1) : '');
}

export function navigate(path: string): void {
  window.location.hash = path;
}

/** Сопоставляет '/procurement/:id' с '/procurement/pr1' → { id: 'pr1' } */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('?')[0]!.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const val = a[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode };

export function Link({ to, children, ...rest }: LinkProps) {
  return (
    <a href={`#${to}`} {...rest}>
      {children}
    </a>
  );
}

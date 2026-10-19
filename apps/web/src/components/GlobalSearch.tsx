// Глобальный поиск в верхней панели: документы всех модулей + разделы меню.
import { useEffect, useRef, useState } from 'react';
import { api, matches, type SearchResult, type TKey } from '@xb/shared';
import { Icon } from './icons';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { MODULES } from '../modules';

export function GlobalSearch() {
  const { t, loc, lang } = useSession();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Разделы меню тоже ищутся — быстрый переход к модулю.
  const sections: SearchResult[] = q.trim().length >= 2
    ? MODULES.filter((m) => matches(q, typeof m.name === 'string' ? t(m.name) : loc(m.name), m.tz)).map((m) => ({
        group: 'search_sections',
        title: typeof m.name === 'string' ? t(m.name) : loc(m.name),
        subtitle: m.tz ? `${t('tzLabel')} ${m.tz}` : undefined,
        to: m.path,
      }))
    : [];
  const all = [...sections, ...results];

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      api.search(query, lang).then((r) => alive && setResults(r));
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, lang]);

  useEffect(() => setActive(0), [q]);

  // Активный пункт при навигации стрелками всегда виден.
  useEffect(() => {
    boxRef.current?.querySelector('.search-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = boxRef.current?.querySelector('input');
        input?.focus();
        input?.select();
        setOpen(true);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function go(r: SearchResult) {
    navigate(r.to);
    setOpen(false);
    setQ('');
    boxRef.current?.querySelector('input')?.blur();
  }

  const groupLabel = (g: string) => (g === 'search_sections' ? t('search_sections') : t(g as TKey));
  let lastGroup = '';

  return (
    <div className="topbar-search" ref={boxRef}>
      <Icon name="search" size={16} />
      <input
        className="input"
        placeholder={`${t('search')}… (Ctrl+K)`}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, all.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && all[active]) {
            go(all[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        aria-label={t('search')}
      />
      {open && q.trim().length >= 2 && (
        <div className="search-pop" role="listbox">
          {all.length === 0 && <div className="search-empty">{t('search_nothing')}</div>}
          {all.map((r, i) => {
            const header = r.group !== lastGroup ? groupLabel(r.group) : null;
            lastGroup = r.group;
            return (
              <div key={`${r.to}-${r.title}-${i}`}>
                {header && <div className="search-group">{header}</div>}
                <button
                  className={`search-item ${i === active ? 'on' : ''}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                >
                  <span className="search-title">{r.title}</span>
                  {r.subtitle && <span className="search-sub">{r.subtitle}</span>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

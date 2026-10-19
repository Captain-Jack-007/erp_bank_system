// Переключатель языка интерфейса (ТЗ 4.1.5, 4.3.5): RU · O‘Z · ЎЗ · EN.
// Сегментированный контрол в духе antd <Segmented options=[{value,label}] />; выбор сохраняется в сессии.
import { LANGS, LANG_LABELS, type Lang } from '@xb/shared';
import { useSession } from '../lib/session';

export function LangSwitch({ size = 'default' }: { size?: 'default' | 'small' }) {
  const { lang, setLang, t } = useSession();
  return (
    <div className={`lang-switch${size === 'small' ? ' lang-switch-sm' : ''}`} role="radiogroup" aria-label={t('language')}>
      {LANGS.map((l: Lang) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          lang={l === 'uzc' ? 'uz-Cyrl' : l === 'uz' ? 'uz-Latn' : l}
          title={LANG_LABELS[l].name}
          className={lang === l ? 'on' : ''}
          onClick={() => setLang(l)}
        >
          {LANG_LABELS[l].short}
        </button>
      ))}
    </div>
  );
}

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LANGS, LANG_LABELS, tk, type Lang } from '@xb/shared';
import { colors, radius, space } from './theme';
import { useSession } from './session';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';
const TONE: Record<Tone, { fg: string; bg: string }> = {
  ok: { fg: colors.ok, bg: colors.okBg },
  warn: { fg: colors.warn, bg: colors.warnBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  info: { fg: colors.info, bg: colors.infoBg },
  muted: { fg: colors.text2, bg: colors.mutedBg },
};
const STATUS_TONE: Record<string, Tone> = {
  draft: 'muted', pending: 'warn', approved: 'ok', rejected: 'danger', in_tender: 'info', contracted: 'ok',
  active: 'ok', expired: 'muted', terminated: 'danger', in_progress: 'info', done: 'ok',
};

export function Badge({ tone, label }: { tone: Tone; label: string }) {
  const c = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: c.fg }]} />
      <Text style={[styles.badgeText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ prefix, status }: { prefix: 'pstatus_' | 'cstatus_' | 'rstatus_'; status: string }) {
  const { t } = useSession();
  return <Badge tone={STATUS_TONE[status] ?? 'muted'} label={t(tk(prefix, status))} />;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
}) {
  const v = variant === 'primary' ? styles.btnPrimary : variant === 'danger' ? styles.btnDanger : styles.btnSecondary;
  const tc = variant === 'primary' ? '#fff' : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.btn, v, (pressed || disabled) && { opacity: 0.7 }]}
    >
      {loading ? <ActivityIndicator color={tc} /> : <Text style={[styles.btnText, { color: tc }]}>{label}</Text>}
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <Text style={{ color: colors.text3 }}>{text}</Text>
    </View>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {typeof value === 'string' ? <Text style={styles.rowValue}>{value}</Text> : value}
    </View>
  );
}

export function LangToggle({ lang, onChange, dark }: { lang: Lang; onChange: (l: Lang) => void; dark?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: dark ? colors.border : 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
      {LANGS.map((l) => (
        <Pressable key={l} onPress={() => onChange(l)} style={{ paddingHorizontal: 9, paddingVertical: 6, backgroundColor: lang === l ? (dark ? colors.brand600 : '#fff') : 'transparent' }}>
          <Text style={{ fontWeight: '700', fontSize: 12, color: lang === l ? (dark ? '#fff' : colors.brand700) : dark ? colors.text2 : '#fff' }}>{LANG_LABELS[l].short}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  btn: { height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, flex: 1 },
  btnPrimary: { backgroundColor: colors.brand600 },
  btnDanger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#f1c4bf' },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  btnText: { fontSize: 15, fontWeight: '600' },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 2 },
  rowLabel: { fontSize: 12.5, color: colors.text3 },
  rowValue: { fontSize: 15, color: colors.text, fontWeight: '500' },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.text3, fontSize: 13 },
  docNum: { color: colors.brand700, fontWeight: '600', fontSize: 13 },
  input: {
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.text2, marginBottom: 6 },
});

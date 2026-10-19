import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, tk } from '@xb/shared';
import { useSession } from '../../src/session';
import { useApi } from '../../src/useApi';
import { Button, Card, LangToggle, Row, styles } from '../../src/ui';
import { colors } from '../../src/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, t, loc, lang, setLang, logout } = useSession();
  const deps = useApi(() => api.listDepartments());
  if (!user) return null;
  const dept = deps.data?.find((d) => d.id === user.departmentId);
  const initials = user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card style={{ alignItems: 'center', gap: 6 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brand100, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.brand700, fontWeight: '700', fontSize: 22 }}>{initials}</Text>
        </View>
        <Text style={styles.h1}>{user.fullName}</Text>
        <Text style={styles.muted}>{loc(user.position)}</Text>
      </Card>
      <Card>
        <Row label={t('department')} value={dept ? loc(dept.name) : '—'} />
        <Row label={t('type')} value={t(tk('role_', user.role))} />
        <Row label="Email" value={user.email} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12 }}>
          <Text style={styles.rowLabel}>{t('language')}</Text>
          <LangToggle lang={lang} onChange={setLang} dark />
        </View>
      </Card>
      <Text style={[styles.muted, { textAlign: 'center' }]}>{t('demoMode')}</Text>
      <View style={{ flexDirection: 'row' }}>
        <Button
          label={t('logout')}
          variant="secondary"
          onPress={() => {
            logout();
            router.replace('/');
          }}
        />
      </View>
    </ScrollView>
  );
}

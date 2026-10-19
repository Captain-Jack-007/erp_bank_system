// Экран входа (демо: выбор пользователя). С бэкендом — логин через AD/Keycloak.
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, tk } from '@xb/shared';
import { useSession } from '../src/session';
import { useApi } from '../src/useApi';
import { Button, LangToggle, styles } from '../src/ui';
import { colors } from '../src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { t, loc, lang, setLang, login } = useSession();
  const users = useApi(() => api.listUsers());
  const [selected, setSelected] = useState('u2');
  const [busy, setBusy] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.brand800 }}>
      <SafeAreaView edges={['top']} style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.brand700, fontWeight: '800', fontSize: 16 }}>XB</Text>
            </View>
            <View>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17 }}>{t('appName')}</Text>
              <Text style={{ color: '#a9cdb8', fontSize: 12 }}>{t('bankName')}</Text>
            </View>
          </View>
          <LangToggle lang={lang} onChange={setLang} />
        </View>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700', marginTop: 28 }}>{t('loginTitle')}</Text>
        <Text style={{ color: '#cfe7d8', marginTop: 6 }}>{t('loginSubtitle')}</Text>
      </SafeAreaView>

      <View style={{ flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
          <Text style={styles.label}>{t('loginChooseUser')}</Text>
          {users.data?.map((u) => {
            const on = selected === u.id;
            return (
              <Pressable
                key={u.id}
                onPress={() => setSelected(u.id)}
                style={{
                  backgroundColor: on ? colors.brand50 : '#fff',
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? colors.brand600 : colors.border,
                  borderRadius: 12,
                  padding: on ? 11 : 12,
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 15, color: colors.text }}>{u.fullName}</Text>
                <Text style={styles.muted}>
                  {t(tk('role_', u.role))} · {loc(u.position)}
                </Text>
              </Pressable>
            );
          })}
          <Text style={[styles.muted, { marginTop: 6 }]}>{t('demoMode')}</Text>
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={{ padding: 20, paddingTop: 8, flexDirection: 'row' }}>
          <Button
            label={t('loginButton')}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await login(selected);
                router.replace('/approvals');
              } finally {
                setBusy(false);
              }
            }}
          />
        </SafeAreaView>
      </View>
    </View>
  );
}

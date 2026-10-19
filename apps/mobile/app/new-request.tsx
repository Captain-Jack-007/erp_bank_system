import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, tk, type EmployeeRequestType } from '@xb/shared';
import { useSession } from '../src/session';
import { Button, styles } from '../src/ui';
import { colors } from '../src/theme';

const TYPES: EmployeeRequestType[] = ['certificate', 'equipment', 'it_access', 'vacation', 'pass', 'repair'];

export default function NewRequestScreen() {
  const router = useRouter();
  const { user, t } = useSession();
  const [type, setType] = useState<EmployeeRequestType>('equipment');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!user) return;
    if (!description.trim()) {
      Alert.alert(t('formRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.createEmployeeRequest({ type, description: description.trim() }, user);
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        <View>
          <Text style={styles.label}>{t('requestType')} *</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map((x) => {
              const on = x === type;
              return (
                <Pressable
                  key={x}
                  onPress={() => setType(x)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1,
                    borderColor: on ? colors.brand600 : colors.borderStrong,
                    backgroundColor: on ? colors.brand600 : '#fff',
                  }}
                >
                  <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '600' }}>{t(tk('rtype_', x))}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View>
          <Text style={styles.label}>{t('description')} *</Text>
          <TextInput style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline value={description} onChangeText={setDescription} />
        </View>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
        <Button label={t('cancel')} variant="secondary" onPress={() => router.back()} />
        <Button label={t('create')} loading={busy} onPress={submit} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, formatDateTime, tk } from '@xb/shared';
import { useSession } from '../../src/session';
import { useApi } from '../../src/useApi';
import { Empty, StatusBadge, styles } from '../../src/ui';
import { colors } from '../../src/theme';

export default function RequestsScreen() {
  const router = useRouter();
  const { user, t } = useSession();
  const list = useApi(async () => (user ? api.listEmployeeRequests(user) : []), [user?.id]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list.data ?? []}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={colors.brand600} />}
        ListEmptyComponent={list.loading ? null : <Empty text={t('empty')} />}
        renderItem={({ item }) => {
          const last = item.history[item.history.length - 1];
          return (
            <View style={[styles.card, { gap: 6 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.docNum}>{item.number}</Text>
                <StatusBadge prefix="rstatus_" status={item.status} />
              </View>
              <Text style={{ fontWeight: '600', color: colors.text }}>{t(tk('rtype_', item.type))}</Text>
              <Text style={{ color: colors.text2 }}>{item.description}</Text>
              {last?.comment && <Text style={[styles.muted, { fontStyle: 'italic' }]}>{last.comment}</Text>}
              <Text style={styles.muted}>{formatDateTime(item.createdAt)}</Text>
            </View>
          );
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('newRequest')}
        onPress={() => router.push('/new-request')}
        style={{
          position: 'absolute', right: 20, bottom: 24, height: 52, borderRadius: 26, paddingHorizontal: 20,
          backgroundColor: colors.brand600, flexDirection: 'row', alignItems: 'center', gap: 8,
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
        }}
      >
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('newRequest')}</Text>
      </Pressable>
    </View>
  );
}

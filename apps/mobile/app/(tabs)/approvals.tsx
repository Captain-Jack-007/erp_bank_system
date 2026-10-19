import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, formatDateTime, formatMoney, isOverdue, tk, type ApprovalTask } from '@xb/shared';
import { useSession } from '../../src/session';
import { useApi } from '../../src/useApi';
import { Badge, Empty, styles } from '../../src/ui';
import { colors } from '../../src/theme';

// Иконки по типам документов; для новых типов — общая иконка документа.
const ICON: Partial<Record<ApprovalTask['entity'], keyof typeof Ionicons.glyphMap>> = {
  procurement: 'cart-outline',
  contract: 'document-text-outline',
  employee_request: 'mail-unread-outline',
  business_trip: 'airplane-outline',
  einvoice: 'receipt-outline',
  budget_change: 'wallet-outline',
  document: 'document-outline',
  asset_writeoff: 'business-outline',
  mdm_change: 'library-outline', // P4 (PR-MDM-003)
};

export default function ApprovalsScreen() {
  const router = useRouter();
  const { user, t } = useSession();
  const list = useApi(async () => (user ? api.listApprovals(user) : []), [user?.id]);

  return (
    <FlatList
      data={list.data ?? []}
      keyExtractor={(x) => x.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={colors.brand600} />}
      ListHeaderComponent={<Text style={[styles.muted, { marginBottom: 4 }]}>{t('approvalsSubtitle')}</Text>}
      ListEmptyComponent={list.loading ? null : <Empty text={t('approvalsEmpty')} />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/approval/${item.id}`)}
          style={({ pressed }) => [styles.card, { flexDirection: 'row', gap: 12, opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.brand50, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={ICON[item.entity] ?? 'document-outline'} size={20} color={colors.brand700} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.docNum}>
              {t(tk('entity_', item.entity))} · {item.number}
            </Text>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }} numberOfLines={2}>
              {item.title}
            </Text>
            {item.amount !== undefined && <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{formatMoney(item.amount, item.currency)}</Text>}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.muted}>
                {t('step')} {item.step} {t('of')} {item.totalSteps}
              </Text>
              {isOverdue(item.dueAt) ? <Badge tone="danger" label={t('overdue')} /> : <Text style={styles.muted}>{formatDateTime(item.dueAt)}</Text>}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text3} style={{ alignSelf: 'center' }} />
        </Pressable>
      )}
    />
  );
}

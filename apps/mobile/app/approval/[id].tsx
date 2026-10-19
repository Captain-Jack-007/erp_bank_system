// Карточка согласования: данные документа + решение (согласовать / отклонить с причиной).
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, formatDate, formatMoney, procurementTotal, ROUTES, tk } from '@xb/shared';
import { useSession } from '../../src/session';
import { useApi } from '../../src/useApi';
import { Button, Card, Empty, Row, styles } from '../../src/ui';
import { colors } from '../../src/theme';

export default function ApprovalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, t } = useSession();
  const tasks = useApi(async () => (user ? api.listApprovals(user) : []), [user?.id]);
  const users = useApi(() => api.listUsers());
  const task = tasks.data?.find((x) => x.id === id);
  const procurement = useApi(async () => (task?.entity === 'procurement' ? api.getProcurement(task.entityId) : undefined), [task?.entityId]);
  const contract = useApi(async () => (task?.entity === 'contract' ? api.getContract(task.entityId) : undefined), [task?.entityId]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  if (!task) return tasks.loading ? null : <Empty text={t('approvalsEmpty')} />;

  const requester = users.data?.find((u) => u.id === task.requesterId);
  const route = ROUTES[task.entity];

  async function decide(decision: 'approve' | 'reject') {
    if (!user || !task) return;
    if (decision === 'reject' && !reason.trim()) {
      Alert.alert(t('rejectReasonRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.decideApproval(task.id, user, decision, decision === 'reject' ? reason.trim() : undefined);
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Card>
          <Text style={styles.docNum}>
            {t(tk('entity_', task.entity))} · {task.number}
          </Text>
          <Text style={{ fontSize: 19, fontWeight: '700', color: colors.text, marginTop: 4 }}>{task.title}</Text>
          {task.amount !== undefined && (
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.brand700, marginTop: 10 }}>{formatMoney(task.amount, task.currency)}</Text>
          )}
          <View style={{ marginTop: 8 }}>
            <Row label={t('initiator')} value={requester?.fullName ?? '—'} />
            <Row label={t('step')} value={`${task.step} ${t('of')} ${task.totalSteps} · ${t(tk('role_', task.assigneeRole))}`} />
            <Row label={t('dueAt')} value={formatDate(task.dueAt)} />
            {procurement.data && <Row label={t('justification')} value={procurement.data.justification} />}
            {procurement.data && <Row label={t('neededBy')} value={formatDate(procurement.data.neededBy)} />}
            {contract.data && <Row label={t('period')} value={`${formatDate(contract.data.startDate)} — ${formatDate(contract.data.endDate)}`} />}
          </View>
        </Card>

        {procurement.data && (
          <Card>
            <Text style={[styles.label, { marginBottom: 2 }]}>{t('items')}</Text>
            {procurement.data.items.map((it, i) => (
              <View key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '500' }}>{it.name}</Text>
                <Text style={styles.muted}>
                  {it.qty} {it.unit} × {formatMoney(it.unitPrice)}
                </Text>
              </View>
            ))}
            <Text style={{ textAlign: 'right', fontWeight: '700', marginTop: 8, color: colors.text }}>
              {t('total')}: {formatMoney(procurementTotal(procurement.data.items))}
            </Text>
          </Card>
        )}

        <Card>
          <Text style={styles.label}>{t('route')}</Text>
          {route.map((r, i) => (
            <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <View
                style={{
                  width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: i + 1 < task.step ? colors.ok : i + 1 === task.step ? colors.brand600 : colors.mutedBg,
                }}
              >
                <Text style={{ color: i + 1 <= task.step ? '#fff' : colors.text3, fontSize: 11, fontWeight: '700' }}>{i + 1}</Text>
              </View>
              <Text style={{ color: i + 1 === task.step ? colors.text : colors.text2, fontWeight: i + 1 === task.step ? '700' : '400' }}>{t(tk('role_', r))}</Text>
            </View>
          ))}
        </Card>

        {rejecting && (
          <Card>
            <Text style={styles.label}>{t('rejectReason')} *</Text>
            <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline autoFocus value={reason} onChangeText={setReason} />
          </Card>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={{ flexDirection: 'row', gap: 10, padding: 16, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
        {rejecting ? (
          <>
            <Button label={t('cancel')} variant="secondary" onPress={() => setRejecting(false)} />
            <Button label={t('reject')} variant="danger" loading={busy} onPress={() => decide('reject')} />
          </>
        ) : (
          <>
            <Button label={t('reject')} variant="danger" disabled={busy} onPress={() => setRejecting(true)} />
            <Button label={t('approve')} loading={busy} onPress={() => decide('approve')} />
          </>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

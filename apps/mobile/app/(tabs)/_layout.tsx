import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@xb/shared';
import { useSession } from '../../src/session';
import { useApi } from '../../src/useApi';
import { colors } from '../../src/theme';

export default function TabsLayout() {
  const { user, t } = useSession();
  const approvals = useApi(async () => (user ? api.listApprovals(user) : []), [user?.id]);
  if (!user) return <Redirect href="/" />;
  const count = approvals.data?.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.brand700 },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
        tabBarActiveTintColor: colors.brand600,
        tabBarInactiveTintColor: colors.text3,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="approvals"
        options={{
          title: t('tabApprovals'),
          tabBarBadge: count > 0 ? count : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: '#2b2104' },
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: t('tabRequests'),
          tabBarIcon: ({ color, size }) => <Ionicons name="file-tray-full-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabProfile'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

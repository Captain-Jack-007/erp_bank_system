import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../src/session';
import { colors } from '../src/theme';

function RootStack() {
  const { t } = useSession();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.brand700 },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: t('back'),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="approval/[id]" options={{ title: t('approvalsTitle') }} />
      <Stack.Screen name="new-request" options={{ title: t('newRequest'), presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <RootStack />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PrototypeProvider } from '../App';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PrototypeProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#F6F5EF" />
        <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: '#F6F5EF' }}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          </Stack>
        </SafeAreaView>
      </PrototypeProvider>
    </SafeAreaProvider>
  );
}

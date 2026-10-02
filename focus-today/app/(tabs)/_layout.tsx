import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, TourGate } from '../../App';

const NAV: Record<string, { label: string; icon: string }> = {
  index: { label: 'Today', icon: '◷' },
  plan: { label: 'Plan', icon: '▦' },
  inbox: { label: 'Inbox', icon: '↓' },
  review: { label: 'Review', icon: '✓' },
  week: { label: 'Week', icon: '▤' },
};

function TabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { height: 58 + insets.bottom, paddingBottom: Math.max(insets.bottom, 2) }]}>
      {state.routes.map((route: any, index: number) => {
        const selected = state.index === index;
        const item = NAV[route.name] ?? { label: route.name, icon: '·' };
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!selected && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable key={route.key} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={item.label} style={styles.item}>
            <View style={[styles.iconBox, selected && styles.iconActive]}><Text style={[styles.icon, selected && styles.iconSelected]}>{item.icon}</Text></View>
            <Text style={[styles.label, selected && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  return (
    <View style={styles.screen}>
      <AppHeader />
      <Tabs initialRouteName="index" screenOptions={{ headerShown: false, animation: 'fade' }} tabBar={(props) => <TabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: 'Today' }} />
        <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
        <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
        <Tabs.Screen name="review" options={{ title: 'Review' }} />
        <Tabs.Screen name="week" options={{ title: 'Week' }} />
      </Tabs>
      <TourGate />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F5EF' },
  bar: { height: 66, backgroundColor: '#FCFCF8', borderTopWidth: 1, borderTopColor: '#EAEAE2', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 8 },
  item: { width: 61, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconBox: { minWidth: 39, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: '#E4EEE6' }, icon: { color: '#969E96', fontSize: 17, fontWeight: '600' }, iconSelected: { color: '#295840' },
  label: { color: '#959C95', fontSize: 8, fontWeight: '600' }, labelActive: { color: '#295840', fontWeight: '800' },
});

import { Tabs } from 'expo-router';
import { Text } from 'react-native';

// 底部 4 个 Tab：社区 / 地图 / 采集 / 我的
// 默认进入 index（社区）。图标先用 emoji，零依赖，不会报错。
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#3FA34D',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarLabelStyle: { fontSize: 11 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '社区',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>👥</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: '地图',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>🗺️</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="collect"
        options={{
          title: '采集',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>📷</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>👤</Text>
          ),
        }}
      />
    </Tabs>
  );
}

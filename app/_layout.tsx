import { Stack } from 'expo-router';

// ⚠️ 这是「最外层」的根导航，是一个 Stack（栈式导航）。
// 想象成一摞卡片：4 个 Tab 是最底下那张；从「我的」点进子页面，
// 就是往上压一张新卡片，自动带「← 返回」箭头和标题栏，点返回再弹掉。
//
// 注意：项目里现在会有【两个】_layout.tsx——
//   · app/_layout.tsx        ← 就是这个文件，新的，负责 Stack
//   · app/(tabs)/_layout.tsx ← 你原来那个，没变，负责底部 4 个 Tab
// 别搞混了。
export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: '#3FA34D', // 返回箭头 + 标题文字：主题绿
        headerStyle: { backgroundColor: '#F5F7F2' }, // 标题栏底色，和 App 背景一致
        headerShadowVisible: false, // 去掉标题栏下面那条灰线，更扁平干净
        headerBackTitle: '返回',
      }}>
      {/* (tabs) 这一组就是 4 个底部 Tab，它自己管布局，所以这里把标题栏藏掉 */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      {/* 下面是从「我的」点进去的 5 个子页面，文件名 = 路由名，要一一对上 */}
      <Stack.Screen name="footprints" options={{ title: '我的足迹' }} />
      <Stack.Screen name="permissions" options={{ title: '权限管理' }} />
      <Stack.Screen name="privacy" options={{ title: '隐私设置' }} />
      <Stack.Screen name="settings" options={{ title: '系统设置' }} />
      <Stack.Screen name="login" options={{ title: '登录 / 注册' }} />
    </Stack>
  );
}

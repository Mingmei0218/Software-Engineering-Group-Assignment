import { useRouter } from 'expo-router';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// 菜单：文字 + 点进去要跳的子页面路由（route 必须和 app/ 下的文件名对上）
const MENU = [
  { label: '我的足迹', route: '/footprints' },
  { label: '权限管理', route: '/permissions' },
  { label: '隐私设置', route: '/privacy' },
  { label: '系统设置', route: '/settings' },
] as const;

export default function ProfileScreen() {
  const router = useRouter(); // expo-router 提供的"跳转遥控器"

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 头像区：点一下去登录/注册页 */}
      <TouchableOpacity
        style={styles.profileHeader}
        activeOpacity={0.7}
        onPress={() => router.push('/login')}>
        <View style={styles.avatar} />
        <Text style={styles.name}>公园探索者</Text>
        <Text style={styles.subtitle}>点击登录 / 注册</Text>
      </TouchableOpacity>

      <View style={styles.stats}>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>0</Text>
          <Text style={styles.statLabel}>总疗愈时长(min)</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>--</Text>
          <Text style={styles.statLabel}>平均疗愈指数</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {MENU.map((m) => (
          <TouchableOpacity
            key={m.route}
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => router.push(m.route)}>
            <Text style={styles.menuText}>{m.label}</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  profileHeader: { alignItems: 'center', paddingTop: 24, paddingBottom: 20 },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#CDE7D0',
    marginBottom: 12,
  },
  name: { fontSize: 20, fontWeight: '700', color: '#1F2937' },
  subtitle: { fontSize: 13, color: '#9CA3AF', marginTop: 4 },
  stats: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 16,
    paddingVertical: 20,
    marginBottom: 16,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: '#EAEEE6' },
  statNum: { fontSize: 24, fontWeight: '800', color: '#3FA34D' },
  statLabel: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 14,
  },
  menuText: { fontSize: 15, color: '#1F2937' },
  menuArrow: { fontSize: 22, color: '#C0C4CC' },
});

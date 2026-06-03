import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function SettingsScreen() {
  // 深色模式：先做成"能拨动的开关"，真正换肤是后面的活儿（纯前端，不急）
  const [darkMode, setDarkMode] = useState(false);
  // 距离单位：公里 / 英里 来回切
  const [unitKm, setUnitKm] = useState(true);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      showsVerticalScrollIndicator={false}>
      {/* 一、偏好设置 */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>深色模式</Text>
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            trackColor={{ true: '#3FA34D', false: '#D1D5DB' }}
          />
        </View>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() => setUnitKm((p) => !p)}>
          <Text style={styles.label}>距离单位</Text>
          <Text style={styles.value}>{unitKm ? '公里 (km) ›' : '英里 (mi) ›'}</Text>
        </TouchableOpacity>
      </View>

      {/* 二、通用 */}
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() => Alert.alert('清除缓存', '缓存已清除 ✅')}>
          <Text style={styles.label}>清除缓存</Text>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() =>
            Alert.alert('关于 Park20', 'Park20 · 公园疗愈采集\n版本 0.1.0')
          }>
          <Text style={styles.label}>关于 Park20</Text>
          <Text style={styles.value}>v0.1.0</Text>
        </TouchableOpacity>
      </View>

      {/* 三、退出登录：要等账号体系接好后端才真正生效 */}
      <TouchableOpacity
        style={styles.logout}
        activeOpacity={0.8}
        onPress={() =>
          // 🔗 后端：真正退出 = 清掉本地保存的 token + 通知后端登出
          Alert.alert('退出登录', '账号功能接入队友后端后才生效 🔗')
        }>
        <Text style={styles.logoutText}>退出登录</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  label: { fontSize: 15, color: '#1F2937' },
  value: { fontSize: 14, color: '#6B7280' },
  arrow: { fontSize: 22, color: '#C0C4CC' },
  divider: { height: 1, backgroundColor: '#F0F2EC' },
  logout: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutText: { fontSize: 15, color: '#E5573F', fontWeight: '600' },
});

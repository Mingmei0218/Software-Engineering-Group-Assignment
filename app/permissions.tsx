import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

// 用一个联合类型把"有哪些权限"写死，TS 会帮你挡掉拼错的 key
type PermKey = 'location' | 'camera' | 'health' | 'notification';

const ITEMS: { key: PermKey; title: string; desc: string }[] = [
  { key: 'location', title: '位置 / GPS', desc: '记录你在公园的轨迹、计算疗愈指数' },
  { key: 'camera', title: '相机', desc: '拍照测算绿视率' },
  { key: 'health', title: '健康数据', desc: '读取心率，评估身心放松程度' },
  { key: 'notification', title: '通知', desc: '采集完成、每周报告提醒' },
];

export default function PermissionsScreen() {
  // ⚠️ 这些开关现在只是"界面演示"，拨动只改变屏幕上的状态。
  // 🔗 真正向 iOS 系统申请权限，要等装了 expo-location（定位）、
  //    expo-image-picker / expo-camera（相机）之后再接上——这些都不需要后端。
  const [state, setState] = useState<Record<PermKey, boolean>>({
    location: true,
    camera: true,
    health: false,
    notification: false,
  });

  const toggle = (key: PermKey) =>
    setState((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        {ITEMS.map((it, i) => (
          <View key={it.key}>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.title}>{it.title}</Text>
                <Text style={styles.desc}>{it.desc}</Text>
              </View>
              <Switch
                value={state[it.key]}
                onValueChange={() => toggle(it.key)}
                trackColor={{ true: '#3FA34D', false: '#D1D5DB' }}
              />
            </View>
            {/* 除了最后一项，行之间画一条浅分割线 */}
            {i < ITEMS.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </View>

      <Text style={styles.hint}>
        这些权限以后也能随时在 iOS「设置 › Park20」里调整。
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  card: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  title: { fontSize: 15, color: '#1F2937', fontWeight: '500' },
  desc: { fontSize: 12, color: '#9CA3AF', marginTop: 3 },
  divider: { height: 1, backgroundColor: '#F0F2EC' },
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: 14, paddingHorizontal: 4 },
});

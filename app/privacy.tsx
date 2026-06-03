import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

type PrivacyKey = 'research' | 'publicFootprint' | 'showScore' | 'recommend';

const ITEMS: { key: PrivacyKey; title: string; desc: string }[] = [
  {
    key: 'research',
    title: '匿名贡献科研数据',
    desc: '把去除个人信息的采集数据用于公园疗愈研究',
  },
  {
    key: 'publicFootprint',
    title: '公开我的足迹',
    desc: '允许其他用户看到我去过的公园',
  },
  { key: 'showScore', title: '公开我的疗愈指数', desc: '在社区作品上展示分数' },
  { key: 'recommend', title: '个性化推荐', desc: '根据偏好推荐公园和内容' },
];

export default function PrivacyScreen() {
  // 🔗 后端：这些隐私开关将来要随账号同步到队友后端（比如"是否同意匿名贡献"
  //    会影响数据要不要进科研数据集）。现在先纯前端记住状态，立好界面。
  const [state, setState] = useState<Record<PrivacyKey, boolean>>({
    research: true,
    publicFootprint: false,
    showScore: true,
    recommend: true,
  });

  const toggle = (key: PrivacyKey) =>
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
            {i < ITEMS.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </View>

      <Text style={styles.hint}>
        我们只在你同意时收集数据，且科研用途的数据都会去除可识别个人的信息。
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
  hint: { fontSize: 12, color: '#9CA3AF', marginTop: 14, paddingHorizontal: 4, lineHeight: 18 },
});

import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const POSTS = [
  { id: 1, name: '小绿', score: 86, text: '今天在朝阳公园散步，心情超好，绿视率拉满～' },
  { id: 2, name: '阿树', score: 72, text: '湖边录到好多鸟叫声 🐦 治愈值满分' },
  { id: 3, name: '清风', score: 91, text: '樱花季限定！空气都是甜的' },
  { id: 4, name: '小满', score: 65, text: '雨后的公园格外清新，适合慢跑' },
];

function scoreColor(s: number) {
  if (s >= 80) return '#3FA34D';
  if (s >= 50) return '#E6A23C';
  return '#E5573F';
}

export default function CommunityScreen() {
  // 搜索框输入的文字
  const [query, setQuery] = useState('');
  // 根据输入实时过滤（按昵称或内容匹配）
  const list = POSTS.filter(
    (p) => p.name.includes(query) || p.text.includes(query)
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>社区</Text>
        <TouchableOpacity
          style={styles.publishBtn}
          onPress={() => Alert.alert('发布', '发布功能开发中 🌱')}>
          <Text style={styles.publishText}>＋ 发布</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          placeholder="搜索体验、公园、话题"
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>没有找到「{query}」相关内容</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.grid}>
          {list.map((p) => (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.avatar} />
                <Text style={styles.nickname}>{p.name}</Text>
              </View>
              <View style={styles.cover}>
                <Text style={[styles.coverScore, { color: scoreColor(p.score) }]}>
                  {p.score}
                </Text>
                <Text style={styles.coverLabel}>疗愈指数</Text>
              </View>
              <Text style={styles.cardText} numberOfLines={2}>
                {p.text}
              </Text>
              <View style={styles.actions}>
                <Text style={styles.action}>♡ 12</Text>
                <Text style={styles.action}>💬 3</Text>
                <Text style={styles.action}>☆ 5</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: { fontSize: 26, fontWeight: '700', color: '#1F2937' },
  publishBtn: {
    backgroundColor: '#3FA34D',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  publishText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
  },
  searchIcon: { fontSize: 15, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 14, color: '#1F2937' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 14, color: '#9CA3AF' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#CDE7D0',
    marginRight: 8,
  },
  nickname: { fontSize: 13, color: '#374151', fontWeight: '500' },
  cover: {
    height: 90,
    borderRadius: 12,
    backgroundColor: '#EDF5EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  coverScore: { fontSize: 32, fontWeight: '800' },
  coverLabel: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  cardText: { fontSize: 13, color: '#4B5563', lineHeight: 18, marginBottom: 10 },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { fontSize: 12, color: '#9CA3AF' },
});

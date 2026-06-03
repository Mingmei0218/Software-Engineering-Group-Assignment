import { useCallback, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getRecords, clearRecords } from '../lib/db';

type TrackRecord = {
  id: number;
  created_at: number;
  duration_sec: number;
  distance_m: number | null;
  avg_hr: number | null;
  green_view: number | null;
};

function fmtDate(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}
function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}
function fmtDistance(m: number | null) {
  if (m == null) return '--';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
function greenColor(v: number) {
  if (v >= 30) return '#3FA34D';
  if (v >= 15) return '#E6A23C';
  return '#E5573F';
}

export default function FootprintsScreen() {
  const [records, setRecords] = useState<TrackRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = (await getRecords()) as TrackRecord[];
      setRecords(rows);
    } catch (e) {
      // 表还没建好等情况，忽略即可
    }
  }, []);

  // 每次进入这个页面都重新读一遍（采集完返回就能看到新记录）
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleClear = () => {
    Alert.alert('清空记录', '确定删除所有本地采集记录吗？此操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await clearRecords();
          load();
        },
      },
    ]);
  };

  const totalMin = Math.round(
    records.reduce((s, r) => s + r.duration_sec, 0) / 60
  );
  const totalDist = records.reduce((s, r) => s + (r.distance_m ?? 0), 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3FA34D"
        />
      }>
      {/* 顶部汇总 */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNum}>{records.length}</Text>
          <Text style={styles.summaryLabel}>次采集</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNum}>{totalMin}</Text>
          <Text style={styles.summaryLabel}>总时长 (分)</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNum}>{fmtDistance(totalDist)}</Text>
          <Text style={styles.summaryLabel}>总距离</Text>
        </View>
      </View>

      {records.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🌿</Text>
          <Text style={styles.emptyTitle}>还没有采集记录</Text>
          <Text style={styles.emptySub}>
            去「采集」页点开始，结束后这里就会出现你的足迹
          </Text>
        </View>
      ) : (
        records.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.date}>{fmtDate(r.created_at)}</Text>
              {r.green_view != null && (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: greenColor(r.green_view) },
                  ]}>
                  <Text style={styles.badgeText}>
                    绿视率 {r.green_view.toFixed(0)}%
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Text style={styles.metaIcon}>⏱️</Text>
                <Text style={styles.metaText}>{fmtDuration(r.duration_sec)}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaIcon}>📏</Text>
                <Text style={styles.metaText}>{fmtDistance(r.distance_m)}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaIcon}>❤️</Text>
                <Text style={styles.metaText}>
                  {r.avg_hr != null ? `${r.avg_hr} bpm` : '--'}
                </Text>
              </View>
            </View>
          </View>
        ))
      )}

      {records.length > 0 && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={handleClear}
          activeOpacity={0.7}>
          <Text style={styles.clearText}>清空所有记录</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  summary: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 22,
    marginBottom: 16,
    // 轻微阴影，质感更高级
    shadowColor: '#1F2937',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: '#EEF1EA' },
  summaryNum: { fontSize: 22, fontWeight: '800', color: '#3FA34D' },
  summaryLabel: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#1F2937',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  date: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaItem: { flexDirection: 'row', alignItems: 'center' },
  metaIcon: { fontSize: 14, marginRight: 5 },
  metaText: { fontSize: 13, color: '#4B5563', fontWeight: '500' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  emptySub: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 30,
    lineHeight: 19,
  },
  clearBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  clearText: { fontSize: 14, color: '#E5573F', fontWeight: '600' },
});

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { initDb, addRecord } from '../../lib/db';

// 🔗 后端地址（FR-1.4 GPS 平滑、FR-1.1 绿视率都挂在这上面）
// ⚠️ 127.0.0.1 = “本机”。模拟器里指你的 Mac，没问题；真机要换成 Mac 的局域网 IP。
const API_BASE = 'http://127.0.0.1:5050';

type TrackPoint = {
  lat: number;
  lon: number;
  timestamp: number; // Unix 秒级时间戳（浮点）
  heart_rate?: number; // 可选，没有就不传
};

type SmoothResult = {
  original_count: number;
  smoothed_count: number;
  loss_rate_pct: number;
  within_5pct_loss: boolean;
  total_distance_m: number;
  duration_sec: number;
  heart_rate_summary?: { avg: number; min: number; max: number };
};

function formatTime(total: number) {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// 绿视率配色：高=绿、中=橙、低=红（只是个视觉提示）
function greenColor(v: number) {
  if (v >= 30) return '#3FA34D';
  if (v >= 15) return '#E6A23C';
  return '#E5573F';
}

// 两点间球面距离（米）——用来本地算轨迹总距离，不依赖后端
function haversine(a: TrackPoint, b: TrackPoint) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function totalDistance(points: TrackPoint[]) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}
function avgHeartRate(points: TrackPoint[]) {
  const hrs = points
    .map((p) => p.heart_rate)
    .filter((x): x is number => typeof x === 'number');
  if (hrs.length === 0) return null;
  return Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length);
}

export default function CollectScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [heartRate, setHeartRate] = useState<number | null>(null);

  // GPS
  const [coords, setCoords] = useState<{
    lat: number;
    lon: number;
    accuracy: number | null;
  } | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SmoothResult | null>(null);

  // 🌿 绿视率（FR-1.1）
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [greenLoading, setGreenLoading] = useState(false);
  const [greenView, setGreenView] = useState<number | null>(null);
  const [greenWithin3s, setGreenWithin3s] = useState<boolean | null>(null);

  const pointsRef = useRef<TrackPoint[]>([]);
  const heartRateRef = useRef<number | null>(null);

  useEffect(() => {
    heartRateRef.current = heartRate;
  }, [heartRate]);

  // 首次进入建好本地数据库表（幂等，安全）
  useEffect(() => {
    initDb().catch(() => {});
  }, []);

  // 计时器
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setSeconds((p) => p + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  // 虚拟心率
  useEffect(() => {
    if (!isRecording) return;
    setHeartRate(72);
    const hrTimer = setInterval(() => {
      setHeartRate((prev) => {
        const base = prev ?? 72;
        const next = base + Math.round(Math.random() * 6 - 3);
        return Math.max(62, Math.min(98, next));
      });
    }, 2000);
    return () => clearInterval(hrTimer);
  }, [isRecording]);

  // GPS：采集时持续读定位
  useEffect(() => {
    if (!isRecording) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          '需要定位权限',
          '没有定位权限就记录不了轨迹。请到 iOS「设置 › Park20 › 位置」里允许。'
        );
        return;
      }
      if (cancelled) return;

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
        (loc) => {
          const point: TrackPoint = {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            timestamp: loc.timestamp / 1000,
            heart_rate: heartRateRef.current ?? undefined,
          };
          pointsRef.current.push(point);
          setPointCount(pointsRef.current.length);
          setCoords({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            accuracy: loc.coords.accuracy ?? null,
          });
        }
      );
    })();

    return () => {
      cancelled = true;
      if (sub) sub.remove();
    };
  }, [isRecording]);

  // 🔗 FR-1.4：结束时把轨迹发给后端做平滑
  const sendTrack = async (points: TrackPoint[]) => {
    if (points.length < 2) {
      Alert.alert('轨迹太短', `只记录到 ${points.length} 个点，至少要 2 个才能分析。`);
      return;
    }
    try {
      setSending(true);
      const res = await fetch(`${API_BASE}/api/fr14/gps_smooth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        Alert.alert('分析失败', data.error || '后端返回了错误，请稍后再试。');
        return;
      }
      setResult(data as SmoothResult);
    } catch (e) {
      Alert.alert(
        '连不上后端',
        `请确认后端已启动、地址 ${API_BASE} 正确。\n真机记得把 127.0.0.1 换成 Mac 的局域网 IP。`
      );
    } finally {
      setSending(false);
    }
  };

  const handleToggle = () => {
    if (isRecording) {
      setIsRecording(false);
      setHeartRate(null);
      const pts = pointsRef.current;
      // 存一条本地采集记录（SQLite，不依赖后端，足迹页会读它）
      addRecord({
        created_at: Date.now(),
        duration_sec: seconds,
        distance_m: pts.length >= 2 ? Math.round(totalDistance(pts)) : null,
        avg_hr: avgHeartRate(pts),
        green_view: greenView,
      }).catch(() => {});
      sendTrack(pts);
    } else {
      setSeconds(0);
      pointsRef.current = [];
      setPointCount(0);
      setCoords(null);
      setResult(null);
      setIsRecording(true);
    }
  };

  // 🌿 FR-1.1：拍照 / 相册选图 → 上传后端 → 拿回绿视率
  const measure = async (fromCamera: boolean) => {
    try {
      let picked;
      if (fromCamera) {
        // 相机要权限（真机才有摄像头；模拟器没有）
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('需要相机权限', '请到 iOS「设置 › Park20 › 相机」里允许。');
          return;
        }
        picked = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      } else {
        // 相册选图（模拟器也能用，不需要额外权限）
        picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      }
      if (picked.canceled) return;
      const asset = picked.assets[0];

      setPhotoUri(asset.uri);
      setGreenView(null);
      setGreenWithin3s(null);
      setGreenLoading(true);

      // multipart/form-data，字段名就叫 image（后端文档要求）
      const form = new FormData();
      form.append('image', {
        uri: asset.uri,
        name: 'photo.jpg',
        type: 'image/jpeg',
      } as any);

      const res = await fetch(`${API_BASE}/api/fr11/green_view`, {
        method: 'POST',
        body: form,
        // ⚠️ 千万别手动设 Content-Type！让 fetch 自己带 multipart 边界，
        //    手动设了反而会上传失败。
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        Alert.alert('识别失败', data.error || '请换一张照片再试。');
        return;
      }
      setGreenView(data.green_view_rate);
      setGreenWithin3s(data.within_3s ?? null);
    } catch (e: any) {
      Alert.alert(
        '出错了',
        `${e?.message ?? e}\n（若是上传失败：确认后端已启动；真机要把 API_BASE 改成 Mac 的局域网 IP，且后端要监听 0.0.0.0）`
      );
    } finally {
      setGreenLoading(false);
    }
  };

  const statusText = () => {
    if (!isRecording || heartRate === null) return '状态：未采集';
    if (heartRate < 60) return '状态：偏低';
    if (heartRate > 100) return '状态：偏高';
    return '状态：良好';
  };

  const gpsText = () => {
    if (coords) return `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`;
    if (isRecording) return '定位中…';
    return '未连接';
  };

  const accText = () =>
    coords?.accuracy != null ? `±${Math.round(coords.accuracy)} m` : '--';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Park20</Text>
          <TouchableOpacity onPress={() => Alert.alert('设置', '功能开发中 🌱')}>
            <Text style={{ fontSize: 22 }}>⚙️</Text>
          </TouchableOpacity>
        </View>

        {/* 心率卡片 */}
        <View style={styles.hrCard}>
          <Text style={styles.hrLabel}>当前心率</Text>
          <Text style={styles.hrValue}>
            {heartRate === null ? '--' : heartRate}{' '}
            <Text style={styles.hrUnit}>bpm</Text>
          </Text>
          <Text style={[styles.hrStatus, isRecording && { color: '#3FA34D' }]}>
            {statusText()}
          </Text>
        </View>

        {/* 计时器 */}
        <View style={styles.timerBox}>
          <Text style={styles.timerLabel}>⏱️ 采集时长</Text>
          <Text style={styles.timer}>{formatTime(seconds)}</Text>
        </View>

        {/* 实时数据 */}
        <View style={styles.dataBox}>
          <Text style={styles.dataRow}>📍 GPS：{gpsText()}</Text>
          <Text style={styles.dataRow}>📏 定位精度：{accText()}</Text>
          <Text style={styles.dataRow}>🧭 已记录点：{pointCount} 个</Text>
          <Text style={styles.dataRow}>
            🌿 绿视率：{greenView === null ? '--' : `${greenView.toFixed(1)}%`}
          </Text>
        </View>

        {/* 🌿 绿视率检测（FR-1.1） */}
        <View style={styles.greenCard}>
          <Text style={styles.greenTitle}>🌿 绿视率检测</Text>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.preview} />}
          {greenLoading && <Text style={styles.sendingText}>正在识别…</Text>}
          {greenView !== null && !greenLoading && (
            <Text style={[styles.greenValue, { color: greenColor(greenView) }]}>
              {greenView.toFixed(1)}%
              {greenWithin3s === false && (
                <Text style={styles.greenSlow}>（识别略慢）</Text>
              )}
            </Text>
          )}
          <View style={styles.greenBtnRow}>
            <TouchableOpacity
              style={[styles.greenBtn, { flex: 1, marginTop: 0 }]}
              activeOpacity={0.85}
              onPress={() => measure(true)}>
              <Text style={styles.greenBtnText}>📷 拍照</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.greenBtn, styles.greenBtnAlt, { flex: 1, marginTop: 0 }]}
              activeOpacity={0.85}
              onPress={() => measure(false)}>
              <Text style={[styles.greenBtnText, styles.greenBtnAltText]}>
                🖼 相册
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.greenHint}>
            真机用「拍照」；模拟器没摄像头，请用「相册」。
          </Text>
        </View>

        {sending && <Text style={styles.sendingText}>正在分析轨迹…</Text>}
        {result && !isRecording && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>本次轨迹分析</Text>
            <Text style={styles.resultRow}>
              总距离 {result.total_distance_m} m · 时长{' '}
              {Math.round(result.duration_sec)} s
            </Text>
            <Text style={styles.resultRow}>
              定位点 {result.original_count} → 平滑后 {result.smoothed_count}
            </Text>
            <Text
              style={[
                styles.resultRow,
                !result.within_5pct_loss && { color: '#E5573F' },
              ]}>
              坐标丢失率 {result.loss_rate_pct}%
              {result.within_5pct_loss ? '（良好）' : '（信号较差）'}
            </Text>
            {result.heart_rate_summary && (
              <Text style={styles.resultRow}>
                心率 平均 {result.heart_rate_summary.avg} ·{' '}
                {result.heart_rate_summary.min}~{result.heart_rate_summary.max}
              </Text>
            )}
          </View>
        )}

        {/* 大圆按钮 */}
        <View style={styles.btnArea}>
          <TouchableOpacity
            style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
            activeOpacity={0.8}
            onPress={handleToggle}>
            {isRecording ? (
              <View style={styles.stopSquare} />
            ) : (
              <View style={styles.recordInner} />
            )}
          </TouchableOpacity>
          <Text style={styles.recordHint}>
            {isRecording ? '点击结束采集' : '点击开始采集'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '800', color: '#1F2937' },
  hrCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 18,
    paddingVertical: 26,
    alignItems: 'center',
  },
  hrLabel: { fontSize: 14, color: '#6B7280' },
  hrValue: { fontSize: 52, fontWeight: '800', color: '#1F2937', marginTop: 4 },
  hrUnit: { fontSize: 18, color: '#9CA3AF', fontWeight: '600' },
  hrStatus: { fontSize: 13, color: '#9CA3AF', marginTop: 6 },
  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  timerLabel: { fontSize: 14, color: '#4B5563' },
  timer: { fontSize: 22, fontWeight: '700', color: '#1F2937' },
  dataBox: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  dataRow: { fontSize: 14, color: '#4B5563', paddingVertical: 9 },
  greenCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    padding: 16,
  },
  greenTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginTop: 12,
    resizeMode: 'cover',
    backgroundColor: '#EAEEE6',
  },
  greenValue: {
    fontSize: 40,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },
  greenSlow: { fontSize: 13, fontWeight: '500', color: '#9CA3AF' },
  greenBtn: {
    backgroundColor: '#3FA34D',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  greenBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  greenBtnAlt: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#3FA34D' },
  greenBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  greenBtnAltText: { color: '#3FA34D' },
  greenHint: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 10,
  },
  sendingText: {
    textAlign: 'center',
    color: '#3FA34D',
    marginTop: 14,
    fontSize: 14,
  },
  resultCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    padding: 16,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  resultRow: { fontSize: 14, color: '#4B5563', paddingVertical: 4 },
  btnArea: { alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  recordBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#3FA34D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: { backgroundColor: '#E5573F' },
  recordInner: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff' },
  stopSquare: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#fff' },
  recordHint: { fontSize: 13, color: '#6B7280', marginTop: 14 },
});

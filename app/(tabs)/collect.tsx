import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { initDb, addRecord } from '../../lib/db';

const API_BASE = 'http://172.20.10.3:5050';

type TrackPoint = {
  lat: number;
  lon: number;
  timestamp: number;
  heart_rate?: number;
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
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
function greenColor(v: number) {
  if (v >= 30) return '#3FA34D';
  if (v >= 15) return '#E6A23C';
  return '#E5573F';
}
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
function totalDistance(pts: TrackPoint[]) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}
function avgHeartRate(pts: TrackPoint[]) {
  const hrs = pts.map((p) => p.heart_rate).filter((x): x is number => typeof x === 'number');
  return hrs.length ? Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length) : null;
}
async function postImage(path: string, uri: string) {
  const form = new FormData();
  form.append('image', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '识别失败');
  return data;
}

export default function CollectScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SmoothResult | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [greenLoading, setGreenLoading] = useState(false);
  const [greenView, setGreenView] = useState<number | null>(null);
  const [greenWithin3s, setGreenWithin3s] = useState<boolean | null>(null);
  const [scene, setScene] = useState<{ label: string; confidence: number } | null>(null);
  const [soundscape, setSoundscape] = useState<{ score: number; dominant: string } | null>(null);
  const [soundscapeLoading, setSoundscapeLoading] = useState(false);
  const [audioRecording, setAudioRecording] = useState<Audio.Recording | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const pointsRef = useRef<TrackPoint[]>([]);
  const heartRateRef = useRef<number | null>(null);

  // ─── 动画值 ───
  const pulseAnim = useRef(new Animated.Value(1)).current;           // 心率脉冲
  const btnBreathAnim = useRef(new Animated.Value(1)).current;       // 按钮呼吸
  const hrCardFade = useRef(new Animated.Value(0)).current;          // 心率卡片淡入
  const dataBoxFade = useRef(new Animated.Value(0)).current;         // 数据区淡入
  const greenCardFade = useRef(new Animated.Value(0)).current;       // 绿视率卡片淡入
  const soundCardFade = useRef(new Animated.Value(0)).current;       // 声景卡片淡入
  const resultCardFade = useRef(new Animated.Value(0)).current;      // 结果卡片淡入
  const timerScale = useRef(new Animated.Value(1)).current;          // 计时器跳动

  // 进入页面时卡片依次淡入
  useEffect(() => {
    const stagger = [
      { anim: hrCardFade, delay: 0 },
      { anim: dataBoxFade, delay: 120 },
      { anim: greenCardFade, delay: 240 },
      { anim: soundCardFade, delay: 360 },
    ];
    stagger.forEach(({ anim, delay }) =>
      Animated.timing(anim, {
        toValue: 1,
        duration: 500,
        delay,
        useNativeDriver: true,
      }).start()
    );
  }, []);

  // 采集中：心率脉冲 + 按钮呼吸 + 计时器微跳
  useEffect(() => {
    if (!isRecording) {
      pulseAnim.setValue(1);
      btnBreathAnim.setValue(1);
      return;
    }
    // 心率脉冲：放大→缩小 循环
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    // 按钮呼吸：缓慢缩放
    const breath = Animated.loop(
      Animated.sequence([
        Animated.timing(btnBreathAnim, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(btnBreathAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    breath.start();
    return () => { pulse.stop(); breath.stop(); };
  }, [isRecording]);

  // 计时器每秒微跳
  useEffect(() => {
    if (!isRecording) return;
    Animated.sequence([
      Animated.timing(timerScale, { toValue: 1.05, duration: 80, useNativeDriver: true }),
      Animated.timing(timerScale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  }, [seconds]);

  // 结果卡片弹出动画
  useEffect(() => {
    if (result) {
      resultCardFade.setValue(0);
      Animated.spring(resultCardFade, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
    }
  }, [result]);

  useEffect(() => { heartRateRef.current = heartRate; }, [heartRate]);
  useEffect(() => { initDb().catch(() => {}); }, []);

  // 计时器
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => setSeconds((p) => p + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

  // 虚拟心率
  useEffect(() => {
    if (!isRecording) return;
    setHeartRate(72);
    const t = setInterval(() => {
      setHeartRate((p) => {
        const b = p ?? 72;
        return Math.max(62, Math.min(98, b + Math.round(Math.random() * 6 - 3)));
      });
    }, 2000);
    return () => clearInterval(t);
  }, [isRecording]);

  // GPS
  useEffect(() => {
    if (!isRecording) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('需要定位权限', '请到设置里允许'); return; }
      if (cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
        (loc) => {
          const pt: TrackPoint = {
            lat: loc.coords.latitude, lon: loc.coords.longitude,
            timestamp: loc.timestamp / 1000,
            heart_rate: heartRateRef.current ?? undefined,
          };
          pointsRef.current.push(pt);
          setPointCount(pointsRef.current.length);
          setCoords({ lat: loc.coords.latitude, lon: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null });
        }
      );
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, [isRecording]);

  // 🔗 FR-1.4
  const sendTrack = async (pts: TrackPoint[]): Promise<SmoothResult | null> => {
    if (pts.length < 2) { Alert.alert('轨迹太短', `只记录到 ${pts.length} 个点`); return null; }
    try {
      setSending(true);
      const res = await fetch(`${API_BASE}/api/fr14/gps_smooth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: pts }) });
      const d = await res.json();
      if (!res.ok || d.error) { Alert.alert('分析失败', d.error || ''); return null; }
      setResult(d as SmoothResult);
      return d as SmoothResult;
    } catch { Alert.alert('连不上后端', `确认 ${API_BASE} 启动了`); return null; }
    finally { setSending(false); }
  };

  // 🗒️ FR-5.1 报告生成
  const generateReport = async (pts: TrackPoint[], smoothResult: SmoothResult | null) => {
    try {
      setReportLoading(true);
      setReportUrl(null);
      const hrs = pts.map((p) => p.heart_rate).filter((x): x is number => typeof x === 'number');
      const body = {
        park_name: '公园',
        duration_sec: seconds,
        modules_data: {
          green_view: {
            green_view_rate: greenView ?? 0,
            aesthetic_score: greenView != null ? Math.round(greenView * 1.2) : 0,
          },
          scene: {
            top_label: scene?.label ?? '未知场景',
            scene_description: scene?.label ?? '',
            healing_comment: '',
            emotion_tag: '',
          },
          soundscape: soundscape
            ? { proportions: { 自然声: soundscape.score / 100, 其他: 1 - soundscape.score / 100 }, naturalness_score: soundscape.score }
            : { proportions: { 其他: 1 }, naturalness_score: 0 },
          gps: {
            smoothed_points: pts.slice(0, 50).map((p) => ({ lat: p.lat, lon: p.lon })),
            total_distance_m: smoothResult?.total_distance_m ?? Math.round(totalDistance(pts)),
          },
          health: {
            avg_hr: hrs.length ? Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length) : 75,
            hr_start: hrs[0] ?? 80,
            hr_end: hrs[hrs.length - 1] ?? 72,
            rmssd: 40,
          },
        },
      };
      const res = await fetch(`${API_BASE}/api/report/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok || d.error) { Alert.alert('报告生成失败', d.error || ''); return; }
      setReportUrl(`${API_BASE}/api/report/preview/${d.report_id}`);
    } catch { Alert.alert('报告生成失败', `确认 ${API_BASE} 启动了`); }
    finally { setReportLoading(false); }
  };

  const handleToggle = () => {
    if (isRecording) {
      setIsRecording(false);
      setHeartRate(null);
      const pts = pointsRef.current;
      addRecord({ created_at: Date.now(), duration_sec: seconds, distance_m: pts.length >= 2 ? Math.round(totalDistance(pts)) : null, avg_hr: avgHeartRate(pts), green_view: greenView }).catch(() => {});
      sendTrack(pts).then((smoothResult) => {
        generateReport(pts, smoothResult ?? null);
      });
    } else {
      setSeconds(0);
      pointsRef.current = [];
      setPointCount(0);
      setCoords(null);
      setResult(null);
      setIsRecording(true);
    }
  };

  // 🌿 FR-1.1 + FR-1.2
  const measure = async (fromCamera: boolean) => {
    try {
      let picked;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('需要相机权限'); return; }
        picked = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      } else {
        picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      }
      if (picked.canceled) return;
      const asset = picked.assets[0];
      setPhotoUri(asset.uri);
      setGreenView(null);
      setGreenWithin3s(null);
      setScene(null);
      setGreenLoading(true);
      const [gv, sc] = await Promise.all([
        postImage('/api/fr11/green_view', asset.uri),
        postImage('/api/fr12/scene_classify', asset.uri),
      ]);
      setGreenView(gv.green_view_rate);
      setGreenWithin3s(gv.within_3s ?? null);
      setScene({ label: sc.top_label, confidence: sc.top_confidence });
    } catch (e: any) { Alert.alert('出错了', e?.message ?? ''); }
    finally { setGreenLoading(false); }
  };

  // 🎧 FR-1.3 真实录音
  const startListening = async () => {
  try {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要麦克风权限', '请到设置 › Park20 › 麦克风 允许'); return; }
    // 先重置再激活，避免 session 冲突
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    setAudioRecording(recording);
    setIsListening(true);
    setSoundscape(null);
  } catch (e: any) {
    if (e?.message?.includes('background')) {
      Alert.alert('录音失败', 'App 需要在屏幕最前台才能录音，请不要切换其他应用后再点');
    } else {
      Alert.alert('录音失败', e?.message ?? '');
    }
  }
};

  const stopListening = async () => {
    if (!audioRecording) return;
    try {
      setSoundscapeLoading(true);
      setIsListening(false);
      await audioRecording.stopAndUnloadAsync();
      const uri = audioRecording.getURI();
      setAudioRecording(null);
      if (!uri) { Alert.alert('录音失败', '没有拿到音频文件'); return; }
      // 上传给 FR-1.3
      const form = new FormData();
      form.append('audio', { uri, name: 'recording.m4a', type: 'audio/m4a' } as any);
      const res = await fetch(`${API_BASE}/api/fr13/soundscape`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || data.error) { Alert.alert('分析失败', data.error || ''); return; }
      setSoundscape({ score: data.naturalness_score, dominant: data.dominant_sound });
    } catch (e: any) { Alert.alert('连不上后端', `确认 ${API_BASE} 启动了`); }
    finally { setSoundscapeLoading(false); }
  };

  // 模拟数据模式（后备）
  const mockSoundscape = async () => {
    try {
      setSoundscapeLoading(true);
      setSoundscape(null);
      const res = await fetch(`${API_BASE}/api/fr13/soundscape`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mock: true }) });
      const d = await res.json();
      if (!res.ok || d.error) { Alert.alert('失败', d.error || ''); return; }
      setSoundscape({ score: d.naturalness_score, dominant: d.dominant_sound });
    } catch { Alert.alert('连不上后端'); }
    finally { setSoundscapeLoading(false); }
  };

  const statusText = () => {
    if (!isRecording || heartRate === null) return '状态：未采集';
    if (heartRate < 60) return '状态：偏低';
    if (heartRate > 100) return '状态：偏高';
    return '状态：良好';
  };
  const gpsText = () => coords ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` : isRecording ? '定位中…' : '未连接';
  const accText = () => coords?.accuracy != null ? `±${Math.round(coords.accuracy)} m` : '--';

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Text style={s.title}>Park20</Text>
          <TouchableOpacity onPress={() => Alert.alert('设置', '开发中 🌱')}>
            <Text style={{ fontSize: 22 }}>⚙️</Text>
          </TouchableOpacity>
        </View>

        {/* 心率卡片 —— 淡入 + 脉冲 */}
        <Animated.View style={[s.hrCard, { opacity: hrCardFade, transform: [{ translateY: hrCardFade.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
          <Text style={s.hrLabel}>当前心率</Text>
          <Animated.Text style={[s.hrValue, { transform: [{ scale: isRecording ? pulseAnim : 1 }] }]}>
            {heartRate === null ? '--' : heartRate}{' '}
            <Text style={s.hrUnit}>bpm</Text>
          </Animated.Text>
          <Text style={[s.hrStatus, isRecording && { color: '#3FA34D' }]}>{statusText()}</Text>
          {isRecording && <View style={s.liveIndicator}><View style={s.liveDot} /><Text style={s.liveText}>采集中</Text></View>}
        </Animated.View>

        {/* 计时器 —— 微跳 */}
        <View style={s.timerBox}>
          <Text style={s.timerLabel}>⏱️ 采集时长</Text>
          <Animated.Text style={[s.timer, { transform: [{ scale: timerScale }] }]}>{formatTime(seconds)}</Animated.Text>
        </View>

        {/* 实时数据 —— 淡入 */}
        <Animated.View style={[s.dataBox, { opacity: dataBoxFade, transform: [{ translateY: dataBoxFade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
          <Text style={s.dataRow}>📍 GPS：{gpsText()}</Text>
          <Text style={s.dataRow}>📏 精度：{accText()}</Text>
          <Text style={s.dataRow}>🧭 已记录：{pointCount} 点</Text>
          <Text style={s.dataRow}>🌿 绿视率：{greenView === null ? '--' : `${greenView.toFixed(1)}%`}</Text>
          <Text style={s.dataRow}>🏞 场景：{scene ? scene.label : '--'}</Text>
        </Animated.View>

        {/* 🌿 绿视率 + 场景 */}
        <Animated.View style={[s.card, { opacity: greenCardFade, transform: [{ translateY: greenCardFade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
          <Text style={s.cardTitle}>🌿 绿视率 + 场景识别</Text>
          {photoUri && <Image source={{ uri: photoUri }} style={s.preview} />}
          {greenLoading && <Text style={s.loadingText}>识别中…</Text>}
          {greenView !== null && !greenLoading && (
            <Text style={[s.bigNum, { color: greenColor(greenView) }]}>
              {greenView.toFixed(1)}%
              {greenWithin3s === false && <Text style={s.dimText}>（略慢）</Text>}
            </Text>
          )}
          {scene && !greenLoading && (
            <Text style={s.infoText}>📷 {scene.label} · 置信 {Math.round(scene.confidence * 100)}%{scene.confidence < 0.6 ? '（不太确定）' : ''}</Text>
          )}
          <View style={s.btnRow}>
            <TouchableOpacity style={[s.actionBtn, s.primaryBtn, { flex: 1 }]} activeOpacity={0.85} onPress={() => measure(true)}>
              <Text style={s.primaryBtnText}>📷 拍照</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.outlineBtn, { flex: 1 }]} activeOpacity={0.85} onPress={() => measure(false)}>
              <Text style={s.outlineBtnText}>🖼 相册</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* 🎧 声景分析 —— 真实录音 + 模拟后备 */}
        <Animated.View style={[s.card, { opacity: soundCardFade, transform: [{ translateY: soundCardFade.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
          <Text style={s.cardTitle}>🎧 声景分析</Text>
          {soundscapeLoading && <Text style={s.loadingText}>分析中…</Text>}
          {soundscape && !soundscapeLoading && (
            <>
              <Text style={[s.bigNum, { color: greenColor(soundscape.score) }]}>{soundscape.score.toFixed(1)}</Text>
              <Text style={s.infoText}>自然度指数 · 主导声：{soundscape.dominant}</Text>
            </>
          )}
          {isListening && (
            <View style={s.listeningBox}>
              <Text style={s.listeningEmoji}>🎙️</Text>
              <Text style={s.listeningText}>正在聆听环境声…</Text>
            </View>
          )}
          <View style={s.btnRow}>
            {!isListening ? (
              <TouchableOpacity style={[s.actionBtn, s.primaryBtn, { flex: 1 }]} activeOpacity={0.85} onPress={startListening}>
                <Text style={s.primaryBtnText}>🎙️ 开始录音</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[s.actionBtn, { flex: 1, backgroundColor: '#E5573F' }]} activeOpacity={0.85} onPress={stopListening}>
                <Text style={s.primaryBtnText}>⏹ 停止并分析</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.actionBtn, s.outlineBtn, { flex: 1 }]} activeOpacity={0.85} onPress={mockSoundscape}>
              <Text style={s.outlineBtnText}>模拟数据</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.hintText}>真机录 5-10 秒环境声 → 后端分析；无麦克风时用「模拟数据」</Text>
        </Animated.View>

        {sending && <Text style={s.loadingText}>正在分析轨迹…</Text>}

        {/* 结果卡片 —— 弹簧动画 */}
        {result && !isRecording && (
          <Animated.View style={[s.card, { opacity: resultCardFade, transform: [{ scale: resultCardFade.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
            <Text style={s.cardTitle}>📊 本次轨迹分析</Text>
            <Text style={s.dataRow}>总距离 {result.total_distance_m} m · 时长 {Math.round(result.duration_sec)} s</Text>
            <Text style={s.dataRow}>定位点 {result.original_count} → 平滑 {result.smoothed_count}</Text>
            <Text style={[s.dataRow, !result.within_5pct_loss && { color: '#E5573F' }]}>
              丢失率 {result.loss_rate_pct}%{result.within_5pct_loss ? '（良好）' : '（信号差）'}
            </Text>
            {result.heart_rate_summary && (
              <Text style={s.dataRow}>心率 {result.heart_rate_summary.avg} avg · {result.heart_rate_summary.min}~{result.heart_rate_summary.max}</Text>
            )}
          </Animated.View>
        )}

        {/* 🗒️ 报告按钮 */}
        {reportLoading && <Text style={s.loadingText}>正在生成疗愈报告…</Text>}
        {reportUrl && !reportLoading && (
          <TouchableOpacity
            style={[s.actionBtn, s.primaryBtn, { marginHorizontal: 20, marginTop: 14 }]}
            activeOpacity={0.85}
            onPress={() => Linking.openURL(reportUrl)}>
            <Text style={s.primaryBtnText}>🌿 查看疗愈报告</Text>
          </TouchableOpacity>
        )}

        {/* 大圆按钮 —— 呼吸动画 */}
        <View style={s.btnArea}>
          <Animated.View style={{ transform: [{ scale: isRecording ? btnBreathAnim : 1 }] }}>
            <TouchableOpacity
              style={[s.recordBtn, isRecording && s.recordBtnActive]}
              activeOpacity={0.8}
              onPress={handleToggle}>
              {isRecording ? <View style={s.stopSquare} /> : <View style={s.recordInner} />}
            </TouchableOpacity>
          </Animated.View>
          <Text style={s.recordHint}>{isRecording ? '点击结束采集' : '点击开始采集'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: '#1F2937' },
  hrCard: { backgroundColor: '#fff', marginHorizontal: 20, marginTop: 8, borderRadius: 18, paddingVertical: 26, alignItems: 'center', shadowColor: '#1F2937', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  hrLabel: { fontSize: 14, color: '#6B7280' },
  hrValue: { fontSize: 52, fontWeight: '800', color: '#1F2937', marginTop: 4 },
  hrUnit: { fontSize: 18, color: '#9CA3AF', fontWeight: '600' },
  hrStatus: { fontSize: 13, color: '#9CA3AF', marginTop: 6 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', marginTop: 10, backgroundColor: '#ECFDF5', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3FA34D', marginRight: 6 },
  liveText: { fontSize: 12, color: '#3FA34D', fontWeight: '700' },
  timerBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', marginHorizontal: 20, marginTop: 14, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16, shadowColor: '#1F2937', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  timerLabel: { fontSize: 14, color: '#4B5563' },
  timer: { fontSize: 22, fontWeight: '700', color: '#1F2937' },
  dataBox: { backgroundColor: '#fff', marginHorizontal: 20, marginTop: 14, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 8, shadowColor: '#1F2937', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  dataRow: { fontSize: 14, color: '#4B5563', paddingVertical: 9 },
  card: { backgroundColor: '#fff', marginHorizontal: 20, marginTop: 14, borderRadius: 16, padding: 16, shadowColor: '#1F2937', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  preview: { width: '100%', height: 160, borderRadius: 12, marginTop: 12, resizeMode: 'cover' as any, backgroundColor: '#EAEEE6' },
  bigNum: { fontSize: 40, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  dimText: { fontSize: 13, fontWeight: '500', color: '#9CA3AF' },
  infoText: { fontSize: 14, color: '#4B5563', textAlign: 'center', marginTop: 8 },
  loadingText: { textAlign: 'center', color: '#3FA34D', marginTop: 14, fontSize: 14 },
  hintText: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 10 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryBtn: { backgroundColor: '#3FA34D' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  outlineBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#3FA34D' },
  outlineBtnText: { color: '#3FA34D', fontSize: 15, fontWeight: '700' },
  listeningBox: { alignItems: 'center', marginTop: 14, paddingVertical: 12 },
  listeningEmoji: { fontSize: 36 },
  listeningText: { fontSize: 14, color: '#3FA34D', fontWeight: '600', marginTop: 6 },
  btnArea: { alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  recordBtn: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#3FA34D', alignItems: 'center', justifyContent: 'center', shadowColor: '#3FA34D', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  recordBtnActive: { backgroundColor: '#E5573F', shadowColor: '#E5573F' },
  recordInner: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff' },
  stopSquare: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#fff' },
  recordHint: { fontSize: 13, color: '#6B7280', marginTop: 14 },
});

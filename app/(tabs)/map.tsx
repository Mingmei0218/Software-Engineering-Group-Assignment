import { useEffect, useRef } from 'react';
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
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useState } from 'react';

// 🔗 公园坐标先用大致真实值占位；将来真实的“坐标 + 疗愈指数”会从后端拉。
const PARKS = [
  { id: 1, name: '朝阳公园', score: 86, color: '#3FA34D', lat: 39.9388, lon: 116.4806 },
  { id: 2, name: '奥林匹克森林公园', score: 78, color: '#E6A23C', lat: 40.0208, lon: 116.392 },
  { id: 3, name: '团结湖公园', score: 64, color: '#E6A23C', lat: 39.9295, lon: 116.4636 },
  { id: 4, name: '日坛公园', score: 45, color: '#E5573F', lat: 39.9148, lon: 116.4399 },
];

// 默认先落在北京朝阳公园附近（拿到真实定位后会自动飞过去）
const DEFAULT_REGION: Region = {
  latitude: 39.9388,
  longitude: 116.4806,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export default function MapScreen() {
  const [query, setQuery] = useState('');
  const mapRef = useRef<MapView>(null);
  const list = PARKS.filter((p) => p.name.includes(query));

  // 进页面就尝试拿一次当前位置，把地图中心移过去
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return; // 没权限就停在默认位置，不打扰
      const loc = await Location.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion(
        {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        },
        800
      );
    })();
  }, []);

  // 点定位按钮：回到“我的位置”
  const goToMe = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要定位权限', '请到 iOS「设置 › Park20 › 位置」里允许定位。');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    mapRef.current?.animateToRegion(
      {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      800
    );
  };

  // 点列表里的公园：地图飞过去
  const flyTo = (lat: number, lon: number) => {
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lon, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      600
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="搜索公园"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
          />
        </View>
        <TouchableOpacity style={styles.locateBtn} onPress={goToMe}>
          <Text style={{ fontSize: 18 }}>📍</Text>
        </TouchableOpacity>
      </View>

      {/* 真·Apple 地图：iOS 用系统地图（PROVIDER_DEFAULT），免 key。
          圆角靠外层 View 的 overflow:'hidden' 裁出来。 */}
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={DEFAULT_REGION}
          showsUserLocation // 显示蓝色“我在这”圆点
          showsMyLocationButton={false}>
          {PARKS.map((p) => (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lon }}
              title={p.name}
              description={`平均疗愈指数 ${p.score}`}
              pinColor={p.color}
            />
          ))}
        </MapView>
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#3FA34D' }]} />
          <Text style={styles.legendText}>{'≥80 优秀'}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#E6A23C' }]} />
          <Text style={styles.legendText}>{'50-79 一般'}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: '#E5573F' }]} />
          <Text style={styles.legendText}>{'<50 较低'}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>附近公园</Text>
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {list.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={styles.parkCard}
            activeOpacity={0.7}
            onPress={() => flyTo(p.lat, p.lon)}>
            <View>
              <Text style={styles.parkName}>{p.name}</Text>
              <Text style={styles.parkSub}>平均疗愈指数</Text>
            </View>
            <Text style={[styles.parkScore, { color: p.color }]}>{p.score}</Text>
          </TouchableOpacity>
        ))}
        {list.length === 0 && (
          <Text style={styles.emptyText}>没有找到「{query}」</Text>
        )}
        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
  },
  searchIcon: { fontSize: 15, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 14, color: '#1F2937' },
  locateBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  mapWrap: {
    height: 240,
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden', // 把地图的直角裁成圆角
  },
  map: { flex: 1 },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { fontSize: 12, color: '#6B7280' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 6,
  },
  parkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 14,
  },
  parkName: { fontSize: 15, color: '#1F2937', fontWeight: '600' },
  parkSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  parkScore: { fontSize: 24, fontWeight: '800' },
  emptyText: { textAlign: 'center', color: '#9CA3AF', marginTop: 20 },
});

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { classifyLongExposure } from './src/services/api';
import { getUpcomingStarlinkPasses } from './src/services/starlink';
import { AnalysisResponse, Mode, PassEvent } from './src/types';

const BACKEND_URL = 'http://10.0.2.2:8000'; // Android emulator. Change to PC IP for real device.

export default function App() {
  const [mode, setMode] = useState<Mode>('avoid');
  const [locationLabel, setLocationLabel] = useState('위치 확인 중...');
  const [passes, setPasses] = useState<PassEvent[]>([]);
  const [loadingPasses, setLoadingPasses] = useState(false);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  useEffect(() => {
    void refreshPasses();
  }, []);

  const headerText = useMemo(() => {
    return mode === 'avoid'
      ? '촬영 회피 모드: Starlink 통과 시간을 피해서 장노출 촬영하세요.'
      : '포착 모드: 오늘 보이는 Starlink를 찾아 촬영하세요.';
  }, [mode]);

  async function refreshPasses() {
    setLoadingPasses(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationLabel('위치 권한이 없어 pass 계산을 진행할 수 없습니다.');
        setPasses([]);
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = current.coords;
      setLocationLabel(`현재 위치: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      const nextPasses = await getUpcomingStarlinkPasses(latitude, longitude, 5);
      setPasses(nextPasses);
    } catch (error) {
      console.error(error);
      Alert.alert('오류', 'Starlink pass를 계산하지 못했습니다. 네트워크를 확인하세요.');
    } finally {
      setLoadingPasses(false);
    }
  }

  async function pickAndAnalyzeImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('권한 필요', '사진 분석을 위해 사진 접근 권한이 필요합니다.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      exif: true,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setSelectedImageUri(asset.uri);
    setAnalysis(null);
    setLoadingAnalysis(true);

    try {
      const closestPass = passes[0] ?? null;
      const response = await classifyLongExposure({
        backendUrl: BACKEND_URL,
        imageUri: asset.uri,
        nearestPass: closestPass,
        exifDateTime: asset.exif?.DateTimeOriginal ?? asset.exif?.DateTime ?? null,
      });
      setAnalysis(response);
    } catch (error) {
      console.error(error);
      Alert.alert('오류', '이미지 분석에 실패했습니다. 백엔드가 실행 중인지 확인하세요.');
    } finally {
      setLoadingAnalysis(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Starlink Pass Assistant</Text>
        <Text style={styles.subtitle}>{headerText}</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1단계 · Starlink pass 예측</Text>
          <Text style={styles.meta}>{locationLabel}</Text>

          <View style={styles.toggleRow}>
            <ToggleButton label="촬영 회피" active={mode === 'avoid'} onPress={() => setMode('avoid')} />
            <ToggleButton label="포착 모드" active={mode === 'capture'} onPress={() => setMode('capture')} />
          </View>

          <TouchableOpacity style={styles.secondaryButton} onPress={() => void refreshPasses()}>
            <Text style={styles.secondaryButtonText}>오늘 pass 다시 계산</Text>
          </TouchableOpacity>

          {loadingPasses ? <ActivityIndicator style={{ marginTop: 14 }} /> : null}

          <View style={styles.passList}>
            {passes.map((pass) => (
              <View style={styles.passCard} key={pass.id}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.passTitle}>{pass.startLocal} ~ {pass.endLocal}</Text>
                  <Text style={styles.passMeta}>방향: {pass.directionText}</Text>
                  <Text style={styles.passMeta}>최대 고도: {pass.maxElevationDeg.toFixed(1)}°</Text>
                  <Text style={styles.passMeta}>최대 밝기 추정: {pass.brightnessHint}</Text>
                </View>
                <View style={[styles.badge, pass.risk === '높음' ? styles.badgeHigh : pass.risk === '보통' ? styles.badgeMedium : styles.badgeLow]}>
                  <Text style={styles.badgeText}>{mode === 'avoid' ? `위험 ${pass.risk}` : `추천 ${pass.risk === '낮음' ? '낮음' : '보통'}`}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>2단계 · 장노출 사진 streak 판별</Text>
          <Text style={styles.meta}>사진 1장을 업로드하면 Starlink / Meteor / Airplane / Unknown으로 분류합니다.</Text>

          <TouchableOpacity style={styles.primaryButton} onPress={() => void pickAndAnalyzeImage()}>
            <Text style={styles.primaryButtonText}>장노출 사진 업로드</Text>
          </TouchableOpacity>

          {selectedImageUri ? <Image source={{ uri: selectedImageUri }} style={styles.previewImage} /> : null}
          {loadingAnalysis ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}

          {analysis ? (
            <View style={styles.analysisCard}>
              <Text style={styles.analysisHeading}>분석 결과</Text>
              <Text style={styles.analysisLabel}>분류: {analysis.label}</Text>
              <Text style={styles.analysisMeta}>신뢰도: {analysis.confidence.toFixed(1)}%</Text>
              <Text style={styles.analysisMeta}>검출 선 개수: {analysis.linesDetected}</Text>
              <Text style={styles.analysisMeta}>설명: {analysis.reason}</Text>
              {analysis.nearestPassHint ? <Text style={styles.analysisMeta}>pass 참고: {analysis.nearestPassHint}</Text> : null}
            </View>
          ) : null}

          <Text style={styles.note}>다음 단계(유료 기능)로는 동영상/타임랩스 업로드 후 프레임 기반 정밀 판별 기능을 붙일 수 있습니다.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ToggleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.toggleButton, active && styles.toggleButtonActive]}>
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#08111f' },
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  title: { color: '#f8fafc', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#cbd5e1', lineHeight: 20, marginTop: 6 },
  card: { backgroundColor: '#111c2d', padding: 16, borderRadius: 18, borderWidth: 1, borderColor: '#223247' },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  meta: { color: '#cbd5e1', lineHeight: 20 },
  toggleRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  toggleButton: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderColor: '#334155', borderWidth: 1, backgroundColor: '#0f172a' },
  toggleButtonActive: { backgroundColor: '#1d4ed8', borderColor: '#2563eb' },
  toggleText: { color: '#cbd5e1', fontWeight: '700' },
  toggleTextActive: { color: '#fff' },
  secondaryButton: { marginTop: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, alignItems: 'center' },
  secondaryButtonText: { color: '#fff', fontWeight: '700' },
  passList: { marginTop: 14, gap: 10 },
  passCard: { backgroundColor: '#0b1423', borderRadius: 14, padding: 12, flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: '#1f2d40' },
  passTitle: { color: '#f8fafc', fontWeight: '700', marginBottom: 4 },
  passMeta: { color: '#cbd5e1', fontSize: 13, lineHeight: 18 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, alignSelf: 'center' },
  badgeHigh: { backgroundColor: '#ef4444' },
  badgeMedium: { backgroundColor: '#f59e0b' },
  badgeLow: { backgroundColor: '#10b981' },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  primaryButton: { backgroundColor: '#2563eb', alignItems: 'center', borderRadius: 12, paddingVertical: 14, marginTop: 10 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  previewImage: { width: '100%', height: 240, marginTop: 14, borderRadius: 14, backgroundColor: '#0b1423' },
  analysisCard: { marginTop: 14, backgroundColor: '#0b1423', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#243349' },
  analysisHeading: { color: '#f8fafc', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  analysisLabel: { color: '#93c5fd', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  analysisMeta: { color: '#cbd5e1', lineHeight: 19, fontSize: 13 },
  note: { marginTop: 12, color: '#94a3b8', fontSize: 12, lineHeight: 18 },
});

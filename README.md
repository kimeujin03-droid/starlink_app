# Starlink Pass Assistant

안드로이드용 React Native / Expo MVP와 FastAPI 백엔드를 함께 포함한 프로젝트입니다.

## 포함 기능

### 1단계 · Starlink pass 예측
- 현재 GPS 위치 기반 pass 계산
- 오늘 언제 지나가는지 표시
- 어느 방향인지 표시
- 촬영 회피 / 포착 모드 토글

### 2단계 · 장노출 사진 streak 판별
- 장노출 사진 1장 업로드
- Starlink / Meteor / Airplane / Unknown 분류
- 예측된 Starlink pass 시간과 업로드 사진 시간을 함께 반영

## 폴더 구조

- `mobile/` : Expo 기반 안드로이드 앱
- `backend/` : FastAPI 이미지 분석 서버

## 실행 방법

### 1. 백엔드 실행
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows는 .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. 모바일 앱 실행
```bash
cd mobile
npm install
npx expo start
```

## Android 에뮬레이터 / 실제 기기
- 기본값은 `App.tsx`에 `http://10.0.2.2:8000`로 설정되어 있습니다.
- Android 에뮬레이터에서는 이 주소를 그대로 사용하면 됩니다.
- 실제 스마트폰으로 테스트할 경우, 같은 Wi-Fi에서 PC IP로 바꿔야 합니다.
  - 예: `http://192.168.0.15:8000`

## 현재 구현 수준

### 완료
- CelesTrak Starlink TLE fetch
- `satellite.js` 기반 pass 계산
- pass 리스트 렌더링
- 사진 업로드
- OpenCV 기반 streak line detection
- 규칙 기반 streak 분류
- 예측 pass 시간과 EXIF 시간 결합

### 다음 단계 추천
- 카메라 촬영 직후 바로 분석 기능
- 하늘 지도(sky map) / 방향 안내 UI 추가
- 동영상 / 타임랩스 업로드 (유료 기능)
- streak classification 모델 고도화
- Starlink 외 일반 위성 분류 확장

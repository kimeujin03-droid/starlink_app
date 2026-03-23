from __future__ import annotations

from datetime import datetime
from io import BytesIO
from math import atan2, degrees
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

app = FastAPI(title="Starlink Pass Assistant Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze-photo")
async def analyze_photo(
    image: UploadFile = File(...),
    nearest_pass_start: Optional[str] = Form(default=None),
    nearest_pass_end: Optional[str] = Form(default=None),
    nearest_pass_direction: Optional[str] = Form(default=None),
    exif_datetime: Optional[str] = Form(default=None),
):
    raw = await image.read()
    pil_image = Image.open(BytesIO(raw)).convert("RGB")
    rgb = np.array(pil_image)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    lines = detect_lines(gray)
    lines_detected = len(lines)

    if lines_detected == 0:
        return {
            "label": "Unknown",
            "confidence": 42.0,
            "linesDetected": 0,
            "reason": "뚜렷한 streak를 찾지 못했습니다.",
            "nearestPassHint": pass_hint(nearest_pass_start, nearest_pass_end, nearest_pass_direction, exif_datetime),
        }

    features = extract_features(gray, lines)
    label, confidence, reason = classify(features, nearest_pass_start, nearest_pass_end, nearest_pass_direction, exif_datetime)
    return {
        "label": label,
        "confidence": confidence,
        "linesDetected": lines_detected,
        "reason": reason,
        "nearestPassHint": pass_hint(nearest_pass_start, nearest_pass_end, nearest_pass_direction, exif_datetime),
    }


def detect_lines(gray: np.ndarray):
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 60, 160)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=60,
        minLineLength=max(40, gray.shape[1] // 6),
        maxLineGap=12,
    )
    if lines is None:
        return []
    return [line[0] for line in lines]


def extract_features(gray: np.ndarray, lines):
    lengths = []
    angles = []
    mean_intensities = []
    std_intensities = []
    dash_scores = []

    h, w = gray.shape[:2]
    diag = float(np.hypot(h, w))

    for (x1, y1, x2, y2) in lines:
        length = float(np.hypot(x2 - x1, y2 - y1))
        angle = degrees(atan2(y2 - y1, x2 - x1))
        profile = sample_line_profile(gray, x1, y1, x2, y2)
        if profile.size == 0:
            continue
        lengths.append(length / diag)
        angles.append(angle)
        mean_intensities.append(float(profile.mean()))
        std_intensities.append(float(profile.std()))
        dash_scores.append(dashedness(profile))

    angle_spread = circular_spread(angles)
    parallel_count = estimate_parallel_groups(angles)

    return {
        "count": len(lengths),
        "mean_length": float(np.mean(lengths)) if lengths else 0.0,
        "max_length": float(np.max(lengths)) if lengths else 0.0,
        "mean_intensity": float(np.mean(mean_intensities)) if mean_intensities else 0.0,
        "std_intensity": float(np.mean(std_intensities)) if std_intensities else 0.0,
        "dash_score": float(np.mean(dash_scores)) if dash_scores else 0.0,
        "angle_spread": angle_spread,
        "parallel_count": parallel_count,
    }


def sample_line_profile(gray: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> np.ndarray:
    length = int(max(abs(x2 - x1), abs(y2 - y1)))
    if length <= 0:
        return np.array([], dtype=np.float32)
    xs = np.linspace(x1, x2, length).astype(np.int32)
    ys = np.linspace(y1, y2, length).astype(np.int32)
    xs = np.clip(xs, 0, gray.shape[1] - 1)
    ys = np.clip(ys, 0, gray.shape[0] - 1)
    return gray[ys, xs].astype(np.float32)


def dashedness(profile: np.ndarray) -> float:
    threshold = profile.mean()
    binary = profile > threshold
    transitions = np.count_nonzero(binary[:-1] != binary[1:])
    return float(transitions / max(1, len(profile)))


def circular_spread(angles):
    if not angles:
        return 180.0
    radians = np.deg2rad(angles)
    sin_sum = np.mean(np.sin(radians))
    cos_sum = np.mean(np.cos(radians))
    r = np.hypot(sin_sum, cos_sum)
    return float((1.0 - r) * 180.0)


def estimate_parallel_groups(angles):
    if not angles:
        return 0
    buckets = {}
    for angle in angles:
        key = round(angle / 10.0) * 10
        buckets[key] = buckets.get(key, 0) + 1
    return max(buckets.values())


def classify(features, nearest_pass_start, nearest_pass_end, nearest_pass_direction, exif_datetime):
    pass_bonus = pass_matches(nearest_pass_start, nearest_pass_end, exif_datetime)

    # Airplane: strong dashedness.
    if features["dash_score"] > 0.22:
        confidence = min(96.0, 70.0 + features["dash_score"] * 100)
        return "Airplane", confidence, "점선형 밝기 변화가 커서 항공기 점멸 패턴으로 보입니다."

    # Starlink / satellite: long straight lines, often parallel, pass-time match helps.
    if (features["max_length"] > 0.28 and features["angle_spread"] < 35) or features["parallel_count"] >= 2:
        confidence = 68.0 + pass_bonus + min(18.0, features["parallel_count"] * 6)
        reason = "길고 곧은 streak가 검출되었고 위성 pass 패턴과 유사합니다."
        if pass_bonus >= 12:
            reason = "길고 곧은 streak가 검출되었고 업로드 시간대가 예측된 Starlink pass와 가깝습니다."
        return "Starlink", min(97.0, confidence), reason

    # Meteor: shorter singular bright streak, more irregular intensity.
    if features["mean_length"] < 0.22 and features["std_intensity"] > 35:
        confidence = min(92.0, 62.0 + features["std_intensity"] / 2)
        return "Meteor", confidence, "짧고 밝기 변화가 큰 단일 streak로 보여 유성 가능성이 높습니다."

    # Fallback using pass timing.
    if pass_bonus >= 15:
        return "Starlink", 73.0 + pass_bonus / 2, "패턴이 뚜렷하지 않지만 예측된 pass 시간대와 가까워 위성으로 추정됩니다."

    return "Unknown", 55.0, "검출된 streak 특징만으로는 명확한 분류가 어렵습니다."


def pass_matches(nearest_pass_start: Optional[str], nearest_pass_end: Optional[str], exif_datetime: Optional[str]) -> float:
    if not nearest_pass_start or not exif_datetime:
        return 0.0
    exif_dt = parse_exif_datetime(exif_datetime)
    if exif_dt is None:
        return 0.0
    try:
        start = datetime.fromisoformat(nearest_pass_start.replace('Z', '+00:00'))
        end = datetime.fromisoformat(nearest_pass_end.replace('Z', '+00:00')) if nearest_pass_end else start
    except Exception:
        return 0.0
    if start <= exif_dt <= end:
        return 18.0
    delta = min(abs((exif_dt - start).total_seconds()), abs((exif_dt - end).total_seconds()))
    if delta <= 300:
        return 12.0
    if delta <= 900:
        return 6.0
    return 0.0


def parse_exif_datetime(value: str) -> Optional[datetime]:
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def pass_hint(nearest_pass_start, nearest_pass_end, nearest_pass_direction, exif_datetime):
    if not nearest_pass_start:
        return None
    text = f"가장 가까운 예측 pass: {nearest_pass_direction or '방향 정보 없음'}"
    if exif_datetime:
        text += f", 촬영 시각: {exif_datetime}"
    return text

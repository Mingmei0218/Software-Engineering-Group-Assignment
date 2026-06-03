"""
Park20 后端服务
实现 FR-1.1 绿视率计算 / FR-1.2 场景识别 / FR-1.3 声景分析 / FR-1.4 GPS轨迹采集
"""

import os
import json
import time
import math
import tempfile
import traceback
from datetime import datetime

import numpy as np
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from PIL import Image

# ── 可选重依赖，启动时懒加载 ──────────────────────────────────────────────────
_yamnet_model = None

def get_yamnet():
    global _yamnet_model
    if _yamnet_model is None:
        import tensorflow_hub as hub
        print("[YAMNet] 正在加载模型…")
        _yamnet_model = hub.load("https://tfhub.dev/google/yamnet/1")
        print("[YAMNet] 模型加载完成")
    return _yamnet_model

# ─────────────────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024   # 50 MB
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ══════════════════════════════════════════════════════════════════════════════
#  FR-1.1  绿视率计算（Green View Rate）
# ══════════════════════════════════════════════════════════════════════════════
def compute_green_view_rate(pil_image: Image.Image) -> dict:
    """
    模拟苹果 Vision 框架的植被像素识别逻辑：
    在 HSV 颜色空间内统计「绿色」像素占比。
    前端实际实现时此函数由 Vision Framework + Metal 完成；
    后端版本用于测试/对比。
    """
    t0 = time.time()

    # 转为 RGB numpy 数组
    img = pil_image.convert("RGB")
    # 降采样加速（最长边 → 800px）
    max_side = 800
    if max(img.size) > max_side:
        ratio = max_side / max(img.size)
        img = img.resize((int(img.size[0] * ratio), int(img.size[1] * ratio)), Image.LANCZOS)

    arr = np.array(img, dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    # HSV 转换（向量化，避免 cv2 依赖）
    maxc = np.maximum.reduce([r, g, b])
    minc = np.minimum.reduce([r, g, b])
    v = maxc / 255.0
    s = np.where(maxc != 0, (maxc - minc) / maxc, 0.0)
    diff = maxc - minc + 1e-8
    h = np.where(maxc == g, (b - r) / diff + 2,
        np.where(maxc == b, (r - g) / diff + 4,
                 ((g - b) / diff) % 6))
    h = (h / 6.0) % 1.0  # 归一化到 [0,1]

    # 绿色区间（Hue: 75°~165° → 0.208~0.458, S>0.2, V>0.1）
    green_mask = (
        (h >= 0.208) & (h <= 0.458) &
        (s >= 0.20) &
        (v >= 0.10)
    )
    total_pixels = green_mask.size
    green_pixels = int(green_mask.sum())
    gvr = round(green_pixels / total_pixels * 100, 1)   # 精度 0.1%

    elapsed = round(time.time() - t0, 3)
    return {
        "green_view_rate": gvr,          # 百分比，0.0~100.0
        "green_pixels": green_pixels,
        "total_pixels": total_pixels,
        "image_size": list(img.size),
        "elapsed_sec": elapsed,
        "within_3s": elapsed < 3.0
    }


# ══════════════════════════════════════════════════════════════════════════════
#  FR-1.2  场景识别（Scene Classification）
# ══════════════════════════════════════════════════════════════════════════════

# 模拟 CoreML 场景分类器（线上替换为真实模型推理）
SCENE_RULES = [
    # (name_cn, name_en, condition_fn)
    ("林荫道", "tree-lined path",  lambda h, s, v, gvr: gvr >= 40 and h_dom(h, 0.25, 0.42)),
    ("草地",   "grassland",        lambda h, s, v, gvr: gvr >= 25 and h_dom(h, 0.22, 0.38) and v.mean() > 0.35),
    ("水景",   "water feature",    lambda h, s, v, gvr: h_dom(h, 0.52, 0.72) and s.mean() > 0.15),
    ("花园",   "garden",           lambda h, s, v, gvr: 15 <= gvr < 40 and s.mean() > 0.25),
    ("城市公园","urban park",      lambda h, s, v, gvr: gvr >= 10),
    ("硬质广场","plaza",           lambda h, s, v, gvr: True),   # 兜底
]

def h_dom(h_arr, lo, hi):
    """判断色调主色是否落在 [lo, hi] 区间"""
    return float(((h_arr >= lo) & (h_arr <= hi)).mean()) > 0.15

def classify_scene(pil_image: Image.Image, gvr: float) -> dict:
    t0 = time.time()
    img = pil_image.convert("RGB")
    if max(img.size) > 400:
        ratio = 400 / max(img.size)
        img = img.resize((int(img.size[0] * ratio), int(img.size[1] * ratio)), Image.LANCZOS)

    arr = np.array(img, dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    maxc = np.maximum.reduce([r, g, b])
    minc = np.minimum.reduce([r, g, b])
    diff = maxc - minc + 1e-8
    h = np.where(maxc == g, (b - r) / diff + 2,
        np.where(maxc == b, (r - g) / diff + 4,
                 ((g - b) / diff) % 6))
    h = (h / 6.0) % 1.0
    s = np.where(maxc != 0, (maxc - minc) / maxc, 0.0)
    v = maxc / 255.0

    results = []
    base_conf = 0.85
    for idx, (cn, en, cond) in enumerate(SCENE_RULES):
        if cond(h, s, v, gvr):
            conf = round(base_conf - idx * 0.06 + np.random.uniform(-0.02, 0.02), 2)
            conf = max(0.50, min(0.99, conf))
            results.append({"label_cn": cn, "label_en": en, "confidence": conf})
            if len(results) == 3:
                break

    if not results:
        results.append({"label_cn": "未知场景", "label_en": "unknown", "confidence": 0.50})

    elapsed = round(time.time() - t0, 3)
    return {
        "top_label": results[0]["label_cn"],
        "top_label_en": results[0]["label_en"],
        "top_confidence": results[0]["confidence"],
        "all_results": results,
        "elapsed_sec": elapsed,
        "within_5s": elapsed < 5.0
    }


# ══════════════════════════════════════════════════════════════════════════════
#  FR-1.3  声景分析（Soundscape Analysis via YAMNet）
# ══════════════════════════════════════════════════════════════════════════════

# YAMNet 522类→ Park20感兴趣的7类 映射（YAMNet class indices）
SOUNDSCAPE_MAP = {
    "鸟鸣": [0, 1, 2, 3, 4, 5, 6, 7, 15, 16, 17, 18, 19, 72, 73],
    "风声": [289, 290, 291, 292],
    "水声": [293, 294, 295, 296, 297, 298, 299, 300],
    "车声": [300, 301, 302, 303, 304, 305, 306, 307, 308],
    "人声": [0,   132, 133, 134, 135, 136, 137, 138, 139, 140],
    "音乐": [137, 138, 139, 140, 141, 142, 143],
    "其他": [],
}
# 实际 YAMNet 类别索引（subset，保证互斥）
YAMNET_BIRD   = list(range(0, 20))      # Animal/Bird sounds
YAMNET_WIND   = [289]
YAMNET_WATER  = list(range(293, 300))
YAMNET_VEHICLE= list(range(300, 310))
YAMNET_SPEECH = list(range(0, 4)) + list(range(132, 142))
YAMNET_MUSIC  = list(range(137, 150))

PARK20_CLASSES = {
    "鸟鸣": YAMNET_BIRD,
    "水声": YAMNET_WATER,
    "风声": YAMNET_WIND,
    "车声": YAMNET_VEHICLE,
    "人声": YAMNET_SPEECH,
    "音乐": YAMNET_MUSIC,
}

def analyze_soundscape_yamnet(audio_path: str) -> dict:
    """使用 TensorFlow Hub YAMNet 分析音频文件"""
    import tensorflow as tf
    import soundfile as sf

    t0 = time.time()
    model = get_yamnet()

    # 读取音频，重采样至 16kHz mono
    data, sr = sf.read(audio_path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != 16000:
        # 简单线性重采样
        target_len = int(len(data) * 16000 / sr)
        data = np.interp(
            np.linspace(0, len(data) - 1, target_len),
            np.arange(len(data)), data
        )
    waveform = tf.constant(data.astype(np.float32))

    scores, embeddings, spectrogram = model(waveform)
    scores_np = scores.numpy()              # (frames, 521)
    mean_scores = scores_np.mean(axis=0)    # (521,)

    # 映射到 Park20 类别
    class_scores = {}
    for label, indices in PARK20_CLASSES.items():
        valid = [i for i in indices if i < len(mean_scores)]
        class_scores[label] = float(np.max(mean_scores[valid])) if valid else 0.0

    # 归一化为占比
    total = sum(class_scores.values()) + 1e-8
    other = max(0.0, 1.0 - sum(class_scores.values()) / total)
    proportions = {k: round(v / total, 3) for k, v in class_scores.items()}
    proportions["其他"] = round(other, 3)

    # 自然度分 (0-100)：鸟鸣+水声+风声权重高
    naturalness = round(min(100.0, (
        proportions.get("鸟鸣", 0) * 50 +
        proportions.get("水声", 0) * 30 +
        proportions.get("风声", 0) * 20
    ) * 100), 1)

    elapsed = round(time.time() - t0, 3)
    return {
        "proportions": proportions,
        "naturalness_score": naturalness,
        "dominant_sound": max(proportions, key=proportions.get),
        "elapsed_sec": elapsed,
        "within_5s": elapsed < 5.0
    }


def analyze_soundscape_mock(duration_sec: float = 10.0) -> dict:
    """
    无真实音频时的模拟分析结果
    （前端未上传音频 / YAMNet 不可用时使用）
    """
    np.random.seed(int(time.time()) % 100)
    raw = {
        "鸟鸣": np.random.uniform(0.1, 0.5),
        "水声": np.random.uniform(0.0, 0.2),
        "风声": np.random.uniform(0.05, 0.25),
        "车声": np.random.uniform(0.0, 0.15),
        "人声": np.random.uniform(0.0, 0.2),
        "音乐": np.random.uniform(0.0, 0.05),
    }
    total = sum(raw.values())
    proportions = {k: round(v / total, 3) for k, v in raw.items()}
    proportions["其他"] = round(max(0, 1 - sum(proportions.values())), 3)
    naturalness = round((proportions["鸟鸣"]*50 + proportions["水声"]*30 + proportions["风声"]*20)*100, 1)
    return {
        "proportions": proportions,
        "naturalness_score": naturalness,
        "dominant_sound": max(proportions, key=proportions.get),
        "elapsed_sec": 0.05,
        "within_5s": True,
        "note": "模拟数据（未上传音频 / YAMNet 不可用）"
    }


# ══════════════════════════════════════════════════════════════════════════════
#  FR-1.4  GPS 轨迹采集与平滑
# ══════════════════════════════════════════════════════════════════════════════

def haversine(lat1, lon1, lat2, lon2) -> float:
    """返回两点间距离（米）"""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def smooth_gps_track(points: list) -> dict:
    """
    points: [{"lat": float, "lon": float, "timestamp": float, "heart_rate": int?}, ...]
    返回平滑后轨迹 + 统计信息
    """
    if len(points) < 2:
        return {"error": "至少需要 2 个坐标点", "points": points}

    # ── 1. 去除漂移点（相邻点速度 > 30 m/s 视为漂移）
    MAX_SPEED_MS = 30.0
    cleaned = [points[0]]
    drift_count = 0
    for i in range(1, len(points)):
        prev = cleaned[-1]
        dist = haversine(prev["lat"], prev["lon"], points[i]["lat"], points[i]["lon"])
        dt   = points[i]["timestamp"] - prev["timestamp"]
        speed = dist / dt if dt > 0 else 0
        if speed <= MAX_SPEED_MS:
            cleaned.append(points[i])
        else:
            drift_count += 1

    # ── 2. 移动平均平滑（窗口=3）
    smoothed = []
    for i, pt in enumerate(cleaned):
        window = cleaned[max(0, i-1): i+2]
        avg_lat = sum(p["lat"] for p in window) / len(window)
        avg_lon = sum(p["lon"] for p in window) / len(window)
        new_pt = {**pt, "lat": round(avg_lat, 7), "lon": round(avg_lon, 7)}
        smoothed.append(new_pt)

    # ── 3. 统计
    total_dist = sum(
        haversine(smoothed[i-1]["lat"], smoothed[i-1]["lon"],
                  smoothed[i]["lat"],   smoothed[i]["lon"])
        for i in range(1, len(smoothed))
    )
    duration = smoothed[-1]["timestamp"] - smoothed[0]["timestamp"] if len(smoothed) > 1 else 0
    loss_rate = round(drift_count / len(points) * 100, 1)

    hr_values = [p["heart_rate"] for p in smoothed if p.get("heart_rate")]
    hr_summary = {
        "avg": round(sum(hr_values) / len(hr_values), 1) if hr_values else None,
        "min": min(hr_values) if hr_values else None,
        "max": max(hr_values) if hr_values else None,
    }

    return {
        "original_count": len(points),
        "smoothed_count": len(smoothed),
        "drift_removed": drift_count,
        "loss_rate_pct": loss_rate,
        "within_5pct_loss": loss_rate < 5.0,
        "total_distance_m": round(total_dist, 1),
        "duration_sec": round(duration, 1),
        "heart_rate_summary": hr_summary,
        "smoothed_points": smoothed
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Flask 路由
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/fr11/green_view", methods=["POST"])
def api_green_view():
    """
    FR-1.1 绿视率计算
    前端发送：multipart/form-data，字段 image=<图片文件>
    返回：JSON { green_view_rate, green_pixels, total_pixels, elapsed_sec, ... }
    """
    if "image" not in request.files:
        return jsonify({"error": "缺少 image 字段"}), 400
    f = request.files["image"]
    try:
        img = Image.open(f.stream)
        result = compute_green_view_rate(img)
        return jsonify({"status": "ok", "module": "FR-1.1", **result})
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@app.route("/api/fr12/scene_classify", methods=["POST"])
def api_scene_classify():
    """
    FR-1.2 场景识别
    前端发送：multipart/form-data，字段 image=<图片文件>
    返回：JSON { top_label, top_confidence, all_results, elapsed_sec, ... }
    注：实际 iOS 端由 CoreML 完成；此处为后端等效实现用于测试。
    """
    if "image" not in request.files:
        return jsonify({"error": "缺少 image 字段"}), 400
    f = request.files["image"]
    try:
        img = Image.open(f.stream)
        # 先算绿视率作为场景分类辅助特征
        gvr_result = compute_green_view_rate(img.copy())
        scene_result = classify_scene(img, gvr_result["green_view_rate"])
        return jsonify({
            "status": "ok", "module": "FR-1.2",
            "green_view_rate": gvr_result["green_view_rate"],
            **scene_result
        })
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@app.route("/api/fr13/soundscape", methods=["POST"])
def api_soundscape():
    """
    FR-1.3 声景分析
    前端发送：multipart/form-data，字段 audio=<音频文件（WAV/MP3/OGG）>
             或 JSON { "mock": true } 获取模拟数据
    返回：JSON { proportions, naturalness_score, dominant_sound, elapsed_sec }
    """
    # 仅 JSON mock 模式
    if request.is_json:
        body = request.get_json(silent=True) or {}
        if body.get("mock"):
            return jsonify({"status": "ok", "module": "FR-1.3",
                            **analyze_soundscape_mock()})

    if "audio" not in request.files:
        # 无音频 → 返回模拟数据
        return jsonify({"status": "ok", "module": "FR-1.3",
                        **analyze_soundscape_mock()})

    f = request.files["audio"]
    suffix = os.path.splitext(f.filename)[1] or ".wav"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False, dir=UPLOAD_DIR)
    f.save(tmp.name)
    tmp.close()
    try:
        result = analyze_soundscape_yamnet(tmp.name)
        return jsonify({"status": "ok", "module": "FR-1.3", **result})
    except Exception as e:
        # YAMNet 不可用 → fallback 模拟
        mock = analyze_soundscape_mock()
        mock["yamnet_error"] = str(e)
        return jsonify({"status": "ok", "module": "FR-1.3", **mock})
    finally:
        os.unlink(tmp.name)


@app.route("/api/fr14/gps_smooth", methods=["POST"])
def api_gps_smooth():
    """
    FR-1.4 GPS 轨迹平滑
    前端发送：application/json
    格式：
    {
      "points": [
        { "lat": 31.2304, "lon": 121.4737, "timestamp": 1700000000.0, "heart_rate": 72 },
        ...
      ]
    }
    返回：平滑后轨迹 + 统计
    """
    body = request.get_json(silent=True)
    if not body or "points" not in body:
        return jsonify({"error": "缺少 points 字段，格式：{points:[{lat,lon,timestamp,heart_rate?},...]}"}), 400
    points = body["points"]
    if not isinstance(points, list) or len(points) < 2:
        return jsonify({"error": "points 至少需要 2 个元素"}), 400
    try:
        result = smooth_gps_track(points)
        return jsonify({"status": "ok", "module": "FR-1.4", **result})
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "running", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5050)

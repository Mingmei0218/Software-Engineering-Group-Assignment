"""
Park20 场景识别模块（升级版）
============================
实现 FR-1.2（增强）+ 美学评分 + 情绪价值标注

接口：POST /api/fr12/scene_classify
      POST /api/fr12/aesthetic

依赖：
    pip install flask flask-cors Pillow numpy

启动（集成到主 app 时可直接 import 此文件的 scene_bp 蓝图）：
    python 场景识别模块.py   # 独立调试用，端口 5051
"""

import os
import time
import traceback
import math
import random
from datetime import datetime

import numpy as np
from PIL import Image
from flask import Flask, request, jsonify, Blueprint
from flask_cors import CORS

# ══════════════════════════════════════════════════════════════════════════════
#  场景定义库
#  每个场景包含：中文名、英文名、颜色特征规则、情绪标签、疗愈描述、匹配置信度基线
# ══════════════════════════════════════════════════════════════════════════════

SCENE_PROFILES = [
    {
        "name_cn": "林荫道",
        "name_en": "tree-lined path",
        "emoji": "🌳",
        "emotion_tag": "清凉静谧",
        "healing_mood": "适合冥想与深度放松",
        "scene_desc_templates": [
            "浓密的树冠交织成绿色拱廊，阳光透过叶隙洒下斑驳光影",
            "参天大树排列成行，枝叶相接形成天然穹顶，清风拂过带来阵阵凉意",
            "绿荫铺就的小径蜿蜒伸展，光影在地面勾勒出迷人的流动图案"
        ],
        "healing_comments": [
            "漫步其中，仿佛置身天然氧吧，身心都得到了深度滋养",
            "树荫下的清凉与绿意，让紧绷的神经自然舒展开来",
            "这份绿意盎然的静谧，是城市中难得的心灵避风港"
        ],
        # 匹配条件：高绿视率 + 绿色色调主导 + 一定垂直结构
        "condition": lambda h, s, v, gvr, brightness, saturation: (
            gvr >= 38 and
            _hue_dominance(h, 0.22, 0.45) >= 0.18 and
            brightness > 0.15
        ),
        "base_confidence": 0.88,
    },
    {
        "name_cn": "阳光草坪",
        "name_en": "sunny lawn",
        "emoji": "🌿",
        "emotion_tag": "开阔明朗",
        "healing_mood": "心情愉悦，适合放空发呆",
        "scene_desc_templates": [
            "开阔的草坪在阳光下泛着翠绿，天空与绿地相接，视野无限延伸",
            "大片草坪舒展平铺，和煦阳光洒在每一片叶尖，闪烁着细碎金光",
            "碧绿的草地向远处铺展，明亮的自然光让整个空间充满生机活力"
        ],
        "healing_comments": [
            "开阔的视野帮助眼部肌肉彻底放松，让思绪也随之飞翔",
            "绿色与阳光的组合，是大自然最温柔的疗愈配方",
            "躺在这片草坪上，烦恼好像也跟着云朵飘散了"
        ],
        "condition": lambda h, s, v, gvr, brightness, saturation: (
            gvr >= 22 and
            _hue_dominance(h, 0.22, 0.40) >= 0.15 and
            brightness > 0.40 and
            saturation < 0.45
        ),
        "base_confidence": 0.84,
    },
    {
        "name_cn": "静谧湖畔",
        "name_en": "lakeside",
        "emoji": "🏞️",
        "emotion_tag": "宁静致远",
        "healing_mood": "安抚焦虑，沉淀内心",
        "scene_desc_templates": [
            "湖面如镜，倒映着岸边的绿树与天空，时光在此刻变得格外温柔",
            "碧波荡漾的水面将周围景物揉碎成光与色的交响，宁静中蕴含流动之美",
            "水天一色的开阔感，让所有的压力都随波纹慢慢漾散"
        ],
        "healing_comments": [
            "望着平静的水面，焦躁的思绪不知不觉沉淀下来",
            "水边的静谧有一种魔力，能让心跳自然放慢到最舒适的节奏",
            "蓝绿相间的色调，是大自然为疲惫的眼睛精心调配的疗愈色"
        ],
        "condition": lambda h, s, v, gvr, brightness, saturation: (
            _hue_dominance(h, 0.50, 0.72) >= 0.12 and
            saturation > 0.12 and
            brightness > 0.25
        ),
        "base_confidence": 0.82,
    },
    {
        "name_cn": "花海",
        "name_en": "flower field",
        "emoji": "🌸",
        "emotion_tag": "浪漫愉悦",
        "healing_mood": "提振情绪，带来幸福感",
        "scene_desc_templates": [
            "姹紫嫣红的花朵竞相绽放，色彩丰富得像是调色盘打翻在大地上",
            "花香与色彩交织的世界里，每一步都是对感官的温柔礼赞",
            "繁花似锦的画面让人心旷神怡，色彩的丰盛本身就是一种治愈"
        ],
        "healing_comments": [
            "丰富的色彩能有效刺激大脑分泌多巴胺，让快乐自然涌现",
            "置身花海，所有感官都被温柔地唤醒，生命力充盈而满足",
            "这份缤纷的美丽，是自然给予城市人最慷慨的馈赠"
        ],
        "condition": lambda h, s, v, gvr, brightness, saturation: (
            saturation > 0.35 and
            _hue_diversity(h) >= 0.28 and
            brightness > 0.30 and
            gvr < 55
        ),
        "base_confidence": 0.80,
    },
    {
        "name_cn": "竹林小径",
        "name_en": "bamboo grove",
        "emoji": "🎋",
        "emotion_tag": "禅意空灵",
        "healing_mood": "净化心灵，找回专注",
        "scene_desc_templates": [
            "修竹挺拔成林，风过处竹叶轻响，如天然白噪音般抚慰心灵",
            "翠绿的竹杆笔直向上，光线在竹隙间形成充满禅意的光影层次",
            "幽深的竹径安静而悠长，踏入其中仿佛隔绝了城市的一切喧嚣"
        ],
        "healing_comments": [
            "竹林特有的绿意与静谧，是天然的冥想道场",
            "在这片清幽之中，杂念自然消散，专注力悄然回归",
            "中国传统美学里最治愈的场景，在这里得到了完美呈现"
        ],
        "condition": lambda h, s, v, gvr, brightness, saturation: (
            gvr >= 45 and
            _hue_dominance(h, 0.28, 0.42) >= 0.22 and
            brightness < 0.55 and
            saturation > 0.18
        ),
        "base_confidence": 0.79,
    },
    {
        "name_cn": "古建园林",
        "name_en": "classical garden",
        "emoji": "🏯",
        "emotion_tag": "文化底蕴",
        "healing_mood": "陶冶情操，感受历史温度",
        "scene_desc_templates": [
            "古典建筑与自然山水相得益彰，每一处细节都凝聚着匠心与岁月",
            "飞檐翘角与绿植水景和谐共处，构成一幅流动的东方美学画卷",
            "亭台楼阁掩映在花木之间，古今对话在这一方天地悄然发生"
        ],
        "healing_comments": [
            "与历史的对话让浮躁的心平静下来，感受到时间更深的维度",
            "东方美学的精髓在于留白与意境，让心灵找到呼吸的空间",
            "漫步古典园林，是一场给灵魂的人文疗愈之旅"
        ],
        "condition": lambda h, s, v, gvr, brightness, saturation: (
            10 <= gvr <= 40 and
            saturation < 0.30 and
            _hue_diversity(h) >= 0.22
        ),
        "base_confidence": 0.75,
    },
    {
        "name_cn": "城市公园",
        "name_en": "urban park",
        "emoji": "🌇",
        "emotion_tag": "轻松惬意",
        "healing_mood": "短暂逃离都市，充电蓄能",
        "scene_desc_templates": [
            "城市绿洲中，自然与人文交织，提供了一处宝贵的喘息空间",
            "绿植与城市轮廓相互映衬，繁忙都市里的一片清新角落",
            "公园的绿意为水泥森林注入了生命力，让人重新感受自然的存在"
        ],
        "healing_comments": [
            "即使是短暂的绿色接触，也能有效降低城市压力激素水平",
            "城市公园的价值，在于让忙碌的人们记起慢下来的感觉",
            "这片城市里的自然，是都市人保持心理健康的重要锚点"
        ],
        "condition": lambda h, s, v, gvr, brightness, saturation: gvr >= 8,
        "base_confidence": 0.70,
    },
    {
        "name_cn": "硬质广场",
        "name_en": "plaza",
        "emoji": "🏙️",
        "emotion_tag": "活力开放",
        "healing_mood": "社交互动，感受城市活力",
        "scene_desc_templates": [
            "开阔的广场提供了宽敞的公共空间，是城市活力的汇聚之处",
            "硬质铺装的广场与天空相接，带来不同于自然的开阔感受",
            "城市广场以其独特的方式承载着人们的相遇与故事"
        ],
        "healing_comments": [
            "开放空间带来的呼吸感，也是一种值得珍视的城市体验",
            "不同类型的公共空间满足不同的心理需求，广场带来社交活力",
            "在这里感受城市的呼吸，也是一种独特的疗愈方式"
        ],
        "condition": lambda h, s, v, gvr, brightness, saturation: True,  # 兜底
        "base_confidence": 0.60,
    },
]


# ══════════════════════════════════════════════════════════════════════════════
#  色彩分析工具函数
# ══════════════════════════════════════════════════════════════════════════════

def _extract_hsv(pil_image: Image.Image, max_side: int = 600):
    """将 PIL 图像转为 H/S/V numpy 数组（归一化至 [0,1]）"""
    img = pil_image.convert("RGB")
    if max(img.size) > max_side:
        ratio = max_side / max(img.size)
        img = img.resize(
            (int(img.size[0] * ratio), int(img.size[1] * ratio)),
            Image.LANCZOS
        )
    arr = np.array(img, dtype=np.float32)
    r, g, b = arr[:, :, 0] / 255.0, arr[:, :, 1] / 255.0, arr[:, :, 2] / 255.0

    maxc = np.maximum.reduce([r, g, b])
    minc = np.minimum.reduce([r, g, b])
    diff = maxc - minc + 1e-8

    v = maxc
    s = np.where(maxc > 0, (maxc - minc) / maxc, 0.0)
    h = np.where(
        maxc == g, (b - r) / diff + 2,
        np.where(maxc == b, (r - g) / diff + 4, ((g - b) / diff) % 6)
    )
    h = (h / 6.0) % 1.0

    return h, s, v, img.size


def _hue_dominance(h_arr: np.ndarray, lo: float, hi: float) -> float:
    """返回落在色调区间 [lo, hi] 的像素比例"""
    return float(((h_arr >= lo) & (h_arr <= hi)).mean())


def _hue_diversity(h_arr: np.ndarray, bins: int = 12) -> float:
    """
    计算色调多样性（0-1）：
    将色调分成 bins 个区间，用 Shannon 熵归一化衡量分布均匀度
    """
    hist, _ = np.histogram(h_arr, bins=bins, range=(0, 1))
    hist = hist.astype(float) + 1e-8
    hist /= hist.sum()
    entropy = -np.sum(hist * np.log(hist))
    max_entropy = math.log(bins)
    return float(entropy / max_entropy)


def _compute_gvr(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> float:
    """快速绿视率（绿色像素占比，与 FR-1.1 逻辑一致）"""
    mask = (h >= 0.208) & (h <= 0.458) & (s >= 0.20) & (v >= 0.10)
    return round(float(mask.mean() * 100), 1)


# ══════════════════════════════════════════════════════════════════════════════
#  美学评分模块
# ══════════════════════════════════════════════════════════════════════════════

def compute_aesthetic_score(
    h: np.ndarray, s: np.ndarray, v: np.ndarray,
    gvr: float, img_size: tuple
) -> dict:
    """
    综合美学评分，返回 0-100 整数。

    四个维度：
    1. 色彩和谐度（25%）：画面主色是否和谐，避免高对比刺眼配色
    2. 视觉丰富度（20%）：色彩多样性与层次感
    3. 光线质量（15%）：亮度适中、避免过曝/欠曝
    4. 绿色体验感（40%）：绿视率加权（核心疗愈指标）

    最终公式：
        绿视体验分 = (绿色占比×0.40) + (色彩和谐×0.25) + (视觉丰富×0.20) + (光线质量×0.15)
    """

    # ── 1. 绿色体验感（直接使用 GVR，映射到 0-1）
    green_score = min(1.0, gvr / 100.0)

    # ── 2. 色彩和谐度
    # 原理：自然场景中饱和度分布应适中（0.2-0.6），过高或过低都不和谐
    mean_s = float(s.mean())
    # 用高斯曲线：最优饱和度 ≈ 0.35
    color_harmony = math.exp(-((mean_s - 0.35) ** 2) / (2 * 0.18 ** 2))
    # 色调凝聚度：主色鲜明加分
    hue_std = float(h.std())
    cohesion = max(0.0, 1.0 - hue_std * 1.5)
    color_harmony_score = 0.6 * color_harmony + 0.4 * cohesion

    # ── 3. 视觉丰富度
    diversity = _hue_diversity(h, bins=16)
    # 丰富但不杂乱（中等多样性最好）：最优 ≈ 0.55
    richness_score = math.exp(-((diversity - 0.55) ** 2) / (2 * 0.22 ** 2))
    # 额外奖励绿色与非绿色的层次对比
    green_non_green_balance = abs(green_score - 0.5) < 0.3
    if green_non_green_balance:
        richness_score = min(1.0, richness_score + 0.1)

    # ── 4. 光线质量
    mean_v = float(v.mean())
    # 亮度适中（0.35-0.70）为佳
    brightness_score = math.exp(-((mean_v - 0.52) ** 2) / (2 * 0.20 ** 2))
    # 亮度标准差：光影层次丰富加分
    v_std = float(v.std())
    light_contrast_bonus = min(0.15, v_std * 0.5)
    light_score = min(1.0, brightness_score + light_contrast_bonus)

    # ── 综合加权
    weights = {
        "green": 0.40,
        "harmony": 0.25,
        "richness": 0.20,
        "light": 0.15,
    }
    raw_score = (
        green_score      * weights["green"] +
        color_harmony_score * weights["harmony"] +
        richness_score   * weights["richness"] +
        light_score      * weights["light"]
    )

    # 映射到 0-100，保留整数
    aesthetic_score = int(round(min(100, max(0, raw_score * 100))))

    # ── 情绪价值标签（根据综合得分）
    if aesthetic_score >= 80:
        emotional_value = "深度治愈"
    elif aesthetic_score >= 65:
        emotional_value = "治愈"
    elif aesthetic_score >= 50:
        emotional_value = "舒适"
    elif aesthetic_score >= 35:
        emotional_value = "平静"
    else:
        emotional_value = "中性"

    return {
        "aesthetic_score": aesthetic_score,
        "emotional_value": emotional_value,
        "dimension_scores": {
            "green_experience": round(green_score * 100),
            "color_harmony": round(color_harmony_score * 100),
            "visual_richness": round(richness_score * 100),
            "light_quality": round(light_score * 100),
        },
        "raw_metrics": {
            "mean_saturation": round(mean_s, 3),
            "mean_brightness": round(mean_v, 3),
            "hue_diversity": round(diversity, 3),
        }
    }


# ══════════════════════════════════════════════════════════════════════════════
#  场景识别主函数
# ══════════════════════════════════════════════════════════════════════════════

def classify_scene_enhanced(pil_image: Image.Image) -> dict:
    """
    增强版场景识别：
    - 匹配 SCENE_PROFILES 中的规则（按优先级从高到低）
    - 计算美学评分
    - 生成个性化场景描述 + 疗愈评语

    返回符合后端对接清单格式的 JSON-ready dict
    """
    t0 = time.time()

    # ── 提取 HSV 特征
    h, s, v, img_size = _extract_hsv(pil_image, max_side=600)
    gvr = _compute_gvr(h, s, v)
    brightness = float(v.mean())
    saturation = float(s.mean())

    # ── 场景匹配（取前三个匹配项）
    matched = []
    for profile in SCENE_PROFILES:
        try:
            if profile["condition"](h, s, v, gvr, brightness, saturation):
                # 置信度 = 基线 + 随机扰动（模拟 CoreML 不确定性）
                conf = profile["base_confidence"] + random.uniform(-0.04, 0.04)
                conf = round(max(0.50, min(0.99, conf)), 2)
                matched.append({
                    "label_cn": profile["name_cn"],
                    "label_en": profile["name_en"],
                    "emoji": profile["emoji"],
                    "confidence": conf,
                    "emotion_tag": profile["emotion_tag"],
                    "healing_mood": profile["healing_mood"],
                })
                if len(matched) == 3:
                    break
        except Exception:
            continue

    if not matched:
        matched.append({
            "label_cn": "城市公园",
            "label_en": "urban park",
            "emoji": "🌳",
            "confidence": 0.55,
            "emotion_tag": "轻松惬意",
            "healing_mood": "短暂逃离都市，充电蓄能",
        })

    # ── 主场景
    top = matched[0]
    top_profile = next(
        (p for p in SCENE_PROFILES if p["name_cn"] == top["label_cn"]),
        SCENE_PROFILES[-2]  # 兜底城市公园
    )

    # ── 随机选取描述文案（保证每次有变化）
    scene_description = random.choice(top_profile["scene_desc_templates"])
    healing_comment = random.choice(top_profile["healing_comments"])

    # ── 美学评分
    aesthetic_result = compute_aesthetic_score(h, s, v, gvr, img_size)

    elapsed = round(time.time() - t0, 3)

    return {
        # 原有字段（保持与 FR-1.2 接口兼容）
        "green_view_rate": gvr,
        "top_label": top["label_cn"],
        "top_label_en": top["label_en"],
        "top_confidence": top["confidence"],
        "all_results": matched,
        "elapsed_sec": elapsed,
        "within_5s": elapsed < 5.0,

        # 新增：美学评分维度
        "aesthetic_score": aesthetic_result["aesthetic_score"],
        "emotional_value": aesthetic_result["emotional_value"],

        # 新增：场景人性化描述
        "scene_description": scene_description,
        "healing_comment": healing_comment,

        # 新增：情绪标签
        "emotion_tag": top["emotion_tag"],
        "healing_mood": top["healing_mood"],

        # 新增：维度得分（供前端图表展示）
        "dimension_scores": aesthetic_result["dimension_scores"],
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Flask Blueprint（集成到主 app 时使用）
# ══════════════════════════════════════════════════════════════════════════════

scene_bp = Blueprint("scene", __name__)


@scene_bp.route("/api/fr12/scene_classify", methods=["POST"])
def api_scene_classify():
    """
    FR-1.2 升级版场景识别
    ----------------------
    请求：multipart/form-data，字段 image=<图片文件>
    返回：
    {
      "status": "ok",
      "module": "FR-1.2-enhanced",
      "green_view_rate": 68.5,
      "aesthetic_score": 85,
      "emotional_value": "治愈",
      "scene_description": "浓密的梧桐林荫道，阳光透过树叶洒下斑驳光影",
      "healing_comment": "漫步其中，仿佛置身天然氧吧，身心都得到了放松",
      "emotion_tag": "清凉静谧",
      "healing_mood": "适合冥想与深度放松",
      "top_label": "林荫道",
      "top_confidence": 0.87,
      "all_results": [...],
      "dimension_scores": {...},
      "elapsed_sec": 0.12,
      "within_5s": true
    }
    """
    if "image" not in request.files:
        return jsonify({"error": "缺少 image 字段，请以 multipart/form-data 上传图片"}), 400

    f = request.files["image"]
    try:
        img = Image.open(f.stream)
        result = classify_scene_enhanced(img)
        return jsonify({
            "status": "ok",
            "module": "FR-1.2-enhanced",
            **result
        })
    except Exception as e:
        return jsonify({
            "error": f"场景识别失败：{str(e)}",
            "trace": traceback.format_exc()
        }), 500


@scene_bp.route("/api/fr12/aesthetic", methods=["POST"])
def api_aesthetic_only():
    """
    单独获取美学评分（不含场景分类，速度更快）
    请求：multipart/form-data，字段 image=<图片文件>
    返回：
    {
      "status": "ok",
      "aesthetic_score": 85,
      "emotional_value": "治愈",
      "dimension_scores": {
        "green_experience": 70,
        "color_harmony": 88,
        "visual_richness": 75,
        "light_quality": 82
      }
    }
    """
    if "image" not in request.files:
        return jsonify({"error": "缺少 image 字段"}), 400
    f = request.files["image"]
    try:
        img = Image.open(f.stream)
        h, s, v, img_size = _extract_hsv(img, max_side=400)
        gvr = _compute_gvr(h, s, v)
        result = compute_aesthetic_score(h, s, v, gvr, img_size)
        return jsonify({"status": "ok", **result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
#  独立运行（调试用）
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(scene_bp)
    print("=" * 55)
    print("  Park20 场景识别模块 — 独立调试模式")
    print("  接口：http://0.0.0.0:5051/api/fr12/scene_classify")
    print("  接口：http://0.0.0.0:5051/api/fr12/aesthetic")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5051, debug=True)

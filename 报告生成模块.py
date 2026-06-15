"""
Park20 报告生成模块
===================
实现 SRS FR-5.1：体验报告自动生成

接口：POST /api/report/generate
      GET  /api/report/<report_id>
      GET  /api/report/<report_id>/thumbnail   （base64 缩略图，需安装 playwright/weasyprint）

依赖：
    pip install flask flask-cors Pillow numpy

可选（HTML → PNG 缩略图）：
    pip install playwright && playwright install chromium

启动（集成到主 app 时可直接 import report_bp）：
    python 报告生成模块.py   # 独立调试用，端口 5052
"""

import os
import json
import time
import math
import random
import hashlib
import traceback
import base64
from datetime import datetime
from io import BytesIO
from typing import Optional

import numpy as np
from flask import Flask, request, jsonify, Blueprint
from flask_cors import CORS

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# ══════════════════════════════════════════════════════════════════════════════
#  内存报告存储（生产环境换成数据库）
# ══════════════════════════════════════════════════════════════════════════════

_REPORT_STORE: dict[str, dict] = {}  # report_id → report_data


# ══════════════════════════════════════════════════════════════════════════════
#  风格配置：5 套报告主题
# ══════════════════════════════════════════════════════════════════════════════

REPORT_THEMES = [
    {
        "id": "forest",
        "name": "森系清新",
        "primary": "#2D6A4F",
        "secondary": "#52B788",
        "accent": "#B7E4C7",
        "bg_gradient": "linear-gradient(135deg, #F0FAF4 0%, #D8F3DC 50%, #B7E4C7 100%)",
        "card_bg": "rgba(255,255,255,0.82)",
        "text_primary": "#1B4332",
        "text_secondary": "#2D6A4F",
        "badge_bg": "#52B788",
        "decoration": "🌿",
        "font_style": "Georgia, 'Noto Serif SC', serif",
    },
    {
        "id": "watercolor",
        "name": "水彩温柔",
        "primary": "#6B9AB8",
        "secondary": "#A8D5E8",
        "accent": "#F9E0D9",
        "bg_gradient": "linear-gradient(160deg, #FFF9F5 0%, #EDF7FF 40%, #F5EFFF 100%)",
        "card_bg": "rgba(255,255,255,0.88)",
        "text_primary": "#2C3E6B",
        "text_secondary": "#6B9AB8",
        "badge_bg": "#A8D5E8",
        "decoration": "🎨",
        "font_style": "'PingFang SC', 'Hiragino Sans GB', sans-serif",
    },
    {
        "id": "minimal",
        "name": "简约克制",
        "primary": "#2C2C2C",
        "secondary": "#555555",
        "accent": "#E8E8E8",
        "bg_gradient": "linear-gradient(180deg, #FAFAFA 0%, #F0F0F0 100%)",
        "card_bg": "rgba(255,255,255,0.95)",
        "text_primary": "#1A1A1A",
        "text_secondary": "#666666",
        "badge_bg": "#2C2C2C",
        "decoration": "◆",
        "font_style": "'PingFang SC', 'Microsoft YaHei', sans-serif",
    },
    {
        "id": "sketch",
        "name": "手绘自然",
        "primary": "#7B6D47",
        "secondary": "#A89060",
        "accent": "#EDE0C4",
        "bg_gradient": "linear-gradient(145deg, #FFFDF5 0%, #F5EDD8 50%, #EDE0C4 100%)",
        "card_bg": "rgba(255,253,245,0.90)",
        "text_primary": "#3D3019",
        "text_secondary": "#7B6D47",
        "badge_bg": "#A89060",
        "decoration": "✏️",
        "font_style": "Georgia, 'Noto Serif SC', serif",
    },
    {
        "id": "japan",
        "name": "日系禅意",
        "primary": "#C25B78",
        "secondary": "#E8A4B8",
        "accent": "#F8E8EE",
        "bg_gradient": "linear-gradient(135deg, #FFF5F8 0%, #FFE8EF 40%, #F8E8EE 100%)",
        "card_bg": "rgba(255,255,255,0.85)",
        "text_primary": "#3D1A24",
        "text_secondary": "#C25B78",
        "badge_bg": "#E8A4B8",
        "decoration": "🌸",
        "font_style": "'PingFang SC', 'Hiragino Sans GB', sans-serif",
    },
]

# ── 文案风格库
COPY_STYLES = {
    "literary": {  # 文艺风
        "title_templates": [
            "我的公园疗愈日记",
            "{park_name}的下午时光",
            "与自然的{duration_min}分钟约定",
            "{scene_label}漫步记",
        ],
        "summary_templates": [
            "今天在{park_name}走了{duration_min}分钟，{scene_label}的绿意浸润了每一个感官。"
            "脚步慢下来的时候，城市的喧嚣也跟着远去，只剩下树叶轻响和内心的平静。"
            "疗愈指数{healing_index}分，是自然给予这段时光的温柔评分。",

            "绿视率{green_view}%，声景自然度{soundscape}分——"
            "这些数字背后，是今天在{park_name}最真实的感受：被绿意包围、被自然治愈。"
            "走了{distance_m}米，每一步都是城市里难得的留白。",
        ],
        "achievement_label": "今日疗愈成就 · 自然漫行者",
    },
    "healing": {  # 治愈风
        "title_templates": [
            "今天，被自然治愈了 ✨",
            "{park_name}给了我满满能量",
            "充了电的{duration_min}分钟",
            "被{scene_label}温柔包裹的下午",
        ],
        "summary_templates": [
            "今天在{park_name}的{duration_min}分钟太值得了！💚 "
            "绿视率{green_view}%，满眼都是治愈的绿意。"
            "心率从{hr_start}降到了{hr_end}，身体在悄悄说谢谢。"
            "疗愈指数{healing_index}分，这个数字让我很满足！",

            "走了{distance_m}米，收获了{healing_index}分的疗愈力量 🌿 "
            "{scene_label}真的很适合来放空，声景自然度{soundscape}分，"
            "耳边都是大自然最好听的声音。今天的自己，值得这份宠爱。",
        ],
        "achievement_label": "🌟 能量满格 · 自然充电完成",
    },
    "data": {  # 数据风
        "title_templates": [
            "公园体验量化报告 · {date}",
            "{park_name} 疗愈数据分析",
            "本次采集摘要 · {duration_min}min",
            "绿色体验指标报告",
        ],
        "summary_templates": [
            "本次采集时长 {duration_min} 分钟，行走距离 {distance_m}m，"
            "平均心率 {avg_hr}bpm。绿视率 {green_view}%，"
            "声景自然度评分 {soundscape}/100，综合疗愈指数 {healing_index}/100。"
            "场景类型：{scene_label}。数据提示本次活动具有良好的身心恢复效果。",

            "采集摘要：时长={duration_min}min，距离={distance_m}m，HR_avg={avg_hr}bpm。"
            "环境指标：GVR={green_view}%，声景={soundscape}pts，疗愈指数={healing_index}pts。"
            "本次数据质量良好，建议定期在{park_name}进行健康采集活动。",
        ],
        "achievement_label": "📊 数据达人 · 量化健康先行者",
    },
    "lively": {  # 活泼风
        "title_templates": [
            "冲鸭！今天去{park_name}了！",
            "{duration_min}分钟森林浴打卡✅",
            "今天的{scene_label}超美哒~",
            "自然治愈小日记 🌱",
        ],
        "summary_templates": [
            "哇！今天在{park_name}转了一圈，绿视率{green_view}%，"
            "眼睛都喝饱了绿色！走了{distance_m}米，消耗了坏心情，"
            "充满了好能量！疗愈指数{healing_index}分，好棒啊！"
            "下次还来！🌿✨",

            "{duration_min}分钟说长不长说短不短，"
            "但在{scene_label}里这段时间就是会变得特别有质量！"
            "心率{avg_hr}bpm，很稳健！声景自然度{soundscape}分，"
            "大自然的BGM真的YYDS！疗愈指数{healing_index}，爱了爱了！",
        ],
        "achievement_label": "🎉 活力满满 · 打卡疗愈达人",
    },
}


# ══════════════════════════════════════════════════════════════════════════════
#  疗愈指数计算（SRS 附录 A 公式）
# ══════════════════════════════════════════════════════════════════════════════

def compute_healing_index(modules_data: dict) -> dict:
    """
    按 SRS 附录 A 公式计算疗愈指数
    疗愈指数 = (GVR_norm×0.35 + 声景自然度_norm×0.20 + 生理恢复度_norm×0.45) × 100
    """
    green_view = modules_data.get("green_view", {})
    soundscape = modules_data.get("soundscape", {})
    health = modules_data.get("health", {})

    # ── 绿视率归一化
    gvr = green_view.get("green_view_rate", 0)
    gvr_norm = min(1.0, max(0.0, gvr / 100.0))

    # ── 声景自然度归一化
    natural_score = soundscape.get("naturalness_score", 0)
    sound_norm = min(1.0, max(0.0, natural_score / 100.0))

    # ── 生理恢复度（HR + RMSSD）
    hr_start = health.get("hr_start", 0)
    hr_end = health.get("hr_end", 0)
    rmssd = health.get("rmssd", 0)
    has_health_data = (hr_start > 0 and hr_end > 0)

    if has_health_data:
        hr_norm = min(1.0, max(0.0, (hr_start - hr_end) / max(hr_start, 1)))
        rmssd_norm = min(1.0, rmssd / 80.0)
        physio_norm = 0.5 * hr_norm + 0.5 * rmssd_norm
        w_green, w_sound, w_physio = 0.35, 0.20, 0.45
    else:
        # 无生理数据 → 权重重分配
        physio_norm = 0.0
        w_green, w_sound, w_physio = 0.60, 0.40, 0.0

    raw = w_green * gvr_norm + w_sound * sound_norm + w_physio * physio_norm
    healing_index = int(round(min(100, max(0, raw * 100))))

    # ── 等级描述
    if healing_index >= 80:
        level = "优秀"
        level_desc = "本次体验达到深度疗愈级别，身心获得充分滋养"
    elif healing_index >= 60:
        level = "良好"
        level_desc = "本次体验具有明显疗愈效果，推荐定期进行"
    elif healing_index >= 40:
        level = "一般"
        level_desc = "本次体验有一定疗愈价值，可尝试选择更自然的场景"
    else:
        level = "待提升"
        level_desc = "建议前往绿化更丰富、自然声更多的区域"

    return {
        "healing_index": healing_index,
        "level": level,
        "level_desc": level_desc,
        "breakdown": {
            "green_norm": round(gvr_norm, 3),
            "sound_norm": round(sound_norm, 3),
            "physio_norm": round(physio_norm, 3) if has_health_data else None,
        },
        "has_health_data": has_health_data,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  声景饼图 SVG 生成
# ══════════════════════════════════════════════════════════════════════════════

SOUND_COLORS = {
    "鸟鸣": "#52B788",
    "水声": "#4895EF",
    "风声": "#90E0EF",
    "车声": "#F48C06",
    "人声": "#E9C46A",
    "音乐": "#C77DFF",
    "其他": "#CCCCCC",
}

def _pie_svg(proportions: dict, size: int = 120) -> str:
    """生成声景比例饼图 SVG（纯几何，无需 matplotlib）"""
    cx, cy, r = size / 2, size / 2, size / 2 - 4
    items = [(k, v) for k, v in proportions.items() if v > 0.01]
    if not items:
        return f'<svg width="{size}" height="{size}"></svg>'

    total = sum(v for _, v in items)
    slices = []
    angle = -math.pi / 2  # 从顶部开始

    for label, value in items:
        sweep = (value / total) * 2 * math.pi
        x1 = cx + r * math.cos(angle)
        y1 = cy + r * math.sin(angle)
        angle += sweep
        x2 = cx + r * math.cos(angle)
        y2 = cy + r * math.sin(angle)
        large_arc = 1 if sweep > math.pi else 0
        color = SOUND_COLORS.get(label, "#CCCCCC")
        path = (
            f'<path d="M {cx:.1f} {cy:.1f} L {x1:.1f} {y1:.1f} '
            f'A {r:.1f} {r:.1f} 0 {large_arc} 1 {x2:.1f} {y2:.1f} Z" '
            f'fill="{color}" stroke="white" stroke-width="1.5"/>'
        )
        slices.append(path)

    return (
        f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" '
        f'xmlns="http://www.w3.org/2000/svg">'
        + "".join(slices)
        + "</svg>"
    )


def _pie_legend_html(proportions: dict, theme: dict) -> str:
    """生成饼图图例 HTML"""
    items = [(k, v) for k, v in proportions.items() if v > 0.01]
    items.sort(key=lambda x: -x[1])
    legend = ""
    for label, value in items[:5]:
        color = SOUND_COLORS.get(label, "#CCC")
        pct = round(value * 100, 1)
        legend += (
            f'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
            f'<div style="width:10px;height:10px;border-radius:2px;background:{color};flex-shrink:0;"></div>'
            f'<span style="font-size:12px;color:{theme["text_secondary"]};">{label} {pct}%</span>'
            f'</div>'
        )
    return legend


# ══════════════════════════════════════════════════════════════════════════════
#  评分圆环 SVG
# ══════════════════════════════════════════════════════════════════════════════

def _score_ring_svg(score: int, color: str, size: int = 80) -> str:
    """生成单个评分圆环"""
    r = size / 2 - 6
    circumference = 2 * math.pi * r
    dashoffset = circumference * (1 - score / 100)
    cx = cy = size / 2
    return (
        f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" xmlns="http://www.w3.org/2000/svg">'
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#E8E8E8" stroke-width="6"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="6" '
        f'stroke-dasharray="{circumference:.1f}" stroke-dashoffset="{dashoffset:.1f}" '
        f'stroke-linecap="round" transform="rotate(-90 {cx} {cy})"/>'
        f'<text x="{cx}" y="{cy+1}" text-anchor="middle" dominant-baseline="middle" '
        f'font-size="16" font-weight="bold" fill="{color}">{score}</text>'
        f'</svg>'
    )


# ══════════════════════════════════════════════════════════════════════════════
#  GPS 轨迹迷你地图 SVG
# ══════════════════════════════════════════════════════════════════════════════

def _track_svg(points: list, theme: dict, width: int = 320, height: int = 140) -> str:
    """将 GPS 坐标列表渲染为简单折线图"""
    if len(points) < 2:
        return ""
    lats = [p["lat"] for p in points]
    lons = [p["lon"] for p in points]
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)

    pad = 16
    def to_xy(lat, lon):
        if lat_max == lat_min:
            y = height / 2
        else:
            y = pad + (lat_max - lat) / (lat_max - lat_min) * (height - 2 * pad)
        if lon_max == lon_min:
            x = width / 2
        else:
            x = pad + (lon - lon_min) / (lon_max - lon_min) * (width - 2 * pad)
        return x, y

    coords = [to_xy(p["lat"], p["lon"]) for p in points]
    polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)

    # 起点 / 终点标记
    sx, sy = coords[0]
    ex, ey = coords[-1]

    return (
        f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'xmlns="http://www.w3.org/2000/svg">'
        f'<rect width="{width}" height="{height}" rx="8" fill="{theme["accent"]}" opacity="0.5"/>'
        f'<polyline points="{polyline}" fill="none" stroke="{theme["primary"]}" '
        f'stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
        f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="5" fill="#52B788" stroke="white" stroke-width="2"/>'
        f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="5" fill="#E63946" stroke="white" stroke-width="2"/>'
        f'</svg>'
    )


# ══════════════════════════════════════════════════════════════════════════════
#  主报告 HTML 生成
# ══════════════════════════════════════════════════════════════════════════════

def _format_duration(sec: int) -> str:
    m = sec // 60
    s = sec % 60
    return f"{m}分{s:02d}秒" if s else f"{m}分钟"

def _score_color(score: int) -> str:
    if score >= 80: return "#2D6A4F"
    if score >= 50: return "#F48C06"
    return "#E63946"


def generate_report_html(data: dict) -> str:
    """
    生成完整 HTML 报告（单文件，CSS 内嵌）

    data 结构：
    {
      "record_id": "xxx",
      "user_image": "data:image/...;base64,...",   # 可选
      "modules_data": {
        "green_view": { "green_view_rate": 68.5, "aesthetic_score": 85, ... },
        "scene":      { "top_label": "林荫道", "scene_description": "...", "healing_comment": "..." },
        "soundscape": { "proportions": {...}, "naturalness_score": 72 },
        "gps":        { "smoothed_points": [...], "total_distance_m": 850 },
        "health":     { "avg_hr": 78, "hr_start": 88, "hr_end": 72, "rmssd": 45 }
      },
      "park_name": "世纪公园",
      "duration_sec": 1200
    }
    """
    t0 = time.time()

    modules = data.get("modules_data", {})
    green_view_data = modules.get("green_view", {})
    scene_data = modules.get("scene", {})
    sound_data = modules.get("soundscape", {})
    gps_data = modules.get("gps", {})
    health_data = modules.get("health", {})

    park_name = data.get("park_name", "公园")
    duration_sec = data.get("duration_sec", 0)
    duration_str = _format_duration(duration_sec)
    duration_min = duration_sec // 60

    # 提取关键指标
    gvr = green_view_data.get("green_view_rate", 0)
    aesthetic = green_view_data.get("aesthetic_score", 0)
    scene_label = scene_data.get("top_label", "自然场景")
    scene_desc = scene_data.get("scene_description", "")
    healing_comment = scene_data.get("healing_comment", "")
    emotion_tag = scene_data.get("emotion_tag", "")
    naturalness = sound_data.get("naturalness_score", 0)
    proportions = sound_data.get("proportions", {})
    points = gps_data.get("smoothed_points", [])
    total_dist = gps_data.get("total_distance_m", 0)
    avg_hr = health_data.get("avg_hr", 0)
    hr_start = health_data.get("hr_start", 0)
    hr_end = health_data.get("hr_end", 0)
    rmssd = health_data.get("rmssd", 0)

    # 疗愈指数
    healing_result = compute_healing_index(modules)
    healing_index = healing_result["healing_index"]

    # 随机主题 & 文案
    theme = random.choice(REPORT_THEMES)
    copy_style_key = random.choice(list(COPY_STYLES.keys()))
    copy_style = COPY_STYLES[copy_style_key]

    # 生成标题
    title_tpl = random.choice(copy_style["title_templates"])
    now = datetime.now()
    title = title_tpl.format(
        park_name=park_name,
        duration_min=duration_min,
        scene_label=scene_label,
        date=now.strftime("%m月%d日"),
    )

    # 生成文案摘要
    summary_tpl = random.choice(copy_style["summary_templates"])
    summary = summary_tpl.format(
        park_name=park_name,
        duration_min=duration_min,
        scene_label=scene_label,
        green_view=gvr,
        soundscape=round(naturalness),
        healing_index=healing_index,
        distance_m=int(total_dist),
        avg_hr=round(avg_hr) if avg_hr else "--",
        hr_start=hr_start if hr_start else "--",
        hr_end=hr_end if hr_end else "--",
        date=now.strftime("%Y年%m月%d日"),
    )
    achievement_label = copy_style["achievement_label"]

    # 图表生成
    pie_svg = _pie_svg(proportions, size=120) if proportions else ""
    pie_legend = _pie_legend_html(proportions, theme) if proportions else ""
    track_svg = _track_svg(points, theme) if len(points) >= 2 else ""
    healing_ring = _score_ring_svg(healing_index, _score_color(healing_index), size=100)
    gvr_ring = _score_ring_svg(int(gvr), theme["primary"], size=72)
    sound_ring = _score_ring_svg(int(naturalness), "#4895EF", size=72)
    aesthetic_ring = _score_ring_svg(aesthetic, "#C77DFF", size=72)

    # 用户图片（base64 内嵌）
    user_image_html = ""
    user_image = data.get("user_image", "")
    if user_image and user_image.startswith("data:image"):
        user_image_html = (
            f'<div class="user-photo">'
            f'<img src="{user_image}" alt="采集照片" '
            f'style="width:100%;border-radius:12px;object-fit:cover;max-height:200px;"/>'
            f'</div>'
        )

    # HR 区块
    if avg_hr:
        hr_html = f"""
        <div class="metric-row">
          <div class="metric-item">
            <div class="metric-value" style="color:{theme['primary']};">{round(avg_hr)}</div>
            <div class="metric-label">平均心率 bpm</div>
          </div>
          {'<div class="metric-item"><div class="metric-value" style="color:#E63946;">'+str(hr_start)+'</div><div class="metric-label">起始心率</div></div>' if hr_start else ''}
          {'<div class="metric-item"><div class="metric-value" style="color:#52B788;">'+str(hr_end)+'</div><div class="metric-label">结束心率</div></div>' if hr_end else ''}
          {'<div class="metric-item"><div class="metric-value" style="color:#4895EF;">'+str(rmssd)+'</div><div class="metric-label">RMSSD ms</div></div>' if rmssd else ''}
        </div>
        """
    else:
        hr_html = '<p style="color:#999;font-size:13px;text-align:center;">暂无心率数据（可连接 Apple Watch 获取）</p>'

    # 声景部分
    if pie_svg:
        sound_html = f"""
        <div style="display:flex;align-items:center;gap:20px;">
          <div>{pie_svg}</div>
          <div style="flex:1;">{pie_legend}</div>
        </div>
        """
    else:
        sound_html = '<p style="color:#999;font-size:13px;">暂无声景数据</p>'

    # 轨迹部分
    track_html = track_svg if track_svg else '<p style="color:#999;font-size:13px;text-align:center;">暂无轨迹数据</p>'

    # ── 随机装饰元素（叶子 / 花朵 SVG）
    deco_elements = _random_decorations(theme)

    date_str = now.strftime("%Y年%m月%d日 %H:%M")

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>{title} · Park20</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: {theme['font_style']};
    background: {theme['bg_gradient']};
    min-height: 100vh;
    padding: 20px 16px 40px;
    color: {theme['text_primary']};
  }}
  .report-wrapper {{
    max-width: 420px;
    margin: 0 auto;
    position: relative;
  }}
  .deco-layer {{
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; overflow: hidden; z-index: 0;
  }}
  .report-body {{ position: relative; z-index: 1; }}

  /* ── 卡片通用 */
  .card {{
    background: {theme['card_bg']};
    border-radius: 16px;
    padding: 18px;
    margin-bottom: 14px;
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 16px rgba(0,0,0,0.06);
  }}
  .card-title {{
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: {theme['text_secondary']};
    text-transform: uppercase;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }}

  /* ── 封面 */
  .cover {{
    text-align: center;
    padding: 28px 18px 22px;
    background: {theme['card_bg']};
    border-radius: 20px;
    margin-bottom: 14px;
    backdrop-filter: blur(12px);
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }}
  .cover-tag {{
    display: inline-block;
    background: {theme['badge_bg']};
    color: white;
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 20px;
    margin-bottom: 10px;
    letter-spacing: 0.06em;
  }}
  .cover-title {{
    font-size: 22px;
    font-weight: 700;
    color: {theme['text_primary']};
    line-height: 1.35;
    margin-bottom: 8px;
  }}
  .cover-meta {{
    font-size: 12px;
    color: {theme['text_secondary']};
    opacity: 0.8;
    line-height: 1.8;
  }}

  /* ── 疗愈指数大展示 */
  .healing-main {{
    display: flex;
    align-items: center;
    gap: 16px;
  }}
  .healing-text h2 {{
    font-size: 15px;
    color: {theme['text_secondary']};
    margin-bottom: 4px;
  }}
  .healing-text p {{
    font-size: 13px;
    color: {theme['text_secondary']};
    opacity: 0.8;
    line-height: 1.6;
  }}

  /* ── 基础数据 */
  .metric-row {{
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }}
  .metric-item {{
    flex: 1;
    min-width: 60px;
    text-align: center;
    padding: 10px 6px;
    background: {theme['accent']};
    border-radius: 10px;
    opacity: 0.9;
  }}
  .metric-value {{
    font-size: 20px;
    font-weight: 700;
    line-height: 1.2;
  }}
  .metric-label {{
    font-size: 10px;
    color: {theme['text_secondary']};
    margin-top: 2px;
    opacity: 0.8;
  }}

  /* ── 三环图 */
  .rings-row {{
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 4px 0;
  }}
  .ring-item {{ text-align: center; }}
  .ring-label {{
    font-size: 11px;
    color: {theme['text_secondary']};
    margin-top: 4px;
    opacity: 0.8;
  }}

  /* ── 场景描述 */
  .scene-badge {{
    display: inline-block;
    background: {theme['accent']};
    color: {theme['primary']};
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 20px;
    margin-bottom: 8px;
    font-weight: 600;
  }}
  .scene-desc {{
    font-size: 14px;
    line-height: 1.8;
    color: {theme['text_primary']};
    margin-bottom: 10px;
  }}
  .healing-quote {{
    font-size: 13px;
    line-height: 1.7;
    color: {theme['text_secondary']};
    font-style: italic;
    border-left: 3px solid {theme['primary']};
    padding-left: 12px;
    opacity: 0.9;
  }}

  /* ── 总结 */
  .summary-text {{
    font-size: 14px;
    line-height: 1.9;
    color: {theme['text_primary']};
  }}
  .achievement {{
    margin-top: 14px;
    padding: 10px 14px;
    background: {theme['badge_bg']};
    border-radius: 10px;
    color: white;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
  }}

  /* ── 底部 */
  .footer {{
    text-align: center;
    font-size: 11px;
    color: {theme['text_secondary']};
    opacity: 0.6;
    margin-top: 8px;
    letter-spacing: 0.04em;
  }}
</style>
</head>
<body>
<div class="report-wrapper">
  <!-- 随机装饰层 -->
  <div class="deco-layer">{deco_elements}</div>

  <div class="report-body">

    <!-- ① 封面 -->
    <div class="cover">
      <div class="cover-tag">Park20 · 疗愈体验报告</div>
      {user_image_html}
      <div class="cover-title">{title}</div>
      <div class="cover-meta">
        {park_name} &nbsp;·&nbsp; {date_str}<br/>
        时长 {duration_str} &nbsp;·&nbsp; 行走 {int(total_dist)}m
      </div>
    </div>

    <!-- ② 疗愈指数总览 -->
    <div class="card">
      <div class="card-title">🌿 综合疗愈指数</div>
      <div class="healing-main">
        {healing_ring}
        <div class="healing-text">
          <h2>{healing_result['level']} · {healing_index}/100</h2>
          <p>{healing_result['level_desc']}</p>
          {'<p style="margin-top:6px;font-size:12px;color:#999;">（无心率数据，基于环境指标计算）</p>' if not healing_result['has_health_data'] else ''}
        </div>
      </div>
    </div>

    <!-- ③ 基础数据卡 -->
    <div class="card">
      <div class="card-title">📊 本次采集数据</div>
      <div class="metric-row" style="margin-bottom:12px;">
        <div class="metric-item">
          <div class="metric-value" style="color:{theme['primary']};">{duration_min}</div>
          <div class="metric-label">采集时长 min</div>
        </div>
        <div class="metric-item">
          <div class="metric-value" style="color:{theme['primary']};">{int(total_dist)}</div>
          <div class="metric-label">行走距离 m</div>
        </div>
        <div class="metric-item">
          <div class="metric-value" style="color:{theme['primary']};">{int(gvr)}</div>
          <div class="metric-label">绿视率 %</div>
        </div>
        <div class="metric-item">
          <div class="metric-value" style="color:{theme['primary']};">{int(naturalness)}</div>
          <div class="metric-label">声景自然度</div>
        </div>
      </div>
      {hr_html}
    </div>

    <!-- ④ 视觉体验 -->
    <div class="card">
      <div class="card-title">👁️ 视觉体验</div>
      <div class="rings-row" style="margin-bottom:14px;">
        <div class="ring-item">
          {gvr_ring}
          <div class="ring-label">绿视率%</div>
        </div>
        <div class="ring-item">
          {aesthetic_ring}
          <div class="ring-label">美学评分</div>
        </div>
      </div>
      <div class="scene-badge">{scene_label} · {emotion_tag}</div>
      <div class="scene-desc">{scene_desc}</div>
      <div class="healing-quote">{healing_comment}</div>
    </div>

    <!-- ⑤ 声景分析 -->
    <div class="card">
      <div class="card-title">🎵 声景分析</div>
      <div class="rings-row" style="margin-bottom:12px;">
        <div class="ring-item">
          {sound_ring}
          <div class="ring-label">自然度评分</div>
        </div>
        <div style="flex:1;">{sound_html}</div>
      </div>
    </div>

    <!-- ⑥ 轨迹地图 -->
    <div class="card">
      <div class="card-title">🗺️ 活动轨迹</div>
      <div style="border-radius:8px;overflow:hidden;">{track_html}</div>
      {'<p style="font-size:11px;color:#999;margin-top:6px;text-align:right;">🟢 起点 &nbsp; 🔴 终点</p>' if len(points) >= 2 else ''}
    </div>

    <!-- ⑦ 生理数据 -->
    <div class="card">
      <div class="card-title">❤️ 生理数据</div>
      {hr_html}
    </div>

    <!-- ⑧ AI 疗愈总结 -->
    <div class="card">
      <div class="card-title">{theme['decoration']} 今日疗愈总结</div>
      <div class="summary-text">{summary}</div>
      <div class="achievement">{achievement_label}</div>
    </div>

    <!-- 底部 -->
    <div class="footer">
      Park20 · 城市公园疗愈体验量化 · {now.strftime('%Y')}
    </div>

  </div><!-- /report-body -->
</div><!-- /report-wrapper -->
</body>
</html>"""

    return html


# ══════════════════════════════════════════════════════════════════════════════
#  随机装饰元素（SVG 叶子 / 小花）
# ══════════════════════════════════════════════════════════════════════════════

def _random_decorations(theme: dict) -> str:
    """生成随机分布的 SVG 装饰叶子 / 圆点"""
    elements = []
    color = theme["accent"]
    primary = theme["primary"]
    random.seed(int(time.time() * 1000) % 9999)

    # 散落圆点
    for _ in range(8):
        x = random.randint(5, 95)
        y = random.randint(2, 98)
        r = random.randint(3, 8)
        op = round(random.uniform(0.08, 0.18), 2)
        c = primary if random.random() > 0.5 else color
        elements.append(
            f'<circle cx="{x}%" cy="{y}%" r="{r}" fill="{c}" opacity="{op}"/>'
        )

    # 几片叶子形状（用椭圆旋转模拟）
    for _ in range(4):
        x = random.randint(5, 95)
        y = random.randint(5, 95)
        angle = random.randint(0, 360)
        op = round(random.uniform(0.08, 0.15), 2)
        elements.append(
            f'<ellipse cx="{x}%" cy="{y}%" rx="12" ry="6" '
            f'fill="{primary}" opacity="{op}" '
            f'transform="rotate({angle},{x}% {y}%)"/>'
        )

    return (
        '<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" '
        'style="position:absolute;top:0;left:0;">'
        + "".join(elements)
        + "</svg>"
    )


# ══════════════════════════════════════════════════════════════════════════════
#  报告 ID 生成
# ══════════════════════════════════════════════════════════════════════════════

def _generate_report_id(data: dict) -> str:
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False) + str(time.time())
    return hashlib.md5(raw.encode()).hexdigest()[:12]


# ══════════════════════════════════════════════════════════════════════════════
#  Flask Blueprint
# ══════════════════════════════════════════════════════════════════════════════

report_bp = Blueprint("report", __name__)


@report_bp.route("/api/report/generate", methods=["POST"])
def api_generate_report():
    """
    生成疗愈体验报告

    请求（application/json）：
    {
      "record_id": "xxx",           // 可选，关联采集记录
      "park_name": "世纪公园",      // 公园名称
      "duration_sec": 1200,         // 采集时长（秒）
      "user_image": "data:...",     // 可选，base64 图片
      "modules_data": {
        "green_view": {
          "green_view_rate": 68.5,
          "aesthetic_score": 85     // 可选（来自场景识别模块）
        },
        "scene": {
          "top_label": "林荫道",
          "scene_description": "...",
          "healing_comment": "...",
          "emotion_tag": "清凉静谧"
        },
        "soundscape": {
          "proportions": { "鸟鸣": 0.35, "水声": 0.15, ... },
          "naturalness_score": 72
        },
        "gps": {
          "smoothed_points": [{"lat":31.22,"lon":121.55},...],
          "total_distance_m": 850
        },
        "health": {
          "avg_hr": 78,
          "hr_start": 88,
          "hr_end": 72,
          "rmssd": 45
        }
      }
    }

    成功返回（HTTP 200）：
    {
      "status": "ok",
      "report_id": "abc123def456",
      "report_html": "<!DOCTYPE html>...",
      "healing_index": 82,
      "report_url": "/api/report/abc123def456",
      "generated_at": "2026-06-13 14:30:00",
      "elapsed_sec": 0.08
    }
    """
    t0 = time.time()
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "请求体为空或不是合法 JSON"}), 400

    # 基础校验
    if "modules_data" not in body:
        return jsonify({"error": "缺少 modules_data 字段"}), 400

    try:
        # 生成 HTML 报告
        html = generate_report_html(body)

        # 疗愈指数
        healing_result = compute_healing_index(body.get("modules_data", {}))

        # 存储报告
        report_id = _generate_report_id(body)
        _REPORT_STORE[report_id] = {
            "html": html,
            "data": body,
            "healing_index": healing_result["healing_index"],
            "created_at": datetime.now().isoformat(),
        }

        elapsed = round(time.time() - t0, 3)

        return jsonify({
            "status": "ok",
            "report_id": report_id,
            "report_html": html,
            "healing_index": healing_result["healing_index"],
            "healing_level": healing_result["level"],
            "report_url": f"/api/report/{report_id}",
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "elapsed_sec": elapsed,
            "within_10s": elapsed < 10.0,
        })

    except Exception as e:
        return jsonify({
            "error": f"报告生成失败：{str(e)}",
            "trace": traceback.format_exc()
        }), 500


@report_bp.route("/api/report/<report_id>", methods=["GET"])
def api_get_report(report_id: str):
    """
    获取已生成的报告 HTML

    返回：
    {
      "status": "ok",
      "report_id": "abc123",
      "report_html": "...",
      "healing_index": 82,
      "created_at": "2026-06-13 14:30:00"
    }
    """
    record = _REPORT_STORE.get(report_id)
    if not record:
        return jsonify({"error": f"报告 {report_id} 不存在或已过期"}), 404
    return jsonify({
        "status": "ok",
        "report_id": report_id,
        "report_html": record["html"],
        "healing_index": record["healing_index"],
        "created_at": record["created_at"],
    })


@report_bp.route("/api/report/preview/<report_id>", methods=["GET"])
def api_preview_report(report_id: str):
    """直接返回 HTML 供浏览器预览（Content-Type: text/html）"""
    from flask import Response
    record = _REPORT_STORE.get(report_id)
    if not record:
        return "<h1>报告不存在</h1>", 404
    return Response(record["html"], content_type="text/html; charset=utf-8")


@report_bp.route("/api/report/mock", methods=["GET"])
def api_mock_report():
    """
    生成一份含有模拟数据的演示报告（方便前端开发调试，无需真实采集数据）

    返回结构与 /api/report/generate 相同
    """
    mock_data = {
        "park_name": random.choice(["世纪公园", "共青森林公园", "中山公园", "鲁迅公园"]),
        "duration_sec": random.randint(900, 2400),
        "user_image": "",
        "modules_data": {
            "green_view": {
                "green_view_rate": round(random.uniform(40, 80), 1),
                "aesthetic_score": random.randint(60, 92),
            },
            "scene": {
                "top_label": random.choice(["林荫道", "阳光草坪", "静谧湖畔", "花海"]),
                "scene_description": random.choice([
                    "浓密的树冠交织成绿色拱廊，阳光透过叶隙洒下斑驳光影",
                    "开阔的草坪在阳光下泛着翠绿，天空与绿地相接，视野无限延伸",
                    "湖面如镜，倒映着岸边的绿树与天空，时光在此刻变得格外温柔",
                ]),
                "healing_comment": random.choice([
                    "漫步其中，仿佛置身天然氧吧，身心都得到了深度滋养",
                    "开阔的视野帮助眼部肌肉彻底放松，让思绪也随之飞翔",
                    "望着平静的水面，焦躁的思绪不知不觉沉淀下来",
                ]),
                "emotion_tag": random.choice(["清凉静谧", "开阔明朗", "宁静致远", "浪漫愉悦"]),
            },
            "soundscape": {
                "proportions": {
                    "鸟鸣": round(random.uniform(0.15, 0.45), 3),
                    "水声": round(random.uniform(0.05, 0.20), 3),
                    "风声": round(random.uniform(0.05, 0.20), 3),
                    "车声": round(random.uniform(0.02, 0.15), 3),
                    "人声": round(random.uniform(0.05, 0.20), 3),
                    "其他": 0.05,
                },
                "naturalness_score": round(random.uniform(45, 85), 1),
            },
            "gps": {
                "smoothed_points": [
                    {"lat": 31.2206 + i * 0.0003 + random.uniform(-0.0001, 0.0001),
                     "lon": 121.5512 + i * 0.0002 + random.uniform(-0.0001, 0.0001)}
                    for i in range(20)
                ],
                "total_distance_m": round(random.uniform(600, 1500), 1),
            },
            "health": {
                "avg_hr": round(random.uniform(70, 90), 1),
                "hr_start": random.randint(82, 95),
                "hr_end": random.randint(68, 80),
                "rmssd": round(random.uniform(30, 65), 1),
            },
        },
    }
    # 复用生成接口逻辑
    try:
        html = generate_report_html(mock_data)
        healing_result = compute_healing_index(mock_data["modules_data"])
        report_id = _generate_report_id(mock_data)
        _REPORT_STORE[report_id] = {
            "html": html,
            "data": mock_data,
            "healing_index": healing_result["healing_index"],
            "created_at": datetime.now().isoformat(),
        }
        return jsonify({
            "status": "ok",
            "report_id": report_id,
            "report_html": html,
            "healing_index": healing_result["healing_index"],
            "healing_level": healing_result["level"],
            "report_url": f"/api/report/{report_id}",
            "preview_url": f"/api/report/preview/{report_id}",
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "note": "此为模拟演示数据，仅供前端调试使用",
        })
    except Exception as e:
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500


# ══════════════════════════════════════════════════════════════════════════════
#  独立运行（调试用）
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(report_bp)
    print("=" * 60)
    print("  Park20 报告生成模块 — 独立调试模式")
    print("  POST /api/report/generate   生成报告")
    print("  GET  /api/report/mock       获取演示报告")
    print("  GET  /api/report/<id>       查询报告")
    print("  GET  /api/report/preview/<id>  浏览器预览")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5052, debug=True)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
樱花动漫 (YHDM) 自动化新番获取与数据合并脚本 v2
================================================
1. 多域名 Fallback 防失效：自动切换镜像站，任何一条线存活即可同步数据。
2. 增强标题匹配：处理中阿数字互转、年份后缀、季数变体等常见差异。
3. 增量更新：本地 data/detail/ 全量扫描，补全缺失/陈旧的 yhdm_line1 线路。
"""

import os
import sys
import json
import time
import re
import urllib.parse
import requests
import urllib3
from concurrent.futures import ThreadPoolExecutor, as_completed

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DETAIL_DIR = os.path.join(DATA_DIR, "detail")
SEARCH_INDEX_PATH = os.path.join(DATA_DIR, "search_index.json")

# 💡 多域名 Fallback 列表（按优先级排序，任意一个成功即可）
# yhdm6.top 为互联网搜索新发现的同构镜像站，内容与 yhdm666.top 相同但 ID 独立
YHDM_DOMAINS = [
    "https://www.yhdm666.top",
    "https://yhdm6.top",       # ✅ 新发现：与 yhdm666.top 完全同构，可用
    "https://www.yhdm.pro",
    "https://www.yhdm10.com",
    "https://yhdm.us",
    "https://www.yhdmla.com",
]

# 当前生效的域名
ACTIVE_DOMAIN = None

headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

session = requests.Session()
session.verify = False
session.headers.update(headers)


# ==========================================================================
# 📝 标题清洗与标准化工具
# ==========================================================================

# 繁体→简体：覆盖动漫常用字
TRAD_TO_SIMP = {
    '戰': '战', '鬥': '斗', '無': '无', '敵': '敌', '傳': '传', '說': '说', '記': '记',
    '錄': '录', '動': '动', '漫': '漫', '畫': '画', '術': '术', '劍': '剑', '魔': '魔',
    '雙': '双', '城': '城', '強': '强', '屬': '属', '點': '点', '覺': '觉', '醒': '醒',
    '棄': '弃', '拋': '抛', '樂': '乐', '獄': '狱', '開': '开', '線': '线', '風': '风',
    '時': '时', '來': '来', '樣': '样', '國': '国', '學': '学', '際': '际', '電': '电',
    '愛': '爱', '歡': '欢', '長': '长', '張': '张', '陽': '阳', '問': '问', '與': '与',
    '為': '为', '對': '对', '們': '们', '後': '后', '還': '还', '進': '进', '個': '个',
    '過': '过', '種': '种', '發': '发', '將': '将', '這': '这', '實': '实', '從': '从',
    '頭': '头', '龍': '龙', '鳳': '凤', '鬼': '鬼', '靈': '灵', '顯': '显', '讓': '让',
    '裡': '里', '聽': '听', '隻': '只', '夢': '梦', '憶': '忆', '歷': '历', '練': '练',
    '絕': '绝', '繼': '继', '續': '续', '純': '纯', '觀': '观', '蘭': '兰', '迴': '回',
    '鑰': '钥', '輕': '轻', '選': '选', '緣': '缘', '陸': '陆', '預': '预', '結': '结',
    '駕': '驾', '葉': '叶', '勢': '势', '勿': '勿', '關': '关', '數': '数', '萬': '万',
}

# 中文数字 → 阿拉伯数字（用于 "第二季" → "2"）
ZH_NUM = {'一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10'}


def convert_trad_to_simp(text):
    for k, v in TRAD_TO_SIMP.items():
        text = text.replace(k, v)
    return text


def normalize_numbers(text):
    """将中文数字替换为阿拉伯数字，统一比较标准"""
    for zh, ar in ZH_NUM.items():
        text = text.replace(zh, ar)
    return text


def clean_title(title):
    """标准化清洗：繁→简、数字统一、去符号、转小写"""
    if not title:
        return ""
    t = convert_trad_to_simp(str(title))
    t = normalize_numbers(t)
    t = t.lower()
    # 季数规范化
    t = re.sub(r'\[?第?(\d)季\]?', r'\1', t)
    t = re.sub(r'后篇|后半部|前半部|完整版|特别版|剧场版tv', '', t)
    # 去除括号注释内容
    t = re.sub(r'[\(\[\{（【].*?[\)\]\}）】]', '', t)
    # 只保留字母数字和中文
    t = "".join(ch for ch in t if ch.isalnum() or '\u4e00' <= ch <= '\u9fa5')
    return t.strip()


def get_title_variants(title):
    """
    生成多个标题变体用于模糊搜索：
    返回按优先级排序的搜索词列表，避免重复
    """
    if not title:
        return []

    variants = []
    seen = set()

    def add(t):
        t = t.strip()
        if t and t not in seen:
            seen.add(t)
            variants.append(t)

    # 1. 原始标题
    add(title)

    # 2. 去掉括号内容
    no_paren = re.sub(r'[\(\[\{（【].*?[\)\]\}）】]', '', title).strip()
    add(no_paren)

    # 3. 提取第一个冒号/横杠前的主标题
    main = re.split(r'[：:\-—]', no_paren or title)[0]
    add(main)

    # 4. 只取前5个中文字符
    cn_chars = re.sub(r'[^\u4e00-\u9fa5]', '', title)
    if len(cn_chars) >= 3:
        add(cn_chars[:5])

    return variants


# ==========================================================================
# 🌐 多域名请求器
# ==========================================================================

def detect_active_domain():
    """探测当前可用的樱花动漫域名"""
    global ACTIVE_DOMAIN
    for domain in YHDM_DOMAINS:
        try:
            r = session.get(domain, timeout=8)
            if r.status_code == 200 and ('yhdm' in r.text.lower() or '樱花' in r.text or 'anime' in r.text.lower()):
                ACTIVE_DOMAIN = domain
                print(f"[YHDM DOMAIN] Active domain: {domain}")
                return domain
        except Exception as e:
            print(f"[YHDM DOMAIN] {domain} unreachable: {e}")
    print("[YHDM DOMAIN] All domains failed!")
    return None


def yhdm_get(path, timeout=10):
    """用当前可用域名发起 GET 请求，失败时自动轮换域名"""
    global ACTIVE_DOMAIN
    domains_to_try = [ACTIVE_DOMAIN] + [d for d in YHDM_DOMAINS if d != ACTIVE_DOMAIN]
    for domain in domains_to_try:
        if not domain:
            continue
        url = domain + path
        try:
            r = session.get(url, timeout=timeout, headers={'Referer': domain + '/'})
            if r.status_code == 200:
                if ACTIVE_DOMAIN != domain:
                    ACTIVE_DOMAIN = domain
                    print(f"[YHDM DOMAIN] Switched to {domain}")
                return r.text
        except Exception:
            continue
    return None


# ==========================================================================
# 🔍 搜索与集数解析
# ==========================================================================

def parse_anime_list_html(html):
    """解析搜索或列表页中的动漫卡片"""
    items = []
    # 匹配 href="/v/123.html" title="动漫名字"
    for pattern in [
        r'href="(?P<href>/v/[0-9]+\.html)".*?title="(?P<title>[^"]+)"',
        r'title="(?P<title>[^"]+)".*?href="(?P<href>/v/[0-9]+\.html)"',
    ]:
        for m in re.finditer(pattern, html, re.DOTALL):
            href = m.group("href")
            title = m.group("title").strip()
            items.append({
                "title": title,
                "href": href,
                "slug": href.split("/")[-1].replace(".html", "")
            })
        if items:
            break

    # 去重
    seen = set()
    unique = []
    for item in items:
        if item['slug'] not in seen:
            seen.add(item['slug'])
            unique.append(item)
    return unique


def search_yhdm(keyword):
    """搜索樱花动漫，返回结果列表"""
    encoded = urllib.parse.quote(keyword)
    html = yhdm_get(f"/vsh/-------------.html?wd={encoded}")
    if html:
        return parse_anime_list_html(html)
    return []


def fetch_yhdm_episodes(slug):
    """
    访问樱花动漫详情页，解析播放地址（完整 URL 列表）
    返回格式: [ ["第01集", "https://www.yhdm6.top/p/12341-5-1.html"], ... ]
    注意：存储完整 URL 而非相对路径，以便 CF Worker 路由到正确的镜像站
    """
    html = yhdm_get(f"/v/{slug}.html", timeout=12)
    if not html:
        return []

    # 按播放列表分段，取集数最多的一段
    playlist_parts = html.split('<div class="content play_list_box')
    if len(playlist_parts) <= 1:
        playlist_parts = html.split('<ul class="content_playlist')

    best_playlist = []
    for part in playlist_parts[1:]:
        eps = []
        for m in re.finditer(r'href="(?P<href>/p/[^"]+)"[^>]*>(?P<name>[^<]+)</a>', part):
            name = m.group("name").strip()
            href = m.group("href").strip()
            # 过滤掉无关链接（广告、导航等）
            if (len(name) < 15 and
                    ("集" in name or "话" in name or "OVA" in name.upper() or
                     "SP" in name.upper() or "剧场" in name or "正片" in name or
                     "BD" in name.upper() or "HD" in name.upper() or
                     "中字" in name or "国语" in name or "完整" in name or
                     name.isdigit())):
                # 💡 存储完整 URL，不用相对路径，避免 CF Worker 跨域名解析失败
                full_url = ACTIVE_DOMAIN + href
                eps.append([name, full_url])
        if len(eps) > len(best_playlist):
            best_playlist = eps

    return best_playlist



# ==========================================================================
# 🔗 单部番剧同步任务
# ==========================================================================

def find_best_match(local_title, search_results):
    """从搜索结果中找最佳匹配项，返回 slug 或 None"""
    if not search_results:
        return None

    clean_local = clean_title(local_title)

    # 精确匹配 > 包含匹配
    exact = [r for r in search_results if clean_title(r['title']) == clean_local]
    if exact:
        return exact[0]['slug']

    # 双向包含匹配
    for r in search_results:
        cr = clean_title(r['title'])
        if len(clean_local) >= 3 and len(cr) >= 3:
            if clean_local in cr or cr in clean_local:
                return r['slug']

    return None


def sync_anime_task(aid, title, force=False):
    """
    处理单部番剧的樱花同步任务
    force=True: 即使已有 yhdm_line1 也强制重新匹配（用于修复集数不足的情况）
    """
    detail_path = os.path.join(DETAIL_DIR, f"{aid}.json")
    if not os.path.exists(detail_path):
        return False

    try:
        with open(detail_path, 'r', encoding='utf-8') as fr:
            detail = json.load(fr)

        video = detail.get("video", {})
        playlists = video.get("playlists", {})
        status = video.get("status", "")

        # 🛡️ [PV GUARD] 未播放番剧禁止写入樱花直链，防止旧季集数混入
        if '未播放' in status:
            return False

        # 已有樱花且是完结番 → 跳过（集数不会再变化）
        if not force and "yhdm_line1" in playlists and len(playlists["yhdm_line1"]) > 0:
            if "完结" in status or "全集" in status:
                return False

        # 尝试多个标题变体进行搜索
        matched_eps = None
        for variant in get_title_variants(title):
            results = search_yhdm(variant)
            if not results:
                continue
            slug = find_best_match(title, results)
            if slug:
                eps = fetch_yhdm_episodes(slug)
                if eps:
                    matched_eps = eps
                    break

        if matched_eps:
            # 如果已有樱花且新结果集数更少，跳过（防止降级）
            existing = playlists.get("yhdm_line1", [])
            if not force and len(existing) > 0 and len(matched_eps) < len(existing):
                return False

            playlists["yhdm_line1"] = matched_eps
            video["playlists"] = playlists
            detail["video"] = video

            labels = detail.get("player_label_arr", {})
            labels["yhdm_line1"] = "樱花直链"
            detail["player_label_arr"] = labels

            with open(detail_path, 'w', encoding='utf-8') as fw:
                json.dump(detail, fw, ensure_ascii=False, indent=2)

            print(f"  ✅ [YHDM] '{title}' (AID:{aid}) → 樱花 {len(matched_eps)} 集")
            return True
        else:
            return False

    except Exception as e:
        print(f"  [WARN] sync_anime_task failed '{title}' (AID:{aid}): {e}")
    return False


# ==========================================================================
# 🚀 主入口
# ==========================================================================

def main():
    print("=" * 60)
    print("🌸 [START] YHDM Sakura Anime Scraper & Merge v2")
    print("=" * 60)

    # 1. 探测可用域名
    domain = detect_active_domain()
    if not domain:
        print("[CRITICAL] All YHDM domains are unreachable. Abort.")
        return

    # 2. 判断是否强制模式（命令行 --force 参数）
    force_mode = '--force' in sys.argv
    if force_mode:
        print("[MODE] Force mode enabled: will re-fetch all anime including already-matched ones.")

    # 3. 构建同步队列
    if not os.path.exists(SEARCH_INDEX_PATH):
        print("[ERROR] search_index.json not found! Run update_data.py first.")
        return

    with open(SEARCH_INDEX_PATH, 'r', encoding='utf-8') as f:
        search_index = json.load(f)

    sync_queue = []
    for item in search_index:
        aid = str(item.get("AID", ""))
        title = item.get("Title", "")
        if aid and title:
            sync_queue.append((aid, title))

    print(f"[INFO] Sync queue: {len(sync_queue)} anime")

    # 4. 多线程并发同步（8 线程）
    success_count = 0
    fail_count = 0
    skip_count = 0

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {
            executor.submit(sync_anime_task, aid, title, force_mode): (aid, title)
            for aid, title in sync_queue
        }
        for fut in as_completed(futures):
            result = fut.result()
            if result is True:
                success_count += 1
            elif result is False:
                # False = skipped or no match found
                fail_count += 1

    print("=" * 60)
    print(f"🏁 [DONE] 成功合并: {success_count} | 跳过/未匹配: {fail_count} | 总计: {len(sync_queue)}")
    print("=" * 60)


if __name__ == "__main__":
    main()

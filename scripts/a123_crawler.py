#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A123TV 自动化新番获取与数据合并脚本 (极致轻量按需版 + 空番自动搜索回填)
===================================================================
1. 编译期仅提取选集结构和页面路径，不爬取任何单集直链，播放时由前端动态嗅探。
2. 增量热更新：抓取 A123TV 的国漫和日漫最新列表 (前 3 页) 进行对齐合并，
   对未匹配的独占番，在本地新建 a123_ 前缀详情文件，丰富片源。
3. 🌿 黄金拯救逻辑 (Empty Anime Auto-Resolver)：
   自动扫描本地所有无播放源或空线路、甚至仅有预告/PV的“伪有源”空壳番剧，
   并在 A123TV 上进行标题搜索并回填结构，如果全名搜索失败，自动使用“中文主标题”二次拯救匹配！
"""

import os
import sys
import json
import time
import re
import urllib.parse
import requests
import urllib3

# 禁用 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DETAIL_DIR = os.path.join(DATA_DIR, "detail")
SEARCH_INDEX_PATH = os.path.join(DATA_DIR, "search_index.json")

os.makedirs(DETAIL_DIR, exist_ok=True)

headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}
session = requests.Session()
session.verify = False
session.headers.update(headers)

def clean_title(title):
    if not title:
        return ""
    trad_simple = {
        '戰': '战', '鬥': '斗', '無': '无', '敵': '敌', '傳': '传', '說': '说', '記': '记',
        '錄': '录', '動': '动', '漫': '漫', '畫': '画', '術': '术', '劍': '剑', '魔': '魔',
        '雙': '双', '城': '城', '強': '强', '屬': '属', '性': '性', '點': '点', '覺': '觉',
        '醒': '醒', '棄': '弃', '家': '家', '族': '族', '拋': '抛', '樂': '乐', '獄': '狱'
    }
    t = str(title)
    for k, v in trad_simple.items():
        t = t.replace(k, v)
    t = t.lower()
    t = re.sub(r'\[?第?一季\]?', '1', t)
    t = re.sub(r'\[?第?二季\]?', '2', t)
    t = re.sub(r'\[?第?三季\]?', '3', t)
    t = re.sub(r'\[?第?四季\]?', '4', t)
    t = re.sub(r'\[?第?五季\]?', '5', t)
    t = re.sub(r'后篇|后半部|前半部', '', t)
    t = "".join(ch for ch in t if ch.isalnum())
    return t

def get_main_title(title):
    """
    提取中文主标题（切除所有英文后缀及修饰词）
    例如：'怪物弹珠 DEADVERSE RELOADED' -> '怪物弹珠'
    """
    if not title:
        return ""
    t = re.sub(r'[\(\[\{（【].*?[\)\]\}）】]', '', title)
    t = re.sub(r'[a-zA-Z\-_：:\s]+.*$', '', t)
    return t.strip() if t.strip() else title

def is_kids_anime(title, plot="", tags=""):
    """判定是否属于给低幼少儿看的动漫"""
    title = (title or "").lower()
    plot = (plot or "").lower()
    tags = (tags or "").lower()
    
    # 1. 规避误伤特权词
    if "问题儿童" in title:
        return False
        
    # 2. 精准分类与标签匹配：分词后做交集校验，规避“问题儿童”、“玩具箱”等词的局部误匹配
    plot_words = set(w.strip() for w in plot.replace("/", " ").split() if w.strip())
    tags_words = set(w.strip() for w in tags.replace("/", " ").split() if w.strip())
    kids_classes = {"儿童", "少儿", "幼儿", "亲子", "早教", "儿歌", "子供向"}
    
    if kids_classes.intersection(plot_words) or kids_classes.intersection(tags_words):
        return True
        
    # 3. 强力标题及特定黑名单（模糊匹配）
    kids_keywords = [
        '乐高', '城市守卫者', '超级警长', '汪汪队', '小猪佩奇', '熊出没', '喜羊羊', '灰太狼',
        '巴啦啦小魔仙', '超级飞侠', '托马斯', '天线宝宝', '爱探险的朵拉', '儿歌', '早教', '启蒙',
        '巧虎', '猪猪侠', '萌鸡小队', '宝宝巴士', '大头儿子', '贝瓦', '爆笑虫子', 
        '小马宝莉', '快乐酷宝', '舞法天女', '精灵梦叶罗丽', '叶罗丽', '神奇宝贝少儿版',
        '巨神战击队', '火力少年王', '赛尔号', '洛克王国', '奥拉星', '开心超人', '果宝特攻', 
        '神兽金刚', '飓风战魂', '爆裂飞车', '雷速登', '巴啦啦', '开心宝贝', '小鲤鱼历险记', 
        '神兵小将', '蓝猫淘气', '咖宝车神', '大卫，不可以', '皮诺和西诺比', 'ピノ＆シノビー',
        '依娜和恰恰'
    ]
    for kw in kids_keywords:
        if kw in title:
            return True
            
    return False

def parse_anime_list_html(html):
    """从 HTML 文本中解析卡片列表"""
    items = []
    item_matches = re.finditer(
        r'<div class="w4-item-wrap">.*?href="(?P<href>[^"]+)".*?alt="(?P<title>[^"]+)".*?<div class="i">(?P<info>[^<]+)</div>',
        html, re.DOTALL
    )
    for m in item_matches:
        href = m.group("href")
        title = m.group("title").strip()
        info = m.group("info").strip()
        # 💡 强力阻断低幼少儿和敏感词
        if "里番" in info or "淫狱" in title or "催眠" in title or is_kids_anime(title):
            continue
        items.append({
            "title": title,
            "href": href,
            "slug": href.replace("/v/", "").replace(".html", ""),
            "info": info
        })
    return items

def fetch_a123_category_page(cat_id, page):
    url = f"https://a123tv.com/t/{cat_id}.html" if page == 1 else f"https://a123tv.com/t/{cat_id}/p{page}.html"
    try:
        print(f"[A123 LIST] Fetching page: {url}")
        r = session.get(url, timeout=10)
        if r.status_code == 200:
            return parse_anime_list_html(r.text)
    except Exception as e:
        print(f"[ERROR] Failed to fetch list {url}: {e}")
    return []

def search_a123_by_title(title_keyword):
    encoded_wd = urllib.parse.quote(title_keyword)
    url = f"https://a123tv.com/s/{encoded_wd}.html"
    try:
        print(f"  [A123 SEARCH] Querying: {title_keyword} -> {url}")
        r = session.get(url, timeout=10)
        if r.status_code == 200:
            return parse_anime_list_html(r.text)
    except Exception as e:
        print(f"  [ERROR] Search failed for {title_keyword}: {e}")
    return []

def fetch_anime_episodes_structure(anime_slug):
    detail_url = f"https://a123tv.com/v/{anime_slug}.html"
    try:
        r = session.get(detail_url, timeout=10)
        if r.status_code != 200:
            return []
        
        html = r.text
        ep_list_match = re.search(r'<div class="w4-episode-list w4-scroll">(.*?)</div>', html, re.DOTALL)
        if not ep_list_match:
            return []
            
        eps_html = ep_list_match.group(1)
        ep_matches = re.findall(r'<a[^>]*href="(?P<href>[^"]+)"[^>]*title="(?P<title>[^"]+)"[^>]*>(?P<name>[^<]+)</a>', eps_html)
        
        episodes = []
        for href, title, name in ep_matches:
            episodes.append([name.strip(), href])
        return episodes
    except Exception as e:
        print(f"  [ERROR] Failed to fetch episodes structure for {anime_slug}: {e}")
        return []

def load_search_index():
    if os.path.exists(SEARCH_INDEX_PATH):
        try:
            with open(SEARCH_INDEX_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def main():
    print("=" * 60)
    print("🚀 [START] Starting A123TV Smart Scraper & Empty Resolver...")
    print("=" * 60)
    
    # 1. 读取本地已有的搜索索引
    search_index = load_search_index()
    existing_map = {}
    empty_aids = []
    
    for entry in search_index:
        title = entry.get("Title")
        aid = entry.get("AID")
        if is_kids_anime(title):
            continue
        if title and aid:
            cleaned = clean_title(title)
            if cleaned:
                existing_map[cleaned] = entry
                
            # 探测本地详情文件是否为空壳番剧
            detail_path = os.path.join(DETAIL_DIR, f"{aid}.json")
            if os.path.exists(detail_path):
                try:
                    with open(detail_path, 'r', encoding='utf-8') as f:
                        detail = json.load(f)
                        playlists = detail.get("video", {}).get("playlists", {})
                        
                        is_empty = False
                        if not playlists:
                            is_empty = True
                        else:
                            has_valid_ep = False
                            for pkey, eps in playlists.items():
                                if eps and len(eps) > 0:
                                    # 💡 强力排除伪有源番：如果某线路下虽然有数据，但都是预告、PV、特报等，
                                    # 或者全剧只有 1-2 集且标题包含 pv/预告/特报/特报pv/宣传/特报，我们视其为空壳！
                                    if len(eps) <= 2:
                                        all_pv = True
                                        for ep in eps:
                                            ep_name = ep[0].lower()
                                            if not ('pv' in ep_name or '预告' in ep_name or '特报' in ep_name or '宣传' in ep_name):
                                                all_pv = False
                                                break
                                        if all_pv:
                                            continue
                                    has_valid_ep = True
                                    break
                            if not has_valid_ep:
                                is_empty = True
                                
                        if is_empty:
                            empty_aids.append((str(aid), title, detail_path))
                except Exception:
                    pass

    print(f"[INFO] Loaded search index. Detected {len(empty_aids)} empty/PV-only shell animes needing stream rescue.")

    # ──────────────────────────────────────────────
    # 🌟 核心增量拯救环节 (Rescue Empty Shell Animes)
    # ──────────────────────────────────────────────
    if empty_aids:
        print("\n" + "-" * 50)
        print("🌿 [RESCUE] Starting Empty Shell Anime Rescue...")
        print("-" * 50)
        
        # 限制单次运行拯救的空壳番剧最大数（防 API 被封锁）
        rescue_limit = 15
        rescued_count = 0
        
        for aid, title, path in empty_aids:
            if rescued_count >= rescue_limit:
                print(f"[RESCUE] Reached limit of {rescue_limit} rescues. Pausing remaining.")
                break
                
            print(f"  [RESCUING] Searching A123TV for empty anime: '{title}' (AID: {aid})")
            
            # A. 优先全名搜索
            search_results = search_a123_by_title(title)
            time.sleep(0.5)
            
            matched_slug = None
            cleaned_target = clean_title(title)
            
            for res in search_results:
                if clean_title(res["title"]) == cleaned_target:
                    matched_slug = res["slug"]
                    break
                    
            # B. 💡 如果全名没有精确对准，使用 get_main_title 提取出中文主标题进行二次模糊拯救匹配
            if not matched_slug:
                main_title = get_main_title(title)
                if main_title != title:
                    print(f"    [FUZZY RETRY] Exact match failed. Retrying with main title: '{main_title}'")
                    search_results = search_a123_by_title(main_title)
                    time.sleep(0.5)
                    
                    cleaned_main = clean_title(main_title)
                    for res in search_results:
                        if clean_title(res["title"]) == cleaned_main:
                            matched_slug = res["slug"]
                            break
            
            if matched_slug:
                print(f"    [MATCHED] Found A123 source: slug='{matched_slug}'. Fetching structure...")
                episodes = fetch_anime_episodes_structure(matched_slug)
                time.sleep(0.5)
                
                if episodes:
                    try:
                        with open(path, 'r', encoding='utf-8') as f:
                            local_detail = json.load(f)
                            
                        playlists = local_detail.setdefault("video", {}).setdefault("playlists", {})
                        playlists["a123_line1"] = episodes
                        
                        with open(path, 'w', encoding='utf-8') as f:
                            json.dump(local_detail, f, ensure_ascii=False, indent=2)
                            
                        print(f"    [SUCCESS] Rescued shell anime '{title}' with A123 ({len(episodes)} EPs)!")
                        rescued_count += 1
                    except Exception as merge_err:
                        print(f"    [ERROR] Failed to merge rescued data for {title}: {merge_err}")
            else:
                print(f"    [FAILED] No name matched on A123TV for '{title}'")
            
            time.sleep(0.5)

    # ──────────────────────────────────────────────
    # 2. 爬取 A123TV 国漫和日漫前 3 页更新数据 (常规同步 + 独占新建)
    # ──────────────────────────────────────────────
    print("\n" + "-" * 50)
    print("🔄 [SYNC] Synchronizing A123TV latest categories...")
    print("-" * 50)
    
    a123_list = []
    for cat_id in ["1301", "1302"]:
        for page in range(1, 4):
            items = fetch_a123_category_page(cat_id, page)
            a123_list.extend(items)
            time.sleep(0.5)
            
    print(f"\n[INFO] Fetched {len(a123_list)} raw anime cards.")

    for i, anime in enumerate(a123_list):
        title = anime["title"]
        slug = anime["slug"]
        cleaned_title = clean_title(title)
        
        matched_entry = existing_map.get(cleaned_title)
        
        aid = None
        detail_filename = None
        
        if matched_entry:
            aid = str(matched_entry["AID"])
            detail_filename = f"{aid}.json"
            print(f"[{i+1}/{len(a123_list)}] [MATCHED] A123: '{title}' ---> Local AID: {aid}")
        else:
            aid = f"a123_{slug}"
            detail_filename = f"{aid}.json"
            print(f"[{i+1}/{len(a123_list)}] [EXCLUSIVE] A123: '{title}' ---> New entry '{aid}'")

        detail_path = os.path.join(DETAIL_DIR, detail_filename)
        
        local_detail = None
        if os.path.exists(detail_path):
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    local_detail = json.load(f)
            except Exception:
                pass

        playlists = {}
        if local_detail:
            playlists = local_detail.setdefault("video", {}).setdefault("playlists", {})
            
        a123_playlist = playlists.get("a123_line1", [])
        
        # 抓取详情页集数链接大小
        print(f"  [CHECKING] Fetching structure for: {title}")
        episodes = fetch_anime_episodes_structure(slug)
        
        if not episodes:
            continue
            
        if len(a123_playlist) != len(episodes):
            if local_detail:
                playlists["a123_line1"] = episodes
                print(f"  [UPDATED] Merged 'a123_line1' ({len(episodes)} EPs) into {detail_filename}")
            else:
                # 新建独占番详情 JSON
                local_detail = {
                    "video": {
                        "id": aid,
                        "name": title,
                        "cover": f"https://i1.a123tv.com/v/0x/{slug}.jpg",
                        "pic": "",
                        "plot": "国产动漫" if "1301" in anime["info"] else "日韩动漫",
                        "plot_arr": [],
                        "tags": "",
                        "status": f"更新至{len(episodes)}集",
                        "playlists": {
                            "a123_line1": episodes
                        }
                    },
                    "player_vip": "",
                    "player_jx": {}
                }
                print(f"  [CREATED] Created new exclusive detail JSON structure for {title}")
                
            with open(detail_path, 'w', encoding='utf-8') as f:
                json.dump(local_detail, f, ensure_ascii=False, indent=2)
        else:
            print("  [CACHE HIT] Structure length matches. Skipping detail rewrite.")
            
        time.sleep(0.3)

    print("\n" + "=" * 60)
    print("🎉 [FINISHED] A123TV Alignment and Rescue Tasks Completed!")
    print("=" * 60)

if __name__ == "__main__":
    main()

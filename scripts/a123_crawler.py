#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A123TV 自动化新番获取与数据合并脚本 (极致轻量按需版 + 空番自动搜索回填)
===================================================================
1. 编译期仅提取选集结构和页面路径，不爬取任何单集直链，播放时由前端动态嗅探。
2. 增量热更新：抓取 A123TV 的国漫和日漫最新列表 (前 3 页) 进行对齐合并。
3. 🌿 黄金拯救逻辑 (Empty Anime Auto-Resolver)：
   自动扫描本地所有无播放源或空线路的“空壳番剧”，并在 A123TV 上进行标题搜索，
   若搜索到同名番剧，直接抓取其结构并回填写入 playlists["a123_line1"]，起死回生！
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
        if "里番" in info or "淫狱" in title or "催眠" in title:
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
    """
    通过 A123TV 的搜索 URL 进行标题检索
    URL 格式：https://a123tv.com/s/{wd}.html
    """
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
    empty_aids = [] # 无源/空壳番剧的 (AID, Title, Path) 元组列表
    
    for entry in search_index:
        title = entry.get("Title")
        aid = entry.get("AID")
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
                        
                        # 判定空壳动漫标准：
                        # - playlists 为空
                        # - 或者所有的 playlist 里面集数长度都为 0
                        is_empty = False
                        if not playlists:
                            is_empty = True
                        else:
                            has_valid_ep = False
                            for pkey, eps in playlists.items():
                                if eps and len(eps) > 0:
                                    has_valid_ep = True
                                    break
                            if not has_valid_ep:
                                is_empty = True
                                
                        if is_empty:
                            empty_aids.append((str(aid), title, detail_path))
                except Exception:
                    pass

    print(f"[INFO] Loaded search index. Detected {len(empty_aids)} empty shell animes needing stream rescue.")

    # ──────────────────────────────────────────────
    # 🌟 核心增量拯救环节 (Rescue Empty Shell Animes)
    # ──────────────────────────────────────────────
    if empty_aids:
        print("\n" + "-" * 50)
        print("🌿 [RESCUE] Starting Empty Shell Anime Rescue...")
        print("-" * 50)
        
        # 限制单次运行拯救的空壳番剧最大数（如 15 个，细水长流，防 API 被封锁）
        rescue_limit = 15
        rescued_count = 0
        
        for aid, title, path in empty_aids:
            if rescued_count >= rescue_limit:
                print(f"[RESCUE] Replaced limit of {rescue_limit} rescues. Pausing remaining.")
                break
                
            print(f"  [RESCUING] Searching A123TV for empty anime: '{title}' (AID: {aid})")
            
            # 发起搜索
            search_results = search_a123_by_title(title)
            time.sleep(0.5)
            
            matched_slug = None
            cleaned_target = clean_title(title)
            
            for res in search_results:
                if clean_title(res["title"]) == cleaned_target:
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
                print(f"    [FAILED] No exact name matched on A123TV for '{title}'")
            
            time.sleep(0.5)

    # ──────────────────────────────────────────────
    # 2. 爬取 A123TV 国漫和日漫前 3 页更新数据 (常规同步)
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
            # 独占新番暂时忽略
            continue

        detail_path = os.path.join(DETAIL_DIR, detail_filename)
        
        local_detail = None
        if os.path.exists(detail_path):
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    local_detail = json.load(f)
            except Exception:
                pass

        if not local_detail:
            continue

        playlists = local_detail.setdefault("video", {}).setdefault("playlists", {})
        a123_playlist = playlists.get("a123_line1", [])
        
        # 抓取详情页集数链接大小
        print(f"  [CHECKING] Fetching structure for: {title}")
        episodes = fetch_anime_episodes_structure(slug)
        
        if not episodes:
            continue
            
        if len(a123_playlist) != len(episodes):
            playlists["a123_line1"] = episodes
            print(f"  [UPDATED] Merged 'a123_line1' ({len(episodes)} EPs) into {detail_filename}")
            
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

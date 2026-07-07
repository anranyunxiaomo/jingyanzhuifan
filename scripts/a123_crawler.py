#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A123TV 自动化新番获取与数据合并脚本 (极致轻量按需版)
==================================================
编译期仅提取选集结构和页面路径，不爬取任何单集直链，
彻底消灭 3000 次 HTTP 超时卡死隐患，并在播放时由前端实时跨域嗅探提取。
"""

import os
import sys
import json
import time
import re
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

def fetch_a123_category_page(cat_id, page):
    url = f"https://a123tv.com/t/{cat_id}.html" if page == 1 else f"https://a123tv.com/t/{cat_id}/p{page}.html"
    try:
        print(f"[A123 LIST] Fetching page: {url}")
        r = session.get(url, timeout=10)
        if r.status_code != 200:
            return []
        
        html = r.text
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
    except Exception as e:
        print(f"[ERROR] Failed to fetch list: {e}")
        return []

def fetch_anime_episodes_structure(anime_slug):
    """
    仅抓取动漫详情页的选集链接结构，绝不进入单集播放页 (秒级解析)
    """
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
            # 存入结构：[集数名, 单集相对页面路径]
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
    print("🚀 [START] Starting A123TV Light Scraper (Index Only)...")
    print("=" * 60)
    
    a123_list = []
    # 1301: 国产动漫, 1302: 日韩动漫
    for cat_id in ["1301", "1302"]:
        for page in range(1, 4):
            items = fetch_a123_category_page(cat_id, page)
            a123_list.extend(items)
            time.sleep(0.3)
            
    print(f"\n[INFO] Fetched {len(a123_list)} raw anime cards.")
    
    search_index = load_search_index()
    existing_map = {}
    for entry in search_index:
        title = entry.get("Title")
        aid = entry.get("AID")
        if title and aid:
            cleaned = clean_title(title)
            if cleaned:
                existing_map[cleaned] = entry

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
            # 独占新番，只对齐合并已存在番剧，独占暂不处理
            print(f"[{i+1}/{len(a123_list)}] [SKIPPED] A123: '{title}' (Exclusive, skipping)")
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

        # 检查是否需要更新结构 (集数长度变化时更新)
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
            
            # 写回物理文件
            with open(detail_path, 'w', encoding='utf-8') as f:
                json.dump(local_detail, f, ensure_ascii=False, indent=2)
        else:
            print("  [CACHE HIT] Structure length matches. Skipping detail rewrite.")
            
        time.sleep(0.3)

    print("\n" + "=" * 60)
    print("🎉 [FINISHED] A123TV Light Scraper Task Completed!")
    print("=" * 60)

if __name__ == "__main__":
    main()

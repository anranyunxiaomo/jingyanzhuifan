#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
樱花动漫 (YHDM) 自动化新番获取与数据合并脚本
=========================================
1. 通过搜索和分类抓取樱花动漫的选集结构，存为播放页相对路径（epToken）。
2. 在播放时由前端调用 Cloudflare Worker `/api/sniff` 接口实时并发嗅探直链。
3. 增量更新：读取本地 `data/detail/` 目录中的番剧，到樱花动漫站点搜索并回填 `yhdm_line1` 线路。
"""

import os
import sys
import json
import time
import re
import urllib.parse
import requests
import urllib3
from concurrent.futures import ThreadPoolExecutor

# 禁用 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DETAIL_DIR = os.path.join(DATA_DIR, "detail")
SEARCH_INDEX_PATH = os.path.join(DATA_DIR, "search_index.json")

# 💡 樱花动漫的目标域名（如遭遇封锁，可在此修改为最新的镜像域名）
YHDM_DOMAIN = "https://www.yhdm666.top"

headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': f"{YHDM_DOMAIN}/",
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
    if not title:
        return ""
    t = re.sub(r'[\(\[\{（【].*?[\)\]\}）】]', '', title)
    t = re.sub(r'[a-zA-Z\-_：:\s]+.*$', '', t)
    return t.strip() if t.strip() else title

def parse_anime_list_html(html):
    """
    解析搜索或列表页中的动漫卡片
    返回: list of dict, 每个元素含 title, href, slug
    """
    items = []
    # 匹配 href="/v/123.html" title="动漫名字"
    matches = re.finditer(r'href="(?P<href>/v/[0-9]+\.html)".*?title="(?P<title>[^"]+)"', html, re.DOTALL)
    for m in matches:
        href = m.group("href")
        title = m.group("title").strip()
        items.append({
            "title": title,
            "href": href,
            "slug": href.split("/")[-1].replace(".html", "")
        })
        
    if not items:
        # 兼容 <a title="动漫名字" href="/v/123.html">
        matches = re.finditer(r'title="(?P<title>[^"]+)".*?href="(?P<href>/v/[0-9]+\.html)"', html, re.DOTALL)
        for m in matches:
            href = m.group("href")
            title = m.group("title").strip()
            items.append({
                "title": title,
                "href": href,
                "slug": href.split("/")[-1].replace(".html", "")
            })
            
    # 去重
    seen = set()
    unique_items = []
    for item in items:
        if item['slug'] not in seen:
            seen.add(item['slug'])
            unique_items.append(item)
    return unique_items

def search_yhdm(title):
    """
    对 yhdm666.top 执行搜索
    """
    encoded_title = urllib.parse.quote(title)
    # 使用新发现的搜索 URL 结构
    url = f"{YHDM_DOMAIN}/vsh/-------------.html?wd={encoded_title}"
    try:
        r = session.get(url, timeout=10)
        if r.status_code == 200:
            return parse_anime_list_html(r.text)
    except Exception as e:
        print(f"  [WARN] Search failed for '{title}': {e}")
    return []

def fetch_yhdm_episodes(slug):
    """
    访问樱花动漫详情页，解析出播放地址相对路径列表
    返回格式: [ ["第01集", "/p/123-1-1.html"], ... ]
    """
    detail_url = f"{YHDM_DOMAIN}/v/{slug}.html"
    try:
        r = session.get(detail_url, timeout=10)
        if r.status_code != 200:
            return []
            
        html = r.text
        # 将 HTML 按播放列表拆分，以最大集数线路为准
        playlist_parts = html.split('<div class="content play_list_box')
        if len(playlist_parts) <= 1:
            playlist_parts = html.split('<ul class="content_playlist')
            
        best_playlist = []
        for part in playlist_parts[1:]:
            eps = []
            ep_matches = re.finditer(r'href="(?P<href>/p/[^"]+)"[^>]*>(?P<name>[^<]+)</a>', part)
            for m in ep_matches:
                name = m.group("name").strip()
                href = m.group("href").strip()
                if len(name) < 15 and ("集" in name or "话" in name or "OVA" in name or "SP" in name or "剧场" in name or "正片" in name or "BD" in name.upper() or "HD" in name.upper() or "中字" in name or "国语" in name or "完整" in name or name.isdigit()):
                    eps.append([name, href])
            if len(eps) > len(best_playlist):
                best_playlist = eps
                
        return best_playlist
    except Exception as e:
        print(f"  [ERROR] Failed to fetch episodes for slug {slug}: {e}")
        return []

def sync_anime_task(aid, title):
    """
    处理单部番剧的同步任务
    """
    detail_path = os.path.join(DETAIL_DIR, f"{aid}.json")
    if not os.path.exists(detail_path):
        return False
        
    try:
        with open(detail_path, 'r', encoding='utf-8') as fr:
            detail = json.load(fr)
            
        video = detail.get("video", {})
        playlists = video.get("playlists", {})
        
        # 💡 如果已有 yhdm_line1 且集数正常，跳过以节省请求
        if "yhdm_line1" in playlists and len(playlists["yhdm_line1"]) > 0:
            status = video.get("status", "")
            if "完结" in status or "全集" in status:
                return False
                
        # 💡 开始搜索
        search_results = search_yhdm(title)
        if not search_results:
            main_title = get_main_title(title)
            if main_title != title:
                search_results = search_yhdm(main_title)
                
        if not search_results:
            # 💡 针对长片名/拼写不一致：取前 4 到 6 个中文字符进行模糊搜索
            short_kw = re.sub(r'[^\u4e00-\u9fa5]', '', title)[:6]
            if len(short_kw) >= 3:
                search_results = search_yhdm(short_kw)
                
        if not search_results:
            return False
            
        # 💡 寻找最佳对齐项，并在获取不到剧集时尝试后续候选
        matched_eps = None
        clean_local = clean_title(title)
        
        # 优先排序：精确匹配排最前
        sorted_results = sorted(search_results, key=lambda x: 0 if clean_title(x["title"]) == clean_local else 1)
        
        for item in sorted_results:
            clean_remote = clean_title(item["title"])
            if clean_local == clean_remote or clean_local in clean_remote or clean_remote in clean_local:
                slug = item["slug"]
                eps = fetch_yhdm_episodes(slug)
                if eps:
                    matched_eps = eps
                    break
                    
        if matched_eps:
            playlists["yhdm_line1"] = matched_eps
            video["playlists"] = playlists
            detail["video"] = video
            
            # 更新显示名称标签
            labels = detail.get("player_label_arr", {})
            labels["yhdm_line1"] = "樱花直链"
            detail["player_label_arr"] = labels
            
            # 写回本地 JSON
            with open(detail_path, 'w', encoding='utf-8') as fw:
                json.dump(detail, fw, ensure_ascii=False, indent=2)
            print(f"  ✅ [YHDM MERGED] 成功合并 '{title}' (ID: {aid}) 樱花线路，共 {len(matched_eps)} 集")
            return True
            
    except Exception as e:
        print(f"  [WARN] Failed to sync '{title}' (ID: {aid}) with YHDM: {e}")
    return False

def main():
    print("=" * 60)
    print("🚀 [START] Starting Sakura Anime (YHDM) Scraper & Merge Task...")
    print("=" * 60)
    
    if not os.path.exists(SEARCH_INDEX_PATH):
        print("[ERROR] search_index.json not found! Please run update_data.py first.")
        return
        
    with open(SEARCH_INDEX_PATH, 'r', encoding='utf-8') as f:
        search_index = json.load(f)
        
    # 💡 扫描全部已缓存的 355 部动漫，以获得 100% 的樱花直链线路覆盖
    sync_queue = []
    for item in search_index:
        aid = str(item.get("AID"))
        title = item.get("Title")
        if aid and title:
            sync_queue.append((aid, title))
            
    print(f"[INFO] Prepared {len(sync_queue)} active/ongoing animes to sync YHDM lines.")
    
    # 限制 3 线程并发，防止对樱花动漫站点施加过大压力
    success_count = 0
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(sync_anime_task, aid, title): title for aid, title in sync_queue}
        for fut in futures:
            if fut.result():
                success_count += 1
                
    print("=" * 60)
    print(f"🏁 [FINISHED] YHDM line sync complete. Merged: {success_count}/{len(sync_queue)}")
    print("=" * 60)

if __name__ == "__main__":
    main()

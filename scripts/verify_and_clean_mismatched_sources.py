#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据源校准与自愈净化脚本 (Resource Mismatch Sanitizer)
===================================================
1. 并发请求各详情中 yhdm_line1 第一集的实际播放页面。
2. 比对原站 HTML <title> 中的真实名称与本地动漫名。
3. 发现“货不对板”的复用错乱 ID (如奇幻贵公子播放出喜羊羊) 时，物理清除该失效的 yhdm_line1 播放线路。
4. 重新构建静态索引以自动隐藏空壳数据。
"""

import os
import sys
import json
import time
import re
import requests
import urllib3
from concurrent.futures import ThreadPoolExecutor, as_completed

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = "/Users/anranyunxiaomo/Desktop/project/jyzf"
DATA_DIR = os.path.join(BASE_DIR, "data")
DETAIL_DIR = os.path.join(DATA_DIR, "detail")

YHDM_DOMAINS = [
    "https://www.yhdm666.top",
    "https://yhdm6.top",
    "https://www.yhdm.pro",
    "https://www.yhdm10.com",
    "https://yhdm.us",
    "https://www.yhdmla.com",
]

headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
}

session = requests.Session()
session.verify = False
session.headers.update(headers)

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
    '鑰': '钥', '輕': '轻', '選': '选', '緣': '缘', '陸': '陆', '预': '预', '结': '结',
}

def clean_title(title):
    t = str(title)
    for k, v in TRAD_TO_SIMP.items():
        t = t.replace(k, v)
    t = t.lower()
    t = re.sub(r'[\s\-_——：:\(\)（）\[\]【】\.\!！\?？＆&]', '', t)
    return t

def find_active_domain():
    print("[CHECK] Testing active YHDM domains...")
    for dom in YHDM_DOMAINS:
        try:
            res = session.get(dom, timeout=4)
            if res.status_code == 200:
                print(f"  [OK] Active domain found: {dom}")
                return dom
        except:
            pass
    return None

def verify_anime_mismatch(args):
    filepath, anime_name, token, active_domain = args
    # 补全 URL
    if token.startswith('/p/'):
        url = f"{active_domain}{token}"
    elif token.startswith('http'):
        url = token
    else:
        return anime_name, False, "invalid_token", filepath

    try:
        res = session.get(url, timeout=5)
        if res.status_code != 200:
            return anime_name, False, f"HTTP {res.status_code}", filepath

        title_match = re.search(r'<title>([^<]+)</title>', res.text)
        if not title_match:
            return anime_name, False, "no_title_tag", filepath

        page_title = title_match.group(1)
        
        # 比对标题匹配
        clean_local = clean_title(anime_name)
        clean_web = clean_title(page_title)

        # 检查是否包含或模糊重合
        # 允许一定模糊，比如“从零开始的异世界生活” 包含在 “从零开始的异世界生活第二季第1集”
        is_match = False
        if clean_local in clean_web or clean_web in clean_local:
            is_match = True
        else:
            # 允许前 4 个字符或主要关键字重合
            if len(clean_local) >= 4 and clean_local[:4] in clean_web:
                is_match = True
            elif len(clean_local) >= 3 and clean_local in clean_web:
                is_match = True

        if is_match:
            return anime_name, True, page_title, filepath
        else:
            return anime_name, False, page_title, filepath
    except Exception as e:
        return anime_name, False, f"Error: {e}", filepath

def main():
    active_domain = find_active_domain()
    if not active_domain:
        print("[ERROR] No active YHDM domain found! Exiting.")
        sys.exit(1)

    tasks = []
    for fn in os.listdir(DETAIL_DIR):
        if not fn.endswith('.json'):
            continue
        path = os.path.join(DETAIL_DIR, fn)
        try:
            with open(path, encoding='utf-8') as f:
                d = json.load(f)
            v = d.get('video', {})
            name = v.get('name', '')
            pls = v.get('playlists', {})
            yhdm = pls.get('yhdm_line1', [])
            if isinstance(yhdm, list) and len(yhdm) > 0:
                first_ep_token = yhdm[0][1]
                if first_ep_token:
                    tasks.append((path, name, first_ep_token, active_domain))
        except Exception as e:
            pass

    print(f"\n[START] Verifying {len(tasks)} anime sources in parallel...")
    mismatch_count = 0
    clean_count = 0

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(verify_anime_mismatch, t): t for t in tasks}
        for fut in as_completed(futures):
            anime_name, is_match, web_title, filepath = fut.result()
            if not is_match:
                if "Error" in web_title or "HTTP" in web_title:
                    # 仅限网络错误，不执行清理，防止断网误删
                    print(f"  [⚠️ NETWORK/TIMEOUT] {anime_name} -> {web_title}")
                else:
                    mismatch_count += 1
                    print(f"  [❌ MISMATCH DETECTED] {anime_name}")
                    print(f"    - 网页展示为: {web_title}")
                    print(f"    - 本地记录为: {anime_name}")
                    
                    # 执行清理：清除 yhdm_line1 播放线路
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            d = json.load(f)
                        pls = d.get('video', {}).get('playlists', {})
                        if 'yhdm_line1' in pls:
                            del pls['yhdm_line1']
                            clean_count += 1
                        with open(filepath, 'w', encoding='utf-8') as f:
                            json.dump(d, f, ensure_ascii=False, indent=2)
                        print(f"    ✅ 已彻底物理清除 {anime_name} 的 yhdm_line1 线路")
                    except Exception as clean_err:
                        print(f"    ❌ 清除失败: {clean_err}")

    print(f"\n[DONE] 校验完成。共检测到 {mismatch_count} 个错乱资源，成功清理 {clean_count} 部番剧的失效线路。")

    if clean_count > 0:
        # 重建静态索引
        print("\n[REBUILD] Rebuilding static assets and indexes...")
        sys.path.insert(0, BASE_DIR)
        from update_data import rebuild_static_index_and_assets
        rebuild_static_index_and_assets()

if __name__ == "__main__":
    main()

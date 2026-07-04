#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AniCh 自动化新番获取与数据合并脚本 (Token 认证版)
==================================================
完全独立运行，不修改原有 update_data.py。

功能：
1. 自动从环境变量 ANICH_TOKEN 或 data/.anich_token 中加载用户 Token
2. 动态生成符合 Protobuf 协议规范的时间戳 `_` 认证 Header，绕过 API 接口的 unauthorized 500 限制
3. 请求 /bangumi/latest 获取 150 条最新番剧列表并与本地 age 索引进行 Fuzzy Match，自动生成和更新 ID 映射表
4. 请求 /bangumi/episodes/{id} 增量获取映射番剧的最新集数
5. 在本地 detail/{aid}.json 注入增量占位符，由前端在播放时实时解密，实现 100% 零网络负担播放
6. 自动更新首页周更放送表标注与 AniCh 独有推荐

用法：
  python3 scripts/anich_crawler.py
"""

import os
import sys
import json
import time
import re
import struct
import subprocess
import unicodedata

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DETAIL_DIR = os.path.join(DATA_DIR, "detail")
SEARCH_INDEX_PATH = os.path.join(DATA_DIR, "search_index.json")
HOME_LIST_PATH = os.path.join(DATA_DIR, "home-list.json")
OUTPUT_MAP_PATH = os.path.join(DATA_DIR, "anich_id_map.json")
ONLY_PATH = os.path.join(DATA_DIR, "anich_only.json")
TOKEN_FILE_PATH = os.path.join(DATA_DIR, ".anich_token")

ANICH_API_BASE = "https://ani.emmmm.eu.org"
ANICH_UA = "eu.org.emmmm.anich Android 1.5.18"

# ──────────────────────────────────────────────
# 1. Token 认证与 Protobuf 二进制 Header 生成
# ──────────────────────────────────────────────
def load_anich_token():
    # 优先从环境变量加载 (适合 GitHub Actions)
    tok = os.environ.get("ANICH_TOKEN")
    if tok:
        return tok.strip()
    # 其次从本地私有配置文件加载 (适合本地开发调试)
    if os.path.exists(TOKEN_FILE_PATH):
        with open(TOKEN_FILE_PATH, "r", encoding="utf-8") as f:
            return f.read().strip()
    return None

def to_varint(val):
    result = bytearray()
    while True:
        towrite = val & 0x7f
        val >>= 7
        if val != 0:
            towrite |= 0x80
        result.append(towrite)
        if val == 0:
            break
    return bytes(result)

def generate_header_token(token_str):
    if not token_str:
        return ""
    # 相当于 DateTime.now().millisecondsSinceEpoch + 1000 * 60
    timestamp_ms = int(time.time() * 1000) + 60000
    time_hex = hex(timestamp_ms)[2:]
    
    # 字段 1: token (tag=1, wire=2)
    token_bytes = token_str.encode('utf-8')
    f1 = b'\x0a' + to_varint(len(token_bytes)) + token_bytes
    
    # 字段 2: time (tag=2, wire=2)
    time_bytes = time_hex.encode('utf-8')
    f2 = b'\x12' + to_varint(len(time_bytes)) + time_bytes
    
    proto_bytes = f1 + f2
    # 转换成逗号连接的十进制数字符串
    return ','.join(str(b) for b in proto_bytes)

# ──────────────────────────────────────────────
# 2. 简易 Protobuf 二进制解码器
# ──────────────────────────────────────────────
def read_varint_pb(data, offset):
    result = 0
    shift = 0
    while True:
        if offset >= len(data):
            return None, offset
        b = data[offset]
        result |= (b & 0x7F) << shift
        offset += 1
        if not (b & 0x80):
            break
        shift += 7
    return result, offset

def parse_protobuf(data):
    offset = 0
    results = {}
    while offset < len(data):
        key, offset = read_varint_pb(data, offset)
        if key is None:
            break
        wire_type = key & 0x7
        field_num = key >> 3
        
        if wire_type == 0:  # Varint
            val, offset = read_varint_pb(data, offset)
            if val is None: break
            results.setdefault(field_num, []).append(('varint', val))
        elif wire_type == 1:  # 64-bit
            if offset + 8 > len(data): break
            val = struct.unpack('<d', data[offset:offset+8])[0]
            offset += 8
            results.setdefault(field_num, []).append(('double', val))
        elif wire_type == 2:  # Length-delimited
            length, offset = read_varint_pb(data, offset)
            if length is None: break
            if offset + length > len(data): break
            val = data[offset:offset+length]
            offset += length
            results.setdefault(field_num, []).append(('bytes', val))
        elif wire_type == 5:  # 32-bit
            if offset + 4 > len(data): break
            val = struct.unpack('<I', data[offset:offset+4])[0]
            offset += 4
            results.setdefault(field_num, []).append(('fixed32', val))
        else:
            break
    return results

def decode_latest_item(data):
    fields = parse_protobuf(data)
    item_id = fields.get(2, [(None, None)])[0][1]
    title = ""
    if 7 in fields:
        title = fields[7][0][1].decode('utf-8', errors='replace')
    elif 8 in fields:
        title = fields[8][0][1].decode('utf-8', errors='replace')
        
    image = ""
    if 6 in fields:
        image = fields[6][0][1].decode('utf-8', errors='replace')
        
    ep = fields.get(3, [(None, 0)])[0][1]
    return {'id': item_id, 'title': title, 'image': image, 'ep': ep}

def decode_latest_list(data):
    fields = parse_protobuf(data)
    items = []
    if 1 in fields:
        for val_type, raw_bytes in fields[1]:
            if val_type == 'bytes':
                try:
                    items.append(decode_latest_item(raw_bytes))
                except:
                    pass
    return items

def decode_episode_item(data):
    fields = parse_protobuf(data)
    sort = fields.get(2, [(None, 0)])[0][1]
    title = ""
    if 8 in fields:
        title = fields[8][0][1].decode('utf-8', errors='replace')
    return {'sort': sort, 'title': title}

def decode_episodes_list(data):
    fields = parse_protobuf(data)
    items = []
    if 1 in fields:
        for val_type, raw_bytes in fields[1]:
            if val_type == 'bytes':
                try:
                    items.append(decode_episode_item(raw_bytes))
                except:
                    pass
    return items

# ──────────────────────────────────────────────
# 3. 网络请求和 Fuzzy Match 匹配
# ──────────────────────────────────────────────
def curl_get_raw(url, auth_header, timeout=8):
    cmd = ["curl", "-s", "--fail", "--max-time", str(timeout), "-H", f"User-Agent: {ANICH_UA}"]
    if auth_header:
        cmd.extend(["-H", f"_: {auth_header}"])
    cmd.append(url)
    
    r = subprocess.run(cmd, capture_output=True)
    return r.stdout if r.returncode == 0 else None

def normalize(s):
    if not s: return ""
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub(r'[～~「」【】《》\s\-_\.！？!?、，。（）()\[\]{}・·•]', '', s)
    return s

def strip_season(s):
    s = re.sub(r'第[一二三四五六七八九十百\d]+[季期]', '', s)
    s = re.sub(r'season\s*\d+', '', s, flags=re.IGNORECASE)
    return s.strip()

def levenshtein(a, b):
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            temp = dp[j]
            dp[j] = prev if a[i-1] == b[j-1] else 1 + min(prev, dp[j], dp[j-1])
            prev = temp
    return dp[n]

def similarity(a, b):
    a, b = normalize(a), normalize(b)
    if not a or not b: return 0.0
    if a == b: return 1.0
    if a in b or b in a:
        return min(len(a), len(b)) / max(len(a), len(b)) * 0.95
    dist = levenshtein(a, b)
    return 1.0 - dist / max(len(a), len(b))

def best_match(anich_name, age_index, min_score=0.75):
    best_item, best_score = None, 0.0
    for age_item in age_index:
        age_title = age_item.get("Title", "")
        for s_a, s_b in [(anich_name, age_title),
                          (strip_season(anich_name), strip_season(age_title))]:
            s = similarity(s_a, s_b)
            if s > best_score:
                best_score, best_item = s, age_item
    return (best_item, best_score) if best_score >= min_score else (None, 0.0)

# ──────────────────────────────────────────────
# 4. 主运行逻辑
# ──────────────────────────────────────────────
def main():
    print("=" * 60)
    print("▶ 启动 AniCh 自动化数据链更新 (Token 认证 + 占位符模式)")
    print("=" * 60)

    # 1. 读取 Token 并生成 Header
    token = load_anich_token()
    if not token:
        print("[WARN] 未找到用户 Token。将尝试免密直连访问（可能因风控返回 500/unauthorized）")
        auth_header = ""
    else:
        auth_header = generate_header_token(token)
        print("[OK] 成功加载并生成了 Token 认证头")

    # 2. 抓取 latest 列表
    raw_latest = curl_get_raw(f"{ANICH_API_BASE}/bangumi/latest", auth_header)
    if not raw_latest:
        print("[ERROR] 无法拉取最新番剧列表 (API 访问失败，请检查 Token 是否失效)")
        sys.exit(1)
        
    latest_items = decode_latest_list(raw_latest)
    latest_items = [x for x in latest_items if x['id'] is not None]
    print(f"[OK] 成功获取最新更新列表: {len(latest_items)} 条番剧")

    # 3. 加载本地数据
    with open(SEARCH_INDEX_PATH, "r", encoding="utf-8") as f:
        age_index = json.load(f)
        
    existing_map = {}
    if os.path.exists(OUTPUT_MAP_PATH):
        with open(OUTPUT_MAP_PATH, "r", encoding="utf-8") as f:
            existing_map = json.load(f)

    # 4. Fuzzy Match 对齐更新映射表
    updated_map = dict(existing_map)
    anich_only = []
    
    print("\n[MAP] 开始增量 Fuzzy Match 自动对齐...")
    for item in latest_items:
        bid = item['id']
        title = item['title']
        
        matched_aid = None
        for aid, val in updated_map.items():
            if val.get("anich_id") == bid:
                matched_aid = aid
                break
                
        if matched_aid:
            continue  # 已经映射，跳过

        age_item, score = best_match(title, age_index)
        if age_item:
            aid_str = str(age_item["AID"])
            updated_map[aid_str] = {
                "anich_id": bid,
                "anich_name": title,
                "age_name": age_item["Title"],
                "confidence": round(score, 4),
                "anich_image": item["image"]
            }
            print(f"  ✅ [{score:.2f}] {title} → {age_item['Title']} (AID={aid_str})")
        else:
            anich_only.append(item)
            
    with open(OUTPUT_MAP_PATH, "w", encoding="utf-8") as f:
        json.dump(updated_map, f, ensure_ascii=False, indent=2)
    with open(ONLY_PATH, "w", encoding="utf-8") as f:
        json.dump(anich_only, f, ensure_ascii=False, indent=2)
    print(f"[OK] 映射表更新完成。累计映射: {len(updated_map)} 部")

    # 5. 同步集数占位符到 detail/*.json
    print("\n[VOD] 开始同步集数占位符...")
    sync_count = 0
    
    for age_aid, mapping in updated_map.items():
        bid = mapping["anich_id"]
        title = mapping["anich_name"]
        
        detail_path = os.path.join(DETAIL_DIR, f"{age_aid}.json")
        if not os.path.exists(detail_path):
            continue

        # 获取该番剧的最新集数
        raw_eps = curl_get_raw(f"{ANICH_API_BASE}/bangumi/episodes/{bid}", auth_header)
        if not raw_eps:
            continue
        eps_list = decode_episodes_list(raw_eps)
        if not eps_list:
            continue
            
        eps_list = sorted(eps_list, key=lambda x: x['sort'])
        
        with open(detail_path, "r", encoding="utf-8") as f:
            detail = json.load(f)

        playlists = detail.setdefault("video", {}).setdefault("playlists", {})
        existing_anich = playlists.get("anich_m3u8", [])

        ep_dict = {}
        for ep in existing_anich:
            if ep and len(ep) >= 2:
                ep_dict[ep[0]] = ep[1]

        updated_vod = False
        for ep_info in eps_list:
            ep_idx = ep_info['sort']
            ep_label = f"第{ep_idx:02d}集"

            # 核心安全规则：真实直链绝对不覆盖
            if ep_label in ep_dict and ep_dict[ep_label] and not ep_dict[ep_label].startswith("anich_placeholder_"):
                continue

            placeholder_val = f"anich_placeholder_{bid}_{ep_idx}"
            if ep_label not in ep_dict or ep_dict[ep_label] != placeholder_val:
                ep_dict[ep_label] = placeholder_val
                updated_vod = True

        if updated_vod:
            new_eps = [[label, url] for label, url in sorted(
                ep_dict.items(),
                key=lambda x: int(re.search(r'\d+', x[0]).group()) if re.search(r'\d+', x[0]) else 0
            ) if url]
            
            detail["video"]["playlists"]["anich_m3u8"] = new_eps
            detail.setdefault("player_label_arr", {})["anich_m3u8"] = "AniCh"

            with open(detail_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, ensure_ascii=False, indent=2)
            print(f"  ✓ {title} (AID={age_aid}) 已同步集数，注入了占位符")
            sync_count += 1
            
        time.sleep(0.15)

    print(f"[OK] 占位符更新完毕。共同步: {sync_count} 部番剧")

    # 6. 更新首页
    print("\n[HOME] 开始更新首页周更表与最近更新...")
    if os.path.exists(HOME_LIST_PATH):
        with open(HOME_LIST_PATH, "r", encoding="utf-8") as f:
            home = json.load(f)
            
        # 周更表标注
        week_list = home.get("week_list", {})
        marked_home = 0
        for day_key, day_items in week_list.items():
            for h_item in day_items:
                h_aid = str(h_item.get("id", ""))
                if h_aid in updated_map and "anich_id" not in h_item:
                    h_item["anich_id"] = updated_map[h_aid]["anich_id"]
                    marked_home += 1
                    
        # 首页 latest 列表追加 AniCh 独有新番
        existing_anich_ids_in_latest = {item.get("anich_id") for item in home.get("latest", []) if "anich_id" in item}
        added_latest = 0
        for entry in anich_only[:20]:
            anich_id = entry["id"]
            if anich_id in existing_anich_ids_in_latest:
                continue
                
            anich_item = {
                "AID": 0,
                "anich_id": anich_id,
                "source": "anich",
                "Href": f"/detail/anich_{anich_id}",
                "NewTitle": f"更新至第{entry['ep']}集",
                "PicSmall": entry.get("image", ""),
                "Title": entry["title"],
            }
            home.setdefault("latest", []).append(anich_item)
            added_latest += 1
            
        with open(HOME_LIST_PATH, "w", encoding="utf-8") as f:
            json.dump(home, f, ensure_ascii=False, indent=2)
            
        print(f"[OK] 首页更新完毕。标注了 {marked_home} 个已有番剧，添加了 {added_latest} 个 AniCh 独有新番")
        print("\n🎉 AniCh 全量数据爬取与增量占位符生成成功！")

if __name__ == '__main__':
    main()

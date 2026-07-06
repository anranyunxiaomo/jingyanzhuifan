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
def curl_get_raw(url, token_str, timeout=8):
    # 1. 尝试无 Token 访问（免登录接口）
    if not token_str:
        cmd = ["curl", "-s", "--fail", "--max-time", str(timeout), "-H", f"User-Agent: {ANICH_UA}", url]
        r = subprocess.run(cmd, capture_output=True)
        return r.stdout if r.returncode == 0 else None
        
    # 2. 带有 Token 认证，并进行时钟偏差容错重试
    # 尝试 5 个不同的时钟偏移量（单位：秒）：+60 (原版), 0, -60, +120, -120
    offsets = [60, 0, -60, 120, -120]
    
    for offset in offsets:
        # 动态计算该时钟偏移下的 header
        timestamp_ms = int(time.time() * 1000) + (offset * 1000)
        time_hex = hex(timestamp_ms)[2:]
        
        token_bytes = token_str.encode('utf-8')
        f1 = b'\x0a' + to_varint(len(token_bytes)) + token_bytes
        time_bytes = time_hex.encode('utf-8')
        f2 = b'\x12' + to_varint(len(time_bytes)) + time_bytes
        
        proto_bytes = f1 + f2
        auth_header = ','.join(str(b) for b in proto_bytes)
        
        cmd = ["curl", "-s", "--fail", "--max-time", str(timeout), 
               "-H", f"User-Agent: {ANICH_UA}", "-H", f"_: {auth_header}", url]
        
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode == 0:
            res_str = r.stdout.decode('utf-8', errors='ignore')
            if "unauthorized" not in res_str:
                return r.stdout  # 成功！
                
        time.sleep(0.2)
        
    return None

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
        # 💡 破解幽灵回音：在匹配真 AID 时，无条件忽略所有以 anich_ 开头的本地独有索引项！
        if str(age_item.get("AID", "")).startswith("anich_"):
            continue
        age_title = age_item.get("Title", "")
        for s_a, s_b in [(anich_name, age_title),
                          (strip_season(anich_name), strip_season(age_title))]:
            s = similarity(s_a, s_b)
            if s > best_score:
                best_score, best_item = s, age_item
    return (best_item, best_score) if best_score >= min_score else (None, 0.0)


def format_episode_title(ep):
    """
    智能将集数值格式化为符合前端卡片展示的 NewTitle
    """
    if not ep:
        return "更新中"
        
    if isinstance(ep, int):
        return f"更新至第{ep:02d}集"
        
    ep_str = str(ep).strip()
    
    # 如果已经是完备的集数标签，直接返回
    if ep_str.startswith("更新至"):
        return ep_str
        
    # 如果是 "更新中"、"连载"、"完结" 等状态词，直接返回
    if ep_str in ["更新中", "连载", "完结", "已完结"]:
        if ep_str == "更新中" or ep_str == "连载":
            return "连载中"
        return ep_str
        
    # 提取其中的集数数字
    m = re.search(r'\d+', ep_str)
    if m:
        num = int(m.group())
        return f"更新至第{num:02d}集"
        
    return ep_str


def clean_and_align_id_map(existing_map, age_index):
    """
    终极全量洗白对齐：清洗历史脏 Key 映射，将所有以 anich_ 开头的空壳映射，重新在全量 age 索引库中进行名字对齐！
    """
    cleaned_map = {}
    dirty_keys_resolved = 0
    
    for key, val in existing_map.items():
        if key.startswith("anich_"):
            title = val.get("anich_name")
            bid = val.get("anich_id")
            if title and bid:
                # 重新模糊对齐
                age_item, score = best_match(title, age_index)
                if age_item:
                    aid_str = str(age_item["AID"])
                    if aid_str not in cleaned_map:
                        cleaned_map[aid_str] = {
                            "anich_id": bid,
                            "anich_name": title,
                            "age_name": age_item["Title"],
                            "confidence": round(score, 4),
                            "anich_image": val.get("anich_image", "")
                        }
                        dirty_keys_resolved += 1
                        
                        # 物理删除废弃空壳 JSON 文件
                        old_only_path = os.path.join(DETAIL_DIR, f"anich_{bid}.json")
                        if os.path.exists(old_only_path):
                            try: os.remove(old_only_path)
                            except: pass
        else:
            cleaned_map[key] = val
            
    if dirty_keys_resolved > 0:
        print(f"\n[CLEANER] 成功全量清洗对齐了 {dirty_keys_resolved} 个历史错位空壳映射！")
        
    return cleaned_map


def run_static_fallback(id_map, age_index):
    print("\n[WARN] 线上 API 访问受限（IP可能被风控）。自动降级为静态本地更新模式...")
    print("=" * 60)
    
    sync_count = 0
    for age_aid, mapping in id_map.items():
        anich_id = mapping.get("anich_id")
        anich_name = mapping.get("anich_name")
        if not anich_id:
            continue

        detail_path = os.path.join(DETAIL_DIR, f"{age_aid}.json")
        if not os.path.exists(detail_path):
            continue

        with open(detail_path, "r", encoding="utf-8") as f:
            detail = json.load(f)

        playlists = detail.setdefault("video", {}).setdefault("playlists", {})
        
        # 找出 age 所有播放线路中的最大集数
        max_eps = 0
        for pkey, eps in playlists.items():
            if pkey == "anich_m3u8":
                continue
            if isinstance(eps, list) and len(eps) > max_eps:
                max_eps = len(eps)

        if max_eps == 0:
            continue

        existing_anich = playlists.get("anich_m3u8", [])
        ep_dict = {}
        for ep in existing_anich:
            if ep and len(ep) >= 2:
                ep_dict[ep[0]] = ep[1]

        updated = False
        for ep_idx in range(1, max_eps + 1):
            ep_label = f"第{ep_idx:02d}集"

            if ep_label in ep_dict and ep_dict[ep_label] and not ep_dict[ep_label].startswith("anich_placeholder_"):
                continue

            placeholder_val = f"anich_placeholder_{anich_id}_{ep_idx}"
            if ep_label not in ep_dict or ep_dict[ep_label] != placeholder_val:
                ep_dict[ep_label] = placeholder_val
                updated = True

        # 💡 在静态回退写回前，强行清理超出 max_eps 的旧占位符脏数据！
        has_dirty_placeholder = False
        for label, url in list(ep_dict.items()):
            m = re.search(r'\d+', label)
            if m:
                label_ep_idx = int(m.group())
                if url.startswith("anich_placeholder_") and label_ep_idx > max_eps:
                    del ep_dict[label]
                    has_dirty_placeholder = True

        if updated or has_dirty_placeholder:
            new_eps = [[label, url] for label, url in sorted(
                ep_dict.items(),
                key=lambda x: int(re.search(r'\d+', x[0]).group()) if re.search(r'\d+', x[0]) else 0
            ) if url]

            detail["video"]["playlists"]["anich_m3u8"] = new_eps
            detail.setdefault("player_label_arr", {})["anich_m3u8"] = "AniCh"

            with open(detail_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, ensure_ascii=False, indent=2)
            print(f"  ✓ [静态更新]: {anich_name} (AID={age_aid}) → 共 {max_eps} 集占位符 (已清理冗余)")
            sync_count += 1

    print(f"[OK] 静态占位符更新完毕。共同步: {sync_count} 部番剧")

    # 同步首页 week_list 标注
    if os.path.exists(HOME_LIST_PATH):
        with open(HOME_LIST_PATH, "r", encoding="utf-8") as f:
            home = json.load(f)
        
        week_list = home.get("week_list", {})
        marked_home = 0
        for day_key, day_items in week_list.items():
            for h_item in day_items:
                h_aid = str(h_item.get("id", ""))
                if h_aid in id_map and "anich_id" not in h_item:
                    h_item["anich_id"] = id_map[h_aid]["anich_id"]
                    marked_home += 1

        # 同样在静态降级中追加 AniCh 独有新番到 latest (直接从 search_index.json 提取以 anich_ 开头的所有独有动漫)
        anich_only_source = []
        if os.path.exists(SEARCH_INDEX_PATH):
            try:
                with open(SEARCH_INDEX_PATH, "r", encoding="utf-8") as f:
                    idx_list = json.load(f)
                for entry in idx_list:
                    aid_str = str(entry.get("AID", ""))
                    if aid_str.startswith("anich_"):
                        try:
                            bid = int(aid_str.split("_")[1])
                            anich_only_source.append({
                                "id": bid,
                                "title": entry.get("Title", ""),
                                "image": entry.get("Cover", ""),
                                "ep": entry.get("UpToDate", "第01集")
                            })
                        except:
                            pass
            except Exception as e:
                print(f"[WARN] 静态降级中无法从 search_index 提取独有番剧: {e}")
                
        existing_anich_ids_in_latest = {item.get("anich_id") for item in home.get("latest", []) if "anich_id" in item}
        added_latest = 0
        for entry in anich_only_source[:25]:
            anich_id = entry["id"]
            if anich_id in existing_anich_ids_in_latest:
                continue
                
            anich_item = {
                "AID": f"anich_{anich_id}",
                "anich_id": anich_id,
                "source": "anich",
                "Href": f"/detail/anich_{anich_id}",
                "NewTitle": format_episode_title(entry.get('ep')),
                "PicSmall": entry.get("image", ""),
                "Title": entry["title"],
            }
            home.setdefault("latest", []).append(anich_item)
            added_latest += 1
        print(f"[OK] 首页静态追加了 {added_latest} 个 AniCh 独有新番到最近更新")

        with open(HOME_LIST_PATH, "w", encoding="utf-8") as f:
            json.dump(home, f, ensure_ascii=False, indent=2)
        print(f"[OK] 首页周更表静态标注完成: 共 {marked_home} 个条目")

    # 对缓存的 AniCh 独有新番/国漫详情进行增量更新
    if 'anich_only_source' in locals() and anich_only_source:
        try:
            sync_anich_only_details(anich_only_source)
            sync_search_index(anich_only_source)
        except Exception as e:
            print(f"[WARN] 静态详情更新失败: {e}")
        
    print("\n🎉 降级静态同步全部顺利完成！")

def sync_anich_only_details(anich_only_items):
    if not anich_only_items:
        return
        
    print("\n[VOD] 开始同步 AniCh 独有新番与国漫的详情页...")
    sync_count = 0
    
    for item in anich_only_items:
        bid = item['id']
        title = item['title']
        img = item.get('image', '')
        # 兼容处理集数获取
        ep_val = item.get('ep', 1)
        max_eps = 1
        if isinstance(ep_val, int):
            max_eps = ep_val
        else:
            # 从 "第12集" 或 "更新至第12集" 中提取数字
            m = re.search(r'\d+', str(ep_val))
            if m:
                max_eps = int(m.group())
                
        detail_path = os.path.join(DETAIL_DIR, f"anich_{bid}.json")
        
        detail = {}
        if os.path.exists(detail_path):
            with open(detail_path, "r", encoding="utf-8") as f:
                try:
                    detail = json.load(f)
                except:
                    pass

        # 构建标准的 VOD 详情格式
        video = detail.setdefault("video", {})
        video["id"] = f"anich_{bid}"
        video["name"] = title
        video["cover"] = img
        video["company"] = "AniCh 独有"
        video["type"] = "TV"
        
        playlists = video.setdefault("playlists", {})
        existing_anich = playlists.get("anich_m3u8", [])
        ep_dict = {}
        for ep in existing_anich:
            if ep and len(ep) >= 2:
                ep_dict[ep[0]] = ep[1]
                
        updated = False
        for ep_idx in range(1, max_eps + 1):
            ep_label = f"第{ep_idx:02d}集"
            if ep_label in ep_dict and ep_dict[ep_label] and not ep_dict[ep_label].startswith("anich_placeholder_"):
                continue
                
            placeholder_val = f"anich_placeholder_{bid}_{ep_idx}"
            if ep_label not in ep_dict or ep_dict[ep_label] != placeholder_val:
                ep_dict[ep_label] = placeholder_val
                updated = True
                
        if updated or not os.path.exists(detail_path):
            new_eps = [[label, url] for label, url in sorted(
                ep_dict.items(),
                key=lambda x: int(re.search(r'\d+', x[0]).group()) if re.search(r'\d+', x[0]) else 0
            ) if url]
            
            video["playlists"]["anich_m3u8"] = new_eps
            detail.setdefault("player_label_arr", {})["anich_m3u8"] = "AniCh"
            
            with open(detail_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, ensure_ascii=False, indent=2)
            print(f"  ✓ AniCh 独有: {title} (anich_{bid}) 已同步 {max_eps} 集占位符")
            sync_count += 1
            
    print(f"[OK] AniCh 独有详情页同步完毕。共同步: {sync_count} 部番剧")

def sync_search_index(anich_only_items):
    if not anich_only_items or not os.path.exists(SEARCH_INDEX_PATH):
        return
        
    with open(SEARCH_INDEX_PATH, "r", encoding="utf-8") as f:
        try:
            search_index = json.load(f)
        except:
            search_index = []
            
    existing_aids = {str(item.get("AID")) for item in search_index}
    updated = False
    
    for item in anich_only_items:
        bid = item['id']
        title = item['title']
        aid_str = f"anich_{bid}"
        
        # 兼容提取集数
        ep_val = item.get('ep', 1)
        if isinstance(ep_val, int):
            new_up = f"更新至第{ep_val}集"
        else:
            m = re.search(r'\d+', str(ep_val))
            new_up = f"更新至第{m.group()}集" if m else f"更新至{ep_val}"
            
        if aid_str in existing_aids:
            for idx, entry in enumerate(search_index):
                if str(entry.get("AID")) == aid_str:
                    if entry.get("UpToDate") != new_up:
                        entry["UpToDate"] = new_up
                        updated = True
                    break
            continue
            
        entry = {
            "AID": aid_str,
            "Title": title,
            "Pinyin": title.lower().replace(" ", ""),
            "Cover": item.get("image", ""),
            "Status": "连载",
            "UpToDate": new_up
        }
        search_index.append(entry)
        existing_aids.add(aid_str)
        updated = True
        
    if updated:
        with open(SEARCH_INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump(search_index, f, ensure_ascii=False, indent=2)
        print(f"[OK] 全局搜索索引 data/search_index.json 已同步 (更新了 AniCh 独有资源)")

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
    else:
        # 安全脱敏打印，用于核对 GitHub Secrets 是否配置正确
        print(f"[OK] 成功加载 Token。长度: {len(token)} 字节 | 前6位: {token[:6]} | 后6位: {token[-6:]}")
        print("[INFO] 已启用动态时间戳容错认证。")

    # 2. 抓取 latest 列表
    raw_latest = curl_get_raw(f"{ANICH_API_BASE}/bangumi/latest", token)
    if not raw_latest:
        print("[ERROR] 无法拉取最新番剧列表 (API 访问失败，请检查 Token 是否失效)")
        # 自动降级为静态本地数据同步，保证 GitHub Actions 不会因网络波动而阻断部署
        with open(SEARCH_INDEX_PATH, "r", encoding="utf-8") as f:
            age_index = json.load(f)
        existing_map = {}
        if os.path.exists(OUTPUT_MAP_PATH):
            with open(OUTPUT_MAP_PATH, "r", encoding="utf-8") as f:
                existing_map = json.load(f)
                # 💡 全量洗白对齐：清洗历史脏 Key 映射，重新对齐到 AGE 真实 ID 上
                existing_map = clean_and_align_id_map(existing_map, age_index)
        run_static_fallback(existing_map, age_index)
        sys.exit(0) # 正常安全退出
        
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
            # 💡 全量洗白对齐：清洗历史脏 Key 映射，重新对齐到 AGE 真实 ID 上
            existing_map = clean_and_align_id_map(existing_map, age_index)
            
            # 💡 强力清扫漏网之鱼：如果映射表里已经将该番剧绑定到了 AGE 纯数字真 AID 上，
            # 那么磁盘上如果还残留有它以前作为 anich_only 产生的旧缓存 json，直接无条件强行删除！
            cleaned_count = 0
            for age_aid, mapping in existing_map.items():
                if str(age_aid).isdigit():
                    anich_id = mapping.get("anich_id")
                    if anich_id:
                        deprecated_path = os.path.join(DETAIL_DIR, f"anich_{anich_id}.json")
                        if os.path.exists(deprecated_path):
                            try:
                                os.remove(deprecated_path)
                                cleaned_count += 1
                                print(f"    [CLEANER] Removed residual deprecated cache: anich_{anich_id}.json")
                            except:
                                pass
            if cleaned_count > 0:
                print(f"[CLEANER] 磁盘清扫完毕。共强行抹除了 {cleaned_count} 个残留空壳缓存 JSON。")

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
            
            # 💡 物理清道夫：既然已经匹配到真实的 AGE AID，就立刻清除磁盘上废弃的旧 anich_only 缓存文件，防止索引冲突！
            old_only_path = os.path.join(DETAIL_DIR, f"anich_{bid}.json")
            if os.path.exists(old_only_path):
                try:
                    os.remove(old_only_path)
                    print(f"    [CLEANER] Removed deprecated only-cache: anich_{bid}.json")
                except Exception as e:
                    print(f"    [CLEANER] Failed to remove {old_only_path}: {e}")
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
        raw_eps = curl_get_raw(f"{ANICH_API_BASE}/bangumi/episodes/{bid}", token)
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
        valid_ep_labels = set() # 💡 记录所有 AniCh 上真正已更新（非空标题）的集数标签
        
        for ep_info in eps_list:
            if not ep_info.get('title'):
                continue
                
            ep_idx = ep_info['sort']
            ep_label = f"第{ep_idx:02d}集"
            valid_ep_labels.add(ep_label)

            # 核心安全规则：真实直链绝对不覆盖
            if ep_label in ep_dict and ep_dict[ep_label] and not ep_dict[ep_label].startswith("anich_placeholder_"):
                continue

            placeholder_val = f"anich_placeholder_{bid}_{ep_idx}"
            if ep_label not in ep_dict or ep_dict[ep_label] != placeholder_val:
                ep_dict[ep_label] = placeholder_val
                updated_vod = True

        # 💡 无论是否新增占位符，只要发现旧 playlists 里的 placeholder 数目不在已更新列表中，就强行剔除脏数据！
        has_dirty_placeholder = False
        for label, url in list(ep_dict.items()):
            if url.startswith("anich_placeholder_") and label not in valid_ep_labels:
                del ep_dict[label]
                has_dirty_placeholder = True

        if updated_vod or has_dirty_placeholder:
            new_eps = [[label, url] for label, url in sorted(
                ep_dict.items(),
                key=lambda x: int(re.search(r'\d+', x[0]).group()) if re.search(r'\d+', x[0]) else 0
            ) if url]
            
            detail["video"]["playlists"]["anich_m3u8"] = new_eps
            detail.setdefault("player_label_arr", {})["anich_m3u8"] = "AniCh"

            with open(detail_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, ensure_ascii=False, indent=2)
            print(f"  ✓ {title} (AID={age_aid}) 已同步集数，注入并清理了占位符")
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
                    
        # 首页 latest 列表追加 AniCh 独有新番 (直接从 search_index.json 提取以 anich_ 开头的所有独有动漫)
        anich_only_source = []
        if os.path.exists(SEARCH_INDEX_PATH):
            try:
                with open(SEARCH_INDEX_PATH, "r", encoding="utf-8") as f:
                    idx_list = json.load(f)
                for entry in idx_list:
                    aid_str = str(entry.get("AID", ""))
                    if aid_str.startswith("anich_"):
                        # 兼容提取数字 ID 作为 anich_id
                        try:
                            bid = int(aid_str.split("_")[1])
                            anich_only_source.append({
                                "id": bid,
                                "title": entry.get("Title", ""),
                                "image": entry.get("Cover", ""),
                                "ep": entry.get("UpToDate", "第01集")
                            })
                        except:
                            pass
            except Exception as e:
                print(f"[WARN] 无法从 search_index 提取独有番剧: {e}")
                
        # 融入当前的增量数据
        seen_ids = {x['id'] for x in anich_only_source}
        for entry in anich_only:
            if entry['id'] not in seen_ids:
                anich_only_source.append(entry)
                
        existing_anich_ids_in_latest = {item.get("anich_id") for item in home.get("latest", []) if "anich_id" in item}
        added_latest = 0
        for entry in anich_only_source[:25]:
            anich_id = entry["id"]
            if anich_id in existing_anich_ids_in_latest:
                continue
                
            anich_item = {
                "AID": f"anich_{anich_id}",
                "anich_id": anich_id,
                "source": "anich",
                "Href": f"/detail/anich_{anich_id}",
                "NewTitle": format_episode_title(entry.get('ep')),
                "PicSmall": entry.get("image", ""),
                "Title": entry["title"],
            }
            home.setdefault("latest", []).append(anich_item)
            added_latest += 1
            
        with open(HOME_LIST_PATH, "w", encoding="utf-8") as f:
            json.dump(home, f, ensure_ascii=False, indent=2)
            
        print(f"[OK] 首页更新完毕。标注了 {marked_home} 个已有番剧，添加了 {added_latest} 个 AniCh 独有新番")
        
        # 💡 同步 AniCh 独有新番/国漫的播放详情文件与搜索索引
        sync_anich_only_details(anich_only_source)
        sync_search_index(anich_only_source)
        
        print("\n🎉 AniCh 全量数据爬取与增量占位符生成成功！")

if __name__ == '__main__':
    main()

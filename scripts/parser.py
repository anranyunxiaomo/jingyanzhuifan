#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import re
import json
import requests
import urllib3
import time
from concurrent.futures import ThreadPoolExecutor

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ==========================================================================
# AGE 动漫 M3U8 视频直链嗅探解析器 (支持并发高速捕获)
# ==========================================================================
class AgeM3u8Sniffer:
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    }
    
    @classmethod
    def sniff_m3u8_link(cls, parse_url):
        """
        请求 AGE 的解析页面，正则嗅探出其中的 m3u8 直链
        """
        try:
            res = requests.get(parse_url, headers=cls.headers, verify=False, timeout=8)
            if res.status_code == 200:
                m3u8_matches = re.findall(r'["\'](https?://[^"\']+\.m3u8[^"\']*)["\']', res.text)
                if m3u8_matches:
                    real_m3u8 = m3u8_matches[0].replace("\\/", "/") # 还原斜杠
                    return real_m3u8
            return None
        except Exception:
            return None

# ==========================================================================
# 动漫元数据提取规则 (标题解析器)
# ==========================================================================
def parse_anime_title(title):
    """提取季度和集数元数据"""
    season = "S01"
    episode = "E01"

    # 1. 提取季度
    season_patterns = [
        r'(?:Season\s*|S)(\d+)',
        r'第\s*(\d+|[一二三四五六七八九十])\s*季'
    ]
    for p in season_patterns:
        match = re.search(p, title, re.IGNORECASE)
        if match:
            s_num = match.group(1)
            cn_map = {"开设": 1, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
            if s_num in cn_map:
                s_val = cn_map[s_num]
            else:
                s_val = int(s_num)
            season = f"S{s_val:02d}"
            break

    # 2. 提取集数
    episode_patterns = [
        r'\[(\d+)\]',
        r'(?:EP|Ep|Episode|第)\s*(\d+)\s*(?:话|集|v|x|v\d+|-).*',
        r'\s+-\s+(\d+)\s+',
        r'\s+(\d+)\s+(?:1080[pP]|720[pP])',
        r'[^0-9](\d{2})[^0-9]'
    ]
    for p in episode_patterns:
        match = re.search(p, title)
        if match:
            ep_val = int(match.group(1))
            if ep_val < 100:
                episode = f"E{ep_val:02d}"
                break

    return season, episode

# ==========================================================================
# 线程池单集嗅探单元
# ==========================================================================
def sniff_single_episode(ep_data, parse_base):
    ep_title = ep_data[0]
    ep_val = ep_data[1]
    
    # 拼接解析页 URL
    if "http" in ep_val:
        parse_url = ep_val
    else:
        parse_url = parse_base + ep_val
        
    real_m3u8 = AgeM3u8Sniffer.sniff_m3u8_link(parse_url)
    play_url = real_m3u8 if real_m3u8 else parse_url
    
    print(f"[嗅探完成] 集数: {ep_title} | 播放链接: {play_url[:60]}...")
    return {
        "title": ep_title,
        "url": play_url,
        "timestamp": int(time.time())
    }

# ==========================================================================
# 核心调度逻辑
# ==========================================================================
def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sub_path = os.path.join(base_dir, "subscription.json")
    dl_path = os.path.join(base_dir, "downloaded.json")
    
    AGE_API_BASE = "https://ageapi.omwjhz.com:18888/v2/"
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    }

    # 加载已缓存列表 (重构为按“动漫大类”聚合的格式)
    # downloaded.json 结构:
    # [
    #   {
    #     "anime": "名侦探柯南",
    #     "AID": "20000005",
    #     "cover": "https://...",
    #     "episodes": [ {"title": "第1集", "url": "...", "timestamp": ...}, ... ]
    #   }
    # ]
    downloaded = []
    if os.path.exists(dl_path):
        try:
            with open(dl_path, 'r', encoding='utf-8') as f:
                downloaded = json.load(f)
                # 兼容性修复：如果老数据是平铺数组，直接清空重构
                if downloaded and not isinstance(downloaded[0], dict) or (downloaded and "episodes" not in downloaded[0]):
                    print("[兼容提示] 发现旧版平铺数据格式，执行升级重组...")
                    downloaded = []
        except Exception as e:
            print(f"[警告] 读取 downloaded.json 失败: {e}")

    payload_name = os.environ.get("PAYLOAD_NAME") # 此时传递过来的是动漫名 (例如 "莉可丽丝")
    payload_torrent = os.environ.get("PAYLOAD_TORRENT") # 此时传递过来的是动漫的 AID (例如 "20200062")

    # ==========================================================================
    # 启动模式 1：云端一键整部嗅探入库 (由前台搜索或详情点击触发)
    # ==========================================================================
    if payload_name and payload_torrent:
        print(f"[启动模式] 实时整部动漫嗅探: 《{payload_name}》 (AID: {payload_torrent})")
        
        # 1.1 拉取详情获取播放列表线路
        detail_url = f"{AGE_API_BASE}detail/{payload_torrent}"
        try:
            res_det = requests.get(detail_url, headers=headers, verify=False, timeout=12)
            det_data = res_det.json()
            
            playlist = det_data.get("video", {}).get("playlists", {})
            player_jx = det_data.get("player_jx", {"vip": "", "zj": ""})
            player_vip = det_data.get("player_vip", "")
            cover = det_data.get("video", {}).get("cover", "")
            
            if not playlist:
                print("[嗅探中止] 无法获取该动漫的播放线路")
                return
                
            # 优先使用直链 m3u8 线路
            selected_line = ""
            for line in playlist.keys():
                if "m3u8" in line.lower() or "直链" in line:
                    selected_line = line
                    break
            if not selected_line:
                selected_line = list(playlist.keys())[0]
                
            eps = playlist[selected_line]
            print(f"[嗅探线路] 锁定播放线路: {selected_line} | 总集数: {len(eps)}")
            
            # 如果是柯南这种上千集的超长篇，限制只嗅探最近的 35 集，防止请求过多被拉黑封锁
            if len(eps) > 35:
                print(f"[集数超限] 集数达 {len(eps)} 集，将只并发嗅探最近更新的 35 集...")
                eps_to_sniff = eps[-35:]
            else:
                eps_to_sniff = eps

            # 判断线路解析前缀
            is_vip = False
            if isinstance(player_vip, str):
                is_vip = selected_line in player_vip.split(",")
            elif isinstance(player_vip, list):
                is_vip = selected_line in player_vip
            parse_base = player_jx["vip"] if is_vip else player_jx["zj"]
            if not parse_base:
                parse_base = "https://jx.wuzhoupai.com:8443/m3u8/?url="

            # 1.2 高速并发嗅探所有集数的 m3u8 直链
            print(f"[并发调度] 启动多线程并发嗅探，最大线程数: 15...")
            sniffed_episodes = []
            with ThreadPoolExecutor(max_workers=15) as executor:
                futures = [executor.submit(sniff_single_episode, ep, parse_base) for ep in eps_to_sniff]
                sniffed_episodes = [f.result() for f in futures]
                
            # 1.3 整合打包写回
            record = {
                "anime": payload_name,
                "AID": payload_torrent,
                "cover": cover,
                "episodes": sniffed_episodes
            }
            # 移除已有的同名动漫，新点播的置顶
            downloaded = [d for d in downloaded if d.get("anime") != payload_name]
            downloaded.insert(0, record)
            
            with open(dl_path, 'w', encoding='utf-8') as f:
                json.dump(downloaded, f, indent=2, ensure_ascii=False)
            print(f"[点播成功] 《{payload_name}》全集直链已成功归类缓存入库！")
        except Exception as e:
            print(f"[点播失败] 嗅探过程异常: {e}")
        return

    # ==========================================================================
    # 启动模式 2：后台跟更定时检测
    # ==========================================================================
    print("[启动模式] Cron 定时批量运行")
    if not os.path.exists(sub_path):
        print("[通知] 配置文件 subscription.json 缺失")
        return
    with open(sub_path, 'r', encoding='utf-8') as f:
        subscriptions = json.load(f)

    if not subscriptions:
        print("[通知] 订阅列表为空，无需更番嗅探")
        return

    new_updates_found = False

    for sub in subscriptions:
        name = sub["name"]
        print(f"\n[跟更检测] 开始检索订阅动漫: {name}")
        
        search_url = f"{AGE_API_BASE}search?query={requests.utils.quote(name)}&page=1"
        try:
            res = requests.get(search_url, headers=headers, verify=False, timeout=10)
            videos = res.json().get("data", {}).get("videos", [])
            if not videos:
                continue
                
            AID = videos[0]["id"]
            latest_ep_name = videos[0]["uptodate"]
            cover = videos[0]["cover"]
            
            # 判断在 downloaded 对应动漫下是否已经嗅探过该集数
            anime_record = None
            for d in downloaded:
                if d.get("anime") == name:
                    anime_record = d
                    break
                    
            if anime_record:
                # 检查是否已包含最新集数
                already_exists = False
                for ep in anime_record["episodes"]:
                    if ep["title"] == latest_ep_name:
                        already_exists = True
                        break
                if already_exists:
                    print(f"[无须更新] 《{name}》最新集 {latest_ep_name} 已存在。")
                    continue
            
            # 如果新集数未曾嗅探，则拉取详情嗅探最新一集
            print(f"[发现更新] 《{name}》有新剧集发布: {latest_ep_name}，开始拉取直链...")
            detail_url = f"{AGE_API_BASE}detail/{AID}"
            res_det = requests.get(detail_url, headers=headers, verify=False, timeout=10)
            det_data = res_det.json()
            
            playlist = det_data.get("video", {}).get("playlists", {})
            player_jx = det_data.get("player_jx", {"vip": "", "zj": ""})
            player_vip = det_data.get("player_vip", "")
            
            if not playlist:
                continue
                
            selected_line = ""
            for line in playlist.keys():
                if "m3u8" in line.lower() or "直链" in line:
                    selected_line = line
                    break
            if not selected_line:
                selected_line = list(playlist.keys())[0]
                
            eps = playlist[selected_line]
            if not eps:
                continue
                
            # 锁定最新的一集 (最后一项)
            latest_ep_data = eps[-1]
            ep_title = latest_ep_data[0]
            ep_val = latest_ep_data[1]
            
            is_vip = False
            if isinstance(player_vip, str):
                is_vip = selected_line in player_vip.split(",")
            elif isinstance(player_vip, list):
                is_vip = selected_line in player_vip
            parse_base = player_jx["vip"] if is_vip else player_jx["zj"]
            if not parse_base:
                parse_base = "https://jx.wuzhoupai.com:8443/m3u8/?url="
                
            parse_url = parse_base + ep_val
            
            # 单集快速嗅探
            real_m3u8 = AgeM3u8Sniffer.sniff_m3u8_link(parse_url)
            play_url = real_m3u8 if real_m3u8 else parse_url
            
            new_ep_record = {
                "title": ep_title,
                "url": play_url,
                "timestamp": int(time.time())
            }
            
            # 整合归档回写
            if anime_record:
                # 移除旧的同名集数以防万一
                anime_record["episodes"] = [ep for ep in anime_record["episodes"] if ep["title"] != ep_title]
                anime_record["episodes"].append(new_ep_record)
            else:
                # 若是首次出现，创建全新大类
                downloaded.insert(0, {
                    "anime": name,
                    "AID": str(AID),
                    "cover": cover,
                    "episodes": [new_ep_record]
                })
            new_updates_found = True
            print(f"[跟更成功] 自动为 《{name}》 追更加载了 {ep_title} 的 m3u8 直链")
        except Exception as e:
            print(f"[跟更异常]: {e}")
            continue

    # 保存
    if new_updates_found:
        with open(dl_path, 'w', encoding='utf-8') as f:
            json.dump(downloaded, f, indent=2, ensure_ascii=False)
            
    # 3. 顺便更新首页的最新更新流静态 json
    try:
        print("[最新发布流] 正在拉取最新的 AGE 每日更新...")
        res = requests.get(f"{AGE_API_BASE}home-list", headers=headers, verify=False, timeout=10)
        data = res.json()
        if data and data.get("latest"):
            latest_json_path = os.path.join(base_dir, "latest_rss.json")
            with open(latest_json_path, 'w', encoding='utf-8') as f:
                json.dump(data["latest"], f, indent=2, ensure_ascii=False)
            print("[最新发布流] 成功写入最新 45 部更新缓存！")
    except Exception as e:
        print(f"[最新发布流异常] 写入失败: {e}")

if __name__ == '__main__':
    main()

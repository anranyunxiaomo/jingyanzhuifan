#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import re
import json
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ==========================================================================
# AGE 动漫 M3U8 视频直链嗅探解析器
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
        print(f"[嗅探解析] 正在请求解析源网址: {parse_url}")
        try:
            res = requests.get(parse_url, headers=cls.headers, verify=False, timeout=12)
            if res.status_code == 200:
                # 正则匹配符合 m3u8 地址的各种 url 表达式
                m3u8_matches = re.findall(r'["\'](https?://[^"\']+\.m3u8[^"\']*)["\']', res.text)
                if m3u8_matches:
                    real_m3u8 = m3u8_matches[0].replace("\\/", "/") # 处理转义斜杠
                    print(f"[嗅探成功] 捕获到底层 m3u8 真实播放流: {real_m3u8}")
                    return real_m3u8
                
                print("[警告] 解析页面加载成功，但未能提取到 .m3u8 字符串")
                return None
            print(f"[解析异常] 服务器返回状态码: {res.status_code}")
            return None
        except Exception as e:
            print(f"[解析出错] 请求发生异常: {e}")
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
# 核心调度逻辑
# ==========================================================================
def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sub_path = os.path.join(base_dir, "subscription.json")
    dl_path = os.path.join(base_dir, "downloaded.json")
    
    # API 接口 Host
    AGE_API_BASE = "https://ageapi.omwjhz.com:18888/v2/"
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    }

    # 1. 加载播放列表历史
    downloaded = []
    if os.path.exists(dl_path):
        try:
            with open(dl_path, 'r', encoding='utf-8') as f:
                downloaded = json.load(f)
        except Exception as e:
            print(f"[警告] 读取 downloaded.json 失败: {e}")

    # ==========================================================================
    # 判定启动模式：前台点播 (PAYLOAD) 或是 后台定时跟更 (Cron)
    # ==========================================================================
    payload_name = os.environ.get("PAYLOAD_NAME")
    payload_torrent = os.environ.get("PAYLOAD_TORRENT") # 此时前端传递过来的是集数的 epVal，即加密参数
    
    # 1. 实时点播模式
    if payload_name and payload_torrent:
        # 当由网页一键点播时，我们需要解析出真实的 m3u8 并立即存入
        print(f"[启动模式] 实时点播嗅探: 《{payload_name}》")
        
        # 拼接解析源
        # 优先使用直链(zj)解析接口
        # 为了保证通用，如果 epVal 没有前缀则手动补齐
        parse_base = "https://jx.wuzhoupai.com:8443/m3u8/?url="
        if "http" in payload_torrent:
            parse_url = payload_torrent
        else:
            parse_url = parse_base + payload_torrent

        real_m3u8 = AgeM3u8Sniffer.sniff_m3u8_link(parse_url)
        play_url = real_m3u8 if real_m3u8 else parse_url # 提取失败则回退至解析页网页，确保能播
        
        # 写入下载库
        season, episode = parse_anime_title(payload_name)
        import time
        record = {
            "title": payload_name,
            "link": payload_torrent,
            "url": play_url,
            "anime": payload_name.split('-')[0].strip(),
            "season": season,
            "episode": episode,
            "timestamp": int(time.time())
        }
        # 去重
        downloaded = [d for d in downloaded if d.get("title") != payload_name]
        downloaded.insert(0, record)
        
        with open(dl_path, 'w', encoding='utf-8') as f:
            json.dump(downloaded, f, indent=2, ensure_ascii=False)
        print("[完成] 实时点播番剧的 m3u8 直链已成功嗅探并更新回库！")
        return

    # 2. 定时跟更模式
    print("[启动模式] Cron 定时批量运行")
    if not os.path.exists(sub_path):
        print("[通知] 配置文件 subscription.json 缺失")
        return
    with open(sub_path, 'r', encoding='utf-8') as f:
        subscriptions = json.load(f)

    if not subscriptions:
        print("[通知] 订阅列表为空，无需更番嗅探")
        return

    new_success_records = []

    for sub in subscriptions:
        name = sub["name"]
        print(f"\n[跟更检测] 开始检索订阅动漫: {name}")
        
        # 2.1 搜索该动漫
        search_url = f"{AGE_API_BASE}search?query={requests.utils.quote(name)}&page=1"
        try:
            res = requests.get(search_url, headers=headers, verify=False, timeout=10)
            res_data = res.json()
            videos = res_data.get("data", {}).get("videos", [])
            if not videos:
                print(f"[搜索落空] 动漫库中未查到该订阅: {name}")
                continue
                
            # 取最相关的第一个 AID
            AID = videos[0]["id"]
            latest_ep_name = videos[0]["uptodate"] # 最新更新集数标签，例如 "第12集"
            
            # 2.2 判断是否已经提取过该最新集数
            record_title = f"{name} - {latest_ep_name}"
            already_exists = False
            for d in downloaded:
                if d.get("title") == record_title:
                    already_exists = True
                    break
                    
            if already_exists:
                print(f"[无须更新] 《{name}》的最新集数 {latest_ep_name} 已在播放库中，跳过。")
                continue
                
            # 2.3 拉取该动漫详情以获得最新的播放线路及参数
            detail_url = f"{AGE_API_BASE}detail/{AID}"
            res_det = requests.get(detail_url, headers=headers, verify=False, timeout=10)
            det_data = res_det.json()
            
            playlist = det_data.get("video", {}).get("playlists", {})
            player_jx = det_data.get("player_jx", {"vip": "", "zj": ""})
            player_vip = det_data.get("player_vip", "")
            
            if not playlist:
                print(f"[详情空缺] 无法获取播放线路: {name}")
                continue
                
            # 优先挑出 m3u8 或者是直链线路
            # ffm3u8, bfzym3u8, wjm3u8, lzm3u8, sdm3u8 等
            selected_line = ""
            for line in playlist.keys():
                if "m3u8" in line.lower() or "直链" in line:
                    selected_line = line
                    break
            if not selected_line:
                selected_line = list(playlist.keys())[0]
                
            eps = playlist[selected_line]
            if not eps:
                print(f"[集数为空] 线路下没有集数: {selected_line}")
                continue
                
            # 获取最新集数的参数 (即最后一项)
            latest_ep_data = eps[-1]
            ep_title = latest_ep_data[0]
            ep_val = latest_ep_data[1]
            
            # 判断是否是 VIP 线路
            is_vip = False
            if isinstance(player_vip, str):
                is_vip = selected_line in player_vip.split(",")
            elif isinstance(player_vip, list):
                is_vip = selected_line in player_vip
                
            # 拼接解析源
            parse_base = player_jx["vip"] if is_vip else player_jx["zj"]
            if not parse_base:
                parse_base = "https://jx.wuzhoupai.com:8443/m3u8/?url="
                
            parse_url = parse_base + ep_val
            
            # 2.4 进行 m3u8 直链嗅探
            real_m3u8 = AgeM3u8Sniffer.sniff_m3u8_link(parse_url)
            play_url = real_m3u8 if real_m3u8 else parse_url
            
            # 2.5 写入播放记录
            season, episode = parse_anime_title(ep_title)
            import time
            record = {
                "title": f"{name} - {ep_title}",
                "link": ep_val,
                "url": play_url,
                "anime": name,
                "season": season,
                "episode": ep_title,
                "timestamp": int(time.time())
            }
            # 过滤重复，写回库
            downloaded = [d for d in downloaded if d.get("title") != record["title"]]
            downloaded.insert(0, record)
            new_success_records.append(record)
            
        except Exception as e:
            print(f"[异常中断] 检测 《{name}》 时发生错误: {e}")
            continue

    # 3. 回写状态数据
    if new_success_records:
        with open(dl_path, 'w', encoding='utf-8') as f:
            json.dump(downloaded, f, indent=2, ensure_ascii=False)
        print(f"[完成] 定时嗅探已成功获取并回写了 {len(new_success_records)} 个最新集数直链！")
    else:
        print("[完成] 本次未检测到任何新集数发布，已跳过。")

    # 4. 生成今日新番的最新大类缓存文件 (供前端极速载入，无需 ऑल origins 中继)
    # 我们也可以把 AGE 今日更新也直接写入 latest_rss.json
    try:
        print("[最新发布流] 正在拉取最新的 AGE 每日新番更新供网页离线缓存...")
        res = requests.get(f"{AGE_API_BASE}home-list", headers=headers, verify=False, timeout=10)
        data = res.json()
        if data and data.get("latest"):
            latest_json_path = os.path.join(base_dir, "latest_rss.json")
            with open(latest_json_path, 'w', encoding='utf-8') as f:
                json.dump(data["latest"], f, indent=2, ensure_ascii=False)
            print("[最新发布流] 成功写入最新 45 部 AGE 更新缓存！")
    except Exception as e:
        print(f"[最新发布流异常] 写入失败: {e}")

if __name__ == '__main__':
    main()

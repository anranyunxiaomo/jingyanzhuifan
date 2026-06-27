#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import re
import json
import subprocess
import xml.etree.ElementTree as ET
import requests

# ==========================================================================
# 免费公网文件直链中继 (主通道 Transfer.sh + 备用通道 Pixeldrain)
# ==========================================================================
class FileUploader:
    @staticmethod
    def upload_to_transfersh(file_path):
        """
        主通道：上传到 transfer.sh
        单个文件最大 10GB，有效期 14 天，支持流媒体在线播放
        """
        file_name = os.path.basename(file_path)
        print(f"[直链转换] 尝试上传 {file_name} 到主通道 transfer.sh...")
        
        # 针对特殊字符进行转义，确保传输接口正常
        encoded_name = requests.utils.quote(file_name)
        url = f"https://transfer.sh/{encoded_name}"
        
        try:
            # 开启 identity 头部解决解压问题
            headers = {"Accept-Encoding": "identity"}
            with open(file_path, 'rb') as f:
                res = requests.put(url, data=f, headers=headers, timeout=300) # 限时 5 分钟
            
            if res.status_code == 200:
                play_url = res.text.strip()
                print(f"[直链转换成功] 主通道返回链接: {play_url}")
                return play_url
            
            print(f"[主通道失败] 服务器返回状态码: {res.status_code}")
            return None
        except Exception as e:
            print(f"[主通道异常] 发生错误: {e}")
            return None

    @staticmethod
    def upload_to_pixeldrain(file_path):
        """
        备用通道：上传到 pixeldrain.com
        单个文件最大 20GB，无流量限制，对中国大陆网络非常稳定
        """
        file_name = os.path.basename(file_path)
        print(f"[直链转换] 尝试上传 {file_name} 到备用通道 pixeldrain...")
        url = "https://pixeldrain.com/api/file"
        
        try:
            headers = {"Accept-Encoding": "identity"}
            with open(file_path, 'rb') as f:
                files = {"file": f}
                res = requests.post(url, files=files, headers=headers, timeout=300)
            
            res_data = res.json()
            if res.status_code == 201 or res_data.get("success"):
                file_id = res_data.get("id")
                # 拼装公网视频直链 (支持 Streaming 播放)
                play_url = f"https://pixeldrain.com/api/file/{file_id}"
                print(f"[直链转换成功] 备用通道返回链接: {play_url}")
                return play_url
            
            print(f"[备用通道失败] 服务器返回: {res_data}")
            return None
        except Exception as e:
            print(f"[备用通道异常] 发生错误: {e}")
            return None

    @classmethod
    def upload(cls, file_path):
        """双通道安全上传器"""
        # 1. 优先尝试主通道 transfer.sh
        play_url = cls.upload_to_transfersh(file_path)
        if play_url:
            return play_url
            
        print("[警告] 主通道上传失败，正在切换到备用通道...")
        
        # 2. 备用通道 pixeldrain
        play_url = cls.upload_to_pixeldrain(file_path)
        if play_url:
            return play_url
            
        print("[错误] 所有上传直链通道均已失效，放弃本次上传")
        return None

# ==========================================================================
# Aria2 命令行极速下载封装
# ==========================================================================
def run_aria2_download(magnet_link, download_dir):
    """
    调用 aria2c 进行磁力链接极速下载
    """
    os.makedirs(download_dir, exist_ok=True)
    cmd = [
        "aria2c",
        "--seed-time=0",               # 下载完成立即退出做种
        "--bt-stop-timeout=120",       # 2分钟无新数据传输则超时退出
        "--max-connection-per-server=16",
        "--split=16",
        "-d", download_dir,
        magnet_link
    ]
    print(f"[Aria2 启动] 命令: {' '.join(cmd)}")
    try:
        # 设定单任务最长 8 分钟下载时间限制
        result = subprocess.run(cmd, stdout=sys.stdout, stderr=sys.stderr, timeout=480)
        if result.returncode == 0:
            print("[Aria2 下载成功] 视频已顺利保存到本地缓存目录")
            return True
        else:
            print(f"[Aria2 退出] 错误码: {result.returncode}")
            return False
    except subprocess.TimeoutExpired:
        print("[Aria2 超时] 任务下载超过 8 分钟被强制退出")
        return False
    except Exception as e:
        print(f"[Aria2 异常] 执行出错: {e}")
        return False

def get_largest_video_file(directory):
    """遍历目录寻找体积最大的视频文件"""
    video_extensions = ('.mp4', '.mkv', '.avi', '.mov', '.webm')
    largest_file = None
    max_size = 0
    
    for root, _, files in os.walk(directory):
        for f in files:
            if f.lower().endswith(video_extensions):
                fp = os.path.join(root, f)
                sz = os.path.getsize(fp)
                if sz > max_size:
                    max_size = sz
                    largest_file = fp
    return largest_file

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
            cn_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
            if s_num in cn_map:
                s_val = cn_map[s_num]
            else:
                s_val = int(s_num)
            season = f"S{s_val:02d}"
            break

    # 2. 提取集数
    episode_patterns = [
        r'\[(\d+)\]',
        r'(?:EP|Ep|Episode|第)\s*(\d+)\s*(?:话|集|v|x|\s)',
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

    # 1. 判断启动模式 (实时点播 payload 注入 vs 定时 cron 批量检测)
    payload_name = os.environ.get("PAYLOAD_NAME")
    payload_keyword = os.environ.get("PAYLOAD_KEYWORD")
    payload_subgroup = os.environ.get("PAYLOAD_SUBGROUP")
    payload_quality = os.environ.get("PAYLOAD_QUALITY")

    target_jobs = []

    if payload_name and payload_keyword:
        print(f"[启动模式] 前端实时点播: 《{payload_name}》 (关键字: {payload_keyword})")
        target_jobs.append({
            "name": payload_name,
            "keyword": payload_keyword,
            "subgroup": payload_subgroup or "",
            "quality": payload_quality or "1080p"
        })
    else:
        print("[启动模式] Cron 定时批量运行")
        if not os.path.exists(sub_path):
            print("[通知] 配置文件 subscription.json 缺失")
            return
        with open(sub_path, 'r', encoding='utf-8') as f:
            target_jobs = json.load(f)

    if not target_jobs:
        print("[通知] 任务列表为空，结束流程")
        return

    # 加载已下载历史
    downloaded = []
    if os.path.exists(dl_path):
        try:
            with open(dl_path, 'r', encoding='utf-8') as f:
                downloaded = json.load(f)
        except Exception as e:
            print(f"[警告] 读取 downloaded.json 失败: {e}")

    # 2. 拉取最新 Mikan RSS
    rss_url = "https://mikanani.me/RSS/Classic"
    print(f"[通知] 开始拉取 RSS 源: {rss_url}")
    try:
        res = requests.get(rss_url, timeout=20)
        res.raise_for_status()
        xml_content = res.content
    except Exception as e:
        print(f"[错误] 拉取 RSS 失败: {e}")
        return

    try:
        root = ET.fromstring(xml_content)
        items = root.findall('.//item')
    except Exception as e:
        print(f"[错误] 解析 XML 失败: {e}")
        return

    print(f"[通知] 成功解析出 {len(items)} 条种子资源")

    new_success_records = []

    # 3. 循环匹配，下载并转换直链
    for item in items:
        title = item.find('title').text
        link = item.find('link').text

        for job in target_jobs:
            # 规则匹配
            if job['keyword'].lower() not in title.lower():
                continue
            if job.get('subgroup') and job['subgroup'].lower() not in title.lower():
                continue
            if job.get('quality') and job['quality'].lower() not in title.lower():
                continue

            # 避免重复下载
            already_downloaded = False
            for d in downloaded:
                if isinstance(d, dict) and d.get("link") == link:
                    already_downloaded = True
                    break
                elif isinstance(d, str) and d == link:
                    already_downloaded = True
                    break
            
            if already_downloaded:
                continue

            # 匹配成功！
            season, episode = parse_anime_title(title)
            anime_name = job['name']
            
            print(f"\n[点播下载匹配] 正在云端下载番剧: {title}")
            temp_download_dir = os.path.join(base_dir, "temp_aria2_downloads")
            
            # 清理可能残留的临时目录
            if os.path.exists(temp_download_dir):
                import shutil
                shutil.rmtree(temp_download_dir)

            # 调用 Aria2 下载
            if run_aria2_download(link, temp_download_dir):
                # 获取最大的视频文件
                video_file = get_largest_video_file(temp_download_dir)
                if video_file:
                    # 转换公网直链 (双通道上传中继)
                    play_url = FileUploader.upload(video_file)
                    
                    if play_url:
                        # 记录成功到下载历史
                        import time
                        record = {
                            "title": f"{anime_name} - {season}{episode}",
                            "link": link,
                            "url": play_url,
                            "anime": anime_name,
                            "season": season,
                            "episode": episode,
                            "timestamp": int(time.time())
                        }
                        downloaded.insert(0, record)
                        new_success_records.append(record)
                        
                # 清理临时文件释放 Actions 虚拟机磁盘空间
                import shutil
                shutil.rmtree(temp_download_dir)
                break

    # 4. 回写状态数据
    if new_success_records:
        formatted_downloads = []
        for d in downloaded:
            if isinstance(d, dict):
                formatted_downloads.append(d)
        
        with open(dl_path, 'w', encoding='utf-8') as f:
            json.dump(formatted_downloads, f, indent=2)
        print(f"[完成] 本次共成功下载并转换了 {len(new_success_records)} 个直链链接")
    else:
        print("[完成] 本次未下载转换任何视频链接")

if __name__ == '__main__':
    main()

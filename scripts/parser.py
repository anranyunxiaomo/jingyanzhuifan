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
# 终极黑魔法：利用 GitHub Releases 作为 100% 稳定且免费的视频直链分发存储
# ==========================================================================
class GitHubReleaseUploader:
    def __init__(self, repo_full_name, token):
        self.repo = repo_full_name
        self.token = token
        # 配置系统环境变量，使得 gh 命令行工具能自动登录并使用 write 权限
        os.environ["GITHUB_TOKEN"] = token

    def upload_file(self, local_path, rename_to):
        """
        利用 actions 自带的 gh 命令行客户端，将视频极速上传到仓库的 releases 中
        """
        # 1. 确保 local_path 存在
        if not os.path.exists(local_path):
            print(f"[GH-Release 异常] 待上传的本地视频文件不存在: {local_path}")
            return None

        # 2. 对上传视频重命名为规范化安全格式 (防止含有特殊路径字符)
        # 去掉空格和特殊字符，防止 URL 拼接后被手机浏览器转义导致无法播放
        safe_name = re.sub(r'[\s\[\]【】\(\)]', '_', rename_to)
        safe_name = re.sub(r'_+', '_', safe_name).strip('_')
        
        dir_name = os.path.dirname(local_path)
        new_local_path = os.path.join(dir_name, safe_name)
        os.rename(local_path, new_local_path)
        
        print(f"[GH-Release] 开始将规范重命名后的视频上传: {safe_name}")

        # 3. 创建 Release (如果不存在的话，notes 留空，--clobber 防止冲突)
        tag = "latest-videos"
        create_cmd = ["gh", "release", "create", tag, "--title", "云端点播番剧托管(请勿删除)", "--notes", "此处存放最近 14 天点播的番剧直链，Actions 会自动循环清理", "--repo", self.repo]
        # 即使已存在也会报错，直接忽略报错
        subprocess.run(create_cmd, capture_output=True)

        # 4. 调用 gh 命令行工具上传附件到指定 Release 中
        upload_cmd = ["gh", "release", "upload", tag, new_local_path, "--clobber", "--repo", self.repo]
        print(f"[GH-Release] 执行上传命令: {' '.join(upload_cmd)}")
        
        result = subprocess.run(upload_cmd, capture_output=True, text=True)
        if result.returncode == 0:
            # 5. 拼装 GitHub 官方高速 CDN 播放直链
            play_url = f"https://github.com/{self.repo}/releases/download/{tag}/{safe_name}"
            print(f"[GH-Release 成功] 视频直链: {play_url}")
            return play_url
        else:
            print(f"[GH-Release 失败] 退出码: {result.returncode}, 错误信息: {result.stderr}")
            return None

    def clean_old_releases_assets(self, retention_days=7):
        """
        扫描当前 Releases 下的 Assets，自动删除 7 天前上传的番剧附件，防止项目体积无限膨胀
        """
        tag = "latest-videos"
        view_cmd = ["gh", "release", "view", tag, "--json", "assets", "--repo", self.repo]
        print(f"[GH-Release 清理] 开始扫描 {tag} 中超过 {retention_days} 天的番剧附件...")
        
        try:
            result = subprocess.run(view_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"[GH-Release 清理] 获取 assets 列表失败: {result.stderr}")
                return
                
            data = json.loads(result.stdout)
            assets = data.get("assets", [])
            
            import datetime
            
            now = datetime.datetime.now(datetime.timezone.utc)
            deleted_count = 0
            
            for asset in assets:
                dt_str = asset["createdAt"].replace('Z', '+00:00')
                created_at = datetime.datetime.fromisoformat(dt_str)
                age = now - created_at
                
                if age.days >= retention_days:
                    asset_name = asset["name"]
                    print(f"[GH-Release 自动过期删除] 移除老番附件: {asset_name} (已存放 {age.days} 天)")
                    
                    delete_cmd = ["gh", "release", "delete-asset", tag, asset_name, "-y", "--repo", self.repo]
                    subprocess.run(delete_cmd, capture_output=True)
                    deleted_count += 1
            
            print(f"[GH-Release 清理完成] 共清理了 {deleted_count} 个过期视频")
        except Exception as e:
            print(f"[GH-Release 清理异常] 清理过期附件出错: {e}")

# ==========================================================================
# Aria2 命令行极速下载封装
# ==========================================================================
def run_aria2_download(download_url, download_dir):
    """调用 aria2c 进行种子直链/磁力下载"""
    os.makedirs(download_dir, exist_ok=True)
    dht_path = os.path.join(download_dir, "dht.dat")
    dht6_path = os.path.join(download_dir, "dht6.dat")
    
    # 提前在本地创建空文件占位，防止 Aria2 校验找不到文件抛出 exception 异常
    try:
        with open(dht_path, 'a') as f:
            pass
        with open(dht6_path, 'a') as f:
            pass
    except Exception as e:
        print(f"[警告] 预创 DHT 文件失败: {e}")

    cmd = [
        "aria2c",
        "--no-conf=true",                # 不读取系统配置，防止权限污染
        "--dht-file-path", dht_path,      # 将 DHT 路由表重定向到临时目录中
        "--dht-file-path6", dht6_path,
        "--seed-time=0",                 # 下载完成立即退出
        "--bt-stop-timeout=120",         # 2分钟无速度超时
        "--max-connection-per-server=16",
        "--split=16",
        "-d", download_dir,
        download_url
    ]
    print(f"[Aria2 启动] 命令: {' '.join(cmd)}")
    try:
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

    # 读取 Actions 内置的特权 GITHUB_TOKEN 与当前仓库名
    gh_token = os.environ.get("GITHUB_TOKEN")
    gh_repo = os.environ.get("GITHUB_REPOSITORY")

    if not gh_token or not gh_repo:
        print("[错误] 未能在环境变量中读取到 GITHUB_TOKEN 或 GITHUB_REPOSITORY")
        return

    # 初始化 GitHub Release 上传器
    uploader = GitHubReleaseUploader(gh_repo, gh_token)

    # 1. 判断启动模式
    payload_name = os.environ.get("PAYLOAD_NAME")
    payload_keyword = os.environ.get("PAYLOAD_KEYWORD")
    payload_torrent = os.environ.get("PAYLOAD_TORRENT")

    downloaded = []
    if os.path.exists(dl_path):
        try:
            with open(dl_path, 'r', encoding='utf-8') as f:
                downloaded = json.load(f)
        except Exception as e:
            print(f"[警告] 读取 downloaded.json 失败: {e}")

    # ==========================================================================
    # 核心优化：如果是点播模式，直接利用 GitHub Releases 闪电上传
    # ==========================================================================
    if payload_name and payload_torrent:
        print(f"[启动模式] 实时精确点播: 《{payload_name}》")
        print(f"[点播链接] {payload_torrent}")
        
        temp_download_dir = os.path.join(base_dir, "temp_aria2_downloads")
        if os.path.exists(temp_download_dir):
            import shutil
            shutil.rmtree(temp_download_dir)

        if run_aria2_download(payload_torrent, temp_download_dir):
            video_file = get_largest_video_file(temp_download_dir)
            if video_file:
                # 重新规划 Release 中的安全文件名 (防止含特殊符号导致下载失败)
                season, episode = parse_anime_title(payload_keyword or payload_name)
                ext = video_file.split('.')[-1].lower()
                safe_video_name = f"{payload_name}_{season}{episode}.{ext}"
                
                # 上传至本仓库 Releases
                play_url = uploader.upload_file(video_file, safe_video_name)
                if play_url:
                    import time
                    record = {
                        "title": payload_keyword or f"{payload_name} - {season}{episode}",
                        "link": payload_torrent,
                        "url": play_url,
                        "anime": payload_name,
                        "season": season,
                        "episode": episode,
                        "timestamp": int(time.time())
                    }
                    downloaded.insert(0, record)
                    
                    formatted_downloads = [d for d in downloaded if isinstance(d, dict)]
                    with open(dl_path, 'w', encoding='utf-8') as f:
                        json.dump(formatted_downloads, f, indent=2)
                    print(f"[完成] 点播视频已极速上传至本仓库 Release 附件中")
            import shutil
            shutil.rmtree(temp_download_dir)
            
        # 点播结束前自动执行 7 天过期文件清理
        uploader.clean_old_releases_assets(retention_days=7)
        return

    # 定时批量常驻订阅检测
    print("[启动模式] Cron 定时批量运行")
    if not os.path.exists(sub_path):
        print("[通知] 配置文件 subscription.json 缺失")
        return
    with open(sub_path, 'r', encoding='utf-8') as f:
        target_jobs = json.load(f)

    if not target_jobs:
        print("[通知] 订阅列表为空")
        return

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

    # 3. 定时匹配
    for item in items:
        title = item.find('title').text
        link = item.find('link').text
        enclosure_node = item.find('enclosure')
        torrent_link = enclosure_node.attrib.get('url') if enclosure_node is not None else link

        for job in target_jobs:
            if job['keyword'].lower() not in title.lower():
                continue
            if job.get('subgroup') and job['subgroup'].lower() not in title.lower():
                continue
            if job.get('quality') and job['quality'].lower() not in title.lower():
                continue

            already_downloaded = False
            for d in downloaded:
                if isinstance(d, dict) and (d.get("link") == torrent_link or d.get("link") == link):
                    already_downloaded = True
                    break
            
            if already_downloaded:
                continue

            season, episode = parse_anime_title(title)
            anime_name = job['name']
            
            print(f"\n[定时匹配成功] 下载番剧: {title}")
            temp_download_dir = os.path.join(base_dir, "temp_aria2_downloads")
            
            if os.path.exists(temp_download_dir):
                import shutil
                shutil.rmtree(temp_download_dir)

            if run_aria2_download(torrent_link, temp_download_dir):
                video_file = get_largest_video_file(temp_download_dir)
                if video_file:
                    ext = video_file.split('.')[-1].lower()
                    safe_video_name = f"{anime_name}_{season}{episode}.{ext}"
                    
                    play_url = uploader.upload_file(video_file, safe_video_name)
                    if play_url:
                        import time
                        record = {
                            "title": f"{anime_name} - {season}{episode}",
                            "link": torrent_link,
                            "url": play_url,
                            "anime": anime_name,
                            "season": season,
                            "episode": episode,
                            "timestamp": int(time.time())
                        }
                        downloaded.insert(0, record)
                        new_success_records.append(record)
                        
                import shutil
                shutil.rmtree(temp_download_dir)
                break

    # 4. 回写状态数据
    if new_success_records:
        formatted_downloads = [d for d in downloaded if isinstance(d, dict)]
        with open(dl_path, 'w', encoding='utf-8') as f:
            json.dump(formatted_downloads, f, indent=2)
        print(f"[完成] 本次共定时下载了 {len(new_success_records)} 个视频")

    # 5. 按照动漫大类聚合今日更新流，生成缓存最新资源列表
    anime_groups = {}
    for item in items:
        t_title = item.find('title').text
        t_link = item.find('link').text
        
        t_pubDate = ""
        torrent_node = item.find('{https://mikanani.me/0.1/}torrent')
        if torrent_node is not None:
            pub_date_node = torrent_node.find('{https://mikanani.me/0.1/}pubDate')
            t_pubDate = pub_date_node.text if pub_date_node is not None else ""
            
        t_enclosure = item.find('enclosure')
        t_downloadUrl = t_enclosure.attrib.get('url') if t_enclosure is not None else t_link
        
        t_season, t_episode = parse_anime_title(t_title)
        
        subgroup_match = re.search(r'\[(.*?(?:字幕组|字幕社|社|組|LoliHouse|Lilith-raws|Raw))\]', t_title, re.IGNORECASE)
        t_subgroup = subgroup_match.group(1) if subgroup_match else "其它"
        
        t_clean = t_title
        t_clean = re.sub(r'\[.*?\]|【.*?】', '', t_clean)
        t_clean = re.sub(r'\d+\s*(?:话|集|v|x|V\d+|v\d+|-\s*\d+).*', '', t_clean)
        t_clean = t_clean.strip(" -/\\")
        guess_name = t_clean[:25] if t_clean else "未分类新番"
        
        if guess_name not in anime_groups:
            anime_groups[guess_name] = {
                "anime": guess_name,
                "latest_time": t_pubDate,
                "episodes": []
            }
            
        anime_groups[guess_name]["episodes"].append({
            "title": t_title,
            "link": t_downloadUrl,
            "pubDate": t_pubDate,
            "season": t_season,
            "episode": t_episode,
            "subgroup": t_subgroup
        })

    latest_updates = list(anime_groups.values())[:45]
        
    latest_json_path = os.path.join(base_dir, "latest_rss.json")
    with open(latest_json_path, 'w', encoding='utf-8') as f:
        json.dump(latest_updates, f, indent=2, ensure_ascii=False)
    print(f"[最新发布流] 成功更新 latest_rss.json 共 {len(latest_updates)} 部动漫")

    # 执行 7 天过期文件清理
    uploader.clean_old_releases_assets(retention_days=7)

if __name__ == '__main__':
    main()

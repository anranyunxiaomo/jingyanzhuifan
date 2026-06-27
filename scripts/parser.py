#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import json
import urllib.parse
import xml.etree.ElementTree as ET
import requests

# ==========================================================================
# 百度网盘 API 封装
# ==========================================================================
class BaiduNetdisk:
    def __init__(self, client_id, client_secret, credentials_path):
        self.client_id = client_id
        self.client_secret = client_secret
        self.credentials_path = credentials_path
        self.access_token = ""
        self.refresh_token = ""
        self.load_credentials()

    def load_credentials(self):
        """从 JSON 文件加载凭证"""
        if os.path.exists(self.credentials_path):
            with open(self.credentials_path, 'r', encoding='utf-8') as f:
                creds = json.load(f)
                self.access_token = creds.get("access_token", "")
                self.refresh_token = creds.get("refresh_token", "")
        else:
            # 首次运行，需要从环境变量获取初始的 refresh_token
            self.refresh_token = os.environ.get("INITIAL_BAIDU_REFRESH_TOKEN", "")

    def save_credentials(self):
        """保存最新凭证到 JSON 文件"""
        with open(self.credentials_path, 'w', encoding='utf-8') as f:
            json.dump({
                "access_token": self.access_token,
                "refresh_token": self.refresh_token
            }, f, indent=2)

    def refresh_access_token(self):
        """使用 refresh_token 刷新 access_token"""
        if not self.refresh_token:
            print("[错误] 未找到百度 refresh_token，无法进行接口调用！")
            return False

        url = "https://openapi.baidu.com/oauth/2.0/token"
        params = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret
        }
        
        try:
            res = requests.get(url, params=params, timeout=15)
            data = res.json()
            if "access_token" in data:
                self.access_token = data["access_token"]
                self.refresh_token = data.get("refresh_token", self.refresh_token)
                self.save_credentials()
                print("[成功] 百度网盘 Access Token 刷新成功")
                return True
            else:
                print(f"[错误] 百度 Token 刷新失败: {data.get('error_description', data)}")
                return False
        except Exception as e:
            print(f"[异常] 刷新百度 Token 时出错: {e}")
            return False

    def add_offline_download(self, source_url, save_path):
        """添加云端离线下载任务"""
        url = "https://pan.baidu.com/rest/2.0/xpan/clouddl"
        params = {
            "method": "addtask",
            "access_token": self.access_token
        }
        data = {
            "source_url": source_url,
            "save_path": save_path
        }
        try:
            res = requests.post(url, params=params, data=data, timeout=15)
            res_data = res.json()
            if res_data.get("errno") == 0:
                print(f"[成功] 已成功向百度网盘提交离线下载任务: {source_url} -> {save_path}")
                return res_data.get("task_id")
            else:
                print(f"[错误] 添加离线任务失败，错误码 {res_data.get('errno')}: {res_data}")
                return None
        except Exception as e:
            print(f"[异常] 提交离线下载出错: {e}")
            return None

    def list_recent_tasks(self):
        """列出近期离线任务"""
        url = "https://pan.baidu.com/rest/2.0/xpan/clouddl"
        params = {
            "method": "listtask",
            "access_token": self.access_token,
            "need_task_info": 1
        }
        try:
            res = requests.get(url, params=params, timeout=15)
            data = res.json()
            if data.get("errno") == 0:
                return data.get("task_info", [])
            return []
        except Exception as e:
            print(f"[异常] 获取离线任务列表出错: {e}")
            return []

    def list_files(self, dir_path):
        """获取某个目录下的文件列表"""
        url = "https://pan.baidu.com/rest/2.0/xpan/file"
        params = {
            "method": "list",
            "access_token": self.access_token,
            "dir": dir_path
        }
        try:
            res = requests.get(url, params=params, timeout=15)
            data = res.json()
            if data.get("errno") == 0:
                return data.get("list", [])
            return []
        except Exception as e:
            print(f"[异常] 获取文件列表出错: {e}")
            return []

    def rename_file(self, old_path, new_name):
        """远程重命名文件"""
        url = "https://pan.baidu.com/rest/2.0/xpan/file"
        params = {
            "method": "filemanager",
            "access_token": self.access_token
        }
        # filelist 为 JSON String 的 Array 格式
        filelist = json.dumps([{"path": old_path, "newname": new_name}])
        data = {
            "opera": "rename",
            "filelist": filelist
        }
        try:
            res = requests.post(url, params=params, data=data, timeout=15)
            res_data = res.json()
            if res_data.get("errno") == 0:
                print(f"[成功] 远程重命名完成: {old_path} -> {new_name}")
                return True
            print(f"[错误] 远程重命名失败，错误码 {res_data.get('errno')}: {res_data}")
            return False
        except Exception as e:
            print(f"[异常] 远程重命名出错: {e}")
            return False

# ==========================================================================
# 动漫元数据提取规则 (标题解析器)
# ==========================================================================
def parse_anime_title(title):
    """
    通过正则从种子标题中智能提取番剧季度和集数。
    返回: (season_str, episode_str, clean_title)
    示例: "[桜都字幕组] Lycoris Recoil 莉可丽丝 [05][1080p]" -> ("S01", "E05", "Lycoris Recoil 莉可丽丝")
    """
    season = "S01"  # 默认第 1 季
    episode = "E01" # 默认第 1 集

    # 1. 尝试提取季度
    season_patterns = [
        r'(?:Season\s*|S)(\d+)',        # Season 2 / S2 / S02
        r'第\s*(\d+|[一二三四五六七八九十])\s*季'  # 第二季 / 第2季
    ]
    for p in season_patterns:
        match = re.search(p, title, re.IGNORECASE)
        if match:
            s_num = match.group(1)
            # 处理中文数字转阿拉伯数字
            cn_map = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
            if s_num in cn_map:
                s_val = cn_map[s_num]
            else:
                s_val = int(s_num)
            season = f"S{s_val:02d}"
            break

    # 2. 尝试提取集数
    # 常用格式: [05], - 05, 第05话, Ep 05
    episode_patterns = [
        r'\[(\d+)\]',                    # [05] or [05v2]
        r'(?:EP|Ep|Episode|第)\s*(\d+)\s*(?:话|集|v|x|\s)', # EP05, 第05话
        r'\s+-\s+(\d+)\s+',              # - 05
        r'\s+(\d+)\s+(?:1080[pP]|720[pP])', # 05 1080p
        r'[^0-9](\d{2})[^0-9]'           # 纯两位数
    ]
    
    for p in episode_patterns:
        match = re.search(p, title)
        if match:
            ep_val = int(match.group(1))
            # 排除年份（比如2022年、1080等分辨率）
            if ep_val < 100:
                episode = f"E{ep_val:02d}"
                break

    return season, episode

# ==========================================================================
# 核心控制逻辑
# ==========================================================================
def main():
    # 文件路径定义
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sub_path = os.path.join(base_dir, "subscription.json")
    dl_path = os.path.join(base_dir, "downloaded.json")
    creds_path = os.path.join(base_dir, "baidu_credentials.json")

    # 1. 验证环境变量
    client_id = os.environ.get("BAIDU_CLIENT_ID")
    client_secret = os.environ.get("BAIDU_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        print("[错误] 缺少环境变量 BAIDU_CLIENT_ID 或 BAIDU_CLIENT_SECRET")
        return

    # 2. 加载订阅与已下载状态
    if not os.path.exists(sub_path):
        print("[通知] 订阅列表 subscription.json 为空，Actions 退出")
        return

    with open(sub_path, 'r', encoding='utf-8') as f:
        subscriptions = json.load(f)

    downloaded = []
    if os.path.exists(dl_path):
        with open(dl_path, 'r', encoding='utf-8') as f:
            downloaded = json.load(f)

    if not subscriptions:
        print("[通知] 没有有效的订阅配置，任务结束")
        return

    # 3. 初始化百度网盘并刷新 Token
    bd = BaiduNetdisk(client_id, client_secret, creds_path)
    if not bd.refresh_access_token():
        print("[错误] 百度授权刷新失败，中断任务")
        return

    # 4. 获取最新的 Mikan 经典 RSS 源
    # mikan 经典源地址，包含近期所有更新
    rss_url = "https://mikanani.me/RSS/Classic"
    print(f"[通知] 开始拉取 RSS 源: {rss_url}")
    
    try:
        res = requests.get(rss_url, timeout=20)
        res.raise_for_status()
        xml_content = res.content
    except Exception as e:
        print(f"[错误] 拉取 RSS 失败: {e}")
        return

    # 5. 解析 RSS 过滤匹配
    try:
        root = ET.fromstring(xml_content)
        items = root.findall('.//item')
    except Exception as e:
        print(f"[错误] 解析 XML 失败: {e}")
        return

    print(f"[通知] 成功解析出 {len(items)} 条种子资源")

    # 用于保存本次新下任务的记录，以便最终更新 downloaded.json
    new_downloads = []

    # 6. 对每条 RSS 种子资源执行过滤与推送
    for item in items:
        title = item.find('title').text
        link = item.find('link').text # 磁力链接

        # 遍历订阅规则
        for sub in subscriptions:
            # 校验规则 1: 必须包含匹配关键字
            if sub['keyword'].lower() not in title.lower():
                continue

            # 校验规则 2: 字幕组限制 (若配置了字幕组)
            if sub.get('subgroup') and sub['subgroup'].lower() not in title.lower():
                continue

            # 校验规则 3: 分辨率限制 (如 1080p)
            if sub.get('quality') and sub['quality'].lower() not in title.lower():
                continue

            # 校验规则 4: 重复下载检测
            # 种子链接作为唯一标示
            if link in downloaded:
                continue

            # 匹配成功！提取元数据
            season, episode = parse_anime_title(title)
            anime_name = sub['name']
            
            # 建立规范目录: /apps/AutoBangumi/番剧名称/Season X
            save_path = f"/apps/AutoBangumi/{anime_name}/{season}"
            
            print(f"[匹配成功] 发现新番: {title}")
            print(f"         提取元数据: 季度={season}, 集数={episode}")
            
            # 推送百度网盘离线下载
            task_id = bd.add_offline_download(link, save_path)
            if task_id:
                # 记录已下载，避免重复推送
                downloaded.append(link)
                new_downloads.append({
                    "title": title,
                    "link": link,
                    "anime": anime_name,
                    "season": season,
                    "episode": episode,
                    "save_path": save_path
                })
                break # 该种子已被推送下载，跳出订阅循环

    # 保存新的下载记录
    if new_downloads:
        with open(dl_path, 'w', encoding='utf-8') as f:
            json.dump(downloaded, f, indent=2)
        print(f"[完成] 本次共推送了 {len(new_downloads)} 个下载任务")
    else:
        print("[完成] 未发现满足订阅条件的新资源")

    # ==========================================================================
    # 7. 远程监控百度网盘已完成离线，并自动执行远程重命名 (Anti-Slop 整理)
    # ==========================================================================
    print("[开始] 扫描近期百度网盘离线下载完成文件，执行远程整理...")
    recent_tasks = bd.list_recent_tasks()
    
    # 查找状态为“1”(即下载完成) 且在我们管理目录下的任务
    for task in recent_tasks:
        if task.get("status") == 1 and "/apps/AutoBangumi/" in task.get("save_path", ""):
            save_path = task.get("save_path")
            
            # 获取该离线任务下载完的文件列表
            files = bd.list_files(save_path)
            
            for f in files:
                old_name = f.get("server_filename")
                old_path = f.get("path")
                
                # 如果文件是视频，且名字中包含常见字幕组特征（代表未重命名）
                # 规范后的名字应该类似 "番剧名 - S01E05.mp4"
                if f.get("isdir") == 0 and ("[" in old_name or "【" in old_name or "字幕组" in old_name or len(old_name) > 30):
                    # 从原文件名中再次计算番剧元数据以做高精度重命名
                    # 比如从 "/apps/AutoBangumi/莉可丽丝/S01" 可以通过路径拿到 "莉可丽丝" 和 "S01"
                    path_parts = save_path.strip("/").split("/")
                    if len(path_parts) >= 3:
                        anime_name = path_parts[2] # "莉可丽丝"
                        season_str = path_parts[3] if len(path_parts) > 3 else "S01" # "S01"
                        
                        # 重新提取集数
                        _, episode_str = parse_anime_title(old_name)
                        
                        # 保持原有视频扩展名
                        ext = old_name.split('.')[-1].lower()
                        new_name = f"{anime_name} - {season_str}{episode_str}.{ext}"
                        
                        # 确保新名不等于老名，然后发送重命名指令
                        if old_name != new_name:
                            print(f"[整理重命名] 检测到下载完成视频: {old_name}")
                            bd.rename_file(old_path, new_name)

if __name__ == '__main__':
    main()

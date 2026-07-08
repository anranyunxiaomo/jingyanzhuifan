#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全局动漫数据线上对齐与强力分类清洗脚本
==================================
1. 扫描本地 data/detail/ 下所有的 690+ 个动漫详情 JSON 文件。
2. 对数据进行普查：如果 tags、plot、area 有所缺失，联网向 AGE 官方 API 触发拉取回填。
3. 应用最严格的:
   - is_kids_anime (少儿低幼过滤)
   - is_sensitive_anime (黄色敏感过滤)
   - is_unwanted_area_anime (只限国日动漫，白名单控制)
4. 一旦被判定违规或不满足国日动漫业务，直接物理 os.remove() 物理粉碎，确保全库绝对准确纯净！
"""

import os
import sys
import json
import time
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 设置基础目录
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')

# 将根目录加入 python 搜索路径以方便导入 update_data 逻辑
sys.path.append(BASE_DIR)
try:
    from update_data import is_kids_anime, is_sensitive_anime, is_unwanted_area_anime, session, API_BASE
except ImportError:
    print("[ERROR] Failed to import filters from update_data.py. Please run from project structure.")
    sys.exit(1)

def request_detail_api(aid):
    """通过云端代理或者直连请求详情 API"""
    target_url = f"{API_BASE.rstrip('/')}/detail/{aid}"
    encoded_url = requests.utils.quote(target_url, safe='')
    proxy_url = f"https://jingyanff.xyz/?url={encoded_url}"
    
    for retry in range(3):
        try:
            r = session.get(proxy_url, timeout=15)
            if r.status_code == 200:
                data = r.json()
                if data and isinstance(data, dict):
                    return data.get("data")
            elif r.status_code == 429:
                print(f"  [429 RATELIMIT] 遇到 429 频限，执行 2.5s 指数退避延时...")
                time.sleep(2.5)
            else:
                print(f"  [RETRY {retry+1}] API returned status {r.status_code}")
        except Exception as e:
            print(f"  [RETRY {retry+1}] Connection error: {e}")
            # 直连备用
            try:
                r_direct = session.get(target_url, timeout=12)
                if r_direct.status_code == 200:
                    data = r_direct.json()
                    if data and isinstance(data, dict):
                        return data.get("data")
                elif r_direct.status_code == 429:
                    time.sleep(2.5)
            except Exception:
                pass
        time.sleep(0.5)
    return None

def main():
    print("[START] 开始进行全局动漫详情数据普查与强力清洗...")
    if not os.path.exists(DETAIL_DIR):
        print(f"[ERROR] 详情目录 {DETAIL_DIR} 不存在！")
        return

    files = [f for f in os.listdir(DETAIL_DIR) if f.endswith(".json")]
    total_files = len(files)
    print(f"[INFO] 扫描到本地详情 JSON 文件共计: {total_files} 个。")
    
    cleaned_count = 0
    refetched_count = 0
    
    for idx, filename in enumerate(files, 1):
        aid_str = filename[:-5]
        file_path = os.path.join(DETAIL_DIR, filename)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                detail = json.load(f)
        except Exception as read_err:
            print(f"[{idx}/{total_files}] [SKIP] 无法读取文件 {filename}: {read_err}")
            continue
            
        video = detail.get("video", {})
        title = video.get("name", "")
        plot = video.get("plot", "")
        tags = video.get("tags", "")
        area = video.get("area", "")
        
        # 💡 数据线上普查与回填：如果发现 tags, plot, area 字段存在任意一个为空
        if not tags or not plot or not area:
            print(f"[{idx}/{total_files}] 发现数据缺失: {title} ({aid_str}) - tags: {bool(tags)}, plot: {bool(plot)}, area: {bool(area)}")
            # 联网拉取最新详情进行回填
            online_data = request_detail_api(aid_str)
            if online_data:
                online_video = online_data.get("video", {})
                if online_video:
                    plot = online_video.get("plot", plot)
                    tags = online_video.get("tags", tags)
                    area = online_video.get("area", area)
                    
                    # 回填写入本地详情 JSON
                    detail["video"]["plot"] = plot
                    detail["video"]["tags"] = tags
                    detail["video"]["area"] = area
                    
                    try:
                        with open(file_path, 'w', encoding='utf-8') as fw:
                            json.dump(detail, fw, ensure_ascii=False, indent=2)
                        refetched_count += 1
                        print(f"  [REFETCHED] 成功在线回填详情字段: {title}")
                    except Exception as write_err:
                        print(f"  [WARNING] 无法更新回填本地详情: {write_err}")
            time.sleep(1.2) # 友好防刷间隔，避免频限 429
            
        # 💡 执行高压拦截匹配
        is_sensitive = is_sensitive_anime(title, plot, tags)
        is_kids = is_kids_anime(title, plot, tags)
        is_unwanted_area = is_unwanted_area_anime(title, area, plot, tags)
        
        if is_sensitive or is_kids or is_unwanted_area:
            reason = []
            if is_sensitive: reason.append("敏感")
            if is_kids: reason.append("低幼少儿")
            if is_unwanted_area: reason.append(f"非国日海外源({area})")
            
            reason_str = "+".join(reason)
            try:
                os.remove(file_path)
                cleaned_count += 1
                print(f"[{idx}/{total_files}] 🚨 [CLEANED] 物理粉碎不合格动漫 JSON: {filename} ({title}) [原因: {reason_str}]")
            except Exception as del_err:
                print(f"[{idx}/{total_files}] [ERROR] 无法物理删除 {filename}: {del_err}")
                
    print("\n" + "="*50)
    print(f"[FINISHED] 全局动漫大清洗任务执行完毕！")
    print(f"📊 普查文件总数: {total_files}")
    print(f"🔄 线上拉取回填文件数: {refetched_count}")
    print(f"🚨 物理清理删除不合格动漫数: {cleaned_count}")
    print("="*50 + "\n")

if __name__ == "__main__":
    main()

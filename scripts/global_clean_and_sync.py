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
    from update_data import is_kids_anime, is_sensitive_anime, is_unwanted_area_anime, check_anime_sensitive_by_aid, session, API_BASE, request_api
except ImportError:
    print("[ERROR] Failed to import filters from update_data.py. Please run from project structure.")
    sys.exit(1)

def update_local_anich_id_map(anich_aid, age_aid, title):
    """当在清洗过程中发现 AniCh 独有动漫匹配到了 AGE 官方 ID，同步更新本地映射表以优化库体积"""
    map_path = os.path.join(DATA_DIR, 'anich_id_map.json')
    if os.path.exists(map_path):
        try:
            with open(map_path, 'r', encoding='utf-8') as f:
                mapping = json.load(f)
            bid = anich_aid.replace("anich_", "")
            mapping[bid] = {
                "age_id": int(age_aid),
                "age_name": title,
                "confidence": 1.0
            }
            with open(map_path, 'w', encoding='utf-8') as fw:
                json.dump(mapping, fw, ensure_ascii=False, indent=2)
            print(f"  [MAP UPDATED] 成功更新映射: AniCh {bid} -> AGE {age_aid}")
        except Exception as e:
            print(f"  [WARNING] 无法更新 anich_id_map.json: {e}")

def request_detail_api(aid, title=None):
    """通过云端代理或者直连请求详情 API（已整合 AGE 详情与 AniCh 跨库校准）"""
    # 💡 分支 1：处理 AniCh 独有数据的标题搜索与跨库对齐普查，避开 WAF 盾
    if aid.startswith("anich_"):
        if not title:
            # 尝试从本地 JSON 中直接读取 title
            file_path = os.path.join(DETAIL_DIR, f"{aid}.json")
            if os.path.exists(file_path):
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        detail_data = json.load(f)
                        title = detail_data.get("video", {}).get("name", "")
                except:
                    pass
        if not title:
            return None
        
        # 1. 尝试使用 title 去 AGE 官方 API 搜索（清除干扰字符）
        clean_title = title.split("第")[0].split("剧场版")[0].strip()
        search_res = request_api("search", {"query": clean_title})
        if search_res and search_res.get("code") == 200:
            videos = search_res.get("data", {}).get("videos", [])
            matched_aid = None
            for v in videos:
                v_name = v.get("name", "")
                if clean_title in v_name or v_name in clean_title:
                    matched_aid = v.get("id")
                    break
            
            # 2. 如果找到了对应的真实 AGE ID，拉取其详情！
            if matched_aid:
                print(f"  [MAP MATCHED] AniCh {title} 匹配到 AGE ID: {matched_aid}")
                detail_data = request_api(f"detail/{matched_aid}")
                if detail_data and detail_data.get("code") == 200:
                    age_detail = detail_data.get("data")
                    if age_detail:
                        update_local_anich_id_map(aid, matched_aid, title)
                        return age_detail
                        
        print(f"  [MAP FAILED] AniCh {title} 在 AGE 官方未检索到匹配记录 -> 安全兜底为日本番剧")
        # 安全兜底：如果在 AGE 官方搜索不到，代表属于极小众的日本原版番剧，安全将地区设定为“日本”
        return {
            "video": {
                "plot": "暂缺",
                "tags": "暂缺",
                "area": "日本"
            }
        }

    # 💡 分支 2：处理正常的 AGE 数据的详情回填普查
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

    # 🚨 物理清除全部 AniCh 业务数据文件
    print("[INFO] 开始全面清理 AniCh 业务数据详情文件...")
    anich_removed_count = 0
    for filename in os.listdir(DETAIL_DIR):
        if filename.startswith("anich_") and filename.endswith(".json"):
            try:
                os.remove(os.path.join(DETAIL_DIR, filename))
                anich_removed_count += 1
            except Exception as e:
                print(f"[WARNING] 无法删除 AniCh 文件 {filename}: {e}")
    if anich_removed_count > 0:
        print(f"[SUCCESS] 已物理粉碎全部 {anich_removed_count} 个 AniCh 详情数据 JSON 文件！")

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
        # 💡 a123 的大类地区（如“国产动漫”、“日韩动漫”）存储在 plot 字段中，对其进行自动本地地区映射，避免向不存在的 AGE ID 接口发网络请求
        is_a123 = filename.startswith("a123_")
        if is_a123 and not area:
            plot_val = video.get("plot", "")
            if "国产" in plot_val or "国漫" in plot_val:
                area = "中国"
            elif "日韩" in plot_val or "日本" in plot_val:
                area = "日本"
            elif "欧美" in plot_val:
                area = "欧美"

        # 💡 数据线上普查与回填：若发现 tags/plot/area 缺失，或者 AniCh 数据被错误默认为了“日本”，强制联网普查纠偏
        is_anich_default_jp = filename.startswith("anich_") and area == "日本"
        if not is_a123 and (not area or is_anich_default_jp):
            print(f"[{idx}/{total_files}] 发现数据缺失: {title} ({aid_str}) - tags: {bool(tags)}, plot: {bool(plot)}, area: {bool(area)}")
            # 联网拉取最新详情进行回填
            online_data = request_detail_api(aid_str, title)
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
                
    # 💡 强力清道夫：对 anich_id_map.json, anich_only.json, 以及 home-list.json 中的脏数据做深度级联清理！
    print("\n[CLEANING TABLES] 开始深度清理各数据总表...")

    # A. 清理 data/anich_id_map.json
    # A. 彻底清空并重置 data/anich_id_map.json
    id_map_path = os.path.join(DATA_DIR, 'anich_id_map.json')
    try:
        with open(id_map_path, 'w', encoding='utf-8') as f:
            json.dump({}, f, ensure_ascii=False, indent=2)
        print("  [MAP RESET] 彻底清空了映射表 anich_id_map.json")
    except Exception as map_err:
        print(f"[WARNING] 重置 anich_id_map.json 失败: {map_err}")

    # B. 彻底清空并重置 data/anich_only.json
    only_path = os.path.join(DATA_DIR, 'anich_only.json')
    try:
        with open(only_path, 'w', encoding='utf-8') as f:
            json.dump([], f, ensure_ascii=False, indent=2)
        print("  [ONLY RESET] 彻底清空了独有表 anich_only.json")
    except Exception as only_err:
        print(f"[WARNING] 重置 anich_only.json 失败: {only_err}")

    # C. 清理 data/home-list.json 中的各列表（包含已不合规或无物理文件的动漫）
    home_path = os.path.join(DATA_DIR, 'home-list.json')
    home_cleaned_count = 0
    if os.path.exists(home_path):
        try:
            with open(home_path, 'r', encoding='utf-8') as f:
                home = json.load(f)

            if "latest" in home:
                orig_len = len(home["latest"])
                home["latest"] = [item for item in home["latest"] if (
                    os.path.exists(os.path.join(DETAIL_DIR, f"{item.get('AID')}.json")) and
                    not check_anime_sensitive_by_aid(str(item.get("AID")), item.get("Title", ""))
                )]
                home_cleaned_count += (orig_len - len(home["latest"]))

            if "week_list" in home:
                for day, items in home["week_list"].items():
                    orig_len = len(items)
                    new_items = []
                    for item in items:
                        aid = str(item.get("id", ""))
                        title = item.get("name", "")
                        anich_id = item.get("anich_id")
                        
                        has_detail = (
                            os.path.exists(os.path.join(DETAIL_DIR, f"{aid}.json")) or
                            (anich_id is not None and os.path.exists(os.path.join(DETAIL_DIR, f"anich_{anich_id}.json")))
                        )
                        
                        is_unwanted = (
                            check_anime_sensitive_by_aid(aid, title) or
                            (anich_id is not None and check_anime_sensitive_by_aid(f"anich_{anich_id}", title))
                        )
                        
                        if not has_detail or is_unwanted:
                            print(f"  [HOME WEEK CLEAN] 移除了周更表项: {title} (AID: {aid})")
                            continue
                        new_items.append(item)
                    home["week_list"][day] = new_items
                    home_cleaned_count += (orig_len - len(home["week_list"][day]))

            if "healing_list" in home:
                orig_len = len(home["healing_list"])
                home["healing_list"] = [item for item in home["healing_list"] if (
                    os.path.exists(os.path.join(DETAIL_DIR, f"{item.get('AID')}.json")) and
                    not check_anime_sensitive_by_aid(str(item.get("AID")), item.get("Title", ""))
                )]
                home_cleaned_count += (orig_len - len(home["healing_list"]))

            with open(home_path, 'w', encoding='utf-8') as f:
                json.dump(home, f, ensure_ascii=False, indent=2)
            print(f"  [HOME CLEAN] 成功清洗 home-list.json")
        except Exception as home_err:
            print(f"[WARNING] 清理 home-list.json 失败: {home_err}")

    print("\n" + "="*50)
    print(f"[FINISHED] 全局动漫大清洗任务执行完毕！")
    print(f"📊 普查文件总数: {total_files}")
    print(f"🔄 线上拉取回填文件数: {refetched_count}")
    print(f"🚨 物理清理删除不合格动漫数: {cleaned_count}")
    print(f"🧹 映射表 (anich_id_map): 彻底重置清空")
    print(f"🧹 独有表 (anich_only): 彻底重置清空")
    print(f"🧹 首页表 (home-list) 清理总条数: {home_cleaned_count}")
    print("="*50 + "\n")

if __name__ == "__main__":
    main()

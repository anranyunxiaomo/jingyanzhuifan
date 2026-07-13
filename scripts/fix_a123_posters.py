import os
import json
import sys
import time

# 设置基础目录
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')

# 引入 request_api
sys.path.append(BASE_DIR)
try:
    from update_data import request_api
except ImportError:
    print("[ERROR] Failed to import request_api from update_data.py")
    sys.exit(1)

def fix_posters():
    print("[START] 开始进行 a123 失效海报跨库对齐与深度纠偏...")
    if not os.path.exists(DETAIL_DIR):
        print("[ERROR] 详情目录不存在")
        return
        
    files = [f for f in os.listdir(DETAIL_DIR) if f.endswith(".json")]
    
    # 1. 建立本地 AGE 官方番剧库的标题 -> 海报映射
    local_age_covers = {}
    for filename in files:
        if not filename.startswith("a123_") and not filename.startswith("anich_"):
            file_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    detail = json.load(f)
                video = detail.get("video", {})
                name = video.get("name")
                cover = video.get("cover")
                if name and cover and "aqdstatic" in cover:
                    # 记录名字对应的最新 AGE 官方有效海报
                    local_age_covers[name.strip()] = cover
            except:
                pass
    print(f"[INFO] 本地缓存建立成功，收集到 {len(local_age_covers)} 个 AGE 官方海报映射。")
    
    # 2. 遍历 a123 详情文件进行纠偏
    local_matched = 0
    online_matched = 0
    failed_matched = 0
    
    for filename in files:
        if filename.startswith("a123_"):
            file_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    detail = json.load(f)
                video = detail.get("video", {})
                title = video.get("name", "").strip()
                cover = video.get("cover", "")
                
                # 只有当 cover 为空或者包含 a123tv 失效域名时才进行替换
                if not cover or "a123tv" in cover:
                    # A. 优先从本地模糊对齐映射回填
                    matched_local_cover = None
                    clean_title = title.replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
                    
                    # 💡 强力后缀清洗（如“第二季”、“第二期”等常见季数后缀，增加对齐几率）
                    import re
                    clean_title = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', clean_title, flags=re.IGNORECASE).strip()
                    
                    for name_key, cover_val in local_age_covers.items():
                        clean_name_key = name_key.replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
                        clean_name_key = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', clean_name_key, flags=re.IGNORECASE).strip()
                        
                        if clean_title and clean_name_key and (clean_title in clean_name_key or clean_name_key in clean_title):
                            matched_local_cover = cover_val
                            break
                            
                    if matched_local_cover:
                        video["cover"] = matched_local_cover
                        detail["video"] = video
                        with open(file_path, 'w', encoding='utf-8') as fw:
                            json.dump(detail, fw, ensure_ascii=False, indent=2)
                        local_matched += 1
                        print(f"  [LOCAL MATCH] 成功本地模糊对齐海报: {title} -> {video['cover']}")
                    else:
                        # B. 本地无缓存，联网去 AGE 检索
                        # 💡 联网搜索依然使用无后缀、无空格的归一化标题
                        search_title = title.replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
                        search_title = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', search_title, flags=re.IGNORECASE).strip()
                        
                        search_res = request_api("search", {"query": search_title})
                        matched_cover = None
                        if search_res and search_res.get("code") == 200:
                            videos = search_res.get("data", {}).get("videos", [])
                            for v in videos:
                                v_name = v.get("name", "").replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
                                clean_v_name = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', v_name, flags=re.IGNORECASE).strip()
                                
                                if search_title and clean_v_name and (search_title in clean_v_name or clean_v_name in search_title):
                                    matched_cover = v.get("cover")
                                    break
                        if matched_cover:
                            video["cover"] = matched_cover
                            detail["video"] = video
                            with open(file_path, 'w', encoding='utf-8') as fw:
                                json.dump(detail, fw, ensure_ascii=False, indent=2)
                            online_matched += 1
                            print(f"  [ONLINE MATCH] 联网对齐海报成功: {title} -> {matched_cover}")
                        else:
                            failed_matched += 1
                            print(f"  [FAILED] 无法找到 {title} 的可用海报图片")
                        time.sleep(1.0) # 延迟防频限
            except Exception as e:
                print(f"[WARN] 无法处理文件 {filename}: {e}")
                
    print("\n" + "="*50)
    print("[FINISHED] a123 失效海报深度修复任务完成！")
    print(f"✅ 本地缓存回填对齐数: {local_matched}")
    print(f"🌐 联网搜索对齐回填数: {online_matched}")
    print(f"❌ 检索失败数: {failed_matched}")
    print("="*50 + "\n")

if __name__ == '__main__':
    fix_posters()

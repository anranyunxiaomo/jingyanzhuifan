import os
import json
import re
import time
import subprocess
import urllib.parse

# 路径设置
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')

def curl_bgm_json(url):
    """通过带有 -k 绕过 SSL 验证的 curl 请求 Bangumi API"""
    cmd = [
        "curl",
        "-s",
        "-k", # 绕过 SSL 证书验证，避免 TLS connection 35 报错
        "-H", "User-Agent: test-agent (github.com/anranyunxiaomo)",
        url
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
        if res.returncode == 0 and res.stdout.strip():
            return json.loads(res.stdout)
    except Exception as e:
        print(f"    [BGM CURL ERROR] {e}")
    return None

def search_bangumi(keyword):
    """搜索 Bangumi 上的动漫项目"""
    encoded = urllib.parse.quote(keyword)
    url = f"https://api.bgm.tv/search/subject/{encoded}?type=2"
    
    data = curl_bgm_json(url)
    if data and "list" in data and len(data["list"]) > 0:
        return data["list"][0]["id"]
    return None

def get_bangumi_detail(subject_id):
    """获取 Bangumi 动漫详细信息"""
    url = f"https://api.bgm.tv/v0/subjects/{subject_id}"
    return curl_bgm_json(url)

def fill_all_from_bangumi():
    print("[START] 开启 Bangumi.tv 二次元终极元数据普查与修补回填...")
    
    files = [f for f in os.listdir(DETAIL_DIR) if f.endswith(".json")]
    
    missing_count = 0
    repaired_count = 0
    
    for filename in files:
        file_path = os.path.join(DETAIL_DIR, filename)
        try:
            if not os.path.exists(file_path):
                continue
                
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            video = data.get("video", {})
            title = video.get("name", "").strip()
            
            # 判断是否仍然缺乏关键数据或封面是旧 a123 链接
            has_year = bool(video.get("year"))
            has_writer = bool(video.get("writer"))
            has_tags = bool(video.get("tags"))
            has_plot = bool(video.get("plot"))
            
            if not title:
                continue
                
            # 如果任何元数据有空缺，或者封面依然在 a123tv.com 破图上，触发 Bangumi 终极回填！
            if has_year and has_writer and has_tags and has_plot and "a123tv" not in video.get("cover", ""):
                continue
                
            missing_count += 1
            print(f"🔍 正在 Bangumi.tv 检索: {title} ...")
            
            # 干净化标题，去掉尾部的“第几季”或年份等修饰词，保证 Bangumi 精准模糊匹配
            clean_title = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', title, flags=re.IGNORECASE).strip()
            
            # 针对译名进行小微调
            if clean_title == "公主大人，接下来是“拷问”时间":
                clean_title = "公主大人，接下来是拷问时间"
            
            subject_id = search_bangumi(clean_title)
            if not subject_id and len(clean_title) > 6:
                # 尝试再次截短搜索
                subject_id = search_bangumi(clean_title[:6])
                
            if subject_id:
                detail = get_bangumi_detail(subject_id)
                if detail:
                    # 1. 提取年份
                    air_date = detail.get("date", "")
                    year = air_date.split("-")[0] if air_date else ""
                    
                    # 2. 提取简介
                    plot = detail.get("summary", "").strip()
                    plot = re.sub(r'[\r\n]+', ' ', plot)
                    plot = re.sub(r'\s+', ' ', plot)
                    
                    # 3. 提取原作者/导演
                    writer = "暂无"
                    infobox = detail.get("infobox", [])
                    for info in infobox:
                        key = info.get("key", "")
                        value = info.get("value", "")
                        if key == "原作":
                            if isinstance(value, list):
                                writer = value[0].get("v", "") if value else "暂无"
                            else:
                                writer = str(value)
                            break
                    if writer == "暂无":
                        for info in infobox:
                            key = info.get("key", "")
                            value = info.get("value", "")
                            if key in ["导演", "监督"]:
                                if isinstance(value, list):
                                    writer = value[0].get("v", "") if value else "暂无"
                                else:
                                    writer = str(value)
                                break
                                
                    # 4. 提取标签 (取前 4 个)
                    tags_data = detail.get("tags", [])
                    tags_list = [t.get("name", "") for t in tags_data[:4] if t.get("name", "")]
                    tags = " ".join(tags_list)
                    
                    # 5. 提取海报大图
                    cover = detail.get("images", {}).get("large", "")
                    
                    # 注入回填
                    video["year"] = video.get("year") or year or "2026"
                    video["writer"] = video.get("writer") or writer
                    video["tags"] = video.get("tags") or tags
                    video["plot"] = video.get("plot") or plot
                    video["area"] = "日本"
                    if video["plot"]:
                        video["plot_arr"] = [p.strip() for p in video["plot"].split() if p.strip()]
                        
                    if ("a123tv" in video.get("cover", "") or not video.get("cover")) and cover:
                        video["cover"] = cover
                        
                    data["video"] = video
                    with open(file_path, 'w', encoding='utf-8') as fw:
                        json.dump(data, fw, ensure_ascii=False, indent=2)
                        
                    repaired_count += 1
                    print(f"  [BGM SUCCESS] 成功补全元数据: {title} (Year: {video['year']}, Writer: {video['writer']})")
                else:
                    print(f"  [BGM FAILED] 获取详情为空: {title} (ID: {subject_id})")
            else:
                print(f"  [BGM FAILED] 无法在 Bangumi 搜到匹配的项目: {title}")
                
            time.sleep(1.0) # 延迟，防频避让
            
        except Exception as e:
            print(f"  [ERROR] 处理 {filename} 失败: {e}")
            
    print("\n" + "="*50)
    print("[FINISHED] Bangumi 元数据大修补任务执行完毕！")
    print(f"📊 扫描需补全动漫数: {missing_count}")
    print(f"✅ 成功补全修复数: {repaired_count}")
    print("="*50 + "\n")

if __name__ == '__main__':
    fill_all_from_bangumi()

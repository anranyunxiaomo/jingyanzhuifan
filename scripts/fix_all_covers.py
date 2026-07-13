import os
import json
import re
import time
import subprocess
import urllib.parse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')

def get_bangumi_cover(title):
    """通过 Bangumi 接口模糊检索并返回免防盗链的高清封面大图"""
    # 清洗掉标题末尾的多余季数、剧集标识，提升模糊匹配率
    clean_kw = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+|国语版|日语版|中字|日语)$', '', title, flags=re.IGNORECASE).strip()
    if not clean_kw:
        clean_kw = title
        
    encoded = urllib.parse.quote(clean_kw)
    url = f"https://api.bgm.tv/search/subject/{encoded}?type=2"
    
    cmd = [
        "curl", "-s", "-k",
        "-H", "User-Agent: test-agent-covers (github.com/anranyunxiaomo)",
        url
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip():
            data = json.loads(res.stdout)
            if data and "list" in data and len(data["list"]) > 0:
                cover = data["list"][0].get("images", {}).get("large", "")
                if cover:
                    return cover
    except Exception as e:
        print(f"      [BGM ERROR] curl search failed for {title}: {e}")
    return None

def is_blocked_cover(cover_url):
    """判断封面 URL 是否属于会被防盗链拦截的域名或属于空数据"""
    if not cover_url or not isinstance(cover_url, str):
        return True
        
    cover_url = cover_url.lower()
    
    # 好好看、可可影视、a123、agefans、zyxpedu 等带有防盗链的图片 CDN
    blocked_patterns = [
        "hhkan", "kekys", "a123", "agefans", "zyxpedu", 
        "mianyangvip", "shiguangji", "cdndefend", "images.search",
        "vod1/vod", "upload/vod"
    ]
    for pattern in blocked_patterns:
        if pattern in cover_url:
            return True
            
    # 如果不是以 http/https 开头的相对路径，也视为无效防盗链
    if not cover_url.startswith("http"):
        return True
        
    return False

def main():
    print("=" * 60)
    print("🎨 [START] 开启全站动漫防盗链封面物理清洗与 Bangumi 大图回填...")
    print("=" * 60)
    
    if not os.path.exists(DETAIL_DIR):
        print(f"[ERROR] 详情目录不存在: {DETAIL_DIR}")
        return
        
    files = [f for f in os.listdir(DETAIL_DIR) if f.endswith(".json")]
    print(f"📊 扫描到全站详情文件共计: {len(files)} 个")
    
    rebuilt_count = 0
    skipped_count = 0
    failed_count = 0
    
    for idx, filename in enumerate(files):
        file_path = os.path.join(DETAIL_DIR, filename)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                detail = json.load(f)
                
            video = detail.get("video", {})
            title = video.get("name", "").strip()
            cover = video.get("cover", "").strip()
            
            if not title:
                continue
                
            # 判断当前封面是否会被防盗链阻断
            if is_blocked_cover(cover):
                print(f"[{idx+1}/{len(files)}] 🚨 [BLOCKED] 发现防盗链封面: '{title}'")
                print(f"    当前封面: {cover}")
                
                # 联网去 Bangumi 获取跨域免防盗链海报
                new_cover = get_bangumi_cover(title)
                
                if new_cover:
                    video["cover"] = new_cover
                    detail["video"] = video
                    
                    with open(file_path, 'w', encoding='utf-8') as fw:
                        json.dump(detail, fw, ensure_ascii=False, indent=2)
                        
                    print(f"    ✅ [FIXED] 成功回填 Bangumi 高清封面: {new_cover}")
                    rebuilt_count += 1
                else:
                    print(f"    ❌ [FAILED] 无法从 Bangumi 检索到该动漫的高清海报")
                    failed_count += 1
                
                # 延迟防封频
                time.sleep(1.0)
            else:
                skipped_count += 1
                
        except Exception as e:
            print(f"    🚨 [ERROR] 处理文件 {filename} 时发生异常: {e}")
            failed_count += 1
            
    print("\n" + "=" * 60)
    print("🎉 [FINISHED] 全站防盗链封面清洗回填任务圆满结束！")
    print(f"📊 成功清洗替换封面数: {rebuilt_count}")
    print(f"📊 跳过合规免防盗链封面数: {skipped_count}")
    print(f"📊 回填失败数: {failed_count}")
    print("=" * 60 + "\n")
    
    # 自动运行 update_data.py 重建本地 search_index.json 和 home-list.json 以同步前端
    print("🔄 正在自动本地重建全局索引，刷新前端页面显示...")
    subprocess.run(["python3", "update_data.py"])

if __name__ == '__main__':
    main()

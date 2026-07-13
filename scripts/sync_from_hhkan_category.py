import os
import json
import re
import time
import subprocess
import urllib.parse
import requests
from bs4 import BeautifulSoup
from fill_from_hkan import RobustHttpClient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')
SEARCH_INDEX_PATH = os.path.join(DATA_DIR, 'search_index.json')

# ScraperAPI 轮换国内住宅 IP 配置 (每个月免费 5000 次，专门用于秒杀穿透应用层限流)
SCRAPER_API_KEY = "9b5919ce9fcc48b957baf6c205188173"

def clean_title(title):
    if not title:
        return ""
    trad_simple = {
        '戰': '战', '鬥': '斗', '無': '无', '敵': '敌', '傳': '传', '說': '说', '記': '记',
        '錄': '录', '動': '动', '漫': '漫', '畫': '画', '術': '术', '劍': '剑', '魔': '魔',
        '雙': '双', '城': '城', '強': '强', '屬': '属', '性': '性', '點': '点', '覺': '觉',
        '醒': '醒', '棄': '弃', '家': '家', '族': '族', '拋': '抛', '樂': '乐', '獄': '狱'
    }
    t = str(title)
    for k, v in trad_simple.items():
        t = t.replace(k, v)
    t = t.lower()
    t = re.sub(r'\[?第?一季\]?', '1', t)
    t = re.sub(r'\[?第?二季\]?', '2', t)
    t = re.sub(r'\[?第?三季\]?', '3', t)
    t = re.sub(r'\[?第?四季\]?', '4', t)
    t = re.sub(r'\[?第?五季\]?', '5', t)
    t = re.sub(r'后篇|后半部|前半部', '', t)
    t = "".join(ch for ch in t if ch.isalnum())
    return t

def is_kids_anime(title, plot="", tags=""):
    title = (title or "").lower()
    plot = (plot or "").lower()
    tags = (tags or "").lower()
    
    if "问题儿童" in title:
        return False
        
    kids_classes = ["儿童", "少儿", "幼儿", "亲子", "早教", "儿歌", "子供向", "幼教", "识字", "拼音", "启蒙", "益智"]
    for kw in kids_classes:
        if kw in plot or kw in tags:
            return True
            
    kids_keywords = [
        '乐高', '城市守卫者', '超级警长', '汪汪队', '小猪佩奇', '熊出没', '喜羊羊', '灰太狼',
        '巴啦啦小魔仙', '超级飞侠', '托马斯', '天线宝宝', '爱探险的朵拉', '儿歌', '早教', '启蒙',
        '巧虎', '猪猪侠', '萌鸡小队', '宝宝巴士', '大头儿子', '贝瓦', '爆笑虫子', 
        '小马宝莉', '快乐酷宝', '舞法天女', '精灵梦叶罗丽', '叶罗丽', '神奇宝贝少儿版',
        '巨神战击队', '火力少年王', '赛尔号', '洛克王国', '奥拉星', '开心超人', '果宝特攻', 
        '神兽金刚', '飓风战魂', '爆裂飞车', '雷速登', '巴啦啦', '开心宝贝', '小鲤鱼历险记', 
        '神兵小将', '蓝猫淘气', '咖宝车神', '大卫，不可以', '皮诺和西诺比', 'ピノ＆シノビー',
        '依娜和恰恰', '嘟拉', '学英语', '少儿英语', 'candy caries', '向日葵马戏团'
    ]
    for kw in kids_keywords:
        if kw in title:
            return True
    return False

def is_unwanted_area_anime(title, area, plot="", tags=""):
    title = (title or "").lower()
    area = (area or "").lower()
    plot = (plot or "").lower()
    tags = (tags or "").lower()
    
    if area.strip():
        whitelist_regions = ["日本", "日漫", "jp"]
        has_whitelist = False
        for region in whitelist_regions:
            if region in area:
                has_whitelist = True
                break
        if not has_whitelist:
            return True
            
    unwanted_keywords = ["国产", "国漫", "欧美", "海外", "美国", "法国", "德国", "英国", "印度", "欧美动漫", "海外动漫"]
    for kw in unwanted_keywords:
        if kw in plot or kw in tags:
            return True
            
    cn_anime_keywords = [
        "斩神", "镖人", "逆天邪神", "将夜", "盗妖行", "完美世界", "神墓", "太岁", "胶囊计划", 
        "山海契约", "都市古仙医", "师兄啊师兄", "清华附小", "乐乐课堂", "无尾熊绘日记", "考拉绘日记",
        "仙逆", "遮天", "斗破苍穹", "吞噬星空", "武动乾坤", "凡人修仙", "大主宰", "神印王座", "灵武大陆",
        "为喵人生", "钢炽之芯", "深潜强制倒带", "乐乐便利店", "曾经有勇士", "熊熊帮帮团 5", "深空彼岸", "孤雄"
    ]
    for kw in cn_anime_keywords:
        if kw in title:
            return True
def is_sensitive_anime(title, plot="", tags=""):
    """判定番剧是否属于黄色或敏感内容"""
    title = (title or "").lower()
    plot = (plot or "").lower()
    tags = (tags or "").lower()
    
    sensitive_genres = ["里番", "肉番", "凌辱", "18禁", "无修正", "成人"]
    for genre in sensitive_genres:
        if genre in plot or genre in tags:
            return True
            
    sensitive_names = ["淫狱", "蹂躏", "少女波子汽水", "催眠", "堕落", "调教", "鹰峰同学", "一脸嫌弃", "胖次", "panties", "pantse", "枫与铃", "らぶみー", "楓と鈴", "loveme", "love me", "染谷同学", "女优这事", "女优"]
    for s_name in sensitive_names:
        if s_name in title:
            if "催眠" in title and "催眠麦克风" in title:
                continue
            return True


    return False

def get_bangumi_cover(title):

    """从 Bangumi 检索免防盗链的高清海报大图"""
    import urllib.parse
    clean_kw = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', title, flags=re.IGNORECASE).strip()
    encoded = urllib.parse.quote(clean_kw)
    url = f"https://api.bgm.tv/search/subject/{encoded}?type=2"
    
    cmd = [
        "curl", "-s", "-k",
        "-H", "User-Agent: test-agent (github.com/anranyunxiaomo)",
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
        print(f"    [BGM ERROR] Failed to fetch cover for {title}: {e}")
    return None

def fetch_html_via_scraper_api(url):
    """通过 ScraperAPI 代理拉取，自动轮换国内住宅 IP，彻底降维打击屏蔽限流限制"""
    payload = {
        'api_key': SCRAPER_API_KEY,
        'url': url,
        'country_code': 'cn'
    }
    try:
        print(f"    [SCRAPER_API] 正在使用动态住宅代理 IP 拉取详情页: {url} ...")
        r = requests.get('https://api.scraperapi.com/', params=payload, timeout=25)
        if r.status_code == 200:
            return r.text
    except Exception as e:
        print(f"    [SCRAPER_API EXCEPTION] 代理请求失败: {e}")
    return None

def extract_hkan_detail_play_list(client, detail_slug):
    """请求好好看详情页并用正则提取播放列表结构"""
    url = f"https://www.hhkan0.com/detail/{detail_slug}.html"
    
    # 1. 尝试普通直连接口抓取
    html = client.get(url)
    
    # 2. 如果直连报限流（或者返回空、报错盾）
    if not html or "您的访问过于频繁" in html or "Protected by cdndefend" in html:
        print(f"    ⚠️ [DIRECT BLOCKED] 普通 IP 遭到限流或盾拦截，正在自动切换 ScraperAPI 动态代理...")
        html = fetch_html_via_scraper_api(url)
        
    if not html:
        return [], None
        
    soup = BeautifulSoup(html, 'html.parser')
    
    desc_div = soup.find(class_='desc')
    plot = desc_div.get_text().strip() if desc_div else ""
    plot = re.sub(r'\s+', ' ', plot)
    
    actors_div = soup.find(class_='actors')
    writer = actors_div.get_text().strip() if actors_div else "暂无"
    
    year = "2026"
    area = "日本"
    tags_div = soup.find(class_='tags')
    tags_list = []
    if tags_div:
        spans = tags_div.find_all('span')
        if len(spans) >= 1:
            year = spans[0].get_text().strip()
        if len(spans) >= 2:
            area = spans[1].get_text().strip()
        if len(spans) >= 3:
            tags_list = [t.strip() for t in spans[2].get_text().split(",") if t.strip()]
            
    matches = re.findall(r'href=\"/play/([^\"]+)\" class=\"episode-item\"[^>]*><span>([^<]+)</span>', html)
    episodes = []
    for link, name in matches:
        episodes.append([name.strip(), f"/play/{link}"])
        
    meta = {
        "year": year,
        "writer": writer,
        "tags": " ".join(tags_list),
        "plot": plot,
        "area": area
    }
    return episodes, meta

def load_search_index():
    if os.path.exists(SEARCH_INDEX_PATH):
        try:
            with open(SEARCH_INDEX_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def main():
    print("=" * 60)
    print("🚀 [START] 开启好好看（hhkan0.com）日本动漫分类页最新新番自动同步...")
    print("=" * 60)
    
    search_index = load_search_index()
    existing_map = {}
    for entry in search_index:
        title = entry.get("Title")
        aid = entry.get("AID")
        if title and aid:
            cleaned = clean_title(title)
            if cleaned:
                existing_map[cleaned] = entry

    client = RobustHttpClient()
    client.initialize()
    
    hkan_list = []
    for page in range(1, 4):
        url = f"https://www.hhkan0.com/show/3--%E6%97%A5%E6%9C%AC---3-{page}.html"
        print(f"🔍 [HKAN LIST] 正在拉取日漫第 {page} 页: {url}")
        html = client.get(url)
        if not html or "您的访问过于频繁" in html or "Protected by cdndefend" in html:
            print("    ⚠️ [LIST BLOCKED] 列表页遭到限流，使用 ScraperAPI 代理拉取...")
            html = fetch_html_via_scraper_api(url)
            
        if html:
            soup = BeautifulSoup(html, 'html.parser')
            cards = soup.find_all('a', class_='v-item')
            print(f"  [PAGE OK] 成功解析到卡片数: {len(cards)}")
            for card in cards:
                titles = [t.get_text().strip() for t in card.find_all(class_='v-item-title') 
                          if 'kekys.com' not in t.get_text() and '可可影视' not in t.get_text()]
                title = titles[0] if titles else ''
                href = card.get('href')
                
                bottom = card.find(class_='v-item-bottom')
                status = bottom.get_text().strip() if bottom else ''
                
                if title and href:
                    slug = href.replace("/detail/", "").replace(".html", "")
                    hkan_list.append({
                        "title": title,
                        "slug": slug,
                        "status": status
                    })
        time.sleep(1.0)
        
    print(f"\n[INFO] 共抓取到好好看日漫最新卡片: {len(hkan_list)} 个。")
    
    synced_count = 0
    created_count = 0
    
    for idx, anime in enumerate(hkan_list):
        title = anime["title"]
        slug = anime["slug"]
        
        if is_unwanted_area_anime(title, "", "", "") or is_kids_anime(title) or is_sensitive_anime(title):
            continue
            
        cleaned_title = clean_title(title)

        matched_entry = existing_map.get(cleaned_title)
        
        aid = None
        detail_filename = None
        
        if matched_entry:
            aid = str(matched_entry["AID"])
            detail_filename = f"{aid}.json"
            print(f"[{idx+1}/{len(hkan_list)}] [MATCHED] 对齐本地日漫: '{title}' ---> AID: {aid}")
        else:
            aid = str(slug)
            detail_filename = f"{aid}.json"
            print(f"[{idx+1}/{len(hkan_list)}] [EXCLUSIVE] 好好看独占日漫: '{title}' ---> 新增 AID '{aid}'")
            
        detail_path = os.path.join(DETAIL_DIR, detail_filename)
        
        local_detail = None
        if os.path.exists(detail_path):
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    local_detail = json.load(f)
            except Exception:
                pass
                
        print(f"  [CHECKING] 正在抓取选集: {title} (slug: {slug})")
        episodes, meta = extract_hkan_detail_play_list(client, slug)
        
        if not episodes:
            print("  [WARNING] 选集列表为空，跳过处理")
            time.sleep(1.0)
            continue
            
        if meta and (is_unwanted_area_anime(title, meta.get("area"), meta.get("plot"), meta.get("tags")) or 
                    is_kids_anime(title, meta.get("plot"), meta.get("tags")) or 
                    is_sensitive_anime(title, meta.get("plot"), meta.get("tags"))):
            print(f"  🚨 [PURGE] 检测到该番剧为国产、低幼或敏感动漫，执行物理删除过滤: {title}")
            if os.path.exists(detail_path):
                try:
                    os.remove(detail_path)
                except:
                    pass
            time.sleep(1.0)
            continue

            
        cover = get_bangumi_cover(title)
        
        if local_detail:
            playlists = local_detail.setdefault("video", {}).setdefault("playlists", {})
            playlists["hkan_line1"] = episodes
            local_detail["video"]["status"] = f"更新至{len(episodes)}集"
            if cover:
                local_detail["video"]["cover"] = cover
                
            with open(detail_path, 'w', encoding='utf-8') as f:
                json.dump(local_detail, f, ensure_ascii=False, indent=2)
            print(f"  [UPDATED] 成功合并好好看线路 ({len(episodes)} EPs) 到 {detail_filename}")
            synced_count += 1
        else:
            # 新建详情
            local_detail = {
                "video": {
                    "id": aid,
                    "name": title,
                    "cover": cover or "https://lain.bgm.tv/pic/cover/l/d0/2c/459733_U3bZb.jpg",
                    "pic": "",
                    "plot": meta.get("plot", "日本新番动漫。"),
                    "plot_arr": [p.strip() for p in meta.get("plot", "").split() if p.strip()],
                    "tags": meta.get("tags", "日漫"),
                    "area": "日本",
                    "year": meta.get("year", "2026"),
                    "writer": meta.get("writer", "暂无"),
                    "status": f"更新至{len(episodes)}集",
                    "playlists": {
                        "hkan_line1": episodes
                    }
                },
                "player_vip": "",
                "player_jx": {}
            }
            with open(detail_path, 'w', encoding='utf-8') as f:
                json.dump(local_detail, f, ensure_ascii=False, indent=2)
            print(f"  [CREATED] 成功新建独占日漫: {title} ({len(episodes)} EPs)")
            created_count += 1
            
        # 适当降低休眠（由于有 ScraperAPI 住宅 IP 代理做降级兜底，我们可以把间隔从 1.5 秒缩短到 0.8 秒以极速提升同步效率！）
        time.sleep(0.8)
        
    print("\n" + "=" * 60)
    print("🎉 [FINISHED] 好好看分类页增量同步与线路合并任务圆满完成！")
    print(f"📊 同步合并好好看高清线路数: {synced_count}")
    print(f"📊 成功增量新建好好看日漫数: {created_count}")
    print("=" * 60 + "\n")

if __name__ == '__main__':
    main()

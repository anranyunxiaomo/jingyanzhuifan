import os
import re
import json
import time
import requests
import urllib3
import asyncio
import sys
from urllib.parse import urljoin

# 禁用 SSL 证书安全警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 初始化基本配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')
SEARCH_INDEX_PATH = os.path.join(DATA_DIR, 'search_index.json')

os.makedirs(DETAIL_DIR, exist_ok=True)

# ScraperAPI 配置 (每月免费 5000 次额度，自动实现国内住宅代理、过 CF 5秒盾及 JS 动态渲染)
SCRAPER_API_KEY = os.environ.get("SCRAPER_API_KEY", "9b5919ce9fcc48b957baf6c205188173")

def fetch_html_via_scraper_api(url):
    """通过 ScraperAPI 抓取并渲染动态网页（带 JS 渲染与防 CF 盾，强制分配中国内地 IP 出口）"""
    if not SCRAPER_API_KEY:
        return None
    try:
        payload = {
            'api_key': SCRAPER_API_KEY,
            'url': url,
            'render': 'true',       # 💡 开启云端 Headless Chrome 动态执行 JS 渲染
            'country_code': 'cn'    # 💡 强制分配中国大陆境内的 IP 访问，彻底绕过海外 IP 版权限制
        }
        print(f"  [SCRAPER_API] Sending request with JS rendering (CN Proxy) for: {url}")
        # ScraperAPI 响应慢，超时时间设为 60 秒
        r = requests.get('https://api.scraperapi.com/', params=payload, timeout=60)
        if r.status_code == 200:
            return r.text
        else:
            print(f"  [SCRAPER_API ERROR] Status {r.status_code} for {url}")
    except Exception as e:
        print(f"  [SCRAPER_API EXCEPTION] Request failed for {url}: {e}")
    return None


def is_kids_anime(title, plot="", tags=""):
    """判定是否属于给低幼少儿看的动漫"""
    title = (title or "").lower()
    plot = (plot or "").lower()
    tags = (tags or "").lower()
    
    # 1. 规避误伤特权词
    if "问题儿童" in title:
        return False
        
    # 2. 🚨 终极 Substring 模糊包含检查（修复了原本使用 split() 导致整句简介无法被检测的逻辑漏网漏洞）
    kids_classes = ["儿童", "少儿", "幼儿", "亲子", "早教", "儿歌", "子供向", "幼教", "识字", "拼音", "启蒙", "益智"]
    for kw in kids_classes:
        if kw in plot or kw in tags:
            return True
        
    # 3. 强力标题及特定黑名单（模糊匹配）
    kids_keywords = [
        '乐高', '城市守卫者', '超级警长', '汪汪队', '小猪佩奇', '熊出没', '喜羊羊', '灰太狼',
        '巴啦啦小魔仙', '超级飞侠', '托马斯', '天线宝宝', '爱探险的朵拉', '儿歌', '早教', '启蒙',
        '巧虎', '猪猪侠', '萌鸡小队', '宝宝巴士', '大头儿子', '贝瓦', '爆笑虫子', 
        '小马宝莉', '快乐酷宝', '舞法天女', '精灵梦叶罗丽', '叶罗丽', '神奇宝贝少儿版',
        '巨神战击队', '火力少年王', '赛尔号', '洛克王国', '奥拉星', '开心超人', '果宝特攻', 
        '神兽金刚', '飓风战魂', '爆裂飞车', '雷速登', '巴啦啦', '开心宝贝', '小鲤鱼历险记', 
        '神兵小将', '蓝猫淘气', '咖宝车神', '大卫，不可以', '皮诺和西诺比', 'ピノ＆西诺比',
        '依娜和恰恰', '嘟拉', '学英语', '少儿英语', 'candy caries', '蛀在糖糖里',
        'grow up show', '向日葵马戏团', 'les aventures fantastiques', 'plannosaurus', 
        '真古生遗物', '世界喵童话', '面包超人', '格林童话故事', '偶像公主', '露露与莉莉', 
        'lolo', '地球大好き', '신비아파트', '神秘公寓', '解谜公主'
    ]
    for kw in kids_keywords:
        if kw in title:
            return True
            
    return False


def is_sensitive_anime(name, plot, tags):
    """判定番剧是否属于黄色或敏感内容 (Naughty Content Filter)"""
    name = (name or "").lower()
    plot = (plot or "").lower()
    tags = (tags or "").lower()
    
    # 1. 严格的分类与标签黑名单 (里番、肉番、凌辱、18禁、无修正、成人)
    sensitive_genres = ["里番", "肉番", "凌辱", "18禁", "无修正", "成人"]
    for genre in sensitive_genres:
        if genre in plot or genre in tags:
            return True
            
    # 2. 标题模糊匹配黑名单
    sensitive_names = ["淫狱", "蹂躏", "少女波子汽水", "催眠", "堕落", "调教"]
    for s_name in sensitive_names:
        if s_name in name:
            # 💡 规避误伤：比如“催眠麦克风”是正常的音乐企划番剧，不应拦截
            if "催眠" in name and "催眠麦克风" in name:
                continue
            return True
            
    return False


def is_unwanted_area_anime(title, area, plot="", tags=""):
    """删除国内动漫（国产/国漫/中国/大陆），只保留日本动漫等白名单地区 (Region Control)"""
    title = (title or "").lower()
    area = (area or "").lower()
    plot = (plot or "").lower()
    tags = (tags or "").lower()
    
    # 1. 强力地区白名单限制：如果地区不为空，必须属于日本地区，否则直接强清（包含中国、大陆、国产、国漫、cn等国内动漫直接被拦截）
    if area.strip():
        whitelist_regions = ["日本", "日漫", "jp"]
        has_whitelist = False
        for region in whitelist_regions:
            if region in area:
                has_whitelist = True
                break
        if not has_whitelist:
            return True
            
    # 2. 补充标签匹配：即使地区为空，若剧情简介、标签中出现“国产”、“国漫”、“欧美”、“海外”等字样，也进行拦截
    unwanted_keywords = ["国产", "国漫", "欧美", "海外", "美国", "法国", "德国", "英国", "印度", "欧美动漫", "海外动漫"]
    for kw in unwanted_keywords:
        if kw in plot or kw in tags:
            return True
            
    # 3. 💡 强力清道夫：针对 AniCh 漏网国漫（因默认地区被错填为“日本”且缺少剧情/标签）进行强力标题黑名单拦截
    cn_anime_keywords = [
        "斩神", "镖人", "逆天邪神", "将夜", "盗妖行", "完美世界", "神墓", "太岁", "胶囊计划", 
        "山海契约", "都市古仙医", "师兄啊师兄", "清华附小", "乐乐课堂", "无尾熊绘日记", "考拉绘日记",
        "仙逆", "遮天", "斗破苍穹", "吞噬星空", "武动乾坤", "凡人修仙", "大主宰", "神印王座", "灵武大陆", "汤直志异"
    ]
    for kw in cn_anime_keywords:
        if kw in title:
            return True
            
    return False


def is_non_anime_garbage(title, tags_str, plot):
    """物理拦截三次元垃圾短剧、电影解说、真人影视，确保 100% 零误杀"""
    if not title:
        return False
    title_clean = title.strip()
    tags_clean = tags_str.strip() if tags_str else ""
    plot_clean = plot.strip() if plot else ""
    
    # 1. 只有以下明确是低俗三次元垃圾短剧/解说的关键词才拦截：
    # 注意：坚决排除 "剧场"（因为有剧场版），坚决排除 "真人"（因为有真人版动漫）！
    garbage_keywords = [
        "电影解说", "解说", "短剧", "漫剧", "我在死牢", "拆违建", "给钱不回家", "爱的白日梦", "权臣",
        "豪门联姻", "假千金", "真千金", "总裁的", "傅先生", "顾先生", "陆先生", "被迫嫁给", "被迫和豪门",
        "万人迷", "小人国", "小祖宗", "只给钱", "退婚后", "龙王", "赘婿"
    ]
    for kw in garbage_keywords:
        if kw in title_clean or kw in tags_clean or kw in plot_clean:
            return True
            
    # 2. 如果分类 (tags_str) 明确是 "电视剧" 或 "短剧"，且不包含任何动漫属性的词
    if "短剧" in tags_clean or "电视剧" in tags_clean:
        # 排除掉任何合规动漫可能带有的字眼
        anime_indicators = ["动漫", "动画", "新番", "日本", "国产", "剧场版", "tv", "ova"]
        if not any(x in tags_clean.lower() or x in title_clean.lower() for x in anime_indicators):
            return True
            
    return False


def check_anime_sensitive_by_aid(aid, title):
    """通过本地详情缓存辅助校验动漫是否敏感、属于低幼、或属于无关欧美海外片源"""
    if not aid:
        return is_sensitive_anime(title, "", "") or is_kids_anime(title, "", "") or is_unwanted_area_anime(title, "", "", "") or is_non_anime_garbage(title, "", "")
    detail_path = os.path.join(DETAIL_DIR, f"{aid}.json")
    if os.path.exists(detail_path):
        try:
            with open(detail_path, 'r', encoding='utf-8') as f:
                video = json.load(f).get("video", {})
                t = video.get("name", title)
                p = video.get("plot", "")
                tags_val = video.get("tags", "")
                a = video.get("area", "")
                return (is_sensitive_anime(t, p, tags_val) or 
                        is_kids_anime(t, p, tags_val) or 
                        is_unwanted_area_anime(t, a, p, tags_val) or
                        is_non_anime_garbage(t, tags_val, p))
        except Exception:
            pass
    return is_sensitive_anime(title, "", "") or is_kids_anime(title, "", "") or is_unwanted_area_anime(title, "", "", "") or is_non_anime_garbage(title, "", "")





# 备用域名列表
BACKUP_DOMAINS = [
    "https://api.agedm.io/v2/",
    "https://api.agedm.io/v2/"
]

headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

# 代理配置探测
proxy_ports = [7890, 7897, 6152, 1087, 1080]
active_proxy = None

def get_session():
    """获取可用代理会话或直连会话"""
    global active_proxy
    session = requests.Session()
    session.verify = False
    session.headers.update(headers)
    
    try:
        r = session.get("https://www.age-api.com:8443/age.json", timeout=3)
        if r.status_code == 200:
            print("[INFO] Connected directly.")
            return session
    except Exception:
        pass
        
    for port in proxy_ports:
        for ptype in ["http", "socks5h"]:
            proxies = {
                "http": f"{ptype}://127.0.0.1:{port}",
                "https": f"{ptype}://127.0.0.1:{port}"
            }
            try:
                r = session.get("https://www.age-api.com:8443/age.json", proxies=proxies, timeout=3)
                if r.status_code == 200:
                    active_proxy = proxies
                    session.proxies = proxies
                    print(f"[INFO] Connected using proxy: {ptype}://127.0.0.1:{port}")
                    return session
            except Exception:
                pass
    print("[WARNING] No local proxies detected. Proceeding with direct connection.")
    return session

session = get_session()

from concurrent.futures import ThreadPoolExecutor

class AgeM3u8Sniffer:
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    }
    
    @classmethod
    def sniff_m3u8_link(cls, parse_url):
        # 1. 优先普通请求直连抓取（速度快，降低 ScraperAPI 资源消耗）
        try:
            r = session.get(parse_url, headers=cls.headers, timeout=8)
            if r.status_code == 200:
                text_clean = r.text.replace("\\/", "/")
                
                # A. 尝试直接从 <video src="..."> 提取
                video_src_matches = re.findall(r'<video[^>]+src=["\']([^"\']+)["\']', text_clean)
                if video_src_matches:
                    real_url = video_src_matches[0].replace("&amp;", "&")
                    if real_url.startswith("//"): real_url = "https:" + real_url
                    return real_url
                
                # B. 兜底正则匹配 m3u8 和 mp4
                m3u8_matches = re.findall(r'["\']((?:https?:)?//[^"\']+\.(?:m3u8|mp4)[^"\']*)["\']', text_clean)
                if m3u8_matches:
                    real_url = m3u8_matches[0].replace("&amp;", "&")
                    if real_url.startswith("//"): real_url = "https:" + real_url
                    return real_url
        except Exception:
            pass

        # 2. 如果直连请求失败（可能被 WAF 5秒盾阻拦或需要动态执行 JS），则降级调用 ScraperAPI 渲染获取
        if SCRAPER_API_KEY:
            try:
                print(f"  [SCRAPER_API FALLBACK] Normal request failed. Retrying '{parse_url}' via ScraperAPI...")
                html = fetch_html_via_scraper_api(parse_url)
                if html:
                    text_clean = html.replace("\\/", "/")
                    
                    # A. 提取渲染后最终生成的 <video src="..."> 直链 (最强逻辑，无视一切动态 JS 加密)
                    video_src_matches = re.findall(r'<video[^>]+src=["\']([^"\']+)["\']', text_clean)
                    if video_src_matches:
                        real_url = video_src_matches[0].replace("&amp;", "&")
                        if real_url.startswith("//"): real_url = "https:" + real_url
                        print(f"    [SCRAPER_API SUCCESS] Successfully extracted stream from <video src>: {real_url}")
                        return real_url
                    
                    # B. 兜底正则匹配 m3u8 和 mp4
                    m3u8_matches = re.findall(r'["\']((?:https?:)?//[^"\']+\.(?:m3u8|mp4)[^"\']*)["\']', text_clean)
                    if m3u8_matches:
                        real_url = m3u8_matches[0].replace("&amp;", "&")
                        if real_url.startswith("//"): real_url = "https:" + real_url
                        print(f"    [SCRAPER_API SUCCESS] Successfully sniffed stream via regex: {real_url}")
                        return real_url
            except Exception as e:
                print(f"[ERROR] ScraperAPI sniff failed for {parse_url}: {e}")

        return None





def fetch_from_backup_cms(title):
    """
    顺序/并发搜索暴风、非凡、量子、红牛、金鹰、快车六大资源网，并将它们返回的所有可用 m3u8 线路在本地进行去重合并！
    """
    cms_apis = [
        {"name": "暴风资源网", "url": "https://bfzyapi.com/api.php/provide/vod/"},
        {"name": "非凡资源网", "url": "https://ffzyapi.com/api.php/provide/vod/"},
        {"name": "量子资源网", "url": "https://lzzyapi.com/api.php/provide/vod/"},
        {"name": "红牛资源网", "url": "https://www.hongniuzy2.com/api.php/provide/vod/"},
        {"name": "金鹰资源网", "url": "https://jyzyapi.com/provide/vod/"},
        {"name": "快车资源网", "url": "https://kczyapi.com/api.php/provide/vod/"}
    ]
    
    merged_playlists = {}
    matched_vod_name = None
    
    for cms in cms_apis:
        search_url = f"{cms['url']}?ac=detail&wd={title}"
        try:
            r = session.get(search_url, timeout=8)
            if r.status_code == 200:
                data = r.json()
                if data.get("code") == 1 and data.get("list"):
                    # 寻找最匹配的项目 (完全相等优先，包含次之)
                    target_vod = None
                    for vod in data["list"]:
                        if vod.get("vod_name") == title:
                            target_vod = vod
                            break
                    if not target_vod:
                        for vod in data["list"]:
                            if title in vod.get("vod_name", "") or vod.get("vod_name", "") in title:
                                target_vod = vod
                                break
                    if not target_vod:
                        target_vod = data["list"][0]
                    
                    matched_vod_name = target_vod.get("vod_name", title)
                    
                    # 开始解析播放列表
                    from_str = target_vod.get("vod_play_from", "")
                    url_str = target_vod.get("vod_play_url", "")
                    
                    from_list = from_str.split("$$$")
                    url_list = url_str.split("$$$")
                    
                    for idx, line_key in enumerate(from_list):
                        # 确定当前源的映射 Key
                        mapped_key = "bfzym3u8"
                        if "ffm3u8" in line_key or "ffzy" in line_key:
                            mapped_key = "ffm3u8"
                        elif "lzm3u8" in line_key or "lzzy" in line_key:
                            mapped_key = "lzm3u8"
                        elif "wjm3u8" in line_key or "wjzy" in line_key:
                            mapped_key = "wjm3u8"
                        elif "hnm3u8" in line_key or "hnzy" in line_key:
                            mapped_key = "hnm3u8"
                        elif "kym3u8" in line_key or "kczy" in line_key:
                            mapped_key = "kym3u8"
                        elif "m3u8" in line_key:
                            # 兜底模糊归类
                            if "bf" in line_key: mapped_key = "bfzym3u8"
                            elif "ff" in line_key: mapped_key = "ffm3u8"
                            elif "lz" in line_key: mapped_key = "lzm3u8"
                            elif "hn" in line_key: mapped_key = "hnm3u8"
                            elif "kc" in line_key: mapped_key = "kym3u8"
                            else: mapped_key = "wjm3u8"
                        
                        if idx < len(url_list):
                            eps_str = url_list[idx]
                            eps = []
                            for ep_item in eps_str.split("#"):
                                if "$" in ep_item:
                                    name_url = ep_item.split("$")
                                    if len(name_url) >= 2:
                                        eps.append([name_url[0], name_url[1]])
                            if eps:
                                # 💡 合并到大列表里，如果线路已存在，则不重复覆盖（优先使用排在前面的源）
                                if mapped_key not in merged_playlists:
                                    merged_playlists[mapped_key] = eps
                                    print(f"    [CMS MERGE] Merged line '{mapped_key}' from {cms['name']} for '{title}'")
        except Exception as e:
            print(f"[DEBUG] Fetch from {cms['name']} failed: {e}")
            
    if merged_playlists:
        return {
            "video": {
                "name": matched_vod_name or title,
                "playlists": merged_playlists
            },
            "player_label_arr": {
                "bfzym3u8": "暴风备用",
                "ffm3u8": "非凡备用",
                "lzm3u8": "量子备用",
                "wjm3u8": "无尽备用"
            }
        }
    return None


def fetch_api_base():
    """获取最新的 API 域名配置"""
    urls = [
        "https://www.age-api.com:8443/age.json",
        "https://spa-1259460662.cos.accelerate.myqcloud.com/agefans/api/age.json"
    ]
    for url in urls:
        try:
            r = session.get(url, timeout=5)
            if r.status_code == 200:
                data = r.json()
                web_url = data.get('url', '')
                if web_url:
                    return "https://api.agedm.io/v2/"
        except Exception as e:
            print(f"[DEBUG] Fetch config from {url} failed: {e}")
    return BACKUP_DOMAINS[0]

API_BASE = fetch_api_base()
print(f"[INFO] Using API Base URL: {API_BASE}")

import urllib.parse

def request_api(path, params=None):
    """请求 API 封装"""
    target_url = urllib.parse.urljoin(API_BASE, path)
    if params:
        target_url += "?" + urllib.parse.urlencode(params)
    
    # 🚀 绝杀策略：强制通过自建 CF Worker 代理绕过 GitHub Actions 的机房 IP 封锁 (403)
    encoded_target_url = urllib.parse.quote(target_url, safe='')
    url = f"https://jingyanff.xyz/?url={encoded_target_url}"
    
    for retry in range(3):
        try:
            r = session.get(url, timeout=15)
            if r.status_code == 200:
                return r.json()
            else:
                print(f"[ERROR] API {path} returned status {r.status_code}")
        except Exception as e:
            print(f"[WARNING] Retry {retry+1} for {path} failed: {e}. Trying direct connection...")
            # 💡 容灾退回：如果代理访问失败，尝试不经过代理直连原始目标 API 接口 (特别适合本地网络开发)
            try:
                r_direct = session.get(target_url, timeout=10)
                if r_direct.status_code == 200:
                    print(f"[SUCCESS] Direct connection resolved API {path} successfully!")
                    return r_direct.json()
            except Exception as direct_err:
                print(f"[ERROR] Direct connection also failed: {direct_err}")
            time.sleep(1.5)
    return None

try:
    from pypinyin import pinyin, Style
    def get_pinyin_initials(text):
        initials = pinyin(text, style=Style.FIRST_LETTER)
        return "".join([item[0] for item in initials]).lower()
except ImportError:
    def get_pinyin_initials(text):
        return ""


def calculate_uptodate(video):
    """
    根据 video 数据结构中的 playlists，智能计算并生成最精准的 UpToDate 集数文字
    """
    playlists = video.get("playlists", {})
    if not playlists or not isinstance(playlists, dict):
        return video.get("uptodate") or "更新中"
        
    max_ep_num = 0
    max_ep_label = ""
    
    # 统计所有线路中的最大集数
    for pkey, eps in playlists.items():
        if not isinstance(eps, list):
            continue
        for ep in eps:
            if isinstance(ep, list) and len(ep) >= 1:
                label = str(ep[0]).strip()
                # 尝试从 "第03集"、"第12集" 等字眼提取出数字
                m = re.search(r'\d+', label)
                if m:
                    num = int(m.group())
                    if num > max_ep_num:
                        max_ep_num = num
                        max_ep_label = label
                else:
                    if not max_ep_label:
                        max_ep_label = label
                        
    if max_ep_label:
        if not max_ep_label.startswith("更新至"):
            m = re.search(r'\d+', max_ep_label)
            if m:
                return f"更新至第{int(m.group()):02d}集"
            return f"更新至{max_ep_label}"
        return max_ep_label
        
    return video.get("uptodate") or "更新中"


def load_search_index():
    if os.path.exists(SEARCH_INDEX_PATH):
        try:
            with open(SEARCH_INDEX_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def save_search_index(index_data):
    with open(SEARCH_INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

def generate_healing_and_related_logic():
    print("\n[ENHANCEMENT] Starting unified healing list gathering and related series matching...")
    # A. 收集治愈番列表
    healing_list = []
    for filename in os.listdir(DETAIL_DIR):
        if filename.endswith(".json"):
            aid_str = filename[:-5]
            detail_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    video = json.load(f).get("video", {})
                    name = video.get("name")
                    plot = video.get("plot", "")
                    tags = video.get("tags", "")
                    
                    is_healing = False
                    healing_words = ["治愈", "日常", "温馨", "萌系", "轻松", "温暖", "温馨", "治愈系", "夏目友人帐", "芙莉莲", "小鲨鱼"]
                    for w in healing_words:
                        if w in name or w in plot or w in tags:
                            is_healing = True
                            break
                    
                    if is_healing:
                        if "战斗" in tags or "后宫" in tags:
                            if "碧蓝之海" not in name:
                                is_healing = False
                                
                        if is_healing:
                            entry_aid = aid_str
                            if aid_str.isdigit():
                                entry_aid = int(aid_str)
                            healing_list.append({
                                "AID": entry_aid,
                                "Title": name,
                                "PicSmall": video.get("cover", "") or video.get("pic", ""),
                                "NewTitle": video.get("status", "完结"),
                                "Href": f"/detail/{aid_str}"
                              })
            except:
                pass

    local_home_path = os.path.join(DATA_DIR, 'home-list.json')
    if os.path.exists(local_home_path):
        try:
            with open(local_home_path, 'r', encoding='utf-8') as f_h:
                home_data = json.load(f_h)
            if isinstance(home_data, dict):
                home_data["healing_list"] = healing_list
                with open(local_home_path, 'w', encoding='utf-8') as f_hw:
                    json.dump(home_data, f_hw, ensure_ascii=False, indent=2)
                print(f"[HEALING] Automatically gathered {len(healing_list)} high-score healing animes.")
        except Exception as he:
            print(f"[WARNING] Failed to inject healing list: {he}")

    # B. 同系列关联计算与注入
    def get_base_title(title):
        if not title:
            return ""
        t = title.strip()
        suffixes = [
            "第一季", "第二季", "第三季", "第四季", "第五季", "第六季",
            "第1季", "第2季", "第3季", "第4季", "第5季", "第6季",
            " 1", " 2", " 3", " 4", " 5", " 6",
            "特别篇", "剧场版", " ONA", " OVA", "第2期", "第3期", "前篇", "后篇"
        ]
        for s in suffixes:
            t = t.replace(s, "")
        return t.strip()

    base_to_animes = {}
    for filename in os.listdir(DETAIL_DIR):
        if filename.endswith(".json"):
            aid_str = filename[:-5]
            detail_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    video = json.load(f).get("video", {})
                    name = video.get("name")
                    if name:
                        base_name = get_base_title(name)
                        if len(base_name) >= 2:
                            if base_name not in base_to_animes:
                                base_to_animes[base_name] = []
                            base_to_animes[base_name].append({
                                "id": aid_str,
                                "title": name,
                                "cover": video.get("cover", "")
                            })
            except:
                pass

    related_injected = 0
    for filename in os.listdir(DETAIL_DIR):
        if filename.endswith(".json"):
            aid_str = filename[:-5]
            detail_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    detail = json.load(f)
                    video = detail.get("video", {})
                    name = video.get("name")
                    if name:
                        base_name = get_base_title(name)
                        if base_name in base_to_animes:
                            related = [x for x in base_to_animes[base_name] if x["id"] != aid_str]
                            if related:
                                video["related"] = related
                                detail["video"] = video
                                with open(detail_path, 'w', encoding='utf-8') as fw:
                                    json.dump(detail, fw, ensure_ascii=False, indent=2)
                                related_injected += 1
            except:
                pass
    print(f"[RELATED] Successfully injected related recommendations into {related_injected} detail files.\n")

# ==========================================================================
# 🚀 异步并发主任务
# ==========================================================================
async def main_async():
    print("[START] Start updating anime data...")
    
    is_github_actions = os.environ.get("GITHUB_ACTIONS") == "true"
    event_name = os.environ.get("GITHUB_EVENT_NAME")
    force_network = os.environ.get("FORCE_NETWORK") == "true"
    
    # 💡 黄金防刷闸防线：只有当在线上且为定时任务(schedule)或手动单次点触发(workflow_dispatch)，
    # 或者是本地开发环境且显式带上 FORCE_NETWORK=true 时，才激活网络并去拉取 API！
    # 如果是日常普通的 push 代码构建，强制直接降级为纯本地静态 VOD 更新，API 请求数 100% 锁死为 0！
    run_network = False
    if is_github_actions:
        if event_name in ["schedule", "workflow_dispatch"]:
            run_network = True
    else:
        if force_network:
            run_network = True

    # 💡 提前拦截退出的静态更新模式（不走网络，零 API 消耗）
    if not run_network:
        print("=" * 60)
        print("🛡️  [GUARD] 检测到非定时网络同步运行（当前为日常 Push 构建或本地普通运行）。")
        print("💡 为了保护 AGE API 额度，已自动强制拦截跳过网络数据同步！")
        print("🚀 本次运行将跳过所有网络 API 访问，仅在本地重建静态索引。")
        print("=" * 60)
        
        # 1. 重建本地搜索索引
        print("\n[INDEX] Rebuilding search_index.json from all local details...")
        index_data = []
        seen_aids = set()
        for filename in os.listdir(DETAIL_DIR):
            if filename.endswith(".json"):
                aid_str = filename[:-5]
                detail_file_path = os.path.join(DETAIL_DIR, filename)
                try:
                    with open(detail_file_path, 'r', encoding='utf-8') as f:
                        detail = json.load(f)
                        video = detail.get("video", {})
                        title = video.get("name")
                        if title and aid_str not in seen_aids:
                            # 💡 过滤黄色/敏感番剧、低幼少儿与无关欧美海外片源
                            if (is_sensitive_anime(title, video.get("plot", ""), video.get("tags", "")) or 
                                is_kids_anime(title, video.get("plot", ""), video.get("tags", "")) or 
                                is_unwanted_area_anime(title, video.get("area", ""), video.get("plot", ""), video.get("tags", "")) or
                                is_non_anime_garbage(title, video.get("tags", ""), video.get("plot", ""))):
                                try:
                                    os.remove(detail_file_path)
                                    print(f"  [CLEANUP] Physically deleted non-anime garbage: {title} ({filename})")
                                except:
                                    pass
                                continue
                            pinyin_code = get_pinyin_initials(title)
                            entry_aid = aid_str
                            if aid_str.isdigit():
                                entry_aid = int(aid_str)
                            index_data.append({
                                "AID": entry_aid,
                                "Title": title,
                                "Pinyin": pinyin_code,
                                "Cover": video.get("cover", "") or video.get("pic", ""),
                                "Status": video.get("status", "连载"),
                                "UpToDate": calculate_uptodate(video)
                            })
                            seen_aids.add(aid_str)
                except Exception as e:
                    print(f"[WARNING] Failed to parse detail file {filename}: {e}")
        save_search_index(index_data)
        print(f"[SUCCESS] Rebuilt search_index.json with {len(index_data)} entries.")
        
        # 💡 本地首页列表 (home-list.json) 强制过滤重写，防止历史低幼或欧美海外动漫遗留展示
        local_home_path = os.path.join(DATA_DIR, 'home-list.json')
        if os.path.exists(local_home_path):
            try:
                with open(local_home_path, 'r', encoding='utf-8') as f_home:
                    home_data = json.load(f_home)
                
                if isinstance(home_data, dict):
                    if "latest" in home_data and isinstance(home_data["latest"], list):
                        home_data["latest"] = [
                            item for item in home_data["latest"]
                            if not check_anime_sensitive_by_aid(item.get("AID"), item.get("Title"))
                        ]
                    if "recommend" in home_data and isinstance(home_data["recommend"], list):
                        home_data["recommend"] = [
                            item for item in home_data["recommend"]
                            if not check_anime_sensitive_by_aid(item.get("AID"), item.get("Title"))
                        ]
                    if "week_list" in home_data and isinstance(home_data["week_list"], dict):
                        cleaned_week = {}
                        for day, animes in home_data["week_list"].items():
                            if isinstance(animes, list):
                                cleaned_week[day] = [
                                    item for item in animes
                                    if not check_anime_sensitive_by_aid(item.get("id"), item.get("name"))
                                ]
                            else:
                                cleaned_week[day] = animes
                        home_data["week_list"] = cleaned_week
                

                
                with open(local_home_path, 'w', encoding='utf-8') as f_home_w:
                    json.dump(home_data, f_home_w, ensure_ascii=False, indent=2)
                print("[SUCCESS] Local home-list.json cleaned and re-written.")
                
                # 💡 调用统一大增益：重建本地治愈番和关联系列数据 ！！！
                generate_healing_and_related_logic()
            except Exception as clean_home_err:
                print(f"[WARNING] Failed to clean local home-list.json: {clean_home_err}")
        
        # 2. 执行静态 Cache Busting
        print("\n[CACHE BUSTING] Updating index.html static assets version queries...")
        try:
            index_path = "index.html"
            if os.path.exists(index_path):
                with open(index_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                import datetime
                tz_utc8 = datetime.timezone(datetime.timedelta(hours=8))
                now_str = datetime.datetime.now(tz_utc8).strftime("%Y%m%dT%H%M")
                import re
                content = re.sub(r'css/style\.css\?v=[0-9a-zA-Z_]+', f'css/style.css?v={now_str}', content)
                content = re.sub(r'js/app\.js\?v=[0-9a-zA-Z_]+', f'js/app.js?v={now_str}', content)
                with open(index_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"[SUCCESS] Updated index.html asset versions to: {now_str}")
            else:
                print("[WARNING] index.html not found, skipping Cache Busting.")
        except Exception as cache_err:
            print(f"[ERROR] Failed to update asset versions: {cache_err}")
            
        print("[FINISHED] Anime data static generation complete!")
        return

    # 💡 触发 A123TV 爬取与对齐合并脚本，增量注入 A123TV 独占番及直连线路
    print("\n[A123TV INTEGRATION] Triggering A123TV crawler and data alignment...")
    try:
        import subprocess
        crawler_path = os.path.join(BASE_DIR, "scripts", "a123_crawler.py")
        subprocess.run([sys.executable, crawler_path], check=True)
        print("[A123TV INTEGRATION] Successfully integrated A123TV data!\n")
    except Exception as e:
        print(f"[A123TV INTEGRATION ERROR] Failed to run a123_crawler.py: {e}\n")

    # 💡 触发 好好看日本分类 爬取与对齐合并脚本，增量注入好好看高清播放源
    print("\n[HHKAN INTEGRATION] Triggering hhkan category crawler and data alignment...")
    try:
        import subprocess
        crawler_path = os.path.join(BASE_DIR, "scripts", "sync_from_hhkan_category.py")
        subprocess.run([sys.executable, crawler_path], check=True)
        print("[HHKAN INTEGRATION] Successfully integrated HHKAN data!\n")
    except Exception as e:
        print(f"[HHKAN INTEGRATION ERROR] Failed to run sync_from_hhkan_category.py: {e}\n")

    aids_to_fetch = {}
    recently_updated_aids = set()
    
    if True:
        # 1. 获取首页列表 (home-list)
        print("Fetching home-list...")
        home_data = request_api("home-list")
        if not home_data:
            print("[CRITICAL] Failed to fetch home-list. Aborting.")
            return
        

        # 💡 对 home-list 进行敏感/黄色动漫清洗，防止首页和每日更新显示它们
        if isinstance(home_data, dict):
            if "latest" in home_data and isinstance(home_data["latest"], list):
                home_data["latest"] = [
                    item for item in home_data["latest"]
                    if not check_anime_sensitive_by_aid(item.get("AID"), item.get("Title"))
                ]
            if "recommend" in home_data and isinstance(home_data["recommend"], list):
                home_data["recommend"] = [
                    item for item in home_data["recommend"]
                    if not check_anime_sensitive_by_aid(item.get("AID"), item.get("Title"))
                ]
            if "week_list" in home_data and isinstance(home_data["week_list"], dict):
                cleaned_week = {}
                for day, animes in home_data["week_list"].items():
                    if isinstance(animes, list):
                        cleaned_week[day] = [
                            item for item in animes
                            if not check_anime_sensitive_by_aid(item.get("id"), item.get("name"))
                        ]
                    else:
                        cleaned_week[day] = animes
                home_data["week_list"] = cleaned_week

        # 保存 home-list.json 到 data/ 目录
        with open(local_home_path, 'w', encoding='utf-8') as f:
            json.dump(home_data, f, ensure_ascii=False, indent=2)
        print("[SUCCESS] Saved and merged home-list.json")
        
        # 3. 汇总需要抓取详情的动漫列表
        for item in home_data.get('latest', []):
            if item.get('AID'):
                aids_to_fetch[str(item['AID'])] = {
                    'title': item.get('Title', '未知动漫'),
                    'new_title': item.get('NewTitle', ''),
                    'is_active': True
                }
        for item in home_data.get('recommend', []):
            if item.get('AID'):
                aids_to_fetch[str(item['AID'])] = {
                    'title': item.get('Title', '未知动漫'),
                    'new_title': '',
                    'is_active': False
                }

        week_list = home_data.get('week_list', {})
        if isinstance(week_list, dict):
            for day_key, day_items in week_list.items():
                if isinstance(day_items, list):
                    for item in day_items:
                        if isinstance(item, dict):
                            aid = item.get('id') or item.get('AID')
                            name = item.get('name') or item.get('Title')
                            if aid:
                                aids_to_fetch[str(aid)] = {
                                    'title': name or '未知动漫',
                                    'new_title': item.get('new_title') or item.get('NewTitle') or '',
                                    'is_active': True
                                }

        # 获取最近更新的前 15 页 (汇总包含近一个月内更新的所有最热当季新番，大约 450+ 部)
        print("Fetching update pages 1 to 15...")
        for page in range(1, 16):
            update_data = request_api("update", params={"page": page})
            if update_data and isinstance(update_data, list):
                for item in update_data:
                    aid_str = str(item.get('AID', ''))
                    if aid_str:
                        recently_updated_aids.add(aid_str)
                        aids_to_fetch[aid_str] = {
                            'title': item.get('Title', '未知动漫'),
                            'new_title': item.get('NewTitle', ''),
                            'is_active': True
                        }

        # 获取最近更新的前 15 页 (汇总包含近一个月内更新的所有最热当季新番，大约 450+ 部)
        print("Fetching update pages 1 to 15...")
        for page in range(1, 16):
            update_data = request_api("update", params={"page": page})
            if update_data and isinstance(update_data, list):
                for item in update_data:
                    aid_str = str(item.get('AID', ''))
                    if aid_str:
                        recently_updated_aids.add(aid_str)
                        aids_to_fetch[aid_str] = {
                            'title': item.get('Title', '未知动漫'),
                            'new_title': item.get('NewTitle', ''),
                            'is_active': True
                        }

    # 💡 强制把中文追番界爆火的殿堂级名作 AID 注入待抓取名单，彻底将其静态化离线化，确保 100% 搜索即见、0% 依赖国外 CORS 代理
    PERMANENT_HOT_ANIME = [
        "20230207", "20260029", # 葬送的芙莉莲 系列
        "19990011", "20240172", # 海贼王 系列
        "20190059", "20200234", "20210214", "20210215", "20230073", "20240090", # 鬼灭之刃 系列
        "20200249", "20230072", # 咒术回战 系列
        "20180104", "20210006", "20210134", "20240059", # 转生史莱姆 系列
        "20130026", "20170062", "20180126", "20190058", "20200318", "20220008", "20230030", "20230225", # 进击的巨人 系列
        "20220063", "20220261", "20230209", # 间谍过家家 系列
        "20220245", "20230085", "20240149", # 死神 千年血战 系列
        "20220244", # 电锯人
        "20220248", # 孤独摇滚
        "19960002", # 名侦探柯南
        "20220133", # 莉可丽丝
        "20020014", "20070029", "20170046" # 火影忍者 系列
    ]
    for aid in PERMANENT_HOT_ANIME:
        if aid not in aids_to_fetch:
            aids_to_fetch[aid] = {
                'title': '热门大作',
                'new_title': '',
                'is_active': False
            }

    print(f"[INFO] Collected {len(aids_to_fetch)} unique anime AIDs to fetch.")
    
    # 4. 载入现有的搜索库
    search_index = load_search_index()
    existing_aids = {str(item['AID']) for item in search_index}

    # 5. 限制项处理与 pkey 参数提取
    limit = 9999
    target_pkey = None
    for arg in sys.argv:
        if arg.startswith('--limit='):
            limit = int(arg.split('=')[1])
        if arg.startswith('--pkey='):
            target_pkey = str(arg.split('=')[1])

    # 临时存放所有拉取出的详情数据，以便后续回填并统一批量保存
    fetched_details = {}

    counter = 0
    # ==========================================================================
    # 1️⃣ 第一阶段：快速同步抓取 API 并和本地做 Diff 缓存匹配，收集待解析任务
    # ==========================================================================
    for aid, info in aids_to_fetch.items():
        if counter >= limit:
            print(f"[INFO] Reached limit of {limit} entries. Stop fetching details.")
            break
        counter += 1
        detail_path = os.path.join(DETAIL_DIR, f"{aid}.json")
        title = info['title']
        
        # A. 检查本地是否存在已有详情缓存
        local_detail = None
        if os.path.exists(detail_path):
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    local_detail = json.load(f)
                    
                # 💡 如果本地已有缓存，且该动漫已被判定为非国日漫/黄色/敏感/低幼内容，直接强清删除并跳过处理
                video_cached = local_detail.get("video", {})
                t_cached = video_cached.get("name", title)
                p_cached = video_cached.get("plot", "")
                tags_cached = video_cached.get("tags", "")
                a_cached = video_cached.get("area", "")
                if is_sensitive_anime(t_cached, p_cached, tags_cached) or is_kids_anime(t_cached, p_cached, tags_cached) or is_unwanted_area_anime(t_cached, a_cached, p_cached, tags_cached):
                    print(f"  [FILTERED] skipping & deleting unwanted anime: {title} (AID: {aid})")
                    if os.path.exists(detail_path):
                        try:
                            os.remove(detail_path)
                        except:
                            pass
                    continue
            except Exception:
                pass

        # B. 智能增量判定：如果本地详情已存在，且当前动漫今天没有更新（或者虽然更新了但集数已匹配），直接使用本地缓存！

        if local_detail:
            should_skip_api = False
            new_title = info.get('new_title', '')
            
            # 💡 完结过滤核心：如果本地已缓存详情且状态为“完结”/“已完结”/“全集”，说明不会再有更新，直接 100% 跳过 API 请求！
            status_cached = video_cached.get("status", "") if isinstance(video_cached, dict) else ""
            if "完结" in status_cached or "全集" in status_cached:
                should_skip_api = True
            # 💡 增量核心：如果该动漫在最近 2 页更新列表里找不到，说明今天全站根本没有它新集数的任何更新，100% 可信跳过 API！
            elif aid not in recently_updated_aids:
                should_skip_api = True
            else:
                if not new_title:
                    # 若没有写明最新集数名字，稳妥起见不跳过详情，重新拉一次
                    should_skip_api = False
                else:
                    playlists = local_detail.get('video', {}).get('playlists', {})
                    for pkey, eps in playlists.items():
                        if eps and len(eps) > 0:
                            if eps[-1][0] == new_title:
                                should_skip_api = True
                                break
            
            if should_skip_api:
                print(f"[{counter}/{min(len(aids_to_fetch), limit)}] [CACHE HIT] {title} is up-to-date ({new_title}). Skipping API request.")
                fetched_details[aid] = (local_detail, detail_path, title)
                
                continue

        # C. 缓存未命中，才需要向 API 抓取最新详情
        print(f"[{counter}/{min(len(aids_to_fetch), limit)}] [CACHE MISS] Fetching detail for AID: {aid} ({title})...")
        detail_data = request_api(f"detail/{aid}")
        
        # 💡 多源数据聚合：如果主 API 没有获取到（可能是该动漫已下架或 AGE 库无此资源），则尝试从暴风资源网检索补齐
        if not detail_data:
            print(f"  [BACKUP SEARCH] AID: {aid} not found in primary API. Searching title '{title}' on Storm CMS...")
            detail_data = fetch_from_backup_cms(title)
        
        if detail_data:
            video_api = detail_data.get("video", {})
            t_api = video_api.get("name", title)
            p_api = video_api.get("plot", "")
            tags_api = video_api.get("tags", "")
            a_api = video_api.get("area", "")
            if is_sensitive_anime(t_api, p_api, tags_api) or is_kids_anime(t_api, p_api, tags_api) or is_unwanted_area_anime(t_api, a_api, p_api, tags_api):
                print(f"  [API FILTERED] Discarded non-whitelist/sensitive/kids anime from API response: {t_api} (AID: {aid})")
                if os.path.exists(detail_path):
                    try:
                        os.remove(detail_path)
                    except:
                        pass
                continue
                
            fetched_details[aid] = (detail_data, detail_path, title)
            
            # 读取本地已有的缓存，做增量直链同步
            local_cache = {}
            if os.path.exists(detail_path):
                try:
                    with open(detail_path, 'r', encoding='utf-8') as f:
                        old_data = json.load(f)
                        old_playlists = old_data.get('video', {}).get('playlists', {})
                        for pkey, eps in old_playlists.items():
                            for ep in eps:
                                if len(ep) >= 3 and ep[2]:
                                    local_cache[(pkey, ep[1])] = ep[2]
                except Exception:
                    pass

            # 获取当前解析接口配置
            vip_list = (detail_data.get('player_vip') or '').split(',')
            player_jx = detail_data.get('player_jx') or {}
            
            # 循环 playlist 集数收集待解析任务，并执行高效的后台多线程直链嗅探
            playlists = detail_data.get('video', {}).get('playlists', {})
            if not isinstance(playlists, dict):
                playlists = {}
            
            tasks_to_sniff = []
            for pkey, eps in playlists.items():
                is_vip = (pkey in vip_list)
                parse_base = player_jx.get('vip') if is_vip else player_jx.get('zj')
                if not parse_base:
                    parse_base = "https://jx.wuzhoupai.com:8443/m3u8/?url="
                
                for i, ep in enumerate(eps):
                    ep_token = ep[1]
                    
                    # 💡 优化：如果该 Token 已经是 M3U8 真实直链（如暴风、非凡等），则直接回填为 realUrl，跳过云端嗅探！
                    if ep_token.startswith('http') and ('.m3u8' in ep_token or '/m3u8' in ep_token):
                        if len(ep) == 2:
                            ep.append(ep_token)
                        elif len(ep) >= 3:
                            ep[2] = ep_token
                        continue
                        
                    cached_url = local_cache.get((pkey, ep_token))
                    if cached_url:
                        if len(ep) == 2:
                            ep.append(cached_url)
                        elif len(ep) >= 3:
                            ep[2] = cached_url
                    else:
                        # 没命中缓存的，加入待嗅探池
                        parse_url = parse_base + ep_token
                        tasks_to_sniff.append({
                            "pkey": pkey,
                            "ep_index": i,
                            "parse_url": parse_url
                        })

            # 并发执行直链嗅探，并将 realUrl 回填进 playlists
            if tasks_to_sniff:
                print(f"  [SNIFFER] Detected {len(tasks_to_sniff)} new episodes needing stream sniffing. Resolving via thread pool...")
                
                def sniff_worker(task):
                    real_m3u8 = AgeM3u8Sniffer.sniff_m3u8_link(task["parse_url"])
                    return task, real_m3u8

                with ThreadPoolExecutor(max_workers=5) as executor:
                    results = list(executor.map(sniff_worker, tasks_to_sniff))
                
                for task, real_m3u8 in results:
                    if real_m3u8:
                        pkey = task["pkey"]
                        idx = task["ep_index"]
                        ep = playlists[pkey][idx]
                        if len(ep) == 2:
                            ep.append(real_m3u8)
                        elif len(ep) >= 3:
                            ep[2] = real_m3u8
                        # 回填增量缓存，供后续无脑命中
                        local_cache[(pkey, ep[1])] = real_m3u8
                        print(f"    [OK] Resolved direct stream for {pkey} - EP index {idx}")
        else:
            print(f"[WARNING] Failed to fetch details for AID: {aid}")
        
        # 适当小歇防 API 反爬
        time.sleep(0.3)



    # ==========================================================================
    # 3️⃣ 第三阶段：批量写入本地 JSON 文件并重建搜索索引
    # ==========================================================================
    print("\n[SAVING] Writing newly fetched detail files...")
    for aid, (detail_data, detail_path, title) in fetched_details.items():
        with open(detail_path, 'w', encoding='utf-8') as f:
            json.dump(detail_data, f, ensure_ascii=False, indent=2)

    # ==========================================================================
    # 💡 统一大增益：无论是否走网络，皆统一收集治愈番写入 home-list.json & 同系列关联匹配注入
    # ==========================================================================
    generate_healing_and_related_logic()



    # 💡 稳健大杀器：一键重建最新的 search_index.json，使本地模糊搜索能 100% 覆盖所有已缓存/同步的动漫
    print("\n[INDEX] Rebuilding search_index.json from all local details...")
    index_data = []
    seen_aids = set()
    
    for filename in os.listdir(DETAIL_DIR):
        if filename.endswith(".json"):
            aid_str = filename[:-5]
            detail_file_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(detail_file_path, 'r', encoding='utf-8') as f:
                    detail = json.load(f)
                    video = detail.get("video", {})
                    title = video.get("name")
                    if title and aid_str not in seen_aids:
                        # 💡 过滤黄色/敏感番剧、低幼少儿与无关欧美海外片源
                        if is_sensitive_anime(title, video.get("plot", ""), video.get("tags", "")) or is_kids_anime(title, video.get("plot", ""), video.get("tags", "")) or is_unwanted_area_anime(title, video.get("area", ""), video.get("plot", ""), video.get("tags", "")):
                            try:
                                os.remove(detail_file_path)
                                print(f"  [CLEANUP] Deleted kids/sensitive/western/foreign local JSON: {filename} ({title})")
                            except:
                                pass
                            continue
                        pinyin_code = get_pinyin_initials(title)
                        entry_aid = aid_str
                        if aid_str.isdigit():
                            entry_aid = int(aid_str)
                        index_data.append({
                            "AID": entry_aid,
                            "Title": title,
                            "Pinyin": pinyin_code,
                            "Cover": video.get("cover", "") or video.get("pic", ""),
                            "Status": video.get("status", "连载"),
                            "UpToDate": calculate_uptodate(video)
                        })
                        seen_aids.add(aid_str)
            except Exception as e:
                print(f"[WARNING] Failed to parse detail file {filename}: {e}")
                

        
    save_search_index(index_data)
    print(f"[SUCCESS] Rebuilt search_index.json with {len(index_data)} entries.")
    
    # 💡 强力 Cache Busting：自动更新 index.html 中的 JS 和 CSS 版本号为当前最新时间戳，彻底干掉浏览器强缓存
    print("\n[CACHE BUSTING] Updating index.html static assets version queries...")
    try:
        index_path = "index.html"
        if os.path.exists(index_path):
            with open(index_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            import datetime
            tz_utc8 = datetime.timezone(datetime.timedelta(hours=8))
            now_str = datetime.datetime.now(tz_utc8).strftime("%Y%m%dT%H%M")
            
            import re
            content = re.sub(r'css/style\.css\?v=[0-9a-zA-Z_]+', f'css/style.css?v={now_str}', content)
            content = re.sub(r'js/app\.js\?v=[0-9a-zA-Z_]+', f'js/app.js?v={now_str}', content)
            content = re.sub(r'window\.JYZF_VERSION\s*=\s*["\'][0-9a-zA-Z_]+["\']', f'window.JYZF_VERSION = "{now_str}"', content)
            
            with open(index_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"[SUCCESS] Updated index.html asset versions to: {now_str}")
        else:
            print("[WARNING] index.html not found, skipping Cache Busting.")
    except Exception as cache_err:
        print(f"[ERROR] Failed to update asset versions: {cache_err}")

    print("[FINISHED] Anime data static generation complete!")

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()

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
    sensitive_names = ["淫狱", "蹂躏", "少女波子汽水", "催眠", "堕落", "调教", "鹰峰同学", "一脸嫌弃", "胖次", "panties", "pantse", "枫与铃", "らぶみー", "楓と鈴", "loveme", "love me", "染谷同学", "女优这事", "女优"]
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

# 💡 多解析站备用链配置（按稳定性与速度排序）
# 对于 xigua 等只有 age_token 没有直链的线路，我们会轮流对每个解析站发起并发请求，哪个先返回直链就用哪个
AGE_PARSE_STATIONS = [
    "https://jx.xmflv.com/?url=",              # 先锋解析 - 最稳最广泛（无需 Referer）
    "https://jx.jsonplayer.com/?url=",          # JSON 解析 - 备用 A
    "https://im1907.top/?jx=",                  # 备用 B
    "https://jx.wuzhoupai.com:8443/m3u8/?url=", # 五洲派 - AGE 官方合作，解密 age_ 最准
]


class AgeM3u8Sniffer:
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    }

    @classmethod
    def _extract_stream_from_html(cls, html_text):
        """从 HTML 文本中提取 <video src> 或 .m3u8/.mp4 直链"""
        text_clean = html_text.replace("\\/", "/")
        # A. 优先提取 <video src="..."> 标签直链
        video_src_matches = re.findall(r'<video[^>]+src=["\']([^"\']+)["\']', text_clean)
        if video_src_matches:
            real_url = video_src_matches[0].replace("&amp;", "&")
            if real_url.startswith("//"): real_url = "https:" + real_url
            if real_url.startswith("http") and ("m3u8" in real_url or "mp4" in real_url or "/video/" in real_url):
                return real_url
        # B. 兜底正则匹配 m3u8 / mp4 链接
        m3u8_matches = re.findall(r'["\']((?:https?:)?//[^"\']+\.(?:m3u8|mp4)[^"\']*)["\']', text_clean)
        if m3u8_matches:
            real_url = m3u8_matches[0].replace("&amp;", "&")
            if real_url.startswith("//"): real_url = "https:" + real_url
            return real_url
        return None

    @classmethod
    def sniff_m3u8_link(cls, parse_url):
        """用单个解析站 URL 嗅探直链（原有接口保持兼容）"""
        # 1. 优先普通 GET 直连
        try:
            r = session.get(parse_url, headers=cls.headers, timeout=8)
            if r.status_code == 200:
                result = cls._extract_stream_from_html(r.text)
                if result:
                    return result
        except Exception:
            pass

        # 2. 降级调用 ScraperAPI 渲染
        if SCRAPER_API_KEY:
            try:
                print(f"  [SCRAPER_API FALLBACK] Retrying '{parse_url}' via ScraperAPI...")
                html = fetch_html_via_scraper_api(parse_url)
                if html:
                    result = cls._extract_stream_from_html(html)
                    if result:
                        print(f"    [SCRAPER_API SUCCESS] Extracted: {result}")
                        return result
            except Exception as e:
                print(f"[ERROR] ScraperAPI sniff failed for {parse_url}: {e}")

        return None

    @classmethod
    def sniff_with_multi_stations(cls, ep_token):
        """
        💡 多解析站并发嗅探 - 专为 xigua 等只有 age_token 无直链的线路设计。
        同时向所有解析站发起请求，哪个先返回有效直链就采纳，其余取消。
        比单站串行速度快 3~5 倍，成功率接近各站最高值的并集。
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def try_station(base_url):
            parse_url = base_url + ep_token
            try:
                r = session.get(parse_url, headers=cls.headers, timeout=10)
                if r.status_code == 200:
                    result = cls._extract_stream_from_html(r.text)
                    if result:
                        print(f"    [MULTI-SNIFF OK] {base_url} → {result[:80]}")
                        return result
            except Exception:
                pass
            return None

        with ThreadPoolExecutor(max_workers=len(AGE_PARSE_STATIONS)) as ex:
            futures = {ex.submit(try_station, base): base for base in AGE_PARSE_STATIONS}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    # 有结果立即返回，其余 future 会在 executor 析构时自动取消
                    return result

        # 所有解析站都没拿到直链，降级 ScraperAPI
        if SCRAPER_API_KEY:
            for base_url in AGE_PARSE_STATIONS[:2]:  # 只用前两个站做 ScraperAPI 渲染，节省额度
                parse_url = base_url + ep_token
                try:
                    html = fetch_html_via_scraper_api(parse_url)
                    if html:
                        result = cls._extract_stream_from_html(html)
                        if result:
                            print(f"    [MULTI-SNIFF SCRAPER OK] → {result[:80]}")
                            return result
                except Exception:
                    pass

        return None





def fetch_from_backup_cms(title):
    """
    顺序/并发搜索暴风、非凡、量子、红牛、金鹰、快车六大资源网，并将它们返回的所有可用 m3u8 线路在本地进行去重合并！
    """
    cms_apis = [
        {"name": "暴风资源网", "url": "https://bfzyapi.com/api.php/provide/vod/"},
        {"name": "非凡资源网", "url": "https://cj.ffzyapi.com/api.php/provide/vod/"},
        {"name": "量子资源网", "url": "https://cj.lziapi.com/api.php/provide/vod/"},
        {"name": "红牛资源网", "url": "https://www.hongniuzy2.com/api.php/provide/vod/"},
        {"name": "金鹰资源网", "url": "https://jyzyapi.com/provide/vod/"},
        {"name": "快车资源网", "url": "https://kczyapi.com/api.php/provide/vod/"}
    ]
    
    merged_playlists = {}
    matched_vod_name = None
    
    for cms in cms_apis:
        search_url = f"{cms['url']}?ac=detail&wd={title}"
        try:
            cms_headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': cms['url']
            }
            r = session.get(search_url, headers=cms_headers, timeout=8)
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


def merge_cms_into_local_playlists(local_playlists, cms_key, cms_eps):
    """
    精细化合并线路：保留本地原汁原味的 age_ 加密 Token（以供 iframe 降级），
    仅将采集站的常规 M3U8 直链升级回填写入 ep[2] (realUrl) 位置，同时支持增量选集追加！
    """
    def get_ep_num(name):
        nums = re.findall(r'\d+', name)
        return int(nums[0]) if nums else None

    if cms_key not in local_playlists:
        # 如果本地没有这个线路，直接注入并复制到 ep[2]
        for ep in cms_eps:
            if len(ep) == 2:
                ep.append(ep[1])
            elif len(ep) >= 3:
                ep[2] = ep[1]
        local_playlists[cms_key] = cms_eps
        return True

    local_eps = local_playlists[cms_key]
    if not isinstance(local_eps, list):
        return False
        
    local_map = {}
    for ep in local_eps:
        num = get_ep_num(ep[0])
        if num is not None:
            local_map[num] = ep

    merged_any = False
    for cms_ep in cms_eps:
        cms_num = get_ep_num(cms_ep[0])
        if cms_num is not None:
            if cms_num in local_map:
                # 💡 本地存在该集：升级！回填直链为 ep[2]，绝对不覆盖 ep[1] 原加密 Token
                local_ep = local_map[cms_num]
                cms_url = cms_ep[1]
                if len(local_ep) == 2:
                    local_ep.append(cms_url)
                    merged_any = True
                elif len(local_ep) >= 3 and local_ep[2] != cms_url:
                    local_ep[2] = cms_url
                    merged_any = True
            else:
                # 💡 本地没有该集（新番更新了）：增量追加
                new_ep = [cms_ep[0], cms_ep[1], cms_ep[1]]
                local_eps.append(new_ep)
                merged_any = True
                
    return merged_any


def calculate_uptodate(video):
    """
    根据 video 数据结构精准计算 UpToDate 集数文字。

    优先级策略：
    1. 标准 AGE 动漫（8位数字 20xxxxxx）：100% 优先信任官方 uptodate 字段（精准集数）
       - AGE API 中 status="连载"，uptodate="第03集" 才是真正的集数
       - 防止 hkan/a123 playlist 虚高集数污染
    2. 非标准动漫（第三方采集源 hkan/a123 等）：以 playlist 最大集数为准
       - 但用 uptodate 字段作为上限截断，防止采集源预置集数虚高
    """
    aid_str = str(video.get("id", ""))
    is_standard_age = aid_str.isdigit() and len(aid_str) == 8 and aid_str.startswith("20")

    # ─── 策略 1：标准 AGE 动漫，绝对信任官方 uptodate 字段 ───────────────────────
    if is_standard_age:
        # AGE API 中 uptodate 是最权威的集数来源（如"第03集"、"第12集"）
        # status 字段只有"连载"/"完结"，不含精准集数，不能用于计算集数
        uptodate = video.get("uptodate") or ""
        if uptodate and uptodate not in ("更新中", "连载", "未播放", ""):
            m = re.search(r"\d+", uptodate)
            if m:
                return f"更新至第{int(m.group()):02d}集"
            return uptodate

        # uptodate 为空或无效时，看 status 是否包含数字（如"更新至12集"的旧格式）
        status = video.get("status") or ""
        if status and "完结" not in status and status not in ("连载", "更新中", "未播放", ""):
            m = re.search(r"\d+", status)
            if m:
                return f"更新至第{int(m.group()):02d}集"

        # uptodate 和 status 都无数字时，从 AGE 自带线路里取集数（排除第三方污染线路）
        playlists = video.get("playlists", {})
        if playlists and isinstance(playlists, dict):
            age_keys = [k for k in playlists if k not in ("hkan_line1", "hkan_line2", "a123_line1")]
            target = {k: playlists[k] for k in age_keys} if age_keys else playlists
            max_num = 0
            max_label = ""
            for pkey, eps in target.items():
                if not isinstance(eps, list):
                    continue
                for ep in eps:
                    if isinstance(ep, list) and ep:
                        m = re.search(r"\d+", str(ep[0]).strip())
                        if m:
                            n = int(m.group())
                            if n > max_num:
                                max_num = n
                                max_label = str(ep[0]).strip()
            if max_label:
                m2 = re.search(r"\d+", max_label)
                if m2:
                    return f"更新至第{int(m2.group()):02d}集"

        return "连载中"

    # ─── 策略 2：非标准动漫（hkan / a123 等），playlist 集数为准 ─────────────────
    # 同时用 uptodate 字段作为上限截断，防止采集源预置集数虚高
    uptodate_raw = video.get("uptodate") or ""
    uptodate_cap = 0
    if uptodate_raw:
        m = re.search(r"\d+", uptodate_raw)
        if m:
            uptodate_cap = int(m.group())

    playlists = video.get("playlists", {})
    if not playlists or not isinstance(playlists, dict):
        return uptodate_raw or video.get("status") or "更新中"

    max_ep_num = 0
    max_ep_label = ""

    for pkey, eps in playlists.items():
        if not isinstance(eps, list):
            continue
        for ep in eps:
            if isinstance(ep, list) and len(ep) >= 1:
                label = str(ep[0]).strip()
                m = re.search(r"\d+", label)
                if m:
                    num = int(m.group())
                    # 💡 关键截断：playlist 集数不得超过 uptodate 上限，防止预置虚高
                    if uptodate_cap > 0 and num > uptodate_cap:
                        continue
                    if num > max_ep_num:
                        max_ep_num = num
                        max_ep_label = label
                else:
                    if not max_ep_label:
                        max_ep_label = label

    if max_ep_label:
        if not max_ep_label.startswith("更新至"):
            m = re.search(r"\d+", max_ep_label)
            if m:
                return f"更新至第{int(m.group()):02d}集"
            return f"更新至{max_ep_label}"
        return max_ep_label

    return uptodate_raw or video.get("status") or "更新中"

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
    
    is_github_actions = os.environ.get("GITHUB_ACTIONS") == "true"
    
    # 💡 节流保护：如果是本地开发环境，尝试直连目标 API 域名，绝对不经过自建代理，最大化节省 Worker 额度
    if not is_github_actions:
        try:
            r_direct = session.get(target_url, timeout=10)
            if r_direct.status_code == 200:
                return r_direct.json()
            else:
                print(f"[WARNING] Direct API {path} returned status {r_direct.status_code}. Trying proxy fallback...")
        except Exception as direct_err:
            print(f"[WARNING] Local direct connection failed for {path}: {direct_err}. Trying proxy fallback...")
            
    # 🚀 降级策略（仅在 GitHub Actions，或本地直连报错时）：通过自建 CF Worker 代理绕过机房 IP 封锁 (403)
    encoded_target_url = urllib.parse.quote(target_url, safe='')
    url = f"https://jingyanff.xyz/?url={encoded_target_url}"
    
    for retry in range(3):
        try:
            r = session.get(url, timeout=15)
            if r.status_code == 200:
                return r.json()
            else:
                print(f"[ERROR] Proxy API {path} returned status {r.status_code}")
        except Exception as e:
            print(f"[WARNING] Proxy Retry {retry+1} for {path} failed: {e}")
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





def calculate_logical_update_time(video, detail_file_path):
    """
    基于 JSON 原生属性计算出 100% 可复现、免 Git 污染的逻辑更新时效分数 (Logical Update Score)。
    """
    # 1. 提取年份
    year = 0
    try:
        year = int(video.get("year", 0))
    except:
        pass
    if not year:
        # 尝试从 tags 或者是 plot 或者是 name 里面提取 4 位数字年份
        name_str = video.get("name", "")
        m = re.search(r'\b(19|20)\d{2}\b', name_str)
        if m:
            year = int(m.group())
        else:
            year = 2020 # 默认兜底年份
            
    # 2. 提取最新集数数量作为微调
    playlists = video.get("playlists", {})
    total_eps = 0
    if playlists and isinstance(playlists, dict):
        for pkey, eps in playlists.items():
            if isinstance(eps, list):
                total_eps = max(total_eps, len(eps))
                
    # 3. 提取连载状态 (连载中加权)
    status = video.get("status", "")
    is_ongoing = 1 if ("连载" in status or "更新" in status or "第" in status) and "完结" not in status else 0
    
    # 4. AID 的纯数字微调
    aid_str = os.path.basename(detail_file_path)[:-5]
    aid_num = 0
    if aid_str.isdigit():
        aid_num = int(aid_str)
    else:
        m = re.findall(r'\d+', aid_str)
        if m:
            aid_num = int(m[-1])
            
    # 5. 好好看独占番 AID 归一化平权
    if year >= 2025 and aid_num < 1000000:
        aid_num += 20260000
        
    # 6. 综合逻辑更新时间戳公式 (Logical Update Score)
    score = (year * 10000000) + (is_ongoing * 100000) + (total_eps * 10) + (aid_num % 10000000)
    return score


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
        # 1. 清除所有的括号和括号内的字
        t = re.sub(r'\(.*?\)|（.*?）|\[.*?\]|【.*?】', '', t)
        # 2. 清除 4 位数字年号
        t = re.sub(r'\b(19|20)\d{2}\b', '', t)
        # 3. 剔除特殊的音轨和版本后缀
        t = re.sub(r'国语版|日语版|粤语版|国语|日语|粤语|中字|合集|版|全集|第一部|第二部|第三部|第四部|第五部', '', t)
        # 4. 剔除常见的季数和罗马数字
        suffixes = [
            "第一季", "第二季", "第三季", "第四季", "第五季", "第六季",
            "第1季", "第2季", "第3季", "第4季", "第5季", "第6季",
            " 1", " 2", " 3", " 4", " 5", " 6",
            "特别篇", "剧场版", " ONA", " OVA", "第2期", "第3期", "前篇", "后篇",
            "ii", "iii", "iv", "v", "season", "part"
        ]
        for s in suffixes:
            t = t.replace(s, "")
            t = t.replace(s.lower(), "")
            t = t.replace(s.upper(), "")
        # 5. 剔除所有的非字母数字和特殊符号，合并空格
        t = "".join(ch for ch in t if ch.isalnum())
        return t.strip()

    # 1. 扫描并缓存所有动漫的名字和 clean_title 基础特征
    anime_list = []
    for filename in os.listdir(DETAIL_DIR):
        if filename.endswith(".json"):
            aid_str = filename[:-5]
            detail_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(detail_path, 'r', encoding='utf-8') as f:
                    video = json.load(f).get("video", {})
                    name = video.get("name")
                    if name:
                        base = get_base_title(name)
                        anime_list.append({
                            "id": aid_str,
                            "title": name,
                            "base": base,
                            "cover": video.get("cover", ""),
                            "file_path": detail_path
                        })
            except:
                pass

    # 2. 对每个动漫两两计算关联度并写入
    related_injected = 0
    for current in anime_list:
        related = []
        base_current = current["base"]
        if not base_current or len(base_current) < 2:
            continue
            
        for other in anime_list:
            if other["id"] == current["id"]:
                continue
            base_other = other["base"]
            if not base_other or len(base_other) < 2:
                continue
                
            # 💡 [CRITICAL] 核心算法：互为子串（如 “名侦探柯南” 包含于 “名侦探柯南警察学校篇” ），或者清洗后拼音基准高度相似
            if base_current in base_other or base_other in base_current:
                related.append({
                    "id": other["id"],
                    "title": other["title"],
                    "cover": other["cover"]
                })
                
        if related:
            try:
                with open(current["file_path"], 'r', encoding='utf-8') as fr:
                    detail = json.load(fr)
                detail.setdefault("video", {})["related"] = related
                with open(current["file_path"], 'w', encoding='utf-8') as fw:
                    json.dump(detail, fw, ensure_ascii=False, indent=2)
                related_injected += 1
            except Exception as e:
                print(f"      [RELATED ERROR] Failed to write related for {current['title']}: {e}")

    print(f"[RELATED] Successfully injected related recommendations into {related_injected} detail files.\n")


def rebuild_static_index_and_assets():
    """
    一键重建 search_index.json 并更新 index.html 缓存版本号的统一函数。
    支持在不走网络的情况下，由本地自检愈合脚本或普通 push 构建时直接调用。
    在重建过程中，会强制执行 playlists 集数降序排序并回写详情。
    """
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
                    
                    # 💡 核心对齐：集数多的播放源优先排到前面
                    playlists = video.get("playlists", {})
                    if playlists:
                        sorted_playlists = dict(sorted(playlists.items(), key=lambda item: len(item[1]) if isinstance(item[1], list) else 0, reverse=True))
                        if list(playlists.keys()) != list(sorted_playlists.keys()):
                            video["playlists"] = sorted_playlists
                            detail["video"] = video
                            with open(detail_file_path, 'w', encoding='utf-8') as fw:
                                json.dump(detail, fw, ensure_ascii=False, indent=2)
                                
                    title = video.get("name")
                    if title and aid_str not in seen_aids:
                        # 💡 过滤敏感、少儿与非动漫垃圾片源
                        is_sensitive = is_sensitive_anime(title, video.get("plot", ""), video.get("tags", ""))
                        is_kids = is_kids_anime(title, video.get("plot", ""), video.get("tags", ""))
                        is_unwanted = is_unwanted_area_anime(title, video.get("area", ""), video.get("plot", ""), video.get("tags", ""))
                        tags_val = video.get("tags", "")
                        plot_val = video.get("plot", "")
                        is_garbage = is_non_anime_garbage(title, tags_val, plot_val)
                        
                        if is_sensitive or is_kids or is_unwanted or is_garbage:
                            try:
                                os.remove(detail_file_path)
                                print(f"  [CLEANUP] Deleted kids/sensitive/garbage local JSON: {filename} ({title})")
                            except:
                                pass
                            continue
                            
                        pinyin_code = get_pinyin_initials(title)
                        entry_aid = aid_str
                        if aid_str.isdigit():
                            entry_aid = int(aid_str)
                            
                        mtime = calculate_logical_update_time(video, detail_file_path)
                        index_data.append({
                            "AID": entry_aid,
                            "Title": title,
                            "Pinyin": pinyin_code,
                            "Cover": video.get("cover", "") or video.get("pic", ""),
                            "Status": video.get("status", "连载"),
                            "UpToDate": calculate_uptodate(video),
                            "UpdateTime": mtime,
                            "Type": video.get("type", "")
                        })
                        seen_aids.add(aid_str)
            except Exception as e:
                print(f"[WARNING] Failed to parse detail file {filename}: {e}")
                
    index_data.sort(key=lambda x: x.get("UpdateTime", 0), reverse=True)
    save_search_index(index_data)
    print(f"[SUCCESS] Rebuilt search_index.json with {len(index_data)} entries.")
    
    # Cache Busting
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
            content = re.sub(r'js/app_v2\.js\?v=[0-9a-zA-Z_]+', f'js/app_v2.js?v={now_str}', content)
            content = re.sub(r'window\.JYZF_VERSION\s*=\s*["\'][0-9a-zA-Z_]+["\']', f'window.JYZF_VERSION = "{now_str}"', content)
            
            with open(index_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"[SUCCESS] Updated index.html asset versions to: {now_str}")
        else:
            print("[WARNING] index.html not found, skipping Cache Busting.")
    except Exception as cache_err:
        print(f"[ERROR] Failed to update asset versions: {cache_err}")


def auto_align_non_age_animes_from_age():
    """
    自动自检：遍历本地 detail 中的非标准 AGE ID 文件（如暴风网的非八位数字 ID、或 a123_ 开头的文件，
    或者虽然是数字但封面为空/失效的动漫），去 AGE 平台查询最新数据。
    若存在，则自动拉取 AGE 数据，更新动漫封面，并将本地数据进行合并升级与清理，
    从而将“非 AGE 动漫”自动过渡、自检回 AGE 主数据体系中。
    """
    print("\n🌐 [AUTO-SELF-CHECK] 开启本地非标准 AGE 动漫自检与自动对齐...")
    if not os.path.exists(DETAIL_DIR):
        return
        
    files = [f for f in os.listdir(DETAIL_DIR) if f.endswith(".json")]
    non_age_files = []
    
    for f in files:
        aid_str = f[:-5]
        # 非 8 位数字开头的，或者不是以 20 开头的标准 AGE ID，或者是 a123_ 开头的
        is_standard_age = aid_str.isdigit() and len(aid_str) == 8 and aid_str.startswith("20")
        if not is_standard_age:
            non_age_files.append(f)
            
    print(f"📊 扫描到本地非标准 AGE 动漫文件共计: {len(non_age_files)} 个")
    
    # 💡 每次自检限制前 15 个，防止 ScraperAPI 和 API 额度超限，实现温和增量自检
    checked_count = 0
    aligned_count = 0
    
    for filename in non_age_files:
        if checked_count >= 15:
            print(f"[INFO] 已达到本次增量自检限制 (15 部)，暂停自检。")
            break
            
        file_path = os.path.join(DETAIL_DIR, filename)
        try:
            with open(file_path, 'r', encoding='utf-8') as f_read:
                detail = json.load(f_read)
                
            video = detail.get("video", {})
            title = video.get("name", "").strip()
            if not title:
                continue
                
            checked_count += 1
            print(f"🔍 [{checked_count}] 正在去 AGE 检索自检动漫: '{title}' (本地 ID: {filename[:-5]})...")
            
            # 💡 联网搜索依然使用归一化标题
            search_title = title.replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
            search_title = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+|(?:日|国)语版|中字)$', '', search_title, flags=re.IGNORECASE).strip()
            if not search_title:
                search_title = title
                
            search_res = request_api("search", {"query": search_title})
            matched_aid = None
            matched_cover = None
            
            if search_res and search_res.get("code") == 200:
                videos = search_res.get("data", {}).get("videos", [])
                for v in videos:
                    v_name = v.get("name", "").replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
                    clean_v_name = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三校五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+|(?:日|国)语版|中字)$', '', v_name, flags=re.IGNORECASE).strip()
                    
                    # 精准或高度模糊匹配标题
                    if search_title and clean_v_name and (search_title in clean_v_name or clean_v_name in search_title):
                        matched_aid = str(v.get("AID") or v.get("id") or "")
                        matched_cover = v.get("cover")
                        break
                        
            if matched_aid:
                print(f"  ✨ [FOUND ON AGE] 在 AGE 平台找到了匹配项! AID: {matched_aid}")
                
                # 进一步拉取 AGE 的完整详情
                age_detail = request_api(f"detail/{matched_aid}")
                if age_detail:
                    # 💡 合并逻辑：以 AGE 数据为主，同时合并保留原本地的一些独占播放线路（如 A123 或 暴风 线路）
                    age_video = age_detail.get("video", {})
                    age_playlists = age_video.get("playlists", {})
                    
                    # 把本地已有的播放线路合并进去
                    local_playlists = video.get("playlists", {})
                    for key, val in local_playlists.items():
                        if key not in age_playlists:
                            age_playlists[key] = val
                            
                    # 更新封面
                    if matched_cover:
                        age_video["cover"] = matched_cover
                        print(f"  🖼️  [COVER UPDATE] 已成功将封面对齐至 AGE 官方地址: {matched_cover}")
                        
                    age_detail["video"] = age_video
                    
                    # 写入新 AGE ID 对应的详情文件
                    new_detail_path = os.path.join(DETAIL_DIR, f"{matched_aid}.json")
                    with open(new_detail_path, 'w', encoding='utf-8') as fw:
                        json.dump(age_detail, fw, ensure_ascii=False, indent=2)
                        
                    # 物理删除老的非标准 ID 文件，完成自动过渡
                    if os.path.exists(file_path) and str(matched_aid) != str(filename[:-5]):
                        try:
                            os.remove(file_path)
                            print(f"  🗑️  [CLEANUP] 成功物理清理老旧非标准详情文件: {filename}")
                        except Exception as rm_err:
                            print(f"  [WARN] 清理老旧文件 {filename} 失败: {rm_err}")
                            
                    aligned_count += 1
                    print(f"  ✅ [SUCCESS] 成功完成动漫 '{title}' 的 AGE 自检对齐与自动更新！")
                else:
                    print(f"  [WARNING] 无法拉取 AGE AID {matched_aid} 的详情数据，本次跳过。")
            else:
                print(f"  [NOT FOUND] AGE 平台暂无 '{title}' 的匹配数据。")
                
            # 适当延时，防止 API 限频
            time.sleep(1.0)
            
        except Exception as file_err:
            print(f"[WARN] 自检文件 {filename} 失败: {file_err}")
            
    print(f"🏁 [AUTO-SELF-CHECK FINISHED] 本次 AGE 自动自检对齐完成。扫描: {checked_count} 部，对齐更新成功: {aligned_count} 部。\n")


# ==========================================================================
# 🚀 异步并发主任务
# ==========================================================================
async def main_async():
    print("[START] Start updating anime data...")
    local_home_path = os.path.join(DATA_DIR, 'home-list.json')
    
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
                            
                            # 💡 基于 JSON 原生属性计算逻辑时效分数，彻底防物理修改时间易受本地污染的弊端
                            mtime = calculate_logical_update_time(video, detail_file_path)
                            index_data.append({
                                "AID": entry_aid,
                                "Title": title,
                                "Pinyin": pinyin_code,
                                "Cover": video.get("cover", "") or video.get("pic", ""),
                                "Status": video.get("status", "连载"),
                                "UpToDate": calculate_uptodate(video),
                                "UpdateTime": mtime,
                                "Type": video.get("type", "")
                            })
                            seen_aids.add(aid_str)

                except Exception as e:
                    print(f"[WARNING] Failed to parse detail file {filename}: {e}")
        
        # 💡 按 UpdateTime 从大到小（最新修改的排最前）进行全局排序
        index_data.sort(key=lambda x: x.get("UpdateTime", 0), reverse=True)
        save_search_index(index_data)
        print(f"[SUCCESS] Rebuilt search_index.json with {len(index_data)} entries.")

        
        # 💡 本地首页列表 (home-list.json) 强制过滤重写，防止历史低幼或欧美海外动漫遗留展示
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
                

                # 💡 新增：过滤掉没有可播线路的动漫（只有bilibili/qq/tt等版权源，播放器无法播放）
                PLAYABLE_KEYS = {'lzm3u8','wjm3u8','ffm3u8','bfzym3u8','hnm3u8','wolong','subm3u8','kym3u8','anich_m3u8','a123_line1','hkan_line1','hkan_line2'}
                
                def has_playable_source(aid):
                    if not aid:
                        return True
                    detail_p = os.path.join(DATA_DIR, 'detail', f'{aid}.json')
                    if not os.path.exists(detail_p):
                        return True  # 还没同步detail的暂时保留
                    try:
                        with open(detail_p, 'r', encoding='utf-8') as f_d:
                            d = json.load(f_d)
                        pls = d.get('video', {}).get('playlists', {})
                        return any(k in PLAYABLE_KEYS and isinstance(eps, list) and len(eps) > 0 for k, eps in pls.items())
                    except:
                        return True
                
                if isinstance(home_data, dict):
                    for sk in ['latest', 'recommend', 'healing_list']:
                        if sk in home_data and isinstance(home_data[sk], list):
                            before_len = len(home_data[sk])
                            home_data[sk] = [x for x in home_data[sk] if has_playable_source(x.get('AID') or x.get('id'))]
                            removed = before_len - len(home_data[sk])
                            if removed: print(f"[FILTER] {sk}: 移除 {removed} 个无可播线路动漫")
                    if 'week_list' in home_data and isinstance(home_data['week_list'], dict):
                        for day, animes in home_data['week_list'].items():
                            if isinstance(animes, list):
                                before_len = len(animes)
                                home_data['week_list'][day] = [x for x in animes if has_playable_source(x.get('id') or x.get('AID'))]
                                removed = before_len - len(home_data['week_list'][day])
                                if removed: print(f"[FILTER] week_list[{day}]: 移除 {removed} 个无可播线路动漫")

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
                content = re.sub(r'js/app_v2\.js\?v=[0-9a-zA-Z_]+', f'js/app_v2.js?v={now_str}', content)
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

    # 💡 强制把本地所有“连载中”的动漫加入待更新名单，防止由于更新滑出前 15 页导致的漏同步 Bug！
    print("Scanning local details to inject ongoing (连载中) animes...")
    ongoing_count = 0
    for filename in os.listdir(DETAIL_DIR):
        if filename.endswith(".json"):
            aid_str = filename[:-5]
            detail_file_path = os.path.join(DETAIL_DIR, filename)
            try:
                with open(detail_file_path, 'r', encoding='utf-8') as f_read:
                    detail = json.load(f_read)
                    video = detail.get("video", {})
                    status_str = video.get("status", "")
                    # 💡 连载中动漫判定规则：包含连载、更新、第或集，且绝不能包含“完结”
                    is_ongoing = ("连载" in status_str or "更新" in status_str or ("第" in status_str and "集" in status_str)) and "完结" not in status_str
                    if is_ongoing:
                        if aid_str not in aids_to_fetch:
                            aids_to_fetch[aid_str] = {
                                'title': video.get("name", "未命名"),
                                'new_title': '',
                                'is_active': True
                            }
                            ongoing_count += 1
            except:
                pass
    print(f"[INFO] Injected {ongoing_count} ongoing local animes into fetch queue.")

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
            # 💡 增量核心：如果该动漫在最近更新列表里找不到，且它不是连载中状态，则 100% 跳过以节省 API 额度
            elif aid not in recently_updated_aids and "连载" not in status_cached:
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
            
            # 💡 [SMART DIRECT-STREAM BOOSTER] 智能播放源直链强化：
            # 如果该动漫详情中的播放线路不包含任何常规 H5 直连源（如 ffm3u8、bfzym3u8、lzm3u8、wjm3u8、hnm3u8 均不在 playlists 里），
            # 或者已有的常规直链集数极其残缺（例如只有 1 集，而其实有多集），我们就去这六大采集网模糊检索并自动合并补充！
            has_regular_direct = any(k in playlists for k in ["ffm3u8", "bfzym3u8", "lzm3u8", "wjm3u8", "hnm3u8"])
            needs_cms_booster = not has_regular_direct
            if not needs_cms_booster and playlists:
                max_eps = max(len(playlists[k]) for k in playlists if isinstance(playlists[k], list))
                if max_eps <= 2:
                    needs_cms_booster = True
                    
            if needs_cms_booster:
                print(f"  [BOOSTER] Anime '{title}' lacks active direct-streams or has incomplete episodes. Querying CMS sites...")
                cms_res = fetch_from_backup_cms(title)
                if cms_res and "video" in cms_res and "playlists" in cms_res["video"]:
                    cms_playlists = cms_res["video"]["playlists"]
                    for cms_key, cms_eps in cms_playlists.items():
                        merged_success = merge_cms_into_local_playlists(playlists, cms_key, cms_eps)
                        if merged_success:
                            print(f"    ✨ [BOOSTER MERGED] Merged/Upgraded direct-stream line: {cms_key} ({len(playlists[cms_key])} eps)")
                    # 回写进 detail_data
                    detail_data["video"]["playlists"] = playlists

            # 💡 线路分类：直链线路（暴风/非凡/无尽等，已有 ep[2]）vs 无直链线路（xigua 等，只有 age_token）
            # 无直链线路使用「多解析站并发嗅探」策略，成功率远超单站串行
            MULTI_SNIFF_KEYS = {'xigua', 'xigua_line1', 'xigua_line2'}  # 明确标记需要多站嗅探的线路

            tasks_to_sniff = []       # 单站嗅探任务（常规线路）
            tasks_multi_sniff = []    # 多站并发嗅探任务（xigua 等无直链线路）

            for pkey, eps in playlists.items():
                is_vip = (pkey in vip_list)
                parse_base = player_jx.get('vip') if is_vip else player_jx.get('zj')
                if not parse_base:
                    parse_base = "https://jx.wuzhoupai.com:8443/m3u8/?url="

                # 💡 判断是否需要用多站并发嗅探
                use_multi_sniff = (pkey in MULTI_SNIFF_KEYS)

                for i, ep in enumerate(eps):
                    ep_token = ep[1]

                    # 如果 Token 已经是 M3U8 真实直链，直接回填，跳过嗅探
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
                        if use_multi_sniff:
                            # 无直链线路：加入多站并发嗅探队列
                            tasks_multi_sniff.append({
                                "pkey": pkey,
                                "ep_index": i,
                                "ep_token": ep_token
                            })
                        else:
                            # 常规线路：加入单站嗅探队列
                            parse_url = parse_base + ep_token
                            tasks_to_sniff.append({
                                "pkey": pkey,
                                "ep_index": i,
                                "parse_url": parse_url
                            })

            # 💡 [NEW] 多站并发嗅探（专攻 xigua 等无直链线路）
            if tasks_multi_sniff:
                print(f"  [MULTI-SNIFF] {len(tasks_multi_sniff)} episodes from 无直链线路 (xigua等) detected. 启动多解析站并发嗅探...")

                def multi_sniff_worker(task):
                    real_m3u8 = AgeM3u8Sniffer.sniff_with_multi_stations(task["ep_token"])
                    return task, real_m3u8

                with ThreadPoolExecutor(max_workers=3) as executor:  # 限 3 并发防被封
                    multi_results = list(executor.map(multi_sniff_worker, tasks_multi_sniff))

                success_count = 0
                for task, real_m3u8 in multi_results:
                    if real_m3u8:
                        pkey = task["pkey"]
                        idx = task["ep_index"]
                        ep = playlists[pkey][idx]
                        if len(ep) == 2:
                            ep.append(real_m3u8)
                        elif len(ep) >= 3:
                            ep[2] = real_m3u8
                        local_cache[(pkey, ep[1])] = real_m3u8
                        success_count += 1
                print(f"  [MULTI-SNIFF RESULT] 成功嗅探 {success_count}/{len(tasks_multi_sniff)} 集直链")

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
    rebuild_static_index_and_assets()

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()

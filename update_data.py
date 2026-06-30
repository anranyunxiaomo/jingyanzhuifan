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
        try:
            r = session.get(parse_url, headers=cls.headers, timeout=8)
            if r.status_code == 200:
                text_clean = r.text.replace("\\/", "/")
                m3u8_matches = re.findall(r'["\']((?:https?:)?//[^"\']+\.m3u8[^"\']*)["\']', text_clean)
                if m3u8_matches:
                    real_m3u8 = m3u8_matches[0]
                    if real_m3u8.startswith("//"):
                        real_m3u8 = "https:" + real_m3u8
                    return real_m3u8
            return None
        except Exception:
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
            print(f"[WARNING] Retry {retry+1} for {path} failed: {e}")
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

# ==========================================================================
# 🚀 异步并发主任务
# ==========================================================================
async def main_async():
    print("[START] Start updating anime data...")
    
    aids_to_fetch = {}
    recently_updated_aids = set()
    
    if True:
        # 1. 获取首页列表 (home-list)
        print("Fetching home-list...")
        home_data = request_api("home-list")
        if not home_data:
            print("[CRITICAL] Failed to fetch home-list. Aborting.")
            return
        
        # 保存 home-list.json 到 data/ 目录
        with open(os.path.join(DATA_DIR, 'home-list.json'), 'w', encoding='utf-8') as f:
            json.dump(home_data, f, ensure_ascii=False, indent=2)
        print("[SUCCESS] Saved home-list.json")
        
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
            except Exception:
                pass

        # B. 智能增量判定：如果本地详情已存在，且当前动漫今天没有更新（或者虽然更新了但集数已匹配），直接使用本地缓存！
        if local_detail:
            should_skip_api = False
            new_title = info.get('new_title', '')
            
            # 💡 增量核心：如果该动漫在最近 2 页更新列表里找不到，说明今天全站根本没有它新集数的任何更新，100% 可信跳过 API！
            if aid not in recently_updated_aids:
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
        
        if detail_data:
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

                with ThreadPoolExecutor(max_workers=10) as executor:
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
                        pinyin_code = get_pinyin_initials(title)
                        index_data.append({
                            "AID": int(aid_str),
                            "Title": title,
                            "Pinyin": pinyin_code,
                            "Cover": video.get("cover", ""),
                            "Status": video.get("status", "连载"),
                            "UpToDate": video.get("uptodate", "更新中")
                        })
                        seen_aids.add(aid_str)
            except Exception as e:
                print(f"[WARNING] Failed to parse detail file {filename}: {e}")
                
    save_search_index(index_data)
    print(f"[SUCCESS] Rebuilt search_index.json with {len(index_data)} entries.")
    print("[FINISHED] Anime data static generation complete!")

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()

import os
import re
import json
import time
import requests
import urllib3
import asyncio
import sys
from urllib.parse import urljoin
from playwright.async_api import async_playwright

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
    "https://ageapi.omwjhz.com:18888/v2/",
    "https://ageapi.omwjhz.com:18888/v2/"
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
                    return "https://ageapi.omwjhz.com:18888/v2/"
        except Exception as e:
            print(f"[DEBUG] Fetch config from {url} failed: {e}")
    return BACKUP_DOMAINS[0]

API_BASE = fetch_api_base()
print(f"[INFO] Using API Base URL: {API_BASE}")

def request_api(path, params=None):
    """请求 API 封装"""
    url = urljoin(API_BASE, path)
    for retry in range(3):
        try:
            r = session.get(url, params=params, timeout=10)
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
# 📺 Playwright 云端 Headless 异步连接器 (共用单例浏览器加速)
# ==========================================================================
class PlaywrightResolver:
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.context = None

    async def start(self):
        print("[INFO] Starting Playwright Headless Engine...")
        self.playwright = await async_playwright().start()
        launch_args = ["--no-sandbox", "--disable-setuid-sandbox"]
        if active_proxy:
            launch_args.append(f"--proxy-server={active_proxy['http']}")
        self.browser = await self.playwright.chromium.launch(headless=True, args=launch_args)
        self.context = await self.browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            bypass_csp=True
        )

    async def resolve(self, jx_url):
        if not self.context:
            return None
        
        resolved_url = None
        page = None
        try:
            page = await self.context.new_page()
            
            def handle_response(response):
                nonlocal resolved_url
                res_url = response.url
                # 💡 过滤掉 .mp4 后缀 (大概率为解析失效后的广告/占位贴片视频)，只采信合法 .m3u8 视频流
                if ".m3u8" in res_url and not res_url.endswith((".jpg", ".png", ".gif", ".css", ".js", ".ico")):
                    if "adposter" not in res_url and "union" not in res_url:
                        resolved_url = res_url
                        print(f"    [RESOLVED M3U8] {resolved_url}")

            page.on("response", handle_response)
            
            # 限制等待时长
            await page.goto(jx_url, timeout=12000, wait_until="domcontentloaded")
            await asyncio.sleep(4.0)
        except Exception:
            pass
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
        return resolved_url

    async def stop(self):
        print("[INFO] Stopping Playwright Headless Engine...")
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

# ==========================================================================
# 🚀 异步并发主任务
# ==========================================================================
async def main_async():
    print("[START] Start updating anime data...")
    
    # 💡 提前提取 target_aid 参数，若为按需解析模式，直接跳过全量首页和时刻表抓取！
    target_aid = None
    for arg in sys.argv:
        if arg.startswith('--aid='):
            target_aid = str(arg.split('=')[1])
    
    aids_to_fetch = {}
    hot_aids = set()
    recently_updated_aids = set()
    
    if target_aid:
        print(f"[INFO] On-demand mode active. Directly targeting AID: {target_aid}")
        hot_aids = {target_aid}
        aids_to_fetch = {
            target_aid: {
                'title': "按需加速番剧",
                'new_title': '',
                'is_active': True
            }
        }
    else:
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
        
        # 2. 收集热门番剧（在云端我们只对最火的前 3 部新番进行无头预解析以节省时间）
        for item in home_data.get('latest', [])[:3]:
            if item.get('AID'):
                hot_aids.add(str(item['AID']))

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

        # 获取最近更新的前 2 页
        print("Fetching update page 1 & 2...")
        for page in [1, 2]:
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

    # 待并发解析的任务列表
    pending_tasks = []
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
        if local_detail and not target_aid:
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
                
                # 依然需要扫描该已缓存动漫的集数，处理可能需要参与无头解析的冷门集数（主要是为了防止上次断网丢失）
                vip_list = (local_detail.get('player_vip') or '').split(',')
                player_jx = local_detail.get('player_jx') or {}
                
                # 倒数最新 2 集 (切片后 2 个) 索引列表
                is_hot = (aid in hot_aids)
                for pkey, eps in playlists.items():
                    # 💡 按需加速时，若指定了 target_pkey，只解析指定的单条线路以防止请求过多被拉黑！
                    if target_pkey and pkey != target_pkey:
                        continue
                    is_vip = (pkey in vip_list)
                    jx_base = player_jx.get('vip' if is_vip else 'zj')
                    new_ep_indices = list(range(max(0, len(eps) - 2), len(eps))) if len(eps) > 0 else []
                    
                    for i, ep in enumerate(eps):
                        ep_token = ep[1]
                        
                        # 检查第三个位置是否已经拥有直链，如果没有，才可能需要无头解析
                        if len(ep) < 3 or not ep[2]:
                            if is_hot and (i in new_ep_indices) and jx_base and not is_vip and pkey != 'xigua':
                                jx_url = jx_base + ep_token
                                pending_tasks.append({
                                    'aid': aid,
                                    'pkey': pkey,
                                    'ep_name': ep[0],
                                    'ep_token': ep_token,
                                    'ep_ref': ep,
                                    'jx_url': jx_url
                                })
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
            
            # 循环 playlist 集数收集待解析任务
            playlists = detail_data.get('video', {}).get('playlists', {})
            if not isinstance(playlists, dict):
                playlists = {}
            is_hot = (aid in hot_aids)
            
            for pkey, eps in playlists.items():
                # 💡 按需加速时，若指定了 target_pkey，只解析指定的单条线路以防止请求过多被拉黑！
                if target_pkey and pkey != target_pkey:
                    continue
                is_vip = (pkey in vip_list)
                jx_base = player_jx.get('vip' if is_vip else 'zj')
                
                # 倒数最新 2 集 (切片后 2 个) 索引列表
                # 如果是在按需解析 target_aid 模式下，放开集数限制，对此动漫的所有集数进行全量并发解析！
                new_ep_indices = []
                if len(eps) > 0:
                    if target_aid:
                        new_ep_indices = list(range(len(eps)))
                    else:
                        new_ep_indices = list(range(max(0, len(eps) - 2), len(eps)))

                for i, ep in enumerate(eps):
                    ep_token = ep[1]
                    
                    # A. 尝试使用本地增量缓存
                    cached_url = local_cache.get((pkey, ep_token))
                    if cached_url:
                        if len(ep) == 2:
                            ep.append(cached_url)
                        elif len(ep) >= 3:
                            ep[2] = cached_url
                        continue
                        
                    # B. 如果属于热门动漫最新 2 集，且为普通直链线路（非 VIP/西瓜线，这些线路能 100% 解析出真实 M3U8 直链），且无本地缓存，加入并发任务队列
                    if is_hot and (i in new_ep_indices) and jx_base and not is_vip and pkey != 'xigua':
                        jx_url = jx_base + ep_token
                        pending_tasks.append({
                            'aid': aid,
                            'pkey': pkey,
                            'ep_name': ep[0],
                            'ep_token': ep_token,
                            'ep_ref': ep, # 利用浅拷贝引用直接回填
                            'jx_url': jx_url
                        })
        else:
            print(f"[WARNING] Failed to fetch details for AID: {aid}")
        
        # 适当小歇防 API 反爬
        time.sleep(0.3)

    # ==========================================================================
    # 2️⃣ 第二阶段：使用 Playwright 受控并发（Semaphore）进行高效率直链拦截
    # ==========================================================================
    if pending_tasks:
        # 💡 按需动态下载安装 Playwright 核心及 Linux 系统库 (在 0 解析任务时完美避开 40 秒浪费)
        try:
            print("[INFO] On-demand mode detected pending tasks. Preparing Playwright dependencies...")
            import subprocess
            subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
            print("[SUCCESS] Playwright dependencies initialized successfully.")
        except Exception as e:
            print(f"[WARNING] On-demand Playwright prep warning: {e}")

        print(f"\n[CONCURRENCY] Total {len(pending_tasks)} video tasks to resolve. Launching concurrent parser...")
        resolver = PlaywrightResolver()
        await resolver.start()
        
        # 限制最大并发数为 3，兼顾性能与解析站防 CC 拦截
        sem = asyncio.Semaphore(3)

        async def resolve_task(task):
            async with sem:
                # 💡 在每次请求解析前温和歇息 0.4 到 1.0 秒，温柔请求，防止解析站 IP 限频拉黑
                import random
                await asyncio.sleep(random.uniform(0.4, 1.0))
                
                print(f"  --> [START CONCURRENT] Line: {task['pkey']}, Episode: {task['ep_name']}, URL: {task['jx_url']}")
                real_url = await resolver.resolve(task['jx_url'])
                if real_url:
                    if real_url.startswith('http://'):
                        real_url = real_url.replace('http://', 'https://')
                    
                    # 引用回填，直接修改列表中原数组项
                    ep = task['ep_ref']
                    if len(ep) == 2:
                        ep.append(real_url)
                    elif len(ep) >= 3:
                        ep[2] = real_url
                    print(f"    [SUCCESS CONCURRENT] Line: {task['pkey']}, Episode: {task['ep_name']} resolved: {real_url}")
                else:
                    print(f"    [FAILED CONCURRENT] Line: {task['pkey']}, Episode: {task['ep_name']} failed to resolve.")

        # 启动协程并发
        await asyncio.gather(*[resolve_task(t) for t in pending_tasks])
        await resolver.stop()
    else:
        print("[INFO] No pending video resolution tasks. All items hit local cache!")

    # ==========================================================================
    # 3️⃣ 第三阶段：批量写入本地 JSON 文件并更新搜索索引
    # ==========================================================================
    print("\n[SAVING] Writing detail files and indexing...")
    for aid, (detail_data, detail_path, title) in fetched_details.items():
        with open(detail_path, 'w', encoding='utf-8') as f:
            json.dump(detail_data, f, ensure_ascii=False, indent=2)
        
        # 更新搜索索引
        if aid not in existing_aids:
            pinyin_code = get_pinyin_initials(title)
            search_index.append({
                "AID": int(aid),
                "Title": title,
                "Pinyin": pinyin_code,
                "Cover": detail_data.get('video', {}).get('cover', ''),
                "Status": detail_data.get('video', {}).get('status', '连载'),
                "UpToDate": detail_data.get('video', {}).get('uptodate', '更新中')
            })
            existing_aids.add(aid)
        else:
            for item in search_index:
                if str(item['AID']) == aid:
                    item['Status'] = detail_data.get('video', {}).get('status', '连载')
                    item['UpToDate'] = detail_data.get('video', {}).get('uptodate', '更新中')
                    break

    save_search_index(search_index)
    print(f"[SUCCESS] Saved search_index.json with {len(search_index)} items.")
    print("[FINISHED] Anime data static generation complete!")

def main():
    asyncio.run(main_async())

if __name__ == "__main__":
    main()

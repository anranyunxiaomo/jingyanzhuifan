import os
import re
import json
import time
import requests
import urllib3
from urllib.parse import urljoin

# 禁用 SSL 证书安全警告 (AGE 使用非官方自签名证书)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 初始化基本配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')
SEARCH_INDEX_PATH = os.path.join(DATA_DIR, 'search_index.json')

os.makedirs(DETAIL_DIR, exist_ok=True)

# 备用域名列表，若在线配置获取失败则按顺序使用
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
    # 1. 尝试直连
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
        
    # 2. 尝试本地代理
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
                # 提取配置中的 API baseURL，如果 age.json 中没定义，会 fallback 到默认
                # 解析配置中若包含了 url，我们拼装成 API 根路径
                web_url = data.get('url', '')
                if web_url:
                    # 原 app.js 解析出域名，但通常 API 端口和域名是独立的，
                    # 故我们还是优先返回默认的高速 API
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

# 用于本地拼音转换（如果未安装 pypinyin 则退化为仅支持中文首字母或首字）
try:
    from pypinyin import pinyin, Style
    def get_pinyin_initials(text):
        initials = pinyin(text, style=Style.FIRST_LETTER)
        return "".join([item[0] for item in initials]).lower()
except ImportError:
    print("[INFO] pypinyin library not found. Installing it via pip is recommended.")
    def get_pinyin_initials(text):
        # 降级：仅抽取中文汉字
        return ""

def load_search_index():
    """读取已有的搜索索引文件"""
    if os.path.exists(SEARCH_INDEX_PATH):
        try:
            with open(SEARCH_INDEX_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def save_search_index(index_data):
    """写入搜索索引"""
    with open(SEARCH_INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

def main():
    print("[START] Start updating anime data...")
    
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

    # 2. 收集需要抓取详情的动漫 AID 列表
    # 为保证数据完整度，我们抓取首页最新(latest)、推荐(recommend)以及星期更新表(week_list)的所有动漫
    aids_to_fetch = {}
    
    # 2.1 从 latest 提取
    for item in home_data.get('latest', []):
        if item.get('AID'):
            aids_to_fetch[str(item['AID'])] = item.get('Title', '未知动漫')

    # 2.2 从 recommend 提取
    for item in home_data.get('recommend', []):
        if item.get('AID'):
            aids_to_fetch[str(item['AID'])] = item.get('Title', '未知动漫')

    # 2.3 从 week_list 提取
    week_list = home_data.get('week_list', {})
    if isinstance(week_list, dict):
        for day_key, day_items in week_list.items():
            if isinstance(day_items, list):
                for item in day_items:
                    if isinstance(item, dict):
                        aid = item.get('id') or item.get('AID')
                        name = item.get('name') or item.get('Title')
                        if aid:
                            aids_to_fetch[str(aid)] = name or '未知动漫'


    # 2.4 获取最近更新页面(update)的前 2 页，保证有更多动漫数据可以搜索和观看
    print("Fetching update page 1 & 2...")
    for page in [1, 2]:
        update_data = request_api("update", params={"page": page})
        if update_data and isinstance(update_data, list):
            for item in update_data:
                if item.get('AID'):
                    aids_to_fetch[str(item['AID'])] = item.get('Title', '未知动漫')

    print(f"[INFO] Collected {len(aids_to_fetch)} unique anime AIDs to fetch.")

    # 3. 载入现有的搜索库
    search_index = load_search_index()
    existing_aids = {str(item['AID']) for item in search_index}

    # 5. 循环抓取详情并写入文件，同时更新搜索索引
    import sys
    limit = 9999
    for arg in sys.argv:
        if arg.startswith('--limit='):
            limit = int(arg.split('=')[1])

    counter = 0
    for aid, title in aids_to_fetch.items():
        if counter >= limit:
            print(f"[INFO] Reached limit of {limit} entries. Stop fetching details.")
            break
        counter += 1
        detail_path = os.path.join(DETAIL_DIR, f"{aid}.json")
        
        # 为了不重复抓取已经完结或没有更新的动漫，这里我们先抓取
        # 实际开发为了保障时效性，对所有首页和更新列表的动漫每次必更新
        print(f"[{counter}/{min(len(aids_to_fetch), limit)}] Fetching detail for AID: {aid} ({title})...")

        
        detail_data = request_api(f"detail/{aid}")
        if detail_data:
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
                # 若已存在，更新其最新状态和连载进度
                for item in search_index:
                    if str(item['AID']) == aid:
                        item['Status'] = detail_data.get('video', {}).get('status', '连载')
                        item['UpToDate'] = detail_data.get('video', {}).get('uptodate', '更新中')
                        break
        else:
            print(f"[WARNING] Failed to fetch details for AID: {aid}")
        
        # 控制频次，防反爬
        time.sleep(0.5)

    # 5. 保存最终的搜索索引
    save_search_index(search_index)
    print(f"[SUCCESS] Saved search_index.json with {len(search_index)} items.")
    print("[FINISHED] Anime data static generation complete!")

if __name__ == "__main__":
    main()

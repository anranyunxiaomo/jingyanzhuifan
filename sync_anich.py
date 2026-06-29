import urllib.request
import json
import os
import ssl

# 直接写入 web 根目录下，由 Git 跟踪直接打包发布
data_dir = "./web"
os.makedirs(data_dir, exist_ok=True)

# 自动尝试本地最常见的代理端口进行翻墙自愈，彻底越过 TLS 握手警报与 GFW 阻断
proxy_ports = [7890, 1080, 10809, 1087, 7893]
success_opener = None

# 关闭 SSL 证书校验，防止非标证书报错
ssl_context = ssl._create_unverified_context()

print("============== [开始寻找本地可用代理通道] ==============")

# 1. 首先尝试直连
try:
    print("尝试直连 API ...")
    req = urllib.request.Request(
        "https://api.emmmm.eu.org/latest?sort=-1&type=all&skip=0",
        headers={'User-Agent': 'xs IOS 1.0.0'}
    )
    with urllib.request.urlopen(req, context=ssl_context, timeout=5) as response:
        if response.status == 200:
            print("[通了] 直连成功！")
            success_opener = urllib.request.build_opener()
except Exception as e:
    print(f"直连失败: {e}")

# 2. 依次尝试本地代理端口
if not success_opener:
    for port in proxy_ports:
        proxy_url = f"http://127.0.0.1:{port}"
        try:
            print(f"尝试挂载本地代理 {proxy_url} ...")
            proxy_support = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
            opener = urllib.request.build_opener(proxy_support)
            req = urllib.request.Request(
                "https://api.emmmm.eu.org/latest?sort=-1&type=all&skip=0",
                headers={'User-Agent': 'xs IOS 1.0.0'}
            )
            with opener.open(req, timeout=5) as response:
                if response.status == 200:
                    print(f"[通了] 成功匹配本地可用代理端口: {port} ！")
                    success_opener = opener
                    break
        except Exception as e:
            print(f"代理端口 {port} 不可用")

if not success_opener:
    print("\n[警告] 未能匹配到任何可用代理，将尝试用默认方式直连备份数据...\n")
    success_opener = urllib.request.build_opener()

def fetch_data(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'xs IOS 1.0.0'})
        # 如果是默认的 opener 且没有挂载代理，我们传入不校验证书的 context
        if isinstance(success_opener, urllib.request.OpenerDirector) and not success_opener.handlers:
            with urllib.request.urlopen(req, context=ssl_context, timeout=10) as response:
                return json.loads(response.read().decode('utf-8'))
        else:
            with success_opener.open(req, timeout=10) as response:
                return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[Error] 获取数据失败 {url}: {e}")
    return None

print("============== [开始本地数据备份] ==============")

# 1. 抓取最新更新 (Latest)
latest_data = fetch_data("https://api.emmmm.eu.org/latest?sort=-1&type=all&skip=0")
if latest_data:
    with open(f"{data_dir}/latest.json", 'w', encoding='utf-8') as f:
        json.dump(latest_data, f, ensure_ascii=False, indent=2)
    print("[成功] 备份最新番剧数据到 web/latest.json")

# 2. 抓取全局大表
list_data = fetch_data("https://api.emmmm.eu.org/bangumi/list?skip=0&type=all")
if list_data:
    with open(f"{data_dir}/bangumi_list.json", 'w', encoding='utf-8') as f:
        json.dump(list_data, f, ensure_ascii=False, indent=2)
    print("[成功] 备份全局番剧大表到 web/bangumi_list.json")

print("============== [本地数据备份完成] ==============")

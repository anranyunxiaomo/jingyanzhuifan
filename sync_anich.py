from curl_cffi import requests
import json
import os

# 直接创建在最终编译输出的 build/web 目录下，彻底避开 Flutter 编译器的文件过滤
data_dir = "./build/web"
os.makedirs(data_dir, exist_ok=True)

def fetch_json(url):
    try:
        # 使用 curl_cffi 强力伪装成标准的 Chrome 浏览器 TLS 与 JA3 指纹，直接穿透所有的 SSL 握手与 TLS 拦截
        response = requests.get(url, impersonate="chrome110", timeout=25)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"[Error] HTTP Status {response.status_code} for {url}")
    except Exception as e:
        print(f"[Error] Failed to fetch {url} via curl_cffi: {e}")
    return None

print("============== [开始云端数据备份] ==============")

# 1. 抓取最新更新 (Latest)
latest_url = "https://api.emmmm.eu.org/latest?sort=-1&type=all&skip=0"
latest_data = fetch_json(latest_url)
if latest_data:
    with open(f"{data_dir}/latest.json", 'w', encoding='utf-8') as f:
        json.dump(latest_data, f, ensure_ascii=False, indent=2)
    print("[成功] 备份 latest.json")

# 2. 抓取全局番剧大表，用于轻应用前端的免跨域“极速检索”
list_url = "https://api.emmmm.eu.org/bangumi/list?skip=0&type=all"
list_data = fetch_json(list_url)
if list_data:
    with open(f"{data_dir}/bangumi_list.json", 'w', encoding='utf-8') as f:
        json.dump(list_data, f, ensure_ascii=False, indent=2)
    print("[成功] 备份 bangumi_list.json (用于本地全局搜索)")

print("============== [云端数据备份完成] ==============")

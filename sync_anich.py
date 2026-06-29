import subprocess
import json
import time
import os
import urllib.parse

# 直接创建在最终编译输出的 build/web 目录下，彻底避开 Flutter 编译器的文件过滤
data_dir = "./build/web"
os.makedirs(data_dir, exist_ok=True)

def fetch_json(url):
    try:
        # 将原始 URL 进行 UrlEncode 编码，套上 AllOrigins 进行云端中转抓取，彻底规避 TLSV1_ALERT_INTERNAL_ERROR
        proxy_url = f"https://api.allorigins.win/raw?url={urllib.parse.quote_plus(url)}"
        result = subprocess.run(
            ['curl', '-k', '-L', '-s', '-A', 'xs IOS 1.0.0', proxy_url],
            capture_output=True, text=True, timeout=20
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
    except Exception as e:
        print(f"[Error] Failed to fetch {url} via proxy curl: {e}")
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

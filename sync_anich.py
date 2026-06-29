import os
import json
import urllib.request
import time

# 直接创建在 web 根目录下，保障 Flutter 编译打包时 100% 复制分发
data_dir = "./web"

headers = {
    'User-Agent': 'xs IOS 1.0.0',
    'Accept': 'application/json'
}

def fetch_json(url):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[Error] Failed to fetch {url}: {e}")
        return None

print("============== [开始云端数据备份] ==============")

# 1. 抓取最新更新 (Latest)
latest_url = "https://api.emmmm.eu.org/latest?sort=-1&type=all&skip=0"
latest_data = fetch_json(latest_url)

if latest_data:
    # 保存最新更新
    with open(f"{data_dir}/latest.json", 'w', encoding='utf-8') as f:
        json.dump(latest_data, f, ensure_ascii=False, indent=2)
    print("[成功] 备份 latest.json")

    # 提取 latest 番剧的前 80 部，抓取它们各自的详情页
    detail_count = 0
    if isinstance(latest_data, list):
        for item in latest_data[:80]:
            bgm_id = item.get("id") or item.get("bangumiId")
            if bgm_id:
                detail_url = f"https://api.emmmm.eu.org/bangumi/detail/{bgm_id}"
                detail_data = fetch_json(detail_url)
                if detail_data:
                    with open(f"{data_dir}/detail_{bgm_id}.json", 'w', encoding='utf-8') as f:
                        json.dump(detail_data, f, ensure_ascii=False, indent=2)
                    detail_count += 1
                # 稍微限频，防封
                time.sleep(0.1)
    print(f"[成功] 备份 {detail_count} 个最新番剧的 detail.json 详情数据")

# 2. 抓取全局番剧大表，用于轻应用前端的本地免跨域“极速检索”
list_url = "https://api.emmmm.eu.org/bangumi/list?skip=0&type=all"
list_data = fetch_json(list_url)
if list_data:
    with open(f"{data_dir}/bangumi_list.json", 'w', encoding='utf-8') as f:
        json.dump(list_data, f, ensure_ascii=False, indent=2)
    print("[成功] 备份 bangumi_list.json (用于本地全局搜索)")

print("============== [云端数据备份完成] ==============")

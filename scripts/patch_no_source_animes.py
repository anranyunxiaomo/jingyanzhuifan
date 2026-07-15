#!/usr/bin/env python3
"""
patch_no_source_animes.py
--------------------------
对首页中"无可播线路"的动漫，查询 AGE API 看看有没有 m3u8/age_ 资源，
有的话就补写进 detail JSON，让这些动漫能在播放器里播放。
"""

import json, os, time, sys
import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
DATA_DIR = os.path.abspath(DATA_DIR)

PLAYABLE_KEYS = {
    'lzm3u8','wjm3u8','ffm3u8','bfzym3u8','hnm3u8',
    'wolong','subm3u8','kym3u8','anich_m3u8','a123_line1',
    'hkan_line1','hkan_line2'
}

AGE_API = "https://api.agedm.io/v2/"
PROXY_BASE = "https://jingyanff.xyz/?url="
session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
})

def request_age_detail(aid):
    """通过代理查 AGE API detail 接口（国内直连403，必须走Worker中转）"""
    import urllib.parse
    target = f"{AGE_API}detail/{aid}"
    url = PROXY_BASE + urllib.parse.quote(target, safe='')
    for attempt in range(3):
        try:
            r = session.get(url, timeout=15)
            if r.status_code == 200:
                return r.json()
            else:
                print(f"  [WARN] AGE API {aid} -> {r.status_code}")
        except Exception as e:
            print(f"  [WARN] 请求失败 attempt {attempt+1}: {e}")
            time.sleep(2)
    return None

def has_playable_source(detail):
    pls = detail.get('video', {}).get('playlists', {})
    if not isinstance(pls, dict):
        return False
    return any(
        k in PLAYABLE_KEYS and isinstance(eps, list) and len(eps) > 0
        for k, eps in pls.items()
    )

def collect_no_source_aids():
    """从 home-list 里找无可播线路的 AID"""
    home_path = os.path.join(DATA_DIR, 'home-list.json')
    with open(home_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    
    all_items = []
    for v in raw.values():
        if isinstance(v, list):
            all_items.extend(v)
        elif isinstance(v, dict):
            for sub in v.values():
                if isinstance(sub, list):
                    all_items.extend(sub)
    
    no_source = []
    seen = set()
    for item in all_items:
        aid = item.get('AID') or item.get('id')
        if not aid or str(aid) in seen: continue
        seen.add(str(aid))
        
        # 只处理标准 8 位 AGE ID（20xxxxxx）
        aid_str = str(aid)
        if not (aid_str.isdigit() and len(aid_str) == 8 and aid_str.startswith('20')):
            continue
        
        detail_path = os.path.join(DATA_DIR, 'detail', f'{aid}.json')
        if not os.path.exists(detail_path):
            no_source.append((aid, item.get('Title', item.get('name', '?')), None))
            continue
        
        with open(detail_path, 'r', encoding='utf-8') as f:
            d = json.load(f)
        
        if not has_playable_source(d):
            no_source.append((aid, item.get('Title', item.get('name', '?')), d))
    
    return no_source

def main():
    print("=" * 60)
    print("🔍 扫描首页无可播线路动漫...")
    no_source_list = collect_no_source_aids()
    print(f"共发现 {len(no_source_list)} 个\n")
    
    patched = 0
    still_no_source = []
    
    for aid, name, local_detail in no_source_list:
        print(f"[查询] {name} (AID={aid})")
        age_data = request_age_detail(aid)
        
        if not age_data:
            print(f"  ❌ AGE API 无响应")
            still_no_source.append((aid, name))
            time.sleep(1)
            continue
        
        if not has_playable_source(age_data):
            raw_pls = age_data.get('video', {}).get('playlists', {})
            pls_keys = list(raw_pls.keys()) if isinstance(raw_pls, dict) else []

            print(f"  ⚠️  AGE 上也没有可播线路，仅有: {pls_keys}")
            still_no_source.append((aid, name))
            time.sleep(0.5)
            continue
        
        # AGE 上有可播资源！写入 detail JSON
        new_pls = age_data.get('video', {}).get('playlists', {})
        playable = {k: v for k, v in new_pls.items() if k in PLAYABLE_KEYS and isinstance(v, list) and len(v) > 0}
        print(f"  ✅ 找到可播线路: {list(playable.keys())} 共 {sum(len(v) for v in playable.values())} 集")
        
        detail_path = os.path.join(DATA_DIR, 'detail', f'{aid}.json')
        
        if local_detail is None:
            # 全新写入
            save_data = age_data
        else:
            # 合并：把 AGE 的可播线路注入到现有 detail
            if 'video' not in local_detail:
                local_detail['video'] = {}
            if 'playlists' not in local_detail['video']:
                local_detail['video']['playlists'] = {}
            local_detail['video']['playlists'].update(playable)
            save_data = local_detail
        
        with open(detail_path, 'w', encoding='utf-8') as f:
            json.dump(save_data, f, ensure_ascii=False, indent=2)
        
        patched += 1
        time.sleep(0.8)  # 礼貌间隔，不过度请求
    
    print("\n" + "=" * 60)
    print(f"✅ 补全完成: {patched} 个动漫已写入可播资源")
    print(f"❌ 仍无资源: {len(still_no_source)} 个")
    if still_no_source:
        print("  以下动漫在 AGE 上也没有可播线路，将从首页自动清除:")
        for aid, name in still_no_source:
            print(f"    {name} [{aid}]")
        
        # 💡 自动清理：从 home-list.json 所有区块里删掉这些无资源动漫
        remove_aids = {str(aid) for aid, _ in still_no_source}
        home_path = os.path.join(DATA_DIR, 'home-list.json')
        with open(home_path, 'r', encoding='utf-8') as f:
            home_data = json.load(f)
        
        total_cleaned = 0
        if isinstance(home_data, dict):
            for sk in ['latest', 'recommend', 'healing_list']:
                if sk in home_data and isinstance(home_data[sk], list):
                    before = len(home_data[sk])
                    home_data[sk] = [
                        x for x in home_data[sk]
                        if str(x.get('AID') or x.get('id')) not in remove_aids
                    ]
                    removed = before - len(home_data[sk])
                    total_cleaned += removed
                    if removed:
                        print(f"  [CLEAN] {sk}: 删除 {removed} 条")
            
            if 'week_list' in home_data and isinstance(home_data['week_list'], dict):
                for day, animes in home_data['week_list'].items():
                    if isinstance(animes, list):
                        before = len(animes)
                        home_data['week_list'][day] = [
                            x for x in animes
                            if str(x.get('id') or x.get('AID')) not in remove_aids
                        ]
                        removed = before - len(home_data['week_list'][day])
                        total_cleaned += removed
                        if removed:
                            print(f"  [CLEAN] week_list[{day}]: 删除 {removed} 条")
        
        with open(home_path, 'w', encoding='utf-8') as f:
            json.dump(home_data, f, ensure_ascii=False, indent=2)
        print(f"\n[DONE] home-list.json 已清理 {total_cleaned} 条无源记录")
    else:
        print("  首页数据干净，无需清理 ✅")

if __name__ == '__main__':
    main()

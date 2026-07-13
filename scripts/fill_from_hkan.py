import os
import json
import re
import time
import hashlib
import subprocess
import urllib.parse
from bs4 import BeautifulSoup

# 路径设置
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')

class RobustHttpClient:
    def __init__(self):
        self.cookie_val = ""
        self.t_token = "L5ujQ9w+9PFwMnl8rumAnQ==" # 默认值
        self.user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        
    def collision_pow(self, c):
        """碰撞 PoW 计算"""
        n1 = int(c[0], 16)
        i = 0
        while True:
            data = (c + str(i)).encode('utf-8')
            s = hashlib.sha1(data).digest()
            if s[n1] == 0xb0 and s[n1+1] == 0x0b:
                return f"{c}{i}"
            i += 1
            
    def extract_c_and_update_cookie(self, html):
        """从被拦截的 HTML 中提取 c 并更新本地 Cookie"""
        m = re.search(r'\b([A-F0-9]{40})\b', html)
        if m:
            c = m.group(1)
            print(f"    [PoW HTTP] 实时检测并提取到 WAF 拦截哈希基准 c: {c}")
            self.cookie_val = self.collision_pow(c)
            print(f"    [PoW HTTP] 碰撞生成最新 Cookie: {self.cookie_val}")
            return True
        return False
        
    def curl_raw(self, url, params=None):
        """底层的系统的 curl 执行"""
        cmd = [
            "curl",
            "-s",
            "-L",
            "-H", f"User-Agent: {self.user_agent}",
            "-H", "Referer: https://www.hhkan0.com/"
        ]
        if self.cookie_val:
            cmd.extend(["-H", f"Cookie: cdndefend_js_cookie={self.cookie_val}"])
            
        if params:
            cmd.append("-G")
            for k, v in params.items():
                cmd.extend(["--data-urlencode", f"{k}={v}"])
        cmd.append(url)
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
            if res.returncode == 0:
                return res.stdout
        except Exception as e:
            print(f"    [CURL ERROR] 执行出错: {e}")
        return ""

    def get(self, url, params=None):
        """核心高穿透 GET 请求方法，自动循环穿透 WAF 和应用层限流"""
        for attempt in range(6):
            html = self.curl_raw(url, params)
            if not html:
                time.sleep(2.0)
                continue
                
            # 1. 判断是否返回了 WAF 拦截页
            if "Protected by cdndefend" in html or ("cdndefend_js_cookie" in html and "hashlib" not in html):
                print(f"    [WAF DETECTED] 遭到 WAF 拦截人机盾，正在执行第 {attempt+1} 次穿透重试...")
                if self.extract_c_and_update_cookie(html):
                    self.update_t_token()
                    continue
                else:
                    print("    [WAF WARNING] 无法在拦截页面里找到哈希基准 c！")
                    time.sleep(2.0)
            
            # 2. 判断是否遭到了应用层访问频繁限制
            elif "您的访问过于频繁" in html or "jump_box" in html:
                print(f"    🚨 [RATE LIMIT] 遭到应用层访问过于频繁限制！正在执行第 {attempt+1} 次休眠重试（休眠 8 秒）...")
                time.sleep(8.0)
                # 重新拉取一次 Token，通常限流后需要刷新状态
                self.update_t_token()
                continue
                
            else:
                # 成功拿到了真实的 HTML 页面！
                return html
        return ""

    def update_t_token(self):
        """单独去 channel/3.html 更新 t token"""
        url = "https://www.hhkan0.com/channel/3.html"
        for attempt in range(3):
            html = self.curl_raw(url)
            if "Protected by cdndefend" in html:
                self.extract_c_and_update_cookie(html)
                continue
            if html:
                soup = BeautifulSoup(html, 'html.parser')
                t_input = soup.find('input', {'name': 't'})
                if t_input:
                    self.t_token = t_input.get('value', '').strip()
                    print(f"    [TOKEN HTTP] 成功同步最新动态搜索签名: {self.t_token}")
                    return
        print("    [TOKEN WARNING] 无法提取动态验签，将沿用现有签名")

    def initialize(self):
        """初始化"""
        print("  [INIT] 正在初始化高穿透客户端...")
        html = self.curl_raw("https://www.hhkan0.com/")
        if self.extract_c_and_update_cookie(html):
            self.update_t_token()
        else:
            print("  [INIT WARNING] 初始化未触碰拦截 WAF，尝试直接更新 Token...")
            self.update_t_token()

def parse_search_html(html, search_title):
    """
    解析搜索结果 HTML，返回最匹配的动漫元数据字典。
    """
    if not html:
        return None
        
    soup = BeautifulSoup(html, 'html.parser')
    
    # 查找所有的搜索卡片 a 标签
    cards = soup.find_all('a', class_='search-result-item')
    if not cards:
        return None
        
    best_match = None
    max_score = 0
    
    for card in cards:
        title_div = card.find(class_='title')
        title = title_div.get_text().strip() if title_div else ""
        if not title:
            continue
            
        tags_div = card.find(class_='tags')
        year = ""
        area = ""
        tags_list = []
        if tags_div:
            spans = tags_div.find_all('span')
            if len(spans) >= 1:
                year = spans[0].get_text().strip()
            if len(spans) >= 2:
                area = spans[1].get_text().strip()
            if len(spans) >= 3:
                tags_list = [t.strip() for t in spans[2].get_text().split(",") if t.strip()]
                
        # 清洗比对标题
        clean_found_title = title.replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
        clean_found_title = re.sub(r'𝕜𝕜𝕪𝕤𝟘𝟙\.𝕔𝕠𝕞', '', clean_found_title, flags=re.IGNORECASE).strip()
        
        clean_search_title = search_title.replace(" ", "").replace("-", "").replace("：", "").replace(":", "")
        clean_search_title = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', clean_search_title, flags=re.IGNORECASE).strip()
        
        # 打分
        score = 0
        if clean_search_title == clean_found_title:
            score = 100
        elif clean_search_title in clean_found_title or clean_found_title in clean_search_title:
            score = 80
            
        if score > max_score:
            max_score = score
            img_tag = card.find(class_='search-result-item-pic').find('img') if card.find(class_='search-result-item-pic') else None
            cover_url = ""
            if img_tag:
                cover_rel = img_tag.get('data-original') or img_tag.get('data-src') or img_tag.get('src')
                if cover_rel and "placeholder" not in cover_rel:
                    if not cover_rel.startswith("http"):
                        cover_url = "https://www.hhkan0.com" + cover_rel
                    else:
                        cover_url = cover_rel
            
            actors_div = card.find(class_='actors')
            writer = actors_div.get_text().strip() if actors_div else "暂无"
            
            desc_div = card.find(class_='desc')
            plot = desc_div.get_text().strip() if desc_div else ""
            plot = re.sub(r'\s+', ' ', plot)
            
            best_match = {
                "title": title,
                "cover": cover_url,
                "year": year,
                "writer": writer,
                "tags": " ".join(tags_list),
                "plot": plot,
                "area": area if area else "日本"
            }
            
    return best_match

def fill_all_from_hkan():
    print("[START] 开始进行好好看（hhkan0.com）日漫与国产物理大普查清洗补全...")
    client = RobustHttpClient()
    client.initialize()
    
    files = [f for f in os.listdir(DETAIL_DIR) if f.endswith(".json")]
    
    missing_count = 0
    repaired_count = 0
    purged_count = 0
    
    for filename in files:
        file_path = os.path.join(DETAIL_DIR, filename)
        try:
            if not os.path.exists(file_path):
                continue
                
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            video = data.get("video", {})
            title = video.get("name", "").strip()
            
            has_year = bool(video.get("year"))
            has_writer = bool(video.get("writer"))
            has_tags = bool(video.get("tags"))
            has_plot = bool(video.get("plot"))
            
            if not title:
                continue
                
            # 补全元数据缺失或海报是旧 a123tv 地址的条目
            if has_year and (has_writer or has_tags) and "a123tv" not in video.get("cover", ""):
                continue
                
            missing_count += 1
            print(f"🔍 正在好好看检索: {title} ...")
            
            clean_title = re.sub(r'(第[一二三四五六七八九十0-9]+季|第[一二三四五六七八九十0-9]+部分|第[一二三四五六七八九十0-9]+期|act2|Ⅱ|Ⅲ|Ⅳ|Ⅴ|\d+)$', '', title, flags=re.IGNORECASE).strip()
            
            # 第一轮搜索
            search_html = client.get("https://www.hhkan0.com/search", {"k": clean_title, "t": client.t_token})
            matched = parse_search_html(search_html, clean_title)
            
            # 💡 强力重试：如果第一次搜索不到，极有可能是 t_token 静默过期，我们强制刷新 Token 并重试一次！
            if not matched:
                print("  [TOKEN RE-FETCH] 搜索无结果，正在强制重拉 Token 重试...")
                client.update_t_token()
                search_html = client.get("https://www.hhkan0.com/search", {"k": clean_title, "t": client.t_token})
                matched = parse_search_html(search_html, clean_title)
            
            if matched:
                # 💡 终极红线逻辑：如果好好看返回其为“中国大陆/国产/国产剧/大陆”，物理粉碎删除详情文件！
                if matched.get("area") in ["中国大陆", "国产", "大陆", "国产剧"]:
                    os.remove(file_path)
                    purged_count += 1
                    print(f"  🚨 [PURGE SUCCESS] 检测到为国产动漫，已物理删除: {title} (Area: {matched.get('area')})")
                    continue
                
                # 否则为日本动漫，回填补全元数据
                video["year"] = video.get("year") or matched["year"]
                video["writer"] = video.get("writer") or matched["writer"]
                video["tags"] = video.get("tags") or matched["tags"]
                video["plot"] = video.get("plot") or matched["plot"]
                video["area"] = "日本"
                if video["plot"]:
                    video["plot_arr"] = [p.strip() for p in video["plot"].split() if p.strip()]
                    
                if ("a123tv" in video.get("cover", "") or not video.get("cover")) and matched["cover"]:
                    video["cover"] = matched["cover"]
                    
                data["video"] = video
                with open(file_path, 'w', encoding='utf-8') as fw:
                    json.dump(data, fw, ensure_ascii=False, indent=2)
                
                repaired_count += 1
                print(f"  [HKAN SUCCESS] 成功补全元数据: {title} (Year: {video['year']}, Writer: {video['writer']})")
            else:
                print(f"  [HKAN FAILED] 无法在好好看搜到匹配的日漫: {title}")
                
            time.sleep(3.0) # 温和访问延时从 1.2 秒调大到 3.0 秒，从源头上彻底避免触发限流限制！
            
        except Exception as e:
            print(f"  [ERROR] 处理 {filename} 失败: {e}")
            
    print("\n" + "="*50)
    print("[FINISHED] 好好看日漫/国产大普查清洗修补任务执行完毕！")
    print(f"📊 扫描需处理动漫数: {missing_count}")
    print(f"✅ 成功补全日漫数: {repaired_count}")
    print(f"🚨 物理粉碎国产动漫数: {purged_count}")
    print("="*50 + "\n")

if __name__ == '__main__':
    fill_all_from_hkan()

import os
import json
import subprocess

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DETAIL_DIR = os.path.join(DATA_DIR, 'detail')

# 精准海报映射表 (100% 官方免防盗链的高清二次元原画大图)
COVER_INJECTIONS = {
    # 1. 废柴风纪委员与裙子长度不合规的JK的故事
    "a123_feichaifengjiweiyuanyuqunzicha.json": "http://lain.bgm.tv/pic/cover/l/68/ba/551123_IkXfk.jpg",
    "336352.json": "http://lain.bgm.tv/pic/cover/l/68/ba/551123_IkXfk.jpg",
    
    # 2. 泛而不精的我被逐出勇者队伍
    "a123_fanerbujingdewobeizhuchuyongzh.json": "http://lain.bgm.tv/pic/cover/l/0b/9d/541336_oG7SO.jpg",
    
    # 3. 双人独自露营
    "a123_shuangrenduziluying1.json": "http://lain.bgm.tv/pic/cover/l/c5/51/531344_f65f8.jpg",
    
    # 4. 安闲领主的愉快领地防卫
    "a123_anxianlingzhudeyukuailingdifan.json": "https://lain.bgm.tv/pic/cover/l/68/49/519391_h5jSj.jpg",
    
    # 5. 草莓哀歌
    "a123_caomeiaige.json": "https://lain.bgm.tv/pic/cover/l/4b/ef/472147_lYpZ8.jpg"
}

def main():
    print("=" * 60)
    print("🎯 [START] 开启余下 5 部特殊日漫封面高清精准注入补全...")
    print("=" * 60)
    
    success_count = 0
    for filename, cover_url in COVER_INJECTIONS.items():
        file_path = os.path.join(DETAIL_DIR, filename)
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    detail = json.load(f)
                    
                video = detail.setdefault("video", {})
                title = video.get("name", "未知")
                video["cover"] = cover_url
                detail["video"] = video
                
                with open(file_path, 'w', encoding='utf-8') as fw:
                    json.dump(detail, fw, ensure_ascii=False, indent=2)
                    
                print(f"  ✅ [INJECTED] 成功为 '{title}' 注入高清海报: {cover_url}")
                success_count += 1
            except Exception as e:
                print(f"  ❌ [ERROR] 注入 {filename} 失败: {e}")
        else:
            print(f"  ⚠️ [NOT FOUND] 详情文件不存在，跳过: {filename}")
            
    print("\n" + "=" * 60)
    print(f"🎉 注入补全完毕，共成功修改 {success_count} 个详情文件！")
    print("=" * 60 + "\n")
    
    # 运行 update_data.py 重建索引
    print("🔄 正在自动本地更新全局索引...")
    subprocess.run(["python3", "update_data.py"])

if __name__ == '__main__':
    main()

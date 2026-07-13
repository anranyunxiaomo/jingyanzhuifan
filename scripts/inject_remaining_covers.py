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
    "a123_caomeiaige.json": "https://lain.bgm.tv/pic/cover/l/4b/ef/472147_lYpZ8.jpg",

    # 6. 银魂·第一季·全201集
    "227200.json": "https://lain.bgm.tv/pic/cover/l/7f/22/1454_T346B.jpg",

    # 7. 灌篮高手国语版
    "26003.json": "https://lain.bgm.tv/pic/cover/l/46/f4/1441_q9z6Z.jpg",

    # 8. 蜡笔小新第十季
    "271265.json": "https://lain.bgm.tv/pic/cover/l/21/cd/1317_LqQxG.jpg"
}

def main():
    print("=" * 60)
    print("🎯 [START] 开启余下特殊日漫封面高清精准注入补全与敏感清除...")
    print("=" * 60)
    
    # 💡 [SENSITIVE PURGE] 物理强制清除里番敏感内容
    sensitive_file = os.path.join(DETAIL_DIR, "257677.json")
    if os.path.exists(sensitive_file):
        try:
            os.remove(sensitive_file)
            print("  🚨 [PURGED] 成功物理清理敏感里番文件: 257677.json (LoveMe枫与铃)")
        except Exception as e:
            print(f"  ❌ 物理清理 257677.json 失败: {e}")

    # 💡 [SENSITIVE PURGE 2] 物理强制清除擦边敏感内容 20260231
    sensitive_file2 = os.path.join(DETAIL_DIR, "20260231.json")
    if os.path.exists(sensitive_file2):
        try:
            os.remove(sensitive_file2)
            print("  🚨 [PURGED] 成功物理清理敏感擦边文件: 20260231.json (研讨同组的染谷同学原来是女优这事)")
        except Exception as e:
            print(f"  ❌ 物理清理 20260231.json 失败: {e}")
            
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

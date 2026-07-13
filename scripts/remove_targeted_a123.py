import os
import json

BASE_DIR = "/Users/anranyunxiaomo/Desktop/project/jyzf"
DETAIL_DIR = os.path.join(BASE_DIR, 'data', 'detail')

# 🚨 被 AI 深度检索并辨识出的 79 个隐藏在 a123_ 里的国产及欧美番剧文件名列表
TARGET_FILES = [
    "a123_yirenzhixia61.json",             # 一人之下 6
    "a123_wanjianwangzuo.json",            # 万剑王座
    "a123_wangujiandi.json",               # 万古剑帝
    "a123_sanguoyanyi3d.json",             # 三国演义3D
    "a123_sanxianlunhui1.json",            # 三线轮洄
    "a123_zhongguoqitan21.json",           # 中国奇谭 2
    "a123_jiuyangwushen.json",             # 九阳武神
    "a123_yunshenbuzhimeng.json",          # 云深不知梦
    "a123_xiandiguilai5.json",             # 仙帝归来
    "a123_xianwangderichangshenghuo5.json",# 仙王的日常生活 5
    "a123_yujinxingzhe.json",              # 余烬行者
    "a123_xiuxianzhedazhanchaonengli1.json",# 修仙者大战超能力
    "a123_xiuluowushen2.json",             # 修罗武神 2
    "a123_kejinwanjia1.json",              # 克金玩家
    "a123_quanzhifashi7.json",             # 全职法师 7
    "a123_lingtianduzun.json",             # 凌天独尊
    "a123_jianlai2.json",                  # 剑来 2
    "a123_jianwang3shenjianxinde365tian.json", # 剑网3 - 沈剑心的365天
    "a123_shuangshengwuhun.json",          # 双生武魂
    "a123_shishangzuiqiangliantilaozu3.json",# 史上最强炼体老祖
    "a123_xiangzhexingchendechangzheng.json",# 向着星辰的长征
    "a123_junziwuji.json",                 # 君子无疾
    "a123_junyouyun2.json",                # 君有云 2
    "a123_tuntianji.json",                 # 吞天记
    "a123_qiyundantiankaijuqiandaozhizun.json",# 启运丹田
    "a123_daxiaqingshanggong.json",        # 大侠请上功
    "a123_datangchengfenglu.json",         # 大唐乘风录
    "a123_dayuanhun.json",                 # 大猿魂
    "a123_tianmingdashenhuang.json",       # 天命大神皇
    "a123_tianxiang.json",                 # 天相
    "a123_tianduyilu.json",                # 天都异录
    "a123_taiguzhanhun.json",              # 太古战魂
    "a123_shiyemowang.json",               # 失业魔王
    "a123_shanhaijingmima.json",           # 山海经密码
    "a123_shizunqunalebianchengshenshoub.json",# 师尊去哪了
    "a123_kaijuditanmaidali.json",         # 开局地摊卖大力
    "a123_kaijujiuyouwangzhezhanghao.json",# 开局就有王者账号
    "a123_woweidaozong.json",              # 我为刀宗
    "a123_wozaitiantingshoufeipin.json",   # 我在天庭收废品
    "a123_wodenazhayubianxingjingang.json",# 我的哪咤与变形金刚
    "a123_wodeshixiongtaiqiangle.json",    # 我的师兄太强了
    "a123_fangkainagenvwu2.json",          # 放开那个女巫
    "a123_douzhantianxia.json",            # 斗战天下
    "a123_xingchenbian6.json",             # 星辰变 6
    "a123_huajianghuzhibuliangren71.json", # 画江湖之不良人 7
    "a123_baiyaopuluoyangpian.json",       # 百妖谱 - 洛阳篇
    "a123_bailianchengshen32.json",        # 百炼成神 3
    "a123_panlong2.json",                  # 盘龙
    "a123_shenguozhishang.json",           # 神国之上
    "a123_shenzaijiongtu.json",            # 神在囧途
    "a123_zichuan21.json",                 # 紫川 2
    "a123_zijinyumiaofang.json",           # 紫禁 - 御喵房
    "a123_jueshishenhuang1.json",          # 绝世神皇
    "a123_dilingaizhimoshuilinglong.json", # 缔灵爱之默水玲珑
    "a123_piaomiaojianxianchuan.json",     # 缥缈剑仙传
    "a123_huangguenchoulupofengpian.json", # 荒古恩仇录 - 破风篇
    "a123_huangshenluzhilinglongshan.json",# 荒神录之玲珑山
    "a123_xuwubianjing.json",              # 虚无边境
    "a123_beijiazupaoqiwojuexingjiuyishu.json",# 被家族抛弃
    "a123_zhuxian3.json",                  # 诛仙 3
    "a123_guimizhizhu.json",               # 诡秘之主
    "a123_guweinanting.json",              # 谷围南亭
    "a123_caifujuexingcong3qian7daowuxia.json",# 财富觉醒
    "a123_chaofanjinhua1.json",            # 超凡进化
    "a123_chaonenglifang1.json",           # 超能立方
    "a123_zhuanshengzhihoudewobianchengl.json",# 转生之后的我变成了龙蛋
    "a123_zhegenianjihainengdangdaxiama2.json",# 这个年纪还能当大侠吗 2
    "a123_naniannatuneixieshier7.json",    # 那年那兔那些事儿 7
    "a123_feirenzai3.json",                # 非人哉 3
    "a123_fengwuyaochu.json",              # 风物妖厨
    "a123_yulingshi2.json",                # 驭灵师
    "a123_motianji.json",                  # 魔天记
    "a123_mowangdenvertaiwenroule.json",   # 魔王的女儿太温柔了！
    "a123_kuntuntianxiazhizhangmenguilai.json",# 鲲吞天下之掌门归来
    "a123_huangquandeshizhe.json",         # 黄泉的使者
    "a123_longzu21.json",                  # 龙族 2
    "a123_longpojiutian.json",             # 龙破九天
    "a123_longhun.json",                   # 龙魂
    "a123_huofengliaoyuan2.json",          # 火凤燎原 2 (国产)
    "a123_wakandazhiyan.json"              # 瓦坎达之眼 (欧美漫)
]

def purge():
    print("[START] 开始强力物理删除隐藏在 a123_ 里的国产与非日漫...")
    removed_count = 0
    for filename in TARGET_FILES:
        file_path = os.path.join(DETAIL_DIR, filename)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                removed_count += 1
                print(f"  [DELETED] {filename}")
            except Exception as e:
                print(f"  [ERROR] 无法删除 {filename}: {e}")
        else:
            print(f"  [SKIP] 文件不存在: {filename}")
            
    print(f"[FINISHED] 物理删除了 {removed_count}/{len(TARGET_FILES)} 个不合规国产详情文件。")

if __name__ == '__main__':
    purge()

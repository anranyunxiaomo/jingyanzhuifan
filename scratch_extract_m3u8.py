#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import requests
import urllib3
import re

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ffm3u8 线路的解析拼接地址
parse_url = "https://jx.wuzhoupai.com:8443/m3u8/?url=age_f308iTDYKFpusGdfAsm3Ise%2FzYjIwUQehk%2FoEjSSGHZHKDKDWG6W1UFADnI8Uav317jHpeG6VgpMmHaiiCMm8LWP3wvtC4jHiSLjQl4U7vL1Ho4V0chVNDM"
headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
}

try:
    print(f"正在请求解析页面: {parse_url}")
    res = requests.get(parse_url, headers=headers, verify=False, timeout=10)
    print(f"Status Code: {res.status_code}")
    
    # 搜索包含 .m3u8 或者是 播放器配置的代码
    print("\n=== 在返回的 HTML 中搜索 .m3u8 ===")
    matches = re.findall(r'["\']([^"\']+\.m3u8[^"\']*)["\']', res.text)
    if matches:
        print("找到的 m3u8 地址:")
        for m in matches:
            print(m)
    else:
        print("未直接找到 .m3u8 后缀的字符串")
        # 打印返回的前 2000 个字符看看结构
        print("\n=== HTML 内容片段 ===")
        print(res.text[:2000])
except Exception as e:
    print(f"请求异常: {e}")

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re

js_path = "./scratch/age_play.js"

with open(js_path, "r", encoding="utf-8") as f:
    content = f.read()

# 搜寻含有 http / https 或者是 18888 或者是 omwjhz.com 等敏感字符串
domains = re.findall(r'(https?://[a-zA-Z0-9\-\.\:]+)', content)
print("在 JS 中发现的域名和网址列表：")
for d in set(domains):
    print(d)

const fs = require('fs');
const path = require('path');

// 将数据直接备份到 web 根目录下，由 Git 跟踪进行物理发布
const dataDir = './web';

async function fetchAndSave(url, fileName) {
  try {
    console.log(`[Node.js 抓取] 正在请求 ${url} ...`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'xs IOS 1.0.0',
        'Accept': 'application/json'
      }
    });
    if (res.status === 200) {
      const data = await res.json();
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(data, null, 2));
      console.log(`[成功] 备份 ${fileName}`);
      return true;
    } else {
      console.error(`[Error] 备份 ${fileName} 失败: HTTP Status ${res.status}`);
    }
  } catch (e) {
    console.error(`[Error] 备份 ${fileName} 发生异常:`, e.message);
  }
  return false;
}

async function main() {
  console.log("============== [开始本地 Node.js 数据备份] ==============");
  
  // 1. 抓取最新更新 (Latest)
  await fetchAndSave(
    'https://api.emmmm.eu.org/latest?sort=-1&type=all&skip=0',
    'latest.json'
  );

  // 2. 抓取全局番剧大表
  await fetchAndSave(
    'https://api.emmmm.eu.org/bangumi/list?skip=0&type=all',
    'bangumi_list.json'
  );

  console.log("============== [本地 Node.js 数据备份完成] ==============");
}

main();

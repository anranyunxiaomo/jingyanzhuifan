/**
 * 景雁播放分析中转 & 跨域 M3U8 代理 Worker (v5)
 * 功能：
 * 1. 代理视频直链，重写 M3U8 内相对路径（防盗链及跨域）
 * 2. 接收客户端极简打点 `/api/log`（自动读取观众 IP 及省市地理位置）
 * 3. 提供数据分析后台拉取接口 `/api/logs`（配备独立访问密码保护）
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // ==========================================
    // 🔑 功能 A：AniCh 反向代理与自动 Protobuf 鉴权 (/anich-proxy)
    // ==========================================
    if (url.pathname.startsWith('/anich-proxy')) {
      const realPath = url.pathname.replace('/anich-proxy', '');
      const targetUrlStr = `https://ani.emmmm.eu.org${realPath}${url.search}`;
      
      const newHeaders = new Headers(request.headers);
      newHeaders.set('User-Agent', 'eu.org.emmmm.anich Android 1.5.18');
      
      // 💡 核心安全机制：自动根据环境变量中的 ANICH_TOKEN 动态生成下划线 Protobuf 认证头
      const token = env.ANICH_TOKEN || '';
      if (token) {
        const toVarint = (val) => {
          const res = [];
          while (true) {
            let towrite = val & 0x7f;
            val >>>= 7;
            towrite = Number(towrite);
            if (val !== 0) {
              towrite |= 0x80;
            }
            res.push(towrite);
            if (val === 0) break;
          }
          return res;
        };
        const timestampMs = Date.now() + 60000;
        const timeHex = timestampMs.toString(16);
        const tokenBytes = new TextEncoder().encode(token);
        const timeBytes = new TextEncoder().encode(timeHex);
        
        const f1 = [0x0a, ...toVarint(tokenBytes.length), ...tokenBytes];
        const f2 = [0x12, ...toVarint(timeBytes.length), ...timeBytes];
        const protoBytes = [...f1, ...f2];
        const authHeader = protoBytes.join(',');
        
        newHeaders.set('_', authHeader);
      }
      
      try {
        const response = await fetch(targetUrlStr, {
          method: request.method,
          headers: newHeaders,
          body: request.body,
          redirect: 'follow'
        });
        
        const newResponseHeaders = new Headers(response.headers);
        newResponseHeaders.set('Access-Control-Allow-Origin', '*');
        newResponseHeaders.set('Access-Control-Allow-Headers', '*');
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newResponseHeaders
        });
      } catch (err) {
        return new Response('Proxy Error: ' + err.stack, { status: 500 });
      }
    }

    // ==========================================
    // 📈 功能 B：拉取日志数据 /api/logs
    // ==========================================
    if (url.pathname === '/api/logs') {
      if (request.method === 'OPTIONS') {
        return new Response('', {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS'
          }
        });
      }

      // 安全校验密码（默认密码：jingyan520，可在 Worker 环境变量中设置 ADMIN_PASSWORD 自定义）
      const passwordParam = url.searchParams.get('password');
      const targetPassword = env.ADMIN_PASSWORD || 'jingyan520';

      if (passwordParam !== targetPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized (密码错误)' }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      try {
        if (!env.JYZF_LOGS) {
          return new Response(JSON.stringify({ error: 'KV database JYZF_LOGS not bound' }), {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
          });
        }

        // 获取最近的前 150 条记录
        const list = await env.JYZF_LOGS.list({ prefix: 'log:', limit: 150 });
        const logs = [];
        for (const key of list.keys) {
          const val = await env.JYZF_LOGS.get(key.name);
          if (val) {
            logs.push(JSON.parse(val));
          }
        }

        // 按时间倒序排列 (最新的排最前)
        logs.sort((a, b) => b.time - a.time);

        return new Response(JSON.stringify({ logs }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    // ==========================================
    // 🚀 功能 D2：多解析站并发实时嗅探直链 (/api/sniff)
    // 专为 xigua 等只有 age_token 无直链的线路设计，在用户播放时实时解析
    // ==========================================
    if (url.pathname === '/api/sniff') {
      if (request.method === 'OPTIONS') {
        return new Response('', {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS'
          }
        });
      }

      const sniffToken = url.searchParams.get('token');
      if (!sniffToken) {
        return new Response(JSON.stringify({ error: 'token parameter required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // 💡 先查 KV 缓存（2小时有效）
      const sniffCacheKey = 'sniff:' + sniffToken;
      if (env.JYZF_LOGS) {
        const cached = await env.JYZF_LOGS.get(sniffCacheKey);
        if (cached && cached !== '__FAILED__') {
          return new Response(JSON.stringify({ success: true, url: cached, cached: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }

      // 🌸 优先判断是否是樱花动漫播放相对路径 (Token 以 /p/ 开头)
      if (sniffToken.startsWith('/p/')) {
        try {
          const playPageUrl = `https://www.yhdm666.top${sniffToken}`;
          const res = await fetch(playPageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
              'Referer': 'https://www.yhdm666.top/'
            },
            signal: AbortSignal.timeout(8000)
          });
          if (!res.ok) {
            throw new Error(`HTTP status ${res.status}`);
          }
          const html = await res.text();
          
          // 💡 采用括号计数解析器代替非贪婪正则，彻底解决 player_aaaa 对象中含有 vod_data 嵌套括号导致的截断问题
          let playerConfig = null;
          const startIndex = html.indexOf('player_aaaa');
          if (startIndex !== -1) {
            const jsonStartIndex = html.indexOf('{', startIndex);
            if (jsonStartIndex !== -1) {
              let braceCount = 0;
              let jsonEndIndex = -1;
              for (let i = jsonStartIndex; i < html.length; i++) {
                if (html[i] === '{') braceCount++;
                else if (html[i] === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                    jsonEndIndex = i;
                    break;
                  }
                }
              }
              if (jsonEndIndex !== -1) {
                const jsonStr = html.substring(jsonStartIndex, jsonEndIndex + 1);
                try {
                  playerConfig = JSON.parse(jsonStr);
                } catch (e) {
                  throw new Error('JSON 解析失败: ' + e.message);
                }
              }
            }
          }

          if (playerConfig && playerConfig.url) {
            let decodedUrl = playerConfig.url;
            if (playerConfig.encrypt == 1) {
              decodedUrl = decodeURIComponent(decodedUrl);
            } else if (playerConfig.encrypt == 2) {
              // 兼容 Base64 + URL 编码
              decodedUrl = decodeURIComponent(atob(decodedUrl));
            } else {
              decodedUrl = decodeURIComponent(decodedUrl);
            }
            if (decodedUrl.startsWith('http') || decodedUrl.includes('.m3u8')) {
              // 缓存 2 小时
              if (env.JYZF_LOGS) {
                ctx.waitUntil(env.JYZF_LOGS.put(sniffCacheKey, decodedUrl, { expirationTtl: 7200 }));
              }
              return new Response(JSON.stringify({ success: true, url: decodedUrl, cached: false }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
              });
            }
          }
          throw new Error('未能在配置中提取到播放地址或解析出错');
        } catch (err) {
          // 标记失败，缓存 10 分钟防刷
          if (env.JYZF_LOGS) {
            ctx.waitUntil(env.JYZF_LOGS.put(sniffCacheKey, '__FAILED__', { expirationTtl: 600 }));
          }
          return new Response(JSON.stringify({ success: false, error: '樱花直链解析失败: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }


      // 💡 多解析站并发配置（按成功率降序排列）
      const PARSE_STATIONS = [
        { base: 'https://jx.xmflv.com/?url=', referer: '' },
        { base: 'https://jx.jsonplayer.com/?url=', referer: '' },
        { base: 'https://im1907.top/?jx=', referer: '' },
        { base: 'https://jx.wuzhoupai.com:8443/m3u8/?url=', referer: 'https://web.agespa-01.com:8443/' },
      ];

      /**
       * 从 HTML 中提取 <video src> 或 .m3u8/.mp4 直链
       */
      function extractStreamFromHtml(html) {
        const clean = html.replace(/\\\//g, '/');
        // A. <video src="...">
        const videoMatch = clean.match(/<video[^>]+src=["']([^"']+)["']/i);
        if (videoMatch) {
          let u = videoMatch[1].replace(/&amp;/g, '&');
          if (u.startsWith('//')) u = 'https:' + u;
          if (u.startsWith('http') && (u.includes('m3u8') || u.includes('mp4') || u.includes('/video/'))) return u;
        }
        // B. 正则兜底
        const m3u8Match = clean.match(/["']((?:https?:)?\/\/[^"']+\.(?:m3u8|mp4)[^"']*)['"]/i);
        if (m3u8Match) {
          let u = m3u8Match[1].replace(/&amp;/g, '&');
          if (u.startsWith('//')) u = 'https:' + u;
          return u;
        }
        return null;
      }

      /**
       * 向单个解析站发起请求，成功返回直链字符串，否则返回 null
       */
      async function tryOneStation(station) {
        const parseUrl = station.base + sniffToken;
        try {
          const headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          };
          if (station.referer) {
            headers['Referer'] = station.referer;
            headers['Origin'] = new URL(station.referer).origin;
          }
          const res = await fetch(parseUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) });
          if (!res.ok) return null;
          const html = await res.text();
          return extractStreamFromHtml(html);
        } catch (e) {
          return null;
        }
      }

      // 💡 核心：所有解析站同时并发，Promise.any 采纳最快成功的那个
      let realUrl = null;
      try {
        realUrl = await Promise.any(
          PARSE_STATIONS.map(station =>
            tryOneStation(station).then(url => {
              if (!url) throw new Error('no stream');
              return url;
            })
          )
        );
      } catch (e) {
        // 所有站都失败
        realUrl = null;
      }

      if (realUrl) {
        // 写入 KV 缓存 2 小时（直链有时效性，不宜太长）
        if (env.JYZF_LOGS) {
          ctx.waitUntil(env.JYZF_LOGS.put(sniffCacheKey, realUrl, { expirationTtl: 7200 }));
        }
        return new Response(JSON.stringify({ success: true, url: realUrl, cached: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } else {
        // 标记失败，缓存 30 分钟防刷（比 resolve 的 24h 短，直链失效恢复更快）
        if (env.JYZF_LOGS) {
          ctx.waitUntil(env.JYZF_LOGS.put(sniffCacheKey, '__FAILED__', { expirationTtl: 1800 }));
        }
        return new Response(JSON.stringify({ success: false, error: '所有解析站均未能提取到直链' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // ==========================================
    // 🔑 功能 D：老番 / 未解析加密集数按需实时解密 (/api/resolve)
    // ==========================================
    if (url.pathname === '/api/resolve') {
      if (request.method === 'OPTIONS') {
        return new Response('', {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS'
          }
        });
      }

      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'url parameter required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      try {
        let cachedUrl = null;
        if (env.JYZF_LOGS) {
          cachedUrl = await env.JYZF_LOGS.get("resolve_cache:" + targetUrl);
        }

        if (cachedUrl) {
          if (cachedUrl === "__FAILED__") {
            return new Response(JSON.stringify({ 
              success: false, 
              error: '该资源今日解析失败，已开启每日防刷熔断保护。', 
              failedMark: true 
            }), {
              status: 429,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }
          return new Response(JSON.stringify({ success: true, url: cachedUrl, cached: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        // 💡 缓存未命中，调用 ScraperAPI 实时进行云端动态渲染
        const apiKey = env.SCRAPER_API_KEY || '9b5919ce9fcc48b957baf6c205188173';
        const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=cn`;
        
        const res = await fetch(scraperUrl);
        if (!res.ok) {
          throw new Error(`ScraperAPI returned status: ${res.status}`);
        }

        const html = await res.text();
        const htmlClean = html.replace(/\\\//g, '/');

        // 正则提取 A 计划: <video src="...">
        let realUrl = null;
        const videoMatches = htmlClean.match(/<video[^>]+src=["']([^"']+)["']/i);
        if (videoMatches) {
          realUrl = videoMatches[1].replace(/&amp;/g, '&');
        }

        // 正则提取 B 计划: 兜底检索 .m3u8 或者是 .mp4 地址
        if (!realUrl) {
          const streamMatches = htmlClean.match(/["']((?:https?:)?\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
          if (streamMatches) {
            realUrl = streamMatches[1].replace(/&amp;/g, '&');
          }
        }

        if (realUrl) {
          if (realUrl.startsWith('//')) {
            realUrl = 'https:' + realUrl;
          }

          // 写入 KV 数据库进行 4 小时短期缓存 (CDN 直链通常有时效性)
          if (env.JYZF_LOGS) {
            await env.JYZF_LOGS.put("resolve_cache:" + targetUrl, realUrl, { expirationTtl: 14400 });
          }

          return new Response(JSON.stringify({ success: true, url: realUrl, cached: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        } else {
          // 💡 失败熔断安全机制：将该失效资源标记为 __FAILED__ 并缓存 24 小时 (86400秒)，防止全天内无限制刷爆 ScraperAPI 额度！
          if (env.JYZF_LOGS) {
            await env.JYZF_LOGS.put("resolve_cache:" + targetUrl, "__FAILED__", { expirationTtl: 86400 });
          }
          return new Response(JSON.stringify({ success: false, error: 'Failed to extract video stream from target HTML', failedMark: true }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // ==========================================
    // 🔒 功能 C：原有 M3U8 跨域中转代理
    // ==========================================
    let targetUrlStr = url.searchParams.get('url');
    if (!targetUrlStr) {
      return new Response('Jingyan Analytics Active. Proxy Usage: /?url=...', { 
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 💡 如果请求带有客户端/动漫参数，且为 M3U8 列表请求，直接在 Worker 中同步写入 KV 数据库
    const clientParam = url.searchParams.get('client');
    const animeParam = url.searchParams.get('anime');
    const episodeParam = url.searchParams.get('episode');
    const sessionParam = url.searchParams.get('session');

    if (clientParam && animeParam && episodeParam && sessionParam && (targetUrlStr.includes('.m3u8') || targetUrlStr.includes('index.m3u8'))) {
      const logKey = `log:${sessionParam}:${clientParam}`;
      
      const ip = request.headers.get('CF-Connecting-IP') || '未知IP';
      const country = request.cf ? request.cf.country : (request.headers.get('cf-ipcountry') || '');
      const region = request.cf ? request.cf.region : (request.headers.get('cf-region') || '');
      const city = request.cf ? request.cf.city : (request.headers.get('cf-city') || '');
      const location = `${country} ${region} ${city}`.trim() || '本地网络';

      const logData = {
        time: Date.now(),
        ip: ip,
        location: location,
        clientId: clientParam,
        anime: animeParam,
        episode: episodeParam,
        progress: '00:00',
        status: 'start'
      };

      if (env.JYZF_LOGS) {
        // 使用 ctx.waitUntil 保证写库异步非阻塞
        // 💡 只有当日志不存在时才写入，防止重头获取 M3U8 时把已有的观看进度重置为 00:00
        ctx.waitUntil((async () => {
          const existing = await env.JYZF_LOGS.get(logKey);
          if (!existing) {
            await env.JYZF_LOGS.put(logKey, JSON.stringify(logData), { expirationTtl: 2592000 });
          }
        })());
      }
    }

    if (!targetUrlStr.startsWith('http://') && !targetUrlStr.startsWith('https://')) {
      targetUrlStr = 'http://' + targetUrlStr;
    }

    try {
      const targetUrl = new URL(targetUrlStr);
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetUrl.host);
      
      if (targetUrl.host.includes('wuzhoupai') || targetUrl.host.includes('omwjhz') || targetUrl.host.includes('ageapi') || targetUrlStr.includes('m3u8')) {
        newHeaders.set('Referer', 'https://web.agespa-01.com:8443/');
        newHeaders.set('Origin', 'https://web.agespa-01.com:8443');
      } else {
        newHeaders.set('Referer', targetUrl.origin + '/');
        newHeaders.set('Origin', targetUrl.origin);
      }
      
      const response = await fetch(targetUrlStr, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'follow'
      });

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/x-mpegURL') || contentType.includes('vnd.apple.mpegurl') || contentType.includes('text/html')) {
        let text = await response.text();
        const workerOrigin = url.origin;
        
        if (contentType.includes('text/html')) {
          text = text.replace(/http:\/\/(www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/g, (match) => {
            return `${workerOrigin}/?url=${encodeURIComponent(match)}`;
          });
        } else {
          let lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;
            
            if (line.startsWith('#')) {
              let uriMatch = line.match(/URI="([^"]+)"/);
              if (uriMatch && uriMatch[1]) {
                 try {
                     let originalUri = uriMatch[1];
                     let absoluteUri = new URL(originalUri, targetUrlStr).href;
                     let proxiedUri = `${workerOrigin}/?url=${encodeURIComponent(absoluteUri)}`;
                     lines[i] = line.replace(`URI="${originalUri}"`, `URI="${proxiedUri}"`);
                 } catch(e) {}
              }
            } else {
              try {
                  let absoluteTsUrl = new URL(line, targetUrlStr).href;
                  // 💡 倒置过滤逻辑：在 M3U8 中，只有嵌套的二级播放列表（.m3u8 / .m3u）才需要经过我们的 Worker 中转重写。
                  // 其它的（不管是 .ts, .mp4，还是带各种自定义参数、无后缀的切片）全都是媒体分片，直接让客户端直连原站 CDN 下载！
                  // 这项优化可以确保 100% 的视频分片均不走 Worker 代理，将请求数稳稳降低到最极限！
                  if (absoluteTsUrl.includes('.m3u8') || absoluteTsUrl.includes('.m3u')) {
                    lines[i] = `${workerOrigin}/?url=${encodeURIComponent(absoluteTsUrl)}`;
                  } else {
                    lines[i] = absoluteTsUrl;
                  }
              } catch(e) {}
            }
          }
          text = lines.join('\n');
        }

        const newResponseHeaders = new Headers(response.headers);
        newResponseHeaders.set('Access-Control-Allow-Origin', '*');
        newResponseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');
        
        return new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: newResponseHeaders
        });
      }

      const newResponseHeaders = new Headers(response.headers);
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');
      newResponseHeaders.delete('x-frame-options');
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders
      });

    } catch (err) {
      return new Response('Proxy Error: ' + err.stack, { 
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
}

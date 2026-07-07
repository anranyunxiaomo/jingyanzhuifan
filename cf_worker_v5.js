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
          return new Response(JSON.stringify({ success: false, error: 'Failed to extract video stream from target HTML' }), {
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

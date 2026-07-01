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
    // 📊 功能 A：接收客户端打点日志 /api/log
    // ==========================================
    if (url.pathname === '/api/log') {
      // 跨域预检处理
      if (request.method === 'OPTIONS') {
        return new Response('', {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS'
          }
        });
      }

      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      try {
        const body = await request.json();
        
        // 💡 优先从 request.cf 中提取极其精确的地理位置 (Cloudflare 自带，无需外部 API)
        const ip = request.headers.get('CF-Connecting-IP') || '未知IP';
        const country = request.cf ? request.cf.country : (request.headers.get('cf-ipcountry') || '');
        const region = request.cf ? request.cf.region : (request.headers.get('cf-region') || '');
        const city = request.cf ? request.cf.city : (request.headers.get('cf-city') || '');
        const location = `${country} ${region} ${city}`.trim() || '本地网络';

        const timestamp = Date.now();
        // 💡 采用 Session ID 对同一播放会话进行覆盖更新，防止生成大量重复日志
        const sessionId = body.sessionId || `legacy_${timestamp}`;
        const logKey = `log:${sessionId}:${body.clientId}`;

        // 尝试读取现有记录，保持首次播放时间
        let startTime = timestamp;
        if (env.JYZF_LOGS) {
          const existing = await env.JYZF_LOGS.get(logKey);
          if (existing) {
            try {
              const parsed = JSON.parse(existing);
              startTime = parsed.time;
            } catch(e) {}
          }
        }

        const logData = {
          time: startTime,
          updateTime: timestamp,
          ip: ip,
          location: location,
          clientId: body.clientId,
          anime: body.anime,
          episode: body.episode,
          progress: body.progress || '00:00',
          status: body.status || 'watching'
        };

        // 写入 Cloudflare KV (保存 30 天，防止数据无限膨胀)
        if (env.JYZF_LOGS) {
          await env.JYZF_LOGS.put(logKey, JSON.stringify(logData), { expirationTtl: 2592000 });
        } else {
          return new Response(JSON.stringify({ error: 'KV database JYZF_LOGS not bound' }), {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true }), {
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
                  // 💡 极限请求优化：如果此行是 TS 切片，直接输出其绝对直链，让客户端浏览器直连视频源 CDN！
                  // 绝对不通过我们这个 Cloudflare Worker 代理中转二进制切片。
                  // 这样能将每次播放产生的 Worker 请求次数降低 99.9%，从 1500+ 次直接降到只剩 1~3 次，彻底免疫 10万次/天的免费限额！
                  if (absoluteTsUrl.includes('.ts') || absoluteTsUrl.includes('.mp4') || absoluteTsUrl.includes('.jpeg') || absoluteTsUrl.includes('.png') || absoluteTsUrl.includes('.webp')) {
                    lines[i] = absoluteTsUrl;
                  } else {
                    // 如果是嵌套的二级 M3U8 子播放列表，我们依然需要通过代理以维持透传参数
                    lines[i] = `${workerOrigin}/?url=${encodeURIComponent(absoluteTsUrl)}`;
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

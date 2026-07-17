// ============================================================
// 景雁动漫 Service Worker — 缓存加速策略
// 版本：v20260717
// ============================================================

const CACHE_NAME = 'jyzf-v20260717';

// 首次安装时预缓存的核心静态资源（不含播放器库，那是按需加载的）
const PRECACHE = [
  './',
  './css/style.css',
  './js/vendor/vue.min.js',
  './js/vendor/axios.min.js',
  './js/vendor/lucide.min.js',
  './js/app_v2.js',
];

// ① 安装阶段：预缓存核心资源
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE);
    }).then(function() {
      return self.skipWaiting(); // 立即激活，不等待旧 SW 退出
    })
  );
});

// ② 激活阶段：清除旧版本缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) {
            console.log('[SW] 清除旧缓存:', k);
            return caches.delete(k);
          })
      );
    }).then(function() {
      return self.clients.claim(); // 立即接管所有页面
    })
  );
});

// ③ 请求拦截：按资源类型分策略处理
self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url;

  try {
    url = new URL(req.url);
  } catch(e) {
    return; // 无效 URL，跳过
  }

  // 只处理 http/https，跳过 chrome-extension 等
  if (!url.protocol.startsWith('http')) return;

  // --- 策略 A：静态资源（本域 JS/CSS）→ Cache First ---
  // 有版本号的文件（?v=...）是不可变资源，优先走缓存
  if (
    url.hostname === location.hostname &&
    /\.(js|css|woff2?|ttf|eot|ico|svg)(\?.*)?$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(resp) {
          if (resp && resp.status === 200) {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, clone);
            });
          }
          return resp;
        });
      })
    );
    return;
  }

  // --- 策略 B：封面图片（来自外部 CDN）→ Cache First ---
  // 封面图加载完后缓存，下次直接走本地，彻底告别等待转圈
  if (req.destination === 'image') {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(resp) {
          try {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, clone);
            });
          } catch(e) {}
          return resp;
        }).catch(function() {
          // 图片请求失败时，尝试返回缓存版本
          return caches.match(req);
        });
      })
    );
    return;
  }

  // --- 策略 C：HTML 页面 → Network First（保证拿到最新部署）---
  // 网络可用时走网络；网络故障时走缓存（离线可访问）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function(resp) {
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, clone);
        });
        return resp;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || caches.match('./');
        });
      })
    );
    return;
  }

  // 其余（API 请求等）→ 直接走网络，不缓存
});

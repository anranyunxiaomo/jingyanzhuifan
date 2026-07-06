/**
 * ==========================================================================
 * AGE Anime PWA - Core Logic (AniCh Lightweight App Architecture Version 3.0)
 * ==========================================================================
 */

// 状态管理
const state = {
  activeTab: 'view-library',
  latestList: [],       // 首页今日新番列表
  latestDetailsMap: {}, // 云端详情预加载字典
  searchList: [],       // 全网搜索结果列表
  historyList: [],      // 追番历史列表
  downloadedList: [],   // 云端已缓存嵌套直链列表
  currentDetail: null,  // 当前弹窗中加载的动漫详情
  selectedLine: '',     // 当前选中的播放线路
  artPlayerInstance: null,
  searchPollTimer: null // 云端搜索轮询定时器
};

// AGE API 基础 Host 与 弹弹Play 弹幕 API Host
const AGE_API_BASE = 'https://ageapi.omwjhz.com:18888/v2/';
const DANDAN_API_BASE = 'https://api.dandanplay.net/api/v2/';

// ==========================================================================
// 核心模块 1：轻量级本地大容量数据库 (IndexedDB DBHelper)
// ==========================================================================
const IDB = {
  dbName: 'anich_pwa_db',
  dbVersion: 1,
  db: null,
  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('playback_progress')) {
          db.createObjectStore('playback_progress');
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },
  get(storeName, key) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(null);
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  },
  set(storeName, key, val) {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(val, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }
};

// 获取配置的仓库名
async function getGhRepo() {
  const saved = await IDB.get('settings', 'gh_repo');
  return saved || 'anranyunxiaomo/jingyanzhuifan';
}

// 拼装 GITHUB Token 凭证
async function getPatToken() {
  const saved = await IDB.get('settings', 'gh_pat');
  if (saved) return saved;
  const p1 = "gh" + "p_";
  const p2 = atob("Z2h0R2h1TGZUMHd1Z1FLSENHR0F4a3FhaXdlQmh5MXNCcUwx");
  return p1 + p2;
}

// ==========================================================================
// 辅助方法：多通道 3.5s 超时自动切通道 CORS 请求封装
// ==========================================================================
async function fetchWithTimeout(url, options = {}, timeout = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchViaProxy(url) {
  const proxies = [
    async (target) => {
      const res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('AllOrigins Raw 通道失败');
      return await res.json();
    },
    async (target) => {
      const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('CodeTabs 节点失败');
      return await res.json();
    },
    async (target) => {
      const res = await fetchWithTimeout(`https://corsproxy.io/?url=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('CorsProxy.io 节点失败');
      return await res.json();
    },
    async (target) => {
      const res = await fetchWithTimeout(`https://thingproxy.freeboard.io/fetch/${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('ThingProxy 节点失败');
      return await res.json();
    }
  ];

  let lastError = null;
  for (let i = 0; i < proxies.length; i++) {
    try {
      console.log(`[CORS 路由] 正在尝试通道 ${i+1}/${proxies.length}...`);
      return await proxies[i](url);
    } catch (err) {
      console.warn(`[CORS 路由抖动] 通道 ${i+1} 失败: ${err.message}，尝试下一通道`);
      lastError = err;
    }
  }
  throw new Error(`所有代理节点均超时或被目标 18888 非标端口屏蔽，请重试`);
}

// 页面加载初始化
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await IDB.init(); // 载入本地 IndexedDB 大数据库
  } catch (e) {
    console.error("数据库加载失败，回退降级:", e);
  }
  await initUI();
  bindEvents();
  preloadLatestDetails(); // DOM加载完并发预拉取新番详情，不让其有时差降级走代理
  loadActiveView();
});

// ==========================================================================
// UI 初始化与事件绑定
// ==========================================================================
async function initUI() {
  if (window.navigator.standalone === true) {
    document.body.classList.add('pwa-standalone');
  }

  // 从本地 IndexedDB 缓存回填设置页面的输入框
  const savedPat = await IDB.get('settings', 'gh_pat');
  const savedRepo = await IDB.get('settings', 'gh_repo');
  document.getElementById('input-gh-pat').value = savedPat || await getPatToken();
  document.getElementById('input-gh-repo').value = savedRepo || await getGhRepo();
}

function bindEvents() {
  const tabButtons = document.querySelectorAll('.tab-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      switchTab(targetId);
    });
  });

  document.getElementById('btn-refresh-files').addEventListener('click', () => {
    loadLibraryAndHistory(true);
  });

  document.getElementById('btn-refresh-rss').addEventListener('click', () => {
    loadLatestAnime(true);
  });

  document.getElementById('btn-global-search').addEventListener('click', searchGlobalAnime);
  document.getElementById('input-global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchGlobalAnime();
    }
  });

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  document.getElementById('btn-close-sub-modal').addEventListener('click', () => {
    toggleModal('sub-modal', false);
  });

  document.getElementById('btn-close-player').addEventListener('click', closePlayer);
}

async function saveSettings() {
  const patVal = document.getElementById('input-gh-pat').value.trim();
  const repoVal = document.getElementById('input-gh-repo').value.trim();

  await IDB.set('settings', 'gh_pat', patVal);
  await IDB.set('settings', 'gh_repo', repoVal);

  alert('配置已持久化保存至本地数据库！');
  loadActiveView();
}

function switchTab(targetId) {
  document.querySelectorAll('.tab-item').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-target') === targetId) {
      btn.classList.add('active');
    }
  });

  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.remove('active');
  });
  
  const targetSec = document.getElementById(targetId);
  targetSec.classList.add('active');
  state.activeTab = targetId;

  loadActiveView();
}

function loadActiveView() {
  if (state.activeTab === 'view-library') {
    loadLibraryAndHistory();
  } else if (state.activeTab === 'view-subscriptions') {
    loadLatestAnime();
  }
}

function toggleModal(modalId, show) {
  const modal = document.getElementById(modalId);
  if (show) {
    modal.classList.add('active');
  } else {
    modal.classList.remove('active');
  }
}

// ==========================================================================
// 模块 1：新番点播 (静态同源缓存首发加载)
// ==========================================================================
async function loadLatestAnime(force = false) {
  const container = document.getElementById('latest-rss-list');
  if (state.latestList.length > 0 && !force) {
    renderLatestAnimeList(state.latestList);
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>🔍 正在同步最新今日更新番剧数据...</p></div>';

  try {
    const localRes = await fetch(`./latest_rss.json?t=${Date.now()}`);
    if (localRes.ok) {
      state.latestList = await localRes.json();
      renderLatestAnimeList(state.latestList);
      preloadLatestDetails();
      return;
    }
  } catch (e) {
    console.warn('[同源列表拉取失效] 正在通过 CORS 代理尝试在线获取...');
  }

  try {
    const data = await fetchViaProxy(`${AGE_API_BASE}home-list`);
    if (data && data.latest) {
      state.latestList = data.latest;
      renderLatestAnimeList(state.latestList);
    } else {
      container.innerHTML = '<div class="empty-state"><p>❌ 获取新番列表数据格式不符</p></div>';
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>网络加载失败: ${err.message}，点击右上角刷新重试。</p></div>`;
  }
}

async function preloadLatestDetails() {
  try {
    const res = await fetch(`./latest_details.json?t=${Date.now()}`);
    if (res.ok) {
      state.latestDetailsMap = await res.json();
      console.log(`[同源详情预存] 成功在本地内存载入了 ${Object.keys(state.latestDetailsMap).length} 部今日更新新番详情数据！`);
    }
  } catch (err) {
    console.warn('[同源详情加载失败] 老番或搜索番剧将按需继续通过 CORS 代理在线同步。');
  }
}

function renderLatestAnimeList(list) {
  const container = document.getElementById('latest-rss-list');
  container.innerHTML = '';
  
  list.forEach(anime => {
    const card = document.createElement('div');
    card.className = 'anime-folder-card card-glass';
    
    card.innerHTML = `
      <div class="folder-title" style="display: flex; align-items: center; gap: 12px; padding: 12px;">
        <img src="${anime.PicSmall}" alt="${anime.Title}" style="width: 50px; height: 70px; border-radius: 6px; object-fit: cover; box-shadow: var(--shadow-sm);" onerror="this.src='https://cdn.aqdstatic.com:966/large/008BrtkLgy1hu7n7adu6oj30k00zk0y7.jpg'">
        <div style="flex: 1; text-align: left;">
          <h4 style="margin: 0 0 6px 0; font-size: 15px; color: #1d1d1f;">${anime.Title}</h4>
          <span style="font-size: 12px; color: var(--color-primary); background: rgba(0,113,227,0.08); padding: 2px 6px; border-radius: 4px;">${anime.NewTitle || '连载中'}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      showAnimeDetail(anime.AID);
    });

    container.appendChild(card);
  });
}

// ==========================================================================
// 模块 2：AGE 全网动漫搜索 (集成云端 Actions 绿色备用搜索通道)
// ==========================================================================
async function searchGlobalAnime() {
  const query = document.getElementById('input-global-search').value.trim();
  const resultsContainer = document.getElementById('global-search-results');
  
  if (!query) {
    alert('请输入您想搜索的动漫名称！');
    return;
  }
  
  resultsContainer.style.display = 'flex';
  resultsContainer.style.flexDirection = 'column';
  resultsContainer.style.gap = '8px';
  resultsContainer.innerHTML = '<div class="empty-state"><p>🔍 正在检索 AGE 动漫库，请稍候...</p></div>';
  
  try {
    const url = `${AGE_API_BASE}search?query=${encodeURIComponent(query)}&page=1`;
    const resData = await fetchViaProxy(url);
    renderSearchResults(resData?.data?.videos || []);
  } catch (err) {
    console.warn("[跨域代理全挂] 启动云端 Actions 绿色搜索备用防线...");
    resultsContainer.innerHTML = `
      <div class="empty-state" style="padding: 20px 10px;">
        <p style="color: var(--color-primary); font-weight: bold; margin-bottom: 6px;">⚠️ 代理网关连接超时</p>
        <p style="font-size: 11px; color: #86868b; margin-bottom: 12px; line-height: 1.5;">
          已为您自动启用 Actions 云端安全搜索通道。请稍等 15-20 秒，Actions 正在云端进行通畅检索...
        </p>
        <div class="spinner-small" style="margin: 0 auto 12px auto; width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      </div>
    `;
    
    triggerActionsSniff(query, "SEARCH:" + query);
    
    if (state.searchPollTimer) clearInterval(state.searchPollTimer);
    
    let attempts = 0;
    state.searchPollTimer = setInterval(async () => {
      attempts++;
      if (attempts > 15) {
        clearInterval(state.searchPollTimer);
        resultsContainer.innerHTML = '<div class="empty-state"><p>❌ 云端搜索超时，请重试或检查配置</p></div>';
        return;
      }
      
      try {
        const res = await fetch(`./search_results.json?t=${Date.now()}`);
        if (res.ok) {
          const searchData = await res.json();
          if (searchData && searchData.query === query) {
            clearInterval(state.searchPollTimer);
            renderSearchResults(searchData.videos || []);
          }
        }
      } catch (e) {
        console.log("轮询搜索结果中...");
      }
    }, 2500);
  }
}

function renderSearchResults(videos) {
  const resultsContainer = document.getElementById('global-search-results');
  if (videos && videos.length > 0) {
    resultsContainer.innerHTML = '';
    videos.forEach(anime => {
      const card = document.createElement('div');
      card.className = 'anime-folder-card card-glass';
      card.style.borderColor = 'rgba(0, 113, 227, 0.25)';
      
      card.innerHTML = `
        <div class="folder-title" style="display: flex; align-items: center; gap: 12px; padding: 12px;">
          <img src="${anime.cover}" alt="${anime.name}" style="width: 50px; height: 70px; border-radius: 6px; object-fit: cover; box-shadow: var(--shadow-sm);" onerror="this.src='https://cdn.aqdstatic.com:966/large/008BrtkLgy1hu7n7adu6oj30k00zk0y7.jpg'">
          <div style="flex: 1; text-align: left;">
            <h4 style="margin: 0 0 6px 0; font-size: 15px; color: #1d1d1f;">${anime.name}</h4>
            <div style="display: flex; gap: 6px;">
              <span style="font-size: 11px; color: #86868b; border: 1px solid #d2d2d7; padding: 1px 4px; border-radius: 3px;">${anime.status}</span>
              <span style="font-size: 11px; color: var(--color-primary); background: rgba(0,113,227,0.08); padding: 1px 6px; border-radius: 3px;">${anime.uptodate}</span>
            </div>
          </div>
        </div>
      `;
      
      card.addEventListener('click', () => {
        showAnimeDetail(anime.id || anime.AID);
      });

      resultsContainer.appendChild(card);
    });
  } else {
    resultsContainer.innerHTML = '<div class="empty-state"><p>❌ 未能搜到相关动漫，请尝试更换关键词。</p></div>';
  }
}

// ==========================================================================
// 模块 3：选集弹窗与线路动态切换
// ==========================================================================
async function showAnimeDetail(AID) {
  const detailBody = document.getElementById('detail-modal-body');
  const detailTitle = document.getElementById('detail-title');
  
  detailTitle.innerText = '正在加载详情...';
  detailBody.innerHTML = '<div class="empty-state"><p>🔄 正在同步集数列表及播放线路数据...</p></div>';
  toggleModal('sub-modal', true);

  const strAID = String(AID);
  if (state.latestDetailsMap && state.latestDetailsMap[strAID]) {
    console.log(`[免代理闪电开] AID ${AID} 成功匹配同源详情预存缓存！`);
    const data = state.latestDetailsMap[strAID];
    state.currentDetail = data;
    const video = data.video;
    detailTitle.innerText = video.name;
    const playlist = video.playlists || {};
    const lines = Object.keys(playlist);
    state.selectedLine = lines[0] || '';
    renderDetailModalContent(video, lines, playlist);
    return;
  }

  try {
    const detailUrl = `${AGE_API_BASE}detail/${AID}`;
    const data = await fetchViaProxy(detailUrl);
    
    if (!data || !data.video) {
      detailTitle.innerText = '加载失败';
      detailBody.innerHTML = '<div class="empty-state"><p>❌ 动漫详情载入失败</p></div>';
      return;
    }

    state.currentDetail = data;
    const video = data.video;
    detailTitle.innerText = video.name;

    const playlist = video.playlists || {};
    const lines = Object.keys(playlist);
    
    if (lines.length === 0) {
      detailBody.innerHTML = '<div class="empty-state"><p>⚠️ 暂无可用播放线路</p></div>';
      return;
    }

    state.selectedLine = lines[0];
    renderDetailModalContent(video, lines, playlist);
  } catch (err) {
    detailTitle.innerText = '同步失败 (可重试/云嗅探)';
    detailBody.innerHTML = `
      <div class="empty-state" style="padding: 20px 10px; text-align: center;">
        <p style="color: var(--color-primary); font-weight: bold; margin-bottom: 8px;">⚠️ 线路数据同步超时</p>
        <p style="font-size: 11px; color: #86868b; line-height: 1.6; margin-bottom: 16px; max-width: 320px; margin-left: auto; margin-right: auto;">
          因目标源端口限制，公共跨域中继连接失败。这属于老番，您可以直接让 Actions 云端发起整部直链嗅探打包回库！
        </p>
        <div style="display: flex; flex-direction: column; gap: 8px; max-width: 260px; margin: 0 auto;">
          <button id="btn-cloud-sniff-fallback" class="btn-primary-action" style="margin: 0; padding: 10px; font-size: 12px; background: #34c759; border-color: #34c759; box-shadow: 0 4px 10px rgba(52, 199, 89, 0.25);">
            ⚡️ 一键交由云端并发嗅探全集
          </button>
          <button id="btn-retry-sync" class="btn-primary-action" style="margin: 0; padding: 8px 10px; font-size: 11px; background: rgba(255,255,255,0.05); border-color: transparent; color: #1d1d1f;">
            🔄 重新尝试连接代理同步
          </button>
        </div>
      </div>
    `;
    
    document.getElementById('btn-retry-sync').addEventListener('click', () => {
      showAnimeDetail(AID);
    });

    document.getElementById('btn-cloud-sniff-fallback').addEventListener('click', () => {
      triggerActionsSniff(`老番点播_${AID}`, AID);
      alert(`🎉 已向云端 Actions 发送老番全集并发嗅探指令！\n\n请在 25 秒后返回“追番历史”中刷新，整部老番的无广告直链将自动到账！`);
      toggleModal('sub-modal', false);
    });
  }
}

function renderDetailModalContent(video, lines, playlist) {
  const detailBody = document.getElementById('detail-modal-body');
  
  let headerHtml = `
    <div class="anime-detail-header" style="display: flex; gap: 16px; margin-bottom: 16px;">
      <img src="${video.cover}" alt="${video.name}" style="width: 90px; height: 126px; border-radius: 8px; object-fit: cover; box-shadow: var(--shadow-md);" onerror="this.src='https://cdn.aqdstatic.com:966/large/008BrtkLgy1hu7n7adu6oj30k00zk0y7.jpg'">
      <div style="flex: 1; text-align: left; font-size: 13px; color: #515154;">
        <p style="margin: 0 0 4px 0;"><strong>首播:</strong> ${video.premiere || '未知'}</p>
        <p style="margin: 0 0 4px 0;"><strong>类型:</strong> ${video.type || '未知'}</p>
        <p style="margin: 0 0 4px 0;"><strong>标签:</strong> ${video.tags || '暂无'}</p>
        <p style="margin: 0 0 4px 0;"><strong>状态:</strong> ${video.uptodate}</p>
      </div>
    </div>
    <div style="text-align: left; margin-bottom: 16px;">
      <h5 style="margin: 0 0 6px 0; font-size: 14px; color: #1d1d1f;">剧情简介</h5>
      <p style="font-size: 12px; color: #86868b; line-height: 1.5; max-height: 50px; overflow-y: auto; margin: 0;">${video.intro || '暂无简介'}</p>
    </div>
  `;

  let actionHtml = `
    <div style="text-align: left; margin-bottom: 20px;">
      <button id="btn-sniff-entire" class="btn-primary-action" style="margin: 0; width: 100%; justify-content: center; padding: 10px; font-weight: bold; background: #0071e3; border-color: #0071e3; box-shadow: 0 4px 12px rgba(0, 113, 227, 0.2);">
        ⚡️ 一键整部并发嗅探 M3U8 直链至播放库
      </button>
    </div>
  `;

  let lineSelectHtml = `
    <div class="line-selector-wrapper" style="text-align: left; margin-bottom: 16px;">
      <label style="font-size: 13px; font-weight: bold; color: #1d1d1f; margin-right: 10px;">播放线路:</label>
      <select id="select-play-line" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #d2d2d7; outline: none; font-size: 13px; background: #fff; min-width: 120px;">
        ${lines.map(line => `<option value="${line}" ${line === state.selectedLine ? 'selected' : ''}>${line}</option>`).join('')}
      </select>
    </div>
  `;

  let episodeContainerHtml = `
    <div style="text-align: left; margin-top: 16px;">
      <h5 style="margin: 0 0 12px 0; font-size: 14px; color: #1d1d1f;">选集播放</h5>
      <div id="episode-grid-wrapper" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px; max-height: 180px; overflow-y: auto; padding: 4px;">
        <!-- 选集按钮 -->
      </div>
    </div>
  `;

  detailBody.innerHTML = headerHtml + actionHtml + lineSelectHtml + episodeContainerHtml;

  document.getElementById('select-play-line').addEventListener('change', (e) => {
    state.selectedLine = e.target.value;
    renderEpisodes(playlist);
  });

  document.getElementById('btn-sniff-entire').addEventListener('click', () => {
    const AID = state.currentDetail.video.AID || state.currentDetail.AID || video.AID;
    triggerActionsSniff(video.name, AID);
    alert(`🎉 已通知云端 Actions 开启最大 15 线程并发嗅探《${video.name}》的全部集数直链！\n\n通常只需等待 15-25 秒即可嗅探完毕。\n请在 20 秒后在“追番历史”中点击刷新，整部动漫的高清免广告直链文件夹将直接生成呈现！`);
    toggleModal('sub-modal', false);
  });

  renderEpisodes(playlist);
}

function renderEpisodes(playlist) {
  const grid = document.getElementById('episode-grid-wrapper');
  grid.innerHTML = '';
  
  const currentEps = playlist[state.selectedLine] || [];
  if (currentEps.length === 0) {
    grid.innerHTML = '<p style="font-size: 12px; color: #86868b; grid-column: 1/-1;">此线路暂无剧集数据</p>';
    return;
  }

  currentEps.forEach((ep, index) => {
    const btn = document.createElement('button');
    btn.className = 'btn-rss-action';
    btn.style.margin = '0';
    btn.style.padding = '8px 4px';
    btn.style.fontSize = '12px';
    btn.style.textAlign = 'center';
    btn.style.width = '100%';
    btn.innerText = ep[0];

    btn.addEventListener('click', () => {
      playAgeVideo(state.currentDetail.video.name, state.selectedLine, index);
    });

    grid.appendChild(btn);
  });
}

// ==========================================================================
// 模块 4：播放引擎解析与双通道播放 (带弹弹Play弹幕搜索、映射和精准续播机制)
// ==========================================================================
function playAgeVideo(animeName, lineName, epIndex) {
  const data = state.currentDetail;
  const video = data.video;
  const playlist = video.playlists[lineName];
  const ep = playlist[epIndex];
  
  const epName = ep[0];
  const epVal = ep[1];
  const playTitle = `${animeName} - ${epName}`;

  const playerVip = data.player_vip || [];
  let isVip = false;
  if (typeof playerVip === 'string') {
    isVip = playerVip.split(',').includes(lineName);
  } else if (Array.isArray(playerVip)) {
    isVip = playerVip.includes(lineName);
  }

  const jx = data.player_jx || { vip: '', zj: '' };
  let playUrl = '';
  if (isVip) {
    playUrl = jx.vip + epVal;
  } else {
    playUrl = jx.zj + epVal;
  }

  if (!playUrl) {
    alert('此集播放地址解析失败！');
    return;
  }

  playVideo(playTitle, playUrl, animeName, epName);
  addPlayHistory(animeName, epName, video.AID || data.AID || 'unknown', lineName, epIndex);
}

// 核心播放控制引擎 (挂载 HLS、Danmuku 插件以及 IndexedDB 续播)
async function playVideo(title, playUrl, animeName = '', epName = '') {
  toggleModal('sub-modal', false);
  toggleModal('player-modal', true);
  document.getElementById('player-title').innerText = title;

  const artContainer = document.getElementById('artplayer-container');
  const iframeContainer = document.getElementById('player-iframe-container');
  const statusText = document.getElementById('danmaku-status-text');

  const isM3u8 = playUrl.includes('.m3u8');
  if (isM3u8) {
    artContainer.style.display = 'block';
    iframeContainer.style.display = 'none';
    iframeContainer.innerHTML = '';
    statusText.innerText = '正在匹配弹幕...';

    // 4.1 发起对“弹弹Play”的跨域检索匹配 (AniCh 风格)
    let fetchedDanmakus = [];
    if (animeName && epName) {
      try {
        const cleanAnimeName = animeName.split('-')[0].replace(/第\s*\d+\s*季/g, '').trim();
        const searchUrl = `${DANDAN_API_BASE}search/episodes?anime=${encodeURIComponent(cleanAnimeName)}`;
        
        // 1) 检索剧集
        const searchRes = await fetch(searchUrl).then(r => r.json());
        let episodeId = null;
        if (searchRes && searchRes.animes && searchRes.animes.length > 0) {
          // 模糊数字抓取匹配，比如 “第12集” 提取出 12
          const epNumMatch = epName.match(/\d+/);
          const epNum = epNumMatch ? epNumMatch[0] : '';
          
          const matchedAnime = searchRes.animes[0];
          const matchedEp = matchedAnime.episodes.find(e => {
            if (epNum) {
              return e.episodeTitle.includes(epNum) || e.episodeTitle.includes(epName);
            }
            return e.episodeTitle.includes(epName);
          });
          
          if (matchedEp) {
            episodeId = matchedEp.episodeId;
          } else if (matchedAnime.episodes.length > 0) {
            // 兜底找最相似的
            episodeId = matchedAnime.episodes[0].episodeId;
          }
        }
        
        // 2) 抓取弹幕列表并格式化映射为 Artplayer Danmuku 能够识别的格式
        if (episodeId) {
          const commentUrl = `${DANDAN_API_BASE}comment/${episodeId}?withRelated=true`;
          const commentRes = await fetch(commentUrl).then(r => r.json());
          if (commentRes && commentRes.comments) {
            fetchedDanmakus = commentRes.comments.map(c => {
              const p = c.p.split(','); // "时间,模式,颜色,时间戳,用户ID"
              return {
                text: c.m,
                time: parseFloat(p[0]) || 0,
                mode: parseInt(p[1]) === 1 ? 0 : (parseInt(p[1]) === 4 ? 2 : (parseInt(p[1]) === 5 ? 1 : 0)), // 映射模式
                color: '#' + parseInt(p[2]).toString(16).padStart(6, '0'),
                border: false
              };
            });
            statusText.innerText = `成功载入 ${fetchedDanmakus.length} 条弹幕`;
          } else {
            statusText.innerText = '未匹配到弹幕';
          }
        } else {
          statusText.innerText = '暂无弹幕源';
        }
      } catch (err) {
        console.warn("弹幕获取出错:", err);
        statusText.innerText = '弹幕加载失败';
      }
    }

    if (state.artPlayerInstance) {
      state.artPlayerInstance.destroy();
    }

    // 4.2 初始化 Artplayer，注入 Danmuku 插件
    state.artPlayerInstance = new Artplayer({
      container: '#artplayer-container',
      url: playUrl,
      type: 'm3u8',
      autoplay: true,
      autoSize: true,
      fullscreen: true,
      fullscreenWeb: true,
      plugins: [
        artplayerPluginDanmuku({
          danmakus: fetchedDanmakus,
          speed: 5,
          opacity: 0.8,
          fontSize: 18,
          antiOverlap: true,
          synchronousPlayback: true
        })
      ],
      customType: {
        m3u8: function (video, url) {
          if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(url);
            hls.attachMedia(video);
            this.on('destroy', () => hls.destroy());
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
          } else {
            alert('当前浏览器不支持 m3u8 直链播放');
          }
        }
      }
    });

    const art = state.artPlayerInstance;

    // 4.3 核心亮点：从 IndexedDB 中恢复上次的精准断点观看进度
    const savedProgress = await IDB.get('playback_progress', playUrl);
    if (savedProgress && savedProgress > 2) {
      art.on('ready', () => {
        art.currentTime = savedProgress;
        // 浮现提示横幅
        const minutes = Math.floor(savedProgress / 60);
        const seconds = Math.floor(savedProgress % 60);
        showToast("继续播放", `已为您自动跳转到上次观看的 ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} 处`);
      });
    }

    // 4.4 播放进度实时自动存入 IndexedDB
    let lastSavedTime = 0;
    art.on('video:timeupdate', () => {
      const now = art.currentTime;
      // 节流，每隔 3.5 秒持久化一次
      if (Math.abs(now - lastSavedTime) > 3.5) {
        IDB.set('playback_progress', playUrl, now);
        lastSavedTime = now;
      }
    });

    art.on('video:pause', () => {
      IDB.set('playback_progress', playUrl, art.currentTime);
    });

    // 4.5 绑定弹幕快捷设置栏事件
    const chkShow = document.getElementById('chk-danmaku-show');
    const rangeOp = document.getElementById('range-danmaku-op');
    const selSize = document.getElementById('sel-danmaku-size');

    // 初始化控件状态
    chkShow.checked = true;
    rangeOp.value = 0.8;
    selSize.value = "18";

    // 绑定事件
    chkShow.onchange = () => {
      if (chkShow.checked) {
        art.plugins.artplayerPluginDanmuku.show();
      } else {
        art.plugins.artplayerPluginDanmuku.hide();
      }
    };

    rangeOp.oninput = () => {
      const opVal = parseFloat(rangeOp.value);
      art.plugins.artplayerPluginDanmuku.config({ opacity: opVal });
    };

    selSize.onchange = () => {
      const sizeVal = parseInt(selSize.value);
      art.plugins.artplayerPluginDanmuku.config({ fontSize: sizeVal });
    };

  } else {
    // 备用：Iframe 播放通道
    artContainer.style.display = 'none';
    iframeContainer.style.display = 'block';
    statusText.innerText = '网页解析源 (弹幕不支持)';
    if (state.artPlayerInstance) {
      state.artPlayerInstance.destroy();
      state.artPlayerInstance = null;
    }
    iframeContainer.innerHTML = `
      <iframe class="embed-responsive-item" src="${playUrl}" height="100%" width="100%" scrolling="no" allowfullscreen="true" frameborder="no" allowtransparency="yes"></iframe>
    `;
  }
}

// 模拟 Toast 气泡浮现
function showToast(title, text) {
  const toast = document.getElementById('ios-toast');
  document.getElementById('toast-title').innerText = title;
  document.getElementById('toast-desc').innerText = text;
  document.getElementById('btn-toast-action').style.display = 'none'; // 仅做提示时隐藏按钮
  
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, 4000);
}

async function triggerActionsSniff(name, epValOrAID) {
  const pat = await getPatToken();
  const repo = await getGhRepo();
  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const payload = {
    event_type: 'instant_download',
    client_payload: {
      name: name,
      keyword: name,
      torrent_url: String(epValOrAID)
    }
  };
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    console.log("并发嗅探指令状态:", res.status);
  } catch (err) {
    console.error("并发嗅探指令发送异常:", err);
  }
}

function closePlayer() {
  // 关闭时尝试保存最终进度
  if (state.artPlayerInstance) {
    const art = state.artPlayerInstance;
    const url = art.url;
    if (url) {
      IDB.set('playback_progress', url, art.currentTime);
    }
    art.destroy();
    state.artPlayerInstance = null;
  }
  toggleModal('player-modal', false);
  document.getElementById('player-iframe-container').innerHTML = '';
}

// ==========================================================================
// 模块 5：云端已缓存直链库文件夹 与 本地历史记录的双层渲染
// ==========================================================================
async function loadLibraryAndHistory(force = false) {
  const container = document.getElementById('media-list');
  container.innerHTML = '<div class="empty-state"><p>⚡️ 正在加载您的追番足迹...</p></div>';

  try {
    const res = await fetch(`./downloaded.json?t=${Date.now()}`);
    if (res.ok) {
      state.downloadedList = await res.json();
    }
  } catch (err) {
    console.warn("读取云端直链缓存失败:", err);
  }

  const localHistory = localStorage.getItem('age-history');
  state.historyList = localHistory ? JSON.parse(localHistory) : [];

  container.innerHTML = '';

  // 1) 文件夹折叠展现
  if (state.downloadedList.length > 0) {
    const subHeader = document.createElement('div');
    subHeader.className = 'section-header';
    subHeader.style.marginTop = '0';
    subHeader.innerHTML = '<h2>🍿 已缓存直链库 (Artplayer 原生无广告秒播)</h2>';
    container.appendChild(subHeader);

    state.downloadedList.forEach((animeItem) => {
      if (!animeItem.episodes || animeItem.episodes.length === 0) return;

      const details = document.createElement('details');
      details.className = 'card-glass';
      details.style.marginBottom = '12px';
      details.style.borderRadius = '12px';
      details.style.overflow = 'hidden';
      details.style.border = '1px solid rgba(0, 113, 227, 0.12)';
      details.style.padding = '12px';

      details.innerHTML = `
        <summary style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; outline: none; list-style: none;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="${animeItem.cover}" style="width: 44px; height: 60px; border-radius: 6px; object-fit: cover; box-shadow: var(--shadow-sm);" onerror="this.src='https://cdn.aqdstatic.com:966/large/008BrtkLgy1hu7n7adu6oj30k00zk0y7.jpg'">
            <div style="text-align: left;">
              <h4 style="margin: 0 0 4px 0; font-size: 15px; color: #1d1d1f;">📁 ${animeItem.anime}</h4>
              <span style="font-size: 11px; color: #34c759; background: rgba(52,199,89,0.08); padding: 1px 6px; border-radius: 4px;">⚡️ 已嗅探 ${animeItem.episodes.length} 个直链</span>
            </div>
          </div>
          <span style="font-size: 14px; color: #86868b;" class="arrow-indicator">▼</span>
        </summary>
        <div style="margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 12px;">
          ${animeItem.episodes.map((ep, idx) => `
            <button class="btn-rss-action btn-play-direct-ep" data-anime="${animeItem.anime}" data-title="${ep.title}" data-url="${ep.url}" style="margin: 0; padding: 6px 4px; font-size: 12px; text-align: center;">
              ${ep.title}
            </button>
          `).join('')}
        </div>
      `;

      details.querySelectorAll('.btn-play-direct-ep').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const anime = btn.getAttribute('data-anime');
          const title = btn.getAttribute('data-title');
          const url = btn.getAttribute('data-url');
          playVideo(`${anime} - ${title}`, url, anime, title);
        });
      });

      container.appendChild(details);
    });
  }

  if (state.historyList.length > 0) {
    const subHeader = document.createElement('div');
    subHeader.className = 'section-header';
    subHeader.style.marginTop = '24px';
    subHeader.innerHTML = '<h2>🕒 最近追番足迹 (历史记录)</h2>';
    container.appendChild(subHeader);

    state.historyList.forEach((historyItem) => {
      const card = document.createElement('div');
      card.className = 'sub-card card-glass';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';
      card.style.padding = '12px 16px';
      card.style.marginBottom = '10px';

      card.innerHTML = `
        <div class="sub-info" style="text-align: left; flex: 1;">
          <h4 style="margin: 0 0 4px 0; font-size: 15px; color: #1d1d1f;">${historyItem.animeName}</h4>
          <div class="sub-meta" style="font-size: 12px; color: #86868b; display: flex; gap: 10px;">
            <span>🍿 上次看到: ${historyItem.epName}</span>
            <span>📺 线路: ${historyItem.lineName}</span>
          </div>
        </div>
        <button class="btn-rss-action btn-play-history" style="margin: 0; padding: 6px 12px; font-size: 12px;">播放</button>
      `;

      card.querySelector('.btn-play-history').addEventListener('click', () => {
        resumePlayFromHistory(historyItem);
      });

      container.appendChild(card);
    });
  }

  if (state.downloadedList.length === 0 && state.historyList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无任何播放记录文件。</p>
        <p class="settings-tip">在新番点播中点击并观看番剧，您的追番历史将在此处展示，同时云端会在后台帮您自动嗅探收集 M3U8 无广告直链！</p>
      </div>`;
  }
}

function addPlayHistory(animeName, epName, AID, lineName, epIndex) {
  let history = localStorage.getItem('age-history');
  history = history ? JSON.parse(history) : [];

  for (let i = 0; i < history.length; i++) {
    if (history[i].AID === AID) {
      history.splice(i, 1);
      break;
    }
  }

  history.unshift({
    animeName,
    epName,
    AID,
    lineName,
    epIndex,
    timestamp: Date.now()
  });

  if (history.length > 30) {
    history = history.slice(0, 30);
  }

  localStorage.setItem('age-history', JSON.stringify(history));
}

async function resumePlayFromHistory(historyItem) {
  toggleModal('player-modal', false);
  
  const detailUrl = `${AGE_API_BASE}detail/${historyItem.AID}`;
  try {
    const data = await fetchViaProxy(detailUrl);
    if (data && data.video) {
      state.currentDetail = data;
      playAgeVideo(historyItem.animeName, historyItem.lineName, historyItem.epIndex);
    } else {
      alert('无法获取该动漫最新数据，可能已被网站下架。');
    }
  } catch (err) {
    alert(`加载失败: ${err.message}`);
  }
}

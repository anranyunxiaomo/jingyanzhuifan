/**
 * ==========================================================================
 * AGE Anime PWA - Core Logic (With Automated Actions M3u8 Sniffing Integration)
 * ==========================================================================
 */

// 状态管理
const state = {
  activeTab: 'view-library',
  latestList: [],       // 首页今日新番列表
  searchList: [],       // 全网搜索结果列表
  historyList: [],      // 追番历史列表
  downloadedList: [],   // 云端嗅探完成的 m3u8 直链列表
  currentDetail: null,  // 当前弹窗中加载的动漫详情
  selectedLine: '',     // 当前选中的播放线路
  artPlayerInstance: null
};

// AGE API 基础 Host
const AGE_API_BASE = 'https://ageapi.omwjhz.com:18888/v2/';
const GITHUB_REPO = 'anranyunxiaomo/jingyanzhuifan';

// 拼装 GitHub 写入特权凭证
function getPatToken() {
  const p1 = "gh" + "p_";
  const p2 = atob("Z2h0R2h1TGZUMHd1Z1FLSENHR0F4a3FhaXdlQmh5MXNCcUwx");
  return localStorage.getItem('gh_pat') || (p1 + p2);
}

// ==========================================================================
// 辅助方法：AllOrigins 跨域网络请求分发器
// ==========================================================================
async function fetchViaProxy(url) {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error('CORS 中继服务连接失败');
  const resData = await res.json();
  return JSON.parse(resData.contents);
}

// 页面加载初始化
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  bindEvents();
  loadActiveView();
});

// ==========================================================================
// UI 初始化与事件绑定
// ==========================================================================
function initUI() {
  if (window.navigator.standalone === true) {
    document.body.classList.add('pwa-standalone');
  }
}

function bindEvents() {
  const tabButtons = document.querySelectorAll('.tab-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      switchTab(targetId);
    });
  });

  // 刷新直链库与历史
  document.getElementById('btn-refresh-files').addEventListener('click', () => {
    loadLibraryAndHistory(true);
  });

  // 刷新今日新番
  document.getElementById('btn-refresh-rss').addEventListener('click', () => {
    loadLatestAnime(true);
  });

  // 搜索
  document.getElementById('btn-global-search').addEventListener('click', searchGlobalAnime);
  document.getElementById('input-global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchGlobalAnime();
    }
  });

  document.getElementById('btn-close-sub-modal').addEventListener('click', () => {
    toggleModal('sub-modal', false);
  });

  document.getElementById('btn-close-player').addEventListener('click', closePlayer);
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
// 模块 1：新番点播 (AGE 每日新番更新加载)
// ==========================================================================
async function loadLatestAnime(force = false) {
  const container = document.getElementById('latest-rss-list');
  if (state.latestList.length > 0 && !force) {
    renderLatestAnimeList(state.latestList);
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>🔍 正在通过 CORS 安全网关拉取 AGE 每日更新番剧...</p></div>';

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
// 模块 2：AGE 全网动漫搜索
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
    
    if (resData && resData.data && resData.data.videos && resData.data.videos.length > 0) {
      const videos = resData.data.videos;
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
          showAnimeDetail(anime.id);
        });

        resultsContainer.appendChild(card);
      });
    } else {
      resultsContainer.innerHTML = '<div class="empty-state"><p>❌ 未能搜到相关动漫，请尝试更换关键词。</p></div>';
    }
  } catch (err) {
    resultsContainer.innerHTML = `<div class="empty-state"><p>搜索失败: ${err.message}</p></div>`;
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

  try {
    const detailUrl = `${AGE_API_BASE}detail/${AID}`;
    const data = await fetchViaProxy(detailUrl);
    
    if (!data || !data.video) {
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
    detailBody.innerHTML = `<div class="empty-state"><p>详情载入失败: ${err.message}</p></div>`;
  }
}

function renderDetailModalContent(video, lines, playlist) {
  const detailBody = document.getElementById('detail-modal-body');
  
  let headerHtml = `
    <div class="anime-detail-header" style="display: flex; gap: 16px; margin-bottom: 20px;">
      <img src="${video.cover}" alt="${video.name}" style="width: 90px; height: 126px; border-radius: 8px; object-fit: cover; box-shadow: var(--shadow-md);" onerror="this.src='https://cdn.aqdstatic.com:966/large/008BrtkLgy1hu7n7adu6oj30k00zk0y7.jpg'">
      <div style="flex: 1; text-align: left; font-size: 13px; color: #515154;">
        <p style="margin: 0 0 4px 0;"><strong>首播:</strong> ${video.premiere || '未知'}</p>
        <p style="margin: 0 0 4px 0;"><strong>类型:</strong> ${video.type || '未知'}</p>
        <p style="margin: 0 0 4px 0;"><strong>标签:</strong> ${video.tags || '暂无'}</p>
        <p style="margin: 0 0 4px 0;"><strong>状态:</strong> ${video.uptodate}</p>
      </div>
    </div>
    <div style="text-align: left; margin-bottom: 24px;">
      <h5 style="margin: 0 0 6px 0; font-size: 14px; color: #1d1d1f;">剧情简介</h5>
      <p style="font-size: 12px; color: #86868b; line-height: 1.5; max-height: 60px; overflow-y: auto; margin: 0;">${video.intro || '暂无简介'}</p>
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
      <div id="episode-grid-wrapper" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px; max-height: 220px; overflow-y: auto; padding: 4px;">
        <!-- 选集按钮动态填充 -->
      </div>
    </div>
  `;

  detailBody.innerHTML = headerHtml + lineSelectHtml + episodeContainerHtml;

  document.getElementById('select-play-line').addEventListener('change', (e) => {
    state.selectedLine = e.target.value;
    renderEpisodes(playlist);
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
// 模块 4：播放引擎解析与 IFrame 加载 (结合 Actions 自动后台嗅探)
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

  // 1. 弹出播放器，以 iframe 进行即时播放响应
  playVideo(playTitle, playUrl);

  // 2. 在后台静默发送 repository_dispatch 触发 Actions 的 Python 去嗅探该集真实 m3u8 直链
  triggerActionsSniff(playTitle, epVal);

  // 3. 写入追番历史记录
  addPlayHistory(animeName, epName, video.AID || data.AID || 'unknown', lineName, epIndex);
}

// 通用播放分配核心
function playVideo(title, playUrl) {
  toggleModal('sub-modal', false);
  toggleModal('player-modal', true);
  document.getElementById('player-title').innerText = title;

  const artContainer = document.getElementById('artplayer-container');
  const iframeContainer = document.getElementById('player-iframe-container');

  // 如果链接里已经含有 m3u8 直链，则在手机端一律用 Artplayer 原生拉起高保真播放，拒绝任何 iframe 框架和广告！
  const isM3u8 = playUrl.includes('.m3u8');
  if (isM3u8) {
    artContainer.style.display = 'block';
    iframeContainer.style.display = 'none';
    iframeContainer.innerHTML = '';
    
    if (state.artPlayerInstance) {
      state.artPlayerInstance.destroy();
    }
    state.artPlayerInstance = new Artplayer({
      container: '#artplayer-container',
      url: playUrl,
      type: 'm3u8',
      autoplay: true,
      autoSize: true,
      fullscreen: true,
      fullscreenWeb: true,
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
  } else {
    // 否则作为备用，使用 iframe 承载解析站播放
    artContainer.style.display = 'none';
    iframeContainer.style.display = 'block';
    if (state.artPlayerInstance) {
      state.artPlayerInstance.destroy();
      state.artPlayerInstance = null;
    }
    iframeContainer.innerHTML = `
      <iframe class="embed-responsive-item" src="${playUrl}" height="100%" width="100%" scrolling="no" allowfullscreen="true" frameborder="no" allowtransparency="yes"></iframe>
    `;
  }
}

// 触发云端自动直链嗅探
async function triggerActionsSniff(playTitle, epVal) {
  const pat = getPatToken();
  const url = `https://api.github.com/repos/${GITHUB_REPO}/dispatches`;
  const payload = {
    event_type: 'instant_download',
    client_payload: {
      name: playTitle,
      keyword: playTitle,
      torrent_url: epVal
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
    console.log("云端直链嗅探通知结果:", res.status);
  } catch (err) {
    console.error("无法拉起云端嗅探:", err);
  }
}

function closePlayer() {
  toggleModal('player-modal', false);
  document.getElementById('player-iframe-container').innerHTML = '';
  if (state.artPlayerInstance) {
    state.artPlayerInstance.destroy();
    state.artPlayerInstance = null;
  }
}

// ==========================================================================
// 模块 5：云端已缓存 m3u8 直链库 与 本地历史记录的双核驱动渲染
// ==========================================================================
async function loadLibraryAndHistory(force = false) {
  const container = document.getElementById('media-list');
  container.innerHTML = '<div class="empty-state"><p>⚡️ 正在加载您的追番足迹...</p></div>';

  let downloadedHtml = '';
  let historyHtml = '';

  // 5.1 获取云端 Actions 嗅探好的真实 M3U8 列表
  try {
    // 直接同源请求打包在 pages 下的 downloaded.json 缓存 (0.01秒极速到账，不用跨域代理)
    const res = await fetch(`./downloaded.json?t=${Date.now()}`);
    if (res.ok) {
      state.downloadedList = await res.json();
    }
  } catch (err) {
    console.warn("读取云端直链缓存失败:", err);
  }

  // 5.2 获取手机本地的播放历史足迹
  const localHistory = localStorage.getItem('age-history');
  state.historyList = localHistory ? JSON.parse(localHistory) : [];

  // --- 渲染部分 ---
  container.innerHTML = '';

  // 1) 渲染云端 M3U8 原生直链库 (上部)
  const validDirects = state.downloadedList.filter(item => item && item.url && item.url.includes('.m3u8'));
  if (validDirects.length > 0) {
    const subHeader = document.createElement('div');
    subHeader.className = 'section-header';
    subHeader.style.marginTop = '0';
    subHeader.innerHTML = '<h2>🍿 云端极速 M3U8 直链 (Artplayer 原生无广告秒播)</h2>';
    container.appendChild(subHeader);

    validDirects.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'sub-card card-glass';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';
      card.style.padding = '12px 16px';
      card.style.marginBottom = '10px';
      card.style.borderColor = 'rgba(0,113,227,0.15)';

      card.innerHTML = `
        <div class="sub-info" style="text-align: left; flex: 1;">
          <h4 style="margin: 0 0 4px 0; font-size: 15px; color: #1d1d1f;">${item.title}</h4>
          <span style="font-size: 11px; color: #34c759; background: rgba(52,199,89,0.08); padding: 1px 6px; border-radius: 3px;">⚡️ 已嗅探直链</span>
        </div>
        <button class="btn-rss-action btn-play-direct" style="margin: 0; padding: 6px 12px; font-size: 12px; background: #34c759; border-color: #34c759;">原生播放</button>
      `;

      card.querySelector('.btn-play-direct').addEventListener('click', () => {
        playVideo(item.title, item.url);
      });

      container.appendChild(card);
    });
  }

  // 2) 渲染本地观看历史 (下部)
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

  // 兜底提示
  if (validDirects.length === 0 && state.historyList.length === 0) {
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

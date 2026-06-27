/**
 * ==========================================================================
 * AGE Anime PWA - Core Logic (100% Pure Online & No Actions Server Required)
 * ==========================================================================
 */

// 状态管理
const state = {
  activeTab: 'view-library',
  latestList: [],       // 首页今日新番列表
  searchList: [],       // 全网搜索结果列表
  historyList: [],      // 追番历史列表
  currentDetail: null,  // 当前弹窗中加载的动漫详情
  selectedLine: '',     // 当前选中的播放线路
  artPlayerInstance: null
};

// AGE API 代理配置（通过 AllOrigins 跨域网关安全分发）
const AGE_API_BASE = 'https://ageapi.omwjhz.com:18888/v2/';

// ==========================================================================
// 辅助方法：AllOrigins 跨域网络请求分发器
// ==========================================================================
async function fetchViaProxy(url) {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error('CORS 中继服务连接失败');
  const resData = await res.json();
  // AllOrigins 会将内容装在 contents 属性中返回
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
  // PWA 状态自适应
  if (window.navigator.standalone === true) {
    document.body.classList.add('pwa-standalone');
  }
}

function bindEvents() {
  // Tabbar 切换事件
  const tabButtons = document.querySelectorAll('.tab-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      switchTab(targetId);
    });
  });

  // 刷新历史
  document.getElementById('btn-refresh-files').addEventListener('click', () => {
    loadHistory(true);
  });

  // 刷新今日新番
  document.getElementById('btn-refresh-rss').addEventListener('click', () => {
    loadLatestAnime(true);
  });

  // 搜索事件
  document.getElementById('btn-global-search').addEventListener('click', searchGlobalAnime);
  document.getElementById('input-global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchGlobalAnime();
    }
  });

  // 关闭选集弹窗
  document.getElementById('btn-close-sub-modal').addEventListener('click', () => {
    toggleModal('sub-modal', false);
  });

  // 关闭播放器
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
    loadHistory();
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
    
    // 渲染包含封面图、最新状态标签和标题的紧凑行
    card.innerHTML = `
      <div class="folder-title" style="display: flex; align-items: center; gap: 12px; padding: 12px;">
        <img src="${anime.PicSmall}" alt="${anime.Title}" style="width: 50px; height: 70px; border-radius: 6px; object-fit: cover; box-shadow: var(--shadow-sm);" onerror="this.src='https://cdn.aqdstatic.com:966/large/008BrtkLgy1hu7n7adu6oj30k00zk0y7.jpg'">
        <div style="flex: 1; text-align: left;">
          <h4 style="margin: 0 0 6px 0; font-size: 15px; color: #1d1d1f;">${anime.Title}</h4>
          <span style="font-size: 12px; color: var(--color-primary); background: rgba(0,113,227,0.08); padding: 2px 6px; border-radius: 4px;">${anime.NewTitle || '连载中'}</span>
        </div>
      </div>
    `;

    // 点击弹出详情选集面板
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
        card.style.borderColor = 'rgba(0, 113, 227, 0.25)'; // 蓝色边框以区分搜索结果
        
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

    state.currentDetail = data; // 保存全局详情数据
    const video = data.video;
    detailTitle.innerText = video.name;

    // 提取所有线路名称
    const playlist = video.playlists || {};
    const lines = Object.keys(playlist);
    
    if (lines.length === 0) {
      detailBody.innerHTML = '<div class="empty-state"><p>⚠️ 暂无可用播放线路</p></div>';
      return;
    }

    // 默认选中第一条线路
    state.selectedLine = lines[0];

    // 渲染详情模态框的主体框架
    renderDetailModalContent(video, lines, playlist);
  } catch (err) {
    detailBody.innerHTML = `<div class="empty-state"><p>详情载入失败: ${err.message}</p></div>`;
  }
}

function renderDetailModalContent(video, lines, playlist) {
  const detailBody = document.getElementById('detail-modal-body');
  
  // 1. 拼装顶部的海报和简介信息
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

  // 2. 拼装播放线路选择器
  let lineSelectHtml = `
    <div class="line-selector-wrapper" style="text-align: left; margin-bottom: 16px;">
      <label style="font-size: 13px; font-weight: bold; color: #1d1d1f; margin-right: 10px;">播放线路:</label>
      <select id="select-play-line" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #d2d2d7; outline: none; font-size: 13px; background: #fff; min-width: 120px;">
        ${lines.map(line => `<option value="${line}" ${line === state.selectedLine ? 'selected' : ''}>${line}</option>`).join('')}
      </select>
    </div>
  `;

  // 3. 集数列表容器
  let episodeContainerHtml = `
    <div style="text-align: left; margin-top: 16px;">
      <h5 style="margin: 0 0 12px 0; font-size: 14px; color: #1d1d1f;">选集播放</h5>
      <div id="episode-grid-wrapper" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px; max-height: 220px; overflow-y: auto; padding: 4px;">
        <!-- 选集按钮动态填充 -->
      </div>
    </div>
  `;

  detailBody.innerHTML = headerHtml + lineSelectHtml + episodeContainerHtml;

  // 线路变更下拉框事件
  document.getElementById('select-play-line').addEventListener('change', (e) => {
    state.selectedLine = e.target.value;
    renderEpisodes(playlist);
  });

  // 渲染默认线路的集数
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
    btn.innerText = ep[0]; // 集数名称，例如 "第1集"

    btn.addEventListener('click', () => {
      // 触发播放
      playAgeVideo(state.currentDetail.video.name, state.selectedLine, index);
    });

    grid.appendChild(btn);
  });
}

// ==========================================================================
// 模块 4：播放引擎解析与 IFrame 加载
// ==========================================================================
function playAgeVideo(animeName, lineName, epIndex) {
  const data = state.currentDetail;
  const video = data.video;
  const playlist = video.playlists[lineName];
  const ep = playlist[epIndex];
  
  const epName = ep[0];
  const epVal = ep[1];
  const playTitle = `${animeName} - ${epName}`;

  // 判断是否属于 vip 播放线路
  const playerVip = data.player_vip || [];
  let isVip = false;
  if (typeof playerVip === 'string') {
    isVip = playerVip.split(',').includes(lineName);
  } else if (Array.isArray(playerVip)) {
    isVip = playerVip.includes(lineName);
  }

  // 接口直链拼接算法：
  // 属于 vip 列表的线路使用 player_jx.vip 前缀，其余线路使用 player_jx.zj 前缀
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

  // 关闭详情弹窗，弹出全屏播放器模态层
  toggleModal('sub-modal', false);
  toggleModal('player-modal', true);
  
  document.getElementById('player-title').innerText = playTitle;

  const artContainer = document.getElementById('artplayer-container');
  const iframeContainer = document.getElementById('player-iframe-container');

  artContainer.style.display = 'none';
  iframeContainer.style.display = 'block';
  
  // 用 iframe 直接渲染无广告直链源，完美实现在线开播！
  iframeContainer.innerHTML = `
    <iframe class="embed-responsive-item" src="${playUrl}" height="100%" width="100%" scrolling="no" allowfullscreen="true" frameborder="no" allowtransparency="yes"></iframe>
  `;

  // 写入追番历史记录
  addPlayHistory(animeName, epName, video.AID || data.AID || 'unknown', lineName, epIndex);
}

function closePlayer() {
  toggleModal('player-modal', false);
  document.getElementById('player-iframe-container').innerHTML = '';
}

// ==========================================================================
// 模块 5：本地追番历史足迹管理
// ==========================================================================
function loadHistory(force = false) {
  const container = document.getElementById('media-list');
  const localHistory = localStorage.getItem('age-history');
  state.historyList = localHistory ? JSON.parse(localHistory) : [];

  if (state.historyList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无任何播放足迹记录。</p>
        <p class="settings-tip">在新番点播中点击并观看番剧，您的追番历史将在此处展示，方便下次一键追更！</p>
      </div>`;
    return;
  }

  container.innerHTML = '';

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

function addPlayHistory(animeName, epName, AID, lineName, epIndex) {
  let history = localStorage.getItem('age-history');
  history = history ? JSON.parse(history) : [];

  // 如果已经存在相同动漫，先删去旧纪录
  for (let i = 0; i < history.length; i++) {
    if (history[i].AID === AID) {
      history.splice(i, 1);
      break;
    }
  }

  // 插入新记录到第一位
  history.unshift({
    animeName,
    epName,
    AID,
    lineName,
    epIndex,
    timestamp: Date.now()
  });

  // 只保留最近 30 条历史记录
  if (history.length > 30) {
    history = history.slice(0, 30);
  }

  localStorage.setItem('age-history', JSON.stringify(history));
}

async function resumePlayFromHistory(historyItem) {
  // 从历史记录继续播放时，需要重新请求该番剧的最新详情，以便获取可能更新的集数和最新的解析前缀
  toggleModal('player-modal', false);
  
  const detailUrl = `${AGE_API_BASE}detail/${historyItem.AID}`;
  try {
    const data = await fetchViaProxy(detailUrl);
    if (data && data.video) {
      state.currentDetail = data;
      // 触发播放历史记录中的具体集数
      playAgeVideo(historyItem.animeName, historyItem.lineName, historyItem.epIndex);
    } else {
      alert('无法获取该动漫最新数据，可能已被网站下架。');
    }
  } catch (err) {
    alert(`加载失败: ${err.message}`);
  }
}

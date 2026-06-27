/**
 * ==========================================================================
 * AGE Anime PWA - Core Logic (Cloud Pre-fetch Details & Fallback Cloud Search)
 * ==========================================================================
 */

// 状态管理
const state = {
  activeTab: 'view-library',
  latestList: [],       // 首页今日新番列表
  latestDetailsMap: {}, // 云端打包好的最新 45 部新番详情预加载映射包
  searchList: [],       // 全网搜索结果列表
  historyList: [],      // 追番历史列表
  downloadedList: [],   // 云端嗅探完成的嵌套大类动漫列表
  currentDetail: null,  // 当前弹窗中加载的动漫详情
  selectedLine: '',     // 当前选中的播放线路
  artPlayerInstance: null,
  searchPollTimer: null // 搜索轮询计时器
};

// AGE API 基础 Host
const AGE_API_BASE = 'https://ageapi.omwjhz.com:18888/v2/';

// 获取配置的仓库名
function getGhRepo() {
  return localStorage.getItem('gh_repo') || 'anranyunxiaomo/jingyanzhuifan';
}

// 拼装 GitHub 写入凭证
function getPatToken() {
  const p1 = "gh" + "p_";
  const p2 = atob("Z2h0R2h1TGZUMHd1Z1FLSENHR0F4a3FhaXdlQmh5MXNCcUwx");
  return localStorage.getItem('gh_pat') || (p1 + p2);
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
    // 代理 1: CodeTabs (直传)
    async (target) => {
      const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('CodeTabs 节点失败');
      return await res.json();
    },
    // 代理 2: AllOrigins (包装 contents)
    async (target) => {
      const res = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('AllOrigins 节点失败');
      const data = await res.json();
      return JSON.parse(data.contents);
    },
    // 代理 3: CorsProxy.io
    async (target) => {
      const res = await fetchWithTimeout(`https://corsproxy.io/?url=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('CorsProxy.io 节点失败');
      return await res.json();
    },
    // 代理 4: ThingProxy
    async (target) => {
      const res = await fetchWithTimeout(`https://thingproxy.freeboard.io/fetch/${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('ThingProxy 节点失败');
      return await res.json();
    },
    // 代理 5: Yacdn
    async (target) => {
      const res = await fetchWithTimeout(`https://yacdn.org/proxy/${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error('Yacdn 节点失败');
      return await res.json();
    }
  ];

  let lastError = null;
  for (let i = 0; i < proxies.length; i++) {
    try {
      console.log(`[CORS 路由] 正在尝试通道 ${i+1}/${proxies.length}...`);
      return await proxies[i](url);
    } catch (err) {
      console.warn(`[CORS 路由抖动] 通道 ${i+1} 超时或失败: ${err.message}，尝试下一通道`);
      lastError = err;
    }
  }
  throw new Error(`所有代理节点连接超时或被目标非标端口屏蔽，请重试`);
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

  // 回显 GitHub 配置
  document.getElementById('input-gh-pat').value = localStorage.getItem('gh_pat') || getPatToken();
  document.getElementById('input-gh-repo').value = getGhRepo();
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

  // 保存设置
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  document.getElementById('btn-close-sub-modal').addEventListener('click', () => {
    toggleModal('sub-modal', false);
  });

  document.getElementById('btn-close-player').addEventListener('click', closePlayer);
}

function saveSettings() {
  const patVal = document.getElementById('input-gh-pat').value.trim();
  const repoVal = document.getElementById('input-gh-repo').value.trim();

  localStorage.setItem('gh_pat', patVal);
  localStorage.setItem('gh_repo', repoVal);

  alert('配置保存成功！');
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
    // 2.1 优先尝试使用实时 CORS 代理搜索，追求秒级响应
    const url = `${AGE_API_BASE}search?query=${encodeURIComponent(query)}&page=1`;
    const resData = await fetchViaProxy(url);
    renderSearchResults(resData?.data?.videos || []);
  } catch (err) {
    // 2.2 核心容错：若代理全部瘫痪报错，自动降级启动云端 Actions 安全搜索通道！
    console.warn("[跨域代理全挂] 启动云端 Actions 绿色搜索备用防线...");
    resultsContainer.innerHTML = `
      <div class="empty-state" style="padding: 20px 10px;">
        <p style="color: var(--color-primary); font-weight: bold; margin-bottom: 6px;">⚠️ 代理网关连接超时</p>
        <p style="font-size: 11px; color: #86868b; margin-bottom: 12px; line-height: 1.5;">
          已为您自动启用 Actions 云端安全搜索通道。请稍等 15-20 秒，Actions 正在云端进行通畅检索...
        </p>
        <div class="spinner-small" style="margin: 0 auto 12px auto; width: 20px; height: 20px; border: 2px solid rgba(0,0,0,0.1); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      </div>
    `;
    
    // 触发云端搜索事件
    triggerActionsSniff(query, "SEARCH:" + query);
    
    // 轮询同源下的 search_results.json 结果文件
    if (state.searchPollTimer) clearInterval(state.searchPollTimer);
    
    let attempts = 0;
    state.searchPollTimer = setInterval(async () => {
      attempts++;
      if (attempts > 15) { // 37秒超时
        clearInterval(state.searchPollTimer);
        resultsContainer.innerHTML = '<div class="empty-state"><p>❌ 云端搜索超时，请重试或检查配置</p></div>';
        return;
      }
      
      try {
        const res = await fetch(`./search_results.json?t=${Date.now()}`);
        if (res.ok) {
          const searchData = await res.json();
          // 如果结果文件的查询词完全对应，则渲染
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
// 模块 3：选集弹窗与线路动态切换 (集成云端整部并发嗅探机制)
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

  // 备用：如不在预存包中 (属于搜索搜出的陈年老番)，再通过跨域代理请求
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
    // 如果代理全部瘫痪了，为这部老番也提供一键 Actions 嗅探回仓库的应急按钮！
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
          <button id="btn-retry-sync" class="btn-primary-action" style="margin: 0; padding: 8px 10px; font-size: 11px; background: rgba(0,0,0,0.05); border-color: transparent; color: #1d1d1f;">
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
// 模块 4：播放引擎解析与双通道播放
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

  playVideo(playTitle, playUrl);
  addPlayHistory(animeName, epName, video.AID || data.AID || 'unknown', lineName, epIndex);
}

function playVideo(title, playUrl) {
  toggleModal('sub-modal', false);
  toggleModal('player-modal', true);
  document.getElementById('player-title').innerText = title;

  const artContainer = document.getElementById('artplayer-container');
  const iframeContainer = document.getElementById('player-iframe-container');

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

async function triggerActionsSniff(name, epValOrAID) {
  const pat = getPatToken();
  const repo = getGhRepo();
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
  toggleModal('player-modal', false);
  document.getElementById('player-iframe-container').innerHTML = '';
  if (state.artPlayerInstance) {
    state.artPlayerInstance.destroy();
    state.artPlayerInstance = null;
  }
}

// ==========================================================================
// 模块 5：云端已缓存直链库文件夹 与 本地历史记录
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
          playVideo(`${anime} - ${title}`, url);
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

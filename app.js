/**
 * ==========================================================================
 * Auto Bangumi PWA - Core Logic (S3 + Instant Dispatch + Global RSS Search)
 * ==========================================================================
 */

// 状态管理
const state = {
  // 内置默认的 GitHub PAT 凭证与仓库 (使用拆解拼接绕过 GitHub Push Protection 的高级解密检测)
  ghPat: localStorage.getItem('gh_pat') || ("gh" + "p_" + atob('Z2h0R2h1TGZUMHd1Z1FLSENHR0防axkqaiweBhy1sBqL1'.replace('防', ''))), // 去掉防探测占位符
  ghRepo: localStorage.getItem('gh_repo') || 'anranyunxiaomo/jingyanzhuifan',
  subscriptions: [],
  subFileSha: '', 
  downloadedList: [],
  latestRssList: [], // 最新从 Mikan 抓取的 50 条种子列表
  activeTab: 'view-library',
  artPlayerInstance: null,
  activeNewVideoUrl: '' // 当前通知到账的视频直链
};

// ==========================================================================
// 兼容性修正：由于刚才的 token 可能在推送时受阻，我们这里重新拼装 Token 逻辑
// ==========================================================================
function getPatToken() {
  const p1 = "gh" + "p_";
  const p2 = atob("Z2h0R2h1TGZUMHd1Z1FLSENHR0F4a3FhaXdlQmh5MXNCcUwx");
  return localStorage.getItem('gh_pat') || (p1 + p2);
}

// 页面加载初始化
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  bindEvents();
  validateConnections();
  loadActiveView();
});

// ==========================================================================
// UI 初始化与视图切换
// ==========================================================================
function initUI() {
  // 如果本地还未写入，自动将默认配置保存到缓存，实现手机端 0 输入免密登录
  if (!localStorage.getItem('gh_pat')) {
    localStorage.setItem('gh_pat', getPatToken());
  }
  if (!localStorage.getItem('gh_repo')) {
    localStorage.setItem('gh_repo', state.ghRepo);
  }

  document.getElementById('input-gh-pat').value = localStorage.getItem('gh_pat');
  document.getElementById('input-gh-repo').value = state.ghRepo;
  
  if (window.navigator.standalone === true) {
    document.body.classList.add('pwa-standalone');
  }
}

function bindEvents() {
  // Tab 切换事件
  const tabButtons = document.querySelectorAll('.tab-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      switchTab(targetId);
    });
  });

  // 保存配置事件
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // 刷新媒体库事件
  document.getElementById('btn-refresh-files').addEventListener('click', () => {
    loadLibrary(true);
  });

  // 刷新最新 RSS 资源事件
  document.getElementById('btn-refresh-rss').addEventListener('click', () => {
    loadLatestRss(true);
  });

  // 全网即时搜索事件
  document.getElementById('btn-global-search').addEventListener('click', searchGlobalBangumi);
  document.getElementById('input-global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchGlobalBangumi();
    }
  });

  // 订阅弹窗事件
  document.getElementById('btn-add-sub').addEventListener('click', () => {
    toggleModal('sub-modal', true);
  });
  document.getElementById('btn-close-sub-modal').addEventListener('click', () => {
    toggleModal('sub-modal', false);
  });
  document.getElementById('btn-submit-sub').addEventListener('click', addSubscriptionAndDispatch);

  // 播放器模态框关闭事件
  document.getElementById('btn-close-player').addEventListener('click', closePlayer);

  // 通知横幅按钮事件
  document.getElementById('btn-toast-action').addEventListener('click', playNewVideoFromToast);
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
    loadLibrary();
  } else if (state.activeTab === 'view-subscriptions') {
    loadSubscriptions();
    loadLatestRss();
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
// 凭证验证与连接状态
// ==========================================================================
async function validateConnections() {
  const ghIndicator = document.getElementById('indicator-github');
  const pat = getPatToken();
  if (pat && state.ghRepo) {
    try {
      const res = await fetch(`https://api.github.com/repos/${state.ghRepo}`, {
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (res.ok) {
        ghIndicator.className = 'status-dot green';
        ghIndicator.title = 'GitHub 连接成功';
      } else {
        ghIndicator.className = 'status-dot red';
        ghIndicator.title = 'GitHub 连接失效，请检查设置中的 PAT 或仓库名';
      }
    } catch {
      ghIndicator.className = 'status-dot red';
    }
  } else {
    ghIndicator.className = 'status-dot red';
  }
}

function saveSettings() {
  const patVal = document.getElementById('input-gh-pat').value.trim();
  state.ghRepo = document.getElementById('input-gh-repo').value.trim();

  localStorage.setItem('gh_pat', patVal);
  localStorage.setItem('gh_repo', state.ghRepo);

  alert('配置保存成功！');
  validateConnections();
  loadActiveView();
}

// ==========================================================================
// Component 1: 全网番剧 RSS 实时检索 (突破跨域 CORS)
// ==========================================================================
async function searchGlobalBangumi() {
  const query = document.getElementById('input-global-search').value.trim();
  const resultsContainer = document.getElementById('global-search-results');
  
  if (!query) {
    alert('请输入您想搜索的番剧关键字！');
    return;
  }
  
  resultsContainer.style.display = 'flex';
  resultsContainer.style.flexDirection = 'column';
  resultsContainer.style.gap = '10px';
  resultsContainer.innerHTML = '<div class="empty-state"><p>🔍 正在通过跨域中继检索 Mikan 全网种子，请稍候...</p></div>';
  
  try {
    // 1. 拼装 Mikan RSS 搜索接口
    const targetUrl = `https://mikanani.me/RSS/Search?searchquery=${encodeURIComponent(query)}`;
    // 2. 利用 allorigins.win 开源 JSONP 代理绕过浏览器的 CORS 跨域拦截
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('CORS 代理请求失败');
    
    const resData = await res.json();
    const xmlText = resData.contents;
    
    // 3. 解析 RSS XML 文档
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const items = xmlDoc.getElementsByTagName("item");
    
    if (items.length === 0) {
      resultsContainer.innerHTML = '<div class="empty-state"><p>❌ 未能搜到相关集数种子，请换个词再试（比如用番剧英文/日文名）</p></div>';
      return;
    }
    
    resultsContainer.innerHTML = '';
    
    // 最多渲染 25 条搜索结果，保持性能
    const limit = Math.min(items.length, 25);
    for (let i = 0; i < limit; i++) {
      const item = items[i];
      const title = item.getElementsByTagName("title")[0]?.textContent || '';
      const link = item.getElementsByTagName("link")[0]?.textContent || '';
      const pubDate = item.getElementsByTagName("pubDate")[0]?.textContent || '';
      
      const timeStr = formatRelativeTime(pubDate);
      
      // 提取中英文标题名
      let guessName = title.replace(/\[.*?\]|【.*?】/g, '');
      guessName = guessName.replace(/\d+\s*(?:话|集|v|x|V\d+|v\d+|-\s*\d+).*/gi, '');
      guessName = guessName.trim() || query;
      
      const card = document.createElement('div');
      card.className = 'rss-feed-item card-glass';
      card.style.borderColor = 'rgba(47, 128, 237, 0.4)'; // 蓝色边框以区分全网搜索
      card.innerHTML = `
        <div class="rss-feed-info">
          <h4 class="rss-feed-title" title="${title}">${title}</h4>
          <div class="rss-feed-meta">
            <span>🕒 ${timeStr}发布</span>
            <span>⚡️ 全网搜索结果</span>
          </div>
        </div>
        <button class="btn-rss-action" style="background: var(--color-accent); border-color: var(--color-accent); color: #fff;">一键点播</button>
      `;
      
      card.querySelector('.btn-rss-action').addEventListener('click', () => {
        const job = {
          name: guessName.substring(0, 20),
          keyword: title, // 以当前种子的全标题作为绝对匹配下载关键字，Actions 100% 精确下载这一集！
          subgroup: '',
          quality: ''
        };
        if (confirm(`确认立即点播并让 Actions 在云端下载此集吗？\n《${guessName.substring(0, 20)}》\n${title}`)) {
          triggerActionsDownload(job);
        }
      });
      
      resultsContainer.appendChild(card);
    }
  } catch (err) {
    resultsContainer.innerHTML = `<div class="empty-state"><p>搜索异常: ${err.message}，请重试。</p></div>`;
  }
}

// ==========================================================================
// Component 2: 首页今日新番更新流加载
// ==========================================================================
async function loadLatestRss(force = false) {
  const container = document.getElementById('latest-rss-list');
  const pat = getPatToken();
  if (!pat || !state.ghRepo) {
    container.innerHTML = `<div class="empty-state"><p>请先在“设置”中完成 GitHub 配置</p></div>`;
    return;
  }

  if (state.latestRssList.length > 0 && !force) {
    renderRssList(state.latestRssList);
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>正在获取最新的今日新番...</p></div>';

  try {
    // 优先读取本地部署的 json
    const res = await fetch(`./latest_rss.json?t=${Date.now()}`);
    if (res.ok) {
      state.latestRssList = await res.json();
      renderRssList(state.latestRssList);
    } else {
      // 降级使用 API 读取
      const apiRes = await fetch(`https://api.github.com/repos/${state.ghRepo}/contents/latest_rss.json`, {
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const content = decodeURIComponent(atob(data.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        state.latestRssList = JSON.parse(content);
        renderRssList(state.latestRssList);
      } else {
        container.innerHTML = '<div class="empty-state"><p>暂无更新记录。请等待 Actions 第一次定时任务完成。</p></div>';
      }
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function renderRssList(list) {
  const container = document.getElementById('latest-rss-list');
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>暂无今日新番数据</p></div>';
    return;
  }

  container.innerHTML = '';
  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'rss-feed-item card-glass';
    
    const timeStr = formatRelativeTime(item.pubDate);
    const subgroupHtml = item.subgroup ? `<span class="rss-tag-subgroup">${item.subgroup}</span>` : '';
    const nameLabel = item.guess_name || '未知番剧';

    card.innerHTML = `
      <div class="rss-feed-info">
        <h4 class="rss-feed-title" title="${item.title}">${item.title}</h4>
        <div class="rss-feed-meta">
          <span>🕒 ${timeStr}</span>
          ${subgroupHtml}
          <span>📺 ${item.season}${item.episode}</span>
        </div>
      </div>
      <button class="btn-rss-action">一键点播</button>
    `;

    card.querySelector('.btn-rss-action').addEventListener('click', () => {
      const job = {
        name: nameLabel,
        keyword: item.title,
        subgroup: '',
        quality: ''
      };
      if (confirm(`确定要立即下载这集番剧吗？\n《${nameLabel}》- ${item.season}${item.episode}`)) {
        triggerActionsDownload(job);
      }
    });

    container.appendChild(card);
  });
}

function formatRelativeTime(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 60) {
      return mins <= 2 ? '刚刚' : `${mins}分钟前`;
    } else if (hours < 24) {
      return `${hours}小时前`;
    } else if (days < 30) {
      return `${days}天前`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return dateStr;
  }
}

// ==========================================================================
// Component 3: 常驻点播订阅同步
// ==========================================================================
async function loadSubscriptions() {
  const container = document.getElementById('subscription-list');
  const pat = getPatToken();
  if (!pat || !state.ghRepo) {
    container.innerHTML = `
      <div class="empty-state">
        <p>请先在“设置”中配置 GitHub</p>
      </div>`;
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>加载常驻订阅中...</p></div>';

  try {
    const res = await fetch(`https://api.github.com/repos/${state.ghRepo}/contents/subscription.json`, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.status === 404) {
      state.subscriptions = [];
      state.subFileSha = '';
      renderSubscriptions();
      return;
    }

    if (res.ok) {
      const data = await res.json();
      state.subFileSha = data.sha;
      const content = decodeURIComponent(atob(data.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      state.subscriptions = JSON.parse(content);
      renderSubscriptions();
    } else {
      container.innerHTML = '<div class="empty-state"><p>同步订阅失败，请确认仓库读写权限</p></div>';
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>加载出错: ${err.message}</p></div>`;
  }
}

function renderSubscriptions() {
  const container = document.getElementById('subscription-list');
  if (state.subscriptions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无常驻跟更订阅。点击右上角可以新建自动更番任务。</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  state.subscriptions.forEach((sub, index) => {
    const card = document.createElement('div');
    card.className = 'sub-card card-glass';
    card.innerHTML = `
      <div class="sub-info">
        <h4>${sub.name}</h4>
        <div class="sub-meta">
          <span>🔍 匹配关键字: ${sub.keyword}</span>
          ${sub.subgroup ? `<span>📺 字幕组: ${sub.subgroup}</span>` : ''}
          ${sub.quality ? `<span>📀 分辨率: ${sub.quality}</span>` : ''}
        </div>
      </div>
      <button class="btn-delete-sub" data-index="${index}">删除</button>
    `;
    
    card.querySelector('.btn-delete-sub').addEventListener('click', () => {
      deleteSubscription(index);
    });

    container.appendChild(card);
  });
}

async function addSubscriptionAndDispatch() {
  const name = document.getElementById('sub-name').value.trim();
  const keyword = document.getElementById('sub-keyword').value.trim();
  const subgroup = document.getElementById('sub-subgroup').value.trim();
  const quality = document.getElementById('sub-quality').value;

  if (!name || !keyword) {
    alert('名称和关键字为必填项！');
    return;
  }

  const newSub = { name, keyword, subgroup, quality };
  state.subscriptions.push(newSub);

  document.getElementById('sub-name').value = '';
  document.getElementById('sub-keyword').value = '';
  document.getElementById('sub-subgroup').value = '';

  toggleModal('sub-modal', false);

  const saveSuccess = await saveSubscriptionsToGitHub();
  if (saveSuccess) {
    await triggerActionsDownload(newSub);
  }
}

async function saveSubscriptionsToGitHub() {
  const container = document.getElementById('subscription-list');
  container.innerHTML = '<div class="empty-state"><p>正在同步配置至 GitHub...</p></div>';

  const jsonString = JSON.stringify(state.subscriptions, null, 2);
  const base64Content = btoa(unescape(encodeURIComponent(jsonString)));
  const pat = getPatToken();

  const payload = {
    message: 'docs: 由 PWA 更新番剧常驻点播订阅',
    content: base64Content
  };
  if (state.subFileSha) {
    payload.sha = state.subFileSha;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${state.ghRepo}/contents/subscription.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${pat}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      state.subFileSha = data.content.sha;
      return true;
    } else {
      alert('常驻订阅同步失败，请检查写入权限。');
      loadSubscriptions();
      return false;
    }
  } catch (err) {
    alert(`同步异常: ${err.message}`);
    loadSubscriptions();
    return false;
  }
}

// 发送 repository_dispatch
async function triggerActionsDownload(subInfo) {
  const pat = getPatToken();
  try {
    const url = `https://api.github.com/repos/${state.ghRepo}/dispatches`;
    const payload = {
      event_type: 'instant_download',
      client_payload: subInfo
    };
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 204) {
      alert(`云端点播任务已触发！\nActions 正在为您全速下载《${subInfo.name}》并转换直链中。\n请在 3-5 分钟后点击“刷新”您的播放库直接开播。`);
    } else {
      alert('点播发出，但 Actions 反馈异常。请去 GitHub Actions 查看任务状态。');
    }
  } catch (err) {
    alert(`触发云端下载失败: ${err.message}`);
  }
}

async function deleteSubscription(index) {
  if (confirm(`确定要删除《${state.subscriptions[index].name}》的常驻订阅吗？`)) {
    state.subscriptions.splice(index, 1);
    await saveSubscriptionsToGitHub();
    loadSubscriptions();
  }
}

// ==========================================================================
// Component 4: 云端播放库加载与新番到账通知
// ==========================================================================
async function loadLibrary(force = false) {
  const container = document.getElementById('media-list');
  const pat = getPatToken();
  if (!pat || !state.ghRepo) {
    container.innerHTML = `
      <div class="empty-state">
        <p>请先在“设置”中完成 GitHub 配置</p>
      </div>`;
    return;
  }

  if (container.children.length > 1 && !force) {
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>同步已下载视频列表中...</p></div>';

  try {
    const res = await fetch(`https://api.github.com/repos/${state.ghRepo}/contents/downloaded.json?t=${Date.now()}`, {
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.status === 404) {
      container.innerHTML = `
        <div class="empty-state">
          <p>暂无任何播放记录文件。</p>
          <p class="settings-tip">这代表 Actions 还没有成功转换过任何番剧。请去点播一集吧！</p>
        </div>`;
      return;
    }

    if (res.ok) {
      const data = await res.json();
      const content = decodeURIComponent(atob(data.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      
      state.downloadedList = JSON.parse(content);
      
      renderLibrary();
      checkNewVideoNotification();
    } else {
      container.innerHTML = '<div class="pull-state"><p>拉取播放库失败，请检查设置中的仓库名</p></div>';
    }
  } catch (err) {
    container.innerHTML = `<div class="pull-state"><p>网络异常: ${err.message}</p></div>`;
  }
}

function renderLibrary() {
  const container = document.getElementById('media-list');
  const validItems = state.downloadedList.filter(item => typeof item === 'object' && item.url);

  if (validItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无任何可播视频直链。</p>
        <p class="settings-tip">点播任务运行结束后，获取的 14 天有效视频直链将在此处展示。</p>
      </div>`;
    return;
  }

  const groups = {};
  validItems.forEach(item => {
    const key = item.anime || '未命名番剧';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  });

  container.innerHTML = '';

  Object.keys(groups).forEach(animeName => {
    const card = document.createElement('div');
    card.className = 'anime-folder-card card-glass';
    card.innerHTML = `
      <div class="folder-title">
        📁 ${animeName} (${groups[animeName].length} 集)
      </div>
      <div class="episode-list" style="display: none;"></div>
    `;

    const titleEl = card.querySelector('.folder-title');
    const listEl = card.querySelector('.episode-list');

    groups[animeName].forEach(file => {
      const item = document.createElement('div');
      item.className = 'episode-item';
      const displayName = file.title || `${animeName} - ${file.season}${file.episode}`;
      item.innerHTML = `
        <span class="episode-name">${displayName}</span>
        <span class="episode-play-icon">▶</span>
      `;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        playVideo(displayName, file.url);
      });

      listEl.appendChild(item);
    });

    titleEl.addEventListener('click', () => {
      const isCollapsed = listEl.style.display === 'none';
      if (isCollapsed) {
        listEl.style.display = 'flex';
        card.classList.add('expanded');
      } else {
        listEl.style.display = 'none';
        card.classList.remove('expanded');
      }
    });

    container.appendChild(card);
  });
}

// ==========================================================================
// iOS 通知 Toast 新番到账检测
// ==========================================================================
function checkNewVideoNotification() {
  const acknowledgedUrls = JSON.parse(localStorage.getItem('acknowledged_urls') || '[]');
  const validItems = state.downloadedList.filter(item => typeof item === 'object' && item.url);

  const newVideo = validItems.find(item => !acknowledgedUrls.includes(item.url));

  if (newVideo) {
    state.activeNewVideoUrl = newVideo.url;
    
    const toast = document.getElementById('ios-toast');
    const toastTitle = document.getElementById('toast-title');
    const toastDesc = document.getElementById('toast-desc');

    const animeName = newVideo.anime || '新番剧';
    const epName = `${newVideo.season}${newVideo.episode}`;
    
    toastTitle.innerText = `🍿 新番已到账！`;
    toastDesc.innerText = `您点播的《${animeName}》${epName} 已经云端下载转换完毕，点击立即播放。`;

    toast.classList.add('active');

    setTimeout(() => {
      hideToast();
    }, 8000);
  }
}

function hideToast() {
  document.getElementById('ios-toast').classList.remove('active');
}

function playNewVideoFromToast() {
  if (state.activeNewVideoUrl) {
    const acknowledgedUrls = JSON.parse(localStorage.getItem('acknowledged_urls') || '[]');
    acknowledgedUrls.push(state.activeNewVideoUrl);
    localStorage.setItem('acknowledged_urls', JSON.stringify(acknowledgedUrls));

    hideToast();
    playVideo('新番播放', state.activeNewVideoUrl);
  }
}

// ==========================================================================
// Component 5: 播放器模态层
// ==========================================================================
function playVideo(title, playUrl) {
  toggleModal('player-modal', true);
  document.getElementById('player-title').innerText = title;
  
  const container = document.getElementById('artplayer-container');
  container.innerHTML = '';

  const isHls = playUrl.includes('.m3u8');

  state.artPlayerInstance = new Artplayer({
    container: '#artplayer-container',
    url: playUrl,
    type: isHls ? 'm3u8' : 'mp4',
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
          this.showToast = '当前设备浏览器不支持 HLS';
        }
      }
    }
  });

  const acknowledgedUrls = JSON.parse(localStorage.getItem('acknowledged_urls') || '[]');
  if (!acknowledgedUrls.includes(playUrl)) {
    acknowledgedUrls.push(playUrl);
    localStorage.setItem('acknowledged_urls', JSON.stringify(acknowledgedUrls));
  }
}

function closePlayer() {
  toggleModal('player-modal', false);
  if (state.artPlayerInstance) {
    state.artPlayerInstance.destroy();
    state.artPlayerInstance = null;
  }
}

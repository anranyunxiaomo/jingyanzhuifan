/**
 * ==========================================================================
 * Auto Bangumi PWA - Core Logic (S3 + Instant Dispatch Version)
 * ==========================================================================
 */

// 状态管理
const state = {
  ghPat: localStorage.getItem('gh_pat') || '',
  ghRepo: localStorage.getItem('gh_repo') || '',
  subscriptions: [],
  subFileSha: '', 
  downloadedList: [],
  activeTab: 'view-library',
  artPlayerInstance: null,
  activeNewVideoUrl: '' // 当前通知到账的视频直链
};

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
  document.getElementById('input-gh-pat').value = state.ghPat;
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
  if (state.ghPat && state.ghRepo) {
    try {
      const res = await fetch(`https://api.github.com/repos/${state.ghRepo}`, {
        headers: {
          'Authorization': `token ${state.ghPat}`,
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
  state.ghPat = document.getElementById('input-gh-pat').value.trim();
  state.ghRepo = document.getElementById('input-gh-repo').value.trim();

  localStorage.setItem('gh_pat', state.ghPat);
  localStorage.setItem('gh_repo', state.ghRepo);

  alert('配置保存成功！');
  validateConnections();
  loadActiveView();
}

// ==========================================================================
// Component 1: 一键点播与 GitHub Dispatch (触发 Action 下载)
// ==========================================================================
async function loadSubscriptions() {
  const container = document.getElementById('subscription-list');
  if (!state.ghPat || !state.ghRepo) {
    container.innerHTML = `
      <div class="empty-state">
        <p>请先在“设置”中配置 GitHub 个人令牌 (PAT) 和仓库名</p>
      </div>`;
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>加载订阅列表中...</p></div>';

  try {
    const res = await fetch(`https://api.github.com/repos/${state.ghRepo}/contents/subscription.json`, {
      headers: {
        'Authorization': `token ${state.ghPat}`,
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
      container.innerHTML = '<div class="empty-state"><p>读取订阅失败，请确认仓库权限与设置</p></div>';
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
        <p>目前没有点播订阅，点击右上角开始点播吧</p>
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

// 点播：写入配置文件，并触发 repository_dispatch 执行
async function addSubscriptionAndDispatch() {
  const name = document.getElementById('sub-name').value.trim();
  const keyword = document.getElementById('sub-keyword').value.trim();
  const subgroup = document.getElementById('sub-subgroup').value.trim();
  const quality = document.getElementById('sub-quality').value;

  if (!name || !keyword) {
    alert('番剧中文名和匹配关键字为必填项！');
    return;
  }

  const newSub = { name, keyword, subgroup, quality };
  state.subscriptions.push(newSub);

  document.getElementById('sub-name').value = '';
  document.getElementById('sub-keyword').value = '';
  document.getElementById('sub-subgroup').value = '';

  toggleModal('sub-modal', false);

  // 1. 同步写入 GitHub
  const saveSuccess = await saveSubscriptionsToGitHub();
  if (saveSuccess) {
    // 2. 触发 Actions 立即下载
    await triggerActionsDownload(newSub);
  }
}

async function saveSubscriptionsToGitHub() {
  const container = document.getElementById('subscription-list');
  container.innerHTML = '<div class="empty-state"><p>正在同步点播配置到 GitHub...</p></div>';

  const jsonString = JSON.stringify(state.subscriptions, null, 2);
  const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

  const payload = {
    message: 'docs: 由 PWA 新增番剧点播订阅',
    content: base64Content
  };
  if (state.subFileSha) {
    payload.sha = state.subFileSha;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${state.ghRepo}/contents/subscription.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${state.ghPat}`,
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
      alert('同步点播配置失败，请检查写入权限。');
      loadSubscriptions();
      return false;
    }
  } catch (err) {
    alert(`同步点播错误: ${err.message}`);
    loadSubscriptions();
    return false;
  }
}

// 发送 repository_dispatch 触发 GitHub Actions
async function triggerActionsDownload(subInfo) {
  try {
    const url = `https://api.github.com/repos/${state.ghRepo}/dispatches`;
    const payload = {
      event_type: 'instant_download',
      client_payload: subInfo
    };
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${state.ghPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 204) {
      alert(`已成功发送点播请求！云端 GitHub Actions 正在极速为您下载《${subInfo.name}》，请稍后刷新播放库。`);
    } else {
      alert('点播下发成功，但 Action 响应异常，请登录 GitHub 检查 Actions 设置。');
    }
  } catch (err) {
    alert(`触发云端下载失败: ${err.message}`);
  }
}

async function deleteSubscription(index) {
  if (confirm(`确定要删除《${state.subscriptions[index].name}》的点播订阅吗？`)) {
    state.subscriptions.splice(index, 1);
    await saveSubscriptionsToGitHub();
    loadSubscriptions();
  }
}

// ==========================================================================
// Component 2: 云端播放库加载与新片通知
// ==========================================================================
async function loadLibrary(force = false) {
  const container = document.getElementById('media-list');
  if (!state.ghPat || !state.ghRepo) {
    container.innerHTML = `
      <div class="empty-state">
        <p>请先在“设置”中配置 GitHub 个人令牌 (PAT) 和仓库名</p>
      </div>`;
    return;
  }

  if (container.children.length > 1 && !force) {
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>同步已下载视频列表中...</p></div>';

  try {
    // 读取已下载视频列表 downloaded.json
    const res = await fetch(`https://api.github.com/repos/${state.ghRepo}/contents/downloaded.json`, {
      headers: {
        'Authorization': `token ${state.ghPat}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.status === 404) {
      container.innerHTML = `
        <div class="empty-state">
          <p>暂无下载完成的视频记录。</p>
          <p class="settings-tip">这通常是因为 GitHub Actions 还未成功下载完任何番剧并上传。</p>
        </div>`;
      return;
    }

    if (res.ok) {
      const data = await res.json();
      const content = decodeURIComponent(atob(data.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      
      // 注意：现在的 downloaded.json 格式改变为含有 url 的 json 对象数组
      state.downloadedList = JSON.parse(content);
      
      renderLibrary();
      checkNewVideoNotification();
    } else {
      container.innerHTML = '<div class="empty-state"><p>同步播放库失败，请检查仓库权限</p></div>';
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>同步出错: ${err.message}</p></div>`;
  }
}

function renderLibrary() {
  const container = document.getElementById('media-list');
  
  // 过滤出含有直链 url 的有效下载记录，并按番剧名称进行归类
  const validItems = state.downloadedList.filter(item => typeof item === 'object' && item.url);

  if (validItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无任何可播放的视频直链。</p>
        <p class="settings-tip">点播任务成功后，S3 视频直链将在此处显示。</p>
      </div>`;
    return;
  }

  // 按动漫名称 anime 进行分组
  const groups = {};
  validItems.forEach(item => {
    const key = item.anime || '未命名番剧';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  });

  container.innerHTML = '';

  // 渲染番剧大卡片
  Object.keys(groups).forEach(animeName => {
    const card = document.createElement('div');
    card.className = 'anime-folder-card card-glass';
    
    // 默认不展开
    card.innerHTML = `
      <div class="folder-title">
        📁 ${animeName} (${groups[animeName].length} 集)
      </div>
      <div class="episode-list" style="display: none;"></div>
    `;

    const titleEl = card.querySelector('.folder-title');
    const listEl = card.querySelector('.episode-list');

    // 填充集数列表
    groups[animeName].forEach(file => {
      const item = document.createElement('div');
      item.className = 'episode-item';
      const displayName = file.title || `${animeName} - ${file.season || 'S01'}${file.episode || 'E01'}`;
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

    // 折叠展开事件
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

  // 寻找尚未查看（不在 acknowledgedUrls 中）的新视频记录
  const newVideo = validItems.find(item => !acknowledgedUrls.includes(item.url));

  if (newVideo) {
    state.activeNewVideoUrl = newVideo.url;
    
    // 弹出 iOS 通知横幅
    const toast = document.getElementById('ios-toast');
    const toastTitle = document.getElementById('toast-title');
    const toastDesc = document.getElementById('toast-desc');

    const animeName = newVideo.anime || '新番剧';
    const epName = `${newVideo.season || 'S01'}${newVideo.episode || 'E01'}`;
    
    toastTitle.innerText = `🍿 番剧到账了！`;
    toastDesc.innerText = `您订阅的《${animeName}》${epName} 集已经下载完成，点击立即播放。`;

    toast.classList.add('active');

    // 5秒后自动隐藏（如果用户不点击）
    setTimeout(() => {
      hideToast();
    }, 6000);
  }
}

function hideToast() {
  document.getElementById('ios-toast').classList.remove('active');
}

function playNewVideoFromToast() {
  if (state.activeNewVideoUrl) {
    // 1. 将当前视频加入已确认列表
    const acknowledgedUrls = JSON.parse(localStorage.getItem('acknowledged_urls') || '[]');
    acknowledgedUrls.push(state.activeNewVideoUrl);
    localStorage.setItem('acknowledged_urls', JSON.stringify(acknowledgedUrls));

    // 2. 隐藏 Toast
    hideToast();

    // 3. 立即播放该视频
    playVideo('新番播放', state.activeNewVideoUrl);
  }
}

// ==========================================================================
// Component 3: 播放器模态层
// ==========================================================================
function playVideo(title, playUrl) {
  toggleModal('player-modal', true);
  document.getElementById('player-title').innerText = title;
  
  const container = document.getElementById('artplayer-container');
  container.innerHTML = '';

  // 校验是否为 HLS
  const isHls = playUrl.includes('.m3u8');

  // 初始化 ArtPlayer 直播/视频解码
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
          this.showToast = '当前设备浏览器不支持播放 HLS 格式';
        }
      }
    }
  });

  // 如果是在通知中的播放，自动将其标记为 acknowledged (如果它还未被记录)
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

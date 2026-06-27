/**
 * ==========================================================================
 * Auto Bangumi PWA - Core Logic (Apple Minimal 2026)
 * ==========================================================================
 */

// 状态管理
const state = {
  ghPat: localStorage.getItem('gh_pat') || '',
  ghRepo: localStorage.getItem('gh_repo') || '',
  baiduToken: localStorage.getItem('baidu_token') || '',
  baiduDir: localStorage.getItem('baidu_dir') || '/apps/AutoBangumi',
  subscriptions: [],
  subFileSha: '', // GitHub 端 subscription.json 的 sha，用于 PUT 更新时校验
  activeTab: 'view-library',
  artPlayerInstance: null
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
  // 填充设置表单默认值
  document.getElementById('input-gh-pat').value = state.ghPat;
  document.getElementById('input-gh-repo').value = state.ghRepo;
  document.getElementById('input-baidu-token').value = state.baiduToken;
  document.getElementById('input-baidu-dir').value = state.baiduDir;
  
  // 处理 iOS PWA 独立运行时的特殊全屏类
  if (window.navigator.standalone === true) {
    document.body.classList.add('pwa-standalone');
  }
}

function bindEvents() {
  // TabBar 切换事件
  const tabButtons = document.querySelectorAll('.tab-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
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
  document.getElementById('btn-submit-sub').addEventListener('click', addSubscription);

  // 播放器模态框关闭事件
  document.getElementById('btn-close-player').addEventListener('click', closePlayer);
}

function switchTab(targetId) {
  // 激活按钮样式切换
  document.querySelectorAll('.tab-item').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-target') === targetId) {
      btn.classList.add('active');
    }
  });

  // 激活视图切换
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.remove('active');
  });
  
  const targetSec = document.getElementById(targetId);
  targetSec.classList.add('active');
  state.activeTab = targetId;

  // 切换后按需拉取数据
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
  // 1. 验证 GitHub
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
        ghIndicator.title = 'GitHub 已连接';
      } else {
        ghIndicator.className = 'status-dot red';
        ghIndicator.title = 'GitHub 连接失效, 请检查 Token 或仓库';
      }
    } catch {
      ghIndicator.className = 'status-dot red';
    }
  } else {
    ghIndicator.className = 'status-dot red';
  }

  // 2. 验证 百度网盘
  const baiduIndicator = document.getElementById('indicator-baidu');
  if (state.baiduToken) {
    try {
      const res = await fetch(`https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token=${state.baiduToken}`);
      const data = await res.json();
      if (data.errno === 0) {
        baiduIndicator.className = 'status-dot green';
        baiduIndicator.title = `百度云已连接 (${data.baidu_name})`;
      } else {
        baiduIndicator.className = 'status-dot red';
        baiduIndicator.title = '百度云连接失效, 请更新 Token';
      }
    } catch {
      baiduIndicator.className = 'status-dot red';
    }
  } else {
    baiduIndicator.className = 'status-dot red';
  }
}

function saveSettings() {
  state.ghPat = document.getElementById('input-gh-pat').value.trim();
  state.ghRepo = document.getElementById('input-gh-repo').value.trim();
  state.baiduToken = document.getElementById('input-baidu-token').value.trim();
  state.baiduDir = document.getElementById('input-baidu-dir').value.trim();

  localStorage.setItem('gh_pat', state.ghPat);
  localStorage.setItem('gh_repo', state.ghRepo);
  localStorage.setItem('baidu_token', state.baiduToken);
  localStorage.setItem('baidu_dir', state.baiduDir);

  alert('配置保存成功！');
  validateConnections();
  loadActiveView();
}

// ==========================================================================
// Component 1: 追番订阅逻辑 (GitHub integration)
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
      // 文件不存在，初始化为空
      state.subscriptions = [];
      state.subFileSha = '';
      renderSubscriptions();
      return;
    }

    if (res.ok) {
      const data = await res.json();
      state.subFileSha = data.sha;
      // GitHub API 返回的 content 是 base64 编码的，需要解码
      const content = decodeURIComponent(atob(data.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      state.subscriptions = JSON.parse(content);
      renderSubscriptions();
    } else {
      container.innerHTML = '<div class="empty-state"><p>读取订阅失败，请检查设置中的 GitHub 配置</p></div>';
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
        <p>目前没有订阅番剧，点击右上角开始订阅吧</p>
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
          <span>🔍 关键字: ${sub.keyword}</span>
          ${sub.subgroup ? `<span>📺 字幕组: ${sub.subgroup}</span>` : ''}
          ${sub.quality ? `<span>📀 分辨率: ${sub.quality}</span>` : ''}
        </div>
      </div>
      <button class="btn-delete-sub" data-index="${index}">删除</button>
    `;
    
    // 绑定删除按钮事件
    card.querySelector('.btn-delete-sub').addEventListener('click', () => {
      deleteSubscription(index);
    });

    container.appendChild(card);
  });
}

async function addSubscription() {
  const name = document.getElementById('sub-name').value.trim();
  const keyword = document.getElementById('sub-keyword').value.trim();
  const subgroup = document.getElementById('sub-subgroup').value.trim();
  const quality = document.getElementById('sub-quality').value;

  if (!name || !keyword) {
    alert('番剧名和匹配关键字为必填项！');
    return;
  }

  const newSub = { name, keyword, subgroup, quality };
  state.subscriptions.push(newSub);

  // 清空表单
  document.getElementById('sub-name').value = '';
  document.getElementById('sub-keyword').value = '';
  document.getElementById('sub-subgroup').value = '';

  toggleModal('sub-modal', false);
  await saveSubscriptionsToGitHub();
}

async function deleteSubscription(index) {
  if (confirm(`确定要删除对番剧《${state.subscriptions[index].name}》的订阅吗？`)) {
    state.subscriptions.splice(index, 1);
    await saveSubscriptionsToGitHub();
  }
}

async function saveSubscriptionsToGitHub() {
  const container = document.getElementById('subscription-list');
  container.innerHTML = '<div class="empty-state"><p>正在同步修改至 GitHub...</p></div>';

  // 将 JS 对象转为带缩进的 JSON 并 Base64 编码
  const jsonString = JSON.stringify(state.subscriptions, null, 2);
  const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

  const payload = {
    message: 'docs: 由 PWA 更新番剧订阅配置',
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
      loadSubscriptions();
    } else {
      alert('同步失败，请检查 GitHub 仓库写入权限。');
      loadSubscriptions();
    }
  } catch (err) {
    alert(`同步错误: ${err.message}`);
    loadSubscriptions();
  }
}

// ==========================================================================
// Component 2: 媒体库列表逻辑 (Baidu Netdisk Integration)
// ==========================================================================
async function loadLibrary(force = false) {
  const container = document.getElementById('media-list');
  if (!state.baiduToken) {
    container.innerHTML = `
      <div class="empty-state">
        <p>请先在“设置”中完成百度网盘授权</p>
      </div>`;
    return;
  }

  // 避免每次切换 Tab 都重复去百度拉列表（除非点击了刷新）
  if (container.children.length > 1 && !force) {
    return;
  }

  container.innerHTML = '<div class="empty-state"><p>加载百度网盘番剧目录中...</p></div>';

  try {
    // 1. 获取主目录下的所有文件夹（每个番剧一个文件夹）
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=list&access_token=${state.baiduToken}&dir=${encodeURIComponent(state.baiduDir)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.errno !== 0) {
      container.innerHTML = `<div class="empty-state"><p>获取目录失败。百度错误码: ${data.errno}</p></div>`;
      return;
    }

    const items = data.list || [];
    const folders = items.filter(item => item.isdir === 1);

    if (folders.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>百度网盘目录 ${state.baiduDir} 为空。</p>
          <p class="settings-tip">请确保云端的 GitHub Actions 已成功运行并下载了番剧。</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    
    // 渲染番剧文件夹卡片
    folders.forEach(folder => {
      const card = document.createElement('div');
      card.className = 'anime-folder-card card-glass';
      card.innerHTML = `
        <div class="folder-title" data-path="${folder.path}">
          📁 ${folder.server_filename}
        </div>
        <div class="episode-list" style="display: none;">
          <div class="empty-state" style="padding: 20px;"><p>加载集数中...</p></div>
        </div>
      `;

      // 绑定折叠展开与按需拉取视频事件
      const titleEl = card.querySelector('.folder-title');
      const listEl = card.querySelector('.episode-list');
      
      titleEl.addEventListener('click', async () => {
        const isCollapsed = listEl.style.display === 'none';
        if (isCollapsed) {
          listEl.style.display = 'flex';
          // 如果列表还没拉取，去拉取
          if (listEl.querySelector('.empty-state')) {
            await loadFolderEpisodes(folder.path, listEl);
          }
        } else {
          listEl.style.display = 'none';
        }
      });

      container.appendChild(card);
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>请求出错: ${err.message}</p></div>`;
  }
}

// 递归/深层拉取子文件夹（支持 Season 1 目录结构）
async function loadFolderEpisodes(dirPath, listContainer) {
  try {
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=list&access_token=${state.baiduToken}&dir=${encodeURIComponent(dirPath)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.errno !== 0) {
      listContainer.innerHTML = `<div class="empty-state"><p>加载失败 (码:${data.errno})</p></div>`;
      return;
    }

    const items = data.list || [];
    
    // 区分文件夹和文件
    const subDirs = items.filter(item => item.isdir === 1);
    const files = items.filter(item => item.isdir === 0 && isVideo(item.server_filename));

    listContainer.innerHTML = '';

    // 如果包含子目录 (如 Season 1)，进行二级渲染
    if (subDirs.length > 0) {
      for (const subDir of subDirs) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'sub-group-header';
        groupHeader.style.cssText = 'font-size: 12px; color: var(--color-accent); font-weight:600; margin: 8px 0 4px 4px;';
        groupHeader.innerText = subDir.server_filename;
        listContainer.appendChild(groupHeader);
        
        // 获取子目录里的视频
        const subUrl = `https://pan.baidu.com/rest/2.0/xpan/file?method=list&access_token=${state.baiduToken}&dir=${encodeURIComponent(subDir.path)}`;
        const subRes = await fetch(subUrl);
        const subData = await subRes.json();
        if (subData.errno === 0) {
          const subFiles = (subData.list || []).filter(item => item.isdir === 0 && isVideo(item.server_filename));
          subFiles.forEach(file => {
            renderEpisodeItem(file, listContainer);
          });
        }
      }
    }

    // 渲染直接存放在根目录的视频文件
    files.forEach(file => {
      renderEpisodeItem(file, listContainer);
    });

    if (listContainer.children.length === 0) {
      listContainer.innerHTML = '<div class="empty-state" style="padding:20px;"><p>该目录下暂无视频文件</p></div>';
    }

  } catch (err) {
    listContainer.innerHTML = `<div class="empty-state"><p>加载失败: ${err.message}</p></div>`;
  }
}

function renderEpisodeItem(file, container) {
  const item = document.createElement('div');
  item.className = 'episode-item';
  item.innerHTML = `
    <span class="episode-name">${file.server_filename}</span>
    <span class="episode-play-icon">▶</span>
  `;

  // 绑定播放事件
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    playVideo(file.server_filename, file.path);
  });

  container.appendChild(item);
}

function isVideo(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm3u8'].includes(ext);
}

// ==========================================================================
// Component 3: 播放器核心逻辑 (Baidu Streaming API & ArtPlayer)
// ==========================================================================
async function playVideo(title, filePath) {
  toggleModal('player-modal', true);
  document.getElementById('player-title').innerText = title;
  
  const container = document.getElementById('artplayer-container');
  container.innerHTML = '<div class="empty-state"><p>云端转码视频流中...</p></div>';

  try {
    // 1. 调用百度视频流 API 获取 HLS/m3u8 直链
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=streaming&access_token=${state.baiduToken}&path=${encodeURIComponent(filePath)}&type=advisable`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.errno !== 0) {
      container.innerHTML = `
        <div class="empty-state" style="color:var(--color-danger)">
          <p>获取播放链接失败。</p>
          <p class="settings-tip">百度错误码: ${data.errno}，请确认网盘支持该格式在线转码。</p>
        </div>`;
      return;
    }

    const m3u8Url = data.result.advisable;
    if (!m3u8Url) {
      container.innerHTML = '<div class="empty-state"><p>百度云未返回有效的转码流</p></div>';
      return;
    }

    container.innerHTML = '';

    // 2. 初始化 ArtPlayer
    state.artPlayerInstance = new Artplayer({
      container: '#artplayer-container',
      url: m3u8Url,
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
            // 绑定到 artplayer 的 destroy 事件上
            this.on('destroy', () => hls.destroy());
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // 原生 Safari 支持 m3u8 播放
            video.src = url;
          } else {
            this.showToast = '浏览器不支持 HLS/m3u8 播放';
          }
        }
      }
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--color-danger)"><p>播放出错: ${err.message}</p></div>`;
  }
}

function closePlayer() {
  toggleModal('player-modal', false);
  if (state.artPlayerInstance) {
    state.artPlayerInstance.destroy();
    state.artPlayerInstance = null;
  }
}

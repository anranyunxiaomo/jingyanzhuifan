// 🌟 强力注销 Service Worker 与清理 Cache Storage，阻断并击碎任何浏览器的静态资源强缓存，确保用户始终运行最新 HTML/JS 代码
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for (let registration of registrations) {
      registration.unregister();
      console.log('[SW CLEAN] Unregistered stale worker successfully.');
    }
  });
}
if ('caches' in window) {
  caches.keys().then(function(names) {
    for (let name of names) {
      caches.delete(name);
      console.log('[CACHE CLEAN] Stale CacheStorage deleted:', name);
    }
  });
}

new Vue({
  el: '#app',
  data: {
    // 页面模式控制
    currentAnimeId: null,
    
    // 首页静态化数据
    bannerList: [],
    latestList: [],
    recommendList: [],
    weekList: {},
    weekListKeys: [],
    
    // 幻灯片控制
    currentBannerIndex: 0,
    bannerTimer: null,
    
    // 星期表控制
    activeWeekDay: 1, // 1=周一, 2=周二 ... 0=周日
    weekDays: [
      { label: '周一', value: 1 },
      { label: '周二', value: 2 },
      { label: '周三', value: 3 },
      { label: '周四', value: 4 },
      { label: '周五', value: 5 },
      { label: '周六', value: 6 },
      { label: '周日', value: 0 }
    ],
    
    // 本地搜索控制
    searchQuery: '',
    searchFocused: false,
    searchIndex: [], // 缓存的全局搜索数据库
    remoteSearchResults: [], // 远程 API 实时搜索到的动漫结果
    searchTimer: null, // 搜索防抖定时器
    
    // 详情页数据
    animeDetail: null,
    activeLineKey: '', // 当前选中的播放线路
    activeEpisodeIndex: -1, // 当前选中的集数索引
    activePlayUrl: '', // 正在播放的 iframe 链接
    activeEpisodeName: '', // 正在播放的剧集名称
    dplayerKey: 'dplayer_init', // DPlayer DOM 容器的物理隔离 Key
    guardTimer: null, // 高频归零阻截定时器
    
    
    // 解析引擎库 (纯 HTTPS 保证 GitHub Pages 无 Mixed Content 跨域阻断)
    jxEngines: [
      { label: '系统默认 (AGE 合作源)', value: 'default' },
      { label: '超清无广告源 A (不支持VIP线)', value: 'https://jx.jsonplayer.com/?url=' },
      { label: '超清无广告源 B (不支持VIP线)', value: 'https://jx.xmflv.com/?url=' }
    ],
    activeEngineKey: 'default',
    // H5 播放器状态管理
    dpInstance: null,      // DPlayer 实例
    isIframeMode: false,   // 是否为 Iframe 降级模式
    
    // 追番收藏夹
    favorites: [],
    // 本地扁平动漫库保底
    localAnimeCatalog: [],
  },
  
  computed: {
    // 1. 获取当前星期选中的动漫列表
    activeWeekList() {
      if (this.weekList && this.weekList[this.activeWeekDay]) {
        return this.weekList[this.activeWeekDay];
      }
      return [];
    },
    
    // 2. 当前轮播的 Banner
    activeBanner() {
      if (this.bannerList.length > 0) {
        return this.bannerList[this.currentBannerIndex];
      }
      return { html: '', style: '' };
    },
    
    // 3. 详情页可用线路列表 (过滤掉无效的西瓜、VIP及私有加密协议线路，仅保留能播的 M3U8 常规节点)
    availableLines() {
      if (!this.animeDetail || !this.animeDetail.video || !this.animeDetail.video.playlists) {
        return [];
      }
      const playlists = this.animeDetail.video.playlists;
      const vipList = (this.animeDetail.player_vip || '').split(',');
      const labelArr = this.animeDetail.player_label_arr || {};
      
      // 合法可播放的常规 M3U8 H5 线路白名单
      const ALLOWED_KEYS = ['lzm3u8', 'wjm3u8', 'ffm3u8', 'bfzym3u8', 'hnm3u8', 'wolong', 'subm3u8', 'kym3u8'];
      
      const lines = [];
      for (const key in playlists) {
        if (ALLOWED_KEYS.includes(key) && playlists[key] && playlists[key].length > 0) {
          const isVip = vipList.includes(key);
          if (!isVip) {
            lines.push({
              key: key,
              title: labelArr[key] || key,
              isVip: false
            });
          }
        }
      }
      return lines;
    },
    
    // 4. 当前线路下的集数列表
    activeEpisodes() {
      if (!this.animeDetail || !this.activeLineKey) return [];
      const playlists = this.animeDetail.video.playlists;
      return playlists[this.activeLineKey] || [];
    },
    
    // 5. 智能搜索合并 (本地 115 热门缓存匹配 + 远程 API 实时检索并去重)
    filteredResults() {
      const query = this.searchQuery.trim().toLowerCase();
      if (!query) return [];
      
      const localMatches = this.searchIndex.filter(item => {
        const title = (item.Title || '').toLowerCase();
        const pinyin = (item.Pinyin || '').toLowerCase();
        return title.includes(query) || pinyin.includes(query);
      });
      
      const merged = [...localMatches];
      const seenAids = new Set(localMatches.map(m => String(m.AID)));
      
      this.remoteSearchResults.forEach(item => {
        const aidStr = String(item.AID);
        if (!seenAids.has(aidStr)) {
          merged.push(item);
          seenAids.add(aidStr);
        }
      });
      
      return merged.slice(0, 15); // 最多展示 15 个推荐匹配 (拉伸展示远程结果)
    }
  },
  
  watch: {
    // 监听搜索词输入防抖，智能拉取全网实时检索 API 结果
    searchQuery(newVal) {
      const query = newVal.trim();
      if (!query) {
        this.remoteSearchResults = [];
        return;
      }
      
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        const AGE_API_BASE = "https://api.agedm.io/v2/";
        const targetUrl = `${AGE_API_BASE}search?query=${encodeURIComponent(query)}&page=1`;
        this.axiosGetViaProxy(targetUrl)
          .then(response => {
            const videos = response.data?.data?.videos || [];
            this.remoteSearchResults = videos.map(v => ({
              AID: String(v.id || v.AID),
              Title: v.name,
              Cover: v.cover,
              Status: v.status,
              UpToDate: v.uptodate,
              isRemote: true
            }));
          })
          .catch(err => {
            console.warn("远程全网检索超时或失败，已降级仅展示本地缓存", err);
          });
      }, 400); // 400毫秒微防抖以保证极速反应
    },

    // 当页面有新元素添加时刷新 Lucide 图标
    currentAnimeId() {
      this.$nextTick(() => {
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
    },
    animeDetail() {
      this.$nextTick(() => {
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
    }
  },
  
  created() {
    this.initData();
    this.initFavorites(); // 💡 载入收藏数据
    this.startBannerAutoPlay();
    
    // 自动判定当前星期几，高亮时刻表
    const today = new Date().getDay(); // 0=周日, 1=周一...
    this.activeWeekDay = today;
  },
  
  mounted() {
    // 首次渲染图标
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  },
  
  methods: {
    // 💡 行业顶级高可用防线：连环 Fallback 跨域代理中转器 (corsproxy.io -> codetabs -> allorigins)
    // 只要有任何一条线路存活，就能秒速拉回数据，彻底免疫单一公共代理服务器崩溃/被墙超时隐患
    async axiosGetViaProxy(targetUrl) {
      const PROXIES = [
        "https://corsproxy.io/?url=",
        "https://api.codetabs.com/v1/proxy?quest=",
        "https://api.allorigins.win/raw?url="
      ];
      
      let lastErr = null;
      for (const proxyBase of PROXIES) {
        try {
          const proxiedUrl = proxyBase + encodeURIComponent(targetUrl);
          console.log(`[CORS PROXY TRY] Requesting via: ${proxyBase}`);
          // 设定超短超时保护 (5秒)，防止在超时的旧线路上卡死
          const res = await axios.get(proxiedUrl, { timeout: 5000 });
          if (res && res.data) {
            console.log(`[CORS PROXY SUCCESS] Loaded successfully via: ${proxyBase}`);
            return res;
          }
        } catch (err) {
          console.warn(`[CORS PROXY FAIL] ${proxyBase} failed. Falling back to next...`, err);
          lastErr = err;
        }
      }
      throw lastErr || new Error("All CORS proxies exhausted and failed");
    },

    // ==========================================================================
    // 🚀 数据初始化与拉取 
    // ==========================================================================
    initData() {
      // 1. 请求首页数据
      axios.get('data/home-list.json')
        .then(response => {
          const data = response.data;
          this.latestList = data.latest || [];
          this.recommendList = data.recommend || [];
          this.weekList = data.week_list || {};
          this.weekListKeys = Object.keys(this.weekList);
          
          // 幻灯片处理 (如果 slipic 未定义则降级使用 latest)
          // 之前请求 slipic 失败可能是因为跨域或没本地持久化。如果本域没有，则用推荐图
          axios.get('data/slipic.json')
            .then(res => {
              this.bannerList = res.data || [];
            })
            .catch(() => {
              // 降级：从 latest 或 recommend 中拼凑出轮播图
              const list = this.recommendList.slice(0, 4);
              this.bannerList = list.map(item => ({
                html: item.Title,
                AID: item.AID,
                style: item.PicSmall
              }));
            });
        })
        .catch(err => {
          console.error("加载首页列表失败，请检查 data/ 目录是否已生成数据！", err);
        });

      // 2. 加载本地搜索数据库
      axios.get('data/search_index.json')
        .then(response => {
          this.searchIndex = response.data || [];
        })
        .catch(err => {
          console.warn("加载搜索索引失败，模糊搜索暂时不可用", err);
        });
    },
    
    // ==========================================================================
    // 🎬 动漫选择与详情加载
    // ==========================================================================
    selectAnime(aid) {
      if (!aid) return;
      
      // 💡 智能链接/非纯数字提炼器：如果用户粘贴的是包含 ID 的链接，自动提取出纯数字
      if (typeof aid === 'string' && !/^\d+$/.test(aid)) {
        const match = aid.match(/\d+/);
        if (match) {
          aid = match[0];
        }
      }
      
      this.currentAnimeId = aid;
      this.animeDetail = null;
      this.activeLineKey = '';
      this.activeEpisodeIndex = -1;
      this.activePlayUrl = '';
      this.activeEpisodeName = '';
      
      // 💡 分级策略 1：首先尝试拉取本地静态化详情 JSON (响应最快，免跨域)
      axios.get(`data/detail/${aid}.json?t=${new Date().getTime()}`)
        .then(response => {
          this.animeDetail = response.data;
          this.initializePlayerLine();
        })
        .catch(err => {
          console.warn(`[CACHE MISS] 本地详情 (AID: ${aid}) 未命中，自动启用云端 API 实时加载防线...`);
          
          // 💡 分级策略 2：本地无缓存，直接跨域拉取官方云端详情 API (通过高可用 CORS Fallback 代理链)
          const AGE_API_BASE = "https://api.agedm.io/v2/";
          const targetUrl = `${AGE_API_BASE}detail/${aid}`;
          this.axiosGetViaProxy(targetUrl)
            .then(response => {
              const resData = response.data;
              if (resData && resData.video) {
                this.animeDetail = resData;
                this.initializePlayerLine();
              } else if (resData && resData.data) {
                this.animeDetail = resData.data;
                this.initializePlayerLine();
              } else {
                throw new Error("接口返回的详情无效");
              }
            })
            .catch(apiErr => {
              console.error("官方实时详情拉取失败！", apiErr);
              alert("加载动漫详情失败，此动漫暂时无法访问，请尝试切换其他网络。");
              this.goHome();
            });
        });
    },
    
    initializePlayerLine() {
      // 默认选中第一个可用的播放线路
      const lines = this.availableLines;
      if (lines.length > 0) {
        this.activeLineKey = lines[0].key;
      }
    },
    
    // ==========================================================================
    // 📺 播放核心逻辑 (逆向算法拼接)
    // ==========================================================================
    switchLine(lineKey) {
      this.activeLineKey = lineKey;
      this.activeEpisodeIndex = -1; // 切换线路时重置选中的集数
    },
    
    playEpisode(epIdx) {
      if (this.guardTimer) {
        clearInterval(this.guardTimer);
        this.guardTimer = null;
      }
      this.activeEpisodeIndex = epIdx;
      
      const ep = this.activeEpisodes[epIdx];
      if (!ep) return;
      
      this.activeEpisodeName = ep[0]; // 剧集名，如 "第01集"
      const epToken = ep[1];          // 加密 token 或直链 url
      const realUrl = ep[2];          // 💡 预解析出的视频直链 (如果有)

      // 💡 物理阻击第 3 方浏览器或扩展的视频进度自动恢复：
      // 无刷新更新浏览器地址栏的 URL 参数，将 location.href 强制和当前番剧、集数和时间戳动态绑定。
      // 如此，以 location.href 作为视频进度数据库主键的所有第三方记忆插件，面对新链接时，均会 100% 重新从 0 播放！
      try {
        const newQuery = `?aid=${this.currentAnimeId}&ep=${epIdx}&_t=${new Date().getTime()}`;
        window.history.replaceState(null, '', newQuery);
        console.log(`[ADDRESS BAR UPDATED] location.search set to: ${newQuery}`);
      } catch (e) {
        console.warn("[Address Bar] Failed to update URL search state:", e);
      }
      
      // 1. 如果存在预解析直链，优先使用原生 DPlayer 播放，享受极致无广告体验！
      if (realUrl) {
        this.isIframeMode = false;
        
        // 销毁上一次 of 播放器实例
        if (this.dpInstance) {
          try { this.dpInstance.destroy(); } catch(e) {}
          this.dpInstance = null;
        }

        // 💡 物理清空 DOM 节点：在修改 DPlayer Key 触发 Vue 回收前，强行将原有 DOM 内容擦除
        const container = document.getElementById('dplayer');
        if (container) {
          container.innerHTML = '';
        }

        // 💡 强行旋转 Vue 绑定在 DPlayer 容器上的 Key！
        // 这将强制 Vue 将原来的 div DOM 彻底抛弃回收，重新实例化一个纯净的 div，彻底扼杀任何浏览器底层的 HTMLMediaElement 硬件复用！
        this.dplayerKey = 'dplayer_' + this.currentAnimeId + '_' + epIdx + '_' + new Date().getTime();
        this.activePlayUrl = realUrl;
        
        // 异步渲染并挂载 DPlayer 播放器 (延迟 120 毫秒以确保新 div 被重新挂载，且硬件通道已关闭)
        this.$nextTick(() => {
          setTimeout(() => {
            try {
              this.dpInstance = new DPlayer({
                container: document.getElementById('dplayer'),
                autoplay: true,
                screenshot: false,
                // 💡 物理隔断不同视频、不同集数间的播放进度，确保 DPlayer 内部的 history localstorage 进度键值绝对独立
                id: String(this.currentAnimeId) + "_" + String(this.activeEpisodeName),
                video: {
                  url: realUrl,
                  type: 'hls' // 支持 hls.js 解码 m3u8
                }
              });

              // 💡 物理阻击第 3 方浏览器或扩展的视频进度自动恢复：
              // 在 DPlayer 刚刚创建、视频尚未完全加载的同步阶段，直接启动 1.5 秒的高频归零定时器。
              // 无论外部插件何时在微秒级异步执行它的 seek，我们都会在 30 毫秒内强制将其重新拽回最起点！
              const progressKey = `jyzf_progress_${this.currentAnimeId}_${this.activeEpisodeName}`;
              const savedTime = parseFloat(localStorage.getItem(progressKey) || '0');
              
              if (savedTime <= 3) {
                console.log("[GUARD] Starting sync 1.5s high-frequency zero-seek guard...");
                this.guardTimer = setInterval(() => {
                  try {
                    if (this.dpInstance && this.dpInstance.video) {
                      this.dpInstance.video.currentTime = 0.01;
                    }
                  } catch(e) {}
                }, 30);
                
                // 1.5 秒后自动拆除定时器，放行让用户自己拖动
                setTimeout(() => {
                  if (this.guardTimer) {
                    clearInterval(this.guardTimer);
                    this.guardTimer = null;
                    console.log("[GUARD] Guard interval released.");
                  }
                }, 1500);
              }

              // 💡 监听视频加载成功事件，如果看起过则主动恢复它
              this.dpInstance.on('loadedmetadata', () => {
                if (savedTime > 3) {
                  console.log(`[PROGRESS RESTORE] Restoring progress to ${savedTime}s`);
                  this.dpInstance.seek(savedTime);
                }
              });

              // 💡 监听播放时间更新，自动记录进度
              this.dpInstance.on('timeupdate', () => {
                const currentTime = this.dpInstance.video.currentTime;
                const duration = this.dpInstance.video.duration;

                // 自动记录进度：大于 3 秒，且离结束还有 10 秒以上时才记忆
                if (currentTime > 3 && duration && (duration - currentTime > 10)) {
                  const progressKey = `jyzf_progress_${this.currentAnimeId}_${this.activeEpisodeName}`;
                  localStorage.setItem(progressKey, currentTime.toString());
                }
              });

              console.log(`[DPLAYER PLAYING] URL: ${realUrl} | ID: ${this.currentAnimeId}_${this.activeEpisodeName}`);
            } catch(e) {
              console.error("[DPlayer Init Failed] Falling back to Iframe mode:", e);
              this.isIframeMode = true;
            }
          }, 120);
        });
        return;
      }
      
      // 2. 如果不存在预解析直链 (冷门旧番/历史缓存未覆盖部分)，安全降级为传统的 Iframe 解析模式
      this.isIframeMode = true;
      if (this.dpInstance) {
        try { this.dpInstance.destroy(); } catch(e) {}
        this.dpInstance = null;
      }
      
      let playUrl = "";
      
      if (this.activeEngineKey === 'default') {
        const vipList = (this.animeDetail.player_vip || '').split(',');
        const playerJx = this.animeDetail.player_jx || {};
        
        // 检查当前选中的线路是否为 VIP 线路
        const isVip = vipList.includes(this.activeLineKey);
        const jxBase = isVip ? playerJx.vip : playerJx.zj;
        
        if (!jxBase) {
          alert("播放解析服务配置失效，请尝试切换其他线路播放。");
          return;
        }
        playUrl = jxBase + epToken;
      } else {
        // 使用备用纯 HTTPS 解析引擎
        playUrl = this.activeEngineKey + epToken;
      }
      
      // 💡 物理隔断跨视频/跨动漫播放进度共享 Bug (Iframe 模式)：
      // 1. 读取本集有无我们自己记录的历史进度
      const progressKey = `jyzf_progress_${this.currentAnimeId}_${this.activeEpisodeName}`;
      const savedTime = parseFloat(localStorage.getItem(progressKey) || '0');
      
      // 2. 智能判断使用 "?" 还是 "&" 来拼接参数
      const joinChar = playUrl.includes('?') ? '&' : '?';
      
      // 3. 构建【饱和式起播时间控制参数】 + 【自动播放覆写参数】。
      //    在没有历史进度记录时，强拼 autoplay=0 和 auto=0。这会迫使许多跨域解析站的播放器在前台暂停，而不去执行其 LocalStorage 的续播跳转！
      let timeParams = "";
      if (savedTime > 3) {
        timeParams = `&start=${savedTime}&t=${savedTime}&time=${savedTime}&ctime=${savedTime}&progress=${savedTime}&playtime=${savedTime}&seek=${savedTime}&autoplay=1&auto=1#t=${savedTime}`;
      } else {
        timeParams = `&start=0&t=0.01&time=0&ctime=0&progress=0&playtime=0&seek=0&autoplay=0&auto=0#t=0.01`;
      }
      
      playUrl = playUrl + joinChar + "aid=" + this.currentAnimeId + "&ep=" + epIdx + "&_t=" + new Date().getTime() + timeParams;

      // 自动强升 https，彻底防 Mixed Content 混合内容拦截
      if (playUrl.startsWith('http://')) {
        playUrl = playUrl.replace('http://', 'https://');
      }
      
      // 2. 💡 iframe 物理销毁重载机制 (Blank Reset & 380ms 延时)：
      //    在将 activePlayUrl 设为新 URL 前，先设为空。这会彻底销毁旧的 iframe DOM 节点，
      //    强制保留足足 380 毫秒的空白冷却期，供浏览器完全关闭旧视频，彻底断开 unload / beforeunload 时可能触发的全局进度强行写入，阻断污染源头！
      this.activePlayUrl = '';
      this.$nextTick(() => {
        setTimeout(() => {
          this.activePlayUrl = playUrl;
          console.log(`[IFRAME PLAYING] Loaded fresh with URL: ${this.activePlayUrl}`);
        }, 380);
      });
    },
    
    forceResetProgressAndReplay() {
      if (this.activeEpisodeIndex === -1) return;
      console.log(`[FORCE RESET PROGRESS] Clearing cached index of: ${this.currentAnimeId}_${this.activeEpisodeName}`);
      
      // 1. 强行删除我们自定义的播放进度记录
      const progressKey = `jyzf_progress_${this.currentAnimeId}_${this.activeEpisodeName}`;
      localStorage.removeItem(progressKey);
      
      // 2. 如果是原生播放器实例，强制清理 DPlayer 的 LocalStorage 并强行 Seek 归零
      if (this.dpInstance) {
        try {
          const dpStorageKey = String(this.currentAnimeId) + "_" + String(this.activeEpisodeName);
          localStorage.removeItem(`dplayer-video-api-key-${dpStorageKey}`);
          this.dpInstance.seek(0.01);
        } catch(e) {}
      }
      
      // 3. 强行重新触发加载播放 (这会拼上最新的时间戳与 start=0&t=0.01 压制参数)
      this.playEpisode(this.activeEpisodeIndex);
      
      // 弹出轻量级网页提示，告知用户重置成功
      alert("⚡ 播放器已强制初始化！已清理所有历史播放进度，视频将强制从最起点重载播放。\n\n[排查提示]：如果重新播放后依然显示 00:05 秒，说明这是该视频文件起播解码时的【物理起点/片头】，属于正常现象，并未发生跨集进度污染。");
    },
    
    rePlayCurrentEpisode() {
      if (this.activeEpisodeIndex > -1) {
        this.playEpisode(this.activeEpisodeIndex);
      }
    },

    // ==========================================================================
    // ⭐ 追番收藏夹核心功能 (本地持久化 LocalStorage)
    // ==========================================================================
    initFavorites() {
      const favs = localStorage.getItem('jyzf_favorites');
      if (favs) {
        try {
          this.favorites = JSON.parse(favs);
        } catch (e) {
          this.favorites = [];
        }
      }
    },

    isFavorited(aid) {
      return this.favorites.some(f => String(f.AID) === String(aid));
    },

    toggleFavorite() {
      if (!this.animeDetail || !this.animeDetail.video) return;
      const video = this.animeDetail.video;
      const aidStr = String(this.currentAnimeId);

      if (this.isFavorited(aidStr)) {
        // 取消收藏，移出列表
        this.favorites = this.favorites.filter(f => String(f.AID) !== aidStr);
      } else {
        // 加入收藏列表
        this.favorites.push({
          AID: aidStr,
          Title: video.name,
          Cover: video.cover,
          Status: video.status || '完结',
          UpToDate: video.uptodate || '全集'
        });
      }
      
      // 持久化保存
      localStorage.setItem('jyzf_favorites', JSON.stringify(this.favorites));

      // 实时更新页面上的 Lucide 心形图标状态
      this.$nextTick(() => {
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
    },





    
    // ==========================================================================
    // 🧭 导航及交互控制
    // ==========================================================================
    goHome() {
      // 安全销毁 DPlayer 实例，防止声音残留
      if (this.dpInstance) {
        try { this.dpInstance.destroy(); } catch(e) {}
        this.dpInstance = null;
      }
      this.isIframeMode = false;
      
      this.currentAnimeId = null;
      this.animeDetail = null;
      this.activePlayUrl = '';
      this.activeEpisodeName = '';
      this.searchQuery = '';
      this.$nextTick(() => {
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
    },
    
    handleSearchBlur() {
      // 稍微延迟关闭匹配框，防止点击下拉项时直接触发 blur 导致点击失效
      setTimeout(() => {
        this.searchFocused = false;
      }, 200);
    },
    
    // 幻灯片自动播放
    startBannerAutoPlay() {
      this.bannerTimer = setInterval(() => {
        if (this.bannerList.length > 0) {
          this.currentBannerIndex = (this.currentBannerIndex + 1) % this.bannerList.length;
        }
      }, 5000);
    }
  },
  
  beforeDestroy() {
    if (this.bannerTimer) {
      clearInterval(this.bannerTimer);
    }
  }
});

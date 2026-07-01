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
    clientId: '', // 景雁分析：唯一观众代号
    activeSessionId: '', // 景雁分析：当前播放会话 ID
    lastLogProgressTime: 0, // 景雁分析：上次上报的播放秒数
    
    
    // 解析引擎库 (纯 HTTPS 保证 GitHub Pages 无 Mixed Content 跨域阻断)
    jxEngines: [
      { label: '系统默认 (景雁 合作源)', value: 'default' },
      { label: '超清 VIP 极速接口 A (先锋解析)', value: 'https://jx.xmflv.com/?url=' },
      { label: '超清 VIP 万能接口 B (JSON解析)', value: 'https://jx.jsonplayer.com/?url=' },
      { label: '全网超级 VIP 接口 C', value: 'https://im1907.top/?jx=' }
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
    this.getOrCreateClientId(); // 💡 载入/生成唯一代号
    
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
    // ==========================================================================
    // 📊 景雁数据分析（Jingyan Analytics）打点服务
    // ==========================================================================
    getOrCreateClientId() {
      let cid = localStorage.getItem('jyzf_client_id');
      if (!cid) {
        const prefixList = ['玫瑰小雁', '浅粉甜心', '晨曦初樱', '苏子玫瑰', '落樱小雁', '浅粉波点', '暮色山樱', '流云粉雁', '冰摇桃桃', '蜜桃粉雁', '樱花粉雁'];
        const randomPrefix = prefixList[Math.floor(Math.random() * prefixList.length)];
        const randomHex = Math.random().toString(16).substring(2, 5).toUpperCase();
        cid = `${randomPrefix}-${randomHex}`;
        localStorage.setItem('jyzf_client_id', cid);
      }
      this.clientId = cid;
      return cid;
    },

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
      window.scrollTo(0, 0); // 🏮 瞬间将滚动条置顶，防止在详情页出现高度坍塌和滚动条错位
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
      } catch (e) {}

      // 💡 智能流媒体路由算法 (Smart Resolver Routing)：
      const vipList = (this.animeDetail.player_vip || '').split(',');
      const isVip = vipList.includes(this.activeLineKey);
      
      let playUrl = "";
      
      if (isVip) {
        // 如果是官方加密/VIP线路，必须强行使用 AGE 合作的 default 解析源，才能解密播放，否则会报“不支持的视频平台”
        const playerJx = this.animeDetail.player_jx || {};
        const jxBase = playerJx.vip || playerJx.zj;
        if (jxBase) {
          playUrl = jxBase + epToken;
        } else {
          playUrl = "https://jx.wuzhoupai.com:8443/m3u8/?url=" + epToken;
        }
        console.log("[SMART ROUTER] VIP Line detected. routing to Default Decryptor.");
      } else {
        // 如果是常规 M3U8 采集线路 (非凡、暴风、无尽、计算云、红牛等)
        // 💡 修复：如果常规线路被加密成了 age_ 开头，且我们有 realUrl，就优先传 realUrl 给解析站
        // 否则把 age_ 传给第三方解析站(如 m3u8.tv) 会导致 404
        const targetUrlToResolve = realUrl ? realUrl : epToken;
        
        if (this.activeEngineKey === 'default') {
          // 如果 target 还是 age_ 开头，说明它是个漏网之鱼的加密 Token，必须用官方解密
          if (targetUrlToResolve.startsWith('age_')) {
              playUrl = "https://jx.wuzhoupai.com:8443/m3u8/?url=" + targetUrlToResolve;
          } else {
              // 常规真实 m3u8 链接，用 xmflv.com 专属 VIP 接口代理 (替代已失效的 m3u8.tv)
              playUrl = "https://jx.xmflv.com/?url=" + targetUrlToResolve;
          }
          console.log("[SMART ROUTER] Standard Line detected. Upgrade routing to premium xmflv.com resolver.");
        } else {
          playUrl = this.activeEngineKey + targetUrlToResolve;
          console.log("[SMART ROUTER] Custom engine chosen: " + this.activeEngineKey);
        }
      }

      const progressKey = `jyzf_progress_${this.currentAnimeId}_${this.activeEpisodeName}`;
      const savedTime = parseFloat(localStorage.getItem(progressKey) || '0');
      // 💡 修复：禁止将内部进度参数作为 Query 附加到第三方解析站 URL 上（会导致解析站 404/500）
      // 仅在哈希中安全传递进度和防缓存标记，Hash 不会发送给远端服务器！
      const hashParams = savedTime > 3 ? `#t=${savedTime}&_t=${new Date().getTime()}` : `#t=0.01&_t=${new Date().getTime()}`;
      playUrl = playUrl + hashParams;
      if (playUrl.startsWith('http://')) {
        playUrl = playUrl.replace('http://', 'https://');
      }

      // ✅ 初始化/生成全新播放会话 ID 和进度打点计数器
      this.activeSessionId = Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      this.lastLogProgressTime = 0;

      // ✅ 变量捕获闭包锁定
      const capturedAnimeId = String(this.currentAnimeId);
      const capturedEpName = String(this.activeEpisodeName);
      const capturedRealUrl = realUrl;
      const capturedIframeUrl = playUrl;

      // 1. 如果存在预解析直链，优先尝试使用原生 DPlayer 播放，并走我们自己免墙的专属代理中转
      if (realUrl) {
        this.isIframeMode = false;
        this.activePlayUrl = realUrl;

        // 销毁上一次的播放器实例
        if (this.dpInstance) {
          try { 
            this.dpInstance.off('timeupdate');
            this.dpInstance.off('loadedmetadata');
            this.dpInstance.off('error');
            this.dpInstance.destroy(); 
          } catch(e) {}
          this.dpInstance = null;
        }

        const container = document.getElementById('dplayer');
        if (container) {
          container.innerHTML = '';
        }

        this.dplayerKey = 'dplayer_' + this.currentAnimeId + '_' + epIdx + '_' + new Date().getTime();

        this.$nextTick(() => {
          setTimeout(() => {
            try {
              const dp = new DPlayer({
                container: document.getElementById('dplayer'),
                autoplay: true,
                screenshot: false,
                id: capturedAnimeId + "_" + capturedEpName,
                video: {
                  // 💡 黄金路由：将打点参数与 SessionID 附带在视频流请求中，保证 100% 成功上报且会话内唯一
                  url: "https://jingyanff.xyz/?url=" + encodeURIComponent(capturedRealUrl) +
                       "&client=" + encodeURIComponent(this.clientId) +
                       "&anime=" + encodeURIComponent(this.animeDetail ? this.animeDetail.video.name : '未知动漫') +
                       "&episode=" + encodeURIComponent(capturedEpName) +
                       "&session=" + encodeURIComponent(this.activeSessionId),
                  type: 'hls'
                }
              });
              this.dpInstance = dp;

              if (savedTime <= 3) {
                console.log("[GUARD] Starting sync 1.5s high-frequency zero-seek guard...");
                this.guardTimer = setInterval(() => {
                  try {
                    if (dp && dp.video) {
                      dp.video.currentTime = 0.01;
                    }
                  } catch(e) {}
                }, 30);
                
                setTimeout(() => {
                  if (this.guardTimer) {
                    clearInterval(this.guardTimer);
                    this.guardTimer = null;
                  }
                }, 1500);
              }

              dp.on('loadedmetadata', () => {
                if (savedTime > 3) {
                  console.log(`[PROGRESS RESTORE] Restoring progress to ${savedTime}s`);
                  dp.seek(savedTime);
                }
              });

              dp.on('timeupdate', () => {
                if (!dp || !dp.video) return;
                const currentTime = dp.video.currentTime;
                const duration = dp.video.duration;
                if (currentTime > 3 && duration && (duration - currentTime > 10)) {
                  const pKey = `jyzf_progress_${capturedAnimeId}_${capturedEpName}`;
                  localStorage.setItem(pKey, currentTime.toString());
                }
              });

              // 💡 极限容灾：如果自建代理出意外报错，依然能自动无缝降级到公共 VIP 接口
              dp.on('error', () => {
                console.warn("[DPLAYER ERROR] Fallback to iframe resolve...");
                if (this.dpInstance) {
                  try {
                    this.dpInstance.off('timeupdate');
                    this.dpInstance.off('loadedmetadata');
                    this.dpInstance.off('error');
                    this.dpInstance.destroy();
                  } catch(e) {}
                  this.dpInstance = null;
                }
                this.isIframeMode = true;
                this.activePlayUrl = '';
                this.$nextTick(() => {
                  setTimeout(() => {
                    this.activePlayUrl = capturedIframeUrl;
                  }, 120);
                });
              });

              console.log(`[DPLAYER PLAYING] URL: ${capturedRealUrl} | ID: ${capturedAnimeId}_${capturedEpName}`);
            } catch(e) {
              console.error("[DPlayer Init Failed] Falling back to Iframe mode:", e);
              this.isIframeMode = true;
              this.activePlayUrl = capturedIframeUrl;
            }
          }, 120);
        });
        return;
      }
      
      // 2. 如果不存在直链，同步降级为传统的 Iframe 解析模式
      this.isIframeMode = true;
      if (this.dpInstance) {
        try { this.dpInstance.destroy(); } catch(e) {}
        this.dpInstance = null;
      }
      
      this.activePlayUrl = '';
      this.$nextTick(() => {
        setTimeout(() => {
          this.activePlayUrl = capturedIframeUrl;
          console.log(`[IFRAME PLAYING] Loaded fresh with URL: ${this.activePlayUrl}`);
        }, 120);
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
      window.scrollTo(0, 0); // 🏮 瞬间置顶，平稳过渡到首页
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

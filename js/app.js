new Vue({
  el: '#app',
  data: {
    // 页面模式控制
    currentAnimeId: null,
    currentPage: 'home',   // 'home' | 'catalog'
    zhujianAnimated: false, // 🎋 竹简滚动展开动效是否已展示过一次

    // 📚 番剧库（全部番剧浏览页）状态
    catalogFilter: '全部',  // '全部' | '连载中' | '完结'
    catalogSort: 'default', // 'default' | 'title'
    catalogPageNum: 1,      // 当前分页（每页 48 部）
    
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
    detailError: false, // 💡 新增：详情加载错误状态标记
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
    // 窗口尺寸状态（反应式支持）
    screenWidth: window.innerWidth,
    detailTab: 'episodes', // 手机端详情页 Tab 控制: 'episodes' (选集) 或 'info' (简介)
    videoFitMode: 'contain', // 视频铺满模式: 'contain' (等比), 'cover' (裁剪), 'fill' (拉伸)
    // 📺 观看历史 (最多保留 30 条，LocalStorage 持久化)
    watchHistory: [],
    _historyThrottleTimer: null, // 历史写入节流计时器
    // 🖋 景雁诗 · 古风诗词（数组顺序 = 视觉从左到右，即末句→首句，展示时从右往左读）
    poemLines: ['化作春风伴远山。', '木棉红透珠江水，', '万里南飞一客雁。', '辞霜踏雪向景明，'],
    poemAnimKey: 0, // 每次重新触发动画时自增
  },
  
  computed: {
    // 💡 动态判断是否为手机移动端 (屏幕宽度 <= 768px)
    isMobile() {
      return this.screenWidth <= 768;
    },

    // 📚 番剧库：过滤 + 排序后的完整列表
    catalogAnimes() {
      let list = this.searchIndex || [];
      // 按状态筛选
      if (this.catalogFilter !== '全部') {
        list = list.filter(a => a.Status === this.catalogFilter);
      }
      // 排序
      if (this.catalogSort === 'title') {
        list = [...list].sort((a, b) => a.Title.localeCompare(b.Title, 'zh'));
      } else {
        // 默认排序：最近更新的动漫（存在于首页 latestList 中）自动加权置顶排在最前！
        const latestAids = {};
        if (this.latestList && this.latestList.length > 0) {
          this.latestList.forEach((item, index) => {
            const aid = String(item.AID);
            if (!(aid in latestAids)) {
              latestAids[aid] = index; // 记录在 latest 中的位置，0 最新，越大越老
            }
          });
        }
        
        list = [...list].sort((a, b) => {
          const aidA = String(a.AID);
          const aidB = String(b.AID);
          
          const inLatestA = aidA in latestAids;
          const inLatestB = aidB in latestAids;
          
          if (inLatestA && inLatestB) {
            return latestAids[aidA] - latestAids[aidB]; // 都在 latest 中，按更新时效正序（最新的排最前）
          }
          if (inLatestA) return -1;
          if (inLatestB) return 1;
          
          // 否则，按常规 AID 倒序
          const isNumA = /^\d+$/.test(aidA);
          const isNumB = /^\d+$/.test(aidB);
          if (isNumA && isNumB) {
            return Number(aidB) - Number(aidA);
          }
          return aidB.localeCompare(aidA);
        });
      }
      return list;
    },

    // 📚 番剧库：当前分页数据
    catalogPagedAnimes() {
      const pageSize = 48;
      const start = (this.catalogPageNum - 1) * pageSize;
      return this.catalogAnimes.slice(start, start + pageSize);
    },

    // 📚 番剧库：总页数
    catalogTotalPages() {
      return Math.ceil(this.catalogAnimes.length / 48);
    },

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
    // 是否存在下一集（当前不是最后一集）
    hasNextEpisode() {
      return this.activeEpisodeIndex > -1 &&
             this.activeEpisodeIndex < this.activeEpisodes.length - 1;
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
    // ⚡ 防止"Flash of Homepage"：在任何渲染前提前读取 hash，
    // 如果目标是详情页，立即设置 currentAnimeId，
    // Vue 初始渲染就直接走详情页骨架，跳过首页 → 不再出现"刷新闪首页"
    try {
      let hash = decodeURIComponent(window.location.hash);
      console.log('[DEBUG ROUTER] created() hook start. URL hash:', hash);
      
      // 💾 刷新页面保护：如果 URL 中无哈希，尝试从 LocalStorage 中读取并还原上一次所在的页面状态
      if (!hash || hash === '#/' || hash === '#') {
        const lastPage = localStorage.getItem('jyzf_last_page');
        console.log('[DEBUG ROUTER] empty hash detected, fetched lastPage cache:', lastPage);
        if (lastPage && lastPage !== 'home') {
          hash = '#/' + lastPage;
          window.location.hash = hash;
          console.log('[DEBUG ROUTER] window.location.hash updated to:', hash);
        }
      }
      
      const match = hash.match(/detail\/([0-9]+)/);
      if (match && match[1]) {
        this.currentAnimeId = match[1];
        console.log('[DEBUG ROUTER] currentAnimeId set to:', this.currentAnimeId);
      }
    } catch(e) {
      console.error('[DEBUG ROUTER] created() exception:', e);
    }

    this.initData();
    this.initFavorites();     // 💡 载入收藏数据
    this.initWatchHistory();  // 💡 载入观看历史
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
    window.addEventListener('resize', this.handleResize);
    
    // 🏮 绑定 Hash 路由监听，防 GC 泄露与 context 逃逸
    this.hashRouteHandler = () => this.handleHashRoute();
    window.addEventListener('hashchange', this.hashRouteHandler);
    this.handleHashRoute();
    
    // 🎋 首次进入页面如果是首页，启动竹简展开动画锁定计时器
    if (this.currentPage === 'home' && !this.currentAnimeId) {
      setTimeout(() => {
        this.zhujianAnimated = true;
      }, 2600);
    }
    
    // 初始化视频铺满模式的 body class 绑定，消除全屏状态下视频留黑
    document.body.classList.add('fit-' + this.videoFitMode);
  },
  
  beforeDestroy() {
    window.removeEventListener('resize', this.handleResize);
    if (this.hashRouteHandler) {
      window.removeEventListener('hashchange', this.hashRouteHandler);
    }
  },
  
  methods: {
    async resolveAnichUrl(anichId, epNum) {
      console.log(`[AniCh Resolver] Resolving real stream URL for ID=${anichId}, Ep=${epNum}...`);
      const domains = [
        "https://ani.emmmm.eu.org",
        "https://api.emmmm.eu.org",
        "https://jingyanff.xyz/anich-proxy"
      ];
      
      let response = null;
      let lastError = null;
      
      for (const domain of domains) {
        try {
          const targetUrl = `${domain}/vod/${anichId}/${epNum}`;
          const res = await fetch(targetUrl);
          if (res.ok) {
            response = res;
            console.log(`[AniCh Resolver] Fetched successfully from: ${domain}`);
            break;
          } else {
            console.warn(`[AniCh Resolver] Domain ${domain} returned status: ${res.status}`);
          }
        } catch (err) {
          lastError = err;
          console.warn(`[AniCh Resolver] Failed to fetch from ${domain}, trying next...`);
        }
      }
      
      if (!response) {
        console.error("[AniCh Resolver] All backup domains failed to resolve. last error:", lastError);
        return null;
      }
      
      try {
        const data = await response.json();
        if (!Array.isArray(data)) {
          throw new Error("Invalid vod response format");
        }
        
        const protoBytes = new Uint8Array(data);
        const urls = [];
        let current = [];
        
        for (let i = 0; i < protoBytes.length; i++) {
          const b = protoBytes[i];
          if (b >= 32 && b <= 126) {
            current.push(String.fromCharCode(b));
          } else {
            if (current.length >= 15) {
              const s = current.join("");
              if (s.includes("aHR0") || s.includes("aHR")) {
                let idx = s.indexOf("aHR0");
                if (idx < 0) idx = s.indexOf("aHR");
                let b64Raw = s.substring(idx);
                b64Raw = b64Raw.replace(/aHR[A-Z]0/g, "aHR0");
                const b64Clean = b64Raw.replace(/[^A-Za-z0-9+/=]/g, "");
                try {
                  const decoded = atob(b64Clean);
                  if (decoded.startsWith("http")) {
                    urls.push(decoded);
                  }
                } catch (e) {}
              }
            }
            current = [];
          }
        }
        
        const URL_PRIORITY = [
          "xgct-video.vzcdn.net",
          "app.emmmm.eu.org.cdn.cloudflare.net",
          "giri.girigirilove.top",
          "yhdmm3u8.top",
          "92cj.com",
          ".m3u8",
          ".mp4"
        ];
        
        let finalUrl = null;
        for (const pattern of URL_PRIORITY) {
          for (const url of urls) {
            if (url.toLowerCase().includes(pattern)) {
              finalUrl = url;
              break;
            }
          }
          if (finalUrl) break;
        }
        if (!finalUrl && urls.length > 0) {
          finalUrl = urls[0];
        }
        
        if (finalUrl) {
          console.log("[AniCh Resolver] Resolved successfully:", finalUrl.substring(0, 60));
          return finalUrl;
        }
        throw new Error("No video URL found in stream");
      } catch (err) {
        console.error("[AniCh Resolver] Failed to resolve:", err);
        return null;
      }
    },

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
          const res = await axios.get(proxiedUrl, { timeout: 5000 });
          if (res && res.data) {
            return res;
          }
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("All CORS proxies exhausted and failed");
    },
    preloadImage(url) {
      if (!url) return;
      const img = new Image();
      img.src = url;
    },

    getDetailFromCache(aid) {
      try {
        const cachedStr = localStorage.getItem(`jyzf_detail_cache_${aid}`);
        if (cachedStr) {
          const cached = JSON.parse(cachedStr);
          return cached.data || null;
        }
      } catch (e) {
        console.warn(`[CACHE] 读取详情缓存失败 (AID: ${aid}):`, e);
      }
      return null;
    },

    saveDetailToCache(aid, detailData) {
      if (!aid || !detailData) return;
      try {
        // 维持缓存上限，防止 LocalStorage 溢出 (限制在 100 条以内)
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('jyzf_detail_cache_')) {
            keys.push(key);
          }
        }
        if (keys.length >= 100) {
          // 清除前 15 条旧缓存
          keys.slice(0, 15).forEach(k => localStorage.removeItem(k));
        }

        const cacheObj = {
          time: Date.now(),
          data: detailData
        };
        localStorage.setItem(`jyzf_detail_cache_${aid}`, JSON.stringify(cacheObj));
        // 💾 同步预加载/缓存封面图
        const cover = detailData.video && (detailData.video.cover || detailData.video.pic);
        if (cover) {
          this.preloadImage(cover);
        }
      } catch (e) {
        console.warn(`[CACHE] 写入详情缓存失败 (AID: ${aid}):`, e);
      }
    },

    hasDetailChanged(cached, fetched) {
      if (!cached || !fetched) return true;
      const cVideo = cached.video || {};
      const fVideo = fetched.video || {};
      
      // 1. 比较封面
      if (cVideo.cover !== fVideo.cover) return true;
      
      // 2. 比较播放线路
      const cPlaylists = cVideo.playlists || {};
      const fPlaylists = fVideo.playlists || {};
      const cKeys = Object.keys(cPlaylists);
      const fKeys = Object.keys(fPlaylists);
      if (cKeys.length !== fKeys.length) return true;
      
      // 3. 比较集数及播放 URL 地址 (token/直链)
      for (const key of fKeys) {
        const cList = cPlaylists[key] || [];
        const fList = fPlaylists[key] || [];
        if (cList.length !== fList.length) return true;
        
        for (let i = 0; i < fList.length; i++) {
          const cEp = cList[i] || [];
          const fEp = fList[i] || [];
          if (cEp[0] !== fEp[0] || cEp[1] !== fEp[1] || cEp[2] !== fEp[2]) {
            return true;
          }
        }
      }
      return false;
    },

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
      // 💾 A. 尝试从缓存中秒速恢复首页数据和搜索数据库
      try {
        const cachedHome = localStorage.getItem('jyzf_home_list_cache');
        if (cachedHome) {
          const data = JSON.parse(cachedHome);
          this.latestList = data.latest || [];
          this.recommendList = data.recommend || [];
          this.weekList = data.week_list || {};
          this.weekListKeys = Object.keys(this.weekList);
        }
        
        const cachedIndex = localStorage.getItem('jyzf_search_index_cache');
        if (cachedIndex) {
          this.searchIndex = JSON.parse(cachedIndex);
        }

        const cachedBanners = localStorage.getItem('jyzf_banner_list_cache');
        if (cachedBanners) {
          this.bannerList = JSON.parse(cachedBanners);
        }
      } catch (e) {
        console.warn("[CACHE] 恢复首页或搜索库缓存失败:", e);
      }

      // 1. 在后台拉取最新首页数据
      axios.get('data/home-list.json')
        .then(response => {
          const data = response.data || {};
          
          // 💡 无论缓存是否相同，都必须进行常规赋值以确保 Vue 的反应式状态正常，防止首屏因为缓存逻辑变为空白
          this.latestList = data.latest || [];
          this.recommendList = data.recommend || [];
          this.weekList = data.week_list || {};
          this.weekListKeys = Object.keys(this.weekList);
          
          const cachedStr = localStorage.getItem('jyzf_home_list_cache');
          const newStr = JSON.stringify(data);
          
          if (newStr !== cachedStr) {
            console.log("[CACHE UPDATE] 首页数据有更新，写入缓存并预加载新图片...");
            localStorage.setItem('jyzf_home_list_cache', newStr);
            // 💾 异步预加载新动漫封面
            this.latestList.slice(0, 12).forEach(item => {
              this.preloadImage(item.PicSmall || item.Cover);
            });
          }
          
          // 获取轮播图
          axios.get('data/slipic.json')
            .then(res => {
              const banners = res.data || [];
              this.bannerList = banners; // 💡 始终赋值
              
              const cachedBStr = localStorage.getItem('jyzf_banner_list_cache');
              const newBStr = JSON.stringify(banners);
              if (newBStr !== cachedBStr) {
                localStorage.setItem('jyzf_banner_list_cache', newBStr);
                // 预加载轮播大图
                banners.forEach(b => this.preloadImage(b.style));
              }
            })
            .catch(() => {
              // 降级：从 latest 或 recommend 中拼凑出轮播图
              const list = this.recommendList.slice(0, 4);
              const fallbackBanners = list.map(item => ({
                html: item.Title,
                AID: item.AID,
                style: item.PicSmall
              }));
              
              this.bannerList = fallbackBanners; // 💡 始终赋值
              
              const fallbackBStr = JSON.stringify(fallbackBanners);
              if (fallbackBStr !== localStorage.getItem('jyzf_banner_list_cache')) {
                localStorage.setItem('jyzf_banner_list_cache', fallbackBStr);
              }
            });
        })
        .catch(err => {
          console.error("后台同步首页列表失败，若无缓存页面可能为空:", err);
        });

      // 2. 在后台拉取最新搜索与分类索引数据库
      axios.get('data/search_index.json')
        .then(response => {
          const newData = response.data || [];
          this.searchIndex = newData; // 💡 始终赋值
          
          const cachedIndexStr = localStorage.getItem('jyzf_search_index_cache');
          const newIndexStr = JSON.stringify(newData);
          
          if (newIndexStr !== cachedIndexStr) {
            console.log("[CACHE UPDATE] 全局搜索及分类索引有更新，写入缓存并预载图片...");
            localStorage.setItem('jyzf_search_index_cache', newIndexStr);
            // 💾 异步预加载最新的前 24 个封面图以优化番剧库首屏体验
            newData.slice(0, 24).forEach(item => {
              this.preloadImage(item.Cover || item.PicSmall);
            });
          }
        })
        .catch(err => {
          console.warn("加载搜索索引失败，使用本地缓存或模糊搜索暂时不可用", err);
        });
    },
    
    // ==========================================================================
    // 🎬 动漫选择与详情加载
    // ==========================================================================
    selectAnime(aid, skipHashUpdate = false) {
      if (!aid) return;
      
      // 💡 智能链接/非纯数字提炼器：如果用户粘贴的是包含 ID 的链接，自动提取出纯数字 (排除 anich_ 开头的独有 ID)
      if (typeof aid === 'string' && !/^\d+$/.test(aid) && !aid.startsWith('anich_')) {
        const match = aid.match(/\d+/);
        if (match) {
          aid = match[0];
        }
      }
      
      console.log('[DEBUG ROUTER] selectAnime() called. aid:', aid, 'skipHashUpdate:', skipHashUpdate);
      this.currentAnimeId = aid;
      this.detailError = false; // 💡 重置错误状态
      
      try {
        localStorage.setItem('jyzf_last_page', 'detail/' + aid); // 💾 同步更新本地路由缓存
      } catch (e) {
        console.warn('[ROUTER] localStorage.setItem failed in selectAnime:', e);
      }
      
      if (skipHashUpdate !== true) {
        window.location.hash = '#/detail/' + aid;
        console.log('[DEBUG ROUTER] selectAnime() set window.location.hash to #/detail/' + aid);
      }
      window.scrollTo(0, 0); // 瞬间置顶
      this.detailTab = 'episodes'; // 默认选择选集 Tab
      
      // 💾 1. 首先尝试从 LocalStorage 中读取详情缓存 (实现零延迟秒开)
      const cached = this.getDetailFromCache(aid);
      if (cached) {
        console.log(`[CACHE HIT] 瞬间从缓存渲染动漫 (AID: ${aid})`);
        this.animeDetail = cached;
        this.initializePlayerLine();
      } else {
        // 无缓存时初始化状态
        this.animeDetail = null;
        this.activeLineKey = '';
        this.activeEpisodeIndex = -1;
        this.activePlayUrl = '';
        this.activeEpisodeName = '';
      }

      // 💾 定义后台请求数据的比对和状态刷新处理器
      const handleFetchedDetail = (fetchedData) => {
        if (!fetchedData) return;
        const changed = this.hasDetailChanged(this.animeDetail, fetchedData);
        
        if (changed || !this.animeDetail) {
          console.log(`[CACHE UPDATE] 动漫数据 (AID: ${aid}) 存在新变动（封面或 m3u8 地址已更新），自动刷新并存盘...`);
          
          const prevEpIdx = this.activeEpisodeIndex;
          this.animeDetail = fetchedData;
          this.saveDetailToCache(aid, fetchedData);
          
          // 如果用户还没有点播具体集数，则重新初始化线路
          if (prevEpIdx === -1) {
            this.initializePlayerLine();
          } else {
            // 如果已在播放，保持当前线路选择，除非该线路被删掉了
            const lines = this.availableLines;
            if (this.activeLineKey && !lines.some(l => l.key === this.activeLineKey) && lines.length > 0) {
              this.activeLineKey = lines[0].key;
            }
          }
        } else {
          console.log(`[CACHE VALID] 动漫数据 (AID: ${aid}) 未发生改变，本地缓存有效`);
        }
      };

      // 💾 2. 后台获取最新数据以进行验证及热更新
      axios.get(`data/detail/${aid}.json`)
        .then(response => {
          handleFetchedDetail(response.data);
        })
        .catch(err => {
          console.warn(`[CACHE MISS] 本地详情 (AID: ${aid}) 获取失败，转入云端 API 后台拉取...`);
          
          const AGE_API_BASE = "https://api.agedm.io/v2/";
          const targetUrl = `${AGE_API_BASE}detail/${aid}`;
          this.axiosGetViaProxy(targetUrl)
            .then(response => {
              const resData = response.data;
              let fetchedData = null;
              if (resData && resData.video) {
                fetchedData = resData;
              } else if (resData && resData.data) {
                fetchedData = resData.data;
              }
              
              if (fetchedData) {
                handleFetchedDetail(fetchedData);
              } else {
                throw new Error("云端详情接口返回的格式无效");
              }
            })
            .catch(apiErr => {
              console.error("云端详情拉取失败！", apiErr);
              // 如果既无缓存又同步失败，则显示本页错误提示卡片而不回退首页
              if (!this.animeDetail) {
                this.detailError = true;
                this.$nextTick(() => {
                  if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                  }
                });
              }
            });
        });
    },
    
    initializePlayerLine() {
      // 💡 历史恢复优先：如有指定线路则用之，否则默认第一条
      const lines = this.availableLines;
      if (this._restoreLineKey && lines.some(l => l.key === this._restoreLineKey)) {
        this.activeLineKey = this._restoreLineKey;
      } else if (lines.length > 0) {
        this.activeLineKey = lines[0].key;
      }
      this._restoreLineKey = null; // 消费后清零

      // 💡 历史/URL 恢复：如有指定集数则自动播放并 seek
      if (this._restoreEpIndex !== null && this._restoreEpIndex !== undefined) {
        const epIdx = this._restoreEpIndex;
        const seekTo = this._restoreTime || null;
        this._restoreEpIndex = null;
        this._restoreTime   = null;
        this.$nextTick(() => {
          // 注意：playEpisode 会从 localStorage 读取进度，如果 seekTo 有值则在加载后覆盖
          if (seekTo !== null && seekTo > 3) {
            // 临时覆写 localStorage 进度，确保 playEpisode 内部读到正确秒数
            const ep = this.activeEpisodes[epIdx];
            if (ep) {
              const pKey = `jyzf_progress_${this.currentAnimeId}_${ep[0]}`;
              localStorage.setItem(pKey, String(seekTo));
            }
          }
          this.playEpisode(epIdx);
        });
      }
    },
    
    // ==========================================================================
    // 📺 播放核心逻辑 (逆向算法拼接)
    // ==========================================================================
    switchLine(lineKey) {
      this.activeLineKey = lineKey;
      this.activeEpisodeIndex = -1; // 切换线路时重置选中的集数
    },
    
    async playEpisode(epIdx) {
      if (this.guardTimer) {
        clearInterval(this.guardTimer);
        this.guardTimer = null;
      }
      this.activeEpisodeIndex = epIdx;
      
      const ep = this.activeEpisodes[epIdx];
      if (!ep) return;
      
      this.activeEpisodeName = ep[0]; // 剧集名，如 "第01集"
      let epToken = ep[1];          // 加密 token 或直链 url
      let realUrl = ep[2];          // 💡 预解析出的视频直链 (如果有)

      // 💡 AniCh 占位符前端实时解密 (无感极速解析)
      if (this.activeLineKey === 'anich_m3u8' && epToken && epToken.startsWith('anich_placeholder_')) {
        const parts = epToken.split('_');
        const anichId = parts[2];
        const epNum = parts[3];
        const resolved = await this.resolveAnichUrl(anichId, epNum);
        if (resolved) {
          epToken = resolved;
          realUrl = resolved; // 💡 强行设为直链触发原生 DPlayer 播放
        } else {
          console.error("[AniCh Resolver] Failed to resolve URL from placeholder");
        }
      }

      // 防止第三方进度插件恢复：更新 hash 地址（必须保持 hash 格式，路由器依赖 #/detail/:id）
      // ⚠️ 不能改为 query 参数格式，否则刷新时路由器识别不到 detail/:id，跳回首页
      try {
        window.history.replaceState(null, '', `#/detail/${this.currentAnimeId}?ep=${epIdx}&_t=${new Date().getTime()}`);
      } catch (e) {}

      // 💡 智能流媒体路由算法 (Smart Resolver Routing)：
      const vipList = (this.animeDetail.player_vip || '').split(',');
      const isVip = vipList.includes(this.activeLineKey);
      
      let playUrl = "";
      
      if (isVip) {
        // 如果是官方加密/VIP线路，必须强行使用 AGE 合作官方解析源
        const playerJx = this.animeDetail.player_jx || {};
        const jxBase = playerJx.vip || playerJx.zj;
        if (jxBase) {
          playUrl = jxBase + epToken;
        } else {
          playUrl = "https://jx.wuzhoupai.com:8443/m3u8/?url=" + epToken;
        }
        console.log("[SMART ROUTER] VIP Line detected. routing to Default Decryptor.");
      } else if (this.activeLineKey === 'anich_m3u8') {
        // AniCh 直链线路：ep[1] 本身就是真实 m3u8/mp4 URL，直接播放，不套解析站
        playUrl = epToken;
        console.log("[SMART ROUTER] AniCh direct stream. Playing directly.");
      } else {
        // 如果是常规 M3U8 采集线路 (非凡、暴风、无尽、计算云、红牛等)
        const targetUrlToResolve = realUrl ? realUrl : epToken;
        
        if (this.activeEngineKey === 'default') {
          if (targetUrlToResolve.startsWith('age_')) {
              playUrl = "https://jx.wuzhoupai.com:8443/m3u8/?url=" + targetUrlToResolve;
          } else {
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
      this._hasFallenBack = false; // 重置降级标志，每次新播放重新检测
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

        // dplayerKey 变化后 Vue 需要两个渲染周期才能把新 #dplayer 挂载到 DOM
        this.dplayerKey = 'dplayer_' + this.currentAnimeId + '_' + epIdx;

        // 双层 $nextTick：第一层等 Vue 销毁旧元素，第二层等新 #dplayer 插入 DOM
        // 避免 getElementById('dplayer') 返回 null 导致 DPlayer 初始化失败
        this.$nextTick(() => {
          this.$nextTick(() => {
          try {
            const proxyUrl = "https://jingyanff.xyz/?url=" + encodeURIComponent(capturedRealUrl) +
                             "&client=" + encodeURIComponent(this.clientId) +
                             "&anime=" + encodeURIComponent(this.animeDetail ? this.animeDetail.video.name : '') +
                             "&episode=" + encodeURIComponent(capturedEpName) +
                             "&session=" + encodeURIComponent(this.activeSessionId);

            const dp = new DPlayer({
              container: document.getElementById('dplayer'),
              autoplay: true,
              screenshot: false,
              playsinline: true,
              id: capturedAnimeId + "_" + capturedEpName,
              video: {
                url: proxyUrl,
                type: 'hls'   // 使用 DPlayer 内置 HLS 支持（稳定可靠）
              }
            });
              this.dpInstance = dp;
              
              // 🏮 核心注入：在 DPlayer 控制栏右侧插入自定义“画面比例”切换键
              this.$nextTick(() => {
                const rightIcons = document.querySelector('.dplayer-icons-right');
                if (rightIcons) {
                  // 防重复清理
                  const existBtn = rightIcons.querySelector('.dplayer-fit-icon');
                  if (existBtn) existBtn.remove();
                  
                  const btn = document.createElement('button');
                  btn.className = 'dplayer-icon dplayer-fit-icon';
                  btn.style.width = 'auto';
                  btn.style.padding = '0 12px';
                  btn.style.color = '#fff';
                  btn.style.fontSize = '12px';
                  btn.style.background = 'transparent';
                  btn.style.border = 'none';
                  btn.style.cursor = 'pointer';
                  btn.style.opacity = '0.8';
                  btn.style.transition = 'opacity 0.2s';
                  btn.innerHTML = `<span class="fit-text">比例: ${this.videoFitMode === 'contain' ? '等比' : (this.videoFitMode === 'cover' ? '铺满' : '拉伸')}</span>`;
                  
                  btn.onmouseenter = () => btn.style.opacity = '1';
                  btn.onmouseleave = () => btn.style.opacity = '0.8';
                  
                  const fsBtn = rightIcons.querySelector('.dplayer-full-icon');
                  // insertBefore 要求严格父子关系，fsBtn.before() 更安全
                  if (fsBtn) fsBtn.before(btn);
                  else rightIcons.appendChild(btn);
                  
                  btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleVideoFit();
                    const textSpan = btn.querySelector('.fit-text');
                    if (textSpan) {
                      const labels = { contain: '等比', cover: '铺满', fill: '拉伸' };
                      textSpan.textContent = '比例: ' + labels[this.videoFitMode];
                    }
                  });
                }
              });

              // ▶‖ 下一集按钮注入：仅在有下一集时显示，插在比例按钮左边
              this.$nextTick(() => {
                const ri = document.querySelector('.dplayer-icons-right');
                if (ri && this.hasNextEpisode) {
                  const existNext = ri.querySelector('.dplayer-next-icon');
                  if (existNext) existNext.remove();

                  const nextBtn = document.createElement('button');
                  nextBtn.className = 'dplayer-icon dplayer-next-icon';
                  nextBtn.title = '下一集';
                  Object.assign(nextBtn.style, {
                    width: 'auto', padding: '0 8px', color: '#fff',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', opacity: '0.8',
                    transition: 'opacity 0.2s', display: 'inline-flex',
                    alignItems: 'center', gap: '3px', verticalAlign: 'middle'
                  });
                  nextBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="2.2"
                      stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="5 4 15 12 5 20 5 4"/>
                      <line x1="19" y1="5" x2="19" y2="19"/>
                    </svg>
                    <span style="font-size:11px;letter-spacing:0.02em;">下一集</span>`;

                  nextBtn.onmouseenter = () => nextBtn.style.opacity = '1';
                  nextBtn.onmouseleave = () => nextBtn.style.opacity = '0.8';

                  const fitBtn = ri.querySelector('.dplayer-fit-icon');
                  if (fitBtn) fitBtn.before(nextBtn);
                  else ri.appendChild(nextBtn);

                  nextBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.playNextEpisode();
                  });
                }
              });

              if (savedTime <= 3) {
                console.log("[GUARD] 1.5s zero-seek guard (from-zero only)...");
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
                // ✅ 一旦真正开始播放，标记已播放，防止超时误降级
                if (currentTime > 0.1) playbackStarted = true;
                if (currentTime > 3 && duration && (duration - currentTime > 10)) {
                  const pKey = `jyzf_progress_${capturedAnimeId}_${capturedEpName}`;
                  localStorage.setItem(pKey, currentTime.toString());
                  // 💡 节流写入观看历史 (每 10 秒写一次，避免高频 I/O)
                  if (!this._historyThrottleTimer) {
                    this._historyThrottleTimer = setTimeout(() => {
                      this._historyThrottleTimer = null;
                      this.saveWatchHistory(capturedAnimeId, capturedEpName, currentTime, duration);
                    }, 10000);
                  }
                }
              });

              // ─── 降级函数（复用，避免重复代码）───────────────────────
              const fallbackToIframe = (reason) => {
                if (this._hasFallenBack) return; // 防止多次触发
                this._hasFallenBack = true;
                console.warn(`[FALLBACK → iframe] reason: ${reason}`);
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
                this.$nextTick(() => { this.activePlayUrl = capturedIframeUrl; });
              };

              // 保险①：DPlayer 自身 error 事件
              dp.on('error', () => fallbackToIframe('DPlayer error event'));

              // 保险②：HLS.js 原生 FATAL 错误（CDN分片CORS失败不触发DPlayer error，但会触发这里）
              try {
                const hlsInst = dp.plugins && dp.plugins.hls;
                if (hlsInst && typeof Hls !== 'undefined') {
                  hlsInst.on(Hls.Events.ERROR, (evt, data) => {
                    if (data.fatal) {
                      console.warn('[HLS FATAL]', data.type, data.details);
                      fallbackToIframe('HLS fatal: ' + data.details);
                    }
                  });
                }
              } catch(e) {}

              // 保险③：8 秒超时保险——HLS.js 有时静默重试从不触发 fatal，靠此兜底
              let playbackStarted = false;
              const fallbackTimer = setTimeout(() => {
                if (!playbackStarted) {
                  fallbackToIframe('8s timeout, no playback detected');
                }
              }, 8000);
              // timeupdate 里设置了 playbackStarted = true 时需要清除计时器
              dp.on('timeupdate', () => {
                if (playbackStarted && fallbackTimer) clearTimeout(fallbackTimer);
              });

            console.log(`[DPLAYER PLAYING] ${capturedAnimeId}_${capturedEpName}`);
          } catch(e) {
            console.error("[DPlayer Init Failed] Falling back to Iframe:", e);
            this.isIframeMode = true;
            this.activePlayUrl = capturedIframeUrl;
          }
          }); // 第二层 $nextTick 结束
        }); // 第一层 $nextTick 结束
        return;
      }
      
      // 2. 无直链 → iframe 解析模式（去掉 120ms 延迟，nextTick 后立即赋值）
      this.isIframeMode = true;
      if (this.dpInstance) {
        try { this.dpInstance.destroy(); } catch(e) {}
        this.dpInstance = null;
      }
      this.activePlayUrl = '';
      this.$nextTick(() => {
        this.activePlayUrl = capturedIframeUrl;
        console.log(`[IFRAME PLAYING] URL: ${this.activePlayUrl}`);
      });
    },
    
    // 播放下一集
    playNextEpisode() {
      if (!this.hasNextEpisode) return;
      this.playEpisode(this.activeEpisodeIndex + 1);
      // 切集后滚到播放器顶部，方便用户看到画面
      this.$nextTick(() => {
        const player = document.querySelector('.player-panel');
        if (player) player.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    // 📺 观看历史核心功能 (本地持久化 LocalStorage，最多 30 条)
    // ==========================================================================
    initWatchHistory() {
      try {
        const raw = localStorage.getItem('jyzf_watch_history');
        this.watchHistory = raw ? JSON.parse(raw) : [];
      } catch (e) {
        this.watchHistory = [];
      }
    },

    /**
     * 保存/更新一条观看历史
     * @param {string} aid        - 番剧 AID
     * @param {string} epName     - 集数名，如「第01集」
     * @param {number} currentTime - 当前播放秒数
     * @param {number} duration   - 总时长秒数
     */
    saveWatchHistory(aid, epName, currentTime, duration) {
      if (!aid || !epName || !this.animeDetail) return;
      const video = this.animeDetail.video;
      if (!video) return;

      // 找出当前集数在 activeEpisodes 中的索引（用于恢复时直接 playEpisode）
      const epIdx = this.activeEpisodeIndex;
      const lineKey = this.activeLineKey;

      const entry = {
        AID:        String(aid),
        Title:      video.name || '未知番剧',
        Cover:      video.cover || '',
        EpName:     epName,
        EpIdx:      epIdx,
        LineKey:    lineKey,
        Progress:   Math.floor(currentTime),   // 秒
        Duration:   Math.floor(duration) || 0, // 秒
        UpdatedAt:  Date.now()
      };

      // 删除同 AID 的旧记录，将最新的插到最前
      this.watchHistory = this.watchHistory.filter(h => h.AID !== entry.AID);
      this.watchHistory.unshift(entry);
      // 最多保留 30 条
      if (this.watchHistory.length > 30) {
        this.watchHistory = this.watchHistory.slice(0, 30);
      }

      localStorage.setItem('jyzf_watch_history', JSON.stringify(this.watchHistory));
    },

    /**
     * 从历史记录跳转：打开番剧 → 指定线路 → 指定集数 → seek 到记录进度
     */
    resumeFromHistory(entry) {
      // 暂存恢复信息，供 initializePlayerLine 消费
      this._restoreLineKey = entry.LineKey;
      this._restoreEpIndex = entry.EpIdx;
      this._restoreTime   = entry.Progress;
      this.selectAnime(entry.AID);
    },

    /** 删除单条历史 */
    removeWatchHistory(aid) {
      this.watchHistory = this.watchHistory.filter(h => h.AID !== String(aid));
      localStorage.setItem('jyzf_watch_history', JSON.stringify(this.watchHistory));
    },

    /** 清空全部历史 */
    clearWatchHistory() {
      this.watchHistory = [];
      localStorage.removeItem('jyzf_watch_history');
    },

    /** 格式化秒数为 mm:ss 或 hh:mm:ss */
    formatTime(sec) {
      if (!sec || sec < 0) return '0:00';
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
      return `${m}:${String(s).padStart(2, '0')}`;
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
    goHome(skipHashUpdate = false) {
      console.log('[DEBUG ROUTER] goHome() called. skipHashUpdate:', skipHashUpdate);
      // 安全销毁 DPlayer 实例，防止声音残留
      if (this.dpInstance) {
        try { this.dpInstance.destroy(); } catch(e) {}
        this.dpInstance = null;
      }
      this.isIframeMode = false;
      
      this.currentAnimeId = null;
      this.currentPage = 'home'; // 重置到首页视图
      
      try {
        localStorage.setItem('jyzf_last_page', 'home'); // 💾 同步更新本地路由缓存
      } catch (e) {
        console.warn('[ROUTER] localStorage.setItem failed in goHome:', e);
      }
      
      // 🎋 切换回首页时，如果之前未展示过动画，且处于首页视图，启动动画锁定计时器
      if (!this.zhujianAnimated) {
        setTimeout(() => {
          this.zhujianAnimated = true;
        }, 2600);
      }
      
      if (skipHashUpdate !== true) {
        window.location.hash = '#/';
        console.log('[DEBUG ROUTER] goHome() set window.location.hash to #/');
      }
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

    // 📚 进入番剧库页
    goCatalog() {
      console.log('[DEBUG ROUTER] goCatalog() called.');
      // 安全停止播放
      if (this.dpInstance) {
        try { this.dpInstance.destroy(); } catch(e) {}
        this.dpInstance = null;
      }
      this.isIframeMode = false;
      this.currentAnimeId = null;
      this.animeDetail = null;
      this.activePlayUrl = '';
      this.currentPage = 'catalog';
      this.catalogPageNum = 1; // 重置到第一页
      
      try {
        localStorage.setItem('jyzf_last_page', 'catalog'); // 💾 同步更新本地路由缓存
      } catch (e) {
        console.warn('[ROUTER] localStorage.setItem failed in goCatalog:', e);
      }
      
      window.location.hash = '#/catalog';
      window.scrollTo(0, 0);
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
    },
    
    // 💡 监听窗口尺寸变化
    handleResize() {
      this.screenWidth = window.innerWidth;
    },
    
    // 💡 画面比例切换服务 (循环切换：等比 -> 铺满/裁剪 -> 强制拉伸)
    toggleVideoFit() {
      const modes = ['contain', 'cover', 'fill'];
      const currentIdx = modes.indexOf(this.videoFitMode);
      this.videoFitMode = modes[(currentIdx + 1) % modes.length];
      
      // 💡 核心修复：将缩放类直接施加给 document.body！
      // 由于全屏状态下（特别是 iOS Native 全屏或 DPlayer 全屏），原本 DOM 树的父级关联可能失效，
      // 通过全局 Body 级别 class 与 CSS !important 强行锁定 object-fit，100% 确保全屏下视频拉伸生效。
      document.body.classList.remove('fit-contain', 'fit-cover', 'fit-fill');
      document.body.classList.add('fit-' + this.videoFitMode);
    },
    
    // 💡 路由解析服务 (全面防错、支持 Trailing Slash、Query String，正则静默提取)
    handleHashRoute() {
      let hash = "";
      try {
        hash = decodeURIComponent(window.location.hash);
      } catch (e) {
        hash = window.location.hash;
      }
      
      console.log(`[ROUTER] URL hash change matched: "${hash}"`);
      
      // 正则动态适配 detail/<AID> 结构
      const match = hash.match(/detail\/([0-9]+)/);
      if (match) {
        const aid = match[1];
        console.log(`[ROUTER] Target route is detail page. AID: ${aid}`);
        try {
          localStorage.setItem('jyzf_last_page', 'detail/' + aid); // 💾 记录本地路由缓存
        } catch (e) {
          console.warn('[ROUTER] localStorage.setItem failed in handleHashRoute detail:', e);
        }
        const needLoad = (String(this.currentAnimeId) !== String(aid)) || !this.animeDetail;
        if (aid && needLoad) {
          const epMatch = hash.match(/[?&]ep=(\d+)/);
          if (epMatch) {
            this._restoreEpIndex = parseInt(epMatch[1], 10);
          }
          this.selectAnime(aid, true);
        }
      } else if (hash.includes('/catalog')) {
        // 📚 番剧库路由
        console.log(`[ROUTER] Target route is catalog.`);
        try {
          localStorage.setItem('jyzf_last_page', 'catalog'); // 💾 记录本地路由缓存
        } catch (e) {
          console.warn('[ROUTER] localStorage.setItem failed in handleHashRoute catalog:', e);
        }
        if (this.currentPage !== 'catalog') {
          this.currentPage = 'catalog';
          this.currentAnimeId = null;
        }
      } else {
        console.log(`[ROUTER] Target route is homepage.`);
        try {
          localStorage.setItem('jyzf_last_page', 'home'); // 💾 记录本地路由缓存
        } catch (e) {
          console.warn('[ROUTER] localStorage.setItem failed in handleHashRoute home:', e);
        }
        if (this.currentAnimeId !== null || this.currentPage !== 'home') {
          this.goHome(true);
        }
      }
    }
  },
  
  beforeDestroy() {
    if (this.bannerTimer) {
      clearInterval(this.bannerTimer);
    }
    window.removeEventListener('resize', this.handleResize);
  }
});

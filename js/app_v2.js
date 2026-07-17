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
    healingList: [],
    isAllHealingShown: false,
    
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
    mainContentTransitionClass: '', // 3D 屏风折叠转场类
    detailTransitionClass: '',      // 3D 画轴拉开转场类
    isTransitioning: false,         // 转场防重入锁标记
    detailError: false, // 💡 新增：详情加载错误状态标记
    isWebFullscreen: false, // 💡 新增：是否处于全局网页全屏状态
    activeLineKey: '', // 当前选中的播放线路
    activeEpisodeIndex: -1, // 当前选中的集数索引
    activePlayUrl: '', // 正在播放的 iframe 链接
    activeEpisodeName: '', // 正在播放的剧集名称
    currentAnichBackupUrls: [], // 💡 缓存当前这一集的所有备用播放源
    currentAnichUrlIndex: 0, // 💡 当前播放的备用源索引
    dplayerKey: 'dplayer_init', // DPlayer DOM 容器的物理隔离 Key
    guardTimer: null, // 高频归零阻截定时器
    clientId: '', // 景雁分析：唯一观众代号
    activeSessionId: '', // 景雁分析：当前播放会话 ID
    lastLogProgressTime: 0, // 景雁分析：上次上报的播放秒数
    showLoadingToast: false, // 是否显示加载提示框
    loadingText: '', // 加载提示文字
    loadingTextInterval: null,
    
    // 解析引擎库 (纯 HTTPS 保证 GitHub Pages 无 Mixed Content 跨域阻断)
    jxEngines: [
      { label: '系统默认 (景雁 合作源)', value: 'default' },
      { label: '超清 VIP 极速接口 A (先锋解析)', value: 'https://jx.xmflv.com/?url=' },
      { label: '超清 VIP 万能接口 B (JSON解析)', value: 'https://jx.jsonplayer.com/?url=' },
      { label: '全网超级 VIP 接口 C', value: 'https://im1907.top/?jx=' }
    ],
    activeEngineKey: 'default',
    // H5 播放器状态管理
    iframeTimeoutTimer: null, // iframe 播放超时静默自愈定时器
    dpInstance: null,      // DPlayer 实例
    isIframeMode: false,   // 是否为 Iframe 降级模式
    activeBlobUrl: '',     // 前端重写 M3U8 生成 spacing 的 Blob URL
    anichRequestCount: 0,  // AniCh 线路播放累积计数，用于额度预警
    
    // 追番收藏夹
    anichMap: {}, // 外部 anich_xxxxx 映射到 age 官方数字 ID 字典
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
    // 🖋 景雁诗 · 古风诗词（正常首句→末句顺序，配合 vertical-rl 从右向左排版）
    poemLines: ['辞霜踏雪向景明，', '万里南飞一客雁。', '木棉红透珠江水，', '化作春风伴远山。'],
    poemAnimKey: 0, // 每次重新触发动画时自增
  },
  
  computed: {
    relatedList() {
      if (!this.animeDetail) return [];
      // 优先使用官方最外层的 series 字段 (格式为 [{ AID, Title, PicSmall }])
      if (this.animeDetail.series && Array.isArray(this.animeDetail.series) && this.animeDetail.series.length > 0) {
        return this.animeDetail.series.map(item => ({
          id: String(item.AID),
          title: item.Title,
          cover: item.PicSmall
        }));
      }
      // 其次使用我们计算注入的 video.related 字段
      if (this.animeDetail.video && this.animeDetail.video.related && Array.isArray(this.animeDetail.video.related)) {
        return this.animeDetail.video.related.map(item => ({
          id: String(item.id),
          title: item.title,
          cover: item.cover
        }));
      }
      return [];
    },
    displayedTheatricalList() {
      if (!this.searchIndex) return [];
      return this.searchIndex.filter(a => a.Type === '剧场版').slice(0, 18);
    },
    displayedHealingList() {
      if (!this.healingList) return [];
      
      // 🌸 真实豆瓣 9 分级 (8.7+) 治愈系神作 AID 白名单，保障数据真实高水准，剔除低分/致郁番剧
      const healingWhiteList = [
        '20080002', // 夏目友人帐 (9.4)
        '20180028', // 摇曳露营 (9.6)
        '20120007', // 冰菓 (9.0)
        '20130025', // 银之匙 (9.3)
        '20230207', // 葬送的芙莉莲 (9.5)
        '20260029', // 葬送的芙莉莲 第二季 (9.5)
        '20200067', // 隐瞒之事 (9.1)
        '20170096', // 少女终末旅行 (9.3)
        '20180040', // 妖精森林的小不点 (9.2)
        '20180311', // 夏目友人帐剧场版 (8.8)
        '20190396', // 紫罗兰永恒花园 外传 (8.8)
        '20160104', // 田中君总是如此慵懒 (8.9)
        '20170032', // 月色真美 (9.0)
        'anich_32275' // 小鲨鱼去郊游 (9.2)
      ];

      // 基于白名单对原始 healingList 过滤
      let filtered = this.healingList.filter(item => {
        const aidStr = String(item.AID);
        return healingWhiteList.includes(aidStr);
      });

      // 按照白名单的推荐顺序排列
      filtered.sort((a, b) => {
        return healingWhiteList.indexOf(String(a.AID)) - healingWhiteList.indexOf(String(b.AID));
      });

      if (this.isAllHealingShown) {
        return filtered;
      }
      return filtered.slice(0, 15);
    },
    // 💡 热播风云榜 (Top 10)：基于真实豆瓣评分高分神作进行排名选取，拒绝假公式与低分动漫
    topRatingList() {
      const dbHighList = [
        { AID: '20220244', Title: '进击的巨人 最终季 完结篇 前篇', Cover: 'https://cdn.aqdstatic.com:966/age/20220244.jpg', Status: '完结', Score: '9.7', Hot: 98600 },
        { AID: '20230207', Title: '葬送的芙莉莲', Cover: 'https://cdn.aqdstatic.com:966/age/20230207.jpg', Status: '完结', Score: '9.5', Hot: 97800 },
        { AID: '20260029', Title: '葬送的芙莉莲 第二季', Cover: 'https://cdn.aqdstatic.com:966/age/20260029.jpg', Status: '连载中', Score: '9.5', Hot: 96500 },
        { AID: '20080002', Title: '夏目友人帐', Cover: 'https://cdn.aqdstatic.com:966/age/20080002.jpg', Status: '完结', Score: '9.4', Hot: 95300 },
        { AID: '20160023', Title: '路人超能100', Cover: 'https://cdn.aqdstatic.com:966/age/20160023.jpg', Status: '完结', Score: '9.4', Hot: 94100 },
        { AID: '20130007', Title: '命运石之门 负荷领域的既视感', Cover: 'https://cdn.aqdstatic.com:966/age/20130007.jpg', Status: '完结', Score: '9.2', Hot: 92800 },
        { AID: '20260205', Title: '无职转生Ⅲ 到了异世界就拿出真本事', Cover: 'https://cdn.aqdstatic.com:966/age/20260205.jpg', Status: '连载中', Score: '9.1', Hot: 91600 },
        { AID: '20220248', Title: '无职转生Ⅱ ～到了异世界就拿出真本事～', Cover: 'https://cdn.aqdstatic.com:966/age/20220248.jpg', Status: '完结', Score: '8.8', Hot: 89600 },
        { AID: '20180311', Title: '夏目友人帐剧场版 ～缘结空蝉～', Cover: 'https://cdn.aqdstatic.com:966/age/20180311.jpg', Status: '完结', Score: '8.8', Hot: 88500 },
        { AID: '20190396', Title: '紫罗兰永恒花园 外传 - 永远与自动手记人偶 -', Cover: 'https://cdn.aqdstatic.com:966/age/20190396.jpg', Status: '完结', Score: '8.8', Hot: 87200 }
      ];
      
      return dbHighList.map(item => ({
        aid: item.AID,
        title: item.Title,
        cover: item.Cover,
        status: item.Status,
        score: item.Score,
        hot: item.Hot.toLocaleString()
      }));
    },
    // 💡 动态判断是否为手机移动端/iPad设备 (屏幕宽度 <= 768px 或 User-Agent 匹配移动设备)
    isMobile() {
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      return isMobileUA || this.screenWidth <= 768;
    },

    // 📚 番剧库：过滤 + 排序后的完整列表
    catalogAnimes() {
      let list = this.searchIndex || [];
      // 按状态或类型筛选
      if (this.catalogFilter === '剧场版') {
        list = list.filter(a => a.Type === '剧场版');
      } else if (this.catalogFilter !== '全部') {
        list = list.filter(a => a.Status === this.catalogFilter);
      }
      // 排序
      if (this.catalogSort === 'title') {
        list = [...list].sort((a, b) => a.Title.localeCompare(b.Title, 'zh'));
      } else {
        // 默认排序：以 UpdateTime 最新更新物理时间戳降序为唯一最高标准！
        list = [...list].sort((a, b) => {
          const utA = a.UpdateTime || 0;
          const utB = b.UpdateTime || 0;
          if (utA !== utB) {
            return utB - utA; // 时间戳大的（最新更新的）排最前
          }
          // 兜底：若修改时间一致，则按常规 AID 倒序
          const aidA = String(a.AID);
          const aidB = String(b.AID);
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
      
      // 合法可播放的常规 M3U8 H5 线路白名单 (包含 A123 极速源与好好看黄金线)
      const ALLOWED_KEYS = ['lzm3u8', 'wjm3u8', 'ffm3u8', 'bfzym3u8', 'hnm3u8', 'wolong', 'subm3u8', 'kym3u8', 'anich_m3u8', 'a123_line1', 'yhdm_line1'];
      
      let lines = [];
      
      // 💡 辅助函数：根据规则收集线路
      const gatherLines = (forceAllowAll = false) => {
        const result = [];
        for (const key in playlists) {
          const eps = playlists[key];
          if (eps && eps.length > 0) {
            let isAllowed = ALLOWED_KEYS.includes(key) || forceAllowAll;
            
            if (!isAllowed) {
              const firstEp = eps[0];
              if (Array.isArray(firstEp) && firstEp.length >= 3 && firstEp[2] && String(firstEp[2]).startsWith('http')) {
                isAllowed = true;
              }
            }
            
            if (isAllowed) {
              const isVip = vipList.includes(key);
              const firstEp = eps[0];
              const hasRealUrl = Array.isArray(firstEp) && firstEp.length >= 3 && firstEp[2] && String(firstEp[2]).startsWith('http');
              if (!isVip || hasRealUrl || forceAllowAll) {
                let lineTitle = labelArr[key] || key;
                if (key === 'a123_line1') lineTitle = 'A123 极速源';
                if (key === 'xigua') lineTitle = '官方直连源';
                result.push({
                  key: key,
                  title: lineTitle,
                  isVip: isVip && !hasRealUrl ? true : false
                });
              }
            }
          }
        }
        return result;
      };
      
      lines = gatherLines(false);
      
      // 💡 容灾保底防线：如果常规线路全部被过滤为空，说明这是一部纯官方源的老旧番剧，我们强行放行所有线路以展示剧集！！！
      if (lines.length === 0) {
        lines = gatherLines(true);
      }
      
      // 💡 黄金体验排序法则：根据播放兼容性与速度给线路进行权重打分，将最优质、最稳定的 DPlayer 原生直连源顶格展示！
      // 💡 同时，如果线路的兼容评分相同，则优先将集数多的线路排在前面，防止默认选中残缺的播放源。
      lines.sort((a, b) => {
        const getScore = (line) => {
          const eps = playlists[line.key];
          const firstEp = eps ? eps[0] : null;
          const hasRealUrl = Array.isArray(firstEp) && firstEp.length >= 3 && firstEp[2] && String(firstEp[2]).startsWith('http');
          
          // 🥇 最稳定直连第一梯队：常规 M3U8 直链采集白名单、A123 极速直连源 与 AniCh 专属源，100% 稳定 DPlayer 免广告秒开
          const STABLE_DPLAYER_KEYS = ['lzm3u8', 'wjm3u8', 'ffm3u8', 'bfzym3u8', 'hnm3u8', 'wolong', 'subm3u8', 'kym3u8', 'anich_m3u8', 'a123_line1'];
          if (STABLE_DPLAYER_KEYS.includes(line.key)) {
            return 10;
          }
          
          // 🥈 备用直连第二梯队：西瓜 (xigua) 或其他被回填了直链但官方防盗链极严、极易报错降级 iframe 广告站的线路
          if (hasRealUrl) {
            return 5;
          }
          
          // ⚠️ 垫底梯队：必须走 iframe 广告解析站的加密 VIP 线路
          return 0;
        };
        
        const scoreA = getScore(a);
        const scoreB = getScore(b);
        if (scoreA !== scoreB) {
          return scoreB - scoreA; // 分数高的排在前面
        }
        
        // 💡 体验对齐：分数相同时，集数（即播放列表长度）多的排在前面
        const lenA = (playlists[a.key] || []).length;
        const lenB = (playlists[b.key] || []).length;
        return lenB - lenA;
      });
      
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
      const query = newVal.trim().toLowerCase();
      if (!query) {
        this.remoteSearchResults = [];
        return;
      }
      
      // 💡 在本地搜索索引中做一次极速预过滤
      const localMatches = this.searchIndex.filter(item => {
        const title = (item.Title || '').toLowerCase();
        const pinyin = (item.Pinyin || '').toLowerCase();
        return title.includes(query) || pinyin.includes(query);
      });
      
      // 💡 如果本地已经能搜到至少一个结果，则绝对不请求云端代理，100% 节省接口额度！
      if (localMatches.length > 0) {
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
      this.stopLoadingAnimation(); // 💡 切换番剧时，强制清理任何残留的加载 HUD 和定时器
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
    // 💡 版本缓存自愈机制：每次代码发布/数据更新，如果本地版本与 JYZF_VERSION 不一致，强制清空 LocalStorage
    try {
      const currentVersion = window.JYZF_VERSION || 'default';
      const localVersion = localStorage.getItem('jyzf_app_version');
      if (localVersion !== currentVersion) {
        console.warn(`[CACHE CLEAR] Version mismatch (local: ${localVersion}, current: ${currentVersion}). Clearing details & search index cache...`);
        localStorage.removeItem('jyzf_search_index_cache');
        localStorage.removeItem('jyzf_home_list_cache');
        localStorage.removeItem('jyzf_banner_list_cache');
        
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('jyzf_detail_cache_') || key.startsWith('jyzf_resolved_a123_'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        localStorage.setItem('jyzf_app_version', currentVersion);
      }
    } catch (e) {
      console.warn('[CACHE CLEAR] Error checking app version cache:', e);
    }

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
    // 🏮 异步加载 anich_map 外部 ID 映射表，加载成功后自动校准刷新路由，防 404 挂死
    axios.get('data/anich_map.json?_t=' + new Date().getTime())
      .then(res => {
        this.anichMap = res.data || {};
        console.log(`[MAPPING LOAD] Successfully loaded anich_map.json with ${Object.keys(this.anichMap).length} items.`);
        this.handleHashRoute();
      })
      .catch(err => {
        console.warn("[MAPPING LOAD] Failed to fetch data/anich_map.json:", err);
      });

    // 首次渲染图标
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    window.addEventListener('resize', this.handleResize);
    
    // 💡 监听浏览器原生全屏状态变化，自动同步 WebFullscreen 状态（防 Esc 或物理退出状态失步）
    this.fullscreenChangeHandler = () => {
      const isFullscreen = !!(document.fullscreenElement || 
                            document.webkitFullscreenElement || 
                            document.mozFullScreenElement || 
                            document.msFullscreenElement);
      this.isWebFullscreen = isFullscreen;
    };
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('webkitfullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('mozfullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('MSFullscreenChange', this.fullscreenChangeHandler);
    
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

    // 🖤 水墨赛博：全局水墨晕染点击反馈监听
    this.inkRippleHandler = (e) => {
      const target = e.target.closest('.btn, .fav-toggle-btn, .anime-card, .related-item-card, .page-btn, .detail-tab-btn, .filter-btn, .back-nav');
      if (!target) return;
      
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const container = document.createElement('div');
      container.className = 'ink-ripple-container';
      
      const ripple = document.createElement('div');
      ripple.className = 'ink-ripple-dot';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      
      container.appendChild(ripple);
      target.style.position = target.style.position || 'relative';
      target.appendChild(container);
      
      setTimeout(() => {
        container.remove();
      }, 550);
    };
    document.addEventListener('click', this.inkRippleHandler);
  },
  
  beforeDestroy() {
    window.removeEventListener('resize', this.handleResize);
    if (this.hashRouteHandler) {
      window.removeEventListener('hashchange', this.hashRouteHandler);
    }
    if (this.inkRippleHandler) {
      document.removeEventListener('click', this.inkRippleHandler);
    }
    if (this.fullscreenChangeHandler) {
      document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
      document.removeEventListener('webkitfullscreenchange', this.fullscreenChangeHandler);
      document.removeEventListener('mozfullscreenchange', this.fullscreenChangeHandler);
      document.removeEventListener('MSFullscreenChange', this.fullscreenChangeHandler);
    }
    if (this.activeBlobUrl) {
      try { URL.revokeObjectURL(this.activeBlobUrl); } catch(e) {}
    }
  },
  
  methods: {
    getProxiedImageUrl(url) {
      if (!url) return '';
      const sUrl = String(url).trim();
      if (sUrl.startsWith('data:') || sUrl.startsWith('blob:')) return sUrl;
      
      // 💡 核心拦截：如果是第三方资源网防盗链图片，或者是包含 966 非标准端口的安全拦截图片，或者来自于 Bangumi 的境外封面，自动使用 weserv.nl 代理以实现国内秒开！
      if (sUrl.includes('hongniuzy') || sUrl.includes('feifanzy') || sUrl.includes('liangzi') || sUrl.includes(':966') || sUrl.includes('aqdstatic') || sUrl.includes('agedm') || sUrl.includes('a123tv') || sUrl.includes('bgm.tv')) {
        const cleanUrl = sUrl.replace(/^https?:\/\//i, '');
        return `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}`;
      }

      return sUrl;
    },
    handleImageError(event, id) {
      if (event.target.dataset.errorTriggered) return;
      event.target.dataset.errorTriggered = 'true';
      
      // 💡 终极防重复特效药：使用优雅的内联 SVG 磨砂渐变占位符，100% 本地即时渲染，绝无二次挂图隐患！
      const title = event.target.alt || '暂无标题';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#2e2e3e"/>
            <stop offset="100%" stop-color="#1d1d2b"/>
          </linearGradient>
        </defs>
        <rect width="300" height="400" fill="url(#g)" rx="12"/>
        <circle cx="150" cy="160" r="32" fill="#3c3c4f" />
        <path d="M145 149 L162 160 L145 171 Z" fill="#ff4081" />
        <text x="150" y="245" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600" fill="#a0a0b0" text-anchor="middle">${title}</text>
        <text x="150" y="275" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#5c5c6f" text-anchor="middle">海报加载失败</text>
      </svg>`;
      event.target.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
    startLoadingAnimation(initialText) {
      this.showLoadingToast = true;
      let step = 0;
      const loadingSteps = [
        "🔍 正在为您检索并校验极速播放源...",
        "⚡ 已连通云端专线，正在穿透解密...",
        "🛡️ 正在进行线路优化与安全广告拦截...",
        "🎬 解析成功！视频分片正在准备就绪...",
        "🚀 正在进行最后的缓冲，请稍等片刻..."
      ];
      this.loadingText = initialText || loadingSteps[0];
      
      if (this.loadingTextInterval) clearInterval(this.loadingTextInterval);
      this.loadingTextInterval = setInterval(() => {
        step++;
        if (step < loadingSteps.length) {
          this.loadingText = loadingSteps[step];
        } else {
          this.loadingText = "🚀 视频分片缓冲中，马上为您起播...";
        }
      }, 1600);
    },
    stopLoadingAnimation() {
      this.showLoadingToast = false;
      if (this.loadingTextInterval) {
        clearInterval(this.loadingTextInterval);
        this.loadingTextInterval = null;
      }
    },
    triggerFallbackBanners() {
      const list = this.recommendList.slice(0, 4);
      const fallbackBanners = list.map(item => ({
        html: item.Title,
        AID: item.AID,
        style: item.PicSmall
      }));
      
      this.bannerList = fallbackBanners;
      
      const fallbackBStr = JSON.stringify(fallbackBanners);
      localStorage.setItem('jyzf_banner_list_cache', fallbackBStr);
      // 预加载轮播大图
      fallbackBanners.forEach(b => this.preloadImage(b.style));
    },
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
        
        // 💡 双源智能分类排序：直接播放的国内/快速 CDN 放在前面，需要走我们代理的 (Cloudflare/被墙/emmmm) 放在后面
        const directUrls = [];
        const proxyUrls = [];
        
        for (const url of urls) {
          const isProxyDomain = url.includes('cloudflare') || url.includes('.cf.') || url.includes('emmmm.eu.org');
          if (isProxyDomain) {
            proxyUrls.push(url);
          } else {
            directUrls.push(url);
          }
        }
        
        // 直连线路内部，按原先的优先级规则进行微调排序
        const directPriority = [
          "vzcdn.net",
          "girigirilove.top",
          "yhdmm3u8.top",
          "92cj.com"
        ];
        directUrls.sort((a, b) => {
          let idxA = directPriority.findIndex(p => a.includes(p));
          let idxB = directPriority.findIndex(p => b.includes(p));
          if (idxA === -1) idxA = 99;
          if (idxB === -1) idxB = 99;
          return idxA - idxB;
        });
        
        const sortedUrls = [...directUrls, ...proxyUrls];
        
        // 💡 历史成功源节点记忆读取：若用户先前成功播放过该集的某个备用源，直接提取并置顶为首选 URL，防止重复请求报错
        const hist = this.watchHistory.find(h => h.AID === String(this.currentAnimeId) && h.EpName === this.activeEpisodeName && h.LineKey === 'anich_m3u8');
        if (hist && hist.AnichUrl && sortedUrls.includes(hist.AnichUrl)) {
          const targetUrl = hist.AnichUrl;
          const idx = sortedUrls.indexOf(targetUrl);
          if (idx > -1) {
            sortedUrls.splice(idx, 1);
            sortedUrls.unshift(targetUrl);
            console.log(`[VOD MEMORY] Prioritize successful historical URL:`, targetUrl.substring(0, 60));
          }
        }
        
        this.currentAnichBackupUrls = sortedUrls;
        this.currentAnichUrlIndex = 0;
        
        let finalUrl = sortedUrls.length > 0 ? sortedUrls[0] : null;
        
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
          this.healingList = data.healing_list || [];
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
      axios.get('data/home-list.json?_t=' + new Date().getTime())
        .then(response => {
          const data = response.data || {};
          
          // 💡 无论缓存是否相同，都必须进行常规赋值以确保 Vue 的反应式状态正常，防止首屏因为缓存逻辑变为空白
          this.latestList = data.latest || [];
          this.recommendList = data.recommend || [];
          this.weekList = data.week_list || {};
          this.weekListKeys = Object.keys(this.weekList);
          this.healingList = data.healing_list || [];
          
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
          axios.get('data/slipic.json?_t=' + new Date().getTime())
            .then(res => {
              const banners = res.data || [];
              if (banners.length > 0) {
                this.bannerList = banners; // 💡 始终赋值
                
                const cachedBStr = localStorage.getItem('jyzf_banner_list_cache');
                const newBStr = JSON.stringify(banners);
                if (newBStr !== cachedBStr) {
                  localStorage.setItem('jyzf_banner_list_cache', newBStr);
                  // 预加载轮播大图
                  banners.forEach(b => this.preloadImage(b.style));
                }
              } else {
                this.triggerFallbackBanners();
              }
            })
            .catch(() => {
              this.triggerFallbackBanners();
            });
        })
        .catch(err => {
          console.error("后台同步首页列表失败，若无缓存页面可能为空:", err);
        });

      // 2. 在后台拉取最新搜索与分类索引数据库
      axios.get('data/search_index.json?_t=' + new Date().getTime())
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
      if (this.isTransitioning) return;

      // 💡 外部 ID 映射自愈：若为 anich_ 等第三方 ID，在此将其重写翻译为真正的官方数字 ID
      if (this.anichMap && this.anichMap[aid]) {
        const translatedId = this.anichMap[aid];
        console.log(`[MAPPING RESOLVE] Translated external ID ${aid} to official ID ${translatedId}`);
        aid = translatedId;
        // 如果是从 hash 变化进入的 (skipHashUpdate === true)，强行把当前 hash 重写为正确 ID 形式，校准地址栏
        if (skipHashUpdate === true) {
          window.location.hash = '#/detail/' + aid;
          return;
        }
      }
      
      // 💡 智能链接/非纯数字提炼器：如果用户粘贴的是包含 ID 的链接，自动提取出纯数字 (排除 anich_ 开头的独有 ID)
      if (typeof aid === 'string' && !/^\d+$/.test(aid) && !aid.startsWith('anich_') && !aid.startsWith('a123_')) {
        const match = aid.match(/\d+/);
        if (match) {
          aid = match[0];
        }
      }

      // 真正执行详情数据和路由切换的内嵌函数
      const doLoad = () => {
        console.log('[DEBUG ROUTER] selectAnime() actual load. aid:', aid, 'skipHashUpdate:', skipHashUpdate);
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
        axios.get(`data/detail/${aid}.json?_t=` + new Date().getTime())
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
      };

      // 🪐 时序控制：skipHashUpdate=true 表示路由直接加载（页面刷新/分享链接），跳过转场直接渲染
      if (skipHashUpdate === true) {
        this.currentPage = 'detail';
        doLoad();
        return;
      }

      // 从首页/番剧库进入，播放 3D 屏风折叠→画轴展开转场动画
      if (this.currentPage !== 'detail' || !this.currentAnimeId) {
        this.isTransitioning = true;
        this.mainContentTransitionClass = 'fold-exit-active';
        
        setTimeout(() => {
          this.mainContentTransitionClass = '';
          this.currentPage = 'detail';
          doLoad();

          // 先设置 unroll-prepare（初始收缩态），等一帧后触发动画
          this.detailTransitionClass = 'unroll-prepare';
          this.$nextTick(() => {
            requestAnimationFrame(() => {
              this.detailTransitionClass = 'unroll-enter-active';
              setTimeout(() => {
                this.detailTransitionClass = '';
                this.isTransitioning = false;
              }, 520);
            });
          });
        }, 380);
      } else {
        // 在详情页内跳转同系列推荐，直接执行无转场快速加载
        doLoad();
      }
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
    },
    
    async playEpisode(epIdx, isAutoRetry = false) {
      if (!isAutoRetry) {
        this._triedLines = new Set();
      }
      
      // 💡 强力中断上一次未完成的异步网络请求（如 A123 嗅探等），彻底切断后台带宽占用，防止切换卡顿
      if (this.activeAbortController) {
        try { this.activeAbortController.abort(); } catch(e) {}
      }
      this.activeAbortController = new AbortController();
      const signal = this.activeAbortController.signal;

      // 💡 强力防逃逸与极速解码器释放：在销毁前先暂停并清空 video.src，腾出系统解码器通道和网络连接，彻底消灭切换线路卡断！
      if (this.dpInstance) {
        try {
          this.dpInstance.pause();
          if (this.dpInstance.video) {
            this.dpInstance.video.src = '';
            this.dpInstance.video.load();
          }
          this.dpInstance.destroy();
        } catch(e) {}
        this.dpInstance = null;
      }
      this.activePlayUrl = '';
      if (this.iframeTimeoutTimer) {
        clearTimeout(this.iframeTimeoutTimer);
        this.iframeTimeoutTimer = null;
      }
      if (this.activeBlobUrl) {
        try { URL.revokeObjectURL(this.activeBlobUrl); } catch(e) {}
        this.activeBlobUrl = '';
      }

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

      // 💡 仅当 realUrl 存在但不以 http 开头（即不是合法直链网址）时，我们才将非 AniCh 线路的 realUrl 置空
      if (this.activeLineKey !== 'anich_m3u8' && realUrl && !realUrl.startsWith('http://') && !realUrl.startsWith('https://')) {
        realUrl = "";
      }


      // 💡 A123 线路：如果内存没有直链，先尝试从浏览器的 localStorage 中读取 24 小时内的缓存，实现 0 网络请求瞬间秒开！
      if (!realUrl && epToken && epToken.startsWith('/v/') && epToken.endsWith('.html')) {
        const cacheKey = `jyzf_resolved_a123_${this.currentAnimeId}_${epIdx}`;
        const cachedItem = localStorage.getItem(cacheKey);
        if (cachedItem) {
          try {
            const cacheObj = JSON.parse(cachedItem);
            if (new Date().getTime() - cacheObj.time < 86400000) { // 24小时内有效
              console.log("[A123 CACHE] localStorage hit! Stream URL:", cacheObj.url);
              realUrl = cacheObj.url;
              ep[2] = realUrl; // 写入内存
            }
          } catch(e) {}
        }
      }

      // 💡 累加 AniCh 线路播放计数，并在点播 >=3 次后前端高亮额度红色警报
      if (this.activeLineKey === 'anich_m3u8') {
        this.anichRequestCount += 1;
      }
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
          // 💡 强力播放自愈：当专属直链线路解析失败时（如服务器500或新番未上线数据空缺），自动探测备用常规源并执行秒级无缝切换
          let backupLineKey = '';
          if (this.animeDetail && this.animeDetail.playlists) {
            for (let lKey of Object.keys(this.animeDetail.playlists)) {
              if (lKey !== 'anich_m3u8' && this.animeDetail.playlists[lKey].length > 0) {
                backupLineKey = lKey;
                break;
              }
            }
          }
          if (backupLineKey) {
            console.log(`[AniCh Resolver] Auto-healing: switching to backup line ${backupLineKey}...`);
            this.switchLine(backupLineKey);
            this.$nextTick(() => {
              this.playEpisode(0);
            });
            console.warn("[PLAYER] 当前专属线路视频源未就绪，已自动切换到备用播放源");
          } else {
            this.isIframeMode = false;
            this.activePlayUrl = '';
            console.warn("[PLAYER] 当前专属线路视频源未就绪，且无其它备用线路");
          }
          return;
        }
      }

      // 💡 A123TV 播放页跨域直链按需嗅探提取 (极致省流 0 API 消耗)
      if (epToken && epToken.startsWith('/v/') && epToken.endsWith('.html') && !realUrl) {
        this.startLoadingAnimation("正在从 A123TV 跨域提取极速播放直链...");
        try {
          const targetUrl = "https://jingyanff.xyz/?url=" + encodeURIComponent("https://a123tv.com" + epToken);
          const response = await fetch(targetUrl, { signal });
          if (response.ok) {
            const htmlText = await response.text();
            // 匹配 data-src 里的 M3U8
            const match = htmlText.match(/data-src="([^"]+\.m3u8[^"]*)"/);
            if (match) {
              const m3u8Url = match[1];
              realUrl = m3u8Url;
              // 💡 存入内存，供该会话内后续无感重播
              if (ep.length === 2) {
                ep.push(m3u8Url);
              } else if (ep.length >= 3) {
                ep[2] = m3u8Url;
              }
              
              // 💡 持久化缓存：写入 localStorage，24小时内起播无需再次请求嗅探域名！
              try {
                const cacheKey = `jyzf_resolved_a123_${this.currentAnimeId}_${epIdx}`;
                localStorage.setItem(cacheKey, JSON.stringify({
                  url: m3u8Url,
                  time: new Date().getTime()
                }));
              } catch(e) {}
              
              console.log("[A123 RESOLVER] Extracted stream successfully and cached to localStorage:", m3u8Url);
            }
          }
        } catch (err) {
          console.warn("[A123 RESOLVER] Failed to fetch target page:", err);
          this.stopLoadingAnimation();
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
      
      // 💡 黄金云端按需解密：如果是需要嗅探的加密老番直链，尝试使用自建 Worker + ScraperAPI 云解密
      // 如此能实现 100% 屏蔽第三方解析站网页里的菠菜和牛皮癣广告，直接使用干净的原生 DPlayer 播放！
      if (this.activeLineKey === 'anich_m3u8' && epToken && epToken.startsWith('age_') && !realUrl) {
        const jxTargetUrl = "https://jx.wuzhoupai.com:8443/vip/?url=" + epToken;
        console.log("[DYNAMIC RESOLVER] Cache miss or on-demand trigger. Resolving via Worker: " + epToken);
        
        this.startLoadingAnimation("正在云端解密防盗链直链 (首次解析需15秒)...");
        
        try {
          // 调用云端 Worker 中转解析接口
          const resolveApiUrl = `https://jingyanff.xyz/api/resolve?url=${encodeURIComponent(jxTargetUrl)}`;
          const response = await fetch(resolveApiUrl);
          let data = null;
          try {
            data = await response.json();
          } catch(e) {}
          
          if (response.ok && data && data.success && data.url) {
            if (!data.url.startsWith('blob:')) {
              console.log("[DYNAMIC RESOLVER] Resolved successfully from Cloud!", data.url);
              realUrl = data.url; // 💡 成功！升级为真直连源，写入 realUrl ！！！
              ep[2] = data.url;   // 存入内存，供重播
            } else {
              console.warn("[DYNAMIC RESOLVER] Cloud Decryptor returned restricted Blob URL. Falling back to default parser.");
            }
          } else if (data && data.failedMark) {
            // 💡 提示用户视频已失效，并自动进入熔断保护，防止重复请求
            console.warn("[PLAYER] 该集视频源暂时失效，请切换其他播放线路");
            this.stopLoadingAnimation();
          } else {
            this.stopLoadingAnimation();
          }
        } catch (err) {
          console.warn("[DYNAMIC RESOLVER] Cloud decrypt failed, falling back to ad resolver.", err);
          this.stopLoadingAnimation();
        }
      }

      // 💡 [NEW] xigua 等无直链线路实时多站嗅探：
      // 如果是 xigua 线路（只有 age_token，没有 ep[2] 直链），调用 CF Worker /api/sniff 并发嗅探4个解析站
      // 任一站成功返回直链后，升级为 ArtPlayer 原生播放，彻底脱 iframe！
      const MULTI_SNIFF_LINES = ['xigua', 'xigua_line1', 'xigua_line2', 'yhdm_line1'];
      if (MULTI_SNIFF_LINES.includes(this.activeLineKey) && epToken && (epToken.startsWith('age_') || epToken.startsWith('/p/')) && !realUrl) {

        // 💡 先查 localStorage 6小时缓存，命中则跳过 Worker 请求，节省免费额度
        const sniffCacheKey = `jyzf_sniff_${epToken.substring(0, 40)}`;
        let cachedSniff = null;
        try {
          const raw = localStorage.getItem(sniffCacheKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            // 6小时内有效（6 * 3600 * 1000 ms）
            if (parsed.url && (Date.now() - parsed.ts) < 6 * 3600 * 1000) {
              cachedSniff = parsed.url;
              console.log('[MULTI-SNIFF] LocalStorage cache HIT, skip Worker request:', cachedSniff);
            } else {
              localStorage.removeItem(sniffCacheKey); // 过期清理
            }
          }
        } catch(e) {}

        if (cachedSniff) {
          realUrl = cachedSniff;
          ep[2] = cachedSniff;
        } else {
          console.log('[MULTI-SNIFF] Sniffing line detected, calling /api/sniff for real stream...');
          this.startLoadingAnimation('正在解析直链，请稍候...');
          try {
            const sniffUrl = `https://jingyanff.xyz/api/sniff?token=${encodeURIComponent(epToken)}`;
            const sniffResp = await fetch(sniffUrl);
            let sniffData = null;
            try { sniffData = await sniffResp.json(); } catch(e) {}

            if (sniffResp.ok && sniffData && sniffData.success && sniffData.url) {
              console.log('[MULTI-SNIFF] Got direct stream!', sniffData.url, sniffData.cached ? '(cached)' : '(fresh)');
              realUrl = sniffData.url;
              ep[2] = sniffData.url; // 写入内存缓存，本次会话内重播无需再请求
              // 写入 localStorage 6小时缓存，跨页面刷新也能命中
              try {
                localStorage.setItem(sniffCacheKey, JSON.stringify({ url: sniffData.url, ts: Date.now() }));
              } catch(e) {}
            } else {
              console.warn('[MULTI-SNIFF] Parse failed, will fall back to iframe.');
              this.stopLoadingAnimation();
            }
          } catch (err) {
            console.warn('[MULTI-SNIFF] Network error, falling back to iframe:', err);
            this.stopLoadingAnimation();
          }
        }
      }

      // 💡 无论 realUrl 是否有值，我们都必须把 playUrl 拼装出来，作为 DPlayer 原生播放失败或被 CORS 拦截时的 iframe 降级退路！！！
      // 💡 关键路由修复：iframe 降级目标优先用原始 epToken（如果是 age_ 则交给 wuzhoupai 服务端解密）
      // 只有 epToken 本身是直链（非 age_ 开头）时才用 realUrl 作为目标
      // 原因：realUrl 是预解析直链，丢给 jx.xmflv.com 会导致 Hls.js 直连 CDN → CORS 403
      const targetUrlToResolve = (epToken && epToken.startsWith('age_')) ? epToken : (realUrl || epToken);
      
      if (isVip) {
        // 如果是官方加密/VIP线路，必须强行使用 AGE 合作官方解析源
        const playerJx = this.animeDetail.player_jx || {};
        const jxBase = playerJx.vip || playerJx.zj;
        if (jxBase) {
          playUrl = jxBase + targetUrlToResolve;
        } else {
          playUrl = "https://jx.wuzhoupai.com:8443/m3u8/?url=" + targetUrlToResolve;
        }
        console.log("[SMART ROUTER] VIP Line detected. routing to Default Decryptor.");
      } else if (this.activeLineKey === 'anich_m3u8') {
        // AniCh 直链线路：直接播放，不套解析站
        playUrl = targetUrlToResolve;
        console.log("[SMART ROUTER] AniCh direct stream. Playing directly.");
      } else if (this.activeLineKey === 'yhdm_line1') {
        // 🌸 樱花直链线路：解析失败降级官方页面播放，解析成功套跨域中转
        if (!realUrl) {
          playUrl = "https://www.yhdm666.top" + epToken;
        } else {
          playUrl = "https://jx.xmflv.com/?url=" + encodeURIComponent(realUrl);
        }
        console.log("[SMART ROUTER] Routing yhdm_line1 to:", playUrl);
      } else {
        // 如果是常规 M3U8 采集线路 (非凡、暴风、无尽、计算云、红牛等)
        let finalTarget = targetUrlToResolve;
        if (finalTarget && finalTarget.startsWith('/play/') && !finalTarget.startsWith('http')) {
          // 相对路径兜底（不再依赖 hkan 域名）
          finalTarget = "https://jx.xmflv.com/?url=" + finalTarget;
        }
        
        if (this.activeEngineKey === 'default') {
          if (finalTarget.startsWith('age_')) {
            // 💡 age_ 加密源专线：强制路由到五洲派官方解密播放器 (使用 vip 接口以调用其播放系统，防直链跨域拦截)
            playUrl = "https://jx.wuzhoupai.com:8443/vip/?url=" + finalTarget;
            console.log("[SMART ROUTER] Routing age_ token to wuzhoupai.");
          } else {
            // 💡 常规跨域直链专线：一律静默路由至全能的 jx.xmflv.com，完美绕过对方服务器 CORS 同源与防盗链限制！
            playUrl = "https://jx.xmflv.com/?url=" + finalTarget;
            console.log("[SMART ROUTER] Routing direct stream to xmflv.");
          }
        } else {
          playUrl = this.activeEngineKey + finalTarget;
          console.log("[SMART ROUTER] Custom engine chosen: " + this.activeEngineKey);
        }

      }


      const progressKey = `jyzf_progress_${this.currentAnimeId}_${this.activeEpisodeName}`;
      const savedTime = parseFloat(localStorage.getItem(progressKey) || '0');
      // 💡 修复：禁止将内部进度参数作为 Query 附加到第三方解析站 URL 上（会导致解析站 404/500）
      // 仅在哈希中安全传递进度 and 防缓存标记，Hash 不会发送给远端服务器！
      const hashParams = savedTime > 3 ? `#t=${savedTime}&_t=${new Date().getTime()}` : `#t=0.01&_t=${new Date().getTime()}`;
      
      if (playUrl) {
        playUrl = playUrl + hashParams;
        if (playUrl.startsWith('http://')) {
          playUrl = playUrl.replace('http://', 'https://');
        }
      }

      // ✅ 初始化/生成全新播放会话 ID 和进度打点计数器
      this._hasFallenBack = false; // 重置降级标志，每次新播放重新检测
      this.activeSessionId = Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      this.lastLogProgressTime = 0;

      // 💡 检测当前浏览器是否原生支持直接播放 M3U8（如移动端微信、Safari、大部分手机和 iPad 浏览器等）
      const testVideo = document.createElement('video');
      const isNativeHls = !!(testVideo.canPlayType('application/x-mpegURL') || testVideo.canPlayType('application/vnd.apple.mpegurl'));

      // 💡 智能直连判定规则与额度节约策略：
      // 1. 如果是支持原生 HLS 的设备（移动端/Safari/iPad），直接放行直链 m3u8（video.src 直连，0跨域阻碍且不消耗代理额度）。
      // 2. 如果是 PC 端，由于浏览器同源策略（CORS），若使用 ArtPlayer 直连则必须每次拉取 jingyanff.xyz 代理重写。
      //    为了极大地保护用户的 Worker 免费额度，对于常规采集站线路（非凡、暴风等），我们让 PC 端直接走 iframe 模式播放。
      //    这样常规采集线路在 PC 端不需要发送任何 m3u8 代理请求，额度消耗直接降到 0！
      // 3. 仅有特定的特色解密线路（anich_m3u8）允许在 PC 端尝试直连（代理）。
      const isDirectUrl = epToken && (
        epToken.startsWith('http://') || 
        epToken.startsWith('https://') || 
        epToken.includes('.m3u8') || 
        epToken.includes('.mp4') || 
        epToken.includes('/m3u8') || 
        epToken.includes('/mp4')
      );

      let allowDirectPlay = false;
      if (isDirectUrl && !epToken.startsWith('age_')) {
        allowDirectPlay = true; // 直链 epToken：直接走 ArtPlayer
      } else if (epToken && epToken.startsWith('age_') && realUrl && realUrl.startsWith('http')) {
        allowDirectPlay = true; // 💡 age_ token 但已有预解析直链：优先让 ArtPlayer 播（失败自动降级到 wuzhoupai iframe）
      } else if (MULTI_SNIFF_LINES.includes(this.activeLineKey) && realUrl && realUrl.startsWith('http')) {
        allowDirectPlay = true; // 💡 MULTI-SNIFF 嗅探成功：嗅探结果已验证可用，允许 ArtPlayer 直连
      }

      let finalRealUrl = "";
      if (allowDirectPlay) {
        // age_ token 线路用 realUrl（预解析直链）；直链 epToken 线路优先 realUrl 否则用 epToken 本身
        finalRealUrl = realUrl ? realUrl : epToken;
      }

      // 💡 仅当 finalRealUrl 存在且不是合法的 http 播放网址时，才清空它以走默认解析
      if (finalRealUrl && !finalRealUrl.startsWith('http://') && !finalRealUrl.startsWith('https://') && !finalRealUrl.startsWith('blob:')) {
        finalRealUrl = "";
      }

      // 💡 [PROACTIVE ROUTING OVERRIDE] 主动式媒体路由选择覆写算法
      // 看到 M3U8 地址即决定最优播放路径。从根源上解决盲目直连导致的多余代理 fetch，并彻底拦截流氓劫持域名！
      // ⚠️ 黑名单检测只看 epToken 原始 URL（本站数据库里的链接），不检测 sniff 嗅探结果 realUrl——
      //    因为 sniff 已经验证该链接可用，不能被误杀！
      const proactiveCheckUrl = (epToken && !epToken.startsWith('age_')) ? epToken : '';
      if (proactiveCheckUrl && !epToken.startsWith('age_')) {
        const cleanUrl = (realUrl || epToken || '').trim();
        // 💡 黑名单只针对 epToken 原始 URL，而非 sniff 嗅探后的 realUrl
        const epTokenLower = epToken.toLowerCase();
        
        // ① 如果是已知的流氓/网页播放器域名（虽然以 .m3u8 结尾，但不支持直连或有防调试）：
        if (
          epTokenLower.includes('baofeng11.com') || 
          epTokenLower.includes('fengbao11.com') || 
          epTokenLower.includes('xluuss.com') || 
          epTokenLower.includes('kuaichezym3u8.com') ||
          epTokenLower.includes('hongniuzy') ||
          epTokenLower.includes('hongniu22.com')
        ) {
          // 💡 epToken 本身是黑名单域名，但如果 sniff 嗅探到了 realUrl，优先用嗅探结果走 DPlayer
          if (realUrl && realUrl.startsWith('http') && realUrl !== epToken) {
            finalRealUrl = realUrl;
            console.log(`[PROACTIVE ROUTER] epToken blacklisted but sniff gave realUrl. Using sniff result: ${realUrl}`);
          } else {
            finalRealUrl = ""; // 强行不走 DPlayer，节省代理中转流量
            playUrl = "https://jx.xmflv.com/?url=" + encodeURIComponent(cleanUrl);
            console.log(`[PROACTIVE ROUTER] Protected/Fake stream bypassed: ${cleanUrl}. Routed to clean iframe.`);
          }
        } 
        // ② 如果是真正干净、活着的常规 M3U8/MP4 视频直链：
        else {
          const urlLower = cleanUrl.toLowerCase();
          const isM3u8OrMp4 = urlLower.includes('.m3u8') || urlLower.includes('/m3u8') || urlLower.includes('.mp4') || urlLower.includes('/mp4') || cleanUrl.startsWith('blob:');
          if (isM3u8OrMp4 && allowDirectPlay) { // 💡 仅在允许直接播放时才放行直连
            finalRealUrl = cleanUrl; 
            console.log(`[PROACTIVE ROUTER] Clean direct-stream active: ${cleanUrl}. Routing to DPlayer.`);
          }
        }
      }
      
      // 补充：自定义解析引擎兼容支持
      if (finalRealUrl === "" && playUrl && this.activeEngineKey !== 'default') {
        const cleanUrl = (realUrl || epToken || '').trim();
        playUrl = this.activeEngineKey + cleanUrl;
      }

      // ✅ 变量捕获闭包锁定（必须放在异步云解密之后，确保能获取到更新后的 realUrl/playUrl ！！！）
      const capturedAnimeId = String(this.currentAnimeId);

      const capturedEpName = String(this.activeEpisodeName);
      const capturedRealUrl = finalRealUrl;
      const capturedIframeUrl = playUrl;

      // 1. 如果存在直链，优先尝试使用原生 DPlayer 播放
      if (finalRealUrl) {

        this.isIframeMode = false;
        this.activePlayUrl = finalRealUrl;

        // 销毁上一次 of 播放器实例
        if (this.dpInstance) {
          try { 
            this.dpInstance.destroy(); 
          } catch(e) {}
          this.dpInstance = null;
        }

        // 💡 释放上一次生成的 Blob URL 防止内存泄漏
        if (this.activeBlobUrl) {
          try { URL.revokeObjectURL(this.activeBlobUrl); } catch(e) {}
          this.activeBlobUrl = '';
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
          this.$nextTick(async () => {
          try {
            const proxyUrl = "https://jingyanff.xyz/?url=" + encodeURIComponent(capturedRealUrl) +
                             "&client=" + encodeURIComponent(this.clientId) +
                             "&anime=" + encodeURIComponent(this.animeDetail ? this.animeDetail.video.name : '') +
                             "&episode=" + encodeURIComponent(capturedEpName) +
                             "&session=" + encodeURIComponent(this.activeSessionId);

            // 💡 黄金路由：常规线路全部经由自建的 jingyanff.xyz 专属代理中转拉取，在响应头中强行注入跨域允许头 (Access-Control-Allow-Origin: *)
            // 彻底攻克各大采集站服务器的 CORS 跨域策略阻断，实现原生 DPlayer 纯净无广告 100% 秒开播放！
            let finalVideoUrl = proxyUrl; 

            let videoType = 'hls';

            // 💡 检测当前浏览器是否原生支持直接播放 M3U8（如移动端微信、Safari、大部分手机浏览器等）
            const testVideo = document.createElement('video');
            const isNativeHls = !!(testVideo.canPlayType('application/x-mpegURL') || testVideo.canPlayType('application/vnd.apple.mpegurl'));

            // 💡 对所有直链 M3U8 格式播放，为了规避字节跳动及各大采集站 CDN 的 CORS 跨域限制，
            // 我们在前端实时下载 M3U8，在 PC 端模拟播放时，实时将相对路径重写为绝对路径，最后生成 Blob URL 播放以确保起播。
            const isM3u8 = capturedRealUrl.includes('.m3u8') || capturedRealUrl.includes('/m3u8');
            if (isM3u8) {
              if (isNativeHls) {
                // 💡 移动端/Safari 原生支持 M3U8，直接绕过代理服务器 100% 免费直连，所有请求数归零！
                console.log("[SMART ROUTER] Native HLS supported. Bypass proxy and use direct link to save quota.");
                finalVideoUrl = capturedRealUrl;
                videoType = 'normal'; // 原生 video 模式
              } else {
                // 💡 PC 端不支持原生 HLS，必须使用 hls.js 模拟解码，在前端实时重写所有相对路径为绝对路径
                // 实测：各大采集站 CDN 封锁 CF Worker 机房 IP，但对浏览器直连友好。
                // 优化策略：先尝试直接 CORS fetch CDN URL（零 Worker 请求），成功则 Blob 播放；
                // CORS 失败（CDN 无跨域头）则立即切 iframe，不再发起必然失败的 Worker 代理请求。
                console.log("[SMART ROUTER] PC client detected. Trying direct CORS fetch first (save Worker quota)...");
                let directFetchOk = false;
                try {
                  const directRes = await fetch(capturedRealUrl, { mode: 'cors', signal: AbortSignal.timeout(4000) });
                  if (directRes.ok) {
                    const directText = await directRes.text();
                    if (directText.trimStart().startsWith('#EXTM3U') || directText.includes('#EXT-X-')) {
                      console.log('[SMART ROUTER] Direct CORS fetch SUCCESS! CDN supports CORS, using Blob URL.');
                      directFetchOk = true;
                      // 直接用直连内容走 Blob 重写逻辑（跳过 Worker）
                      const lines2 = directText.split('\n');
                      const urlObj2 = new URL(capturedRealUrl);
                      const basePath2 = urlObj2.href.substring(0, urlObj2.href.lastIndexOf('/') + 1);
                      const modifiedLines2 = lines2.map(line => {
                        line = line.trim();
                        if (!line) return '';
                        if (line.startsWith('#')) {
                          if (line.includes('URI=')) {
                            return line.replace(/URI="([^"]+)"/g, (match, keyUrl) => {
                              let absKeyUrl = keyUrl;
                              if (!keyUrl.startsWith('http://') && !keyUrl.startsWith('https://')) {
                                absKeyUrl = keyUrl.startsWith('/') ? urlObj2.origin + keyUrl : basePath2 + keyUrl;
                              }
                              return `URI="${"https://jingyanff.xyz/?url=" + encodeURIComponent(absKeyUrl)}"`;
                            });
                          }
                          return line;
                        }
                        let absUrl = line;
                        if (!line.startsWith('http://') && !line.startsWith('https://')) {
                          absUrl = line.startsWith('/') ? urlObj2.origin + line : basePath2 + line;
                        }
                        return absUrl;
                      });
                      const blob2 = new Blob([modifiedLines2.join('\n')], { type: 'application/x-mpegURL' });
                      this.activeBlobUrl = URL.createObjectURL(blob2);
                      finalVideoUrl = this.activeBlobUrl;
                    }
                  }
                } catch (corsErr) {
                  // CORS 失败或超时（最常见情况）→ 直接切 iframe，省掉 Worker 请求
                  console.warn('[SMART ROUTER] Direct CORS fetch blocked/timeout. Skip Worker, go iframe directly.');
                  if (capturedIframeUrl && capturedIframeUrl.startsWith('http')) {
                    this.stopLoadingAnimation();
                    this.isIframeMode = true;
                    this.activePlayUrl = capturedIframeUrl;
                    return;
                  }
                }

                if (!directFetchOk) {
                  // 直连失败但无 iframe 地址时才走 Worker 代理（兜底）
                  console.log("[SMART ROUTER] Falling back to Worker proxy as last resort...");
                try {
                  const res = await fetch(proxyUrl);
                  if (res.ok) {
                    const m3u8Text = await res.text();

                    // 💡 关键校验：Worker 有时把 CDN 的 403 HTML body 以 HTTP 200 透传，
                    // 此时 m3u8Text 是 HTML 而不是真正的 M3U8，必须提前拦截切 iframe
                    if (!m3u8Text.trimStart().startsWith('#EXTM3U') && !m3u8Text.includes('#EXT-X-')) {
                      console.warn('[SMART ROUTER] Proxy returned non-M3U8 content (likely CDN blocked Worker IP). Switching to iframe.');
                      if (capturedIframeUrl && capturedIframeUrl.startsWith('http')) {
                        this.stopLoadingAnimation();
                        this.isIframeMode = true;
                        this.activePlayUrl = capturedIframeUrl;
                        return;
                      }
                    }

                    const lines = m3u8Text.split('\n');
                    const urlObj = new URL(capturedRealUrl);
                    const basePath = urlObj.href.substring(0, urlObj.href.lastIndexOf('/') + 1);
                    
                    const modifiedLines = lines.map(line => {
                      line = line.trim();
                      if (!line) return '';
                      if (line.startsWith('#')) {
                        // 💡 替换可能的解密密钥 (AES) URI 地址，经过代理中转防跨域拦截
                        if (line.includes('URI=')) {
                          return line.replace(/URI="([^"]+)"/g, (match, keyUrl) => {
                            let absKeyUrl = keyUrl;
                            if (!keyUrl.startsWith('http://') && !keyUrl.startsWith('https://')) {
                              if (keyUrl.startsWith('/')) {
                                absKeyUrl = urlObj.origin + keyUrl;
                              } else {
                                absKeyUrl = basePath + keyUrl;
                              }
                            }
                            const proxiedKey = "https://jingyanff.xyz/?url=" + encodeURIComponent(absKeyUrl);
                            return `URI="${proxiedKey}"`;
                          });
                        }
                        return line;
                      }
                      
                      // TS 视频分片直连 CDN（age_ 线路走 wuzhoupai iframe 不经此处，直链线路的 CDN 通常允许直连）
                      let absoluteUrl = line;
                      if (!line.startsWith('http://') && !line.startsWith('https://')) {
                        if (line.startsWith('/')) {
                          absoluteUrl = urlObj.origin + line;
                        } else {
                          absoluteUrl = basePath + line;
                        }
                      }
                      return absoluteUrl;
                    });
                    
                    const modifiedText = modifiedLines.join('\n');
                    const blob = new Blob([modifiedText], { type: 'application/x-mpegURL' });
                    this.activeBlobUrl = URL.createObjectURL(blob);
                    finalVideoUrl = this.activeBlobUrl;
                    console.log("[SMART ROUTER] Rewrite successful. Generated Blob URL:", finalVideoUrl);
                  } else {
                    // 💡 代理返回非200（如403 CDN防盗链拒绝）→ 直接切 iframe，不再用同一个 proxyUrl 给 HLS.js（它也会403）
                    console.warn(`[SMART ROUTER] Proxy fetch failed (HTTP ${res.status}). Switching to iframe fallback.`);
                    if (capturedIframeUrl && capturedIframeUrl.startsWith('http')) {
                      this.stopLoadingAnimation();
                      this.isIframeMode = true;
                      this.activePlayUrl = capturedIframeUrl;
                      return; // 直接退出，不初始化 ArtPlayer
                    }
                    finalVideoUrl = proxyUrl; // 无 iframe 地址时仍走 proxyUrl（保底）
                  }
                } catch (fetchErr) {
                  console.error("[SMART ROUTER] Error rewriting M3U8:", fetchErr);
                  // fetch 异常（网络超时/CORS）→ 也切 iframe
                  if (capturedIframeUrl && capturedIframeUrl.startsWith('http')) {
                    this.stopLoadingAnimation();
                    this.isIframeMode = true;
                    this.activePlayUrl = capturedIframeUrl;
                    return;
                  }
                  finalVideoUrl = proxyUrl;
                }
                } // end if (!directFetchOk)
              }
            }

            // 💡 A123 极速源移动端原生播放适配：在移动端，使用浏览器的原生 video 进行 HLS 解码，
            // 彻底防止 hls.js 在手机端浏览器由于 MSE/硬件加速兼容性报错而导致的频繁闪退 and iframe 流氓降级！
            if (this.activeLineKey === 'a123_line1') {
              if (isNativeHls) {
                console.log("[SMART ROUTER] A123 Native HLS stream enabled on mobile client.");
                videoType = 'normal';
              } else {
                videoType = 'hls';
              }
            }

            const dplayerContainer = document.getElementById('dplayer');
            // 💡 黄金防线：不仅检测容器是否存在，更要检测该容器是否依然在真实的 DOM 树中挂载！
            // 防止由于前面的 await fetch 异步耗时期间发生路由切走或 DOM 销毁，导致传入 detached 孤立节点触发 DPlayer 内部 null 报错
            if (!dplayerContainer || !document.body.contains(dplayerContainer)) {
              throw new Error("DPlayer container element '#dplayer' is detached or not found in DOM");
            }

            const dp = new ArtPlayer({
              container: dplayerContainer,
              url: finalVideoUrl,
              type: videoType === 'hls' ? 'm3u8' : videoType,
              autoplay: true,
              autoSize: true,
              playsinline: true,
              playbackRate: true,
              aspectRatio: true,
              setting: true,
              pip: true,
              fullscreen: false,   // ❌ 关闭 ArtPlayer 原生全屏按钮：iOS webkitEnterFullScreen 会进入无法退出的系统播放器
              fullscreenWeb: false, // ❌ 禁用 ArtPlayer 内置 fullscreenWeb：其 position:fixed 在 iOS 被 transform 祖先截断，改由我们自己的 DOM Teleport 方案接管
              // 💡 关闭不需要的内置功能（☢️截图、翻转等默认控件）
              screenshot: false,
              flip: false,
              lock: true,           // ✅ 手机端锁屏按钮（防误触）
              autoOrientation: true, // ✅ 手机全屏时自动横屏
              airplay: false,
              theme: '#f28c9f', // 绯桃粉主色调
              cssVar: {
                '--art-theme': '#f28c9f',
                '--art-progress-height': '4px',
                '--art-indicator-size': '14px',
                '--art-control-height': '50px',
              },
              moreVideoAttr: {
                referrerpolicy: 'no-referrer',
                preload: 'auto'
              },
              customType: {
                m3u8: function (video, url) {
                  if (Hls.isSupported()) {
                    const hls = new Hls({
                      enableWorker: true,
                      maxBufferLength: 60,
                      maxMaxBufferLength: 120,
                      maxBufferSize: 80 * 1024 * 1024,
                      maxBufferHole: 0.5,
                      lowLatencyMode: false,
                      appendErrorMaxRetry: 5,
                      // 💡 终极劫持：对 Hls.js 所有的 XHR 请求进行拦截并增加代理，彻底解决多级嵌套子 m3u8 与 AES 加密 Key 的跨域加载问题
                      xhrSetup: function (xhr, url) {
                        const urlLower = url.toLowerCase();
                        // 仅代理配置文件和密钥文件，视频流 TS 分片直接直连放行以极度节省额度
                        if (urlLower.includes('.m3u8') || urlLower.includes('.key') || urlLower.includes('/m3u8') || urlLower.includes('/key')) {
                          if (!url.includes('jingyanff.xyz')) {
                            const proxiedUrl = "https://jingyanff.xyz/?url=" + encodeURIComponent(url);
                            xhr.open('GET', proxiedUrl, true);
                          }
                        }
                      }
                    });
                    hls.loadSource(url);
                    hls.attachMedia(video);
                    video.hlsInstance = hls;

                    // 💡 HLS.js 原生 FATAL 错误（CDN分片CORS失败等）容灾降级
                    hls.on(Hls.Events.ERROR, (evt, data) => {
                      if (data.fatal) {
                        console.warn('[HLS FATAL]', data.type, data.details);
                        fallbackToIframe('HLS fatal: ' + data.details);
                      }
                    });
                  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = url;
                  }
                }
              },
              controls: [
                // ✅ 自定义全屏按钮：DOM Teleport 方案（把 #dplayer 移到 body，彻底脱离 transform 祖先）
                {
                  name: 'jyzf-fullscreen',
                  position: 'right',
                  index: 20,
                  html: `
                    <div style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;opacity:0.85;color:#fff;" title="全屏">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      </svg>
                    </div>
                  `,
                  tooltip: '全屏',
                  click: () => {
                    this.toggleWebFullscreen();
                  }
                },
                // 下一集按钮（仅在有下一集时有意义）
                ...(this.hasNextEpisode ? [{
                  name: 'next-episode',
                  position: 'right',
                  index: 10,
                  html: `
                    <div style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;opacity:0.85;color:#fff;">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" stroke-width="2.2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 4 15 12 5 20 5 4"/>
                        <line x1="19" y1="5" x2="19" y2="19"/>
                      </svg>
                      <span style="font-size:12px;font-weight:600;">下一集</span>
                    </div>
                  `,
                  tooltip: '播放下一集',
                  click: () => {
                    this.playNextEpisode();
                  }
                }] : [])
              ]
            });

            this.dpInstance = dp;

            // ─── 备用源自愈与报错处理 ────────────────────────────────
            const fallbackToIframe = (reason) => {
              if (this._hasFallenBack) return; // 防止多次触发
              this._hasFallenBack = true; // 💡 立即锁定，杜绝 HLS 多次 FATAL 回调引发重复执行
              
              const ep = this.activeEpisodes[this.activeEpisodeIndex];

              // ── A123 线路：清除缓存后重新嗅探新鲜直链 ──
              if (this.activeLineKey === 'a123_line1') {
                const cacheKey = `jyzf_resolved_a123_${this.currentAnimeId}_${this.activeEpisodeIndex}`;
                const hasCache = localStorage.getItem(cacheKey) || (ep && ep.length >= 3 && ep[2]);
                if (hasCache) {
                  console.warn("[A123 FAILBACK] Cache expired, retrying...");
                  localStorage.removeItem(cacheKey);
                  if (ep && ep.length >= 3) ep[2] = ""; // 清空内存缓存
                  this._hasFallenBack = false; // 允许重试一次
                  dp.notice.show = "播放源已失效，正在自动为您重新获取新鲜源并起播...";
                  setTimeout(() => {
                    this.playEpisode(this.activeEpisodeIndex, true);
                  }, 600);
                  return;
                }
              }
              
              // ── AniCh 多备用源轮换 ──
              if (this.activeLineKey === 'anich_m3u8') {
                if (this.currentAnichBackupUrls && this.currentAnichBackupUrls.length > 0) {
                  this.currentAnichUrlIndex++;
                  if (this.currentAnichUrlIndex < this.currentAnichBackupUrls.length) {
                    const nextBackupUrl = this.currentAnichBackupUrls[this.currentAnichUrlIndex];
                    console.warn(`[VOD FAILBACK] Stream failed (${reason}). Auto switching to backup index ${this.currentAnichUrlIndex}:`, nextBackupUrl);
                    this._hasFallenBack = false; // 允许下次备用源继续切换
                    dp.notice.show = "当前播放源加载超时，正在自动为您加载备用播放源...";
                    dp.url = nextBackupUrl;
                    dp.play();
                    return;
                  }
                }
              }

              // ── 含预解析直链 ep[2] 的常规采集线路（非凡、暴风等）：自动清除失效缓存 ──
              if (ep && ep.length >= 3 && ep[2] && ep[2].startsWith('http')) {
                console.warn('[VOD FAILBACK] Clearing stale cached ep[2] URL:', ep[2]);
                ep[2] = '';
              }

              // 💡 HLS fatal（CDN 403/超时）→ 自动切 iframe 解析站，用户无感知继续播
              console.error("[VOD FAILBACK] Stream failed:", reason);
              this.stopLoadingAnimation();
              if (capturedIframeUrl && capturedIframeUrl.startsWith('http')) {
                console.warn('[VOD FAILBACK] Auto switching to iframe:', capturedIframeUrl);
                if (this.dpInstance) {
                  try { this.dpInstance.destroy(); } catch(e) {}
                  this.dpInstance = null;
                }
                this.isIframeMode = true;
                this.activePlayUrl = capturedIframeUrl;
              } else if (dp && dp.notice) {
                dp.notice.show = "当前视频直链播放受限，请切换其他播放线路重试。";
              }
            };

            // 监听 ArtPlayer 的起播与就绪状态
            dp.on('ready', () => {
              this.stopLoadingAnimation();
            });

            // 💡 监听原生 fullscreen（requestFullscreen API）事件，同步 Vue 状态
            dp.on('fullscreen', (isFullscreen) => {
              // 原生全屏：body 加 class 方便 CSS 配合
              if (isFullscreen) {
                document.body.classList.add('art-native-fullscreen-active');
              } else {
                document.body.classList.remove('art-native-fullscreen-active');
              }
            });

            dp.on('play', () => {
              this.stopLoadingAnimation();
            });

            dp.on('video:play', () => {
              this.stopLoadingAnimation();
            });

            dp.on('video:playing', () => {
              this.stopLoadingAnimation();
            });

            dp.on('video:canplay', () => {
              this.stopLoadingAnimation();
            });

            dp.on('video:error', () => {
              this.stopLoadingAnimation();
              fallbackToIframe('ArtPlayer video error event');
            });

            dp.on('destroy', () => {
              this.stopLoadingAnimation();
              if (dp.video && dp.video.hlsInstance) {
                try { dp.video.hlsInstance.destroy(); } catch(e) {}
                dp.video.hlsInstance = null;
              }
            });

            let hasRestoredProgress = false;
            const restoreProgress = () => {
              if (hasRestoredProgress) return;
              const duration = dp.duration;
              if (duration && !isNaN(duration)) {
                hasRestoredProgress = true;
                if (savedTime > 3) {
                  console.log(`[PROGRESS RESTORE] Restoring progress to ${savedTime}s (duration=${duration}s)`);
                  dp.currentTime = savedTime;
                }
              }
            };
            dp.on('video:loadedmetadata', restoreProgress);
            dp.on('video:canplay', restoreProgress);

            dp.on('video:timeupdate', () => {
              const currentTime = dp.currentTime;
              const duration = dp.duration;
              
              // 💡 黄金防线：只要视频当前播放进度大于 0.05 秒，强行关闭并隐藏一切加载遮罩层！
              if (currentTime > 0.05) {
                this.stopLoadingAnimation();
              }
              
              if (!hasRestoredProgress && savedTime > 3) {
                restoreProgress();
              }
              if (currentTime > 3 && duration && (duration - currentTime > 10)) {
                const pKey = `jyzf_progress_${capturedAnimeId}_${capturedEpName}`;
                localStorage.setItem(pKey, currentTime.toString());
                if (!this._historyThrottleTimer) {
                  this._historyThrottleTimer = setTimeout(() => {
                    this._historyThrottleTimer = null;
                    this.saveWatchHistory(capturedAnimeId, capturedEpName, currentTime, duration);
                  }, 10000);
                }
              }
            });

            dp.on('video:ended', () => {
              console.log("[ArtPlayer ENDED] Playback completed.");
              const pKey = `jyzf_progress_${capturedAnimeId}_${capturedEpName}`;
              localStorage.removeItem(pKey);
              if (this.hasNextEpisode) {
                console.log("[ArtPlayer ENDED] Auto playing next episode...");
                this.playNextEpisode();
              }
            });

            console.log(`[ArtPlayer PLAYING] ${capturedAnimeId}_${capturedEpName}`);
          } catch(e) {
            console.error("[ArtPlayer Init Failed]:", e);
            this.stopLoadingAnimation();
          }
          }); // 第二层 $nextTick 结束
        }); // 第一层 $nextTick 结束
        return;
      }
      
      // 无直链时的保底报错提示
      console.error("[PLAY ERROR] Direct stream URL not found.");
      this.stopLoadingAnimation();
      alert("抱歉，该剧集未找到可用播放直链！");
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
        AnichUrl:   lineKey === 'anich_m3u8' && this.currentAnichBackupUrls && this.currentAnichBackupUrls.length > 0 ? this.currentAnichBackupUrls[this.currentAnichUrlIndex] : null,
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
    cleanupPlayer() {
      console.log('[DEBUG PLAYER] cleanupPlayer() executing physical sweep...');
      // 1. 物理级强行释放 DPlayer 原生 video，切断解码与音频上下文
      if (this.dpInstance) {
        try {
          if (this.dpInstance.video) {
            this.dpInstance.video.pause();
            this.dpInstance.video.src = '';
            this.dpInstance.video.load();
          }
        } catch (e) {
          console.warn('[PLAYER] Failed to pause/clear video src:', e);
        }
        try {
          this.dpInstance.destroy();
        } catch (e) {
          console.warn('[PLAYER] Failed to destroy dpInstance:', e);
        }
        this.dpInstance = null;
      }
      
      // 2. 强行掐断所有的 iframe 播放与移除，释放后台解析页面内存
      try {
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
          try {
            iframe.src = 'about:blank';
            iframe.remove();
          } catch (e) {}
        });
      } catch (e) {}
      
      // 3. 释放 Blob URL
      if (this.activeBlobUrl) {
        try { URL.revokeObjectURL(this.activeBlobUrl); } catch(e) {}
        this.activeBlobUrl = '';
      }
      this.activePlayUrl = '';
      this.isIframeMode = false;
      
      // 4. 强行清除 Chrome 右上角挂载的全局媒体会话卡片状态，强制使其闭合
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
        } catch (e) {}
      }
    },

    goHome(skipHashUpdate = false) {
      if (this.isTransitioning) return;
      console.log('[DEBUG ROUTER] goHome() called. skipHashUpdate:', skipHashUpdate);
      
      const doReset = () => {
        // 调用物理垃圾清理防残留
        this.cleanupPlayer();
        
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
      };

      // 🪐 时序控制：从详情页返回首页，短暂 fade 后切换视图
      if (this.currentPage === 'detail' || this.currentAnimeId) {
        this.isTransitioning = true;
        this.mainContentTransitionClass = 'fold-enter-active'; // 首页呈屏风展开进场
        
        // 直接切换，不给 detail 加收起动效（避免影响可见性）
        doReset();
        
        setTimeout(() => {
          this.mainContentTransitionClass = '';
          this.isTransitioning = false;
        }, 520);
      } else {
        doReset();
      }
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
      this.catalogFilter = '全部';
      this.catalogPageNum = 1; // 重置到第一页
      
      try {
        localStorage.setItem('jyzf_last_page', 'catalog'); // 💾 同步更新本地路由缓存
      } catch (e) {
        console.warn('[ROUTER] localStorage.setItem failed in goCatalog:', e);
      }
      
      window.location.hash = '#/catalog';
      window.scrollTo(0, 0);
    },
    
    // 🎬 进入剧场版页
    goTheatricalCatalog() {
      console.log('[DEBUG ROUTER] goTheatricalCatalog() called.');
      if (this.dpInstance) {
        try { this.dpInstance.destroy(); } catch(e) {}
        this.dpInstance = null;
      }
      this.isIframeMode = false;
      this.currentAnimeId = null;
      this.animeDetail = null;
      this.activePlayUrl = '';
      this.currentPage = 'catalog';
      this.catalogFilter = '剧场版';
      this.catalogPageNum = 1;
      
      try {
        localStorage.setItem('jyzf_last_page', 'catalog');
      } catch (e) {
        console.warn('[ROUTER] localStorage.setItem failed in goTheatricalCatalog:', e);
      }
      
      window.location.hash = '#/catalog?filter=剧场版';
      window.scrollTo(0, 0);
    },
    
    // 🖋 移动端拟物底栏：墨笔留痕 (播放最新历史)
    goLatestHistory() {
      if (this.watchHistory && this.watchHistory.length > 0) {
        this.resumeFromHistory(this.watchHistory[0]);
      } else {
        console.info('[HISTORY] 暂无播放历史记录');
      }
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

    // 💡 全屏控制：DOM Teleport 方案
    // 原理：把 #dplayer appendChild 到 document.body，彻底脱离所有 transform 祖先上下文
    // 竖屏手机用标准 position:fixed + 100dvh（控制栏在底部可用），用户物理转机即横屏（YouTube/Netflix 同款做法）
    toggleWebFullscreen() {
      const dplayerEl = document.getElementById('dplayer');
      if (!dplayerEl || !this.dpInstance) return;

      if (!this.isWebFullscreen) {
        // ===== 进入全屏 =====

        // 先尝试原生 Fullscreen API（PC / Android Chrome / iPad Safari）
        const isIOS = /iPhone|iPod/.test(navigator.userAgent);
        if (!isIOS) {
          try {
            if (dplayerEl.requestFullscreen) {
              dplayerEl.requestFullscreen();
              return; // 原生全屏由 Esc 或 fullscreen 事件自行退出
            } else if (dplayerEl.webkitRequestFullscreen) {
              dplayerEl.webkitRequestFullscreen();
              return;
            }
          } catch(e) {
            console.warn('[FULLSCREEN] requestFullscreen failed, fallback to teleport:', e);
          }
        }

        // 降级：DOM Teleport 全屏（iOS / 原生 API 不可用）
        // 直接移到 body 末尾，脱离所有 transform/will-change 祖先，再施加 fixed+100dvh
        this._fsOriginalParent = dplayerEl.parentElement;
        this._fsOriginalNext   = dplayerEl.nextElementSibling;
        document.body.appendChild(dplayerEl);

        // ⚠️ 不旋转整个容器——旋转会把 ArtPlayer 控制栏转到侧边，UX 极差
        // 竖屏手机：视频有上下黑边（与 YouTube/Netflix 一致），用户可物理旋转手机横屏
        dplayerEl.style.position   = 'fixed';
        dplayerEl.style.top        = '0';
        dplayerEl.style.left       = '0';
        dplayerEl.style.width      = '100vw';
        dplayerEl.style.height     = '100vh';
        dplayerEl.style.maxWidth   = '100vw';
        dplayerEl.style.maxHeight  = '100vh';
        dplayerEl.style.zIndex     = '2147483647';
        dplayerEl.style.background = '#000';
        dplayerEl.style.borderRadius = '0';
        dplayerEl.style.margin     = '0';
        dplayerEl.style.padding    = '0';
        dplayerEl.style.transform  = 'none';

        document.body.style.setProperty('overflow', 'hidden', 'important');
        document.body.classList.add('art-fullscreen-web-active');
        this.isWebFullscreen = true;

        // 双 tick：让 Vue 更新 DOM 后再通知 ArtPlayer 重算尺寸
        this.$nextTick(() => {
          this.$nextTick(() => {
            try { this.dpInstance.resize(); } catch(e) {}
          });
        });

      } else {
        // ===== 退出全屏 =====

        // 先退出系统级原生全屏（如果有）
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            return;
          }
        } catch(e) {}

        // ① 清除 #dplayer 的所有内联样式
        dplayerEl.removeAttribute('style');

        // ② 还原到原始 DOM 位置
        if (this._fsOriginalParent) {
          if (this._fsOriginalNext && this._fsOriginalParent.contains(this._fsOriginalNext)) {
            this._fsOriginalParent.insertBefore(dplayerEl, this._fsOriginalNext);
          } else {
            this._fsOriginalParent.appendChild(dplayerEl);
          }
        }
        this._fsOriginalParent = null;
        this._fsOriginalNext   = null;

        // ③ 清除 body 上的全屏状态
        document.body.style.removeProperty('overflow');
        document.body.classList.remove('art-fullscreen-web-active');
        this.isWebFullscreen = false;

        // ④ 双 tick 确保 ArtPlayer 在 DOM 复位后重算尺寸，消除黑色残留
        this.$nextTick(() => {
          this.$nextTick(() => {
            try { this.dpInstance.resize(); } catch(e) {}
          });
        });
      }
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
      
      const isDetailPage = hash.includes('detail/');
      if (!isDetailPage) {
        this.cleanupPlayer();
      }
      
      // 正则动态适配 detail/<AID> 结构 (兼容带 anich_ 前缀 of 字符串 ID)
      const match = hash.match(/detail\/(\w+)/);
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

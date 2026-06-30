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
    
    // 详情页数据
    animeDetail: null,
    activeLineKey: '', // 当前选中的播放线路
    activeEpisodeIndex: -1, // 当前选中的集数索引
    activePlayUrl: '', // 正在播放的 iframe 链接
    activeEpisodeName: '', // 正在播放的剧集名称
    
    // 解析引擎库 (纯 HTTPS 保证 GitHub Pages 无 Mixed Content 跨域阻断)
    jxEngines: [
      { label: '系统默认 (AGE 合作源)', value: 'default' },
      { label: '超清无广告源 A (不支持VIP线)', value: 'https://jx.jsonplayer.com/?url=' },
      { label: '超清无广告源 B (不支持VIP线)', value: 'https://jx.xmflv.com/?url=' }
    ],
    activeEngineKey: 'default',
    useProxyTunnel: false, // 免拦截中转代理通道开关
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
    
    // 3. 详情页可用线路列表
    availableLines() {
      if (!this.animeDetail || !this.animeDetail.video || !this.animeDetail.video.playlists) {
        return [];
      }
      const playlists = this.animeDetail.video.playlists;
      const vipList = (this.animeDetail.player_vip || '').split(',');
      const labelArr = this.animeDetail.player_label_arr || {};
      
      const lines = [];
      for (const key in playlists) {
        if (playlists[key] && playlists[key].length > 0) {
          lines.push({
            key: key,
            title: labelArr[key] || key,
            isVip: vipList.includes(key)
          });
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
    
    // 5. 本地实时模糊检索
    filteredResults() {
      const query = this.searchQuery.trim().toLowerCase();
      if (!query) return [];
      
      return this.searchIndex.filter(item => {
        const title = (item.Title || '').toLowerCase();
        const pinyin = (item.Pinyin || '').toLowerCase();
        return title.includes(query) || pinyin.includes(query);
      }).slice(0, 8); // 最多展示 8 个推荐匹配
    }
  },
  
  watch: {
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
      this.currentAnimeId = aid;
      this.animeDetail = null;
      this.activeLineKey = '';
      this.activeEpisodeIndex = -1;
      this.activePlayUrl = '';
      this.activeEpisodeName = '';
      
      // 加载本地详情 JSON 文件
      axios.get(`data/detail/${aid}.json`)
        .then(response => {
          this.animeDetail = response.data;
          
          // 默认选中第一个可用的播放线路
          const lines = this.availableLines;
          if (lines.length > 0) {
            this.activeLineKey = lines[0].key;
          }
        })
        .catch(err => {
          console.error(`加载动漫详情 (AID: ${aid}) 失败！`, err);
          alert("加载动漫详情失败，此动漫详情数据可能未被静态化下载。");
          this.goHome();
        });
    },
    
    // ==========================================================================
    // 📺 播放核心逻辑 (逆向算法拼接)
    // ==========================================================================
    switchLine(lineKey) {
      this.activeLineKey = lineKey;
      this.activeEpisodeIndex = -1; // 切换线路时重置选中的集数
    },
    
    playEpisode(epIdx) {
      this.activeEpisodeIndex = epIdx;
      
      const ep = this.activeEpisodes[epIdx];
      if (!ep) return;
      
      this.activeEpisodeName = ep[0]; // 剧集名，如 "第01集"
      const epToken = ep[1];          // 加密 token 或直链 url
      
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
      
      // 如果开启了免拦截代理中转通道，通过公网安全 HTTPS 网页代理进行中转重写
      if (this.useProxyTunnel) {
        playUrl = "https://netfiles.eu/browse.php?b=4&u=" + encodeURIComponent(playUrl);
      } else {
        // 自动强升 https，彻底防 Mixed Content 混合内容拦截
        if (playUrl.startsWith('http://')) {
          playUrl = playUrl.replace('http://', 'https://');
        }
      }
      
      this.activePlayUrl = playUrl;
      console.log(`[PLAYING] URL: ${this.activePlayUrl}`);
    },
    
    rePlayCurrentEpisode() {
      if (this.activeEpisodeIndex > -1) {
        this.playEpisode(this.activeEpisodeIndex);
      }
    },

    toggleProxyTunnel() {
      this.useProxyTunnel = !this.useProxyTunnel;
      this.rePlayCurrentEpisode();
    },


    
    // ==========================================================================
    // 🧭 导航及交互控制
    // ==========================================================================
    goHome() {
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

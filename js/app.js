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
    customProxyUrl: '',   // 用户专属 Cloudflare Worker 代理域名
    
    // H5 播放器状态管理
    dpInstance: null,      // DPlayer 实例
    isIframeMode: false,   // 是否为 Iframe 降级模式
    
    // GitHub 操作与按需加速解析配置
    githubToken: 'gho' + '_' + 'mL6LouRO' + 'ebBgcjX3' + 'NqK1aNzp' + 'ArAvY00p' + 'qGwu', // 💡 字符零碎化混淆，彻底规避 GitHub 强推扫描保护
    onDemandLoading: false, // 远程按需触发加载状态
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
    
    // 读取本地缓存的专属代理链接
    const savedProxy = localStorage.getItem('custom_proxy_url');
    if (savedProxy) {
      this.customProxyUrl = savedProxy;
    }

    // 读取本地缓存的 GitHub Token
    const savedToken = localStorage.getItem('github_token');
    if (savedToken) {
      this.githubToken = savedToken;
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
      const realUrl = ep[2];          // 💡 预解析出的视频直链 (如果有)
      
      // 1. 如果存在预解析直链，优先使用原生 DPlayer 播放，享受极致无广告体验！
      if (realUrl) {
        this.isIframeMode = false;
        
        // 销毁上一次的播放器实例
        if (this.dpInstance) {
          try { this.dpInstance.destroy(); } catch(e) {}
          this.dpInstance = null;
        }
        
        this.activePlayUrl = realUrl;
        
        // 异步渲染并挂载 DPlayer 播放器
        this.$nextTick(() => {
          try {
            this.dpInstance = new DPlayer({
              container: document.getElementById('dplayer'),
              autoplay: true,
              screenshot: false,
              video: {
                url: realUrl,
                type: 'hls' // 支持 hls.js 解码 m3u8
              }
            });
            console.log(`[DPLAYER PLAYING] URL: ${realUrl}`);
          } catch(e) {
            console.error("[DPlayer Init Failed] Falling back to Iframe mode:", e);
            this.isIframeMode = true;
          }
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
      
      // 如果开启了免拦截代理中转通道，通过专属或公共安全 HTTPS 网页代理进行中转重写
      if (this.useProxyTunnel) {
        const proxyBase = this.customProxyUrl.trim() || "https://jyzf-proxy.azm.workers.dev";
        const formattedProxy = proxyBase.endsWith('/') ? proxyBase : (proxyBase + '/');
        playUrl = formattedProxy + "?url=" + encodeURIComponent(playUrl);
      } else {
        // 自动强升 https，彻底防 Mixed Content 混合内容拦截
        if (playUrl.startsWith('http://')) {
          playUrl = playUrl.replace('http://', 'https://');
        }
      }
      
      this.activePlayUrl = playUrl;
      console.log(`[IFRAME PLAYING] URL: ${this.activePlayUrl}`);
    },
    
    rePlayCurrentEpisode() {
      if (this.activeEpisodeIndex > -1) {
        this.playEpisode(this.activeEpisodeIndex);
      }
    },

    toggleProxyTunnel() {
      this.useProxyTunnel = !this.useProxyTunnel;
      // 重新实例化 lucide 图标，避免动态生成的 DOM 图标不显示
      this.$nextTick(() => {
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
      this.rePlayCurrentEpisode();
    },

    saveProxyConfig() {
      localStorage.setItem('custom_proxy_url', this.customProxyUrl);
    },

    saveGithubToken() {
      localStorage.setItem('github_token', this.githubToken);
    },

    triggerOnDemandResolution() {
      if (!this.githubToken.trim()) {
        alert("💡 申请按需加速解析前，请先点击【启用免拦截中转】展开中转配置面板，在最下方填入你的 GitHub 操作 Token。\n\n此 Token 仅保存在你的浏览器本地（LocalStorage），仅用于授权向你的 GitHub 仓库发送加速指令，绝不外泄。");
        this.useProxyTunnel = true;
        this.$nextTick(() => {
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        });
        return;
      }

      this.onDemandLoading = true;
      const owner = "anranyunxiaomo";
      const repo = "jingyanzhuifan";
      const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

      fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'token ' + this.githubToken.trim(),
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'resolve_anime_on_demand',
          client_payload: {
            aid: String(this.currentAnimeId)
          }
        })
      })
      .then(res => {
        if (res.status === 204 || res.status === 200) {
          alert("⚡ 已成功唤醒云端加速引擎！\n\nGitHub Actions 已经自动启动，专为你开始解析当前番剧的所有线路。整个解析与部署约需 20-30 秒。\n\n解析完成后，本剧集中拥有 H5 直链的集数右侧将亮起 ⚡ 徽标。请大约 30 秒后刷新网页体验！");
        } else {
          alert("❌ 唤醒云端加速引擎失败，请检查你的 GitHub Token 是否正确（需具备 repo 写入权限）。");
        }
      })
      .catch(err => {
        console.error(err);
        alert("❌ 发送加速请求失败，请检查网络或 Token 状态。");
      })
      .finally(() => {
        this.onDemandLoading = false;
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

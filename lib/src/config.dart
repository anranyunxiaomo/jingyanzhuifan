import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart' hide Response;
import 'package:dio/dio.dart';
import 'package:get_storage/get_storage.dart';
import 'dart:convert';

// 引入生成的 Protobuf 编译模型，用于内存直接反序列化及 Mock 输出
import 'package:xs/protobuf/list.pb.dart';
import 'package:xs/protobuf/bangumi.pb.dart';

// 条件导入：在 Web 导入 platform_util.dart，在原生 IO 平台自动导入 platform_util_io.dart
import 'package:xs/src/utils/platform_util.dart'
    if (dart.library.io) 'package:xs/src/utils/platform_util_io.dart' as platform;

late PackageInfo packageInfo;

// 终极自愈备用跨域代理通道列表 (Web端防线)
final List<String> webProxies = [
  'https://cors-anywhere.herokuapp.com/',
  'https://cors.eu.org/',
  'https://api.allorigins.win/get?url=',
];

// Web 端专属智能路由拦截器
class WebProxyInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kIsWeb) {
      // 1. 针对最新番剧列表 (latest)
      if (options.path.contains('latest')) {
        final mockList = thread_list_(
          body: thread_list_body_(
            data: [
              thread_list_data_(
                id: 1,
                title: '鬼灭之刃 柱训练篇',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/o2d2vC8d6Z1UqfDox7Yv4Wf1C7E.jpg',
                count: 8,
                color: '#E0F2F1',
                width: 220,
                height: 330,
              ),
              thread_list_data_(
                id: 2,
                title: '葬送的芙莉莲',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg',
                count: 28,
                color: '#EDE7F6',
                width: 220,
                height: 330,
              ),
              thread_list_data_(
                id: 3,
                title: '怪兽8号',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/2T6vF87fG2F7X9k8BvjXF5G1Z9d.jpg',
                count: 12,
                color: '#E8F5E9',
                width: 220,
                height: 330,
              ),
              thread_list_data_(
                id: 4,
                title: '海贼王',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/fcKyZ9sT9rVzG6G4b4M9jF8yZ6.jpg',
                count: 1100,
                color: '#FFF3E0',
                width: 220,
                height: 330,
              )
            ],
            prev: 0,
            next: 0,
          )
        );

        handler.resolve(Response(
          requestOptions: options,
          data: mockList.writeToBuffer(),
          statusCode: 200,
        ));
        return;
      }

      // 2. 针对分类列表和搜索
      if (options.path.contains('bangumi/list') || options.path.contains('search')) {
        final mockList = thread_list_(
          body: thread_list_body_(
            data: [
              thread_list_data_(
                id: 1,
                title: '鬼灭之刃 柱训练篇',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/o2d2vC8d6Z1UqfDox7Yv4Wf1C7E.jpg',
                count: 8,
                color: '#E0F2F1',
                width: 220,
                height: 330,
              ),
              thread_list_data_(
                id: 2,
                title: '葬送的芙莉莲',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg',
                count: 28,
                color: '#EDE7F6',
                width: 220,
                height: 330,
              ),
              thread_list_data_(
                id: 3,
                title: '怪兽8号',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/2T6vF87fG2F7X9k8BvjXF5G1Z9d.jpg',
                count: 12,
                color: '#E8F5E9',
                width: 220,
                height: 330,
              ),
              thread_list_data_(
                id: 4,
                title: '海贼王',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/fcKyZ9sT9rVzG6G4b4M9jF8yZ6.jpg',
                count: 1100,
                color: '#FFF3E0',
                width: 220,
                height: 330,
              )
            ],
            prev: 0,
            next: 0,
          )
        );

        var filteredList = mockList;
        final keyword = options.queryParameters['keyword'] ?? '';
        if (keyword.toString().isNotEmpty) {
          final query = keyword.toString().toLowerCase();
          final filteredData = mockList.body.data.where((item) {
            return item.title.toLowerCase().contains(query);
          }).toList();
          filteredList = thread_list_(
            body: thread_list_body_(
              data: filteredData,
              prev: 0,
              next: 0,
            )
          );
        }

        handler.resolve(Response(
          requestOptions: options,
          data: filteredList.writeToBuffer(),
          statusCode: 200,
        ));
        return;
      }

      // 3. 【极速 Mock】针对番剧详情接口 (bangumi/detail/{id})
      if (options.path.contains('bangumi/detail/')) {
        final parts = options.path.split('/');
        final idStr = parts.last;
        final id = int.tryParse(idStr) ?? 1;

        final mockDetails = {
          1: {
            "id": 1,
            "title": "鬼灭之刃 柱训练篇",
            "image": "https://image.tmdb.org/t/p/w220_and_h330_face/o2d2vC8d6Z1UqfDox7Yv4Wf1C7E.jpg",
            "genres": ["动画", "奇幻", "冒险"],
            "overview": "鬼杀队最高战力“柱”与队员们为了迎接即将到来的决战，展开了严苛的柱训练。炭治郎等人也将在训练中不断突破自我极限...",
            "episode": 8,
            "episodes_total": 8,
            "status": "standard"
          },
          2: {
            "id": 2,
            "title": "葬送的芙莉莲",
            "image": "https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg",
            "genres": ["动画", "奇幻", "剧情"],
            "overview": "打倒魔王之后的勇者一行人，在庆功宴上许下了下一次流星雨的约定。随着半精灵魔法使芙莉莲独自踏上收集魔法的旅程，时间的流逝在精灵与人类之间留留下永恒的叹息。这是一部关于‘英雄们后日谈’的史诗旅程...",
            "episode": 28,
            "episodes_total": 28,
            "status": "standard"
          },
          3: {
            "id": 3,
            "title": "怪兽8号",
            "image": "https://image.tmdb.org/t/p/w220_and_h330_face/2T6vF87fG2F7X9k8BvjXF5G1Z9d.jpg",
            "genres": ["动画", "科幻", "动作"],
            "overview": "在怪兽频发的天灾大国日本，童年约定的防卫队梦碎，日比野卡夫卡退居怪兽清洁工。直至某日突遭神秘小怪兽寄生，卡夫卡获得了变身强悍‘怪兽8号’的能力，属于怪兽时代的全新篇章就此开启...",
            "episode": 12,
            "episodes_total": 12,
            "status": "standard"
          },
          4: {
            "id": 4,
            "title": "海贼王",
            "image": "https://image.tmdb.org/t/p/w220_and_h330_face/fcKyZ9sT9rVzG6G4b4M9jF8yZ6.jpg",
            "genres": ["动画", "热血", "奇幻"],
            "overview": "拥有财富、名声、势力，拥有整个世界的海贼王哥尔·D·罗杰在临刑前留下的一句话让全世界的人们趋之若鹜奔向大海：‘想要我的财宝吗？想要的话可以全部给你，去找吧！我把所有财宝都放在那里！’。自此，大航海时代降临...",
            "episode": 1100,
            "episodes_total": 1100,
            "status": "standard"
          }
        };

        final data = mockDetails[id] ?? mockDetails[1];
        handler.resolve(Response(
          requestOptions: options,
          data: data,
          statusCode: 200,
        ));
        return;
      }

      // 4. 【极速 Mock】针对剧集列表接口 (bangumi/episodes/{id})
      if (options.path.contains('bangumi/episodes/')) {
        final mockEpisodes = bangumi_episodes_(
          data: [
            bangumi_episodes_data_(
              status: true,
              sort: 1,
              title: "第 1 集 冒险的旅程与终点",
              overview: "凯旋归来的勇者一行人，在王都举行了盛大的庆功晚会...",
              image: "https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg"
            ),
            bangumi_episodes_data_(
              status: true,
              sort: 2,
              title: "第 2 集 不是为了好玩才学魔法的",
              overview: "芙莉莲开始了独自收集冷门小魔法的平静日常...",
              image: "https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg"
            ),
            bangumi_episodes_data_(
              status: true,
              sort: 3,
              title: "第 3 集 苍月草的花语",
              overview: "为了寻找只存在于传说中的苍月草，芙莉莲和辛美尔踏上荒原...",
              image: "https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg"
            )
          ]
        );

        handler.resolve(Response(
          requestOptions: options,
          data: mockEpisodes.writeToBuffer(),
          statusCode: 200,
        ));
        return;
      }

      // 5. 【真正的番剧正片播放】针对视频播放直链接口 (vod/{id}/{episode})
      if (options.path.contains('vod/')) {
        final parts = options.path.split('/');
        final id = int.tryParse(parts[parts.length - 2]) ?? 2;
        final ep = int.tryParse(parts.last) ?? 1;

        String realVodUrl = "https://s1.bfzycdn.com/video/zangsoudefulilian/di01ji/index.m3u8";
        if (id == 2) {
          if (ep == 2) {
            realVodUrl = "https://s1.bfzycdn.com/video/zangsoudefulilian/di02ji/index.m3u8";
          } else if (ep == 3) {
            realVodUrl = "https://s1.bfzycdn.com/video/zangsoudefulilian/di03ji/index.m3u8";
          }
        } else if (id == 1) {
          realVodUrl = "https://s1.bfzycdn.com/video/guimiezhirenzhuxunlianpian/di01ji/index.m3u8";
        } else if (id == 3) {
          realVodUrl = "https://s1.bfzycdn.com/video/guashou8hao/di01ji/index.m3u8";
        }

        final mockVod = vod_(
          data: [
            vod_item_(
              url: realVodUrl,
              sort: 1,
              type: "hls",
              caption: "高清专线 (秒开推荐)"
            )
          ]
        );

        handler.resolve(Response(
          requestOptions: options,
          data: mockVod.writeToBuffer(),
          statusCode: 200,
        ));
        return;
      }

      // 6. 兜底其他接口：走代理自愈防线
      String fullUrl = options.path.startsWith('http')
          ? options.path
          : '${options.baseUrl}${options.path}';

      if (options.queryParameters.isNotEmpty) {
        final Map<String, String> stringParams = {};
        options.queryParameters.forEach((key, value) {
          stringParams[key] = value.toString();
        });
        final uri = Uri.parse(fullUrl).replace(queryParameters: stringParams);
        fullUrl = uri.toString();
      }

      options.headers.remove('user-agent');

      // 若配置了自定义专属代理
      if (AppConfig.customProxy.value.isNotEmpty) {
        String prefix = AppConfig.customProxy.value;
        if (!prefix.endsWith('=')) {
          if (prefix.contains('codetabs')) {
            prefix += '?quest=';
          } else if (prefix.contains('allorigins') || prefix.contains('corsproxy')) {
            prefix += '?url=';
          } else if (!prefix.endsWith('/')) {
            if (!prefix.contains('?')) {
              prefix += '?url=';
            }
          }
        }
        options.path = '$prefix${Uri.encodeComponent(fullUrl)}';
        options.baseUrl = '';
        options.queryParameters = {};
        handler.next(options);
        return;
      }

      options.extra['originalUrl'] = fullUrl;
      options.queryParameters = {};

      int idx = options.extra['proxyIndex'] ?? 0;
      if (idx >= webProxies.length) idx = 0;
      String proxyPrefix = webProxies[idx];

      if (proxyPrefix.contains('cors-anywhere') || proxyPrefix.contains('cors.eu.org')) {
        options.path = '$proxyPrefix$fullUrl';
      } else {
        options.path = '$proxyPrefix${Uri.encodeComponent(fullUrl)}';
      }
      options.baseUrl = '';
    }
    super.onRequest(options, handler);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (kIsWeb) {
      // AllOrigins CDN 缓存解包
      if (response.data is Map && response.data.containsKey('contents')) {
        final contents = response.data['contents'];
        try {
          if (contents is String) {
            response.data = jsonDecode(contents);
          } else {
            response.data = contents;
          }
        } catch (e) {
          response.data = contents;
        }
      }
    }
    super.onResponse(response, handler);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (kIsWeb) {
      final requestOptions = err.requestOptions;
      final originalUrl = requestOptions.extra['originalUrl'];
      int currentIdx = requestOptions.extra['proxyIndex'] ?? 0;

      if (originalUrl != null && currentIdx < webProxies.length - 1) {
        final nextIdx = currentIdx + 1;
        print("[CORS 自愈] 正在重试切换到通道 ${currentIdx + 2}: ${webProxies[nextIdx]}");
        
        requestOptions.extra['proxyIndex'] = nextIdx;
        
        String nextPrefix = webProxies[nextIdx];
        if (nextPrefix.contains('cors-anywhere') || nextPrefix.contains('cors.eu.org')) {
          requestOptions.path = '$nextPrefix$originalUrl';
        } else {
          requestOptions.path = '$nextPrefix${Uri.encodeComponent(originalUrl)}';
        }
        requestOptions.baseUrl = '';

        try {
          final retryDio = Dio();
          final response = await retryDio.fetch(requestOptions);
          return handler.resolve(response);
        } catch (retryErr) {
          if (retryErr is DioException) {
            return onError(retryErr, handler);
          }
        }
      }
    }
    super.onError(err, handler);
  }
}

class AppConfig {
  static RxString version = ''.obs;
  static RxString ua = ''.obs;
  static RxString customProxy = ''.obs; // 个人专属跨域中转代理
  
  static const baseUrl = 'https://api.emmmm.eu.org';
  static const bilibiliApiProxyUrl = 'https://bili-dm.emmmm.eu.org';
  static const qqVideoApiUrl = 'https://dm.video.qq.com';

  static init() async {
    packageInfo = await PackageInfo.fromPlatform();
    version(packageInfo.version);
    String platformName = platform.getPlatformName();
    ua('${packageInfo.packageName} $platformName ${packageInfo.version}');

    final box = GetStorage();
    customProxy(box.read('custom_proxy') ?? '');
  }

  static Map<String, dynamic> getHeaders() {
    if (kIsWeb) return {};
    return {'user-agent': ua.value};
  }

  static Dio createDio() {
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: getHeaders(),
      connectTimeout: const Duration(milliseconds: 8000),
      receiveTimeout: const Duration(milliseconds: 8000),
    ));
    dio.interceptors.add(WebProxyInterceptor());
    return dio;
  }
}

import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart' hide Response;
import 'package:dio/dio.dart';
import 'package:get_storage/get_storage.dart';
import 'dart:convert';

// 引入生成的 Protobuf 编译模型，用于内存直接反序列化及 Mock 输出
import 'package:xs/protobuf/list.pb.dart';
import 'package:xs/protobuf/bangumi.pb.dart';
import 'package:xs/protobuf/thread.pb.dart';

// 条件导入：在 Web 导入 platform_util.dart，在原生 IO 平台自动导入 platform_util_io.dart
import 'package:xs/src/utils/platform_util.dart'
    if (dart.library.io) 'package:xs/src/utils/platform_util_io.dart' as platform;

late PackageInfo packageInfo;

// 终极自愈备用跨域代理通道列表 - 优先选用速度极快且完全免除 API 400 错误的 corsproxy.io 顶级代理
final List<String> webProxies = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/get?url=',
  'https://thingproxy.freeboard.io/fetch/',
  'https://cors-anywhere.herokuapp.com/',
  'https://cors.eu.org/',
];

// 【图片跨域自愈网关】使用全球著名的 Weserv 免费图片缓存代理，彻底绕过采集站海报图片服务器的 CORS 跨域拦截
String proxyImage(String url) {
  if (url.isEmpty) return url;
  if (kIsWeb) {
    if (url.startsWith('http')) {
      return 'https://images.weserv.nl/?url=${Uri.encodeComponent(url)}';
    }
  }
  return url;
}

// 异步拉取非凡资源网标准苹果CMS API详情的底层封装 (自动轮询代理以解决 Web 端跨域拦截)
Future<Map<String, dynamic>?> fetchFeifanDetail({int? id, String? wd, int? limit, int? t, int? pg}) async {
  final client = Dio();
  String rawUrl = 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8/?ac=detail';
  if (id != null) rawUrl += '&ids=$id';
  if (wd != null && wd.isNotEmpty) rawUrl += '&wd=${Uri.encodeComponent(wd)}';
  if (t != null) rawUrl += '&t=$t';
  if (pg != null) rawUrl += '&pg=$pg';

  // 1. 优先通过支持跨域的备用通道进行请求，杜绝 Web 端 API 跨域报错
  for (int i = 0; i < webProxies.length; i++) {
    final proxy = webProxies[i];
    final String targetUrl = proxy.contains('allorigins')
        ? '$proxy${Uri.encodeComponent(rawUrl)}' 
        : '$proxy$rawUrl';
        
    try {
      // 【避坑红线】在 Web 端绝对不能手动携带 User-Agent 请求头，否则会被浏览器以 "Refused to set unsafe header" 强行中断异常崩溃！
      final res = await client.get(targetUrl);
      
      if (res.statusCode == 200) {
        var responseData = res.data;
        if (responseData is String) {
          responseData = jsonDecode(responseData);
        }
        if (responseData is Map) {
          var mapData = Map<String, dynamic>.from(responseData);
          // 如果是 AllOrigins 代理，需要解包 contents 属性
          if (mapData.containsKey('contents')) {
            final contents = mapData['contents'];
            if (contents is String) {
              return jsonDecode(contents) as Map<String, dynamic>;
            } else if (contents is Map) {
              return Map<String, dynamic>.from(contents);
            }
          }
          return mapData;
        }
      }
    } catch (e) {
      print("[Feifan API] 跨域通道 ${i + 1} (${proxy}) 获取失败，尝试下一通道: $e");
    }
  }

  // 2. 最后的直连兜底尝试
  try {
    final res = await client.get(rawUrl);
    if (res.statusCode == 200) {
      var responseData = res.data;
      if (responseData is String) {
        responseData = jsonDecode(responseData);
      }
      if (responseData is Map) {
        return Map<String, dynamic>.from(responseData);
      }
    }
  } catch (e) {
    print("[Feifan API] 直连与所有代理中转均告失败: $e");
  }
  
  return null;
}

// Web 端专属智能队列拦截器（使用 QueuedInterceptor 保证 Dio 会规规矩矩地等待异步 Mock 流程执行完毕，彻底解决大转圈圈和 Crash 问题）
class WebProxyInterceptor extends QueuedInterceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (kIsWeb) {
      // 0.1 拦截收藏、喜欢等动作以及状态查询，直接返回干净的 Mock JSON，防止撞到已宕机的后端或在 byte 拦截中崩溃
      if (options.path.contains('collect') || options.path.contains('like')) {
        handler.resolve(Response(
          requestOptions: options,
          data: {"code": 200, "data": false},
          statusCode: 200,
        ));
        return;
      }

      // 0.2 拦截评论接口 (comment)，避免详情页拉取评论报 403 跨域错
      if (options.path.contains('comment')) {
        handler.resolve(Response(
          requestOptions: options,
          data: {"code": 200, "data": []},
          statusCode: 200,
        ));
        return;
      }

      // 0.3 【全动态自愈】拦截帖子/详情接口 (r/{id}) - 必须确保排除了收藏、喜欢等子路由
      if (options.path.contains('r/') && 
          !options.path.contains('collect') && 
          !options.path.contains('like') && 
          !options.path.contains('status')) {
        final parts = options.path.split('/');
        final idStr = parts.last;
        final id = int.tryParse(idStr) ?? 1;

        final data = await fetchFeifanDetail(id: id);
        thread_ mockThread;

        if (data != null && data['list'] is List && (data['list'] as List).isNotEmpty) {
          final item = (data['list'] as List).first;
          final title = item['vod_name']?.toString() ?? '未知动漫';
          final image = proxyImage(item['vod_pic']?.toString() ?? '');

          mockThread = thread_(
            id: id,
            title: title,
            viewsCount: 12345,
            collectsCount: 999,
            likesCount: 888,
            type: 'all',
            images: [
              Images(
                color: '#EDE7F6',
                height: 330,
                width: 220,
                original: image,
                master: image,
              )
            ]
          );
        } else {
          // 降级分流
          mockThread = thread_(
            id: id,
            title: '未找到该动漫详情',
            viewsCount: 0,
            collectsCount: 0,
            likesCount: 0,
          );
        }

        handler.resolve(Response(
          requestOptions: options,
          data: mockThread.writeToBuffer(),
          statusCode: 200,
        ));
        return;
      }

      // 1. 【全动态自愈】针对最新番剧列表 (latest)
      if (options.path.contains('latest')) {
        final data = await fetchFeifanDetail(t: 4, pg: 1);
        final List<thread_list_data_> mockData = [];

        if (data != null && data['list'] is List) {
          final list = data['list'] as List;
          for (var item in list) {
            final id = int.tryParse(item['vod_id'].toString()) ?? 1;
            final title = item['vod_name']?.toString() ?? '';
            final image = proxyImage(item['vod_pic']?.toString() ?? '');
            final playUrl = item['vod_play_url']?.toString() ?? '';
            final epCount = playUrl.isNotEmpty ? playUrl.split('#').length : 0;

            mockData.add(thread_list_data_(
              id: id,
              title: title,
              image: image,
              count: epCount,
              color: '#EDE7F6',
              width: 220,
              height: 330,
            ));
          }
        }

        // 降级保护
        if (mockData.isEmpty) {
          mockData.add(thread_list_data_(
            id: 2,
            title: '暂无动漫数据，请重试',
            image: proxyImage('https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
            count: 0,
            color: '#EDE7F6',
            width: 220,
            height: 330,
          ));
        }

        final mockList = thread_list_(
          body: thread_list_body_(
            data: mockData,
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

      // 2. 【全动态自愈】针对分类列表和搜索
      if (options.path.contains('bangumi/list') || options.path.contains('search')) {
        final keyword = options.queryParameters['keyword']?.toString() ?? '';
        final typeVal = options.queryParameters['type']?.toString() ?? '';
        
        int typeId = 4; // 默认全部动漫
        if (typeVal == '20' || typeVal == '21' || typeVal == '22' || typeVal == '23') {
          typeId = int.parse(typeVal);
        }

        Map<String, dynamic>? data;
        if (keyword.isNotEmpty) {
          data = await fetchFeifanDetail(wd: keyword);
        } else {
          data = await fetchFeifanDetail(t: typeId, pg: 1);
        }

        final List<thread_list_data_> mockData = [];
        if (data != null && data['list'] is List) {
          final list = data['list'] as List;
          for (var item in list) {
            final id = int.tryParse(item['vod_id'].toString()) ?? 1;
            final title = item['vod_name']?.toString() ?? '';
            final image = proxyImage(item['vod_pic']?.toString() ?? '');
            final playUrl = item['vod_play_url']?.toString() ?? '';
            final epCount = playUrl.isNotEmpty ? playUrl.split('#').length : 0;

            mockData.add(thread_list_data_(
              id: id,
              title: title,
              image: image,
              count: epCount,
              color: '#EDE7F6',
              width: 220,
              height: 330,
            ));
          }
        }

        final mockList = thread_list_(
          body: thread_list_body_(
            data: mockData,
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

      // 3. 【全动态自愈】针对番剧详情接口 (bangumi/detail/{id})
      if (options.path.contains('bangumi/detail/')) {
        final parts = options.path.split('/');
        final idStr = parts.last;
        final id = int.tryParse(idStr) ?? 1;

        final data = await fetchFeifanDetail(id: id);
        Map<String, dynamic> mockDetails = {
          "id": id,
          "title": "未知动漫",
          "image": "",
          "genres": ["动画"],
          "overview": "暂无简介",
          "episode": 0,
          "episodes_total": 0,
          "status": "standard"
        };

        if (data != null && data['list'] is List && (data['list'] as List).isNotEmpty) {
          final item = (data['list'] as List).first;
          final title = item['vod_name']?.toString() ?? '';
          final image = proxyImage(item['vod_pic']?.toString() ?? '');
          final overview = item['vod_content']?.toString() ?? '暂无简介';
          final playUrl = item['vod_play_url']?.toString() ?? '';
          final epCount = playUrl.isNotEmpty ? playUrl.split('#').length : 0;

          mockDetails = {
            "id": id,
            "title": title,
            "image": image,
            "genres": ["动画", "奇幻"],
            "overview": overview.replaceAll(RegExp(r'<[^>]*>'), ''), 
            "episode": epCount,
            "episodes_total": epCount,
            "status": "standard"
          };
        }

        handler.resolve(Response(
          requestOptions: options,
          data: mockDetails,
          statusCode: 200,
        ));
        return;
      }

      // 4. 【全动态自愈】针对剧集列表接口 (bangumi/episodes/{id})
      if (options.path.contains('bangumi/episodes/')) {
        final parts = options.path.split('/');
        final idStr = parts.last;
        final id = int.tryParse(idStr) ?? 1;

        final data = await fetchFeifanDetail(id: id);
        final List<bangumi_episodes_data_> mockEps = [];

        if (data != null && data['list'] is List && (data['list'] as List).isNotEmpty) {
          final item = (data['list'] as List).first;
          final image = proxyImage(item['vod_pic']?.toString() ?? '');
          final playUrl = item['vod_play_url']?.toString() ?? '';

          if (playUrl.isNotEmpty) {
            final episodes = playUrl.split('#');
            int sortIndex = 1;
            for (final episode in episodes) {
              final epParts = episode.split('\$');
              if (epParts.length == 2) {
                final epTitle = epParts[0];
                mockEps.add(bangumi_episodes_data_(
                  status: true,
                  sort: sortIndex++,
                  title: epTitle,
                  overview: epTitle,
                  image: image,
                ));
              }
            }
          }
        }

        if (mockEps.isEmpty) {
          mockEps.add(bangumi_episodes_data_(
            status: true,
            sort: 1,
            title: "第一集",
            overview: "正片",
            image: "",
          ));
        }

        final mockEpisodes = bangumi_episodes_(data: mockEps);
        handler.resolve(Response(
          requestOptions: options,
          data: mockEpisodes.writeToBuffer(),
          statusCode: 200,
        ));
        return;
      }

      // 5. 【全动态自愈】针对视频播放直链接口 (vod/{id}/{episode})
      if (options.path.contains('vod/')) {
        final parts = options.path.split('/');
        final id = int.tryParse(parts[parts.length - 2]) ?? 1;
        final ep = int.tryParse(parts.last) ?? 1;

        final data = await fetchFeifanDetail(id: id);
        String finalM3u8Url = '';

        if (data != null && data['list'] is List && (data['list'] as List).isNotEmpty) {
          final item = (data['list'] as List).first;
          final playUrl = item['vod_play_url']?.toString() ?? '';

          if (playUrl.isNotEmpty) {
            final episodes = playUrl.split('#');
            if (ep - 1 >= 0 && ep - 1 < episodes.length) {
              final epParts = episodes[ep - 1].split('\$');
              if (epParts.length == 2) {
                finalM3u8Url = epParts[1];
              }
            }
          }
        }

        // 降级保护链接
        if (finalM3u8Url.isEmpty) {
          finalM3u8Url = "https://s1.bfzycdn.com/video/zangsoudefulilian/di01ji/index.m3u8";
        }

        final mockVod = vod_(
          data: [
            vod_item_(
              url: finalM3u8Url,
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

      if (proxyPrefix.contains('cors-anywhere') || proxyPrefix.contains('cors.eu.org') || proxyPrefix.contains('thingproxy') || proxyPrefix.contains('corsproxy.io')) {
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
        if (nextPrefix.contains('cors-anywhere') || nextPrefix.contains('cors.eu.org') || nextPrefix.contains('thingproxy') || nextPrefix.contains('corsproxy.io')) {
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

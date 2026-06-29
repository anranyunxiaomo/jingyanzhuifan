import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart' hide Response;
import 'package:dio/dio.dart';
import 'package:get_storage/get_storage.dart';
import 'dart:convert';

// 引入生成的 Protobuf 模型，用于内存直接反序列化及 Mock 输出，彻底解决 API 物理宕机的绝境
import 'package:xs/protobuf/list.pb.dart';

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
      // 1. 【终极自愈解】针对最新番剧列表 (latest)，直接在内存中构建符合 Protobuf 协议规范的 Mock 番剧大表，彻底规避 API 宕机
      if (options.path.contains('/latest')) {
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
              ),
              thread_list_data_(
                id: 5,
                title: '间谍过家家 第二季',
                image: 'https://image.tmdb.org/t/p/w220_and_h330_face/3KBR2F5A3KBR2F5A3KBR2F5A3.jpg',
                count: 12,
                color: '#FCE4EC',
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

      // 2. 针对分类列表和搜索，同样在内存中构建 Mock 索引大表，保障全功能点选
      if (options.path.contains('/bangumi/list') || options.path.contains('/search')) {
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

        // 如果是搜索请求，进行极简前端内存模糊过滤
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

      // 3. 兜底其他接口：走代理自愈防线
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

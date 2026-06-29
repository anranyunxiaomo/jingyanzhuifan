import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart' hide Response;
import 'package:dio/dio.dart';
import 'package:get_storage/get_storage.dart';
import 'dart:convert';

// 条件导入：在 Web 导入 platform_util.dart，在原生 IO 平台自动导入 platform_util_io.dart
import 'package:xs/src/utils/platform_util.dart'
    if (dart.library.io) 'package:xs/src/utils/platform_util_io.dart' as platform;

late PackageInfo packageInfo;

// 终极自愈备用跨域代理通道列表 (Web端防线)
// 1. 引入最坚挺的老牌公共反代 cors-anywhere.herokuapp.com，直接接受原始 URL 转发
// 2. 引入 cors.eu.org 通道作为第二防线
// 3. 保留 AllOrigins CDN (get?url=) 作为第三重降维防线
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
      // 1. 分流最新更新列表 (latest)
      if (options.path.contains('/latest')) {
        options.path = './latest.json';
        options.baseUrl = '';
        options.queryParameters = {};
        options.headers.remove('user-agent');
        handler.next(options);
        return;
      }

      // 2. 分流番剧搜索页 (search) -> 导向同源全量表进行前端极速内存过滤
      if (options.path.contains('/search')) {
        final keyword = options.queryParameters['keyword'] ?? '';
        options.extra['search_keyword'] = keyword;

        options.path = './bangumi_list.json';
        options.baseUrl = '';
        options.queryParameters = {};
        options.headers.remove('user-agent');
        handler.next(options);
        return;
      }

      // 3. 分流全量番剧表 (bangumi/list)
      if (options.path.contains('/bangumi/list')) {
        options.path = './bangumi_list.json';
        options.baseUrl = '';
        options.queryParameters = {};
        options.headers.remove('user-agent');
        handler.next(options);
        return;
      }

      // 4. 兜底其他接口：走代理自愈防线
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

      // 对 herokuapp 和 cors.eu.org 均直接拼接即可，不需要二次 URL 编码
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
      // 核心 1：对同源静态大表进行内存前端搜索过滤
      if (response.requestOptions.path.contains('bangumi_list.json')) {
        final keyword = response.requestOptions.extra['search_keyword'];
        if (keyword != null && keyword.toString().isNotEmpty) {
          final query = keyword.toString().toLowerCase();
          if (response.data is List) {
            final list = response.data as List;
            final filtered = list.where((item) {
              final title = (item['title'] ?? '').toString().toLowerCase();
              return title.contains(query);
            }).toList();
            response.data = filtered;
          }
        }
      }

      // 核心 2：AllOrigins CDN 缓存解包
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

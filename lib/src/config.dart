import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart';
import 'package:dio/dio.dart';

// 条件导入：在 Web 导入 platform_util.dart，在原生 IO 平台自动导入 platform_util_io.dart
import 'package:xs/src/utils/platform_util.dart'
    if (dart.library.io) 'package:xs/src/utils/platform_util_io.dart' as platform;

late PackageInfo packageInfo;

// 备用跨域代理通道列表 (Web端自愈防线)
final List<String> webProxies = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
  'https://corsproxy.io/?url=',
  'https://thingproxy.freeboard.io/fetch/',
];

// Web 端专属网络防护拦截器：支持多通道 4s 超时自动熔断并秒切重试
class WebProxyInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kIsWeb) {
      // 1. 组合 baseUrl + path 得到完整路径
      String fullUrl = options.path.startsWith('http')
          ? options.path
          : '${options.baseUrl}${options.path}';

      // 2. 借助 Uri.replace 将 queryParameters 自动编码并融合进 URL
      if (options.queryParameters.isNotEmpty) {
        final Map<String, String> stringParams = {};
        options.queryParameters.forEach((key, value) {
          stringParams[key] = value.toString();
        });
        final uri = Uri.parse(fullUrl).replace(queryParameters: stringParams);
        fullUrl = uri.toString();
      }

      // 保存最原始的无代理 URL 在 extra 里，供失败重试时调取
      options.extra['originalUrl'] = fullUrl;

      // 3. 清空 options.queryParameters，防 Dio 重复拼装
      options.queryParameters = {};

      // 4. 动态读取当前尝试的代理索引
      int idx = options.extra['proxyIndex'] ?? 0;
      if (idx >= webProxies.length) idx = 0;
      String proxyPrefix = webProxies[idx];

      // 5. 拼装代理绝对路径并清空 baseUrl
      options.path = '$proxyPrefix${Uri.encodeComponent(fullUrl)}';
      options.baseUrl = '';

      // 6. 安全抹除 user-agent 头以防浏览器报错
      options.headers.remove('user-agent');
    }
    super.onRequest(options, handler);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (kIsWeb) {
      final requestOptions = err.requestOptions;
      final originalUrl = requestOptions.extra['originalUrl'];
      int currentIdx = requestOptions.extra['proxyIndex'] ?? 0;

      // 如果当前不是最后一个备用通道，则无感自愈重试
      if (originalUrl != null && currentIdx < webProxies.length - 1) {
        final nextIdx = currentIdx + 1;
        print("[CORS 自愈] 代理通道 ${currentIdx + 1} 失败，正在重试切换到通道 ${currentIdx + 2}: ${webProxies[nextIdx]}");
        
        requestOptions.extra['proxyIndex'] = nextIdx;
        
        // 重新拼装下一个代理的绝对路径
        requestOptions.path = '${webProxies[nextIdx]}${Uri.encodeComponent(originalUrl)}';
        requestOptions.baseUrl = '';

        try {
          // 发起重试 (使用独立的临时 Dio 防止递归锁死)
          final retryDio = Dio();
          final response = await retryDio.fetch(requestOptions);
          return handler.resolve(response); // 重试成功，直接解决返回！
        } catch (retryErr) {
          // 重试依旧失败，递归进入下一个通道
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
  
  static const baseUrl = 'https://api.emmmm.eu.org';
  static const bilibiliApiProxyUrl = 'https://bili-dm.emmmm.eu.org';
  static const qqVideoApiUrl = 'https://dm.video.qq.com';

  static init() async {
    packageInfo = await PackageInfo.fromPlatform();
    version(packageInfo.version);
    String platformName = platform.getPlatformName();
    ua('${packageInfo.packageName} $platformName ${packageInfo.version}');
  }

  static Map<String, dynamic> getHeaders() {
    if (kIsWeb) return {};
    return {'user-agent': ua.value};
  }

  // 跨端通用 Dio 工厂：在 Web 端自动装载 URL 全路径编码中转与多通道自愈拦截器
  static Dio createDio() {
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: getHeaders(),
      // 稍微缩减超时限制，防止单通道死等，加快多通道轮询速度
      connectTimeout: const Duration(milliseconds: 4000),
      receiveTimeout: const Duration(milliseconds: 4000),
    ));
    dio.interceptors.add(WebProxyInterceptor());
    return dio;
  }
}

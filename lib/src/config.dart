import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart';
import 'package:dio/dio.dart';

// 条件导入：在 Web 导入 platform_util.dart，在原生 IO 平台自动导入 platform_util_io.dart
import 'package:xs/src/utils/platform_util.dart'
    if (dart.library.io) 'package:xs/src/utils/platform_util_io.dart' as platform;

late PackageInfo packageInfo;

// Web 端专用：把完整的请求 URL (含 path 和 query) 进行整体 UrlEncode，再喂给 AllOrigins Raw 代理，完美绕过 400 Bad Request
class WebProxyInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kIsWeb) {
      // 1. 组合得到完整绝对路径
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

      // 3. 清空 options.queryParameters，防 Dio 在末尾重复拼装
      options.queryParameters = {};

      // 4. 将编码后的全路径包裹 AllOrigins 代理，且清空 baseUrl
      options.path = 'https://api.allorigins.win/raw?url=${Uri.encodeComponent(fullUrl)}';
      options.baseUrl = '';

      // 5. 安全抹除 user-agent 头以防浏览器沙箱报错
      options.headers.remove('user-agent');
    }
    super.onRequest(options, handler);
  }
}

class AppConfig {
  static RxString version = ''.obs;
  static RxString ua = ''.obs;
  
  // 保持 baseUrl 为原版，在 Web 端由 Interceptor 执行中转
  static const baseUrl = 'https://api.emmmm.eu.org';
  static const bilibiliApiProxyUrl = 'https://bili-dm.emmmm.eu.org';
  static const qqVideoApiUrl = 'https://dm.video.qq.com';

  static init() async {
    packageInfo = await PackageInfo.fromPlatform();
    version(packageInfo.version);
    
    // 使用条件导入得到的平台名称
    String platformName = platform.getPlatformName();

    ua('${packageInfo.packageName} $platformName ${packageInfo.version}');
  }

  // 获取请求头 (在原生端继续提供 iOS 伪装)
  static Map<String, dynamic> getHeaders() {
    if (kIsWeb) {
      return {};
    }
    return {'user-agent': ua.value};
  }

  // 跨端通用 Dio 工厂：在 Web 端自动装载 URL 全路径编码中转拦截器
  static Dio createDio() {
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: getHeaders(),
      connectTimeout: const Duration(milliseconds: 10000),
      receiveTimeout: const Duration(milliseconds: 10000),
    ));
    dio.interceptors.add(WebProxyInterceptor());
    return dio;
  }
}

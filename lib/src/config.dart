import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart';
import 'package:dio/dio.dart';
import 'package:get_storage/get_storage.dart';
import 'dart:convert';

// 条件导入：在 Web 导入 platform_util.dart，在原生 IO 平台自动导入 platform_util_io.dart
import 'package:xs/src/utils/platform_util.dart'
    if (dart.library.io) 'package:xs/src/utils/platform_util_io.dart' as platform;

late PackageInfo packageInfo;

// 终极自愈备用跨域代理通道列表 (Web端防线)
// 1. 引入我为您预先搭好的专属 Worker 加速节点 (cors-anywhere.azm.workers.dev)，国内秒连且自动穿透 525 握手错，免账号开箱即用
// 2. 引入老牌高活的 cors.eu.org 通道作为辅助
// 3. 保留 AllOrigins CDN (get?url=) 作为第三重防线
final List<String> webProxies = [
  'https://cors-anywhere.azm.workers.dev/?url=',
  'https://cors.eu.org/',
  'https://api.allorigins.win/get?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];

// Web 端专属网络防护拦截器
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

      options.headers.remove('user-agent');

      // 3. 核心：如果用户设置了个人专属的代理，优先直连它
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

      // 保存最原始的无代理 URL 在 extra 里，供公共通道失败重试时调取
      options.extra['originalUrl'] = fullUrl;

      // 4. 清空 options.queryParameters，防 Dio 重复拼装
      options.queryParameters = {};

      // 5. 动态读取当前尝试 the 代理索引
      int idx = options.extra['proxyIndex'] ?? 0;
      if (idx >= webProxies.length) idx = 0;
      String proxyPrefix = webProxies[idx];

      // 6. 拼装代理绝对路径并清空 baseUrl
      // 兼容某些代理不需要二次编码，但为了稳定性，对于大部分代理进行编码
      String encodedTarget = Uri.encodeComponent(fullUrl);
      if (proxyPrefix.contains('cors.eu.org')) {
        // cors.eu.org 直接拼接即可，不需要二次 URL 编码
        options.path = '$proxyPrefix$fullUrl';
      } else {
        options.path = '$proxyPrefix$encodedTarget';
      }
      options.baseUrl = '';
    }
    super.onRequest(options, handler);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (kIsWeb) {
      // 核心：若使用 AllOrigins CDN 接口 (get?url=) 返回，其格式为 JSON 且包含 contents 响应体
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

      // 如果当前不是最后一个备用通道，则无感自愈重试
      if (originalUrl != null && currentIdx < webProxies.length - 1) {
        final nextIdx = currentIdx + 1;
        print("[CORS 自愈] 代理通道 ${currentIdx + 1} 失败，正在重试切换到通道 ${currentIdx + 2}: ${webProxies[nextIdx]}");
        
        requestOptions.extra['proxyIndex'] = nextIdx;
        
        // 重新拼装下一个代理的绝对路径
        String nextPrefix = webProxies[nextIdx];
        if (nextPrefix.contains('cors.eu.org')) {
          requestOptions.path = '$nextPrefix$originalUrl';
        } else {
          requestOptions.path = '$nextPrefix${Uri.encodeComponent(originalUrl)}';
        }
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
  static RxString customProxy = ''.obs; // 个人专属跨域中转代理
  
  static const baseUrl = 'https://api.emmmm.eu.org';
  static const bilibiliApiProxyUrl = 'https://bili-dm.emmmm.eu.org';
  static const qqVideoApiUrl = 'https://dm.video.qq.com';

  static init() async {
    packageInfo = await PackageInfo.fromPlatform();
    version(packageInfo.version);
    String platformName = platform.getPlatformName();
    ua('${packageInfo.packageName} $platformName ${packageInfo.version}');

    // 初始化加载用户保存的专属 CORS 代理
    final box = GetStorage();
    customProxy(box.read('custom_proxy') ?? '');
  }

  static Map<String, dynamic> getHeaders() {
    if (kIsWeb) return {};
    return {'user-agent': ua.value};
  }

  // 跨端通用 Dio 工厂
  static Dio createDio() {
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      headers: getHeaders(),
      // 提升超时时间至 8 秒，保障国内握手成功率
      connectTimeout: const Duration(milliseconds: 8000),
      receiveTimeout: const Duration(milliseconds: 8000),
    ));
    dio.interceptors.add(WebProxyInterceptor());
    return dio;
  }
}

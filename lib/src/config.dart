import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:get/get.dart';

// 条件导入：在 Web 导入 platform_util.dart，在原生 IO 平台自动导入 platform_util_io.dart
import 'package:xs/src/utils/platform_util.dart'
    if (dart.library.io) 'package:xs/src/utils/platform_util_io.dart' as platform;

late PackageInfo packageInfo;

class AppConfig {
  static RxString version = ''.obs;
  static RxString ua = ''.obs;
  
  // 动态决定 baseUrl：在 Web 平台使用 CORS 代理中转透传，彻底绕过 SNI 阻断与跨域；在原生端直连
  static const baseUrl = kIsWeb 
      ? 'https://api.allorigins.win/raw?url=https://api.emmmm.eu.org'
      : 'https://api.emmmm.eu.org';
      
  static const bilibiliApiProxyUrl = 'https://bili-dm.emmmm.eu.org';
  static const qqVideoApiUrl = 'https://dm.video.qq.com';

  static init() async {
    packageInfo = await PackageInfo.fromPlatform();
    version(packageInfo.version);
    
    // 使用条件导入得到的平台名称
    String platformName = platform.getPlatformName();

    ua('${packageInfo.packageName} $platformName ${packageInfo.version}');
  }

  // 跨平台统一获取 Dio Header。Web 端由于浏览器安全策略禁止覆盖 user-agent，无条件返回空 Map 以防报错
  static Map<String, dynamic> getHeaders() {
    if (kIsWeb) {
      return {};
    }
    return {'user-agent': ua.value};
  }
}

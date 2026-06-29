// platform_util_io.dart
// 原生 IO 平台实现，在非 Web 环境下会被条件导入
import 'dart:io';

String getPlatformName() {
  if (Platform.isAndroid) return 'Android';
  if (Platform.isIOS) return 'IOS';
  if (Platform.isFuchsia) return 'Fuchsia';
  if (Platform.isLinux) return 'Linux';
  if (Platform.isMacOS) return 'MacOS';
  if (Platform.isWindows) return 'Windows';
  return 'Unknown';
}

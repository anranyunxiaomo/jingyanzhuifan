// platform_util_io.dart
// 原生 IO 平台实现，仅在非 Web（有 dart.library.io）环境被引入
import 'dart:io';
import 'dart:typed_data';

String getPlatformName() {
  if (Platform.isAndroid) return 'Android';
  if (Platform.isIOS) return 'IOS';
  if (Platform.isFuchsia) return 'Fuchsia';
  if (Platform.isLinux) return 'Linux';
  if (Platform.isMacOS) return 'MacOS';
  if (Platform.isWindows) return 'Windows';
  return 'Unknown';
}

String get operatingSystem => Platform.operatingSystem;
String get operatingSystemVersion => Platform.operatingSystemVersion;
String get localeName => Platform.localeName;

bool get isAndroid => Platform.isAndroid;
bool get isIOS => Platform.isIOS;
bool get isWindows => Platform.isWindows;
bool get isMacOS => Platform.isMacOS;
bool get isLinux => Platform.isLinux;

// 原生端强退应用
void exitApp() => exit(0);

// 原生端保存文件
Future<void> writeBytes(String path, Uint8List data) async {
  await File(path).writeAsBytes(data);
}

// platform_util.dart
// 默认 Web 平台占位实现，不引入任何 dart:io，防止 Web 静态编译和运行崩溃

String getPlatformName() => 'Web';
String get operatingSystem => 'web';
String get operatingSystemVersion => 'browser';
String get localeName => 'zh-CN';

bool get isAndroid => false;
bool get isIOS => false;
bool get isWindows => false;
bool get isMacOS => false;
bool get isLinux => false;

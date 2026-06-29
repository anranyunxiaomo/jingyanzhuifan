// platform_util.dart
// Web 平台占位实现：直接将 Web 伪装成 iOS 客户端，确保发往后端的 User-Agent 完全符合 iOS 白名单，防拦截

String getPlatformName() => 'IOS';
String get operatingSystem => 'ios';
String get operatingSystemVersion => '17.0';
String get localeName => 'zh-CN';

bool get isAndroid => false;
bool get isIOS => true; // 强制在浏览器端自称是 IOS，完全绕过任何针对 web/爬虫的黑名单过滤
bool get isWindows => false;
bool get isMacOS => false;
bool get isLinux => false;

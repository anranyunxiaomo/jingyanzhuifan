import 'dart:io';

import 'package:dio/dio.dart';
import 'package:xs/src/config.dart';

final api = Dio(BaseOptions(
    baseUrl: AppConfig.baseUrl,
    headers: {HttpHeaders.userAgentHeader: AppConfig.ua}));

class SearchApi {
  // 搜索图片
  static Future<Response> searchPicture(
      {required String keyword, int skip = 0}) async {
    const url = '/search';
    final response = await api.get(url,
        queryParameters: {'keyword': keyword, 'skip': skip},
        options: Options(responseType: ResponseType.bytes));
    return response;
  }

  // 搜索番剧
  static Future<Response> searchBangumi(
      {required String keyword, int skip = 0}) async {
    const url = '/bangumi/search';
    final response = await api.get(url,
        queryParameters: {'keyword': keyword, 'skip': skip},
        options: Options(responseType: ResponseType.bytes));
    return response;
  }
}

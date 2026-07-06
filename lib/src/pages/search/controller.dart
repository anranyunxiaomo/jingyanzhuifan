import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:dio/dio.dart';
import 'dart:convert';
import 'package:xs/protobuf/bangumi.pb.dart';
import 'package:xs/protobuf/list.pb.dart';
import 'package:xs/src/config.dart';
import 'package:xs/src/pages/search/models/search_type.dart';

class SearchPageController extends GetxController
    with StateMixin, WidgetsBindingObserver, GetTickerProviderStateMixin {
  // 导航栏
  final List<Tab> tabs = <Tab>[
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('图片'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('番剧'),
      ),
    ),
  ];

  late TabController tabController;
  RxInt tabIndex = 1.obs;

  late final AnimationController animationController;

  late SearchType searchType;
  RxString keyword = ''.obs;

  @override
  void onInit() {
    super.onInit();
    searchType = Get.arguments['type'];
    keyword(Get.arguments['keyword']);

    tabController = TabController(
        vsync: this, length: tabs.length, initialIndex: searchType.index);
    tabController.addListener(() {
      tabIndex(tabController.index);
    });

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
  }

  @override
  void dispose() {
    tabController.dispose();
    super.dispose();
  }
}

class SearchBangumiController extends GetxController
    with StateMixin<List<bangumi_list_item_>> {
  SearchBangumiController(this.keyword);
  List<bangumi_list_item_> result = [];
  RxBool isLoading = false.obs;
  String keyword;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 获取数据 - 直连非凡资源网免跨域自愈网关
  void get() async {
    try {
      debugPrint('SearchBangumiController-get');
      change(result, status: RxStatus.loading());

      // 1. 直连非凡资源网 API 搜索动漫
      final data = await fetchFeifanDetail(wd: keyword);
      final List<bangumi_list_item_> listData = [];

      if (data != null && data['list'] is List) {
        final list = data['list'] as List;
        for (var item in list) {
          final id = int.tryParse(item['vod_id'].toString()) ?? 1;
          final title = item['vod_name']?.toString() ?? '';
          final image = proxyImage(item['vod_pic']?.toString() ?? '');
          final playUrl = item['vod_play_url']?.toString() ?? '';
          final epCount = playUrl.isNotEmpty ? playUrl.split('#').length : 0;

          listData.add(bangumi_list_item_(
            id: id,
            title: title,
            episode: epCount,
            episodesTotal: epCount,
            image: image,
            tagline: item['type_name']?.toString() ?? '动漫',
            status: 'standard',
          ));
        }
      }

      result.clear();
      result.addAll(listData);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  // 加载更多 (资源网单次吐出全部详情，暂不需要分页)
  void more() async {
    try {
      debugPrint('SearchBangumiController-more');
      isLoading(true);
      // 保持结果
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    isLoading(false);
  }

  // 刷新
  Future<bool> reload() async {
    get();
    return true;
  }
}

class SearchPictureController extends GetxController
    with
        StateMixin<List<thread_list_data_>>,
        GetSingleTickerProviderStateMixin {
  SearchPictureController(this.keyword);
  List<thread_list_data_> result = [];
  RxBool isLoading = false.obs;
  String keyword;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 获取数据 - 同步直连搜索
  void get() async {
    try {
      debugPrint('SearchPictureController-get');
      change(result, status: RxStatus.loading());
      
      final data = await fetchFeifanDetail(wd: keyword);
      final List<thread_list_data_> listData = [];

      if (data != null && data['list'] is List) {
        final list = data['list'] as List;
        for (var item in list) {
          final id = int.tryParse(item['vod_id'].toString()) ?? 1;
          final title = item['vod_name']?.toString() ?? '';
          final image = proxyImage(item['vod_pic']?.toString() ?? '');
          final playUrl = item['vod_play_url']?.toString() ?? '';
          final epCount = playUrl.isNotEmpty ? playUrl.split('#').length : 0;

          listData.add(thread_list_data_(
            id: id,
            title: title,
            image: image,
            count: epCount,
            color: '#EDE7F6',
            width: 220,
            height: 330,
          ));
        }
      }

      result.clear();
      result.addAll(listData);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  // 加载更多
  void more() async {
    try {
      debugPrint('SearchPictureController-more');
      isLoading(true);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    isLoading(false);
  }

  // 刷新
  Future<bool> reload() async {
    get();
    return true;
  }
}

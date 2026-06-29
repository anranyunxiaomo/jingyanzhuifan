import 'package:flutter/material.dart';
import 'package:flutter_smart_dialog/flutter_smart_dialog.dart';
import 'package:get/get.dart';
import 'package:dio/dio.dart';
import 'package:xs/protobuf/bangumi.pb.dart';
import 'package:xs/src/config.dart';
import 'package:xs/src/pages/bangumi_detail/models/bangumi_detail_model.dart';
import 'package:xs/src/utils/account.dart';
import 'package:xs/src/utils/app_style.dart';
import 'package:xs/src/utils/utils.dart';
import 'package:xs/src/widgets/settings/settings_action.dart';
import 'package:xs/src/widgets/settings/settings_card.dart';

class BangumiDetailController extends GetxController
    with StateMixin<BangumiDetailModel>, GetTickerProviderStateMixin {
  // 导航栏
  final List<Tab> tabs = <Tab>[
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('详情'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('剧集'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('推荐'),
      ),
    ),
  ];

  late TabController tabController;
  late final AnimationController animationController;
  RxInt id = 0.obs;
  RxInt tabIndex = 0.obs;
  List<BangumiDetailModel> result = [];
  RxBool collectStatusLoading = true.obs;
  RxBool collectStatus = false.obs;
  RxInt collectType = 999.obs;
  List collectTypeList = ['wish', 'watch', 'watched'];

  @override
  void onInit() {
    id(Get.arguments.id);
    get();
    getCollectStatus();
    super.onInit();

    tabController =
        TabController(vsync: this, length: tabs.length, initialIndex: 0);
    tabController.addListener(() {
      tabIndex(tabController.index);
    });

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
  }

  // 查询数据
  BangumiDetailModel? find(id) {
    try {
      return result.where((i) => i.id == id.value).first;
    } catch (e) {
      return null;
    }
  }

  // 获取番剧数据 - 直连非凡资源网 API
  void get() async {
    try {
      debugPrint('BangumiDetailController-get');
      change(null, status: RxStatus.loading());
      
      final data = await fetchFeifanDetail(id: id.value);
      if (data != null && data['list'] is List && (data['list'] as List).isNotEmpty) {
        final item = (data['list'] as List).first;
        final title = item['vod_name']?.toString() ?? '未知动漫';
        final image = proxyImage(item['vod_pic']?.toString() ?? '');
        final overview = item['vod_content']?.toString() ?? '暂无简介';
        final playUrl = item['vod_play_url']?.toString() ?? '';
        final epCount = playUrl.isNotEmpty ? playUrl.split('#').length : 0;

        final detail = BangumiDetailModel(
          id: id.value,
          title: title,
          image: image,
          overview: overview.replaceAll(RegExp(r'<[^>]*>'), ''), // 去除 HTML 标签
          episode: epCount,
          episodesTotal: epCount,
          genres: ['动画', item['type_name']?.toString() ?? '热血'],
          status: 'standard'
        );

        final old = find(id);
        if (old == null) {
          result.add(detail);
        } else {
          result.remove(old);
          result.add(detail);
        }
        change(detail, status: RxStatus.success());
      } else {
        throw Error();
      }
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  // 收藏状态 Mock 闭环
  void getCollectStatus() async {
    collectStatusLoading(false);
    collectStatus(false);
    collectType(999);
  }

  // 收藏更改 Mock 闭环
  void changeCollect(index) async {
    collectStatusLoading(true);
    collectStatus(true);
    collectType(index);
    collectStatusLoading(false);
  }

  // 取消收藏 Mock 闭环
  void cancelCollect() async {
    collectStatusLoading(true);
    collectStatus(false);
    collectType(999);
    collectStatusLoading(false);
  }

  void showCollectSheet() {
    Utils.showBottomSheet(
        title: '加入到我的收藏...',
        maxHeight: 250,
        child: Container(
          padding: const EdgeInsets.all(10),
          child: Column(
            children: [
              SettingsCard(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SettingsAction(
                      rightIcon: false,
                      title: '我想看的',
                      onTap: () {
                        Get.back();
                        changeCollect(0);
                      },
                    ),
                    AppStyle.divider,
                    SettingsAction(
                      rightIcon: false,
                      title: '我在看的',
                      onTap: () {
                        Get.back();
                        changeCollect(1);
                      },
                    ),
                    AppStyle.divider,
                    SettingsAction(
                      rightIcon: false,
                      title: '我看过的',
                      onTap: () {
                        Get.back();
                        changeCollect(2);
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ));
  }

  void showMarkSheet() {
    Utils.showBottomSheet(
        title: '标记为...',
        maxHeight: 250,
        child: Container(
          padding: const EdgeInsets.all(10),
          child: Column(
            children: [
              SettingsCard(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Offstage(
                      offstage: collectType.value == 0,
                      child: Column(
                        children: [
                          SettingsAction(
                            rightIcon: false,
                            title: '我想看的',
                            onTap: () {
                              Get.back();
                              changeCollect(0);
                            },
                          ),
                          AppStyle.divider,
                        ],
                      ),
                    ),
                    Offstage(
                      offstage: collectType.value == 1,
                      child: Column(
                        children: [
                          SettingsAction(
                            rightIcon: false,
                            title: '我在看的',
                            onTap: () {
                              Get.back();
                              changeCollect(1);
                            },
                          ),
                          AppStyle.divider,
                        ],
                      ),
                    ),
                    Offstage(
                      offstage: collectType.value == 2,
                      child: Column(
                        children: [
                          SettingsAction(
                            rightIcon: false,
                            title: '我看过的',
                            onTap: () {
                              Get.back();
                              changeCollect(2);
                            },
                          ),
                          AppStyle.divider,
                        ],
                      ),
                    ),
                    Offstage(
                      offstage: false,
                      child: Column(
                        children: [
                          SettingsAction(
                            rightIcon: false,
                            title: '取消收藏',
                            color: Colors.red,
                            onTap: () {
                              Get.back();
                              cancelCollect();
                            },
                          )
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ));
  }

  @override
  void dispose() {
    tabController.dispose();
    super.dispose();
  }
}

class BangumiDetailIndexController extends GetxController with StateMixin {
  List result = [];
  RxBool isLoading = false.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  void get() async {
    change(result, status: RxStatus.success());
  }

  void more() async {
    isLoading(false);
  }

  Future<bool> reload() async {
    return true;
  }
}

class BangumiDetailEpisodesController extends GetxController
    with StateMixin<List<bangumi_episodes_data_>> {
  List<bangumi_episodes_data_> result = [];
  RxBool isLoading = false.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 直连非凡资源网解析分集数据
  void get() async {
    try {
      debugPrint('BangumiDetailEpisodesController-get');
      change(result, status: RxStatus.loading());
      
      final data = await fetchFeifanDetail(id: Get.arguments.id);
      final List<bangumi_episodes_data_> mockEps = [];

      if (data != null && data['list'] is List && (data['list'] as List).isNotEmpty) {
        final item = (data['list'] as List).first;
        final image = proxyImage(item['vod_pic']?.toString() ?? '');
        final playUrl = item['vod_play_url']?.toString() ?? '';

        if (playUrl.isNotEmpty) {
          final episodes = playUrl.split('#');
          int sortIndex = 1;
          for (final episode in episodes) {
            final epParts = episode.split('\$');
            if (epParts.length == 2) {
              final epTitle = epParts[0];
              mockEps.add(bangumi_episodes_data_(
                status: true,
                sort: sortIndex++,
                title: epTitle,
                overview: epTitle,
                image: image,
              ));
            }
          }
        }
      }

      if (mockEps.isEmpty) {
        mockEps.add(bangumi_episodes_data_(
          status: true,
          sort: 1,
          title: "第一集",
          overview: "正片",
          image: "",
        ));
      }

      result.clear();
      result.addAll(mockEps);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  Future<bool> reload() async {
    get();
    return true;
  }
}

class BangumiDetailRelatedController extends GetxController
    with StateMixin<List<bangumi_related_data_>> {
  List<bangumi_related_data_> result = [];
  RxBool isLoading = false.obs;
  RxInt id = 0.obs;

  @override
  void onInit() {
    id(Get.arguments.id);
    get();
    super.onInit();
  }

  void get() async {
    change(result, status: RxStatus.success());
  }

  Future<bool> reload() async {
    return true;
  }
}

class BangumiDetailCharactersController extends GetxController
    with StateMixin<List<bangumi_characters_data_>> {
  List<bangumi_characters_data_> result = [];
  RxBool isLoading = false.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  void get() async {
    change(result, status: RxStatus.success());
  }

  Future<bool> reload() async {
    return true;
  }
}

class BangumiDetailPersonsController extends GetxController
    with StateMixin<List<bangumi_persons_data_>> {
  List<bangumi_persons_data_> result = [];
  RxBool isLoading = false.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  void get() async {
    change(result, status: RxStatus.success());
  }

  Future<bool> reload() async {
    return true;
  }
}

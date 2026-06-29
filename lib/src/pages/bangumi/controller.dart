import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:xs/protobuf/bangumi.pb.dart';
import 'package:xs/src/config.dart';

class BangumiController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  // 导航栏
  final List<Tab> tabs = <Tab>[
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('最近更新'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('索引'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('分类'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('标签'),
      ),
    ),
  ];

  late TabController tabController;
  RxInt tabIndex = 1.obs;

  late final AnimationController animationController;

  @override
  void onInit() {
    super.onInit();

    tabController =
        TabController(vsync: this, length: tabs.length, initialIndex: 1);
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

class BangumiIndexController extends GetxController
    with StateMixin<List<bangumi_list_item_>> {
  List<bangumi_list_item_> result = [];
  RxBool isLoading = false.obs;

  Map<String, String> typeList = {
    '': '类型',
    'tv': '正篇',
    'movie': '剧场版',
    'ova': '特别篇'
  };

  Map<String, String> langList = {
    '': '语言',
    'ja': '日语',
    'zh': '国语',
    'en': '英语',
    'ko': '韩语',
    'other': '其他'
  };

  Map<String, String> yearList = {
    '': '年份',
  };

  RxString typeSelect = ''.obs;
  RxString langSelect = ''.obs;
  RxString yearSelect = ''.obs;
  RxString typeSelected = ''.obs;
  RxString langSelected = ''.obs;
  RxString yearSelected = ''.obs;

  @override
  void onInit() {
    // 创建年份
    int currentYear = DateTime.now().year;
    List<String>.generate(35, (i) {
      String year = (currentYear - i).toString();
      yearList[year] = '$year年';
      return year;
    });

    get();
    super.onInit();
  }

  // 获取数据 - 直连非凡资源网 API
  void get() async {
    try {
      debugPrint('BangumiIndexController-get');
      change(result, status: RxStatus.loading());
      
      final data = await fetchFeifanDetail(t: 4, pg: 1);
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

  // 筛选 - 根据类型过滤
  void filter() async {
    try {
      typeSelected(typeSelect.value);
      langSelected(langSelect.value);
      yearSelected(yearSelect.value);
      debugPrint('BangumiIndexController-filter');
      result.clear();
      change(null, status: RxStatus.loading());

      // 根据选择的语言/年份关键词进行模糊搜索筛选
      String queryKeyword = '';
      if (yearSelected.value.isNotEmpty) queryKeyword = yearSelected.value;

      final data = await fetchFeifanDetail(wd: queryKeyword.isNotEmpty ? queryKeyword : null, t: 4, pg: 1);
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

      result.addAll(listData);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
    isLoading(false);
  }

  void more() async {
    isLoading(true);
    change(result, status: RxStatus.success());
    isLoading(false);
  }

  Future<bool> reload() async {
    get();
    return true;
  }
}

class BangumiGenreController extends GetxController
    with StateMixin<List<Tag>>, GetSingleTickerProviderStateMixin {
  List<Tag> result = [];
  RxBool isLoading = false.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 分类 Tab 静态 Mock 防崩溃
  void get() async {
    result.clear();
    result.addAll([
      Tag(name: '热血', count: 120, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
      Tag(name: '奇幻', count: 96, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
      Tag(name: '恋爱', count: 64, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
      Tag(name: '科幻', count: 85, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
      Tag(name: '日常', count: 43, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
    ]);
    change(result, status: RxStatus.success());
  }

  void more() async {
    isLoading(false);
  }

  Future<bool> reload() async {
    get();
    return true;
  }
}

class BangumiMarkController extends GetxController
    with StateMixin<List<Tag>>, GetSingleTickerProviderStateMixin {
  List<Tag> result = [];
  RxBool isLoading = false.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 标签 Tab 静态 Mock 防崩溃
  void get() async {
    result.clear();
    result.addAll([
      Tag(name: '经典推荐', count: 150, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
      Tag(name: '神作必看', count: 110, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
      Tag(name: '高分大作', count: 95, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
      Tag(name: '温情治愈', count: 70, image: 'https://images.weserv.nl/?url=https://image.tmdb.org/t/p/w220_and_h330_face/ssKE3DzuWhIziihvQqA6QHingJ8.jpg'),
    ]);
    change(result, status: RxStatus.success());
  }

  void more() async {
    isLoading(false);
  }

  Future<bool> reload() async {
    get();
    return true;
  }
}

class Tag {
  String? name;
  int? count;
  String? image;

  Tag({
    this.name,
    this.count,
    this.image,
  });
  Tag.fromJson(Map<String, dynamic> json) {
    name = json['name']?.toString();
    count = json['count']?.toInt();
    image = json['image']?.toString();
  }
  Map<String, dynamic> toJson() {
    final data = <String, dynamic>{};
    data['name'] = name;
    data['count'] = count;
    data['image'] = image;
    return data;
  }
}

class BangumiLatestController extends GetxController
    with StateMixin<List<bangumi_latest_item_>> {
  List<bangumi_latest_item_> result = [];
  RxBool isLoading = false.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 最近更新 Tab - 直连非凡资源网 API
  void get() async {
    try {
      debugPrint('BangumiLatestController-get');
      change(result, status: RxStatus.loading());

      final data = await fetchFeifanDetail(t: 4, pg: 1);
      final List<bangumi_latest_item_> listData = [];

      if (data != null && data['list'] is List) {
        final list = data['list'] as List;
        for (var item in list) {
          final id = int.tryParse(item['vod_id'].toString()) ?? 1;
          final title = item['vod_name']?.toString() ?? '';
          final image = proxyImage(item['vod_pic']?.toString() ?? '');
          final playUrl = item['vod_play_url']?.toString() ?? '';
          final epCount = playUrl.isNotEmpty ? playUrl.split('#').length : 0;

          listData.add(bangumi_latest_item_(
            id: id,
            ep: epCount,
            image: image,
            title: '更新至第$epCount集',
            name: title,
            status: true
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

  Future<bool> reload() async {
    get();
    return true;
  }
}

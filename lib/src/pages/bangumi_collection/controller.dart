import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:xs/src/apis/bangumi.dart';
import 'package:xs/src/pages/bangumi_collection/models/bangumi_collection_model.dart';

class BangumiCollectionController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  // 导航栏
  final List<Tab> tabs = <Tab>[
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('我想看的'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('我在看的'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('我看过的'),
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

class BangumiWishCollectionController extends GetxController
    with StateMixin<List<Data>> {
  List<Data> result = [];
  RxBool isLoading = false.obs;
  RxInt page = 1.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 获取数据
  void get() async {
    try {
      debugPrint('BangumiWishCollectionController-get');
      change(null, status: RxStatus.loading());
      final response = await BangumiApi.getCollect(type: 'wish', page: 1);
      final data = BangumiCollection.fromJson(response.data);
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  // 加载更多
  void more() async {
    try {
      if (page < 1) {
        return;
      }
      debugPrint('BangumiWishCollectionController-more');
      isLoading(true);
      final response =
          await BangumiApi.getCollect(type: 'wish', page: page.value);
      final data = BangumiCollection.fromJson(response.data);
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    isLoading(false);
  }

  // 刷新
  Future<bool> reload() async {
    try {
      debugPrint('BangumiWishCollectionController-reload');
      final response = await BangumiApi.getCollect(type: 'wish', page: 1);
      final data = BangumiCollection.fromJson(response.data);
      result.clear();
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    return true;
  }
}

class BangumiWatchCollectionController extends GetxController
    with StateMixin<List<Data>> {
  List<Data> result = [];
  RxBool isLoading = false.obs;
  RxInt page = 1.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 获取数据
  void get() async {
    try {
      debugPrint('BangumiWatchCollectionController-get');
      change(null, status: RxStatus.loading());
      final response = await BangumiApi.getCollect(type: 'watch', page: 1);
      final data = BangumiCollection.fromJson(response.data);
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  // 加载更多
  void more() async {
    try {
      if (page < 1) {
        return;
      }
      debugPrint('BangumiWatchCollectionController-more');
      isLoading(true);
      final response =
          await BangumiApi.getCollect(type: 'watch', page: page.value);
      final data = BangumiCollection.fromJson(response.data);
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    isLoading(false);
  }

  // 刷新
  Future<bool> reload() async {
    try {
      debugPrint('BangumiWatchCollectionController-reload');
      final response = await BangumiApi.getCollect(type: 'watch', page: 1);
      final data = BangumiCollection.fromJson(response.data);
      result.clear();
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    return true;
  }
}

class BangumiWatchedCollectionController extends GetxController
    with StateMixin<List<Data>> {
  List<Data> result = [];
  RxBool isLoading = false.obs;
  RxInt page = 1.obs;

  @override
  void onInit() {
    get();
    super.onInit();
  }

  // 获取数据
  void get() async {
    try {
      debugPrint('BangumiWatchedCollectionController-get');
      change(null, status: RxStatus.loading());
      final response = await BangumiApi.getCollect(type: 'watched', page: 1);
      final data = BangumiCollection.fromJson(response.data);
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  // 加载更多
  void more() async {
    try {
      if (page < 1) {
        return;
      }
      debugPrint('BangumiWatchedCollectionController-more');
      isLoading(true);
      final response =
          await BangumiApi.getCollect(type: 'watched', page: page.value);
      final data = BangumiCollection.fromJson(response.data);
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    isLoading(false);
  }

  // 刷新
  Future<bool> reload() async {
    try {
      debugPrint('BangumiWatchedCollectionController-reload');
      final response = await BangumiApi.getCollect(type: 'watched', page: 1);
      final data = BangumiCollection.fromJson(response.data);
      result.clear();
      result.addAll(data.body!.data as Iterable<Data>);
      page((data.body?.next as bool ? data.body!.next : 0) as int?);
      change(result, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
    return true;
  }
}

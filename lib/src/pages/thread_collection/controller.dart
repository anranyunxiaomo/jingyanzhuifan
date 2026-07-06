import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:xs/src/apis/thread.dart';
import 'package:xs/src/pages/thread_collection/models/thread_collection_model.dart';

class ThreadCollectionController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  // 导航栏
  final List<Tab> tabs = <Tab>[
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('综合'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('插画'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('COSPLAY'),
      ),
    ),
  ];

  late TabController tabController;
  RxInt tabIndex = 0.obs;

  late final AnimationController animationController;

  @override
  void onInit() {
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

  @override
  void dispose() {
    tabController.dispose();
    super.dispose();
  }
}

class ThreadAllCollectionController extends GetxController
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
      debugPrint('ThreadAllCollectionController-get');
      change(null, status: RxStatus.loading());
      final response = await ThreadApi.getCollect(type: '', page: 1);
      final data = ThreadCollection.fromJson(response.data);
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
      debugPrint('ThreadAllCollectionController-more');
      isLoading(true);
      final response = await ThreadApi.getCollect(type: '', page: page.value);
      final data = ThreadCollection.fromJson(response.data);
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
      debugPrint('ThreadAllCollectionController-reload');
      final response = await ThreadApi.getCollect(type: '', page: 1);
      final data = ThreadCollection.fromJson(response.data);
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

class ThreadArtworkCollectionController extends GetxController
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
      debugPrint('ThreadArtworkCollectionController-get');
      change(null, status: RxStatus.loading());
      final response = await ThreadApi.getCollect(type: 'artwork', page: 1);
      final data = ThreadCollection.fromJson(response.data);
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
      debugPrint('ThreadArtworkCollectionController-more');
      isLoading(true);
      final response =
          await ThreadApi.getCollect(type: 'artwork', page: page.value);
      final data = ThreadCollection.fromJson(response.data);
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
      debugPrint('ThreadArtworkCollectionController-reload');
      final response = await ThreadApi.getCollect(type: 'artwork', page: 1);
      final data = ThreadCollection.fromJson(response.data);
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

class ThreadCosplayCollectionController extends GetxController
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
      debugPrint('ThreadCosplayCollectionController-get');
      change(null, status: RxStatus.loading());
      final response = await ThreadApi.getCollect(type: 'cosplay', page: 1);
      final data = ThreadCollection.fromJson(response.data);
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
      debugPrint('ThreadCosplayCollectionController-more');
      isLoading(true);
      final response =
          await ThreadApi.getCollect(type: 'cosplay', page: page.value);
      final data = ThreadCollection.fromJson(response.data);
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
      debugPrint('ThreadCosplayCollectionController-reload');
      final response = await ThreadApi.getCollect(type: 'cosplay', page: 1);
      final data = ThreadCollection.fromJson(response.data);
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

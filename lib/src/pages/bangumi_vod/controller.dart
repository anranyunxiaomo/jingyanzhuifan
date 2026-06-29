import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_smart_dialog/flutter_smart_dialog.dart';
import 'package:flutter_svg/svg.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:media_kit/media_kit.dart';
import 'package:xs/protobuf/bangumi.pb.dart';
import 'package:xs/protobuf/danmaku.pb.dart';
import 'package:xs/src/apis/bangumi.dart';
import 'package:xs/src/pages/bangumi_detail/models/bangumi_detail_model.dart';
import 'package:xs/src/pages/bangumi_vod/models/qq_video_model.dart';
import 'package:xs/src/pages/settings/storage/play_history_storage.dart';
import 'package:xs/src/utils/time.dart';
import 'package:xs/src/widgets/danmaku_settings/storage.dart';
import 'package:xs/src/widgets/danmaku_shield/storage.dart';
import 'package:xs/src/utils/app_style.dart';
import 'package:xs/src/utils/color.dart';
import 'package:xs/src/utils/log.dart';
import 'package:xs/src/utils/utils.dart';
import 'package:xs/src/widgets/danmaku_settings/view.dart';
import 'package:xs/src/widgets/danmaku_shield/view.dart';
import 'package:xs/src/widgets/ns_danmaku/danmaku_controller.dart';
import 'package:xs/src/widgets/ns_danmaku/models/danmaku_item.dart';
import 'package:xs/src/widgets/ns_danmaku/utils.dart';
import 'package:xs/src/widgets/player/controller.dart';
import 'package:xs/src/widgets/settings/settings_card.dart';
import 'package:xs/src/widgets/settings/settings_switch.dart';

final box = GetStorage('playHistory');
const String assetName = 'assets/images/no_image.svg';
final Widget noImage = SvgPicture.asset(assetName);

class BangumiVodPageController extends PlayerController
    with StateMixin, WidgetsBindingObserver, GetTickerProviderStateMixin {
  final int pId;
  final int pEpisode;
  BangumiVodPageController({
    required this.pId,
    required this.pEpisode,
  }) {
    rxId = pId.obs;
    rxEpisode = pEpisode.obs;
  }

  late RxInt rxId;
  int get id => rxId.value;
  late RxInt rxEpisode;
  int get episode => rxEpisode.value;

  // 音量
  RxDouble playerVolume = 100.0.obs;

  // 线路数据
  RxList<vod_item_> playUrls = RxList<vod_item_>();

  // 当前线路
  var currentLineIndex = -1;
  var currentLineInfo = ''.obs;

  // 加载失败
  var loadError = false.obs;
  Error? error;

  // 退出
  RxBool leave = false.obs;

  // 导航栏
  final List<Tab> tabs = <Tab>[
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('简介'),
      ),
    ),
    const Tab(
      child: Align(
        alignment: Alignment.center,
        child: Text('评论'),
      ),
    ),
  ];

  late TabController tabController;
  late final AnimationController animationController;
  RxInt tabIndex = 0.obs;

  late final BangumiDetailModel data;
  late final bangumi_episodes_data_ episodeDetail;
  List<bangumi_episodes_data_> episodes = [];
  List<data_> danmakuList = [];
  List<bilibili_danmaku_item_> bilibiliDanmakuList = [];
  List<bilibili_danmaku_item_> bilibiliHmtDanmakuList = [];
  List<BarrageList> qqDanmakuList = [];

  ScrollController playListScrollController = ScrollController();
  ScrollController playListScrollController2 = ScrollController();

  Map<dynamic, dynamic> bangumiInfo = {'episodes': []};

  RxInt lastPosition = 0.obs;

  RxBool playing = true.obs;

  @override
  void onInit() {
    WidgetsBinding.instance.addObserver(this);

    get();

    tabController =
        TabController(vsync: this, length: tabs.length, initialIndex: 0);
    tabController.addListener(() {
      tabIndex(tabController.index);
    });

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );

    super.onInit();
  }

  void listen() {
    int position = 0;
    int inSeconds = 0;

    player.stream.error.listen((event) {
      // if (RegExp('Failed to open').hasMatch(event)) {
      //   SmartDialog.showToast(event);
      // }
      SmartDialog.showToast('播放失败: $event');
    });

    player.stream.completed.listen((event) {
      if (event) {
        showControls();
      }
    });

    player.stream.playing.listen((event) {
      playing(player.state.playing);
      showDanmakuState.value = DanmakuSettingsStorage.danmakuEnable.value;
      bilibiliDanmakuState.value =
          DanmakuSettingsStorage.bilibiliDanmakuEnable.value;
      bilibiliHmtDanmakuState.value =
          DanmakuSettingsStorage.bilibiliHmtDanmakuEnable.value;
      qqDanmakuState.value = DanmakuSettingsStorage.qqDanmakuEnable.value;
      if (showDanmakuState.value && danmakuController is DanmakuController) {
        if (event) {
          int currentPosition = player.state.position.inMilliseconds ~/ 1000;
          if (position != currentPosition) {
            position = currentPosition;
          }
          danmakuController!.resume();
        } else {
          danmakuController!.pause();
        }
      }
    });

    player.stream.position.listen((event) async {
      int currentinSeconds = event.inSeconds;
      if (currentinSeconds > 0 && lastPosition.value > 0) {
        final thisLastPosition = Duration(seconds: lastPosition.value);
        lastPosition(0);
        await player.seek(thisLastPosition);
        debugPrint('跳转到$thisLastPosition');
      }
      if ((inSeconds - currentinSeconds).abs() >= 5) {
        inSeconds = currentinSeconds;
        final date = DateTime.now().millisecondsSinceEpoch;
        bangumiInfo['id'] = id;
        bangumiInfo['title'] = data.title;
        bangumiInfo['date'] = date;
        bangumiInfo['image'] = data.image;
        final episodeInfo = {
          'episode': episode,
          'title': '第$episode集 ${episodeDetail.title}',
          'position': currentinSeconds,
          'date': date,
          'image': episodeDetail.image
        };
        final item = bangumiInfo['episodes'].firstWhere(
          (e) {
            return e['episode'] == episode;
          },
          orElse: () => {},
        );
        if (item.isEmpty) {
          bangumiInfo['episodes'].add(episodeInfo);
          // print(bangumiInfo);
        } else {
          item['position'] = episodeInfo['position'];
          item['date'] = episodeInfo['date'];
          // print(bangumiInfo);
        }
        box.write('$id', bangumiInfo);
        // print(box.getValues());
      }
      if (showDanmakuState.value && danmakuController is DanmakuController) {
        int currentPosition = event.inMilliseconds ~/ 100;
        if (position != currentPosition) {
          position = currentPosition;
          // 默认弹幕
          if (danmakuList.isNotEmpty) {
            final currentDanmakuList = danmakuList.where((e) {
              return double.parse(e.time.toStringAsFixed(1)) ==
                      currentPosition / 10 &&
                  DanmakuShieldStorage.shieldCheck(e.text);
            });
            final currentDanmakuListQueue = currentDanmakuList.map((e) {
              return DanmakuItem(e.text,
                  color: ColorUtil.fromHex(e.color),
                  // time: currentPosition,
                  time: e.time,
                  type: DanmakuUtils.getPosition(e.type));
            }).toList();
            try {
              danmakuController!.addItems(currentDanmakuListQueue);
            } catch (e) {
              debugPrint(e.toString());
            }
          }
          // 哔哩哔哩弹幕
          if (bilibiliDanmakuList.isNotEmpty && bilibiliDanmakuState.value) {
            final currentDanmakuList = bilibiliDanmakuList.where((e) {
              // return (e.progress / 1000).floor() == currentPosition;
              return double.parse((e.progress / 1000).toStringAsFixed(1)) ==
                      currentPosition / 10 &&
                  DanmakuShieldStorage.shieldCheck(e.content);
            });
            final currentDanmakuListQueue = currentDanmakuList.map((e) {
              return DanmakuItem(e.content,
                  color: ColorUtil.decimalToColor(e.color),
                  // time: currentPosition,
                  time: e.progress / 1000,
                  type: DanmakuUtils.getBilibiliPosition(e.mode));
            }).toList();
            try {
              danmakuController!.addItems(currentDanmakuListQueue);
            } catch (e) {
              debugPrint(e.toString());
            }
          }
          // 哔哩哔哩(港澳台)弹幕
          if (bilibiliHmtDanmakuList.isNotEmpty &&
              bilibiliHmtDanmakuState.value) {
            final currentDanmakuList = bilibiliHmtDanmakuList.where((e) {
              // return (e.progress / 1000).floor() == currentPosition;
              return double.parse((e.progress / 1000).toStringAsFixed(1)) ==
                      currentPosition / 10 &&
                  DanmakuShieldStorage.shieldCheck(e.content);
            });
            final currentDanmakuListQueue = currentDanmakuList.map((e) {
              return DanmakuItem(e.content,
                  color: ColorUtil.decimalToColor(e.color),
                  // time: currentPosition,
                  time: e.progress / 1000,
                  type: DanmakuUtils.getBilibiliPosition(e.mode));
            }).toList();
            try {
              danmakuController!.addItems(currentDanmakuListQueue);
            } catch (e) {
              debugPrint(e.toString());
            }
          }
          // 腾讯视频弹幕
          if (qqDanmakuList.isNotEmpty && qqDanmakuState.value) {
            final currentDanmakuList = qqDanmakuList.where((e) {
              // return (int.parse(e.timeOffset ?? '0') / 1000).floor() ==
              //     currentPosition;
              return double.parse((int.parse(e.timeOffset ?? '0') / 1000)
                          .toStringAsFixed(1)) ==
                      currentPosition / 10 &&
                  DanmakuShieldStorage.shieldCheck(e.content);
            });
            final currentDanmakuListQueue = currentDanmakuList.map((e) {
              return DanmakuItem(e.content ?? '一条弹幕',
                  color: Colors.white,
                  // time: currentPosition,
                  time: int.parse(e.timeOffset ?? '0') / 1000,
                  type: DanmakuUtils.getQQPosition(e.rickType ?? 1));
            }).toList();
            try {
              danmakuController!.addItems(currentDanmakuListQueue);
            } catch (e) {
              debugPrint(e.toString());
            }
          }
        }
      }
    });
  }

  // 番剧数据
  void setBangumiData(data) async {
    try {
      debugPrint('BangumiVodController-setBangumiData');
      this.data = data;
      change(data, status: RxStatus.success());
    } catch (e) {
      debugPrint(e.toString());
    }
  }

  // 获取番剧数据
  void getBangumiData() async {
    try {
      debugPrint('BangumiVodController-getBangumiData');
      change(null, status: RxStatus.loading());
      final response = await BangumiApi.getBangumiDetail(id: id);
      if (response.statusCode == 200) {
        final data = BangumiDetailModel.fromJson(response.data);
        this.data = data;
        change(data, status: RxStatus.success());
      } else {
        throw Error();
      }
    } catch (e) {
      debugPrint(e.toString());
      change(null, status: RxStatus.error('error'));
    }
  }

  // 番剧剧集
  void setBangumiEpisodes(episodes) async {
    try {
      debugPrint('BangumiVodController-setBangumiEpisodes');
      this.episodes = episodes;
      episodeDetail = episodes.firstWhere((e) => e.sort == episode);
    } catch (e) {
      debugPrint(e.toString());
    }
  }

  // 获取番剧剧集
  void getBangumiEpisodes() async {
    try {
      debugPrint('BangumiVodController-getBangumiEpisodes');
      final response = await BangumiApi.getBangumiEpisodes(id: id);
      if (response.statusCode == 200) {
        final data = bangumi_episodes_.fromBuffer(response.data);
        episodes.addAll(data.data);
        episodeDetail = episodes.firstWhere((e) => e.sort == episode);
        update();
      } else {
        throw Error();
      }
    } catch (e) {
      debugPrint(e.toString());
    }
  }

  // 获取弹幕
  void getDanmaku() async {
    int thisEpisode = episode;
    int index = 0;
    int length = 3000;
    bool completed = false;
    while (!completed && !leave.value && thisEpisode == episode) {
      try {
        debugPrint('BangumiVodController-getDanmaku-$index');
        final response = await BangumiApi.getDanmaku(
            id: id, episode: episode, skip: index * length);
        if (response.statusCode == 200) {
          final data = danmaku_.fromBuffer(response.data);
          if (data.data.isNotEmpty) {
            danmakuList.addAll(data.data);
            if (data.data.length == length) {
              index += 1;
            } else {
              completed = true;
            }
          } else {
            completed = true;
          }
        } else {
          throw Error();
        }
      } catch (e) {
        completed = true;
        debugPrint(e.toString());
      }
    }
    debugPrint('BangumiVodController-getDanmaku-complete');
  }

  // 获取哔哩哔哩弹幕
  void getBilibiliDanmaku() async {
    int thisEpisode = episode;
    int index = 1;
    bool completed = false;
    while (!completed && !leave.value && thisEpisode == episode) {
      await Future.delayed(const Duration(seconds: 1));
      if (episodes.isNotEmpty) {
        final currentEpisode = getEpisodeData();
        if (currentEpisode.sites.isNotEmpty) {
          bangumi_episodes_sites_ site = currentEpisode.sites.firstWhere(
              (e) => e.site == 'bili_cid',
              orElse: () => bangumi_episodes_sites_());
          if (site.id.isEmpty) {
            completed = true;
            return;
          } else {
            try {
              debugPrint('BangumiVodController-getBilibiliDanmaku-$index');
              final response = await BangumiApi.getBilibiliDanmaku(
                  type: 1, oid: int.parse(site.id), segmentIndex: index);
              if (response.statusCode == 200) {
                final data = bilibili_danmaku_.fromBuffer(response.data);
                if (data.list.isNotEmpty) {
                  final list = Utils.splitList(data.list, 500);
                  for (final item in list) {
                    final list_ = (await compute(
                            DanmakuShieldStorage.defaultShieldCheck, item))
                        .cast<bilibili_danmaku_item_>();
                    bilibiliDanmakuList.addAll(list_);
                  }
                  index += 1;
                } else {
                  completed = true;
                }
              } else {
                completed = true;
                throw Error();
              }
            } catch (e) {
              completed = true;
              debugPrint(e.toString());
            }
          }
        }
      }
    }
    debugPrint('BangumiVodController-getBilibiliDanmaku-complete');
  }

  // 获取哔哩哔哩(港澳台)弹幕
  void getBilibiliHmtDanmaku() async {
    int thisEpisode = episode;
    int index = 1;
    bool completed = false;
    while (!completed && !leave.value && thisEpisode == episode) {
      await Future.delayed(const Duration(seconds: 1));
      if (episodes.isNotEmpty) {
        final currentEpisode = getEpisodeData();
        if (currentEpisode.sites.isNotEmpty) {
          bangumi_episodes_sites_ site = currentEpisode.sites.firstWhere(
              (e) => e.site == 'bili_hmt_cid',
              orElse: () => bangumi_episodes_sites_());
          if (site.id.isEmpty) {
            completed = true;
            return;
          } else {
            try {
              debugPrint('BangumiVodController-getBilibiliHmtDanmaku-$index');
              final response = await BangumiApi.getBilibiliDanmaku(
                  type: 1, oid: int.parse(site.id), segmentIndex: index);
              if (response.statusCode == 200) {
                final data = bilibili_danmaku_.fromBuffer(response.data);
                if (data.list.isNotEmpty) {
                  final list = Utils.splitList(data.list, 500);
                  for (final item in list) {
                    final list_ = (await compute(
                            DanmakuShieldStorage.defaultShieldCheck, item))
                        .cast<bilibili_danmaku_item_>();
                    bilibiliHmtDanmakuList.addAll(list_);
                  }
                  index += 1;
                } else {
                  completed = true;
                }
              } else {
                completed = true;
                throw Error();
              }
            } catch (e) {
              completed = true;
              debugPrint(e.toString());
            }
          }
        }
      }
    }
    debugPrint('BangumiVodController-getBilibiliHmtDanmaku-complete');
  }

  // 获取腾讯视频弹幕
  void getQQDanmaku() async {
    int thisEpisode = episode;
    int index = 1;
    bool completed = false;
    while (!completed && !leave.value && thisEpisode == episode) {
      await Future.delayed(const Duration(seconds: 1));
      if (episodes.isNotEmpty) {
        final currentEpisode = getEpisodeData();
        if (currentEpisode.sites.isNotEmpty) {
          bangumi_episodes_sites_ site = currentEpisode.sites.firstWhere(
              (e) => e.site == 'qq',
              orElse: () => bangumi_episodes_sites_());
          if (site.id.isEmpty) {
            completed = true;
            return;
          } else {
            try {
              debugPrint('BangumiVodController-getQQDanmaku-$index');
              final response =
                  await BangumiApi.getQQDanmaku(id: site.id, page: index);
              if (response.statusCode == 200) {
                final data = QqVideoModel.fromJson(response.data).barrageList;
                if (data!.isNotEmpty) {
                  final list = Utils.splitList(data, 500);
                  for (final item in list) {
                    final list_ = (await compute(
                            DanmakuShieldStorage.defaultShieldCheck, item))
                        .cast<BarrageList>();
                    qqDanmakuList.addAll(list_);
                  }
                  index += 1;
                } else {
                  completed = true;
                }
              } else {
                completed = true;
                throw Error();
              }
            } catch (e) {
              completed = true;
              debugPrint(e.toString());
            }
          }
        }
      }
    }
    debugPrint('BangumiVodController-getQQDanmaku-complete');
  }

  // URL解密
  String urlDecode(str) {
    try {
      return utf8.decode(base64
          .decode(base64.normalize(str.substring(0, 3) + str.substring(4))));
    } catch (e) {
      debugPrint(e.toString());
      return '';
    }
  }

  // 获取视频链接
  void getPlayUrl() async {
    playUrls.clear();
    currentLineInfo.value = '获取中...';
    currentLineIndex = -1;
    final response =
        await BangumiApi.getBangumiEpisodeVod(id: id, episode: episode);
    if (response.statusCode == 200) {
      vod_ data = vod_.fromBuffer(response.data.cast<int>());
      playUrls.value = data.data;
      currentLineIndex = 0;
      currentLineInfo.value = '线路${currentLineIndex + 1}';
      setPlayer();
    } else {
      currentLineInfo.value = '获取失败';
      SmartDialog.showToast('无法读取播放地址');
      return;
    }
    if (playUrls.isEmpty) {
      currentLineInfo.value = '暂无资源';
      SmartDialog.showToast('暂无资源');
    }
  }

  // 设置视频链接
  void setPlayer() async {
    if (playUrls.isNotEmpty) {
      lastPosition(PlayHistoryStorage.getLastPosition(id, episode));
      currentLineInfo.value = '线路${currentLineIndex + 1}';
      Map<String, String> headers = {};
      await player.open(
        Media(
          urlDecode(playUrls[currentLineIndex].url),
          httpHeaders: headers,
        ),
      );

      // final history = box.read(id.toString());
      // if (history != null) {
      //   final thisEpisode = history['episodes'].firstWhere(
      //       (e) => e['episode'].toString() == episode.toString(),
      //       orElse: () => {});
      //   lastPosition(int.parse(thisEpisode['position'].toString()));
      // }

      Log.d('播放链接\r\n：${urlDecode(playUrls[currentLineIndex].url)}');
    }
  }

  // 获取集数据
  bangumi_episodes_data_ getEpisodeData() {
    return episodes.firstWhere((e) => e.sort == episode,
        orElse: () => bangumi_episodes_data_());
  }

  // 切换线路
  void changePlayLine(int index) {
    currentLineIndex = index;
    setPlayer();
  }

  // 刷新
  void reload() async {
    getPlayUrl();
  }

  // 获取数据
  void get() async {
    getPlayUrl();
    danmakuList.clear();
    bilibiliDanmakuList.clear();
    bilibiliHmtDanmakuList.clear();
    qqDanmakuList.clear();
    getDanmaku();
    getBilibiliDanmaku();
    getBilibiliHmtDanmaku();
    getQQDanmaku();
  }

  // 跳转到指定集数位置
  void scrollToIndex() {
    WidgetsBinding.instance.addPostFrameCallback((callback) {
      try {
        final index = episodes.indexWhere((e) => e.sort == episode);
        if (playListScrollController.position.hasPixels) {
          playListScrollController.animateTo(index * 150,
              duration: const Duration(milliseconds: 100),
              curve: Curves.easeIn);
        }
      } catch (e) {
        debugPrint(e.toString());
      }
    });
  }

  /// 底部打开播放器设置
  void showDanmakuSettingsSheet() {
    Utils.showBottomSheet(
      title: '弹幕设置',
      child: ListView(
        padding: AppStyle.edgeInsetsA12,
        children: [
          DanmakuSettingsView(
            playerController: this,
            danmakuController: danmakuController,
            onTapDanmakuShield: () {
              Get.back();
              DanmakuShieldView.showDanmakuShieldBottomSheet();
            },
          ),
        ],
      ),
    );
  }

  void showDanmakuShield() {
    TextEditingController keywordController = TextEditingController();

    void addKeyword() {
      if (keywordController.text.isEmpty) {
        SmartDialog.showToast('请输入关键词');
        return;
      }

      DanmakuShieldStorage.addShieldList(keywordController.text.trim());
      keywordController.text = '';
    }

    Utils.showBottomSheet(
      title: '关键词屏蔽',
      child: ListView(
        padding: AppStyle.edgeInsetsA12,
        children: [
          TextField(
            controller: keywordController,
            decoration: InputDecoration(
              contentPadding: AppStyle.edgeInsetsH12,
              border: const OutlineInputBorder(),
              hintText: '请输入关键词',
              suffixIcon: TextButton.icon(
                onPressed: addKeyword,
                icon: const Icon(Icons.add),
                label: const Text('添加'),
              ),
            ),
            onSubmitted: (e) {
              addKeyword();
            },
          ),
          AppStyle.vGap12,
          Obx(
            () => Text(
              '已添加${DanmakuShieldStorage.shieldList.length}个关键词（点击移除）',
              style: Get.textTheme.titleSmall,
            ),
          ),
          AppStyle.vGap12,
          Obx(
            () => Wrap(
              runSpacing: 12,
              spacing: 12,
              children: DanmakuShieldStorage.shieldList
                  .map(
                    (item) => InkWell(
                      borderRadius: AppStyle.radius24,
                      onTap: () {
                        DanmakuShieldStorage.removeShieldList(item);
                      },
                      child: Container(
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.grey),
                          borderRadius: AppStyle.radius24,
                        ),
                        padding: AppStyle.edgeInsetsH12.copyWith(
                          top: 4,
                          bottom: 4,
                        ),
                        child: Text(
                          item,
                          style: Get.textTheme.bodyMedium,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }

  void showPlayerSettingsSheet() {
    Utils.showBottomSheet(
      scrollControlDisabledMaxHeightRatio: 0.7,
      title: '播放设置',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        child: ListView(
          padding: AppStyle.edgeInsetsV12,
          children: [
            Padding(
              padding: AppStyle.edgeInsetsA12.copyWith(top: 0),
              child: Text(
                '画面尺寸',
                style: Get.textTheme.titleSmall,
              ),
            ),
            SettingsCard(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Obx(
                    () => SettingsSwitch(
                      title: '适应',
                      value: scaleMode.value == 0,
                      onChanged: (e) {
                        updateScaleMode(0);
                      },
                    ),
                  ),
                  AppStyle.divider,
                  Obx(
                    () => SettingsSwitch(
                      title: '拉伸',
                      value: scaleMode.value == 1,
                      onChanged: (e) {
                        updateScaleMode(1);
                      },
                    ),
                  ),
                  AppStyle.divider,
                  Obx(
                    () => SettingsSwitch(
                      title: '铺满',
                      value: scaleMode.value == 2,
                      onChanged: (e) {
                        updateScaleMode(2);
                      },
                    ),
                  ),
                  AppStyle.divider,
                  Obx(
                    () => SettingsSwitch(
                      title: '16:9',
                      value: scaleMode.value == 3,
                      onChanged: (e) {
                        updateScaleMode(3);
                      },
                    ),
                  ),
                  AppStyle.divider,
                  Obx(
                    () => SettingsSwitch(
                      title: '4:3',
                      value: scaleMode.value == 4,
                      onChanged: (e) {
                        updateScaleMode(4);
                      },
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: AppStyle.edgeInsetsA12.copyWith(top: 12),
              child: Text(
                '播放速度',
                style: Get.textTheme.titleSmall,
              ),
            ),
            SettingsCard(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: speedsList.map((rate) {
                  return Obx(
                    () => SizedBox(
                      child: Column(
                        children: [
                          SettingsSwitch(
                            title: '${rate}X',
                            value: playerSpeed.value == rate,
                            onChanged: (e) {
                              setPlaybackSpeed(rate);
                            },
                          ),
                          AppStyle.divider,
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void showEpisodesSheet() {
    Utils.showRightDialog(
      title: '选集',
      width: 400,
      useSystem: true,
      child: Builder(builder: (builder) {
        WidgetsBinding.instance.addPostFrameCallback((callback) {
          if (playListScrollController2.position.hasPixels) {
            final index = episodes.indexWhere((e) => e.sort == episode);
            playListScrollController2.animateTo(index * 100,
                duration: const Duration(milliseconds: 100),
                curve: Curves.easeIn);
          }
        });
        return ListView(
          controller: playListScrollController2,
          children: episodes.map((item) {
            return Material(
              child: InkWell(
                onTap: () {
                  if (episode == item.sort) {
                    return;
                  }
                  rxEpisode(item.sort);
                  debugPrint('切换到第$episode集');
                  player.stop();
                  danmakuController?.clear();
                  get();
                  Utils.hideRightDialog();
                },
                child: Obx(() {
                  return Container(
                    height: 100,
                    decoration: BoxDecoration(
                        color: episode == item.sort
                            ? Colors.grey.withOpacity(0.2)
                            : Colors.transparent),
                    padding: const EdgeInsets.all(10),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          constraints: const BoxConstraints(maxWidth: 150),
                          decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(7),
                              color: Colors.grey.withOpacity(0.1)),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(7),
                            child: Stack(
                              alignment: AlignmentDirectional.bottomCenter,
                              // fit: StackFit.expand,
                              children: [
                                Container(
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(7),
                                  ),
                                  child: item.image.isNotEmpty
                                      ? Image.network(
                                          item.image,
                                          width: double.infinity,
                                          height: double.infinity,
                                          fit: BoxFit.cover,
                                          errorBuilder:
                                              (context, error, stackTrace) {
                                            return noImage;
                                          },
                                        )
                                      : noImage,
                                ),
                                Positioned(
                                  bottom: 5,
                                  right: 0,
                                  child: Row(
                                    children: [
                                      Visibility(
                                        visible: true,
                                        maintainSize: false,
                                        maintainSemantics: false,
                                        maintainAnimation: false,
                                        child: Container(
                                          padding: const EdgeInsets.only(
                                              top: 1,
                                              left: 5,
                                              right: 5,
                                              bottom: 3),
                                          margin:
                                              const EdgeInsets.only(right: 5),
                                          decoration: BoxDecoration(
                                              borderRadius:
                                                  BorderRadius.circular(5),
                                              color:
                                                  Colors.black.withAlpha(120)),
                                          child: Text(
                                            item.status ? '有资源' : '无资源',
                                            style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 12),
                                          ),
                                        ),
                                      ),
                                      Visibility(
                                        visible: item.duration > 0,
                                        maintainSize: false,
                                        maintainSemantics: false,
                                        maintainAnimation: false,
                                        child: Container(
                                          padding: const EdgeInsets.only(
                                              top: 1,
                                              left: 5,
                                              right: 5,
                                              bottom: 3),
                                          margin:
                                              const EdgeInsets.only(right: 5),
                                          decoration: BoxDecoration(
                                              borderRadius:
                                                  BorderRadius.circular(5),
                                              color:
                                                  Colors.black.withAlpha(120)),
                                          child: Text(
                                            Duration(seconds: item.duration)
                                                .toString()
                                                .split('.')
                                                .first,
                                            style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 12),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(
                          width: 10,
                        ),
                        Expanded(
                            child: Column(
                          mainAxisAlignment: MainAxisAlignment.start,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '第${item.sort}集 ${item.title}',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 15),
                            ),
                            Opacity(
                              opacity: 0.7,
                              child: Text(
                                Time.dateTimeFormat(item.airdate.toInt()),
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 11,
                                ),
                              ),
                            ),
                            Opacity(
                              opacity: 0.7,
                              child: Text(
                                item.overview,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 11,
                                ),
                              ),
                            )
                          ],
                        ))
                      ],
                    ),
                  );
                }),
              ),
            );
          }).toList(),
        );
      }),
    );
  }

  void showPlayUrlsSheet() {
    Utils.showBottomSheet(
      title: '切换线路',
      child: ListView.builder(
        itemCount: playUrls.length,
        itemBuilder: (_, i) {
          return RadioListTile(
            value: i,
            groupValue: currentLineIndex,
            title: Text('线路${i + 1}'),
            subtitle: Text(urlDecode(playUrls[i].url)),
            secondary: Text(
              playUrls[i].caption,
            ),
            onChanged: (e) {
              Get.back();
              //currentLineIndex = i;
              //setPlayer();
              changePlayLine(i);
            },
          );
        },
      ),
    );
  }

  void showVolumeSlider(BuildContext targetContext) {
    SmartDialog.showAttach(
      targetContext: targetContext,
      alignment: Alignment.topCenter,
      displayTime: const Duration(seconds: 3),
      maskColor: const Color(0x00000000),
      builder: (context) {
        return Container(
          decoration: BoxDecoration(
            borderRadius: AppStyle.radius12,
            color: Theme.of(context).cardColor,
          ),
          padding: AppStyle.edgeInsetsA4,
          child: SizedBox(
            width: 200,
            child: Obx(() => Slider(
                  min: 0,
                  max: 100,
                  value: playerVolume.value,
                  onChanged: (newValue) {
                    player.setVolume(newValue);
                    playerVolume(newValue);
                    // AppSettingsController.instance.setPlayerVolume(newValue);
                  },
                )),
          ),
        );
      },
    );
  }

  @override
  void onClose() {
    WidgetsBinding.instance.removeObserver(this);
    danmakuController = null;
    leave(true);
    super.onClose();
  }
}

import 'dart:io';
import 'dart:math';

import 'package:floating/floating.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/svg.dart';
import 'package:get/get.dart';
import 'package:media_kit_video/media_kit_video.dart';
import 'package:xs/protobuf/bangumi.pb.dart';
import 'package:xs/src/pages/bangumi_detail/models/bangumi_detail_model.dart';
import 'package:xs/src/pages/bangumi_vod/controller.dart';
import 'package:xs/src/pages/bangumi_vod/views/comments.dart';
import 'package:xs/src/pages/bangumi_vod/views/index.dart';
import 'package:xs/src/widgets/drag_to_move_bar.dart';
import 'package:xs/src/widgets/navbar.dart';
import 'package:xs/src/widgets/player/controls.dart';

const String assetName = 'assets/images/no_image.svg';
final Widget noImage = SvgPicture.asset(assetName);

class BangumiVodPage extends StatefulWidget {
  const BangumiVodPage({super.key});

  @override
  State<StatefulWidget> createState() {
    return BangumiVodPageState();
  }
}

class BangumiVodPageState extends State<BangumiVodPage> {
  @override
  Widget build(BuildContext context) {
    final int id;
    final BangumiDetailModel? data;
    final List<bangumi_episodes_data_>? episodes;
    final int episode;
    id = Get.arguments['id'];
    data = Get.arguments['data'];
    episodes = Get.arguments['episodes'];
    episode = Get.arguments['episode'];
    return GetBuilder(
        id: Get.currentRoute,
        init: BangumiVodPageController(pId: id, pEpisode: episode),
        builder: (controller) {
          if (data != null) {
            controller.setBangumiData(data);
          } else {
            controller.getBangumiData();
          }
          if (episodes != null) {
            controller.setBangumiEpisodes(episodes);
          } else {
            controller.getBangumiEpisodes();
          }
          if (mounted) {
            controller.listen();
          }
          final page = Obx(() {
            if (controller.fullScreenState.value) {
              return PopScope(
                canPop: false,
                onPopInvoked: (e) {
                  controller.exitFull();
                },
                child: Scaffold(
                  body: buildMediaPlayer(controller),
                ),
              );
            } else {
              return buildPageUI(controller);
            }
          });
          if (!Platform.isAndroid) {
            return page;
          }
          return PiPSwitcher(
            floating: controller.pip,
            childWhenDisabled: page,
            childWhenEnabled: buildMediaPlayer(controller),
          );
        });
  }

  Widget buildPageUI(BangumiVodPageController controller) {
    return OrientationBuilder(
      builder: (context, orientation) {
        RxDouble appBarHeight = 1.0.obs;
        RxInt scrollHeight = 0.obs;
        RxBool scrollStatus = true.obs;
        return Scaffold(
          extendBody: true,
          appBar: PreferredSize(
            preferredSize: Size(MediaQuery.of(context).size.width, 0),
            child: AppBar(backgroundColor: Colors.black),
          ),
          body: controller.obx((state) {
            ScrollController nestedScrollViewScrollController =
                ScrollController();
            return DefaultTabController(
              length: controller.tabs.length,
              child: NestedScrollView(
                controller: nestedScrollViewScrollController,
                body: NotificationListener<ScrollNotification>(
                  onNotification: (notification) {
                    final pixels = notification.metrics.pixels.toInt();
                    if ((pixels - scrollHeight.value).abs() >= 50) {
                      final lastScrollStatus = scrollStatus.value;
                      if (pixels > scrollHeight.value) {
                        if (notification.depth == 1 &&
                            lastScrollStatus != false) {
                          scrollStatus(false);
                          controller.animationController.forward();
                          debugPrint('向下');
                        }
                      } else if (pixels < scrollHeight.value) {
                        if (lastScrollStatus != true) {
                          scrollStatus(true);
                          controller.animationController.reverse();
                          debugPrint('向上');
                        }
                      }
                      scrollHeight(pixels);
                    }
                    return false;
                  },
                  child: TabBarView(
                    controller: controller.tabController,
                    children: [
                      BangumiVodIndexView(
                        controller: controller,
                      ),
                      BangumiVodCommentsView(
                        bangumiVodPageController: controller,
                      ),
                    ],
                  ),
                ),
                headerSliverBuilder: (context, innerBoxIsScrolled) {
                  double expandedHeight = min(
                      (MediaQuery.of(context).size.width * 9 / 16) + 50, 450);
                  return [
                    SliverOverlapAbsorber(
                      sliver: Obx(() {
                        return SliverAppBar(
                          title: Obx(() {
                            return CustomDragToMoveArea(
                              child: Opacity(
                                opacity:
                                    max(min(appBarHeight.value.abs(), 1.0), 0),
                                child: Offstage(
                                  offstage:
                                      appBarHeight.value > 0.3 ? false : true,
                                  child: Center(
                                    child: TextButton(
                                      onPressed: () {
                                        controller.player.play();
                                      },
                                      child: Wrap(
                                        spacing: 5,
                                        alignment: WrapAlignment.center,
                                        runAlignment: WrapAlignment.center,
                                        children: [
                                          const Icon(
                                            Icons.play_arrow,
                                            size: 20,
                                          ),
                                          Text('${state?.title}')
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            );
                          }),
                          pinned: true,
                          automaticallyImplyLeading: false,
                          floating: true,
                          snap: false,
                          // expandedHeight: 270,
                          expandedHeight:
                              nestedScrollViewScrollController.position.pixels >
                                      0
                                  ? 50
                                  : expandedHeight,
                          collapsedHeight: controller.playing.value
                              ? expandedHeight - 50
                              : 50,
                          toolbarHeight: 50,
                          backgroundColor:
                              Theme.of(context).scaffoldBackgroundColor,
                          surfaceTintColor:
                              Theme.of(context).colorScheme.inverseSurface,
                          flexibleSpace: LayoutBuilder(
                            builder: (context, constraints) {
                              WidgetsBinding.instance.addPostFrameCallback((_) {
                                double height = 1 -
                                    ((constraints.biggest.height.floor() -
                                            MediaQuery.of(context).padding.top -
                                            100) /
                                        expandedHeight.floor());
                                appBarHeight(height <= 0.5 ? 0 : height);
                              });
                              return Obx(() {
                                bool visible = appBarHeight.value.floor() == 1
                                    ? false
                                    : true;
                                return Visibility(
                                  visible: visible,
                                  child: Opacity(
                                    opacity: min(
                                        max((appBarHeight.value - 1).abs(),
                                            0.0),
                                        1.0),
                                    child: FlexibleSpaceBar(
                                      background: Stack(
                                        children: [
                                          Container(
                                            padding: EdgeInsets.only(
                                                top: MediaQuery.of(context)
                                                    .padding
                                                    .top,
                                                bottom: 50),
                                            child: Stack(
                                              children: [
                                                buildPhoneUI(
                                                    context, controller),
                                              ],
                                            ),
                                          )
                                        ],
                                      ),
                                      collapseMode: CollapseMode.pin,
                                    ),
                                  ),
                                );
                              });
                            },
                          ),
                          bottom: PreferredSize(
                            preferredSize: const Size.fromHeight(50),
                            child: Material(
                              color: Colors.transparent,
                              // color: Theme.of(context).scaffoldBackgroundColor,
                              child: CustomDragToMoveArea(
                                child: TabBar(
                                  controller: controller.tabController,
                                  tabAlignment: TabAlignment.start,
                                  isScrollable: true,
                                  indicatorSize: TabBarIndicatorSize.label,
                                  dividerColor:
                                      Theme.of(context).scaffoldBackgroundColor,
                                  tabs: controller.tabs,
                                ),
                              ),
                            ),
                          ),
                        );
                      }),
                      handle: NestedScrollView.sliverOverlapAbsorberHandleFor(
                          context),
                    ),
                  ];
                },
              ),
            );
          }),
          bottomNavigationBar: Stack(
            alignment: Alignment.bottomCenter,
            children: [
              SlideTransition(
                position: Tween(begin: Offset.zero, end: const Offset(0, 1.0))
                    .animate(controller.animationController),
                child: NavBar(
                  children: [
                    NavItem(
                        icon: Icons.arrow_back,
                        title: '返回',
                        onTap: () => Get.back()),
                  ],
                ),
              )
            ],
          ),
        );
      },
    );
  }

  Widget buildPhoneUI(
      BuildContext context, BangumiVodPageController controller) {
    return Stack(
      children: [
        SizedBox(
          // constraints: const BoxConstraints(maxHeight: 220),
          width: MediaQuery.of(context).size.width,
          // height: 270,
          // child: buildMediaPlayer(controller),
          child: AspectRatio(
            aspectRatio: 16 / 9,
            child: buildMediaPlayer(controller),
          ),
        ),
        const SizedBox(
          height: 50,
        )
      ],
    );
  }

  Widget buildMediaPlayer(BangumiVodPageController controller) {
    return Stack(
      children: [
        Video(
          key: controller.globalPlayerKey,
          controller: controller.videoController,
          pauseUponEnteringBackgroundMode: true,
          resumeUponEnteringForegroundMode: true,
          controls: (state) {
            return playerControls(state, controller);
          },
          aspectRatio: controller.aspectRatio,
          fit: controller.boxFit,
        ),
        // Obx(
        //   () => Visibility(
        //     visible: controller.playUrls.isEmpty,
        //     child: const Center(
        //       child: Text(
        //         '暂无资源',
        //         style: TextStyle(fontSize: 16, color: Colors.white),
        //       ),
        //     ),
        //   ),
        // ),
      ],
    );
  }
}

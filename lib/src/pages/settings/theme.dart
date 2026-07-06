import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:xs/src/pages/settings/controller.dart';
import 'package:xs/src/pages/settings/storage/theme_storage.dart';
import 'package:xs/src/utils/app_style.dart';
import 'package:xs/src/widgets/drag_to_move_bar.dart';
import 'package:xs/src/widgets/multi_sliver_compat/sliver_persistent_header_delegate.dart';
import 'package:xs/src/widgets/navbar.dart';
import 'package:xs/src/widgets/settings/settings_card.dart';
import 'package:xs/src/widgets/settings/settings_switch.dart';

class ThemeSettingsPage extends StatelessWidget {
  const ThemeSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    RxInt scrollHeight = 0.obs;
    RxBool scrollStatus = true.obs;
    RxDouble maxShrinkOpacity = 1.0.obs;
    return GetBuilder(
        init: ThemeSettingsPageController(),
        builder: (controller) {
          return Scaffold(
            extendBody: true,
            backgroundColor: Theme.of(context).dialogBackgroundColor,
            body: SafeArea(
              top: true,
              bottom: false,
              maintainBottomViewPadding: false,
              child: NestedScrollView(
                floatHeaderSlivers: true,
                body: NotificationListener<ScrollNotification>(
                  onNotification: (notification) {
                    final pixels = notification.metrics.pixels.toInt();
                    if ((pixels - scrollHeight.value).abs() >= 50) {
                      final lastScrollStatus = scrollStatus.value;
                      if (pixels > scrollHeight.value) {
                        if (notification.depth > 0 &&
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
                  child: CustomScrollView(
                    shrinkWrap: true,
                    controller: ScrollController(),
                    slivers: [
                      SliverToBoxAdapter(
                        child: ListView(
                          shrinkWrap: true,
                          padding: AppStyle.edgeInsetsA12,
                          children: [
                            Padding(
                              padding: AppStyle.edgeInsetsA12.copyWith(top: 50),
                              child: Text(
                                '显示主题',
                                style: Get.textTheme.titleSmall,
                              ),
                            ),
                            SettingsCard(
                              child: Obx(
                                () => Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    RadioListTile<int>(
                                      title: const Text(
                                        '跟随系统',
                                      ),
                                      visualDensity: VisualDensity.compact,
                                      value: 0,
                                      contentPadding: AppStyle.edgeInsetsH12,
                                      groupValue:
                                          ThemeSettingsStorage.themeMode.value,
                                      onChanged: (e) {
                                        ThemeSettingsStorage.setThemeMode(
                                            e ?? 0);
                                      },
                                    ),
                                    AppStyle.divider,
                                    RadioListTile<int>(
                                      title: const Text(
                                        '浅色模式',
                                      ),
                                      visualDensity: VisualDensity.compact,
                                      value: 1,
                                      contentPadding: AppStyle.edgeInsetsH12,
                                      groupValue:
                                          ThemeSettingsStorage.themeMode.value,
                                      onChanged: (e) {
                                        ThemeSettingsStorage.setThemeMode(
                                            e ?? 1);
                                      },
                                    ),
                                    AppStyle.divider,
                                    RadioListTile<int>(
                                      title: const Text(
                                        '深色模式',
                                      ),
                                      visualDensity: VisualDensity.compact,
                                      value: 2,
                                      contentPadding: AppStyle.edgeInsetsH12,
                                      groupValue:
                                          ThemeSettingsStorage.themeMode.value,
                                      onChanged: (e) {
                                        ThemeSettingsStorage.setThemeMode(
                                            e ?? 2);
                                      },
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            AppStyle.vGap12,
                            Padding(
                              padding: AppStyle.edgeInsetsA12,
                              child: Text(
                                '主题颜色',
                                style: Get.textTheme.titleSmall,
                              ),
                            ),
                            SettingsCard(
                              child: Obx(
                                () => Column(
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    SettingsSwitch(
                                      value:
                                          ThemeSettingsStorage.isDynamic.value,
                                      title: '动态取色',
                                      onChanged: (e) {
                                        ThemeSettingsStorage.setIsDynamic(e);
                                        Get.forceAppUpdate();
                                      },
                                    ),
                                    if (!ThemeSettingsStorage.isDynamic.value)
                                      AppStyle.divider,
                                    if (!ThemeSettingsStorage.isDynamic.value)
                                      Padding(
                                        padding: AppStyle.edgeInsetsA12,
                                        child: Wrap(
                                          spacing: 8,
                                          runSpacing: 8,
                                          children: <Color>[
                                            const Color(0xffEF5350),
                                            const Color(0xff3498db),
                                            const Color(0xffF06292),
                                            const Color(0xff9575CD),
                                            const Color(0xff26C6DA),
                                            const Color(0xff26A69A),
                                            const Color(0xffFFF176),
                                            const Color(0xffFF9800),
                                          ]
                                              .map(
                                                (e) => GestureDetector(
                                                  onTap: () {
                                                    ThemeSettingsStorage
                                                        .setStyleColor(e.value);
                                                    Get.forceAppUpdate();
                                                  },
                                                  child: Container(
                                                    width: 36,
                                                    height: 36,
                                                    decoration: BoxDecoration(
                                                      color: e,
                                                      borderRadius:
                                                          AppStyle.radius4,
                                                      border: Border.all(
                                                        color: Colors.grey
                                                            .withOpacity(.2),
                                                        width: 1,
                                                      ),
                                                    ),
                                                    child: Obx(
                                                      () => Center(
                                                        child: Icon(
                                                          Icons.check,
                                                          color: ThemeSettingsStorage
                                                                      .styleColor
                                                                      .value ==
                                                                  e.value
                                                              ? Colors.white
                                                              : Colors
                                                                  .transparent,
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              )
                                              .toList(),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      )
                    ],
                  ),
                ),
                headerSliverBuilder: (context, innerBoxIsScrolled) {
                  return [
                    SliverOverlapAbsorber(
                      handle: NestedScrollView.sliverOverlapAbsorberHandleFor(
                          context),
                      sliver: SliverPersistentHeader(
                          pinned: true,
                          delegate: CustomSliverPersistentHeaderDelegate(
                            onMaxOffset: (offset) {
                              maxShrinkOpacity(1 - offset);
                            },
                            child: Material(
                              color: Theme.of(context).dialogBackgroundColor,
                              child: CustomDragToMoveArea(
                                child: Obx(
                                  () {
                                    return Opacity(
                                      opacity: maxShrinkOpacity.value,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 10, vertical: 5),
                                        constraints:
                                            const BoxConstraints(minHeight: 50),
                                        color: Theme.of(context)
                                            .dialogBackgroundColor,
                                        child: Row(
                                          children: [
                                            const Expanded(
                                              child: Text(
                                                '外观设置',
                                                style: TextStyle(fontSize: 16),
                                              ),
                                            ),
                                            closeWindowButton(
                                                positioned: false,
                                                padding: const EdgeInsets.only(
                                                    left: 10)),
                                          ],
                                        ),
                                      ),
                                    );
                                  },
                                ),
                              ),
                            ),
                          )),
                    ),
                  ];
                },
              ),
            ),
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
        });
  }
}

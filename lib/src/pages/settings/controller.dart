import 'package:flutter/material.dart';
import 'package:get/get.dart';

class ThemeSettingsPageController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  late final AnimationController animationController;

  @override
  void onInit() {
    super.onInit();

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
  }

  @override
  void dispose() {
    animationController.dispose();
    super.dispose();
  }
}

class AccountSettingsPageController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  late final AnimationController animationController;

  @override
  void onInit() {
    super.onInit();

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
  }

  @override
  void dispose() {
    animationController.dispose();
    super.dispose();
  }
}

class DanmakuSettingsPageController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  late final AnimationController animationController;

  @override
  void onInit() {
    super.onInit();

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
  }

  @override
  void dispose() {
    animationController.dispose();
    super.dispose();
  }
}

class PlayHistorySettingsPageController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  late final AnimationController animationController;

  @override
  void onInit() {
    super.onInit();

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
  }

  @override
  void dispose() {
    animationController.dispose();
    super.dispose();
  }
}

import 'package:xs/src/config.dart';
import 'package:get_storage/get_storage.dart';

class InfoSettingsPageController extends GetxController
    with StateMixin, GetTickerProviderStateMixin {
  late final AnimationController animationController;
  late final TextEditingController proxyController;

  @override
  void onInit() {
    super.onInit();

    animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );

    proxyController = TextEditingController();
    final box = GetStorage();
    proxyController.text = box.read('custom_proxy') ?? '';
  }

  void saveProxy(String val) {
    final box = GetStorage();
    box.write('custom_proxy', val.trim());
    AppConfig.customProxy(val.trim());
  }

  @override
  void dispose() {
    animationController.dispose();
    proxyController.dispose();
    super.dispose();
  }
}

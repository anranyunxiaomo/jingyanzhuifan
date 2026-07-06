import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:xs/src/utils/utils.dart';

class PlayHistoryStorage {
  static GetStorage box = GetStorage('playHistory');

  static void init() {
    history(box.getValues().toList());
  }

  // 历史记录
  static dynamic history = [].obs;

  // 清空历史记录
  static void clean() async {
    var result = await Utils.showAlertDialog('确定要清空观看记录吗?', title: '清空观看记录');
    if (!result) {
      return;
    }
    box.erase();
    history(box.getValues().toList());
  }

  // 删除历史记录
  static void remove(id) async {
    box.remove(id.toString());
    history(box.getValues().toList());
  }

  // 获取历史记录
  static int getLastPosition(id, episode) {
    final history = box.read(id.toString());
    if (history != null) {
      final thisEpisode = history['episodes'].firstWhere(
          (e) => e['episode'].toString() == episode.toString(),
          orElse: () => {});
      return int.parse((thisEpisode['position'] ?? 0).toString());
    }
    return 0;
  }
}

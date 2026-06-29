import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:xs/src/pages/search_panel/controller.dart';
import 'package:xs/src/widgets/drag_to_move_bar.dart';

class SearchPanelPage extends StatefulWidget {
  const SearchPanelPage({super.key});

  @override
  State<SearchPanelPage> createState() => _SearchPanelPageState();
  static final RouteObserver<PageRoute> routeObserver =
      RouteObserver<PageRoute>();
}

class _SearchPanelPageState extends State<SearchPanelPage> with RouteAware {
  final SearchPanelController _searchController =
      Get.put(SearchPanelController());

  @override
  void initState() {
    super.initState();
  }

  @override
  // 返回当前页面时
  void didPopNext() async {
    _searchController.searchFocusNode.requestFocus();
    super.didPopNext();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    SearchPanelPage.routeObserver
        .subscribe(this, ModalRoute.of(context) as PageRoute);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: false,
      appBar: PreferredSize(
          preferredSize: const Size.fromHeight(50),
          child: CustomDragToMoveArea(
              child: AppBar(
            shape: Border(
              bottom: BorderSide(
                color: Theme.of(context).dividerColor.withOpacity(0.08),
                width: 1,
              ),
            ),
            titleSpacing: 0,
            leading: IconButton(
              onPressed: () {
                Get.back();
              },
              icon: const Icon(
                Icons.arrow_back,
                size: 22,
              ),
            ),
            actions: [
              IconButton(
                onPressed: () => _searchController.submit(),
                icon: const Icon(Icons.search, size: 22),
              ),
              const SizedBox(width: 10)
            ],
            title: Obx(
              () => TextField(
                autofocus: true,
                focusNode: _searchController.searchFocusNode,
                controller: _searchController.controller.value,
                textAlignVertical: TextAlignVertical.center,
                textInputAction: TextInputAction.search,
                style: const TextStyle(textBaseline: TextBaseline.alphabetic),
                onChanged: (value) => _searchController.onChange(value),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: _searchController.hintText,
                  hintStyle:
                      const TextStyle(textBaseline: TextBaseline.alphabetic),
                  border: InputBorder.none,
                  // contentPadding: const EdgeInsets.only(top: 10),
                  contentPadding: EdgeInsets.zero,
                  suffixIcon: IconButton(
                    icon: Icon(
                      Icons.clear,
                      size: 22,
                      color: Theme.of(context).colorScheme.outline,
                    ),
                    onPressed: () => _searchController.onClear(),
                  ),
                ),
                onSubmitted: (String value) => _searchController.submit(),
              ),
            ),
          ))),
      body: const SingleChildScrollView(
        child: Column(
          children: [
            SizedBox(height: 12),
          ],
        ),
      ),
    );
  }
}

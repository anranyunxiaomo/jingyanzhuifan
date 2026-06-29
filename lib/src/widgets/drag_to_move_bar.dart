import 'dart:io';

import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

/// A widget for drag to move window.
///
/// When you have hidden the title bar, you can add this widget to move the window position.
///
/// {@tool snippet}
///
/// The sample creates a red box, drag the box to move the window.
///
/// ```dart
/// DragToMoveArea(
///   child: Container(
///     width: 300,
///     height: 32,
///     color: Colors.red,
///   ),
/// )
/// ```
/// {@end-tool}
class CustomDragToMoveArea extends StatelessWidget {
  const CustomDragToMoveArea({
    super.key,
    this.drag = true,
    required this.child,
  });

  final Widget child;
  final bool drag;

  @override
  Widget build(BuildContext context) {
    if (drag) {
      return GestureDetector(
        behavior: HitTestBehavior.translucent,
        onPanStart: (details) {
          windowManager.startDragging();
        },
        child: child,
      );
    } else {
      return child;
    }
  }
}

Widget closeWindowButton(
    {bool positioned = true, EdgeInsetsGeometry padding = EdgeInsets.zero}) {
  if ((Platform.isWindows || Platform.isLinux || Platform.isMacOS)) {
    if (positioned) {
      return Positioned(
          right: 0,
          child: Padding(
            padding: padding,
            child: CloseButton(
              onPressed: () => windowManager.close(),
              style: const ButtonStyle(
                  mouseCursor: WidgetStateMouseCursor.clickable),
            ),
          ));
    } else {
      return Padding(
        padding: padding,
        child: CloseButton(
          onPressed: () => windowManager.close(),
          style:
              const ButtonStyle(mouseCursor: WidgetStateMouseCursor.clickable),
        ),
      );
    }
  } else {
    return Container();
  }
}

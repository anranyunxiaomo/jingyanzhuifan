import 'package:flutter/material.dart';

import '../danmaku_stroke_text.dart';

class ScrollItemView extends StatefulWidget {
  final String text;
  final Color color;
  final double fontSize;
  final double duration;
  final double y;
  final double begin;
  final double end;
  final bool border;
  final Size size;
  final double strokeWidth;
  final FontWeight fontWeight;
  final double fontHeight;
  final Function(String)? onComplete;
  final Function(AnimationController)? onCreated;
  final bool self;
  const ScrollItemView({
    required this.text,
    this.fontSize = 16,
    this.duration = 10,
    this.color = Colors.white,
    this.y = 0,
    this.begin = 0,
    this.end = -1,
    this.size = Size.zero,
    this.border = true,
    this.strokeWidth = 2.0,
    this.fontWeight = FontWeight.normal,
    this.fontHeight = 1.0,
    this.onComplete,
    this.onCreated,
    this.self = true,
    required UniqueKey key,
  }) : super(key: key);

  @override
  State<ScrollItemView> createState() => _ScrollItemViewState();
}

class _ScrollItemViewState extends State<ScrollItemView>
    with SingleTickerProviderStateMixin {
  late AnimationController controller;
  bool get isComplete => controller.isCompleted;
  // late Animation<Offset> _animation;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    controller = AnimationController(
      duration: Duration(seconds: widget.duration.floor()),
      vsync: this,
    );

    controller.addStatusListener(statusUpdate);

    // _animation = Tween(
    //         begin: Offset(widget.begin, widget.y),
    //         end: Offset(widget.end, widget.y))
    //     .animate(controller);

    // final width = WidgetsBinding
    //     .instance.platformDispatcher.implicitView?.display.size.width;
    double width = MediaQueryData.fromView(
            WidgetsBinding.instance.platformDispatcher.views.first)
        .size
        .width;
    _animation =
        Tween(end: width + 10, begin: -widget.size.width).animate(controller)
          ..addListener(
            () {
              setState(() {});
            },
          );

    widget.onCreated?.call(controller);
    controller.forward();
  }

  void statusUpdate(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      widget.onComplete?.call(widget.key.hashCode.toString());
    }
  }

  @override
  void dispose() {
    controller.removeStatusListener(statusUpdate);
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // SlideTransition
    // Positioned
    return Positioned(
      top: widget.y * widget.size.height,
      right: _animation.value,
      // position: _animation,
      child: Container(
        decoration: BoxDecoration(
            border:
                widget.self ? Border.all(color: widget.color, width: 1) : null),
        height: widget.size.height,
        width: widget.size.width,
        child: DanmakuStrokeText(
          widget.text,
          color: widget.color,
          fontSize: widget.fontSize,
          strokeWidth: widget.strokeWidth,
          fontWeight: widget.fontWeight,
          fontHeight: widget.fontHeight,
          border: widget.border,
        ),
      ),
    );
  }
}

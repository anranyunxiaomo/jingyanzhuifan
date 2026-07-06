import 'package:flutter/material.dart';

class DanmakuStrokeText extends StatelessWidget {
  final String text;
  final TextAlign textAlign;
  final Color color;
  final double fontSize;
  final double strokeWidth;
  final FontWeight fontWeight;
  final double fontHeight;
  final bool self;
  final bool border;
  const DanmakuStrokeText(this.text,
      {super.key,
      this.textAlign = TextAlign.left,
      this.color = Colors.white,
      this.fontSize = 16,
      this.strokeWidth = 2.0,
      this.fontWeight = FontWeight.normal,
      this.fontHeight = 1.0,
      this.self = false,
      this.border = true});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        debugPrint('点击弹幕');
      },
      child: Container(
        decoration: BoxDecoration(
            border: self ? Border.all(color: Colors.white, width: 1) : null),
        child: Stack(
          children: <Widget>[
            if (border)
              Text(
                text,
                softWrap: false,
                textAlign: textAlign,
                style: TextStyle(
                  fontSize: fontSize,
                  overflow: TextOverflow.visible,
                  fontWeight: fontWeight,
                  height: fontHeight,
                  foreground: Paint()
                    ..style = PaintingStyle.stroke
                    ..strokeWidth = strokeWidth
                    ..strokeCap = StrokeCap.round
                    ..strokeJoin = StrokeJoin.round
                    ..color = getBorderColor(color),
                ),
              ),
            Text(
              text,
              softWrap: false,
              textAlign: textAlign,
              style: TextStyle(
                  fontSize: fontSize,
                  fontWeight: fontWeight,
                  color: color,
                  overflow: TextOverflow.visible,
                  height: fontHeight),
            ),
          ],
        ),
      ),
    );
  }

  //double get strokeWidth => (fontSize / 20).ceil() * 2;

  Color getBorderColor(Color color) {
    var brightness =
        ((color.red * 299) + (color.green * 587) + (color.blue * 114)) / 1000;
    return brightness > 70 ? Colors.black : Colors.white;
  }
}

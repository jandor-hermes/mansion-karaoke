#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
OUT='promo-reel/mansion-karaoke-promo-reel.mp4'

ffmpeg -y \
  -loop 1 -t 4.0 -i promo-reel/rendered-scenes/intro.png \
  -loop 1 -t 4.0 -i promo-reel/rendered-scenes/join-scene.png \
  -loop 1 -t 4.5 -i promo-reel/rendered-scenes/search-scene.png \
  -loop 1 -t 4.5 -i promo-reel/rendered-scenes/queue-scene.png \
  -loop 1 -t 4.0 -i promo-reel/rendered-scenes/controls-scene.png \
  -loop 1 -t 5.5 -i promo-reel/rendered-scenes/end.png \
  -i promo-reel/original-party-beat.wav \
  -filter_complex "
[0:v]fps=30,format=yuv420p[v0];
[1:v]fps=30,format=yuv420p[v1];
[2:v]fps=30,format=yuv420p[v2];
[3:v]fps=30,format=yuv420p[v3];
[4:v]fps=30,format=yuv420p[v4];
[5:v]fps=30,format=yuv420p[v5];
[v0][v1]xfade=transition=fade:duration=0.5:offset=3.5[x1];
[x1][v2]xfade=transition=slideleft:duration=0.5:offset=7.0[x2];
[x2][v3]xfade=transition=slideup:duration=0.5:offset=11.0[x3];
[x3][v4]xfade=transition=slideright:duration=0.5:offset=15.0[x4];
[x4][v5]xfade=transition=fade:duration=0.5:offset=18.5[vout]
" \
  -map '[vout]' -map 6:a \
  -t 24 -r 30 -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "$OUT"

ffmpeg -y -ss 21.5 -i "$OUT" -frames:v 1 promo-reel/cover.jpg >/dev/null 2>&1

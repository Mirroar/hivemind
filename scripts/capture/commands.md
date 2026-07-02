## General:

`pip3 install mss pillow`

```
python3 screeps-capture.py \
  --monitor 2 \
  --region 100,200,80,40 \
  --debug-overlay \
  --print-diff \
  --output-dir ./frames_roomA \
  --prefix roomA \
  --settle-ms 120 \
  --poll-ms 50 \
  --threshold 8
```

## Testing map view:
https://screeps.com/a/#!/map/shard0?pos=46.037,52.036 --> fullscreen, monitor @ 1080p

```
python3 screeps-capture.py \
  --monitor 2 \
  --region 1050,450,50,25 \
  --output-dir ./frames_map_test \
  --prefix map \
  --settle-ms 120 \
  --poll-ms 50 \
  --threshold 0.5
```

```
python3 crop_frames.py \
  --input-dir ./frames_map_test \
  --output-dir ./frames_map_test_cropped \
  --prefix map \
  --crop 700,300,800,600
```

```
python3 renumber_frames.py \
  --input-dir ./frames_map_test_cropped \
  --output-dir ./frames_map_test_renum \
  --prefix map \
  --output-prefix map \
  --start 0 \
  --zero-pad 5
```

```
python3 frames_to_video.py \
  --input-dir ./frames_map_test_renum \
  --prefix map \
  --fps 24 \
  --output map_test.mp4
```

"""Сжать кадры части в VFR-видео (время кадра = t - t0 из marks.json) и удалить JPEG. После записи части: python3 -I scripts/screencast-pack.py <часть>… (иначе сырые JPEG занимают гигабайты)"""
import json, os, subprocess, sys, shutil
R = os.path.expanduser('~/Arena-materials/final/screencast-v2/raw')
for part in sys.argv[1:]:
    d = os.path.join(R, part); m = json.load(open(d + '/marks.json'))
    fr = m['frames']
    if not os.path.isdir(d + '/frames'): print(part, 'уже'); continue
    t0 = fr[0]['t']
    lst = d + '/frames.txt'
    with open(lst, 'w') as f:
        for i, x in enumerate(fr):
            dur = ((fr[i + 1]['t'] if i + 1 < len(fr) else x['t'] + 2000) - x['t']) / 1000
            f.write(f"file 'frames/{x['f']}'\nduration {max(dur, 0.001):.3f}\n")
        f.write(f"file 'frames/{fr[-1]['f']}'\n")
    out = d + '/video.mp4'
    subprocess.run(['nice', '-n', '15', 'ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-fps_mode', 'vfr',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-video_track_timescale', '1000', out], check=True, cwd=d)
    n = int(subprocess.run(['ffprobe', '-v', 'error', '-count_packets', '-select_streams', 'v', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout.strip())
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout)
    span = (fr[-1]['t'] - t0) / 1000
    if n < len(fr) * 0.5 or dur < span - 0.5: raise SystemExit(f'{part}: кадров {n}/{len(fr)}, длина {dur:.1f} против {span + 2:.1f}')
    m['video_t0'] = t0
    json.dump(m, open(d + '/marks.json', 'w'))
    shutil.rmtree(d + '/frames'); os.remove(lst)
    print(part, n, 'кадров,', os.path.getsize(out) // 2**20, 'МБ')

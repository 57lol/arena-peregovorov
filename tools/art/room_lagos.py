"""Meridian, Victoria Island: evening lagoon, long bridges, teak, woven Ankara accents and tropical plants.
Original stylised pixel artwork, not a geographical reconstruction. Shared Apollo palette / roomkit pipeline.
Run: ~/Arena-materials/.venv/bin/python tools/art/room_lagos.py
2D uses the same panorama and fabric in scenes_story.py. No downloaded/generated AI assets.
"""
import numpy as np
from pathlib import Path
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from rooms_common import R, Tex, T, write_all
from room3d import HW, HGT, BACK, FRONT, S, TABLE, Atlas, solid, wood
from room_istanbul import LATIN  # shared tiny Latin glyphs, no Istanbul graphics

PLACE = {
    'win': [[-2.9, -0.32], [0.32, 2.9]], 'winY': [0.38, 2.68],
    'door': [1.25, 2.15, 2.1],
    'plants': [[-2.86, -2.32], [2.78, -2.28]],
    'cabinet': [2.78, -1.35, 0.42, 1.1, 0.78],  # x,z,depth,width,height
    'panorama': [-17, 17, -3.2, 10.0, -18],
    'fan': [0.1, 2.63, -0.25],
}
R.FONT.update(LATIN)


def fabric(w=64, h=64):
    t = Tex(w, h, 6)
    for y in range(-8, h, 16):
        for x in range(-8, w, 16):
            t.poly([(x+8,y), (x+16,y+8), (x+8,y+16), (x,y+8)], 22)
            t.poly([(x+8,y+3), (x+13,y+8), (x+8,y+13), (x+3,y+8)], 3)
            t.ellipse(x+8,y+8,2,2,23)
    return t


def panorama(w=544, h=212):
    rng = np.random.default_rng(1810)
    t = Tex(w, h, 30)
    # Violet blue to copper sunset, stepped/dithered in the shared palette.
    for a,b,c in [(0,.26,30),(.26,.42,31),(.42,.54,13),(.54,.67,15),(.67,.74,23)]:
        t.rect(0,int(h*a),w-1,int(h*b),c)
        if a: t.checker(0,int(h*a)-3,w-1,int(h*a)+2,c)
    t.ellipse(w*.73,h*.57,h*.065,h*.065,23)
    shore=int(h*.74)
    # Distant towers and the long low bridge: deliberately a stylised lagoon view.
    for x in range(0,w,9):
        bh=int(rng.integers(4,22)); bw=int(rng.integers(4,9))
        t.rect(x,shore-bh,x+bw,shore,40)
        t.rect(x+bw,shore-bh,x+bw,shore,39)
        for yy in range(shore-bh+3,shore-2,4):
            for xx in range(x+2,x+bw,3): t.px(xx,yy,22 if rng.random()<.3 else 41)
    t.rect(0,shore,w-1,h-1,1)
    for _ in range(w*2):
        x=int(rng.integers(0,w)); y=int(rng.integers(shore+1,h))
        t.rect(x,y,x+int(rng.integers(2,7)),y,2 if x<w*.6 else 13)
    for y in range(shore+3,h,3):
        mid=w*.73; width=(y-shore)*.3+3
        t.rect(mid-width,y,mid+width,y,21 if y%2 else 22)
    # Nearer bridge deck, repeating piers, tiny moving-traffic impressions baked into texture.
    deck=shore+12
    t.rect(0,deck,w-1,deck+2,38)
    t.rect(0,deck-1,w-1,deck-1,42)
    for x in range(8,w,24):
        t.poly([(x,deck+2),(x+5,deck+2),(x+4,deck+13),(x+1,deck+13)],39)
        t.line([(x,deck-1),(x,deck-7),(x+3,deck-7)],40)
        t.px(x+3,deck-7,23)
    for x in range(3,w,17): t.px(x,deck-2,23)
    # A second short approach in perspective, across the near water.
    t.poly([(w*.77,h),(w*.85,h),(w*.5,deck+3),(w*.48,deck+3)],38)
    t.line([(w*.81,h),(w*.49,deck+3)],22)
    return t


def plant():
    t=Tex(64,96,T)
    for tip in [(6,15),(14,7),(30,2),(48,10),(60,23),(53,44),(8,42),(20,28),(40,28)]:
        x,y=tip
        t.line([(32,93),(30,55),(x,y)],8)
        t.poly([(30,59),(x-5,y+5),(x,y),(x+6,y+7),(33,55)],7)
        t.line([(31,57),(x,y+2)],10)
        t.line([(x,y+7),(x+3,y+12)],9)
    return t


def items():
    a=Atlas(256,256)
    for c in range(46): a.add(f'c{c}',solid(c))
    t=Tex(64,64);wood(t,0,0,63,63,13,12,14,vertical=True);a.add('teak',t)
    a.add('ankara',fabric())
    a.add('plant',plant())
    t=Tex(96,24,6);t.frame(1,1,94,22,22);t.text(8,5,'MERIDIAN',23);t.text(8,14,'INDUSTRIAL',5);a.add('sign',t)
    t=Tex(32,72,13);t.frame(2,2,29,69,14);t.rect(5,5,26,66,12);t.rect(24,34,26,35,22);a.add('door',t)
    t=Tex(32,36,6);t.frame(1,1,30,34,7)
    for y in range(6,34,7):t.line([(4,y),(27,y)],8)
    a.add('chair',t)
    t=Tex(48,32,37);t.rect(2,2,45,29,0);t.text(5,5,'MERIDIAN',5)
    for x in range(7,43,7):t.rect(x,24-(x%13),x+3,26,22)
    a.add('screen',t)
    t=Tex(32,24,40)
    for y in range(3,19,4):
        for x in range(3,30,4):t.rect(x,y,x+2,y+1,43)
    t.rect(11,20,21,22,42);a.add('keys',t)
    t=Tex(32,40,45);t.rect(0,0,31,3,6);t.text(3,7,'PILOT',6)
    for y in range(16,35,4):t.rect(4,y,27,y,42)
    a.add('paper',t)
    t=Tex(64,20,44);t.frame(0,0,63,19,42)
    for y in range(10,18,2):t.line([(4,y),(60,y)],40)
    t.px(57,4,8);a.add('aircon',t)
    t=Tex(32,32,23);t.ellipse(16,16,14,14,45)
    for x,y in [(16,4),(28,16),(16,28),(4,16)]:t.rect(x-1,y-1,x+1,y+1,20)
    a.add('clock',t)
    return a


def surfaces():
    out={}
    for name,w in [('back',round(2*HW/S)),('front',round(2*HW/S)),('left',round((FRONT-BACK)/S)),('right',round((FRONT-BACK)/S))]:
        t=Tex(w,round(HGT/S),16)
        t.rect(0,0,w-1,5,13);t.rect(0,t.h-30,w-1,t.h-1,12)
        for x in range(0,w,8):t.line([(x,t.h-30),(x,t.h-1)],13)
        t.rect(0,t.h-31,w-1,t.h-30,22)
        # Warm window light on the side walls, progressively fading towards the door.
        if name in ('left','right'):
            for x in range(w//2):
                if x%3: t.rect(x,9,x,t.h-33,17 if x<w//5 else 16)
        out['wall_'+name]=t
    t=Tex(round(2*HW/S),round((FRONT-BACK)/S),13)
    for y in range(0,t.h,10):
        wood(t,0,y,t.w-1,min(t.h-1,y+8),13,12,14)
        t.rect(0,y+9,t.w-1,y+9,12)
    # Woven rug under the table, with a quiet centre and an Ankara border.
    t.rect(25,24,t.w-26,t.h-25,6)
    for x in range(26,t.w-25,12):
        t.poly([(x,27),(x+5,32),(x,37),(x-5,32)],22)
        t.poly([(x,t.h-28),(x+5,t.h-33),(x,t.h-38),(x-5,t.h-33)],22)
    out['floor']=t
    t=Tex(round(2*HW/S),round((FRONT-BACK)/S),15)
    for x in (30,t.w-31):t.rect(x,0,x+3,t.h-1,12)
    out['ceiling']=t
    t=Tex(round(2*TABLE['halfLen']/S),round((TABLE['near']-TABLE['far'])/S),13)
    wood(t,0,0,t.w-1,t.h-1,13,12,14)
    t.frame(0,0,t.w-1,t.h-1,20)
    out['table']=t
    out['lagoon']=panorama()
    return out


def scene2d():
    """Same palette, materials and viewpoint at 192×108; centre reserved for the 96×96 face."""
    bg=Tex(192,108,16);fg=Tex(192,108,T)
    view=panorama(164,70)
    bg.a[6:76,14:178]=view.a
    # Slim brass window divisions; central pier supports the clock behind the face.
    for x in (12,57,93,97,135,178):bg.rect(x,4,x+2,77,20)
    bg.rect(10,4,181,5,22);bg.rect(10,76,181,78,13)
    bg.rect(91,4,100,78,12)
    bg.ellipse(96,18,6,6,23);bg.ellipse(96,18,5,5,45);bg.line([(96,14),(96,18),(99,20)],18)
    # Plants frame rather than cover the subject.
    for x in (3,164):
        bg.poly([(x+4,80),(x+18,80),(x+16,93),(x+6,93)],20)
        for dx,dy in ((-6,-22),(3,-33),(13,-30),(21,-17),(0,-10)):
            bg.poly([(x+11,82),(x+dx-3,55+dy),(x+dx+3,51+dy),(x+15,73)],7)
            bg.line([(x+11,78),(x+dx,54+dy)],9)
    bg.rect(0,79,191,107,12)
    # Air conditioner and a small fabric panel on the visible side wall.
    bg.rect(1,7,10,30,44)
    for y in range(18,29,3):bg.rect(2,y,8,y,40)
    bg.a[34:66,181:191]=fabric(10,32).a
    fg.poly([(0,95),(27,86),(165,86),(191,95),(191,107),(0,107)],13)
    for y in (94,100,106):fg.line([(0,y),(191,y)],12)
    fg.rect(8,93,43,107,6);fg.rect(10,94,41,105,0);fg.text(13,98,'PILOT',5)
    fg.poly([(131,94),(156,94),(161,105),(135,105)],45)
    for y in (97,100,103):fg.line([(137,y),(154,y)],42)
    for x in (56,168):
        fg.rect(x,95,x+5,102,4);fg.rect(x+1,94,x+4,95,45);fg.rect(x,102,x+5,103,2)
    return bg,fg


def main():
    write_all('lagos',items(),surfaces(),PLACE,'tools/art/room_lagos.py')
    meta = PngInfo()
    meta.add_text('impeccable:prompt', 'Original procedural Apollo pixel art from tools/art/room_lagos.py: evening Victoria Island office, lagoon and bridges, teak, Ankara textile, tropical plants. Stylised scene, not a geographical reconstruction.')
    for path in (Path(__file__).resolve().parents[2] / 'public/assets/world').glob('lagos_*.png'):
        with Image.open(path) as image:
            image.save(path, pnginfo=meta)


if __name__=='__main__':main()

"""Offline asset checks: run with the existing art Python environment, no renderer or downloads."""
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
import lagos
from pixel import EMOTIONS, FRAMES, to_image
from room_lagos import scene2d

ROOT = Path(__file__).resolve().parents[2]


class LagosArtTest(unittest.TestCase):
    def test_all_expressions_keep_the_same_person_and_animate(self):
        sheet = Image.open(ROOT / 'public/assets/portraits/lagos.png').convert('RGBA')
        silhouettes = []
        for row, emotion in enumerate(EMOTIONS):
            frames = [np.asarray(to_image(lagos.build(emotion, frame))) for frame in FRAMES]
            for col, frame in enumerate(frames):
                self.assertEqual(frame.shape, (96, 96, 4))
                np.testing.assert_array_equal(frame, np.asarray(sheet.crop((col*96, row*96, (col+1)*96, (row+1)*96))))
                silhouettes.append(frame[:, :, 3])
            self.assertFalse(np.array_equal(frames[0][53:60, 40:57], frames[1][53:60, 40:57]), emotion)
            self.assertFalse(np.array_equal(frames[0][36:44, 34:61], frames[2][36:44, 34:61]), emotion)
        for alpha in silhouettes[1:]: np.testing.assert_array_equal(alpha, silhouettes[0])

    def test_background_is_opaque_and_desk_leaves_room_for_face(self):
        bg, fg = scene2d()
        self.assertEqual(bg.a.shape, (108, 192))
        self.assertTrue(np.all(bg.a >= 0))
        self.assertTrue(np.all(fg.a[:86] == -1))
        self.assertTrue(np.any(fg.a[86:] >= 0))
        for layer, path in [(bg, 'lagos.png'), (fg, 'lagos-desk.png')]:
            np.testing.assert_array_equal(np.asarray(layer.image()), np.asarray(Image.open(ROOT / 'public/assets/scenes' / path)))


if __name__ == '__main__': unittest.main()

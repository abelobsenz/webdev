# python3 tools/contact-sheet.py <prefix> <count> <out.jpg> [columns]  (requires Pillow)
import sys
from PIL import Image
prefix, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 2
ims = [Image.open(f'{prefix}{i}.jpg') for i in range(n)]
w, h = ims[0].size
rows = (n + cols - 1) // cols
o = Image.new('RGB', (w * cols, h * rows))
for i, im in enumerate(ims): o.paste(im, ((i % cols) * w, (i // cols) * h))
o.save(out, quality=88)

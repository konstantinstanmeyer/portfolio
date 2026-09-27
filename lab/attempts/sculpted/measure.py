# Dev helper: facet colour percentiles of a rendered cell (excludes light background)
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
x0, y0, x1, y1 = map(int, sys.argv[2:6]) if len(sys.argv) > 5 else (0, 0, im.size[0], im.size[1])
px = [im.getpixel((x, y)) for x in range(x0, x1, 2) for y in range(y0, y1, 2)]
fig = [p for p in px if not (p[0] > 225 and p[1] > 225 and p[2] > 225) and not (abs(p[0]-242)<6 and abs(p[1]-242)<6)]
fig.sort(key=lambda p: sum(p))
n = len(fig)
print(n, [fig[int(n * q)] for q in (0.05, 0.25, 0.5, 0.75, 0.95)])

# compare figure pixel tone statistics against the reference
import sys
from PIL import Image
def stats(path, bg, crop):
    im = Image.open(path).convert('RGB').crop(crop)
    px = [p for p in im.getdata() if abs(p[0]-bg[0])+abs(p[1]-bg[1])+abs(p[2]-bg[2]) > 40]
    lum = sorted(sum(p)/3 for p in px); n = len(lum)
    mean = [round(sum(p[i] for p in px)/n, 1) for i in range(3)]
    print(path.split('/')[-1], 'n', n, 'mean', mean, 'p10', round(lum[n//10]), 'p50', round(lum[n//2]), 'p90', round(lum[9*n//10]), 'dark<50', round(sum(1 for l in lum if l < 50)/n, 3))
stats(sys.argv[1] + '/reference.png', (255,255,255), (0,20,506,850))
stats(sys.argv[2], (242,242,242), (0,20,600,860))

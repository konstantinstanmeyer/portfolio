import sys
from PIL import Image, ImageOps
ref=Image.open('reference.png').convert('RGB')
me=Image.open(sys.argv[1]).convert('RGB')
g=ImageOps.invert(me.convert('L')).point(lambda v: 255 if v>60 else 0)
w,h=me.size
g=g.crop((0,30,w,h-40))
bb=g.getbbox()
me=me.crop((bb[0]-10,bb[1]+30-10,bb[2]+10,bb[3]+30+10))
H=900
r=ref.resize((int(ref.width*H/ref.height),H))
m=me.resize((int(me.width*H/me.height),H))
out=Image.new('RGB',(r.width+m.width+20,H),(255,255,255))
out.paste(r,(0,0)); out.paste(m,(r.width+20,0))
out.save(sys.argv[2])

// fold check: face normal vs direction from nearest bone segment
import { generate, buildBones } from './generate.js';
const d = generate({});
const P = d.positions, I = d.indices;
const bones = buildBones().filter(b => b.seg);
const V = (i) => [P[i*3], P[i*3+1], P[i*3+2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function closest(p){ let best=null, bd=1e9; for(const b of bones){const [a,c]=b.seg; const ab=sub(c,a); let t=dot(sub(p,a),ab)/dot(ab,ab); t=Math.max(0,Math.min(1,t)); const q=[a[0]+ab[0]*t,a[1]+ab[1]*t,a[2]+ab[2]*t]; const dd=Math.hypot(...sub(p,q)); if(dd<bd){bd=dd;best=q;}} return best; }
let bad=0; const areas=[];
for (let f=0; f<I.length/3; f++){
  const a=V(I[f*3]), b=V(I[f*3+1]), c=V(I[f*3+2]);
  const cen=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3];
  const n=cross(sub(b,a),sub(c,a)); const area=Math.hypot(...n)/2; areas.push(area);
  const out=sub(cen, closest(cen));
  const cs = dot(n,out)/(Math.hypot(...n)*Math.hypot(...out));
  if (cs < -0.1) { bad++; console.log('fold?', f, cen.map(x=>x.toFixed(3)).join(','), 'cos', cs.toFixed(2), 'area', (area*1e4).toFixed(2),'cm2'); }
}
areas.sort((x,y)=>x-y);
console.log('bad', bad, 'min area cm2', (areas[0]*1e4).toFixed(3), 'median', (areas[areas.length>>1]*1e4).toFixed(2), 'max', (areas[areas.length-1]*1e4).toFixed(1));

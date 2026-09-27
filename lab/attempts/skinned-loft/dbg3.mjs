import { generate } from './generate.js';
const d = generate({});
const P = d.positions, I = d.indices;
const V = (i) => [P[i*3], P[i*3+1], P[i*3+2]];
for (let f = 0; f < I.length/3; f++) {
  const a = V(I[f*3]), b = V(I[f*3+1]), c = V(I[f*3+2]);
  const cx = (a[0]+b[0]+c[0])/3, cy=(a[1]+b[1]+c[1])/3, cz=(a[2]+b[2]+c[2])/3;
  if (cx < 0.13 || cx > 0.21 || cy < 1.24 || cy > 1.40) continue;
  const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const n=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; const l=Math.hypot(...n);
  const nn=n.map(x=>x/l);
  if (nn[2] > 0.0) console.log(f, 'c', [cx,cy,cz].map(x=>x.toFixed(3)).join(','), 'n', nn.map(x=>x.toFixed(2)).join(','), [a,b,c].map(p=>p.map(x=>x.toFixed(3)).join(',')).join(' | '));
}

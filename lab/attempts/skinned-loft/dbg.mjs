import { generate } from './generate.js';
const d = generate({ decimate: false, flipProb: 0, jitter: 0 });
const P = d.positions, I = d.indices;
const m = new Map();
for (let f = 0; f < I.length / 3; f++) for (let k = 0; k < 3; k++) {
  const a = I[f*3+k], b = I[f*3+(k+1)%3]; const key = a<b? a+'_'+b : b+'_'+a;
  if (!m.has(key)) m.set(key, []); m.get(key).push(f);
}
for (const [k, fs] of m) if (fs.length !== 2) {
  const [a,b] = k.split('_').map(Number);
  console.log('edge', k, fs.length, [P[a*3],P[a*3+1],P[a*3+2]], [P[b*3],P[b*3+1],P[b*3+2]]);
  for (const f of fs) console.log('  face', [0,1,2].map(j=>{const v=I[f*3+j];return [P[v*3],P[v*3+1],P[v*3+2]].map(x=>x.toFixed(3)).join(',')}).join(' | '));
}
console.log(d.stats);

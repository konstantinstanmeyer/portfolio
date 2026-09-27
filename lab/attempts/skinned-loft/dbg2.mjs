// replicate bridge greedy on D->U1 by instrumenting generate internals via a copy
import fs from 'node:fs';
let src = fs.readFileSync('./generate.js', 'utf8');
src = src.replace('function bridge(M, A, B) {', 'function bridge(M, A, B) {\n  const __f0 = M.F.length;');
src = src.replace("    if (advA) { M.f(a0, b0, a1); i++; } else { M.f(a0, b0, b1); j++; }\n  }\n}", "    if (advA) { M.f(a0, b0, a1); i++; } else { M.f(a0, b0, b1); j++; }\n  }\n  if (globalThis.__log) globalThis.__log.push({A: A.slice(), B: B.slice(), j0, faces: M.F.slice(__f0)});\n}");
fs.writeFileSync('./_gen_dbg.mjs', src);
globalThis.__log = [];
const { generate } = await import('./_gen_dbg.mjs');
generate({ decimate: false, flipProb: 0, jitter: 0 });
for (const L of globalThis.__log) {
  const hit = L.faces.filter(f => f.includes(266) && f.includes(273));
  if (hit.length) console.log('A', L.A, 'B', L.B, 'j0', L.j0, 'faces', JSON.stringify(L.faces));
}

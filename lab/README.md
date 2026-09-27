# Figure lab (paused)

Work-in-progress experiments for a low-poly idle human in a pitch-black 3D space.
Four competing figure builds (`attempts/`), stopped mid-iteration:

- `hull-rig`: convex-hull body parts on an FK rig
- `skinned-loft`: lofted cross-sections, one skinned mesh
- `sculpted`: hand-authored vertex loops, skinned
- `sdf-decimate`: SDF sculpt, polygonized and decimated offline (`bake.mjs` → `data.js`)

Each `attempts/<name>/figure.js` exports `createFigure(options) → { object, update(t, dt), dispose() }`.
The Next.js scene that hosts it is in `components/` and `lib/figure/` (currently a placeholder figure).

## Rendering headlessly

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory lab
node lab/shot.mjs hull-rig lab/shots/hull-rig-views.png "sheet=views"
```

Sheets: `views`, `anim`, `animside`, `motion&view=front|side`, `stage`, `single&view=head`. Add `&bg=black` for a black background.
`vendor` is a symlink to `node_modules/three`. `reference.png` is the target look.

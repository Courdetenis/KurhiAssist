// Debug: Hough segments and merged lines near a vertical x range. Usage: node segs.ts <photo> <x0> <x1>
import fs from "node:fs";
import { trouverCarte } from "./contour.ts";
const [photo, x0, x1] = process.argv.slice(2);
await trouverCarte(fs.readFileSync(photo));
const d = (globalThis as any).__dbg;
const s = d.segs;
for (let i = 0; i < s.length; i += 4) if (Math.min(s[i], s[i + 2]) >= +x0 && Math.max(s[i], s[i + 2]) <= +x1) console.log("seg", s.slice(i, i + 4).join(" "));
d.toutes.forEach((l: any, i: number) => { if (Math.abs(l.a) > 0.95 && Math.abs(l.c / l.a) >= +x0 && Math.abs(l.c / l.a) <= +x1) console.log("ligne rang", i, l.a.toFixed(3), l.b.toFixed(3), l.c.toFixed(1), "long", l.long.toFixed(1)); });
console.log("segs", s.length / 4, "60e:", d.toutes[59]?.long.toFixed(1), "nb", d.toutes.length);

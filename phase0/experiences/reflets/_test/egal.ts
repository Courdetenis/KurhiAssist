import fs from "node:fs";
import { empreintes as avant } from "../../../vision.ts";
import { empreintes as apres } from "./vision.ts";
import { empreintes as harnais } from "../reflets.ts";
const f = ["../cache/scans/vrai/2026-11-03T20-10-09-978Z.jpg", "../cache/reflets/vrai/005-pokemon.jpg", "../../correspondance/cache/vrai/000-pokemon.jpg"].map((x) => fs.readFileSync(new URL(x, import.meta.url)));
const a = await avant(f), b = await apres(f, true), b0 = await apres(f), c = await harnais(f, { boucher: false, masquer: true, croissance: 3, part: 0.25, rogne: 0 });
const dot = (x: Float32Array, y: Float32Array) => x.reduce((s, v, i) => s + v * y[i], 0);
for (let k = 0; k < f.length; k++) console.log(k, "requete=false vs actuel", dot(a[k].yugioh, b0[k].yugioh).toFixed(6), dot(a[k].pokemon, b0[k].pokemon).toFixed(6), "| patch vs harnais masque", dot(b[k].yugioh, c[k].yugioh).toFixed(6), dot(b[k].pokemon, c[k].pokemon).toFixed(6), "| patch vs actuel", dot(a[k].pokemon, b[k].pokemon).toFixed(4));

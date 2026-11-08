// overview with grid lines every 200 px and detected quad
import sharp from 'sharp';
import fs from 'fs';
const [,, f, out, quadJson] = process.argv;
const m = await sharp(f).metadata();
const W = m.width, H = m.height;
let s = '';
for (let x = 0; x <= W; x += 100) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${x%500?'#0f0':'#ff0'}" stroke-width="${x%500?1:3}" opacity="0.6"/><text x="${x+4}" y="40" font-size="36" fill="#ff0">${x}</text>`;
for (let y = 0; y <= H; y += 100) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${y%500?'#0f0':'#ff0'}" stroke-width="${y%500?1:3}" opacity="0.6"/><text x="4" y="${y-4}" font-size="36" fill="#ff0">${y}</text>`;
if (quadJson) { const q = JSON.parse(quadJson); s += `<polygon points="${q.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#f00" stroke-width="4"/>`; }
await sharp(f).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${s}</svg>`) }]).png().toBuffer().then(b => sharp(b).resize(900).jpeg().toFile(out));

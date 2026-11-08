// Debug: Canny of the 640 px photo after a given smoothing, side by side. Usage: node canny.ts <photo> <out> [mode]
import sharp from "sharp";
import { opencv } from "../../vision.ts";
const [photo, out, mode] = process.argv.slice(2);
const { cv } = await opencv();
const { data, info } = await sharp(photo).resize(640, 640, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height;
const src = cv.matFromArray(h, w, cv.CV_8UC3, data);
const f = new cv.Mat();
if (mode === "median") { cv.medianBlur(src, f, 5); cv.GaussianBlur(f, f, new cv.Size(5, 5), 0); }
else if (mode === "bilat") { cv.bilateralFilter(src, f, 9, 40, 5); }
else if (mode === "g9") cv.GaussianBlur(src, f, new cv.Size(9, 9), 0);
else cv.GaussianBlur(src, f, new cv.Size(5, 5), 0);
const b = new cv.Mat();
cv.Canny(f, b, 20, 60);
const g = Buffer.from(b.data);
await sharp(g, { raw: { width: w, height: h, channels: 1 } }).png().toFile(out);

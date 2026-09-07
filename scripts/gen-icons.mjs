import sharp from "sharp";
import fs from "node:fs";

const GREEN = "#1F4B45";

// A simple brand monogram: green field, white "EE". `scale` controls how much
// of the tile the text fills (smaller for maskable so it stays in the safe zone).
function svg(size, scale, rounded) {
  const fontSize = Math.round(size * scale);
  const radius = rounded ? Math.round(size * 0.22) : 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${GREEN}"/>
  <text x="50%" y="50%" dy="0.34em" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif" font-weight="800"
    font-size="${fontSize}" letter-spacing="${Math.round(size * -0.02)}" fill="#F5F5F4">EE</text>
</svg>`);
}

const jobs = [
  { file: "public/icon-192.png", size: 192, scale: 0.5, rounded: true },
  { file: "public/icon-512.png", size: 512, scale: 0.5, rounded: true },
  { file: "public/icon-maskable-512.png", size: 512, scale: 0.4, rounded: false },
  { file: "public/apple-touch-icon.png", size: 180, scale: 0.5, rounded: false },
  { file: "public/favicon-32.png", size: 32, scale: 0.55, rounded: true },
];

for (const j of jobs) {
  await sharp(svg(j.size, j.scale, j.rounded)).png().toFile(j.file);
  console.log("wrote", j.file, fs.statSync(j.file).size, "bytes");
}

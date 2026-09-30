// Regenerates the app icons in /public (the green "EEI" monogram — Elite Elevator Inspections).
// Run:  node scripts/gen-icons.mjs

import sharp from "sharp";
import fs from "node:fs";

const GREEN = "#16A34A"; // = --color-accent in src/app/globals.css

// A simple brand monogram: green field, white "EEI". `scale` controls how much
// of the tile the text fills (smaller for maskable so it stays in the safe zone).
function svg(size, scale, rounded) {
  const fontSize = Math.round(size * scale);
  const radius = rounded ? Math.round(size * 0.22) : 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${GREEN}"/>
  <text x="50%" y="50%" dy="0.34em" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif" font-weight="800"
    font-size="${fontSize}" letter-spacing="${Math.round(size * -0.02)}" fill="#FFFFFF">EEI</text>
</svg>`);
}

// The tiny status-bar icon for phone alerts (Android "badge"): Android shows only
// its shape, so it must be white on a see-through background — a full-color
// square shows up as a plain white block.
function badgeSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <text x="50%" y="50%" dy="0.34em" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif" font-weight="800"
    font-size="${Math.round(size * 0.46)}" letter-spacing="${Math.round(size * -0.03)}" fill="#FFFFFF">EEI</text>
</svg>`);
}

const jobs = [
  { file: "public/icon-192.png", size: 192, scale: 0.4, rounded: true },
  { file: "public/icon-512.png", size: 512, scale: 0.4, rounded: true },
  { file: "public/icon-maskable-512.png", size: 512, scale: 0.3, rounded: false },
  { file: "public/favicon-32.png", size: 32, scale: 0.42, rounded: true },
];

for (const j of jobs) {
  await sharp(svg(j.size, j.scale, j.rounded)).png().toFile(j.file);
  console.log("wrote", j.file, fs.statSync(j.file).size, "bytes");
}

await sharp(badgeSvg(96)).png().toFile("public/badge-96.png");
console.log("wrote public/badge-96.png", fs.statSync("public/badge-96.png").size, "bytes");

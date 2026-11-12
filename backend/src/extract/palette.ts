/**
 * Screenshot colour palette: deterministic k-means over sampled pixels of a PNG screenshot.
 */
import { PNG } from 'pngjs';
import { rgbToHex, type RGB } from '../render/color.js';

export interface PaletteColor { hex: string; share: number; rgb: RGB }

export function samplePixels(png: Buffer, maxSamples = 12_000): RGB[] {
  const img = PNG.sync.read(png);
  const total = img.width * img.height;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const out: RGB[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (img.data[o + 3] < 200) continue;
    out.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
  }
  return out;
}

const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means with deterministic farthest-point initialisation (no randomness → stable results). */
export function kmeans(pixels: RGB[], k = 6, iterations = 12): PaletteColor[] {
  if (!pixels.length) return [];
  // init: most common coarse bucket first, then farthest points
  const buckets = new Map<string, { c: RGB; n: number }>();
  for (const p of pixels) {
    const key = p.map((v) => v >> 4).join(',');
    const b = buckets.get(key);
    if (b) b.n++;
    else buckets.set(key, { c: p, n: 1 });
  }
  const first = [...buckets.values()].sort((a, b) => b.n - a.n)[0].c;
  const centers: RGB[] = [first];
  while (centers.length < k) {
    let best: RGB | null = null;
    let bestD = -1;
    for (const p of pixels) {
      const d = Math.min(...centers.map((c) => d2(p, c)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best || bestD < 100) break; // fewer distinct colours than k
    centers.push(best);
  }
  let assign = new Array<number>(pixels.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    assign = pixels.map((p) => {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const d = d2(p, c);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      return bi;
    });
    const sums = centers.map(() => [0, 0, 0, 0]);
    pixels.forEach((p, i) => {
      const s = sums[assign[i]];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    sums.forEach((s, i) => {
      if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const counts = centers.map((_, i) => assign.filter((a) => a === i).length);
  return centers
    .map((c, i) => ({ rgb: c.map(Math.round) as RGB, hex: rgbToHex(c), share: counts[i] / pixels.length }))
    .filter((c) => c.share > 0.005)
    .sort((a, b) => b.share - a.share);
}

export function screenshotPalette(png: Buffer, k = 6): PaletteColor[] {
  return kmeans(samplePixels(png), k);
}

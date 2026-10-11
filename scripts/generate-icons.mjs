/**
 * Render PNG icons from public/favicon.svg into public/icons/ for browsers
 * that need raster favicons (notably iOS home-screen / bookmark icons).
 *
 * Runs automatically before `astro build` (see the `icons` npm script). If
 * anything fails here, the build still succeeds — pages keep using the SVG
 * favicon.
 *
 * Requires: @resvg/resvg-js.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

const SIZES = [16, 32, 180, 192, 512];

try {
  const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');
  mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
      .render()
      .asPng();
    writeFileSync(join(outDir, `icon-${size}.png`), png);
  }
  console.log(`icons: generated ${SIZES.length} PNGs in public/icons/`);
} catch (error) {
  // Never break the build — pages fall back to /favicon.svg.
  console.warn(`icons: generation skipped, using SVG favicon. ${error?.message ?? error}`);
}

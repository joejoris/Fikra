/**
 * Generate per-page Open Graph images (1200x630 PNG) for news posts and
 * program pages, written to public/og/.
 *
 * Runs automatically before `astro build` (see the `og` npm script). If
 * anything fails here, the build still succeeds — pages fall back to
 * /og-default.svg (each detail page checks whether its PNG exists).
 *
 * Requires: satori, @resvg/resvg-js, @fontsource/inter.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'og');

const WIDTH = 1200;
const HEIGHT = 630;

/** Which content collections get images, and which frontmatter keys to use. */
const COLLECTIONS = [
  { dir: 'news', kind: 'News', titleKey: 'title', subKey: 'description' },
  { dir: 'programs', kind: 'Program', titleKey: 'title', subKey: 'summary' },
];

/** Minimal frontmatter reader for single-line `key: value` pairs. */
function frontmatterValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|(.+?))\\s*$`, 'm'));
  if (!match) return '';
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(full);
    return /\.(md|mdx)$/.test(entry.name) ? [full] : [];
  });
}

function clamp(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function card(title, kind, sub) {
  const safeTitle = clamp(title || 'FIKRA', 110);
  const safeSub = clamp(sub || '', 140);
  return {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: 'linear-gradient(135deg, #0e6e6e 0%, #0a4f4f 60%, #083f3f 100%)',
        color: '#ffffff',
        fontFamily: 'Inter',
        overflow: 'hidden',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              right: '-140px',
              top: '-140px',
              width: '420px',
              height: '420px',
              borderRadius: '9999px',
              background: 'rgba(245, 197, 66, 0.22)',
            },
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: '#f5c542',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#0a4f4f',
                    fontSize: '28px',
                    fontWeight: 700,
                  },
                  children: 'F',
                },
              },
              {
                type: 'div',
                props: {
                  style: { marginLeft: '16px', fontSize: '26px', fontWeight: 700, letterSpacing: '4px' },
                  children: 'FIKRA',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    marginLeft: '20px',
                    fontSize: '22px',
                    color: 'rgba(255,255,255,0.75)',
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                  },
                  children: kind,
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '62px',
                    fontWeight: 700,
                    lineHeight: '1.15',
                    height: '216px',
                    overflow: 'hidden',
                  },
                  children: safeTitle,
                },
              },
              safeSub
                ? {
                    type: 'div',
                    props: {
                      style: { marginTop: '16px', fontSize: '28px', color: 'rgba(255,255,255,0.85)', lineHeight: '1.4' },
                      children: safeSub,
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },
        {
          type: 'div',
          props: {
            style: { fontSize: '24px', color: 'rgba(255,255,255,0.8)', letterSpacing: '1px' },
            children: 'From idea to enterprise',
          },
        },
      ],
    },
  };
}

async function main() {
  const regular = readFileSync(
    join(root, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'),
  );
  const bold = readFileSync(
    join(root, 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff'),
  );
  const fonts = [
    { name: 'Inter', data: regular, weight: 400, style: 'normal' },
    { name: 'Inter', data: bold, weight: 700, style: 'normal' },
  ];

  mkdirSync(outDir, { recursive: true });
  let count = 0;

  for (const collection of COLLECTIONS) {
    const base = join(root, 'src/content', collection.dir);
    if (!existsSync(base)) continue;
    for (const file of collectFiles(base)) {
      try {
        const text = readFileSync(file, 'utf8');
        const title = frontmatterValue(text, collection.titleKey);
        const sub = frontmatterValue(text, collection.subKey);
        if (!title) continue;
        // Mirror the slug used by the [...slug] pages: nested paths use `-`.
        const slug = file
          .slice(base.length + 1)
          .replace(/\.(md|mdx)$/, '')
          .replace(/[/\\]/g, '-');
        const svg = await satori(card(title, collection.kind, sub), {
          width: WIDTH,
          height: HEIGHT,
          fonts,
        });
        const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
        writeFileSync(join(outDir, `${collection.dir}-${slug}.png`), png);
        count += 1;
      } catch (error) {
        console.warn(`og: skipping ${file}: ${error?.message ?? error}`);
      }
    }
  }

  console.log(`og: generated ${count} images in public/og/`);
}

try {
  await main();
} catch (error) {
  // Never break the build — pages fall back to /og-default.svg.
  console.warn(`og: generation skipped, using default image. ${error?.message ?? error}`);
}

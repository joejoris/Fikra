// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// IMPORTANT: replace `site` with the real domain before launch.
// It is used for canonical URLs, sitemap.xml and Open Graph tags.
export default defineConfig({
  site: 'https://fikra.example.org',
  output: 'static',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // Keep CSS external so it can be cached across pages on repeat visits.
    inlineStylesheets: 'auto',
  },
});

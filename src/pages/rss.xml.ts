import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { SITE } from '../lib/site';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async () => {
  const posts = (
    await getCollection('news', ({ data }) =>
      import.meta.env.PROD ? data.draft !== true : true,
    )
  ).sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  const items = posts
    .map((post) => {
      const url = new URL(`/news/${post.id}/`, SITE.url).href;
      return [
        '<item>',
        `<title>${escapeXml(post.data.title)}</title>`,
        `<link>${url}</link>`,
        `<guid isPermaLink="true">${url}</guid>`,
        `<pubDate>${post.data.pubDate.toUTCString()}</pubDate>`,
        `<description>${escapeXml(post.data.description)}</description>`,
        '</item>',
      ].join('');
    })
    .join('');

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    `<title>${escapeXml(SITE.name)} — News</title>`,
    `<link>${SITE.url}</link>`,
    `<description>${escapeXml(SITE.description)}</description>`,
    `<language>${SITE.locale}</language>`,
    items,
    '</channel>',
    '</rss>',
  ].join('');

  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
};

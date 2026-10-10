import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

interface SearchItem {
  title: string;
  url: string;
  summary: string;
  tags?: string[];
  type: string;
}

export const GET: APIRoute = async () => {
  const items: SearchItem[] = [
    { title: 'Home', url: '/', summary: 'From idea to enterprise.', type: 'Page' },
    { title: 'About FIKRA', url: '/about', summary: 'Our mission, vision and story.', type: 'Page' },
    { title: 'Programs', url: '/programs', summary: 'Training, incubation and growth support for founders.', type: 'Page' },
    { title: 'Impact', url: '/impact', summary: 'What our work has changed.', type: 'Page' },
    { title: 'Team', url: '/team', summary: 'The people behind FIKRA.', type: 'Page' },
    { title: 'Events', url: '/events', summary: 'Information sessions, workshops and deadlines.', type: 'Page' },
    { title: 'Get involved', url: '/get-involved', summary: 'Volunteer, partner or become a member.', type: 'Page' },
    { title: 'Donate', url: '/donate', summary: 'Support young founders.', type: 'Page' },
    { title: 'Contact', url: '/contact', summary: 'Get in touch with FIKRA.', type: 'Page' },
    { title: 'News', url: '/news', summary: 'Updates and announcements.', type: 'Page' },
    { title: 'FAQ', url: '/faq', summary: 'Frequently asked questions.', type: 'Page' },
    { title: 'Documents & reports', url: '/documents', summary: 'Governance documents, policies and annual reports.', type: 'Page' },
    { title: 'Privacy policy', url: '/privacy', summary: 'How we handle your information.', type: 'Page' },
  ];

  const programs = await getCollection('programs');
  for (const program of programs) {
    items.push({
      title: program.data.title,
      url: `/programs/${program.id}`,
      summary: program.data.summary,
      tags: [program.data.audience, ...program.data.tags],
      type: 'Program',
    });
  }

  const news = await getCollection('news', ({ data }) =>
    import.meta.env.PROD ? data.draft !== true : true,
  );
  for (const post of news) {
    items.push({
      title: post.data.title,
      url: `/news/${post.id}`,
      summary: post.data.description,
      type: 'News',
    });
  }

  const stories = await getCollection('impact', ({ data }) =>
    import.meta.env.PROD ? data.draft !== true : true,
  );
  for (const story of stories) {
    items.push({
      title: story.data.title,
      url: '/impact',
      summary: story.data.summary,
      type: 'Story',
    });
  }

  const faq = await getCollection('faq', ({ data }) =>
    import.meta.env.PROD ? data.draft !== true : true,
  );
  for (const entry of faq) {
    items.push({
      title: entry.data.question,
      url: '/faq',
      summary: '',
      type: 'FAQ',
    });
  }

  return new Response(JSON.stringify(items), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};

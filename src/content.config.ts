import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const programs = defineCollection({
  loader: glob({ base: './src/content/programs', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    audience: z.string(),
    status: z.enum(['open', 'coming-soon', 'closed']).default('coming-soon'),
    location: z.string().optional(),
    duration: z.string().optional(),
    order: z.number().default(99),
    applyUrl: z.string().optional(),
    cover: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

const news = defineCollection({
  loader: glob({ base: './src/content/news', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().default('FIKRA'),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const impact = defineCollection({
  loader: glob({ base: './src/content/impact', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    person: z.string().optional(),
    location: z.string().optional(),
    date: z.coerce.date().optional(),
    cover: z.string().optional(),
    order: z.number().default(99),
    draft: z.boolean().default(false),
  }),
});

const team = defineCollection({
  loader: glob({ base: './src/content/team', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    bio: z.string(),
    order: z.number().default(99),
    photo: z.string().optional(),
    email: z.string().optional(),
  }),
});

const faq = defineCollection({
  loader: glob({ base: './src/content/faq', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    question: z.string(),
    order: z.number().default(99),
    draft: z.boolean().default(false),
  }),
});

const events = defineCollection({
  loader: glob({ base: './src/content/events', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    startTime: z.string().optional(),
    location: z.string().optional(),
    registrationUrl: z.string().optional(),
    order: z.number().default(99),
    draft: z.boolean().default(false),
  }),
});

export const collections = { programs, news, impact, team, faq, events };

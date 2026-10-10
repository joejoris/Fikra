import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

function icsDate(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function dateOnly(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

function escapeText(value: string): string {
  return value.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

export const GET: APIRoute = async () => {
  const events = (
    await getCollection('events', ({ data }) =>
      import.meta.env.PROD ? data.draft !== true : true,
    )
  ).sort((a, b) => a.data.startDate.valueOf() - b.data.startDate.valueOf());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FIKRA//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:FIKRA events',
  ];

  for (const event of events) {
    const end = new Date(event.data.endDate ?? event.data.startDate);
    end.setUTCDate(end.getUTCDate() + 1); // all-day events use an exclusive end date
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@fikra`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART;VALUE=DATE:${dateOnly(event.data.startDate)}`,
      `DTEND;VALUE=DATE:${dateOnly(end)}`,
      `SUMMARY:${escapeText(event.data.title)}`,
      `DESCRIPTION:${escapeText(event.data.summary)}`,
    );
    if (event.data.location) lines.push(`LOCATION:${escapeText(event.data.location)}`);
    if (event.data.registrationUrl) lines.push(`URL:${escapeText(event.data.registrationUrl)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n'), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="fikra-events.ics"',
    },
  });
};

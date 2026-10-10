/**
 * Internationalisation (i18n) strings.
 *
 * English is the source of truth. The Amharic (አማርኛ) strings here are a first
 * draft to be reviewed by an Amharic-speaking member of FIKRA before launch.
 *
 * Only the pages listed in `TRANSLATED_PATHS` currently exist in Amharic; every
 * other page falls back to English. Add a path here and create the matching file
 * under `src/pages/am/` as translations are completed.
 */

export const languages = {
  en: 'English',
  am: 'አማርኛ',
} as const;

export type Lang = keyof typeof languages;

export const defaultLang: Lang = 'en';

/** Site paths that have an Amharic version under /am/. */
export const TRANSLATED_PATHS = new Set(['/', '/about', '/contact']);

export const UI = {
  en: {
    'nav.about': 'About',
    'nav.programs': 'Programs',
    'nav.impact': 'Impact',
    'nav.events': 'Events',
    'nav.getInvolved': 'Get Involved',
    'nav.news': 'News',
    'nav.team': 'Team',
    'nav.contact': 'Contact',
    'nav.donate': 'Donate',
    'nav.menu': 'Menu',
    'nav.home': 'FIKRA — home',
    'skip': 'Skip to content',
    'lang.label': 'Language',
    'footer.organisation': 'Organisation',
    'footer.getInvolved': 'Get involved',
    'footer.more': 'More',
    'footer.volunteer': 'Volunteer',
    'footer.partner': 'Partner with us',
    'footer.member': 'Become a member',
    'footer.documents': 'Documents',
    'footer.search': 'Search',
    'footer.privacy': 'Privacy policy',
    'footer.faq': 'FAQ',
    'newsletter.heading': 'Get FIKRA updates',
    'newsletter.description':
      'Occasional news about cohorts, events and openings. No spam, unsubscribe any time.',
    'newsletter.email': 'Email address',
    'newsletter.firstName': 'First name (optional)',
    'newsletter.subscribe': 'Subscribe',
    'newsletter.consent':
      'I agree to receive email updates and accept our {privacyLink}.',
    'newsletter.privacy': 'privacy policy',
    'newsletter.thanks': 'Thank you — please check your inbox to confirm.',
    'cta.title': 'Ready to build something?',
    'cta.text':
      'Whether you have an idea, want to mentor, or want to fund the next enterprise — there is a place for you at FIKRA.',
    'cta.getInvolved': 'Get involved',
    'cta.donate': 'Donate',
    'form.name': 'Full name',
    'form.email': 'Email',
    'form.organisation': 'Organisation',
    'form.organisationHint': '(if relevant)',
    'form.phone': 'Phone',
    'form.phoneHint': '(optional)',
    'form.optional': 'optional',
    'form.interest': "I'm interested in",
    'form.choose': 'Please choose…',
    'form.message': 'Your message',
    'form.consent':
      'I agree that FIKRA may store these details to respond to my enquiry. See our {privacyLink}.',
    'form.privacy': 'privacy policy',
    'form.attachment': 'Attachment',
    'form.attachmentHint':
      'A CV, pitch deck or similar. PDF or Word, up to 8 MB each (max 2 files).',
    'form.send': 'Send',
    'form.sending': 'Sending…',
    'form.thanks': 'Thank you — redirecting…',
    'form.error':
      'Sorry, something went wrong. Please try again, or email us directly.',
  },
  am: {
    'nav.about': 'ስለ እኛ',
    'nav.programs': 'ፕሮግራሞች',
    'nav.impact': 'ተጽእኖ',
    'nav.events': 'ዝግጅቶች',
    'nav.getInvolved': 'ይሳተፉ',
    'nav.news': 'ዜና',
    'nav.team': 'ቡድን',
    'nav.contact': 'አግኙን',
    'nav.donate': 'ይለግሱ',
    'nav.menu': 'ምናሌ',
    'nav.home': 'FIKRA — መነሻ',
    'skip': 'ወደ ይዘት ዝለል',
    'lang.label': 'ቋንቋ',
    'footer.organisation': 'ድርጅት',
    'footer.getInvolved': 'ይሳተፉ',
    'footer.more': 'ተጨማሪ',
    'footer.volunteer': 'በፈቃደኝነት ያግዙ',
    'footer.partner': 'አጋር ይሁኑ',
    'footer.member': 'አባል ይሁኑ',
    'footer.documents': 'ሰነዶች',
    'footer.search': 'ፍለጋ',
    'footer.privacy': 'የግላዊነት መመሪያ',
    'footer.faq': 'ተደጋጋሚ ጥያቄዎች',
    'newsletter.heading': 'የFIKRA ዜና ይከታተሉ',
    'newsletter.description':
      'ስለ ኮርሶች፣ ዝግጅቶች እና ዕድሎች አልፎ አልፎ ዜና። አይጨናንቁም፤ በማንኛውም ጊዜ ማቋረጥ ይችላሉ።',
    'newsletter.email': 'የኢሜይል አድራሻ',
    'newsletter.firstName': 'ስም (አማራጭ)',
    'newsletter.subscribe': 'ይመዝገቡ',
    'newsletter.consent': 'የኢሜይል ዜና ለመቀበል እና የ{privacyLink}ን እቀበላለሁ።',
    'newsletter.privacy': 'ግላዊነት መመሪያችን',
    'newsletter.thanks': 'አመሰግናለሁ — ለማረጋገጥ ኢሜይልዎን ይመልከቱ።',
    'cta.title': 'የሚገነቡት ነገር አለዎት?',
    'cta.text':
      'ሀሳብ ቢኖርዎት፣ ቢያማክሩ ወይም ቀጣዩን ድርጅት ቢደግፉ — FIKRA ውስጥ ለእርስዎ ቦታ አለ።',
    'cta.getInvolved': 'ይሳተፉ',
    'cta.donate': 'ይለግሱ',
    'form.name': 'ሙሉ ስም',
    'form.email': 'ኢሜይል',
    'form.organisation': 'ድርጅት',
    'form.organisationHint': '(ካለ)',
    'form.phone': 'ስልክ',
    'form.phoneHint': '(አማራጭ)',
    'form.optional': 'አማራጭ',
    'form.interest': 'የሚስተዋልኝ',
    'form.choose': 'ይምረጡ…',
    'form.message': 'መልእክትዎ',
    'form.consent': 'FIKRA ለጥያቄዬ ምላሽ ለመስጠት ይህን መረጃ እንዲያስቀምጥ እስማማለሁ። የ{privacyLink}ን ይመልከቱ።',
    'form.privacy': 'ግላዊነት መመሪያችን',
    'form.attachment': 'አባሪ',
    'form.attachmentHint':
      'CV፣ የፕሮጀክት ማቅረቢያ ወይም ተመሳሳይ። PDF ወይም Word፣ እያንዳንዱ እስከ 8 MB (ቢያንስ 2 ፋይሎች)።',
    'form.send': 'ላክ',
    'form.sending': 'በመላክ ላይ…',
    'form.thanks': 'አመሰግናለሁ — በመሄድ ላይ…',
    'form.error': 'ይቅርታ፣ ችግር ተፈጥሯል። እንደገና ይሞክሩ ወይም በኢሜይል ያግኙን።',
  },
} as const;

export type UIKey = keyof (typeof UI)['en'];

/** Returns a translation function for the given language. */
export function useTranslations(lang: Lang) {
  const dictionary = UI[lang] ?? UI[defaultLang];
  return function t(key: UIKey, vars?: Record<string, string>): string {
    let value: string = dictionary[key] ?? UI[defaultLang][key] ?? key;
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        value = value.replace(`{${name}}`, replacement);
      }
    }
    return value;
  };
}

/** Strips any /am prefix to get the canonical (English) path. */
export function logicalPath(pathname: string): string {
  const withoutLang = pathname.replace(/^\/am(?=\/|$)/, '') || '/';
  return withoutLang.endsWith('/') && withoutLang !== '/'
    ? withoutLang.slice(0, -1)
    : withoutLang;
}

/** Resolves a logical path for a target language, avoiding dead links. */
export function localizePath(path: string, lang: Lang): string {
  const logical = logicalPath(path);
  if (lang === 'en') return logical;
  if (!TRANSLATED_PATHS.has(logical)) return path.startsWith('/am') ? path : '/am';
  return logical === '/' ? '/am' : `/am${logical}`;
}

/** The equivalent page in the other language (falls back to that locale's home). */
export function alternatePath(pathname: string, targetLang: Lang): string {
  return localizePath(logicalPath(pathname), targetLang);
}

interface LinkDef {
  href: string;
  key: UIKey;
}

export const NAV: readonly LinkDef[] = [
  { href: '/about', key: 'nav.about' },
  { href: '/programs', key: 'nav.programs' },
  { href: '/impact', key: 'nav.impact' },
  { href: '/events', key: 'nav.events' },
  { href: '/get-involved', key: 'nav.getInvolved' },
  { href: '/news', key: 'nav.news' },
];

export const FOOTER_GROUPS: readonly {
  heading: UIKey;
  links: readonly LinkDef[];
}[] = [
  {
    heading: 'footer.organisation',
    links: [
      { href: '/about', key: 'nav.about' },
      { href: '/programs', key: 'nav.programs' },
      { href: '/impact', key: 'nav.impact' },
      { href: '/events', key: 'nav.events' },
      { href: '/team', key: 'nav.team' },
      { href: '/news', key: 'nav.news' },
    ],
  },
  {
    heading: 'footer.getInvolved',
    links: [
      { href: '/get-involved', key: 'nav.getInvolved' },
      { href: '/get-involved#volunteer', key: 'footer.volunteer' },
      { href: '/get-involved#partner', key: 'footer.partner' },
      { href: '/get-involved#member', key: 'footer.member' },
      { href: '/donate', key: 'nav.donate' },
    ],
  },
  {
    heading: 'footer.more',
    links: [
      { href: '/contact', key: 'nav.contact' },
      { href: '/faq', key: 'footer.faq' },
      { href: '/documents', key: 'footer.documents' },
      { href: '/search', key: 'footer.search' },
      { href: '/privacy', key: 'footer.privacy' },
    ],
  },
];

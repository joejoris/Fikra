/**
 * Single source of truth for organisation-wide values used across the site.
 *
 * NOTE FOR FIKRA: the values marked "[CONFIRM]" are placeholders and must be
 * replaced with the real, verified details before launch. See docs/fikra-inputs.md.
 */

export const SITE = {
  name: 'FIKRA',
  legalName: 'FIKRA [CONFIRM full registered name]',
  tagline: 'From idea to enterprise.',
  description:
    'FIKRA supports young people to turn ideas into sustainable enterprises through training, mentorship and access to opportunity.',
  // Replace with the real domain before launch (also update astro.config.mjs).
  url: 'https://fikra.example.org',
  locale: 'en',
  email: 'info@fikra.example.org', // [CONFIRM]
  phone: '+000 000 0000', // [CONFIRM]
  address: {
    line1: '[CONFIRM street address]',
    city: '[CONFIRM city]',
    region: '[CONFIRM region]',
    country: '[CONFIRM country]',
  },
  // Social links — remove any that do not exist. Empty strings are hidden.
  social: {
    facebook: '',
    instagram: '',
    linkedin: '',
    x: '',
    youtube: '',
  },
  // WhatsApp number in international format, digits only (e.g. 254712345678).
  // Leave empty to hide the WhatsApp button entirely.
  whatsapp: '', // [CONFIRM]
  // Registration / legal details shown in the footer and on the Donate page.
  registrationNumber: '[CONFIRM registration number]', // [CONFIRM]
} as const;

/**
 * Donation configuration. `url` must be replaced with the real payment link.
 * Until then the Donate page shows a clear "coming soon" state instead of a
 * broken button. See docs/fikra-inputs.md.
 */
export const DONATION = {
  configured: false,
  provider: '', // e.g. "Chapa", "telebirr", "PayPal", "Stripe"
  url: '',
  note: 'Online giving is being set up. In the meantime, contact us to give.',
} as const;

export const NAV_LINKS = [
  { label: 'About', href: '/about' },
  { label: 'Programs', href: '/programs' },
  { label: 'Impact', href: '/impact' },
  { label: 'Events', href: '/events' },
  { label: 'Get Involved', href: '/get-involved' },
  { label: 'News', href: '/news' },
] as const;

export const FOOTER_LINKS = {
  organisation: [
    { label: 'About', href: '/about' },
    { label: 'Programs', href: '/programs' },
    { label: 'Impact', href: '/impact' },
    { label: 'Events', href: '/events' },
    { label: 'Team', href: '/team' },
    { label: 'News', href: '/news' },
  ],
  engage: [
    { label: 'Get Involved', href: '/get-involved' },
    { label: 'Volunteer', href: '/get-involved#volunteer' },
    { label: 'Partner with us', href: '/get-involved#partner' },
    { label: 'Become a member', href: '/get-involved#member' },
    { label: 'Donate', href: '/donate' },
  ],
  legal: [
    { label: 'Contact', href: '/contact' },
    { label: 'FAQ', href: '/faq' },
    { label: 'Search', href: '/search' },
    { label: 'Privacy policy', href: '/privacy' },
  ],
} as const;

export const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
};

/**
 * Homepage / impact figures.
 *
 * THESE ARE ILLUSTRATIVE PLACEHOLDERS. Replace with figures FIKRA has verified
 * and can stand behind. Do not publish invented statistics.
 */
export const STATS = [
  { value: '[N]', label: 'young people trained' },
  { value: '[N]', label: 'enterprises supported' },
  { value: '[N]', label: 'mentors and partners' },
] as const;

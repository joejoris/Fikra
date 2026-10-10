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
 * Donation configuration.
 *
 * Add one or more giving methods below once a provider is chosen. While the
 * list is empty the Donate page shows a clear "coming soon" state rather than a
 * broken button. See docs/fikra-inputs.md.
 */
export interface DonationAccount {
  name: string;
  bank: string;
  number: string;
  swift?: string;
  note?: string;
}

export interface DonationMethod {
  id: string;
  label: string;
  description?: string;
  /** 'link' opens `url`; 'bank' lists `accounts`. */
  kind?: 'link' | 'bank';
  url?: string;
  accounts?: DonationAccount[];
}

export const DONATION: {
  methods: DonationMethod[];
  /** Optional quick amounts; used to pre-fill link providers via `amountParam`. */
  presets: number[];
  /** Query parameter appended for an amount, e.g. `amount`. */
  amountParam: string;
  currency: string;
  note: string;
} = {
  methods: [
    // Uncomment and fill in once a provider and/or bank account is confirmed:
    //
    // {
    //   id: 'chapa',
    //   label: 'Give by card or mobile money',
    //   description: 'Secure checkout via Chapa.',
    //   kind: 'link',
    //   url: 'https://checkout.chapa.co/REPLACE_ME',
    // },
    // {
    //   id: 'paypal',
    //   label: 'Give with PayPal',
    //   kind: 'link',
    //   url: 'https://www.paypal.com/donate/?hosted_button_id=REPLACE_ME',
    // },
    // {
    //   id: 'bank',
    //   label: 'Bank transfer',
    //   kind: 'bank',
    //   accounts: [
    //     {
    //       name: 'FIKRA [CONFIRM registered name]',
    //       bank: '[CONFIRM bank]',
    //       number: '[CONFIRM account number]',
    //       swift: '[CONFIRM SWIFT/BIC]',
    //     },
    //   ],
    // },
  ],
  presets: [], // e.g. [10, 25, 50, 100]
  amountParam: 'amount',
  currency: '',
  note: 'Online giving is being set up. In the meantime, contact us to give.',
};

export const NAV_LINKS = [
  { label: 'About', href: '/about' },
  { label: 'Impact', href: '/impact' },
  { label: 'Events', href: '/events' },
  { label: 'Get Involved', href: '/get-involved' },
  { label: 'News', href: '/news' },
] as const;

export const FOOTER_LINKS = {
  organisation: [
    { label: 'About', href: '/about' },
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
    { label: 'Documents', href: '/documents' },
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

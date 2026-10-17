/**
 * Single source of truth for organisation-wide values used across the site.
 *
 * NOTE FOR FIKRA: the values marked "[CONFIRM]" are placeholders and must be
 * replaced with the real, verified details before launch. See docs/fikra-inputs.md.
 */

export const SITE = {
  name: 'FIKRA',
  legalName: 'FIKRA',
  tagline: 'From idea to enterprise.',
  description:
    'FIKRA supports young people to turn ideas into sustainable enterprises through training, mentorship and access to opportunity.',
  // Replace with the real domain before launch (also update astro.config.mjs).
  url: 'https://fikra-gen-innovators.vercel.app',
  locale: 'en',
  email: 'fikrainnovator@gmail.com', // Public address, shown on the site.
  phone: '', // Set when FIKRA confirms a public phone number.
  address: {
    // Intentionally blank until FIKRA confirms a public address.
    line1: '',
    city: '',
    region: '',
    country: '',
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
  // Registration / legal details. Shown in the footer and on the Donate page
  // once confirmed.
  registrationNumber: '',
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
  /**
   * Where a link provider sends donors after a successful payment.
   * Point the provider's redirect/return URL at this page.
   */
  thanksUrl: string;
  /**
   * Optional fundraising thermometer. Leave `target` at 0 to hide it.
   * Update `raised` by hand whenever FIKRA totals donations.
   */
  goal: { target: number; raised: number; currency: string; label: string };
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
  thanksUrl: '/donate/thanks',
  goal: { target: 0, raised: 0, currency: '', label: '' },
};

/**
 * Site-wide announcement bar shown above the header on every page.
 * Leave `text` empty to hide the bar entirely.
 */
export const ANNOUNCEMENT: { text: string; href: string } = {
  text: '',
  href: '/get-involved#member',
};

export const NAV_LINKS = [
  { label: 'About', href: '/about' },
  { label: 'Impact', href: '/impact' },
  { label: 'Services', href: '/services' },
  { label: 'Events', href: '/events' },
  { label: 'Get Involved', href: '/get-involved' },
  { label: 'News', href: '/news' },
] as const;

export const FOOTER_LINKS = {
  organisation: [
    { label: 'About', href: '/about' },
    { label: 'Impact', href: '/impact' },
    { label: 'Services', href: '/services' },
    { label: 'Events', href: '/events' },
    { label: 'Team', href: '/team' },
    { label: 'News', href: '/news' },
    { label: 'Newsletter', href: '/newsletter' },
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
    { label: 'Accessibility', href: '/accessibility' },
  ],
} as const;

export const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
};

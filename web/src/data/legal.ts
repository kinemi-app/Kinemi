// Who runs this copy of Kinemi, for the Imprint, the Privacy Policy and the Terms.
// Fill in every [bracketed] value before you publish: the build lists the ones still missing.
// Written for an operator in Germany (Impressum under § 5 DDG, GDPR). Have the texts checked before launch.

export const LEGAL = {
  /** your full name, or the company's registered name */
  operator: '[Your name or company name]',
  /** e.g. 'GmbH', 'UG (haftungsbeschränkt)'; leave empty for a sole trader */
  legalForm: '',
  /** for a company: the managing director(s) */
  representative: '',
  street: '[Street and number]',
  postcode: '[Postcode]',
  city: '[City]',
  country: 'Germany',
  /** the Impressum needs an email address and a second fast way to reach you, usually a phone number */
  email: '[hello@your-domain.de]',
  phone: '[+49 …]',
  /** only if you are in a register, e.g. 'Handelsregister B, Amtsgericht München, HRB 123456' */
  register: '',
  /** only if you have one */
  vatId: '',
  /** responsible for journalistic content (§ 18 (2) MStV): only if the site publishes editorial content */
  editor: '',
  /** where people report abuse; defaults to the contact address */
  abuseEmail: '',
  /** the data protection authority of your federal state, e.g. 'Bayerisches Landesamt für Datenschutzaufsicht, Promenade 18, 91522 Ansbach' */
  authority: '[Data protection authority of your federal state]',
  /** your web host, e.g. 'Netlify, Inc., 101 2nd Street, San Francisco, CA 94105, USA' */
  host: '[Your hosting provider, with its address]',
  /** the service that sends sign-up and password emails, when accounts are on */
  emailProvider: '[Your email provider, with its address]',
  /** how long the host keeps access logs, e.g. '30 days' */
  logDays: '[30 days]',
  /** where Supabase keeps account data: pick the EU when you create the project */
  dataRegion: 'Frankfurt, Germany (EU)',
  /** people younger than this may not use the service */
  minimumAge: 18,
  /** the date the policies last changed */
  updated: '2026-10-26',
  /** where the source code lives, for the open-source release; leave empty to hide the link */
  repoUrl: '',
  /** Kinemi's own license once you choose one, e.g. 'AGPL-3.0'; leave empty until then */
  license: '',
};

/** The values still left as [placeholders]. */
export const unfilled = () =>
  Object.entries(LEGAL)
    .filter(([, v]) => typeof v === 'string' && /^\[.*\]$/.test(v.trim()))
    .map(([k]) => k);

let warned = false;
/** Says once per build which details the policy pages still miss. */
export function warnUnfilled() {
  const missing = unfilled();
  if (warned || !missing.length) return;
  warned = true;
  console.warn(`[kinemi] The policy pages need your details: fill in src/data/legal.ts before you publish (${missing.join(', ')})`);
}

export const address = () => [LEGAL.street, `${LEGAL.postcode} ${LEGAL.city}`, LEGAL.country].filter((x) => x.trim()).join(', ');

export const operatorName = () => [LEGAL.operator, LEGAL.legalForm].filter(Boolean).join(' ');

/** The policy pages, in the order the footer lists them. */
export const POLICIES = [
  { slug: 'imprint', label: 'Imprint', title: 'Imprint (Impressum)' },
  { slug: 'privacy', label: 'Privacy', title: 'Privacy Policy' },
  { slug: 'terms', label: 'Terms', title: 'Terms of Service' },
  { slug: 'acceptable-use', label: 'Acceptable use', title: 'Acceptable Use Policy' },
  { slug: 'cookies', label: 'Cookies & storage', title: 'Cookies and storage' },
  { slug: 'licenses', label: 'Licenses', title: 'Licenses' },
] as const;

/** What stands where the policy links would be, when Kinemi runs on this computer. */
export const LOCAL_POLICIES_TEXT = 'Your policies here';

/** True for localhost, any *.localhost name, 127.0.0.0/8 and ::1: a copy running on its owner's own machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const octets = host.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return octets !== null && octets.slice(1).every((part) => Number(part) <= 255);
}

/**
 * Replaces the policy links inside every [data-policies] element with the placeholder, when this
 * page is served from a loopback host. Public hosts keep the links the build rendered.
 */
export function showLocalPolicies(hostname: string = location.hostname, root: ParentNode = document) {
  if (!isLoopbackHost(hostname)) return;
  for (const nav of root.querySelectorAll('[data-policies]')) {
    const placeholder = document.createElement('span');
    placeholder.className = 'policies-placeholder';
    placeholder.textContent = LOCAL_POLICIES_TEXT;
    nav.replaceChildren(placeholder);
  }
}

export const policyUrl = (slug: (typeof POLICIES)[number]['slug']) => `${import.meta.env.BASE_URL ?? '/'}legal/${slug}/`.replace(/\/{2,}/g, '/');

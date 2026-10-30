// The sections of Settings, in the order the sidebar lists them. Each is a page: /app/settings/<id>/
import type { UiIconName } from '../lib/px-icons';

export interface Section {
  id: string;
  label: string;
  icon: UiIconName;
  blurb: string;
}

export const SECTIONS = [
  { id: 'account', label: 'Account', icon: 'user', blurb: 'Your name, how you sign in, and your account.' },
  { id: 'providers', label: 'Providers', icon: 'plug', blurb: 'The keys you bring, where renders run, and who answers in the chat.' },
  { id: 'models', label: 'Models', icon: 'cube', blurb: 'Default models, their licenses, and the model files ComfyUI loads.' },
  { id: 'rendering', label: 'Rendering', icon: 'video', blurb: 'Resolution, frame rate, negative prompts, file names and a spending limit.' },
  { id: 'interface', label: 'Interface', icon: 'sliders', blurb: 'Motion, the 3D models, the sidebar and keyboard shortcuts.' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', blurb: 'How Kinemi tells you a render landed.' },
  { id: 'data', label: 'Data & privacy', icon: 'shield', blurb: 'What Kinemi keeps, backups, and starting over.' },
  { id: 'about', label: 'Legal & about', icon: 'info', blurb: 'Version, policies, licenses and contact.' },
] as const satisfies readonly Section[];

export type SectionId = (typeof SECTIONS)[number]['id'];

export const sectionById = (id: string) => SECTIONS.find((s) => s.id === id);

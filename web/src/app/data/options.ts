// Option lists shared by the tools and the chat.

export const BODIES = [
  'Large format digital',
  'Super 35 digital',
  '35mm film stock',
  '16mm film stock',
  'Super 8 home movie',
  'VHS camcorder',
];

export const LENSES = ['14mm', '24mm', '35mm', '50mm', '85mm', '135mm', '40mm anamorphic'];
export const APERTURES = ['f/1.4', 'f/1.8', 'f/2.8', 'f/4', 'f/8', 'f/16'];

export const LOOKS = [
  'Neon noir',
  'Golden hour',
  'Blue hour',
  'Bleach bypass',
  'Warm film',
  'Cold steel',
  'Pastel',
  'Monochrome',
  'Day for night',
];

/** Five colours per look, dark to light, for the swatches and the lens test. */
export const LOOK_SWATCHES: Record<string, string[]> = {
  'Neon noir': ['#0b0f2a', '#2a1056', '#ff2e88', '#19e3ff', '#e9f6ff'],
  'Golden hour': ['#2b1a10', '#8a3b12', '#f29c38', '#ffd27a', '#fff1c9'],
  'Blue hour': ['#0a1430', '#1b2f6b', '#3d5fb0', '#8aa6e8', '#e6c7ff'],
  'Bleach bypass': ['#1c2022', '#4a5254', '#8c9496', '#c4c9c6', '#eef0ea'],
  'Warm film': ['#2a1c14', '#6b4226', '#b07a4a', '#e0b98a', '#f6e7cf'],
  'Cold steel': ['#0e171f', '#23384a', '#4f6f86', '#9db4c4', '#dfe9ee'],
  Pastel: ['#8e7aa8', '#f7a8c4', '#fde2c4', '#bfe8cf', '#c9dcf5'],
  Monochrome: ['#0d0d0d', '#3a3a3a', '#777777', '#b5b5b5', '#f0f0f0'],
  'Day for night': ['#050b1c', '#0d1f3d', '#1d3d6b', '#4f78a8', '#a9c4e0'],
};

/** Short names and a one-line character for each camera body. */
export const BODY_INFO: Record<string, { short: string; note: string }> = {
  'Large format digital': { short: 'Large format', note: 'big sensor' },
  'Super 35 digital': { short: 'Super 35', note: 'cinema standard' },
  '35mm film stock': { short: '35mm film', note: 'fine grain' },
  '16mm film stock': { short: '16mm film', note: 'indie grain' },
  'Super 8 home movie': { short: 'Super 8', note: 'home movie' },
  'VHS camcorder': { short: 'VHS', note: 'tape, 1989' },
};

export const ASPECTS = ['16:9', '2.39:1', '9:16', '1:1', '4:5'];
export const DURATIONS = ['3 s', '5 s', '8 s', '10 s'];
export const RESOLUTIONS = ['720p', '1080p'];

/** The eight emotions of AI Cast and the Genjutsu wheel, in wheel order. */
export const EMOTIONS = ['Joy', 'Trust', 'Fear', 'Surprise', 'Sadness', 'Disgust', 'Anger', 'Anticipation'];

export const SOUL_PRESETS = ['Editorial', 'Dream film', 'Hard flash', 'Noir', 'Vapor', 'Analog', 'Sun bleached', 'Night market'];

// Chatterbox renders one stock voice; any other voice is a clone of the user's own sample.
export const VOICES = ['Default voice', 'Your cloned voice'];
export const LANGUAGES = ['English', 'German', 'Spanish', 'French', 'Japanese', 'Portuguese', 'Hindi', 'Turkish'];

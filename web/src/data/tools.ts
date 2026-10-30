import type { IconName } from '../lib/pixel-icons';

export interface Tool {
  name: string;
  tag: string;
  text: string;
  icon: IconName;
  studio?: boolean;
}

// The 16 tools, in the order the app lists them. Copy comes straight from the product.
export const TOOLS: Tool[] = [
  {
    name: 'Cinematic',
    tag: 'Camera · lenses · looks',
    text: 'Build one shot: stack camera moves, pick a body, lens and aperture, set the look, then render the frames.',
    icon: 'cinematic',
  },
  {
    name: 'Storyboard',
    tag: 'Shot list',
    text: 'Queue up to eight shots, each with its own prompt, model and duration, then render the list in order.',
    icon: 'storyboard',
  },
  {
    name: 'Re-shoot',
    tag: 'New angle',
    text: 'Take a finished image and change the angle of the camera: orbit, tilt and level, with the subject left alone.',
    icon: 'reshoot',
  },
  {
    name: 'Genjutsu',
    tag: 'Motion transfer',
    text: 'Move a performance from a source clip onto a face or a character card, with emotions from a wheel.',
    icon: 'genjutsu',
  },
  {
    name: 'Presets',
    tag: 'Move library',
    text: 'The camera move library with the prompt each move is written as, ready to drop into a shot.',
    icon: 'presets',
  },
  {
    name: 'Soul',
    tag: 'Palette · stills',
    text: 'Turn one sentence into a five-colour HEX palette, pick a Soul 2.0 preset, then render the still with the palette locked.',
    icon: 'soul',
  },
  {
    name: 'AI Cast',
    tag: 'Characters',
    text: 'Build a character: name, reference images, a locked identity and eight emotions, then copy its tag into any prompt.',
    icon: 'cast',
  },
  {
    name: 'Edit',
    tag: 'Clip in, clip out',
    text: 'Take a finished clip, write what should change, set how hard the edit lands and re-render it on an open video model.',
    icon: 'edit',
  },
  {
    name: 'Academy',
    tag: 'Tutorials',
    text: 'Fourteen short lessons on camera language, prompts, open models, working in Kinemi and running ComfyUI, each with a live figure, a quiz and a glossary.',
    icon: 'academy',
  },
  {
    name: 'Audio Studio',
    tag: 'Studio',
    text: 'Voiceover, voice cloning, dubbing, multi-speaker scenes and sound effects.',
    icon: 'audio',
    studio: true,
  },
  {
    name: 'Marketing Studio',
    tag: 'Studio',
    text: 'A product photo or URL to an ad, UGC and tutorial templates, hook variations.',
    icon: 'marketing',
    studio: true,
  },
  {
    name: 'Fashion Factory',
    tag: 'Studio',
    text: 'Swap a garment or a model, keep the drape and lighting, build an influencer campaign.',
    icon: 'fashion',
    studio: true,
  },
  {
    name: 'Canvas',
    tag: 'Studio',
    text: 'Wire models into a pipeline on a node board, save the graph, share it with the team.',
    icon: 'canvas',
    studio: true,
  },
  {
    name: '3D Previz',
    tag: 'Studio',
    text: 'Orbit a 3D previz, export GLB and clips, send camera keyframes to After Effects.',
    icon: 'previz',
    studio: true,
  },
  {
    name: 'Supercomputer',
    tag: 'Studio',
    text: 'Plan a campaign from one brief, run it in batches, drive it from the CLI.',
    icon: 'supercomputer',
    studio: true,
  },
  {
    name: 'Upscale',
    tag: 'Studio',
    text: '4K upscale, frame interpolation to 60 fps and deflicker.',
    icon: 'upscale',
    studio: true,
  },
];

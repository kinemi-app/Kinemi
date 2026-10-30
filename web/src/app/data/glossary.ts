// The Academy's glossary: the words of the set and of ComfyUI, in plain language.
// `lesson` points at the lesson that explains a term in more depth.

export interface Term {
  term: string;
  says: string;
  lesson?: string;
}

export const GLOSSARY: Term[] = [
  { term: 'Anamorphic', says: 'A lens that squeezes a wide image onto the sensor. Gives the scope frame, oval highlights and long horizontal flares.', lesson: 'lenses' },
  { term: 'Aperture', says: 'The opening the light comes through, written as an f-number. Wide open (f/1.4) blurs the background; stopped down (f/16) keeps everything sharp.', lesson: 'lenses' },
  { term: 'Aspect ratio', says: 'The frame’s shape, width to height: 2.39:1 for cinema, 16:9 for screens, 9:16 for phones.', lesson: 'framing' },
  { term: 'Backlight', says: 'Light from behind the subject, which outlines it with a bright rim.', lesson: 'light' },
  { term: 'Batch', says: 'Several renders queued together. Supercomputer runs a batch side by side, as many at once as Settings allows.', lesson: 'production' },
  { term: 'CFG', says: 'Classifier-free guidance: how closely the sampler follows the prompt. Higher follows harder; too high looks overcooked.', lesson: 'graph' },
  { term: 'Checkpoint', says: 'A model file with everything in one: the diffusion model, the text encoder and the VAE.', lesson: 'install' },
  { term: 'Close-up', says: 'A face, or one thing, fills the frame. Asks the audience to feel what the subject feels.', lesson: 'shot-sizes' },
  { term: 'ComfyUI', says: 'The open-source app that runs diffusion models as a graph of nodes. Kinemi builds the graphs and sends them to it.', lesson: 'graph' },
  { term: 'Crane', says: 'The camera rises or falls on an arm. Rising at the end of a scene feels like an ending.', lesson: 'moves' },
  { term: 'Depth of field', says: 'How much of the scene, front to back, is sharp. Shallow at wide apertures and long lenses.', lesson: 'lenses' },
  { term: 'Diffusion model', says: 'A model that draws by starting from noise and removing it step by step, guided by a prompt.', lesson: 'graph' },
  { term: 'Dolly', says: 'The whole camera rolls toward or away from the subject. Unlike a zoom, the space opens around it.', lesson: 'moves' },
  { term: 'Dutch angle', says: 'A tilted horizon. Makes a scene feel uneasy or wrong.', lesson: 'shot-sizes' },
  { term: 'Focal length', says: 'How long a lens is, in millimetres. Short lenses see wide and exaggerate depth, long ones see narrow and compress it.', lesson: 'lenses' },
  { term: 'Frame interpolation', says: 'Making new frames between existing ones, to turn 24 fps into 48 or 60. Kinemi uses RIFE for it.' },
  { term: 'Frame rate', says: 'Frames per second. 24 is cinema, 25 is European TV, 30 and 60 are common online.' },
  { term: 'Golden hour', says: 'The hour after sunrise and before sunset: low, warm light and long shadows.', lesson: 'light' },
  { term: 'Handheld', says: 'The camera is held by hand, with a little shake. Feels immediate, documentary, nervous.', lesson: 'moves' },
  { term: 'I2V', says: 'Image to video: a model animates a still you give it, so the first frame is yours.', lesson: 'open-weights' },
  { term: 'Insert', says: 'A close shot of a detail that matters: a hand on a handle, a note, a sign.', lesson: 'storyboard' },
  { term: 'KSampler', says: 'ComfyUI’s standard sampler node: takes the model, the encoded prompt, a seed and the number of steps, and draws.', lesson: 'graph' },
  { term: 'Latent', says: 'The compressed space a diffusion model works in. The VAE turns latents into pixels and back.', lesson: 'graph' },
  { term: 'Look', says: 'The colour and contrast an image is graded with: neon noir, bleach bypass, warm film.', lesson: 'light' },
  { term: 'LoRA', says: 'A small add-on file that teaches a model a style, a face or a product without retraining it.' },
  { term: 'Medium shot', says: 'A person from the waist up. How we watch people talk.', lesson: 'shot-sizes' },
  { term: 'Negative prompt', says: 'What the model should stay away from: blur, watermarks, extra fingers. Set yours in Settings → Rendering.', lesson: 'prompts' },
  { term: 'Open weights', says: 'A model whose files anyone can download and run, under the model’s own license.', lesson: 'open-weights' },
  { term: 'Orbit', says: 'The camera circles the subject at the same distance, showing it from every side.', lesson: 'moves' },
  { term: 'Pan', says: 'The camera turns left or right on the spot, like a head turning.', lesson: 'moves' },
  { term: 'Previz', says: 'Previsualisation: blocking a shot in rough 3D before shooting or rendering it.' },
  { term: 'Prompt', says: 'The text a model draws from. Works best as subject, place, light, then camera.', lesson: 'prompts' },
  { term: 'Sampler', says: 'The step that turns noise into a picture, one denoising step at a time. Euler and uni_pc are two common ones.', lesson: 'graph' },
  { term: 'Seed', says: 'The number that fixes the starting noise. Same seed and settings, same result; a new seed, a new take.', lesson: 'graph' },
  { term: 'Steps', says: 'How many denoising steps the sampler takes. More is slower and usually cleaner, up to a point.', lesson: 'graph' },
  { term: 'T2V', says: 'Text to video: a model makes a clip from a prompt alone.', lesson: 'open-weights' },
  { term: 'Take', says: 'One render of a shot. Kinemi keeps every take in Assets; nothing overwrites the last.', lesson: 'takes' },
  { term: 'Text encoder', says: 'The model that turns your prompt into numbers the diffusion model understands, such as T5 or UMT5.', lesson: 'graph' },
  { term: 'Tilt', says: 'The camera turns up or down on the spot.', lesson: 'moves' },
  { term: 'Tracking shot', says: 'The camera moves alongside a moving subject, keeping pace with it.', lesson: 'moves' },
  { term: 'Truck', says: 'The camera slides sideways, parallel to the subject.', lesson: 'moves' },
  { term: 'Upscale', says: 'Making a render bigger and sharper after the fact, for example to 4K, instead of rendering big from the start.', lesson: 'cost' },
  { term: 'VAE', says: 'The model part that turns latents into pixels (and back). Each model family has its own.', lesson: 'graph' },
  { term: 'Wide shot', says: 'Shows the whole place and who is in it. Sets the scene.', lesson: 'shot-sizes' },
  { term: 'Workflow (API format)', says: 'A ComfyUI graph as JSON, the way its /prompt endpoint takes it. Every tool page shows its own.', lesson: 'graph' },
  { term: 'Zoom', says: 'Changing the focal length during a shot. The background grows with the subject and the depth flattens.', lesson: 'moves' },
];

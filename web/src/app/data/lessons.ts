// The Academy: fourteen short lessons in four tracks. Each has a short read, a live figure built from the
// studio's own controls, a “Try it” that opens the tool set up for it, and a quiz that marks it done.
import type { SectionId } from './sections';
import type { ToolId } from './tools';

export type Track = 'camera' | 'writing' | 'workflow' | 'comfy';

export const TRACKS: Array<{ id: Track; name: string; blurb: string }> = [
  { id: 'camera', name: 'Camera language', blurb: 'Sizes, moves, lenses, frames and light: the grammar every shot is built from.' },
  { id: 'writing', name: 'Writing and models', blurb: 'Prompts the open models follow, which model to pick, and what it costs.' },
  { id: 'workflow', name: 'Working in Kinemi', blurb: 'Takes, shot lists and production runs.' },
  { id: 'comfy', name: 'ComfyUI', blurb: 'How a render works, and running it on your own compute.' },
];

/** The live figure a lesson shows. */
export type Figure = 'sizes' | 'moves' | 'optics' | 'frame' | 'look' | 'prompt' | 'models' | 'cost' | 'graph' | 'files';

export interface Quiz {
  q: string;
  options: string[];
  /** index of the right option */
  answer: number;
  why: string;
}

export type TryIt = { label: string; tool: ToolId; values?: Record<string, unknown> } | { label: string; settings: SectionId } | { label: string; assets: true };

export interface Lesson {
  id: string;
  track: Track;
  title: string;
  minutes: number;
  summary: string;
  body: string[];
  points: string[];
  figure?: Figure;
  tryIt?: TryIt;
  quiz: Quiz[];
}

export const LESSONS: Lesson[] = [
  /* ---------------------------------------------------------------- camera */
  {
    id: 'shot-sizes',
    track: 'camera',
    title: 'Shot sizes and angles',
    minutes: 4,
    summary: 'Wide, medium, close, and where the lens sits. The grammar every move builds on.',
    body: [
      'A shot size says how much of the world is in the frame. A wide shot sets the place and who is in it; a medium shot, from the waist up, is how we watch people talk; a close-up fills the frame with a face and asks the audience to feel what it feels.',
      'The angle says how we see it. At eye level the camera is neutral. Low, looking up, a subject looms and seems powerful; high, looking down, it shrinks. A tilted horizon, the Dutch angle, makes a scene feel wrong.',
      'Models read these words the way a crew does. Name the size and the angle in the prompt, and cut between sizes on purpose: wide to set the scene, closer as the feeling rises.',
    ],
    points: ['A wide shot sets the place, a close-up sets the feeling.', 'Low angles make a subject loom, high angles make it small.', 'Name the size in the prompt: “medium close-up, eye level”.'],
    figure: 'sizes',
    tryIt: { label: 'Set up a low-angle close-up', tool: 'cinematic', values: { prompt: 'Low angle close-up of a boxer catching her breath between rounds, sweat in the ring lights', moves: ['push-in'], speed: 'Slow' } },
    quiz: [
      { q: 'Which size best shows where a scene takes place?', options: ['Extreme close-up', 'Wide shot', 'Insert'], answer: 1, why: 'A wide shot shows the place and who is in it.' },
      { q: 'You want a villain to feel powerful. Where does the camera go?', options: ['Low, looking up', 'High, looking down', 'Overhead'], answer: 0, why: 'Looking up at someone makes them loom over the audience.' },
      { q: 'What does a Dutch angle do?', options: ['Hides the subject’s face', 'Tilts the horizon so the scene feels off', 'Doubles the frame rate'], answer: 1, why: 'A tilted horizon tells the audience that something is wrong.' },
    ],
  },
  {
    id: 'moves',
    track: 'camera',
    title: 'Moves that tell the story',
    minutes: 5,
    summary: 'Dolly, orbit, crane and tilt: what each move says, and how to stack two.',
    body: [
      'A camera move is a sentence. A dolly in, the whole camera rolling closer, pulls the audience toward a subject: discovery, tension, intimacy. A dolly out leaves the subject alone in a growing world.',
      'Truck and orbit move sideways: a truck slides along, an orbit circles the subject at the same distance and shows it from every side. A crane rises or falls; going up at the end of a scene feels like an ending. Pan and tilt turn the camera on the spot, like a head turning.',
      'Zoom is not a dolly. A zoom changes the lens, so the background grows with the subject and the depth flattens. A dolly moves the camera, so the space opens around it.',
      'Stack at most two moves. The first one leads: “dolly in, then tilt up” reads very differently from the other way round.',
    ],
    points: ['A dolly in pulls the audience closer. A dolly out leaves the subject alone.', 'Orbit to show a subject from every side; keep the distance constant.', 'Stack at most two moves per shot. The first one leads.'],
    figure: 'moves',
    tryIt: { label: 'Try an orbit and a crane', tool: 'cinematic', values: { prompt: 'A lone lighthouse keeper on a rocky island at dusk, waves breaking', moves: ['orbit-left', 'crane-up'], speed: 'Slow' } },
    quiz: [
      { q: 'What is the difference between a dolly in and a zoom in?', options: ['There is none', 'A dolly moves the camera, a zoom changes the lens', 'A zoom is always slower'], answer: 1, why: 'A dolly moves the camera through space; a zoom changes the focal length, flattening depth.' },
      { q: 'Which move circles the subject at the same distance?', options: ['Truck', 'Orbit', 'Tilt'], answer: 1, why: 'An orbit circles the subject; a truck slides along a line.' },
      { q: 'How many moves should one shot stack?', options: ['As many as possible', 'At most two', 'Exactly three'], answer: 1, why: 'Two moves read as one idea; more turn into noise.' },
    ],
  },
  {
    id: 'lenses',
    track: 'camera',
    title: 'Lenses and aperture',
    minutes: 4,
    summary: 'Why 24mm feels wide and wild, why 85mm flatters, and what f/1.8 does to the background.',
    body: [
      'Focal length decides how much the lens sees and how it treats depth. Short lenses, 14 to 24mm, see wide and exaggerate distance: close things loom, far things shrink. Long lenses, 85mm and up, see narrow and compress: the background crowds in behind the subject.',
      'Around 35 to 50mm is close to how we see. 85mm is the classic portrait lens because it flatters a face. An anamorphic lens squeezes a wide frame onto the sensor, with oval highlights and long flares.',
      'The aperture is the hole the light comes through. Wide open, f/1.4 to f/2.8, the depth of field is shallow: the subject is sharp and the background melts. Stopped down, f/8 and up, everything is sharp from front to back.',
    ],
    points: ['Short lenses exaggerate depth, long lenses compress it.', 'Wide apertures (f/1.4 to f/2.8) blur the background.', 'Write lens and aperture together: “35mm, f/1.8”.'],
    figure: 'optics',
    tryIt: { label: 'Shoot a portrait at 85mm, f/1.4', tool: 'cinematic', values: { prompt: 'Portrait of an old fisherman mending a net, harbour behind him', lens: '85mm', aperture: 'f/1.4', moves: ['push-in'], speed: 'Slow' } },
    quiz: [
      { q: 'Which lens makes a face look flattering and the background crowd in?', options: ['14mm', '35mm', '85mm'], answer: 2, why: 'Long lenses compress depth; 85mm is the classic portrait lens.' },
      { q: 'You want the background soft and blurred. Which aperture?', options: ['f/1.8', 'f/8', 'f/16'], answer: 0, why: 'A wide aperture gives a shallow depth of field.' },
      { q: 'What does a short, wide lens do to distance?', options: ['Compresses it', 'Exaggerates it', 'Nothing'], answer: 1, why: 'Close things loom and far things shrink.' },
    ],
  },
  {
    id: 'framing',
    track: 'camera',
    title: 'Frames and aspect ratios',
    minutes: 3,
    summary: '2.39:1 for cinema, 16:9 for screens, 9:16 for phones: the frame decides what fits.',
    body: [
      'The aspect ratio is the frame’s shape, width to height. 2.39:1, the scope frame, is wide and cinematic: landscapes and two people in a shot. 16:9 is every screen’s shape. 9:16 is a phone held upright, for reels and stories. 1:1 and 4:5 sit well in feeds.',
      'Pick the frame before you compose. A wide frame wants space around the subject; an upright frame wants one subject, tall, filling it. Don’t make one shot and crop it for every channel: the composition breaks. Supercomputer makes a version per frame instead.',
      'Keep important things away from the very edges, especially in 9:16, where apps lay buttons and captions over the frame.',
    ],
    points: ['2.39:1 is cinema, 16:9 is screens, 9:16 is phones.', 'Compose for the frame; don’t crop one shot for every channel.', 'Keep faces and text away from the edges of a 9:16 frame.'],
    figure: 'frame',
    tryIt: { label: 'Make a 9:16 shot', tool: 'cinematic', values: { prompt: 'A skateboarder drops into an empty pool at golden hour', aspect: '9:16', moves: ['tilt-down'], speed: 'Normal' } },
    quiz: [
      { q: 'Which frame is made for phones held upright?', options: ['2.39:1', '16:9', '9:16'], answer: 2, why: '9:16 is the upright phone frame for reels and stories.' },
      { q: 'Why not crop one 2.39:1 shot into every other frame?', options: ['It costs more', 'The composition breaks', 'Models refuse'], answer: 1, why: 'A wide composition rarely survives being cut into a tall frame.' },
    ],
  },
  {
    id: 'light',
    track: 'camera',
    title: 'Light and look',
    minutes: 4,
    summary: 'Golden hour, blue hour, neon: name the light and the colour, and the mood follows.',
    body: [
      'Light carries more mood than anything else in the frame. Golden hour, the hour after sunrise and before sunset, is warm and low, with long shadows. Blue hour, just after sunset, is cool and calm. Hard midday sun is harsh; overcast light is soft and even.',
      'Where the light comes from matters too. Backlight outlines a subject with a rim; side light carves a face into light and shadow; light from below feels unnatural and unsettling.',
      'A look is the colour and contrast the image is graded with: neon noir, bleach bypass, warm film. Kinemi’s looks write that into the prompt for you, and the film body adds grain and texture on top.',
    ],
    points: ['Name the light: golden hour, blue hour, overcast, neon.', 'Say where it comes from: backlight, side light, from below.', 'A look is a grade: colour and contrast. Pick one per scene and keep it.'],
    figure: 'look',
    tryIt: { label: 'Shoot it in blue hour', tool: 'cinematic', values: { prompt: 'A night train pulls into an empty mountain station, steam in the lamplight', look: 'Blue hour', moves: ['tracking'], speed: 'Slow' } },
    quiz: [
      { q: 'When is golden hour?', options: ['At noon', 'Just after sunrise and before sunset', 'Just after midnight'], answer: 1, why: 'The sun is low and warm: long shadows, golden light.' },
      { q: 'Light from below a face feels…', options: ['Natural', 'Flattering', 'Unsettling'], answer: 2, why: 'We rarely see faces lit from below, so it reads as wrong.' },
    ],
  },

  /* --------------------------------------------------------------- writing */
  {
    id: 'prompts',
    track: 'writing',
    title: 'Prompts that render',
    minutes: 6,
    summary: 'Subject, place, light, then camera. A prompt order the open models follow.',
    body: [
      'Open video models were trained on captions that describe a picture: who is in it, where, what the light is like, how it was shot. Write in that order and they follow you: subject, place, light, camera.',
      'Be concrete. “A woman” is a coin toss; “a woman in her sixties in a yellow raincoat” is a person. One idea per sentence: models read commas as lists and lose track of long ones.',
      'Say what happens, not what it means. “She laughs and turns away” renders; “she realises she was wrong” doesn’t. Put what you don’t want in the negative prompt rather than writing “no” in the prompt.',
      'Kinemi writes the camera part for you from the rig, the lens and the look, so your words can stay on the scene.',
    ],
    points: ['Lead with who and where, then the light, then the camera.', 'Concrete and visible beats abstract: describe actions, not meanings.', 'Unwanted things go in the negative prompt, not as “no …” in the prompt.'],
    figure: 'prompt',
    tryIt: { label: 'Write one in Cinematic', tool: 'cinematic', values: { prompt: 'An old man in a red scarf feeds pigeons on a snowy bench in a city park, soft overcast light' } },
    quiz: [
      { q: 'Which order do open models follow best?', options: ['Camera, light, place, subject', 'Subject, place, light, camera', 'Any order works the same'], answer: 1, why: 'It matches how the captions they learned from were written.' },
      { q: 'Which line renders better?', options: ['She realises she was wrong', 'She laughs and turns away from the window', 'Make it emotional'], answer: 1, why: 'Visible actions render; inner states don’t.' },
      { q: 'You don’t want text in the frame. Where does that go?', options: ['“no text” in the prompt', 'The negative prompt', 'The file name'], answer: 1, why: 'Negative prompts steer away from things; “no text” in the prompt can add text.' },
    ],
  },
  {
    id: 'open-weights',
    track: 'writing',
    title: 'Open models, and which to pick',
    minutes: 5,
    summary: 'Wan, LTX, Hunyuan, FLUX and Qwen: drafts, finals, stills and edits.',
    body: [
      'Kinemi runs open models, whose weights anyone can download and run. Each has a job. Wan 2.2 costs the fewest credits per second, and its I2V version starts from an image you give it. LTX-2 and LTX-2.5 render fastest and make the longest clips, up to 10 seconds. HunyuanVideo 1.5 is the slowest, and the best at faces and small motion.',
      'For stills, FLUX.2 dev is photographic, FLUX 3 Image Klein is a small 5.6B model for Soul images, and Qwen-Image renders clean text for the lowest cost. To change a still you already have, FLUX.2 dev and Qwen-Image-Edit keep everything you don’t ask them to change.',
      'Draft short and cheap, then render the keeper on the model that suits it. Read each model’s license before you use it for work: FLUX.2 dev may not run in a commercial product without a license from Black Forest Labs, though the stills it makes may be used commercially, and FLUX 3 Image Klein’s FLUX Kommunity License limits commercial use, so read its terms on the model card first. HunyuanVideo 1.5 is not licensed for use in the EU, the UK or South Korea, and the clips it makes may not be used there either. LTX-2 and LTX-2.5 are free for commercial use only to companies under $10M a year in revenue.',
    ],
    points: ['Draft short and cheap, then render the keeper on the model that suits it.', 'Image models make the stills that video models animate.', 'FLUX.2 dev needs a license to run commercially; the stills it makes are yours to use.', 'Every model has its own license: check it before commercial work.'],
    figure: 'models',
    tryIt: { label: 'Pick your default models', settings: 'models' },
    quiz: [
      { q: 'Which models make the longest clips in Kinemi?', options: ['Wan 2.2', 'LTX-2 and LTX-2.5', 'HunyuanVideo 1.5'], answer: 1, why: 'LTX-2 and LTX-2.5 run up to 10 seconds; Wan 2.2 stops at 5 and HunyuanVideo 1.5 at 8.' },
      { q: 'You want a poster with legible text on it. Which model?', options: ['Qwen-Image', 'Wan 2.2', 'LTX-2'], answer: 0, why: 'Qwen-Image is good at clean text in images.' },
      { q: 'Which model needs a license from its maker before it runs in a commercial product?', options: ['FLUX.2 dev', 'Wan 2.2', 'Qwen-Image'], answer: 0, why: 'FLUX.2 dev ships under a non-commercial license, though its stills may be used commercially; Wan 2.2 and Qwen-Image are Apache-2.0.' },
    ],
  },
  {
    id: 'cost',
    track: 'writing',
    title: 'Cost first: runtime and credits',
    minutes: 3,
    summary: 'Read the estimate before you press render, and make it smaller.',
    body: [
      'Every render costs GPU time: on Comfy Cloud that is credits on your account, on your own GPU it is time and electricity. Kinemi shows the runtime and credits before anything renders, and Settings → Rendering can ask before anything over a limit.',
      'Three things drive the cost: duration, resolution and the model’s rate. A 10-second clip costs twice a 5-second one; 1080p costs about twice 720p; and per second, LTX-2.5 costs more than twice what Wan 2.2 T2V does. Fast is not cheap: LTX renders quickest but costs the most per second.',
      'So draft small and short, on a cheap model. When a take is right, upscale it instead of re-rendering it big.',
    ],
    points: ['Credits grow with duration, resolution and the model’s rate per second.', 'Render drafts at 720p, then upscale the take you keep.', 'Storyboards and batches add up their shots: the total is shown first.'],
    figure: 'cost',
    tryIt: { label: 'Set a spending limit', settings: 'rendering' },
    quiz: [
      { q: 'Which change roughly doubles the cost?', options: ['Going from 5 to 10 seconds', 'Changing the look', 'Renaming the shot'], answer: 0, why: 'Runtime grows with duration.' },
      { q: 'What’s the cheapest way to a sharp 4K take?', options: ['Render it at 4K from the start', 'Draft at 720p, then upscale the keeper', 'Render it three times'], answer: 1, why: 'Upscaling one keeper costs far less than rendering every draft big.' },
    ],
  },

  /* -------------------------------------------------------------- workflow */
  {
    id: 'takes',
    track: 'workflow',
    title: 'Takes and the asset store',
    minutes: 3,
    summary: 'Every render lands in Assets as a take: compare them, keep the best, file them away.',
    body: [
      'Every render is a new take. Nothing overwrites the last one: change one setting, render again, and compare. The same settings with a new seed give a different take of the same shot.',
      'Assets keeps everything. Favourite the keepers, tag them (“hero shot”, “needs fix”), and drag them onto folders to keep a project together. The drawer shows how each take was made, so you can open it in its tool and go again.',
    ],
    points: ['Each render is a new take; nothing overwrites the last one.', 'Tag takes like “hero shot” or “needs fix” to find them later.', 'Drag takes onto a folder to keep a project together.'],
    tryIt: { label: 'Open Assets', assets: true },
    quiz: [
      { q: 'You render the same shot again with the same settings. What happens?', options: ['The old take is replaced', 'A new take appears next to it', 'Nothing'], answer: 1, why: 'Every render is kept as its own take.' },
      { q: 'Where do you mark a take that needs another pass?', options: ['With a tag, like “needs fix”', 'By deleting it', 'In the file name'], answer: 0, why: 'Tags make takes easy to find and filter.' },
    ],
  },
  {
    id: 'storyboard',
    track: 'workflow',
    title: 'Shot lists and storyboards',
    minutes: 4,
    summary: 'Plan a scene as a list of shots, then queue it in one go.',
    body: [
      'A scene is rarely one shot. A storyboard breaks it into a list: wide to set the place, medium for the action, close-ups for the feeling, an insert for the detail that matters.',
      'In Storyboard every shot has its own prompt, model and length, and the whole board shares one frame and one look, so the shots cut together. The total runtime and credits are added up before you queue it.',
      'Give each shot one job. If you can’t say what a shot is for, leave it out.',
    ],
    points: ['Wide, medium, close, insert: give every shot one job.', 'One frame and one look for the whole board, so the shots cut together.', 'The board shows its total cost before it renders.'],
    tryIt: { label: 'Open Storyboard', tool: 'storyboard' },
    quiz: [
      { q: 'Why share one look across a board?', options: ['It renders faster', 'So the shots cut together', 'Models require it'], answer: 1, why: 'A shared grade and frame make separate shots feel like one scene.' },
      { q: 'What is an insert?', options: ['A close shot of a detail that matters', 'The first wide shot', 'A transition'], answer: 0, why: 'An insert shows a detail: a hand on a door handle, a sign, a note.' },
    ],
  },
  {
    id: 'production',
    track: 'workflow',
    title: 'Production runs',
    minutes: 4,
    summary: 'Supercomputer: deliverables × variants, a budget, a batch, then review.',
    body: [
      'A campaign needs many versions of the same idea: a hero film, a vertical cut, a square post, stills, in several places or looks. Supercomputer lays that out as a grid: deliverables are the rows, the variants the columns, and every cell is one render with its own cost.',
      'A budget decides what runs. Switch off the cells you don’t need, and the batch renders the rest side by side into the campaign’s folder.',
      'Then review: approve the takes that work, mark the ones that need a fix, and upscale the approved ones together. The plan exports as plan.yaml, so a run can be repeated.',
    ],
    points: ['Rows are deliverables, columns are variants, cells are renders.', 'A budget decides what runs; switch off what you don’t need.', 'Approve, fix, then upscale the approved takes in one go.'],
    tryIt: { label: 'Open Supercomputer', tool: 'supercomputer' },
    quiz: [
      { q: 'In Supercomputer, what is one cell?', options: ['A folder', 'One render with its own cost', 'A whole campaign'], answer: 1, why: 'Every cell is one render: a deliverable in one variant.' },
      { q: 'What decides which cells run?', options: ['The budget and the cells you switch off', 'The order you added them', 'Random choice'], answer: 0, why: 'Cells run in order until the budget is spent; switched-off cells never run.' },
    ],
  },

  /* ----------------------------------------------------------------- comfy */
  {
    id: 'graph',
    track: 'comfy',
    title: 'How a render works',
    minutes: 5,
    summary: 'Behind every shot is a ComfyUI graph: models load, the prompt is encoded, a sampler draws it.',
    body: [
      'ComfyUI renders by running a graph of nodes, each doing one step. Loaders bring in the model files. A text encoder turns your prompt and the negative prompt into numbers the model understands.',
      'The sampler does the work: starting from noise, it removes a little of it in each step, guided by the prompt, until a picture or a clip is left. The seed fixes the starting noise, so the same seed and settings repeat the take on the same setup. Steps and CFG set how long it works and how closely it follows the prompt.',
      'A decoder, the VAE, turns the result into frames, and a save node writes the file. Every tool page in Kinemi shows its graph live: change a setting and watch which node it touches.',
    ],
    points: ['Loaders, a text encoder, a sampler, a decoder, a save node.', 'The seed fixes the starting noise: same seed, settings and setup, same result.', 'Every tool page shows its graph and the API JSON it sends.'],
    figure: 'graph',
    tryIt: { label: 'See the graph in Cinematic', tool: 'cinematic' },
    quiz: [
      { q: 'What does the sampler do?', options: ['Saves the file', 'Removes noise step by step, guided by the prompt', 'Downloads the model'], answer: 1, why: 'Diffusion models draw by removing noise in steps.' },
      { q: 'You want the exact same take again. What must stay the same?', options: ['The seed and the settings', 'Only the prompt', 'The file name'], answer: 0, why: 'The seed fixes the starting noise; with the same settings the result repeats.' },
      { q: 'What does the VAE do?', options: ['Encodes the prompt', 'Turns the result into frames', 'Picks the camera move'], answer: 1, why: 'The VAE decodes the model’s latent result into pixels.' },
    ],
  },
  {
    id: 'comfy',
    track: 'comfy',
    title: 'Connect your own Comfy',
    minutes: 6,
    summary: 'Bring a Comfy Cloud key, or point Kinemi at ComfyUI on your own GPU.',
    body: [
      'Kinemi doesn’t render on a server of its own. You bring the compute, in one of two ways.',
      'Comfy Cloud: make an API key at platform.comfy.org under API keys (it’s shown once: keep it in a password manager) and paste it in Settings → Providers. Renders run on your Comfy Cloud account; API access is on the paid plans (Standard, Creator and Pro) and not on the free one.',
      'Your own GPU: run ComfyUI on your machine and enter its address, usually http://127.0.0.1:8188. ComfyUI has to allow calls from Kinemi: start it with --enable-cors-header followed by Kinemi’s address. If your browser asks whether this site may reach devices on your network, allow it. “Test connection” then shows your GPU and how much memory it has.',
      'Your keys stay in your browser and only go to the service they belong to.',
    ],
    points: ['A Comfy Cloud key runs renders on your Comfy Cloud account.', 'Local: run ComfyUI and enter its address, usually 127.0.0.1:8188.', 'Start ComfyUI with --enable-cors-header so Kinemi may talk to it.'],
    tryIt: { label: 'Open Settings → Providers', settings: 'providers' },
    quiz: [
      { q: 'What’s the usual address of ComfyUI on your own computer?', options: ['http://127.0.0.1:8188', 'https://comfy.org', 'http://localhost:80'], answer: 0, why: 'ComfyUI listens on port 8188 on your machine by default.' },
      { q: 'Kinemi can’t reach your local ComfyUI. What do you add when you start it?', options: ['--enable-cors-header', '--lowvram', '--preview-method auto'], answer: 0, why: 'Without it, ComfyUI doesn’t allow calls from a website.' },
      { q: 'Where does your Comfy Cloud key go?', options: ['Into your Kinemi account', 'It stays in your browser and only goes to Comfy Cloud', 'Into every export'], answer: 1, why: 'Keys never leave the browser except to their own service.' },
    ],
  },
  {
    id: 'install',
    track: 'comfy',
    title: 'Install the models',
    minutes: 6,
    summary: 'Which file goes in which folder, and how to check that ComfyUI sees them.',
    body: [
      'On your own GPU, ComfyUI needs the model files on disk. They go in folders inside ComfyUI/models: diffusion models in diffusion_models, text encoders in text_encoders, VAEs in vae, checkpoints in checkpoints and upscalers in upscale_models.',
      'The table below lists every file Kinemi’s graphs ask for, with the names ComfyUI’s own example workflows use. You don’t need all of them: only the files for the models you use. The frame interpolation in Upscale comes from the ComfyUI-Frame-Interpolation node pack, which downloads its model by itself.',
      'Named a file differently? Change the name in Settings → Models, and “Check files on my ComfyUI” shows which files ComfyUI can see.',
    ],
    points: ['Files go in ComfyUI/models: diffusion_models, text_encoders, vae, checkpoints.', 'Only download the files for the models you use.', 'Settings → Models checks which files your ComfyUI can see.'],
    figure: 'files',
    tryIt: { label: 'Check your files', settings: 'models' },
    quiz: [
      { q: 'Where does a VAE file go?', options: ['ComfyUI/models/vae', 'ComfyUI/output', 'Next to Kinemi'], answer: 0, why: 'Each kind of model file has its own folder under ComfyUI/models.' },
      { q: 'Your file is called differently from the example. What do you do?', options: ['Rename it in Settings → Models', 'Give up', 'Download it again'], answer: 0, why: 'Kinemi’s graphs use whatever name you set there.' },
    ],
  },
];

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);

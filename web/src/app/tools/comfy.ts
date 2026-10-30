// The ComfyUI graph behind a tool: the nodes a render queues, built from the same settings as the form.
// The graph tab draws it as nodes and wires; the API tab is the JSON Kinemi posts to ComfyUI's /prompt.
// Core ComfyUI nodes only, unless a node names the `pack` it comes from.
// Model file names follow the ComfyUI example workflows; Settings → Models swaps in the files on your machine,
// and the frame rate, negative prompts and file names follow Settings → Rendering.
import { modelById } from '../data/models';
import type { ToolId } from '../data/tools';
import { NEG_IMAGE, NEG_VIDEO, settings } from '../prefs';
import type { Asset } from '../store';
import { secs, sourceOf, type Built, type Ctx, type Shot, type Values } from './recipes';

export type Sock = 'MODEL' | 'CLIP' | 'VAE' | 'CONDITIONING' | 'LATENT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FLOAT' | 'UPSCALE_MODEL' | 'SAMPLER' | 'SIGMAS' | 'CLIP_VISION_OUTPUT';
export type Widget = string | number | boolean;

export interface GNode {
  id: string;
  /** the ComfyUI class_type */
  type: string;
  title: string;
  inputs: Array<{ name: string; type: Sock; from: [string, number] }>;
  outputs: Array<{ name: string; type: Sock }>;
  widgets: Array<[string, Widget]>;
  /** a custom node pack, when the node is not in core ComfyUI */
  pack?: string;
}

export interface Graph {
  label: string;
  nodes: GNode[];
}

/** ComfyUI's own names for the core nodes. */
const TITLES: Record<string, string> = {
  UNETLoader: 'Load Diffusion Model',
  CLIPLoader: 'Load CLIP',
  VAELoader: 'Load VAE',
  CheckpointLoaderSimple: 'Load Checkpoint',
  LoadImage: 'Load Image',
  LoadVideo: 'Load Video',
  GetVideoComponents: 'Get Video Components',
  VAEDecode: 'VAE Decode',
  VAEDecodeTiled: 'VAE Decode (Tiled)',
  VAEEncode: 'VAE Encode',
  CreateVideo: 'Create Video',
  SaveVideo: 'Save Video',
  SaveImage: 'Save Image',
  UpscaleModelLoader: 'Load Upscale Model',
  ImageUpscaleWithModel: 'Upscale Image (using Model)',
  ImageScale: 'Upscale Image',
  ImageScaleToTotalPixels: 'Scale Image to Total Pixels',
};

type Link = [GNode, number];
interface NodeSpec {
  title?: string;
  inputs?: Array<[string, Link | undefined]>;
  outputs?: Array<[string, Sock]>;
  widgets?: Array<[string, Widget]>;
  pack?: string;
}

function graph(label: string) {
  const nodes: GNode[] = [];
  const add = (type: string, s: NodeSpec = {}): GNode => {
    const n: GNode = {
      id: String(nodes.length + 1),
      type,
      title: s.title ?? TITLES[type] ?? type,
      inputs: (s.inputs ?? [])
        .filter((x): x is [string, Link] => !!x[1])
        .map(([name, [src, i]]) => ({
          name,
          type: src.outputs[i].type,
          from: [src.id, i],
        })),
      outputs: (s.outputs ?? []).map(([name, type]) => ({ name, type })),
      widgets: s.widgets ?? [],
      pack: s.pack,
    };
    nodes.push(n);
    return n;
  };
  return { add, done: (): Graph => ({ label, nodes }) };
}

/** The API format: what ComfyUI's /prompt endpoint takes, and what "Export (API)" saves. */
export function apiPrompt(g: Graph) {
  const out: Record<
    string,
    {
      class_type: string;
      inputs: Record<string, unknown>;
      _meta: { title: string };
    }
  > = {};
  for (const n of g.nodes) {
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of n.widgets) inputs[k] = v;
    for (const i of n.inputs) inputs[i.name] = [i.from[0], i.from[1]];
    out[n.id] = { class_type: n.type, inputs, _meta: { title: n.title } };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Numbers ComfyUI wants                                               */
/* ------------------------------------------------------------------ */

/** The frame rate from Settings → Rendering. */
const fpsNow = () => settings.value.fps || 24;
/** Frames for a duration: 8n + 1, which Wan, LTX and Hunyuan all accept. */
export const frames = (s: number) => Math.round((s * fpsNow()) / 8) * 8 + 1;

/** A model file by its name in the example workflows, renamed in Settings → Models if you did. */
const f = (name: string) => settings.value.files[name]?.trim() || name;

const negVideo = () => settings.value.negVideo.trim() || NEG_VIDEO;
const negImage = () => settings.value.negImage.trim() || NEG_IMAGE;

/** Where ComfyUI saves a render, from the pattern in Settings → Rendering: {tool}, {name}, {date}. */
export function prefixFor(tool: ToolId, name: string, pattern = settings.value.prefix) {
  const slug = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'render';
  const date = new Date().toISOString().slice(0, 10);
  const out = (pattern.trim() || 'kinemi/{tool}')
    .replaceAll('{tool}', tool)
    .replaceAll('{name}', slug(name))
    .replaceAll('{date}', date)
    .replace(/\\/g, '/')
    .replace(/\.\.+/g, '.')
    .replace(/^\/+|\/+$/g, '');
  return out || 'kinemi';
}

/** Width and height for an aspect at a pixel budget, snapped to multiples of 32. */
export function dims(aspect: string, area: number) {
  const [w, h] = aspect.split(':').map(Number);
  const r = (w || 16) / (h || 9);
  const snap = (x: number) => Math.max(256, Math.floor(x / 32) * 32);
  return {
    width: snap(Math.sqrt(area * r)),
    height: snap(Math.sqrt(area / r)),
  };
}
const AREA: Record<string, number> = {
  '720p': 1280 * 720,
  '1080p': 1920 * 1080,
};
const IMAGE_AREA = 1024 * 1024;


const file = (a: Asset | undefined, ext: string) => (a ? `kinemi_${a.id}.${ext}` : `source.${ext}`);

/* ------------------------------------------------------------------ */
/* Video: text or image to video                                       */
/* ------------------------------------------------------------------ */

interface VideoOpts {
  model: string;
  prompt: string;
  seed: number;
  aspect: string;
  res?: string;
  duration: number;
  /** an image to start from, for image-to-video models */
  start?: Asset;
  prefix: string;
}

function save(g: ReturnType<typeof graph>, images: Link, prefix: string, fps: Widget = fpsNow(), audio?: Link) {
  const video = g.add('CreateVideo', {
    inputs: [
      ['images', images],
      ['audio', audio],
    ],
    outputs: [['VIDEO', 'VIDEO']],
    widgets: [['fps', fps]],
  });
  g.add('SaveVideo', {
    inputs: [['video', [video, 0]]],
    widgets: [
      ['filename_prefix', prefix],
      ['format', 'auto'],
      ['codec', 'auto'],
    ],
  });
}

function videoGraph(o: VideoOpts): Graph {
  const m = modelById(o.model);
  const { width, height } = dims(o.aspect, AREA[o.res ?? '720p'] ?? AREA['720p']);
  const length = frames(o.duration);
  const i2v = /i2v/.test(o.model);
  const g = graph(`${m.name} · ${i2v ? 'image' : 'text'} to video`);

  if (o.model.startsWith('ltx')) {
    const ckpt = g.add('CheckpointLoaderSimple', {
      outputs: [
        ['MODEL', 'MODEL'],
        ['CLIP', 'CLIP'],
        ['VAE', 'VAE'],
      ],
      widgets: [['ckpt_name', f('ltx-video-2b-v0.9.5.safetensors')]],
    });
    const clip = g.add('CLIPLoader', {
      outputs: [['CLIP', 'CLIP']],
      widgets: [
        ['clip_name', f('t5xxl_fp16.safetensors')],
        ['type', 'ltxv'],
        ['device', 'default'],
      ],
    });
    const pos = g.add('CLIPTextEncode', {
      title: 'Positive prompt',
      inputs: [['clip', [clip, 0]]],
      outputs: [['CONDITIONING', 'CONDITIONING']],
      widgets: [['text', o.prompt]],
    });
    const neg = g.add('CLIPTextEncode', {
      title: 'Negative prompt',
      inputs: [['clip', [clip, 0]]],
      outputs: [['CONDITIONING', 'CONDITIONING']],
      widgets: [['text', negVideo()]],
    });
    const latent = g.add('EmptyLTXVLatentVideo', {
      outputs: [['LATENT', 'LATENT']],
      widgets: [
        ['width', width],
        ['height', height],
        ['length', length],
        ['batch_size', 1],
      ],
    });
    const cond = g.add('LTXVConditioning', {
      inputs: [
        ['positive', [pos, 0]],
        ['negative', [neg, 0]],
      ],
      outputs: [
        ['positive', 'CONDITIONING'],
        ['negative', 'CONDITIONING'],
      ],
      widgets: [['frame_rate', fpsNow()]],
    });
    const sigmas = g.add('LTXVScheduler', {
      inputs: [['latent', [latent, 0]]],
      outputs: [['SIGMAS', 'SIGMAS']],
      widgets: [
        ['steps', 30],
        ['max_shift', 2.05],
        ['base_shift', 0.95],
        ['stretch', true],
        ['terminal', 0.1],
      ],
    });
    const sampler = g.add('KSamplerSelect', {
      outputs: [['SAMPLER', 'SAMPLER']],
      widgets: [['sampler_name', 'euler']],
    });
    const run = g.add('SamplerCustom', {
      inputs: [
        ['model', [ckpt, 0]],
        ['positive', [cond, 0]],
        ['negative', [cond, 1]],
        ['sampler', [sampler, 0]],
        ['sigmas', [sigmas, 0]],
        ['latent_image', [latent, 0]],
      ],
      outputs: [
        ['output', 'LATENT'],
        ['denoised_output', 'LATENT'],
      ],
      widgets: [
        ['add_noise', true],
        ['noise_seed', o.seed],
        ['cfg', 3],
      ],
    });
    const decode = g.add('VAEDecode', {
      inputs: [
        ['samples', [run, 0]],
        ['vae', [ckpt, 2]],
      ],
      outputs: [['IMAGE', 'IMAGE']],
    });
    save(g, [decode, 0], o.prefix);
    return g.done();
  }

  if (o.model.startsWith('hunyuan')) {
    const unet = g.add('UNETLoader', {
      outputs: [['MODEL', 'MODEL']],
      widgets: [
        ['unet_name', i2v ? f('hunyuan_video_v2_replace_image_to_video_720p_bf16.safetensors') : f('hunyuan_video_t2v_720p_bf16.safetensors')],
        ['weight_dtype', 'default'],
      ],
    });
    const clip = g.add('DualCLIPLoader', {
      outputs: [['CLIP', 'CLIP']],
      widgets: [
        ['clip_name1', f('clip_l.safetensors')],
        ['clip_name2', f('llava_llama3_fp8_scaled.safetensors')],
        ['type', 'hunyuan_video'],
        ['device', 'default'],
      ],
    });
    const vae = g.add('VAELoader', {
      outputs: [['VAE', 'VAE']],
      widgets: [['vae_name', f('hunyuan_video_vae_bf16.safetensors')]],
    });
    const shift = g.add('ModelSamplingSD3', {
      inputs: [['model', [unet, 0]]],
      outputs: [['MODEL', 'MODEL']],
      widgets: [['shift', 7]],
    });
    const pos = g.add('CLIPTextEncode', {
      title: 'Positive prompt',
      inputs: [['clip', [clip, 0]]],
      outputs: [['CONDITIONING', 'CONDITIONING']],
      widgets: [['text', o.prompt]],
    });
    const neg = g.add('CLIPTextEncode', {
      title: 'Negative prompt',
      inputs: [['clip', [clip, 0]]],
      outputs: [['CONDITIONING', 'CONDITIONING']],
      widgets: [['text', '']],
    });
    let positive: Link = [pos, 0];
    let latent: Link;
    if (i2v) {
      const img = g.add('LoadImage', {
        outputs: [['IMAGE', 'IMAGE']],
        widgets: [['image', file(o.start, 'png')]],
      });
      const i2vNode = g.add('HunyuanImageToVideo', {
        inputs: [
          ['positive', [pos, 0]],
          ['vae', [vae, 0]],
          ['start_image', [img, 0]],
        ],
        outputs: [
          ['positive', 'CONDITIONING'],
          ['latent', 'LATENT'],
        ],
        widgets: [
          ['width', width],
          ['height', height],
          ['length', length],
          ['batch_size', 1],
          ['guidance_type', 'v2 (replace)'],
        ],
      });
      positive = [i2vNode, 0];
      latent = [i2vNode, 1];
    } else {
      latent = [
        g.add('EmptyHunyuanLatentVideo', {
          outputs: [['LATENT', 'LATENT']],
          widgets: [
            ['width', width],
            ['height', height],
            ['length', length],
            ['batch_size', 1],
          ],
        }),
        0,
      ];
    }
    const guide = g.add('FluxGuidance', {
      inputs: [['conditioning', positive]],
      outputs: [['CONDITIONING', 'CONDITIONING']],
      widgets: [['guidance', 6]],
    });
    const ks = g.add('KSampler', {
      inputs: [
        ['model', [shift, 0]],
        ['positive', [guide, 0]],
        ['negative', [neg, 0]],
        ['latent_image', latent],
      ],
      outputs: [['LATENT', 'LATENT']],
      widgets: [
        ['seed', o.seed],
        ['steps', 30],
        ['cfg', 1],
        ['sampler_name', 'euler'],
        ['scheduler', 'simple'],
        ['denoise', 1],
      ],
    });
    const decode = g.add('VAEDecodeTiled', {
      inputs: [
        ['samples', [ks, 0]],
        ['vae', [vae, 0]],
      ],
      outputs: [['IMAGE', 'IMAGE']],
      widgets: [
        ['tile_size', 256],
        ['overlap', 64],
        ['temporal_size', 64],
        ['temporal_overlap', 8],
      ],
    });
    save(g, [decode, 0], o.prefix);
    return g.done();
  }

  // Wan 2.2: the 5B model does text and image to video in one graph
  const unet = g.add('UNETLoader', {
    outputs: [['MODEL', 'MODEL']],
    widgets: [
      ['unet_name', f('wan2.2_ti2v_5B_fp16.safetensors')],
      ['weight_dtype', 'default'],
    ],
  });
  const clip = g.add('CLIPLoader', {
    outputs: [['CLIP', 'CLIP']],
    widgets: [
      ['clip_name', f('umt5_xxl_fp8_e4m3fn_scaled.safetensors')],
      ['type', 'wan'],
      ['device', 'default'],
    ],
  });
  const vae = g.add('VAELoader', {
    outputs: [['VAE', 'VAE']],
    widgets: [['vae_name', f('wan2.2_vae.safetensors')]],
  });
  const start = i2v
    ? g.add('LoadImage', {
        outputs: [['IMAGE', 'IMAGE']],
        widgets: [['image', file(o.start, 'png')]],
      })
    : undefined;
  const shift = g.add('ModelSamplingSD3', {
    inputs: [['model', [unet, 0]]],
    outputs: [['MODEL', 'MODEL']],
    widgets: [['shift', 8]],
  });
  const pos = g.add('CLIPTextEncode', {
    title: 'Positive prompt',
    inputs: [['clip', [clip, 0]]],
    outputs: [['CONDITIONING', 'CONDITIONING']],
    widgets: [['text', o.prompt]],
  });
  const neg = g.add('CLIPTextEncode', {
    title: 'Negative prompt',
    inputs: [['clip', [clip, 0]]],
    outputs: [['CONDITIONING', 'CONDITIONING']],
    widgets: [['text', negVideo()]],
  });
  const latent = g.add('Wan22ImageToVideoLatent', {
    inputs: [
      ['vae', [vae, 0]],
      ['start_image', start ? [start, 0] : undefined],
    ],
    outputs: [['LATENT', 'LATENT']],
    widgets: [
      ['width', width],
      ['height', height],
      ['length', length],
      ['batch_size', 1],
    ],
  });
  const ks = g.add('KSampler', {
    inputs: [
      ['model', [shift, 0]],
      ['positive', [pos, 0]],
      ['negative', [neg, 0]],
      ['latent_image', [latent, 0]],
    ],
    outputs: [['LATENT', 'LATENT']],
    widgets: [
      ['seed', o.seed],
      ['steps', 30],
      ['cfg', 5],
      ['sampler_name', 'uni_pc'],
      ['scheduler', 'simple'],
      ['denoise', 1],
    ],
  });
  const decode = g.add('VAEDecode', {
    inputs: [
      ['samples', [ks, 0]],
      ['vae', [vae, 0]],
    ],
    outputs: [['IMAGE', 'IMAGE']],
  });
  save(g, [decode, 0], o.prefix);
  return g.done();
}

/* ------------------------------------------------------------------ */
/* Video edits: Wan VACE, with the source as the control video         */
/* ------------------------------------------------------------------ */

function vaceGraph(o: { prompt: string; seed: number; aspect: string; duration: number; strength: number; source?: Asset; reference?: string; prefix: string }): Graph {
  const g = graph('Wan VACE · video to video');
  const { width, height } = dims(o.aspect, AREA['720p']);
  const unet = g.add('UNETLoader', {
    outputs: [['MODEL', 'MODEL']],
    widgets: [
      ['unet_name', f('wan2.1_vace_14B_fp16.safetensors')],
      ['weight_dtype', 'fp8_e4m3fn'],
    ],
  });
  const clip = g.add('CLIPLoader', {
    outputs: [['CLIP', 'CLIP']],
    widgets: [
      ['clip_name', f('umt5_xxl_fp8_e4m3fn_scaled.safetensors')],
      ['type', 'wan'],
      ['device', 'default'],
    ],
  });
  const vae = g.add('VAELoader', {
    outputs: [['VAE', 'VAE']],
    widgets: [['vae_name', f('wan_2.1_vae.safetensors')]],
  });
  const video = g.add('LoadVideo', {
    outputs: [['VIDEO', 'VIDEO']],
    widgets: [['file', file(o.source, 'mp4')]],
  });
  const parts = g.add('GetVideoComponents', {
    inputs: [['video', [video, 0]]],
    outputs: [
      ['images', 'IMAGE'],
      ['audio', 'AUDIO'],
      ['fps', 'FLOAT'],
    ],
  });
  const ref = o.reference
    ? g.add('LoadImage', {
        title: 'Reference face',
        outputs: [['IMAGE', 'IMAGE']],
        widgets: [['image', o.reference]],
      })
    : undefined;
  const pos = g.add('CLIPTextEncode', {
    title: 'Positive prompt',
    inputs: [['clip', [clip, 0]]],
    outputs: [['CONDITIONING', 'CONDITIONING']],
    widgets: [['text', o.prompt]],
  });
  const neg = g.add('CLIPTextEncode', {
    title: 'Negative prompt',
    inputs: [['clip', [clip, 0]]],
    outputs: [['CONDITIONING', 'CONDITIONING']],
    widgets: [['text', negVideo()]],
  });
  const shift = g.add('ModelSamplingSD3', {
    inputs: [['model', [unet, 0]]],
    outputs: [['MODEL', 'MODEL']],
    widgets: [['shift', 8]],
  });
  const vace = g.add('WanVaceToVideo', {
    inputs: [
      ['positive', [pos, 0]],
      ['negative', [neg, 0]],
      ['vae', [vae, 0]],
      ['control_video', [parts, 0]],
      ['reference_image', ref ? [ref, 0] : undefined],
    ],
    outputs: [
      ['positive', 'CONDITIONING'],
      ['negative', 'CONDITIONING'],
      ['latent', 'LATENT'],
    ],
    widgets: [
      ['width', width],
      ['height', height],
      ['length', frames(o.duration)],
      ['batch_size', 1],
      ['strength', Math.round(o.strength) / 100],
    ],
  });
  const ks = g.add('KSampler', {
    inputs: [
      ['model', [shift, 0]],
      ['positive', [vace, 0]],
      ['negative', [vace, 1]],
      ['latent_image', [vace, 2]],
    ],
    outputs: [['LATENT', 'LATENT']],
    widgets: [
      ['seed', o.seed],
      ['steps', 20],
      ['cfg', 6],
      ['sampler_name', 'uni_pc'],
      ['scheduler', 'simple'],
      ['denoise', 1],
    ],
  });
  const decode = g.add('VAEDecode', {
    inputs: [
      ['samples', [ks, 0]],
      ['vae', [vae, 0]],
    ],
    outputs: [['IMAGE', 'IMAGE']],
  });
  save(g, [decode, 0], o.prefix, fpsNow(), [parts, 1]);
  return g.done();
}

/* ------------------------------------------------------------------ */
/* Stills: text to image, and image edits                              */
/* ------------------------------------------------------------------ */

function stillGraph(o: { model: string; prompt: string; seed: number; aspect: string; batch?: number; prefix: string }): Graph {
  const m = modelById(o.model);
  const g = graph(`${m.name} · text to image`);
  const { width, height } = dims(o.aspect, IMAGE_AREA);
  const qwen = o.model.startsWith('qwen');
  const unet = g.add('UNETLoader', {
    outputs: [['MODEL', 'MODEL']],
    widgets: [
      ['unet_name', qwen ? f('qwen_image_fp8_e4m3fn.safetensors') : f('flux1-dev.safetensors')],
      ['weight_dtype', 'default'],
    ],
  });
  const clip = qwen
    ? g.add('CLIPLoader', {
        outputs: [['CLIP', 'CLIP']],
        widgets: [
          ['clip_name', f('qwen_2.5_vl_7b_fp8_scaled.safetensors')],
          ['type', 'qwen_image'],
          ['device', 'default'],
        ],
      })
    : g.add('DualCLIPLoader', {
        outputs: [['CLIP', 'CLIP']],
        widgets: [
          ['clip_name1', f('clip_l.safetensors')],
          ['clip_name2', f('t5xxl_fp16.safetensors')],
          ['type', 'flux'],
          ['device', 'default'],
        ],
      });
  const vae = g.add('VAELoader', {
    outputs: [['VAE', 'VAE']],
    widgets: [['vae_name', qwen ? f('qwen_image_vae.safetensors') : f('ae.safetensors')]],
  });
  const pos = g.add('CLIPTextEncode', {
    title: 'Positive prompt',
    inputs: [['clip', [clip, 0]]],
    outputs: [['CONDITIONING', 'CONDITIONING']],
    widgets: [['text', o.prompt]],
  });
  const latent = g.add('EmptySD3LatentImage', {
    outputs: [['LATENT', 'LATENT']],
    widgets: [
      ['width', width],
      ['height', height],
      ['batch_size', o.batch ?? 1],
    ],
  });
  let model: Link = [unet, 0];
  let positive: Link = [pos, 0];
  let negative: Link;
  if (qwen) {
    model = [
      g.add('ModelSamplingAuraFlow', {
        inputs: [['model', [unet, 0]]],
        outputs: [['MODEL', 'MODEL']],
        widgets: [['shift', 3.1]],
      }),
      0,
    ];
    negative = [
      g.add('CLIPTextEncode', {
        title: 'Negative prompt',
        inputs: [['clip', [clip, 0]]],
        outputs: [['CONDITIONING', 'CONDITIONING']],
        widgets: [['text', negImage()]],
      }),
      0,
    ];
  } else {
    positive = [
      g.add('FluxGuidance', {
        inputs: [['conditioning', [pos, 0]]],
        outputs: [['CONDITIONING', 'CONDITIONING']],
        widgets: [['guidance', 3.5]],
      }),
      0,
    ];
    negative = [
      g.add('ConditioningZeroOut', {
        inputs: [['conditioning', [pos, 0]]],
        outputs: [['CONDITIONING', 'CONDITIONING']],
      }),
      0,
    ];
  }
  const ks = g.add('KSampler', {
    inputs: [
      ['model', model],
      ['positive', positive],
      ['negative', negative],
      ['latent_image', [latent, 0]],
    ],
    outputs: [['LATENT', 'LATENT']],
    widgets: [
      ['seed', o.seed],
      ['steps', 20],
      ['cfg', qwen ? 2.5 : 1],
      ['sampler_name', 'euler'],
      ['scheduler', 'simple'],
      ['denoise', 1],
    ],
  });
  const decode = g.add('VAEDecode', {
    inputs: [
      ['samples', [ks, 0]],
      ['vae', [vae, 0]],
    ],
    outputs: [['IMAGE', 'IMAGE']],
  });
  g.add('SaveImage', {
    inputs: [['images', [decode, 0]]],
    widgets: [['filename_prefix', o.prefix]],
  });
  return g.done();
}

function editGraph(o: { model: string; prompt: string; seed: number; source?: Asset; prefix: string }): Graph {
  const m = modelById(o.model);
  const g = graph(`${m.name} · image edit`);
  const qwen = o.model.startsWith('qwen');
  const unet = g.add('UNETLoader', {
    outputs: [['MODEL', 'MODEL']],
    widgets: [
      ['unet_name', qwen ? f('qwen_image_edit_fp8_e4m3fn.safetensors') : f('flux1-dev-kontext_fp8_scaled.safetensors')],
      ['weight_dtype', 'default'],
    ],
  });
  const clip = qwen
    ? g.add('CLIPLoader', {
        outputs: [['CLIP', 'CLIP']],
        widgets: [
          ['clip_name', f('qwen_2.5_vl_7b_fp8_scaled.safetensors')],
          ['type', 'qwen_image'],
          ['device', 'default'],
        ],
      })
    : g.add('DualCLIPLoader', {
        outputs: [['CLIP', 'CLIP']],
        widgets: [
          ['clip_name1', f('clip_l.safetensors')],
          ['clip_name2', f('t5xxl_fp8_e4m3fn_scaled.safetensors')],
          ['type', 'flux'],
          ['device', 'default'],
        ],
      });
  const vae = g.add('VAELoader', {
    outputs: [['VAE', 'VAE']],
    widgets: [['vae_name', qwen ? f('qwen_image_vae.safetensors') : f('ae.safetensors')]],
  });
  const img = g.add('LoadImage', {
    outputs: [['IMAGE', 'IMAGE']],
    widgets: [['image', file(o.source, 'png')]],
  });
  const scaled = qwen
    ? g.add('ImageScaleToTotalPixels', {
        inputs: [['image', [img, 0]]],
        outputs: [['IMAGE', 'IMAGE']],
        widgets: [
          ['upscale_method', 'lanczos'],
          ['megapixels', 1],
        ],
      })
    : g.add('FluxKontextImageScale', {
        inputs: [['image', [img, 0]]],
        outputs: [['IMAGE', 'IMAGE']],
      });
  const latent = g.add('VAEEncode', {
    inputs: [
      ['pixels', [scaled, 0]],
      ['vae', [vae, 0]],
    ],
    outputs: [['LATENT', 'LATENT']],
  });
  let model: Link = [unet, 0];
  let positive: Link;
  let negative: Link;
  if (qwen) {
    model = [
      g.add('ModelSamplingAuraFlow', {
        inputs: [['model', [unet, 0]]],
        outputs: [['MODEL', 'MODEL']],
        widgets: [['shift', 3]],
      }),
      0,
    ];
    const enc = (title: string, text: string) =>
      g.add('TextEncodeQwenImageEdit', {
        title,
        inputs: [
          ['clip', [clip, 0]],
          ['vae', [vae, 0]],
          ['image', [scaled, 0]],
        ],
        outputs: [['CONDITIONING', 'CONDITIONING']],
        widgets: [['prompt', text]],
      });
    positive = [enc('Edit instruction', o.prompt), 0];
    negative = [enc('Negative prompt', ''), 0];
  } else {
    const pos = g.add('CLIPTextEncode', {
      title: 'Edit instruction',
      inputs: [['clip', [clip, 0]]],
      outputs: [['CONDITIONING', 'CONDITIONING']],
      widgets: [['text', o.prompt]],
    });
    const refd = g.add('ReferenceLatent', {
      inputs: [
        ['conditioning', [pos, 0]],
        ['latent', [latent, 0]],
      ],
      outputs: [['CONDITIONING', 'CONDITIONING']],
    });
    positive = [
      g.add('FluxGuidance', {
        inputs: [['conditioning', [refd, 0]]],
        outputs: [['CONDITIONING', 'CONDITIONING']],
        widgets: [['guidance', 2.5]],
      }),
      0,
    ];
    negative = [
      g.add('ConditioningZeroOut', {
        inputs: [['conditioning', [pos, 0]]],
        outputs: [['CONDITIONING', 'CONDITIONING']],
      }),
      0,
    ];
  }
  const ks = g.add('KSampler', {
    inputs: [
      ['model', model],
      ['positive', positive],
      ['negative', negative],
      ['latent_image', [latent, 0]],
    ],
    outputs: [['LATENT', 'LATENT']],
    widgets: [
      ['seed', o.seed],
      ['steps', 20],
      ['cfg', qwen ? 2.5 : 1],
      ['sampler_name', 'euler'],
      ['scheduler', 'simple'],
      ['denoise', 1],
    ],
  });
  const decode = g.add('VAEDecode', {
    inputs: [
      ['samples', [ks, 0]],
      ['vae', [vae, 0]],
    ],
    outputs: [['IMAGE', 'IMAGE']],
  });
  g.add('SaveImage', {
    inputs: [['images', [decode, 0]]],
    widgets: [['filename_prefix', o.prefix]],
  });
  return g.done();
}

/* ------------------------------------------------------------------ */
/* Upscale                                                             */
/* ------------------------------------------------------------------ */

function upscaleGraph(o: { source?: Asset; target: string; fps: string; prefix: string }): Graph {
  const g = graph('Upscale · model + interpolation');
  const still = o.source?.kind === 'still';
  const src = still
    ? g.add('LoadImage', {
        outputs: [['IMAGE', 'IMAGE']],
        widgets: [['image', file(o.source, 'png')]],
      })
    : g.add('LoadVideo', {
        outputs: [['VIDEO', 'VIDEO']],
        widgets: [['file', file(o.source, 'mp4')]],
      });
  const parts = still
    ? undefined
    : g.add('GetVideoComponents', {
        inputs: [['video', [src, 0]]],
        outputs: [
          ['images', 'IMAGE'],
          ['audio', 'AUDIO'],
          ['fps', 'FLOAT'],
        ],
      });
  const loader = g.add('UpscaleModelLoader', {
    outputs: [['UPSCALE_MODEL', 'UPSCALE_MODEL']],
    widgets: [['model_name', f('4x-UltraSharp.pth')]],
  });
  const up = g.add('ImageUpscaleWithModel', {
    inputs: [
      ['upscale_model', [loader, 0]],
      ['image', parts ? [parts, 0] : [src, 0]],
    ],
    outputs: [['IMAGE', 'IMAGE']],
  });
  const [w, h] = (o.source?.aspect ?? '16:9').split(':').map(Number);
  const long = o.target === '4K' ? 3840 : 2560;
  const portrait = (h || 9) > (w || 16);
  const size = portrait
    ? {
        width: Math.round((long * (w || 9)) / (h || 16) / 32) * 32,
        height: long,
      }
    : {
        width: long,
        height: Math.round((long * (h || 9)) / (w || 16) / 32) * 32,
      };
  const fit = g.add('ImageScale', {
    inputs: [['image', [up, 0]]],
    outputs: [['IMAGE', 'IMAGE']],
    widgets: [
      ['upscale_method', 'lanczos'],
      ['width', size.width],
      ['height', size.height],
      ['crop', 'disabled'],
    ],
  });
  if (still) {
    g.add('SaveImage', {
      inputs: [['images', [fit, 0]]],
      widgets: [['filename_prefix', o.prefix]],
    });
    return g.done();
  }
  let frames: Link = [fit, 0];
  let fps: number = fpsNow();
  if (o.fps !== 'Off') {
    const mult = o.fps.startsWith('60') ? 2.5 : 2;
    fps = o.fps.startsWith('60') ? 60 : 48;
    frames = [
      g.add('RIFE VFI', {
        pack: 'ComfyUI-Frame-Interpolation',
        inputs: [['frames', [fit, 0]]],
        outputs: [['IMAGE', 'IMAGE']],
        widgets: [
          ['ckpt_name', f('rife47.pth')],
          ['clear_cache_after_n_frames', 10],
          ['multiplier', Math.ceil(mult)],
          ['fast_mode', true],
          ['ensemble', true],
          ['scale_factor', 1],
        ],
      }),
      0,
    ];
  }
  save(g, frames, o.prefix, fps, parts ? [parts, 1] : undefined);
  return g.done();
}

/* ------------------------------------------------------------------ */
/* Per tool                                                            */
/* ------------------------------------------------------------------ */

/** The graphs a tool queues for these settings: one per shot for a storyboard, one otherwise. */
export function graphsFor(tool: ToolId, v: Values, built: Built | null, ctx: Ctx): Array<{ label: string; graph: Graph }> {
  if (!built) return [];
  const spec = built.spec;
  const prefix = prefixFor(tool, spec.name);
  const one = (graph: Graph) => [{ label: graph.label, graph }];
  switch (tool) {
    case 'cinematic':
    case 'marketing':
      return one(
        videoGraph({
          model: String(v.model),
          prompt: built.prompt,
          seed: spec.seed,
          aspect: spec.aspect,
          res: v.res,
          duration: secs(v.duration),
          prefix,
        }),
      );
    case 'storyboard':
      return (v.shots as Shot[])
        .filter((s) => s.prompt.trim())
        .slice(0, 8)
        .map((s, i) => ({
          label: `Shot ${i + 1}`,
          graph: videoGraph({
            model: s.model,
            prompt: `${s.prompt}. ${v.look} look.`,
            seed: spec.seed + i,
            aspect: String(v.aspect),
            duration: secs(s.duration),
            prefix: `${prefix}/shot-${i + 1}`,
          }),
        }));
    case 'genjutsu': {
      const who = ctx.cast.find((c) => c.id === v.target);
      const src = sourceOf(ctx, v.source, ['video']);
      return one(
        vaceGraph({
          prompt: built.prompt,
          seed: spec.seed,
          aspect: spec.aspect,
          duration: spec.duration ?? 5,
          strength: Number(v.intensity),
          source: src,
          reference: who ? `kinemi_cast_${who.tag}.png` : 'face.png',
          prefix,
        }),
      );
    }
    case 'edit': {
      const src = sourceOf(ctx, v.source, ['video']);
      return one(
        vaceGraph({
          prompt: built.prompt,
          seed: spec.seed,
          aspect: spec.aspect,
          duration: spec.duration ?? src?.duration ?? 5,
          strength: Number(v.strength),
          source: src,
          prefix,
        }),
      );
    }
    case 'reshoot':
      return one(
        editGraph({
          model: String(v.model),
          prompt: built.prompt,
          seed: spec.seed,
          source: sourceOf(ctx, v.source, ['still', 'video']),
          prefix,
        }),
      );
    case 'fashion':
      return one(
        modelById(String(v.model)).kind === 'edit'
          ? editGraph({
              model: String(v.model),
              prompt: built.prompt,
              seed: spec.seed,
              prefix,
            })
          : stillGraph({
              model: String(v.model),
              prompt: built.prompt,
              seed: spec.seed,
              aspect: spec.aspect,
              batch: Number(v.looks) || 1,
              prefix,
            }),
      );
    case 'soul':
    case 'cast':
      return one(
        stillGraph({
          model: String(v.model ?? 'flux-dev'),
          prompt: built.prompt,
          seed: spec.seed,
          aspect: tool === 'cast' ? '3:2' : spec.aspect,
          prefix,
        }),
      );
    case 'upscale':
      return one(
        upscaleGraph({
          source: sourceOf(ctx, v.source, ['video', 'still']),
          target: String(v.target),
          fps: String(v.fps),
          prefix,
        }),
      );
    default:
      return [];
  }
}

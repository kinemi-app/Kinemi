// The server's ComfyUI graph (API format, what /prompt takes) as the node layout the graph tab draws.
// The API format names no socket types, so a wire's type comes from the input that reads it.
import type { ApiNode } from '../backend';
import type { GNode, Graph, Sock, Widget } from './comfy';

type Link = [string, number];

const BY_NAME: Record<string, Sock> = {
  model: 'MODEL',
  clip: 'CLIP',
  vae: 'VAE',
  positive: 'CONDITIONING',
  negative: 'CONDITIONING',
  conditioning: 'CONDITIONING',
  upscale_model: 'UPSCALE_MODEL',
  sampler: 'SAMPLER',
  sigmas: 'SIGMAS',
  // Wan VACE reads its control clip as frames
  control_video: 'IMAGE',
};

const BY_PATTERN: Array<[RegExp, Sock]> = [
  [/clip_vision/, 'CLIP_VISION_OUTPUT'],
  [/audio|voice/, 'AUDIO'],
  // before images: KSampler reads "latent_image"
  [/latent|samples/, 'LATENT'],
  [/image|frame|pixel|mask/, 'IMAGE'],
  [/video/, 'VIDEO'],
];

/** Numbers, strings and anything unnamed draw as a grey wire. */
const UNKNOWN: Sock = 'FLOAT';

const sockFor = (input: string): Sock => BY_NAME[input] ?? BY_PATTERN.find(([pattern]) => pattern.test(input))?.[1] ?? UNKNOWN;

const isLink = (value: unknown): value is Link => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';

const isWidget = (value: unknown): value is Widget => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** The view's Graph for an API-format graph; nodes in id order, each output typed by its first reader. */
export function fromApi(nodes: Record<string, ApiNode>, label: string): Graph {
  const ids = Object.keys(nodes).sort((a, b) => Number(a) - Number(b));
  const outputs = new Map<string, Sock[]>();
  for (const id of ids) {
    for (const [input, value] of Object.entries(nodes[id].inputs)) {
      if (!isLink(value)) continue;
      const slots = outputs.get(value[0]) ?? [];
      slots[value[1]] ??= sockFor(input);
      outputs.set(value[0], slots);
    }
  }
  return { label, nodes: ids.map((id) => toNode(id, nodes[id], outputs)) };
}

function toNode(id: string, node: ApiNode, outputs: Map<string, Sock[]>): GNode {
  const entries = Object.entries(node.inputs);
  return {
    id,
    type: node.class_type,
    title: node._meta?.title ?? node.class_type,
    inputs: entries
      .filter((entry): entry is [string, Link] => isLink(entry[1]))
      .map(([name, from]) => ({ name, type: outputs.get(from[0])?.[from[1]] ?? sockFor(name), from })),
    outputs: Array.from(outputs.get(id) ?? [], (type) => type ?? UNKNOWN).map((type) => ({ name: type, type })),
    widgets: entries.filter((entry): entry is [string, Widget] => isWidget(entry[1])),
  };
}

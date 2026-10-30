import type { GenerateRequest, Job, JobResult } from "../types";
import { createJob, refresh, type Generator } from "./store";
import { speak } from "./tts";

/**
 * Demo mode: no Comfy deployment exists yet, so a render resolves to a deterministic SVG poster
 * built from the prompt. Same prompt, same poster. The real Comfy path lives in comfy.ts.
 */

const WIDTH = 1280;
const HEIGHT = 720;

/** FNV-1a over the prompt, so the poster is stable and spreads across the colour wheel. */
function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

function clip(text: string, length: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}...` : clean;
}

/**
 * Break a caption into at most two lines, so a long prompt stays inside the frame. A caption that
 * would need a third line ends its second with an ellipsis instead, so no text disappears unseen.
 */
function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > perLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) {
    lines.push(line);
  }
  if (lines.length > 2) {
    lines[1] = `${(lines[1] ?? "").slice(0, perLine - 1).trimEnd()}…`;
  }
  return lines.slice(0, 2);
}

export function demoPoster(request: GenerateRequest): JobResult {
  const seed = hash(`${request.mode}|${request.modelId}|${request.prompt}|${request.durationS}`);
  const hue = seed % 360;
  const edgeHue = (hue + 40 + (seed % 90)) % 360;
  const angle = 20 + (seed % 60);
  const glowX = 20 + ((seed >> 3) % 60);
  const glowY = 20 + ((seed >> 7) % 50);
  const title = wrap(clip(request.prompt, 96), 56).map(escapeXml);
  const mode = escapeXml(request.mode);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${title.join(' ')}">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0" stop-color="hsl(${hue} 55% 12%)"/>
      <stop offset="1" stop-color="hsl(${edgeHue} 60% 26%)"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="hsl(${hue} 80% 60%)" stop-opacity="0.55"/>
      <stop offset="1" stop-color="hsl(${hue} 80% 60%)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <circle cx="${(glowX / 100) * WIDTH}" cy="${(glowY / 100) * HEIGHT}" r="360" fill="url(#glow)"/>
  <rect x="40" y="40" width="${WIDTH - 80}" height="${HEIGHT - 80}" fill="none" stroke="hsl(${hue} 30% 70%)" stroke-opacity="0.35"/>
  ${title.map((line, index) => `<text x="64" y="${HEIGHT - 96 - (title.length - 1 - index) * 40}" font-family="system-ui, sans-serif" font-size="34" fill="hsl(${hue} 25% 92%)">${line}</text>`).join("\n  ")}
  <text x="64" y="${HEIGHT - 52}" font-family="system-ui, sans-serif" font-size="22" fill="hsl(${hue} 20% 78%)">${mode} · ${request.durationS}s · ${escapeXml(request.modelId)}</text>
  <text x="${WIDTH - 64}" y="88" text-anchor="end" font-family="system-ui, sans-serif" font-size="24" letter-spacing="6" fill="hsl(${hue} 90% 70%)">DEMO</text>
</svg>`;

  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    kind: "image",
    width: WIDTH,
    height: HEIGHT,
  };
}

const AUDIO_RATE = 16000;
/** Matches the longest audio model in data/models.json, so a demo never synthesizes more. */
const MAX_AUDIO_SECONDS = 30;

/**
 * Demo audio: a synthesised cadence as long as the request asks for, so an audio job really plays
 * in the browser. It is a tone shaped like speech, not a voice, and the page labels it as a demo.
 */
export function demoAudio(request: GenerateRequest): JobResult {
  // A configured local voice wins over the tone; a broken or silent command keeps the tone.
  const spoken = speak(request.prompt);
  if (spoken !== undefined) {
    return { url: spoken, kind: "audio", width: 0, height: 0, demoVoice: "command" };
  }

  const seed = hash(`${request.mode}|${request.prompt}|${request.modelId}`);
  const seconds = Math.min(request.durationS, MAX_AUDIO_SECONDS);
  const total = Math.max(1, Math.floor(AUDIO_RATE * seconds));
  const pitch = 118 + (seed % 96);
  const syllables = 6 + (seed % 4);
  const buffer = Buffer.alloc(44 + total * 2);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + total * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(AUDIO_RATE, 24);
  buffer.writeUInt32LE(AUDIO_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(total * 2, 40);

  for (let index = 0; index < total; index += 1) {
    const t = index / AUDIO_RATE;
    const phase = (t * syllables) / seconds;
    const local = phase - Math.floor(phase);
    const envelope = Math.sin(Math.PI * local) ** 0.7;
    const note = pitch + (Math.floor(phase) % 3) * 16;
    const value =
      Math.sin(2 * Math.PI * note * t) * 0.6 +
      Math.sin(2 * Math.PI * note * 2 * t) * 0.24 +
      Math.sin(2 * Math.PI * note * 3 * t) * 0.12;
    buffer.writeInt16LE(Math.round(value * envelope * 9000), 44 + index * 2);
  }

  return {
    url: `data:audio/wav;base64,${buffer.toString("base64")}`,
    kind: "audio",
    width: 0,
    height: 0,
    demoVoice: "tone",
  };
}

/** Instant submit: the result is already known, progress still plays out so the UI is honest. */
export const demoGenerator: Generator = {
  submit(request: GenerateRequest): Promise<Job> {
    const job = createJob(request, true);
    job.result = request.mode === "audio" ? demoAudio(request) : demoPoster(request);
    return Promise.resolve(job);
  },

  poll(job: Job): Promise<Job> {
    return Promise.resolve(refresh(job));
  },
};

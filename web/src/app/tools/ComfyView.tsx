// The Comfy graph behind a tool, live: nodes and wires laid out like ComfyUI, or the API JSON.
// A setting you change lights up the nodes and fields it touched, and the view pans to them.
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getGraph, getRegistry } from '../backend';
import { requestFor } from '../data/backend-request';
import { copyText, cx, reducedMotion } from '../lib/util';
import { assets, type RenderSpec } from '../store';
import { PxIcon } from '../ui/icons';
import { toast } from '../ui/toast';
import { apiPrompt, type GNode, type Graph, type Sock, type Widget } from './comfy';
import { fromApi } from './graph-adapter';

/** ComfyUI's link colours, so the wires read the same as in Comfy itself. */
const SOCK: Record<Sock, string> = {
  MODEL: '#b39ddb',
  CLIP: '#ffd500',
  VAE: '#ff6e6e',
  CONDITIONING: '#ffa931',
  LATENT: '#ff9cf9',
  IMAGE: '#64b5f6',
  VIDEO: '#2ee6c4',
  AUDIO: '#9de0a8',
  FLOAT: '#aab4be',
  UPSCALE_MODEL: '#b39ddb',
  SAMPLER: '#ecb4b4',
  SIGMAS: '#cdffcd',
  CLIP_VISION_OUTPUT: '#ad7452',
};

const W = 196;
const WIDE = 252;
/** header: the title, then the ComfyUI class name under it */
const HEAD = 40;
const ROW = 20;
const TEXT_ROWS = 3;
const GAP_X = 54;
const GAP_Y = 16;
const PAD = 24;

/** prompts show as a text box, like ComfyUI's multiline widget */
const isText = (k: string, v: Widget) => typeof v === 'string' && (k === 'text' || k === 'prompt');
const widthOf = (n: GNode) => (n.widgets.some(([k, v]) => isText(k, v) || String(v).length > 26) ? WIDE : W);
const ioRows = (n: GNode) => Math.max(n.inputs.length, n.outputs.length);
const heightOf = (n: GNode) => HEAD + ioRows(n) * ROW + n.widgets.reduce((h, [k, v]) => h + (isText(k, v) ? TEXT_ROWS : 1) * ROW, 0) + 10;

interface Placed {
  n: GNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Longest-path layers: every wire runs left to right; sources sit just before their first consumer. */
function layout(g: Graph) {
  const col = new Map<string, number>();
  for (const n of g.nodes) col.set(n.id, n.inputs.length ? Math.max(...n.inputs.map((i) => (col.get(i.from[0]) ?? 0) + 1)) : 0);
  for (const n of g.nodes) {
    if (n.inputs.length) continue;
    const uses = g.nodes.filter((m) => m.inputs.some((i) => i.from[0] === n.id)).map((m) => col.get(m.id)!);
    if (uses.length) col.set(n.id, Math.max(0, Math.min(...uses) - 1));
  }
  const cols = [...new Set(col.values())].sort((a, b) => a - b);
  const placed = new Map<string, Placed>();
  const heights = cols.map((c) => g.nodes.filter((n) => col.get(n.id) === c).reduce((h, n) => h + heightOf(n) + GAP_Y, -GAP_Y));
  const tallest = Math.max(...heights);
  let x = PAD;
  cols.forEach((c, ci) => {
    const list = g.nodes.filter((n) => col.get(n.id) === c);
    const w = Math.max(...list.map(widthOf));
    let y = PAD + (tallest - heights[ci]) / 2;
    for (const n of list) {
      const h = heightOf(n);
      placed.set(n.id, { n, x, y, w, h });
      y += h + GAP_Y;
    }
    x += w + GAP_X;
  });
  return { placed, width: x - GAP_X + PAD, height: tallest + PAD * 2 };
}

const fmt = (v: Widget) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)))) : String(v));

/* ------------------------------------------------------------------ */
/* What changed since the last graph                                   */
/* ------------------------------------------------------------------ */

type Changes = Map<string, Set<string>>;

function useChanges(graph: Graph) {
  const prev = useRef<Map<string, Record<string, string>> | null>(null);
  const timer = useRef(0);
  const [changes, setChanges] = useState<{ map: Changes; n: number }>({
    map: new Map(),
    n: 0,
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const now = new Map(graph.nodes.map((n) => [`${n.id}:${n.type}`, Object.fromEntries(n.widgets.map(([k, v]) => [k, JSON.stringify(v)]))]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const map: Changes = new Map();
    for (const n of graph.nodes) {
      const was = before.get(`${n.id}:${n.type}`);
      const fields = new Set<string>();
      for (const [k, v] of n.widgets) if (!was || was[k] !== JSON.stringify(v)) fields.add(k);
      if (!was || fields.size) map.set(n.id, fields);
    }
    if (!map.size) return;
    setChanges((c) => ({ map, n: c.n + 1 }));
    // the parent re-renders often (render progress, toasts): the fade-out timer must outlive those
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChanges((c) => ({ map: new Map(), n: c.n })), 2200);
  }, [graph]);
  return changes;
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

function NodeCard({ p, fields, flash }: { p: Placed; fields?: Set<string>; flash: number }) {
  const { n } = p;
  const role = /Save/.test(n.type)
    ? 'out'
    : n.title === 'Positive prompt' || n.title === 'Edit instruction'
      ? 'pos'
      : n.title === 'Negative prompt'
        ? 'neg'
        : /Sampler/.test(n.type)
          ? 'run'
          : /Load/.test(n.type)
            ? 'load'
            : '';
  return (
    <div
      class={cx('cn', role && `cn-${role}`, n.pack && 'is-pack', fields && 'is-changed')}
      style={{
        left: `${p.x}px`,
        top: `${p.y}px`,
        width: `${p.w}px`,
        height: `${p.h}px`,
      }}
    >
      {fields && <i key={flash} class="cn-flash" aria-hidden="true" />}
      <header class="cn-head">
        <span class="cn-title">{n.title}</span>
        <span class="cn-id mono">#{n.id}</span>
        <span class="cn-type mono">
          {n.type}
          {n.pack && ` · ${n.pack}`}
        </span>
      </header>
      <div class="cn-io">
        {Array.from({ length: ioRows(n) }, (_, i) => (
          <div key={i} class="cn-row">
            <span class="cn-in">
              {n.inputs[i] && (
                <>
                  <i class="cn-dot" style={{ background: SOCK[n.inputs[i].type] }} />
                  {n.inputs[i].name}
                </>
              )}
            </span>
            <span class="cn-out">
              {n.outputs[i] && (
                <>
                  {n.outputs[i].name}
                  <i class="cn-dot" style={{ background: SOCK[n.outputs[i].type] }} />
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      {n.widgets.map(([k, v]) => (
        <div key={k} class={cx('cn-w', isText(k, v) && 'is-text', fields?.has(k) && 'is-changed')}>
          {isText(k, v) ? (
            <span class="cn-text">{String(v)}</span>
          ) : (
            <>
              <span class="cn-k">{k}</span>
              <b class="cn-v mono">{fmt(v)}</b>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function GraphCanvas({ graph, changes }: { graph: Graph; changes: { map: Changes; n: number } }) {
  const { placed, width, height } = useMemo(() => layout(graph), [graph]);
  const view = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  // start close to fitting, but never so small that the fields stop being readable
  useLayoutEffect(() => {
    const el = view.current;
    if (el) setScale(Math.max(0.72, Math.min(1, (el.clientWidth - 8) / width)));
  }, [graph.label]);

  // pan to the first node a change touched
  useEffect(() => {
    const el = view.current;
    const id = [...changes.map.keys()][0];
    const p = id ? placed.get(id) : undefined;
    if (!el || !p) return;
    const x = p.x * scale;
    const y = p.y * scale;
    const inView = x >= el.scrollLeft && x + p.w * scale <= el.scrollLeft + el.clientWidth && y >= el.scrollTop && y + p.h * scale <= el.scrollTop + el.clientHeight;
    if (!inView)
      el.scrollTo({
        left: x - 40,
        top: y - 40,
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
  }, [changes.n]);

  const wires = graph.nodes.flatMap((n) =>
    n.inputs.map((inp, i) => {
      const a = placed.get(inp.from[0]);
      const b = placed.get(n.id);
      if (!a || !b) return null;
      const x1 = a.x + a.w;
      const y1 = a.y + HEAD + inp.from[1] * ROW + ROW / 2;
      const x2 = b.x;
      const y2 = b.y + HEAD + i * ROW + ROW / 2;
      const dx = Math.max(36, (x2 - x1) / 2);
      const hot = changes.map.has(inp.from[0]);
      return <path key={`${n.id}-${i}`} class={cx('cw-path', hot && 'is-hot')} d={`M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`} stroke={SOCK[inp.type]} />;
    }),
  );

  return (
    <div class="cg">
      <div
        ref={view}
        class="cg-view"
        tabIndex={0}
        aria-label={`${graph.label}: ${graph.nodes.length} nodes. Drag to pan.`}
        onPointerDown={(e) => {
          // touch scrolls natively; the mouse drags to pan
          if (e.button !== 0 || e.pointerType !== 'mouse') return;
          const el = view.current!;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            l: el.scrollLeft,
            t: el.scrollTop,
          };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          view.current!.scrollLeft = d.l - (e.clientX - d.x);
          view.current!.scrollTop = d.t - (e.clientY - d.y);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div class="cg-size" style={{ width: `${width * scale}px`, height: `${height * scale}px` }}>
          <div
            class="cg-canvas"
            style={{
              width: `${width}px`,
              height: `${height}px`,
              transform: `scale(${scale})`,
            }}
          >
            <svg class="cw" width={width} height={height} aria-hidden="true">
              {wires}
            </svg>
            {[...placed.values()].map((p) => (
              <NodeCard key={`${p.n.id}:${p.n.type}`} p={p} fields={changes.map.get(p.n.id)} flash={changes.n} />
            ))}
          </div>
        </div>
      </div>
      <div class="cg-zoom">
        <button type="button" class="icon-btn icon-btn-sm" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.4, +(s - 0.15).toFixed(2)))}>
          <PxIcon name="minus" size={11} />
        </button>
        <span class="mono">{Math.round(scale * 100)}%</span>
        <button type="button" class="icon-btn icon-btn-sm" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(1.4, +(s + 0.15).toFixed(2)))}>
          <PxIcon name="plus" size={11} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* API JSON                                                            */
/* ------------------------------------------------------------------ */

const TOKENS = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|\b(true|false|null)\b/g;

function JsonLine({ line }: { line: string }) {
  const parts: Array<JSX.Element | string> = [];
  let last = 0;
  for (const m of line.matchAll(TOKENS)) {
    if (m.index! > last) parts.push(line.slice(last, m.index));
    const cls = m[1] ? (m[2] ? 'cj-k' : 'cj-s') : m[3] ? 'cj-n' : 'cj-b';
    parts.push(
      <span key={m.index} class={cls}>
        {m[1] ?? m[0]}
      </span>,
    );
    if (m[2]) parts.push(m[2]);
    last = m.index! + m[0].length;
  }
  parts.push(line.slice(last));
  return <>{parts}</>;
}

function JsonView({ text, changes }: { text: string; changes: { map: Changes; n: number } }) {
  let node = '';
  const lines = text.split('\n');
  const view = useRef<HTMLPreElement>(null);
  // scroll the JSON itself, never the page around it
  useEffect(() => {
    const pre = view.current;
    const line = pre?.querySelector<HTMLElement>('.is-changed');
    if (!pre || !line) return;
    pre.scrollTo({ top: line.offsetTop - pre.clientHeight / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [changes.n]);
  return (
    <pre ref={view} class="cj mono" tabIndex={0} aria-label="API JSON">
      {lines.map((l, i) => {
        const start = l.match(/^ {2}"(\d+)": \{/);
        if (start) node = start[1];
        else if (/^ {2}\}/.test(l)) node = '';
        const key = l.match(/^ {6}"([^"]+)":/)?.[1];
        const hot = node && key && changes.map.get(node)?.has(key);
        return (
          <span key={i} class={cx('cj-line', hot && 'is-changed')}>
            <JsonLine line={l} />
          </span>
        );
      })}
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export function ComfyPanel({ graphs, view, tool }: { graphs: Array<{ label: string; graph: Graph }>; view: 'graph' | 'json'; tool: string }) {
  const [pick, setPick] = useState(0);
  const i = Math.min(pick, graphs.length - 1);
  const graph = graphs[i].graph;
  const changes = useChanges(graph);
  const text = useMemo(() => JSON.stringify(apiPrompt(graph), null, 2), [graph]);
  const packs = [...new Set(graph.nodes.map((n) => n.pack).filter(Boolean))];
  const name = `kinemi-${tool}${graphs.length > 1 ? `-${i + 1}` : ''}.json`;

  return (
    <div class="comfy">
      <header class="comfy-head">
        {graphs.length > 1 ? (
          <div class="comfy-shots" role="tablist" aria-label="Graph per shot">
            {graphs.map((g, k) => (
              <button key={k} type="button" role="tab" aria-selected={k === i} class={cx('chip', k === i && 'is-on')} onClick={() => setPick(k)}>
                {g.label}
              </button>
            ))}
          </div>
        ) : (
          <span class="comfy-label">{graph.label}</span>
        )}
        <span class="comfy-meta mono">
          {graph.nodes.length} nodes · {packs.length ? `needs ${packs.join(', ')}` : 'core nodes'}
        </span>
        <span class="comfy-actions">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            onClick={() =>
              copyText(text).then(
                () =>
                  toast({
                    title: 'API JSON copied',
                    body: 'Paste it into ComfyUI or post it to /prompt.',
                  }),
                () => {},
              )
            }
          >
            <PxIcon name="copy" size={12} />
            Copy
          </button>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
              const a = Object.assign(document.createElement('a'), {
                href: url,
                download: name,
              });
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <PxIcon name="download" size={12} />
            .json
          </button>
        </span>
      </header>
      {view === 'graph' ? <GraphCanvas graph={graph} changes={changes} /> : <JsonView text={text} changes={changes} />}
      <p class="comfy-foot mono" aria-live="polite">
        {changes.map.size
          ? `changed · ${[...changes.map.entries()]
              .slice(0, 3)
              .map(([id, f]) => `#${id} ${graph.nodes.find((n) => n.id === id)?.title}${f.size ? ` (${[...f].slice(0, 2).join(', ')})` : ''}`)
              .join(' · ')}`
          : 'Change a setting on the left: the nodes it touches light up here.'}
      </p>
    </div>
  );
}

/** Ask the server again only once the settings have been still this long. */
const GRAPH_DELAY_MS = 350;

/** The name a render would upload the spec's source under; the graph only shows it, nothing is sent. */
function previewSource(spec: RenderSpec) {
  const source = assets.value.find((a) => a.id === spec.server?.sourceId);
  if (!source) return undefined;
  const ext = source.file?.type.split('/')[1] ?? (source.kind === 'video' ? 'mp4' : 'png');
  return { name: `${source.id}.${ext}`, kind: source.kind };
}

async function serverGraph(spec: RenderSpec): Promise<Graph> {
  const body = requestFor(spec, await getRegistry(), previewSource(spec));
  if (!body) throw new Error('This tool doesn’t render on the server, so it has no graph.');
  const graph = await getGraph(body);
  return fromApi(graph.nodes, `${body.mode} · ${body.modelId}`);
}

/** The graph a render of these settings sends to ComfyUI, asked from the server as they change. */
export function ServerComfyPanel({ spec, view, tool }: { spec: RenderSpec | undefined; view: 'graph' | 'json'; tool: string }) {
  const [state, setState] = useState<{ graph?: Graph; error?: string }>({});
  const key = spec ? JSON.stringify(spec) : '';

  useEffect(() => {
    if (!spec) {
      setState({ error: 'Fill in the settings to see the graph.' });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      serverGraph(spec).then(
        (graph) => live && setState({ graph }),
        (cause: unknown) => live && setState({ error: cause instanceof Error ? cause.message : 'The server couldn’t build the graph.' }),
      );
    }, GRAPH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  if (state.graph) return <ComfyPanel graphs={[{ label: state.graph.label, graph: state.graph }]} view={view} tool={tool} />;
  return (
    <div class="comfy">
      <p class="comfy-foot mono" role="status">
        {state.error ?? 'Asking the server for the graph…'}
      </p>
    </div>
  );
}

// The tools side: all 16 tools, each one usable on its own.
import { useState } from 'preact/hooks';
import { APP_TOOLS, type AppTool } from '../data/tools';
import { cx } from '../lib/util';
import { toolHref } from '../router';
import { liveAssets } from '../store';
import { Segmented } from '../ui/controls';
import { PxIcon, ToolIcon } from '../ui/icons';
import { Model3D } from '../ui/Model3D';
import { PixelText } from '../ui/PixelText';

function ToolCard({ tool, index }: { tool: AppTool; index: number }) {
  const [hover, setHover] = useState(false);
  const renders = liveAssets.value.filter((a) => a.tool === tool.id).length;
  return (
    <li style={{ '--i': index } as Record<string, number>}>
      <a
        class={cx('tv-card', tool.studio && 'is-studio')}
        href={toolHref(tool.id)}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onPointerMove={(e) => {
          const el = e.currentTarget as HTMLElement;
          const r = el.getBoundingClientRect();
          el.style.setProperty('--sx', `${e.clientX - r.left}px`);
          el.style.setProperty('--sy', `${e.clientY - r.top}px`);
        }}
      >
        <span class="tv-card-top">
          <Model3D model="voxel" opts={{ icon: tool.id, active: hover }} class="tv-voxel">
            <ToolIcon id={tool.id} size={36} />
          </Model3D>
          <span class="tv-index mono">{String(index + 1).padStart(2, '0')}</span>
        </span>
        <span class="tv-name">{tool.name}</span>
        <span class="tv-tag mono">{tool.tag}</span>
        <span class="tv-text">{tool.text}</span>
        <span class="tv-foot">
          <span class="tv-open">
            Open {tool.name}
            <PxIcon name="arrow-right" size={11} />
          </span>
          {renders > 0 && <span class="tv-takes mono">{renders} in assets</span>}
        </span>
      </a>
    </li>
  );
}

export function ToolsView() {
  const [filter, setFilter] = useState<'all' | 'core' | 'studios'>('all');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = APP_TOOLS.filter((t) => (filter === 'all' ? true : filter === 'core' ? !t.studio : !!t.studio)).filter(
    (t) => !needle || `${t.name} ${t.tag} ${t.text}`.toLowerCase().includes(needle),
  );
  return (
    <section class="tools-view">
      <header class="tv-head">
        <div class="tv-intro">
          <PixelText text="16 TOOLS" class="tv-pixel" stops={['#d6fbe6', '#7be7a9', '#2fc56d']} label="16 tools" />
          <h1>Use any tool on its own</h1>
          <p>Build a shot, queue a list, re-shoot a still or cut an ad, with the runtime and credits in front of you before you render. Or skip the menus and ask the chat.</p>
          <div class="tv-filters">
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All 16' },
                { value: 'core', label: 'Core 9' },
                { value: 'studios', label: 'Studios 7' },
              ]}
            />
            <label class="search">
              <PxIcon name="search" size={14} />
              <span class="sr-only">Find a tool</span>
              <input type="search" placeholder="Find a tool" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
            </label>
          </div>
        </div>
        <div class="tv-stage">
          <Model3D model="camera" class="tv-camera" label="A cinema camera, modeled for Kinemi">
            <ToolIcon id="cinematic" size={96} />
          </Model3D>
          <span class="tv-stage-hud mono">
            <i class="rec" aria-hidden="true" />
            A-CAM · 35MM · F/1.8
          </span>
        </div>
      </header>
      {list.length ? (
        <ul class="tv-grid">
          {list.map((t) => (
            <ToolCard key={t.id} tool={t} index={APP_TOOLS.indexOf(t)} />
          ))}
        </ul>
      ) : (
        <p class="empty-note">No tool matches “{q}”. Try “camera”, “voice” or “4K”.</p>
      )}
    </section>
  );
}

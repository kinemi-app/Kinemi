// The chat side: a welcome with the Kinemi orb, then a thread where every reply can run a tool.
import { useEffect, useRef, useState } from 'preact/hooks';
import { folderItems } from '../assets/actions';
import { modelById } from '../data/models';
import { APP_TOOLS, toolById } from '../data/tools';
import { cx, copyText } from '../lib/util';
import { cancelJob } from '../render';
import { clock, liveLine } from '../render-live';
import { go } from '../router';
import { activeChatId, assetById, chatById, jobs, openAssetId, type Chat, type Message, type ToolCall } from '../store';
import { Estimate } from '../ui/controls';
import { LogoMark, PxIcon, ToolIcon } from '../ui/icons';
import { openMenu } from '../ui/layers';
import { Model3D } from '../ui/Model3D';
import { PixelProgress } from '../ui/PixelProgress';
import { Poster } from '../ui/Poster';
import { toast } from '../ui/toast';
import { TitleInput, useHoldDelete } from '../shell/ChatItem';
import { chipAction, doneStreaming, draftText, forcedTool, openInTool, renderMessage, retake, streaming, thinking } from './actions';
import { Composer } from './Composer';
import { EXAMPLES } from './engine';
import { RenderApproval } from './RenderApproval';

const STARTERS = [
  { label: 'Dolly-in shot', tool: 'cinematic', text: EXAMPLES[0] },
  { label: 'New angle', tool: 'reshoot', text: EXAMPLES[1] },
  { label: 'Motion transfer', tool: 'genjutsu', text: EXAMPLES[2] },
  { label: 'Five-colour palette', tool: 'soul', text: EXAMPLES[3] },
  { label: 'Shot list', tool: 'storyboard', text: EXAMPLES[4] },
  { label: 'Upscale to 4K', tool: 'upscale', text: EXAMPLES[5] },
] as const;

function fill(text: string) {
  draftText.value = text;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLTextAreaElement>('.composer textarea');
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  });
}

function Welcome() {
  const typing = draftText.value.trim().length > 0;
  return (
    <div class="welcome">
      <div class="welcome-orb">
        <span class="orb-halo" aria-hidden="true" />
        <span class="orb-ring" aria-hidden="true" />
        <Model3D model="orb" opts={{ mood: typing ? 'listening' : 'idle' }} class="orb-3d" label="The Kinemi assistant">
          <span class="orb-fallback">
            <LogoMark size={44} />
          </span>
        </Model3D>
      </div>
      <h1 class="welcome-title">
        Hey, I’m <span class="accent">Kinemi</span>. What are we shooting today?
      </h1>
      <p class="welcome-sub mono">Plain words in · the right tool runs · cost shown first</p>
      <ul class="starters" aria-label="Try one">
        {STARTERS.map((s) => (
          <li key={s.label}>
            <button type="button" class="starter" onClick={() => fill(s.text)}>
              <ToolIcon id={s.tool} size={14} />
              {s.label}
            </button>
          </li>
        ))}
      </ul>
      <div class="welcome-composer">
        <Composer />
      </div>
      <div class="tool-row">
        <p class="tool-row-title">The chat runs all 16 tools</p>
        <ul class="tool-row-list">
          {APP_TOOLS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                class={cx('tool-tile', forcedTool.value === t.id && 'is-on')}
                data-tip={t.name}
                aria-label={`Use ${t.name}`}
                aria-pressed={forcedTool.value === t.id}
                onClick={() => {
                  if (t.id === 'academy') return go({ view: 'tool', tool: 'academy' });
                  forcedTool.value = forcedTool.value === t.id ? null : t.id;
                  document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                }}
              >
                <ToolIcon id={t.id} size={20} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Text that types itself out once, the first time a reply appears. */
function Typed({ id, text }: { id: string; text: string }) {
  const live = streaming.value.has(id);
  const [n, setN] = useState(live ? 0 : text.length);
  useEffect(() => {
    if (!live) return;
    const words = text.split(/(\s+)/);
    let i = 0;
    const t = setInterval(() => {
      i += 2;
      setN(words.slice(0, i).join('').length);
      if (i >= words.length) {
        clearInterval(t);
        doneStreaming(id);
      }
    }, 28);
    return () => clearInterval(t);
  }, [id]);
  return (
    <p class="msg-text">
      {text.slice(0, n)}
      {n < text.length && <span class="caret" aria-hidden="true" />}
    </p>
  );
}

function CallCard({ chatId, msg, call }: { chatId: string; msg: Message; call: ToolCall }) {
  const tool = toolById(call.tool);
  const job = call.jobId ? jobs.value.find((j) => j.id === call.jobId) : undefined;
  const [showPrompt, setShowPrompt] = useState(false);
  const results = (call.assetIds ?? []).map(assetById).filter(Boolean) as NonNullable<ReturnType<typeof assetById>>[];
  const ahead = job?.status === 'queued' ? jobs.value.filter((j) => j.status === 'rendering' || (j.status === 'queued' && j.id < job.id)).length : 0;
  const ratio = call.spec.aspect.replace(':', ' / ');
  return (
    <article class={cx('call', `is-${call.status}`)} aria-label={`${tool.name}: ${call.title}`}>
      <header class="call-head">
        <span class="call-tool">
          <ToolIcon id={call.tool} size={18} />
          <span class="mono">
            Chat → <b>{tool.name}</b>
          </span>
        </span>
        <button type="button" class="link-btn" onClick={() => openInTool(call)}>
          Open in {call.tool === 'presets' ? 'Cinematic' : tool.name}
          <PxIcon name="external" size={11} />
        </button>
      </header>
      <h3 class="call-title">{call.title}</h3>
      <dl class="call-params">
        {call.params.map(([k, v]) => (
          <div key={k} class="param">
            <dt class="mono">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div class="call-prompt">
        <button type="button" class="link-btn" aria-expanded={showPrompt} onClick={() => setShowPrompt(!showPrompt)}>
          <PxIcon name={showPrompt ? 'chevron-down' : 'chevron-right'} size={11} />
          The prompt it writes
        </button>
        {showPrompt && (
          <div class="prompt-box">
            <pre class="mono">{call.prompt}</pre>
            <button
              type="button"
              class="icon-btn icon-btn-sm"
              aria-label="Copy the prompt"
              onClick={() => copyText(call.prompt).then(() => toast({ title: 'Prompt copied' }), () => toast({ title: 'Couldn’t copy' }))}
            >
              <PxIcon name="copy" size={12} />
            </button>
          </div>
        )}
      </div>

      {(call.status === 'rendering' || call.status === 'queued') && (
        <div class="call-render" style={{ aspectRatio: ratio }}>
          <Model3D model="clapper" opts={{ clap: call.status === 'rendering' ? 1 : 0 }} class="call-clapper">
            <PxIcon name="queue" size={40} />
          </Model3D>
          <div class="call-render-hud mono">
            <span>
              <i class="rec" aria-hidden="true" />
              {call.status === 'queued'
                ? `Queued${ahead ? ` · ${ahead} ahead` : ''}`
                : job
                  ? liveLine(job, 'Rendering', clock.value)
                  : 'Rendering'}
            </span>
            <span>{Math.round((job?.progress ?? 0) * 100)}%</span>
          </div>
          <PixelProgress value={job?.progress ?? 0} blocks={32} />
        </div>
      )}

      {call.status === 'ready' && job?.status === 'failed' && (
        <p class="form-error" role="alert">
          The render failed: {job.error}
        </p>
      )}

      {call.status === 'done' && results.length > 0 && (
        <div class={cx('call-results', results.length > 1 && 'is-many')}>
          {results.slice(0, 4).map((a) => (
            <button
              key={a.id}
              type="button"
              class="call-result"
              style={{ aspectRatio: a.aspect.replace(':', ' / ') }}
              onClick={() => {
                openAssetId.value = a.id;
                go({ view: 'assets' });
              }}
              aria-label={`Open ${a.name} in Assets`}
            >
              <Poster asset={a} density={90} />
              <span class="result-hud mono">
                <span>{a.kind === 'video' ? `▶ ${a.duration ?? 5} s` : a.kind}</span>
                <span>{a.model ? modelById(a.model).name : a.aspect}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {call.proposed && call.status === 'ready' && <RenderApproval chatId={chatId} messageId={msg.id} />}

      <footer class="call-foot">
        <Estimate runtime={call.estimate.runtime} credits={call.estimate.credits} />
        <div class="call-actions">
          {call.tool === 'supercomputer' ? (
            <button type="button" class="btn btn-accent btn-sm" onClick={() => openInTool(call)}>
              <PxIcon name="grid" size={12} />
              Open the plan
            </button>
          ) : (
            call.status === 'ready' &&
            !call.proposed && (
              <button type="button" class="btn btn-accent btn-sm" onClick={() => renderMessage(chatId, msg.id)}>
                <PxIcon name="play" size={12} />
                Render
              </button>
            )
          )}
          {(call.status === 'queued' || call.status === 'rendering') && job && (
            <button type="button" class="btn btn-ghost btn-sm" onClick={() => cancelJob(job.id)}>
              Cancel
            </button>
          )}
          {call.status === 'done' && results[0] && (
            <>
              <button type="button" class="btn btn-ghost btn-sm" onClick={(e) => openMenu(e.currentTarget as HTMLElement, folderItems(results.map((r) => r.id)))}>
                <PxIcon name="folder-move" size={13} />
                Move to
              </button>
              <button type="button" class="btn btn-ghost btn-sm" onClick={() => retake(chatId, msg.id)}>
                <PxIcon name="refresh" size={13} />
                New take
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onClick={() => {
                  openAssetId.value = results[0].id;
                  go({ view: 'assets' });
                }}
              >
                <PxIcon name="assets" size={13} />
                In Assets
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}

function MessageView({ chatId, msg, last }: { chatId: string; msg: Message; last: boolean }) {
  if (msg.role === 'user')
    return (
      <div class="msg msg-user">
        <p class="msg-bubble">{msg.text}</p>
      </div>
    );
  const typing = streaming.value.has(msg.id);
  // “Render it” only while there is something to render
  const chips = (msg.chips ?? []).filter((c) => c !== 'Render it' || msg.call?.status === 'ready');
  return (
    <div class="msg msg-bot">
      <span class="msg-avatar" aria-hidden="true">
        <LogoMark size={16} />
      </span>
      <div class="msg-body">
        <Typed id={msg.id} text={msg.text} />
        {!typing && msg.by && <small class="msg-by mono">{msg.by}</small>}
        {!typing && msg.call && <CallCard chatId={chatId} msg={msg} call={msg.call} />}
        {!typing && last && chips.length > 0 && (
          <div class="msg-chips">
            {chips.map((c) => (
              <button key={c} type="button" class="starter starter-sm" onClick={() => chipAction(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The thread's title bar: the pen renames in place, and resting on the trash (like the sidebar's) fills a red bar along the top edge. */
function ChatHeader({ chat }: { chat: Chat }) {
  const [editing, setEditing] = useState(false);
  const hold = useHoldDelete(chat);
  return (
    <header class={cx('thread-head', hold.holding && 'is-holding')}>
      <span class="head-fill" aria-hidden="true" />
      <div class="thread-title">{editing ? <TitleInput chat={chat} done={() => setEditing(false)} /> : <h1>{chat.title}</h1>}</div>
      {!editing && (
        <div class="thread-actions">
          <button type="button" class="icon-btn" aria-label="Rename chat" data-tip="Rename chat" onClick={() => setEditing(true)}>
            <PxIcon name="pencil" size={16} />
          </button>
          <button
            type="button"
            class="icon-btn head-del"
            aria-label={hold.label}
            data-tip={hold.tip}
            {...hold.props}
          >
            <PxIcon name="trash" size={16} />
          </button>
        </div>
      )}
    </header>
  );
}

function Thread({ id }: { id: string }) {
  const chat = chatById(id)!;
  const scroller = useRef<HTMLDivElement>(null);
  const isThinking = thinking.value === id;
  const count = chat.messages.length;

  // follow the newest message, and a render as it starts and lands
  const status = chat.messages.map((m) => m.call?.status ?? '').join();
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: count > 2 ? 'smooth' : 'auto' });
  }, [count, isThinking, id, status]);

  // keep the newest reply in view while it types
  useEffect(() => {
    if (!streaming.value.size) return;
    const el = scroller.current;
    const t = setInterval(() => el && el.scrollHeight - el.scrollTop - el.clientHeight < 240 && el.scrollTo({ top: el.scrollHeight }), 120);
    return () => clearInterval(t);
  }, [streaming.value.size]);

  return (
    <div class="thread">
      <ChatHeader chat={chat} />
      <div ref={scroller} class="thread-scroll" role="log" aria-live="polite" aria-label="Conversation">
        <div class="thread-inner">
          {chat.messages.map((m, i) => (
            <MessageView key={m.id} chatId={id} msg={m} last={i === chat.messages.length - 1} />
          ))}
          {isThinking && (
            <div class="msg msg-bot">
              <span class="msg-avatar is-thinking" aria-hidden="true">
                <LogoMark size={16} />
              </span>
              <span class="thinking" aria-label="Kinemi is thinking">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
        </div>
      </div>
      <div class="thread-dock">
        <Composer docked />
      </div>
    </div>
  );
}

export function ChatView() {
  const id = activeChatId.value;
  const chat = chatById(id);
  return <section class={cx('chat', chat ? 'has-thread' : 'is-welcome')}>{chat ? <Thread key={chat.id} id={chat.id} /> : <Welcome />}</section>;
}

// What happens when you talk to the chat: a user message, a short think, a reply with a tool call.
import { signal } from '@preact/signals';
import { toolById, type ToolId } from '../data/tools';
import { id as newId } from '../lib/util';
import { queueRender } from '../render';
import { go } from '../router';
import { withCompute } from '../shell/Compute';
import { activeChatId, assets, cast, chatById, chats, setDraft, settings, updateChat, updateMessage, type Asset, type Message, type ToolCall } from '../store';
import { chatTitle, interpret, type Reply } from './engine';
import { askAssistant, ASSISTANTS } from './llm';

/** The chat is thinking about this chat id. */
export const thinking = signal<string | null>(null);
/** Assistant messages still typing out, by id. */
export const streaming = signal<Set<string>>(new Set());
/** Text waiting in the composer (chips and tool tiles put it there). */
export const draftText = signal('');
/** A tool forced from the composer's picker, or null for Auto. */
export const forcedTool = signal<ToolId | null>(null);
/** A finished render attached to the next message. */
export const attachment = signal<Asset | null>(null);

export function newChat() {
  activeChatId.value = null;
  draftText.value = '';
  attachment.value = null;
  go({ view: 'chat' });
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
}

export function openChat(id: string) {
  activeChatId.value = id;
  go({ view: 'chat' });
}

const lastCall = (msgs: Message[]) => [...msgs].reverse().find((m) => m.call)?.call;

export function send(raw: string) {
  const text = raw.trim();
  if (!text || thinking.value) return;
  const now = Date.now();
  let chatId = activeChatId.value;
  if (!chatId || !chatById(chatId)) {
    chatId = newId('ch');
    chats.value = [{ id: chatId, title: chatTitle(text), createdAt: now, updatedAt: now, messages: [] }, ...chats.value];
    activeChatId.value = chatId;
  }
  const userMsg: Message = { id: newId('m'), role: 'user', text, at: now };
  updateChat(chatId, (c) => ({ ...c, updatedAt: now, messages: [...c.messages, userMsg] }));
  draftText.value = '';

  // an attached render becomes the newest one, so source-based tools pick it up
  const att = attachment.value;
  attachment.value = null;
  const pool = att ? [{ ...att, createdAt: now }, ...assets.value.filter((a) => a.id !== att.id)] : assets.value;
  const forced = forcedTool.value;
  const prompt = forced && !new RegExp(toolById(forced).name, 'i').test(text) ? `use ${toolById(forced).name}: ${text}` : text;
  const chat = chatById(chatId)!;
  const ctx = { assets: pool, cast: cast.value, last: lastCall(chat.messages), yolo: settings.value.yolo };
  // the messages before this one: the model reads the conversation so far
  const before = chat.messages.slice(0, -1);
  const model = settings.value.assistant !== 'builtin';

  thinking.value = chatId;
  const started = Date.now();
  const delay = model ? 0 : 520 + Math.min(900, text.length * 9);
  const cid = chatId;
  const answer = async (): Promise<{ reply: Reply; by?: string }> => {
    if (!model) return { reply: interpret(prompt, ctx) };
    const res = await askAssistant(prompt, ctx, before);
    if ('reply' in res) return res;
    // the model couldn't answer: say why and nothing else. The built-in rules never answer in its place.
    return { reply: { text: res.error }, by: ASSISTANTS[settings.value.assistant].name };
  };
  void answer().then(({ reply, by }) =>
    setTimeout(
      () => {
        thinking.value = null;
        const msg: Message = {
          id: newId('m'),
          role: 'assistant',
          text: reply.text,
          at: Date.now(),
          call: reply.call,
          chips: reply.open && !reply.chips?.some((c) => c.startsWith('Open ')) ? [...(reply.chips ?? []), `Open ${toolById(reply.open).name}`] : reply.chips,
          by,
        };
        streaming.value = new Set([...streaming.value, msg.id]);
        updateChat(cid, (c) => ({
          ...c,
          // a new chat takes its name from the first shot it sets up, unless the owner already named it
          title: c.messages.length === 1 && reply.call && c.title === chatTitle(c.messages[0].text) ? reply.call.title : c.title,
          updatedAt: Date.now(),
          messages: [...c.messages, msg],
        }));
        if (reply.render) {
          const target = [...chatById(cid)!.messages].reverse().find((m) => m.call && m.call.status === 'ready');
          // YOLO runs it now; otherwise the call sits there until the owner approves it.
          // A card the owner turned down (proposed: false) is never put up again, whoever asks.
          // YOLO as it was when the message went: the reply's words were chosen from that same value.
          if (target?.call && target.call.proposed !== false) {
            if (ctx.yolo) renderMessage(cid, target.id);
            else updateMessage(cid, target.id, (m) => (m.call ? { ...m, call: { ...m.call, proposed: true } } : m));
          }
        }
      },
      Math.max(0, delay - (Date.now() - started)),
    ),
  );
}

export function doneStreaming(id: string) {
  if (!streaming.value.has(id)) return;
  const next = new Set(streaming.value);
  next.delete(id);
  streaming.value = next;
}

export function renderMessage(chatId: string, msgId: string) {
  const m = chatById(chatId)?.messages.find((x) => x.id === msgId);
  const call = m?.call;
  if (!call || (call.status !== 'ready' && call.status !== 'done')) return;
  // it may have been waiting for this click: the click is the approval. Cleared, not false: false means Not now
  if (call.proposed) updateMessage(chatId, msgId, (x) => (x.call ? { ...x, call: { ...x.call, proposed: undefined } } : x));
  // a campaign is a plan of many renders: it runs from Supercomputer, cell by cell
  if (call.tool === 'supercomputer') return openInTool(call);
  withCompute(() => queueRender({ ...call.spec, chatId, msgId }), call.estimate.credits);
}

/** The owner said not now: the call stays on the card, unrendered and uncharged, and is never proposed again. */
export function declineRender(chatId: string, msgId: string) {
  updateMessage(chatId, msgId, (m) => (m.call ? { ...m, call: { ...m.call, proposed: false } } : m));
}

/** Re-render a finished call as a new take, in a new message. */
export function retake(chatId: string, msgId: string) {
  const m = chatById(chatId)?.messages.find((x) => x.id === msgId);
  if (!m?.call) return;
  const msg: Message = { id: newId('m'), role: 'assistant', text: 'Another take with the same settings, new seed.', at: Date.now(), call: { ...m.call, status: 'ready', proposed: undefined, assetIds: undefined, jobId: undefined } };
  updateChat(chatId, (c) => ({ ...c, updatedAt: Date.now(), messages: [...c.messages, msg] }));
  renderMessage(chatId, msg.id);
}

/** Open a call's settings in its tool page. */
export function openInTool(call: ToolCall) {
  const tool = call.tool === 'presets' ? 'cinematic' : call.tool;
  for (const [k, v] of Object.entries(call.values)) setDraft(tool, k, v);
  go({ view: 'tool', tool });
}

export function chipAction(chip: string) {
  if (chip === 'Open the plan') {
    const chat = activeChatId.value ? chatById(activeChatId.value) : undefined;
    const plan = chat && [...chat.messages].reverse().find((m) => m.call?.tool === 'supercomputer')?.call;
    if (plan) return openInTool(plan);
    return go({ view: 'tool', tool: 'supercomputer' });
  }
  const open = chip.match(/^Open (.+)$/);
  if (open) {
    const name = open[1].toLowerCase();
    const t = (['academy', 'presets', 'storyboard', 'canvas', 'previz', 'cast'] as ToolId[]).find((id) => toolById(id).name.toLowerCase() === name);
    if (t) {
      go({ view: 'tool', tool: t });
      return;
    }
  }
  send(chip);
}

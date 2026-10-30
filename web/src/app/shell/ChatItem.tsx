// One chat in the sidebar. The pen turns the title into an input in place; the red button deletes
// the chat once the pointer has rested on it for a second (or Enter/Space is held), and a toast offers Undo.
import { useEffect, useRef, useState } from 'preact/hooks';
import { openChat } from '../chat/actions';
import { cx } from '../lib/util';
import { chats, deleteChat, renameChat, type Chat } from '../store';
import { PxIcon } from '../ui/icons';
import { toast } from '../ui/toast';
import { drawer } from './TopBar';

const HOLD_MS = 1000;
const ACCESSIBLE_CONFIRM_MS = 5000;

function removeWithUndo(c: Chat) {
  deleteChat(c.id);
  toast({
    title: 'Chat deleted',
    body: c.title,
    action: {
      label: 'Undo',
      run: () => {
        if (!chats.value.some((x) => x.id === c.id)) chats.value = [...chats.value, c];
      },
    },
  });
}

/** A press that only counts once it has lasted HOLD_MS. */
function useHold(onDone: () => void) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const stop = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };
  const start = () => {
    clearTimeout(timer.current);
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      onDone();
    }, HOLD_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return { holding, start, stop };
}

export function TitleInput({ chat, done }: { chat: Chat; done: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (save && ref.current) renameChat(chat.id, ref.current.value.slice(0, 300));
    done();
  };
  return (
    <input
      ref={ref}
      class="chat-rename"
      value={chat.title}
      maxLength={300}
      aria-label="Chat title"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** Press-and-hold deletes with Undo; assistive technology gets an explicit confirmation. */
export function useHoldDelete(chat: Chat) {
  const hold = useHold(() => removeWithUndo(chat));
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef(0);
  const clearConfirmation = () => {
    clearTimeout(confirmTimer.current);
    confirmTimer.current = 0;
    setConfirming(false);
  };
  const start = () => {
    clearConfirmation();
    hold.start();
  };
  useEffect(() => () => clearTimeout(confirmTimer.current), []);
  const key = (e: KeyboardEvent, down: boolean) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (!down) hold.stop();
    else if (!e.repeat) start();
  };
  const click = (e: MouseEvent) => {
    e.preventDefault();
    if (e.detail !== 0) return;
    if (confirming) {
      clearConfirmation();
      removeWithUndo(chat);
      return;
    }
    setConfirming(true);
    confirmTimer.current = window.setTimeout(clearConfirmation, ACCESSIBLE_CONFIRM_MS);
  };
  const props = {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      start();
    },
    onPointerUp: hold.stop,
    onPointerLeave: hold.stop,
    onPointerCancel: hold.stop,
    // touch capture can suppress pointerleave, so movement outside the button also stops the hold
    onPointerMove: (e: PointerEvent) => {
      if (!hold.holding) return;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) hold.stop();
    },
    onKeyDown: (e: KeyboardEvent) => key(e, true),
    onKeyUp: (e: KeyboardEvent) => key(e, false),
    onBlur: hold.stop,
    onClick: click,
  };
  const label = confirming
    ? `Confirm delete ${chat.title}: activate again within five seconds`
    : `Delete ${chat.title}: hold for a second`;
  const tip = confirming ? 'Activate again to confirm delete' : 'Hold for 1 second to delete';
  return { holding: hold.holding, confirming, label, tip, props };
}

export function ChatItem({ chat, active }: { chat: Chat; active: boolean }) {
  const [editing, setEditing] = useState(false);
  const hold = useHoldDelete(chat);
  return (
    <div class={cx('side-item chat-item', active && 'is-on', editing && 'is-editing', hold.holding && 'is-holding')} data-chat={chat.id}>
      {editing ? (
        <div class="side-link">
          <span class="side-ico">
            <PxIcon name="pencil" size={16} />
          </span>
          <TitleInput chat={chat} done={() => setEditing(false)} />
        </div>
      ) : (
        <>
          <button
            type="button"
            class="side-link"
            aria-pressed={active}
            data-rail-tip={chat.title}
            onClick={() => {
              drawer.value = false;
              openChat(chat.id);
            }}
          >
            <span class="side-ico">
              <PxIcon name="chat" size={16} />
            </span>
            <span class="side-text">{chat.title}</span>
          </button>
          <span class="chat-actions">
            <button type="button" class="icon-btn icon-btn-sm chat-act" aria-label={`Rename ${chat.title}`} data-tip="Rename chat" onClick={() => setEditing(true)}>
              <PxIcon name="pencil" size={14} />
            </button>
            <button
              type="button"
              class="icon-btn icon-btn-sm chat-act chat-del"
              aria-label={hold.label}
              data-tip={hold.tip}
              {...hold.props}
            >
              <span class="hold-fill" aria-hidden="true" />
              <PxIcon name="trash" size={14} />
            </button>
          </span>
        </>
      )}
    </div>
  );
}

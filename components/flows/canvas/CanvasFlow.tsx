"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Panel } from "../../ui";
import flowStyles from "../flow.module.css";
import type { CanvasBoard, CanvasNode } from "./board";
import {
  decodeBoard,
  encodeBoard,
  newNode,
  readBoard,
  removeNode,
  snapshotBoard,
  starterBoard,
} from "./board";
import { CollabPanel } from "./CollabPanel";
import type { CopyState } from "./CollabPanel";
import { downloadText } from "./download";
import { NodeBoard } from "./NodeBoard";
import { runBoard, runStep } from "./run";
import type { NodeUpdate } from "./run";
import { TemplatePanel } from "./TemplatePanel";
import type { TemplateMessage } from "./TemplatePanel";
import {
  canvasTemplates,
  findTemplate,
  parseTemplate,
  templateFileContent,
  templateToBoard,
} from "./templates";
import { useCanvasCollab } from "./collab";
import styles from "./canvas.module.css";

const BOARD_STORAGE = "kinemi.canvas.board";
const DEFAULT_NAME = "Guest";

function readSavedBoard(): CanvasBoard | undefined {
  try {
    const raw = window.localStorage.getItem(BOARD_STORAGE);
    return raw ? readBoard(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

type SharedBoard = { board?: CanvasBoard; invalid: boolean };

function readSharedBoard(): SharedBoard {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = params.get("board");
  if (!token) {
    return { invalid: false };
  }
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  const board = decodeBoard(token);
  return board ? { board, invalid: false } : { invalid: true };
}

function fileNameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "canvas"}-template.json`;
}

/** The Canvas route: N1 board, N2 templates, N3 presence and locks. */
export function CanvasFlow() {
  const [board, setBoard] = useState<CanvasBoard>(starterBoard);
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>("step-1");
  const [templateId, setTemplateId] = useState(canvasTemplates[0]?.id ?? "");
  const [notice, setNotice] = useState<TemplateMessage | undefined>(undefined);
  const [name, setName] = useState(DEFAULT_NAME);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [running, setRunning] = useState(false);
  const [origin, setOrigin] = useState("");
  const abortRef = useRef<AbortController | undefined>(undefined);

  const acceptRemote = useCallback((remote: CanvasBoard) => {
    setBoard(remote);
    setSelectedId((current) =>
      current && remote.nodes.some((node) => node.id === current)
        ? current
        : remote.nodes[0]?.id,
    );
  }, []);
  const { peers, supported, peerId, publishBoard } = useCanvasCollab(
    name.trim() || DEFAULT_NAME,
    acceptRemote,
  );

  useEffect(() => {
    const shared = readSharedBoard();
    if (shared.board) {
      setBoard(shared.board);
      setSelectedId(shared.board.nodes[0]?.id);
      setNotice({ kind: "ok", text: "Loaded the board from the share link." });
    } else {
      if (shared.invalid) {
        setNotice({ kind: "error", text: "That share link is not a readable board." });
      }
      const saved = readSavedBoard();
      if (saved) {
        setBoard(saved);
        setSelectedId(saved.nodes[0]?.id);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(BOARD_STORAGE, JSON.stringify(snapshotBoard(board)));
    } catch {
      // Private mode or a full quota: the board still lives in memory.
    }
  }, [board, hydrated]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  function commit(next: CanvasBoard) {
    setBoard(next);
    publishBoard(next);
  }

  function updateRun(id: string, patch: Partial<CanvasNode>) {
    setBoard((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    }));
  }

  const updateNode: NodeUpdate = updateRun;

  function patchNode(id: string, patch: Partial<CanvasNode>) {
    const node = board.nodes.find((row) => row.id === id);
    if (!node || (node.lock && node.lock.id !== peerId)) return;
    commit({ ...board, nodes: board.nodes.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  }

  function setTitle(title: string) {
    commit({ ...board, title });
  }

  function addNode() {
    const node = newNode(board, selectedId);
    commit({ ...board, nodes: [...board.nodes, node] });
    setSelectedId(node.id);
  }

  function removeStep(id: string) {
    const node = board.nodes.find((row) => row.id === id);
    if (!node || (node.lock && node.lock.id !== peerId)) return;
    const next = removeNode(board, id);
    commit(next);
    if (selectedId === id) {
      setSelectedId(next.nodes[0]?.id);
    }
  }

  function moveNode(id: string, x: number, y: number) {
    const node = board.nodes.find((row) => row.id === id);
    if (!node || (node.lock && node.lock.id !== peerId)) return;
    patchNode(id, { x, y });
  }

  function toggleLock(id: string) {
    const node = board.nodes.find((row) => row.id === id);
    if (!node || (node.lock && node.lock.id !== peerId)) return;
    patchNode(id, {
      lock: node.lock ? undefined : { id: peerId, name: name.trim() || DEFAULT_NAME },
    });
  }

  async function startRun(task: (signal: AbortSignal) => Promise<void>) {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      await task(controller.signal);
    } catch (cause) {
      setNotice({
        kind: "error",
        text: cause instanceof Error ? cause.message : "The board could not start.",
      });
    } finally {
      setRunning(false);
      abortRef.current = undefined;
    }
  }

  const runAll = () => startRun((signal) => runBoard(board, updateNode, signal));
  const runOne = (id: string) => startRun((signal) => runStep(board, id, updateNode, signal));
  const stop = () => abortRef.current?.abort();

  function applyTemplate() {
    const template = findTemplate(templateId);
    if (!template) {
      setNotice({ kind: "error", text: "Pick a template first." });
      return;
    }
    const next = templateToBoard(template);
    commit(next);
    setSelectedId(next.nodes[0]?.id);
    setNotice({ kind: "ok", text: `Loaded "${template.name}".` });
  }

  function downloadTemplate() {
    downloadText(fileNameFor(board.title), templateFileContent(board));
    setNotice({ kind: "ok", text: "Template downloaded." });
  }

  async function importTemplate(file: File) {
    try {
      const template = parseTemplate(JSON.parse(await file.text()));
      const next = templateToBoard(template);
      commit(next);
      setSelectedId(next.nodes[0]?.id);
      setNotice({ kind: "ok", text: `Imported "${template.name}".` });
    } catch (cause) {
      setNotice({
        kind: "error",
        text: cause instanceof Error ? cause.message : "That file is not a template.",
      });
    }
  }

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const shareUrl = origin ? `${origin}/canvas#board=${encodeBoard(board)}` : "";
  const lockedCount = board.nodes.filter((node) => node.lock !== undefined).length;

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Graph</span>
        <h1>Canvas</h1>
        <p className={flowStyles.lead}>
          Wire the studio's models into one board: a still feeds a move, an edit feeds an upscale, a
          score runs beside them. Every step is a real `/api/generate` run on the model you pick. A
          shared board is a snapshot; live presence and locks travel between tabs of this browser.
        </p>
      </header>

      <div className={styles.layout}>
        <div className={styles.column}>
          <Panel title="Templates" subtitle="N2 · reusable graph JSON, shipped or imported.">
            <TemplatePanel
              templates={canvasTemplates}
              selectedId={templateId}
              message={notice}
              onSelect={setTemplateId}
              onApply={applyTemplate}
              onDownload={downloadTemplate}
              onImport={importTemplate}
            />
          </Panel>
          <Panel title="Collaboration canvas" subtitle="N3 · presence, locks and a share link.">
            <CollabPanel
              name={name}
              peers={peers}
              supported={supported}
              shareUrl={shareUrl}
              copyState={copyState}
              lockedCount={lockedCount}
              onName={setName}
              onCopy={copyShare}
            />
          </Panel>
        </div>

        <div className={styles.column}>
          <Panel
            title="Node board"
            subtitle="N1 · parents run first, one step at a time."
            right={
              <div className={styles.row}>
                <Button variant="ghost" onClick={addNode}>
                  Add step
                </Button>
                {running ? (
                  <Button variant="ghost" onClick={stop}>
                    Stop board
                  </Button>
                ) : (
                  <Button
                    onClick={runAll}
                    disabled={board.nodes.length === 0}
                    title={board.nodes.length === 0 ? "Add a step first" : undefined}
                  >
                    Run board
                  </Button>
                )}
              </div>
            }
          >
            <NodeBoard
              board={board}
              selectedId={selectedId}
              selfId={peerId}
              running={running}
              onTitle={setTitle}
              onSelect={setSelectedId}
              onAdd={addNode}
              onPatch={patchNode}
              onMove={moveNode}
              onRemove={removeStep}
              onRun={runOne}
              onToggleLock={toggleLock}
            />
          </Panel>
        </div>
      </div>
    </main>
  );
}

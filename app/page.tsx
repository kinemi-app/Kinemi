import Link from "next/link";
import styles from "../components/shell/shell.module.css";
import { models } from "../lib/models";
import { cameraMoves } from "../lib/presets/load";
import { studios } from "../lib/studios";

const MODES = [
  {
    href: "/cinematic",
    title: "Cinematic",
    meta: "Camera · lenses · looks",
    body: "Build one shot: stack camera moves, pick a body, lens and aperture, set the look, then render the frames.",
  },
  {
    href: "/storyboard",
    title: "Storyboard",
    meta: "Shot list",
    body: "Queue up to eight shots, each with its own prompt, model and duration, then render the list in order.",
  },
  {
    href: "/reshoot",
    title: "Re-shoot",
    meta: "New angle",
    body: "Take a finished image and change the angle of the camera: orbit, tilt and level, with the subject left alone.",
  },
  {
    href: "/genjutsu",
    title: "Genjutsu",
    meta: "Motion transfer",
    body: "Move a performance from a source clip onto a face or a character card, with emotions from a wheel.",
  },
  {
    href: "/presets",
    title: "Presets",
    meta: "Move library",
    body: "The camera move library with the prompt each move is written as, ready to drop into a shot.",
  },
  {
    href: "/soul",
    title: "Soul",
    meta: "Palette · stills",
    body: "Turn one sentence into a five-colour HEX palette, pick a Soul 2.0 preset, then render the still with the palette locked.",
  },
  {
    href: "/cast",
    title: "AI Cast",
    meta: "Characters",
    body: "Build a character: name, reference images, a locked identity and eight emotions, then copy its tag into any prompt.",
  },
  {
    href: "/edit",
    title: "Edit",
    meta: "Clip in, clip out",
    body: "Take a finished clip, write what should change, set how hard the edit lands and re-render it on an open video model.",
  },
  {
    href: "/academy",
    title: "Academy",
    meta: "Tutorials",
    body: "Eight short lessons on camera language, prompts, open weights, demo mode and connecting your own Comfy deployment.",
  },
];

export default function HomePage() {
  const modelCount = models.length;
  const vendorCount = new Set(models.map((model) => model.vendor)).size;
  const moveCount = cameraMoves.length;
  const liveStudios = studios.filter((studio) => studio.live);

  return (
    <main className={styles.frame}>
      <section className={styles.hero}>
        <h1 className={styles.display}>
          The screening room for <span className={styles.accent}>ComfyUI</span> film work.
        </h1>
        <p className={styles.lead}>
          {MODES.length + liveStudios.length} tools in one place: build a shot with real camera language, queue a shot list, re-shoot
          a still, move a performance onto another face, browse the move library, paint a Soul frame
          from a palette, build a cast, edit a finished clip and learn the camera language. Then take it
          further with a voice studio, an ad factory, a fashion shoot, a canvas board, a 3D previz, a
          campaign planner and a 4K upscaler. Open models, clear prices, no lock-in.
        </p>
      </section>

      <div className={styles.grid}>
        {MODES.map((mode) => (
          <Link key={mode.href} href={mode.href} className={styles.card}>
            <span className={styles.cardTop}>
              <span className={styles.cardTitle}>{mode.title}</span>
              <span className={styles.cardMeta}>{mode.meta}</span>
            </span>
            <span className={styles.cardBody}>{mode.body}</span>
            <span className={styles.cardGo}>Open {mode.title} →</span>
          </Link>
        ))}
        {liveStudios.map((studio) => (
          <Link key={studio.href} href={studio.href} className={styles.card}>
            <span className={styles.cardTop}>
              <span className={styles.cardTitle}>{studio.label}</span>
              <span className={styles.cardMeta}>Studio</span>
            </span>
            <span className={styles.cardBody}>{studio.blurb}</span>
            <span className={styles.cardGo}>Open {studio.label} →</span>
          </Link>
        ))}
      </div>

      <div className={styles.strip}>
        <span>
          <span className={styles.stripKey}>
            {modelCount} open models from {vendorCount} vendors
          </span>
          : Wan, LTX, Hunyuan, FLUX and Qwen weights, one registry.
        </span>
        <span>
          <span className={styles.stripKey}>{moveCount} camera moves</span> in the library,
          every one with the prompt it writes, ready to drop into a shot.
        </span>
        <span>
          <span className={styles.stripKey}>Cost first</span>: every flow shows runtime and credits
          before you press generate.
        </span>
        <span>
          <span className={styles.stripKey}>Demo mode</span>: no Comfy endpoint is connected yet, so a
          render resolves to a placeholder poster.
        </span>
      </div>
    </main>
  );
}

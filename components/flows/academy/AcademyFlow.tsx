import Link from "next/link";
import type { ReactNode } from "react";
import flowStyles from "../flow.module.css";
import styles from "./academy.module.css";

type Lesson = {
  id: string;
  title: string;
  href: string;
  tryLabel: string;
  body: ReactNode;
};

const LESSONS: Lesson[] = [
  {
    id: "screening-room",
    title: "The screening room",
    href: "/cinematic",
    tryLabel: "build a shot",
    body: (
      <>
        <p>
          Every Kinemi page works the same way. Put a source in the panel on the left, set the prompt,
          model and duration, then press Generate. The job leaves the page, appears on the stage and
          polls until it succeeds or fails. A finished job shows its file; a failed one shows the error
          that stopped it.
        </p>
        <p>
          The model picker states the model, its clip cap and the credits for this run before you send.
          Every entry in the registry is open weights, from Wan and LTX to FLUX and Qwen. The empty
          stage says what the flow still needs, so read it before you build.
        </p>
      </>
    ),
  },
  {
    id: "camera-moves",
    title: "Camera moves and stacking",
    href: "/presets",
    tryLabel: "open the move library",
    body: (
      <>
        <p>
          Camera moves live in the Presets library: sixty fragments, grouped by family, each with the
          exact prompt it writes. Open Cinematic and search the library, then click up to three moves.
          They stack in click order, and the camera performs them in that order.
        </p>
        <p>
          A wide reveal into a slow push-in is not the same shot as the push-in into the reveal. Click
          a selected move again to remove it. Leave the prompt empty and the shot is written from the
          stack and the look.
        </p>
      </>
    ),
  },
  {
    id: "lenses-bodies-light",
    title: "Lenses, bodies and light",
    href: "/cinematic",
    tryLabel: "set a look",
    body: (
      <>
        <p>
          The look panel describes the camera that shot the scene. Body sets the sensor: full frame,
          Super 35, medium format or micro four thirds. Lens runs from 18 mm to 135 mm; wide lenses
          open the space, long lenses compress it. Aperture controls depth of field, from f/1.4 with a
          soft background to f/11 where more of the scene holds focus.
        </p>
        <p>
          Palette and lighting grade the frame, from neutral and golden hour to bleach bypass and neon
          night. These choices are written into the prompt, so they carry to any model in the registry.
        </p>
      </>
    ),
  },
  {
    id: "soul-palettes",
    title: "Soul HEX palettes and presets",
    href: "/soul",
    tryLabel: "start from a palette",
    body: (
      <>
        <p>
          A Soul run starts with a sentence rather than an image. Describe the frame and Kinemi returns
          a five-colour HEX palette: the colours the still will be built from. Keep the palette locked,
          choose a Soul 2.0 preset for the render style, and generate.
        </p>
        <p>
          The HEX values travel with the prompt, so the same palette can hold a series together while
          the subject and framing change. Soul uses the image models in the registry, FLUX.2 dev or
          Qwen-Image, and bills per second at still length, not at video length.
        </p>
      </>
    ),
  },
  {
    id: "ai-cast",
    title: "AI Cast and @name emotion tags",
    href: "/cast",
    tryLabel: "build a character",
    body: (
      <>
        <p>
          AI Cast gives a character a name and a face you can reuse. Add reference images of the same
          person, then pick one emotion from the eight: joy, anger, fear, sadness, surprise, disgust,
          desire and calm. The saved tag reads @Mira anger, with the character name and the chosen
          mood.
        </p>
        <p>
          Copy that tag into any Cinematic, Genjutsu or Soul prompt to keep the identity and the mood
          aligned. A character keeps up to three references, each under 2 MB. The cast is stored in
          this browser, so it survives a reload but not a different machine.
        </p>
      </>
    ),
  },
  {
    id: "reshoot-frames",
    title: "Re-shoot and the first/last frame",
    href: "/reshoot",
    tryLabel: "re-shoot a still",
    body: (
      <>
        <p>
          Re-shoot takes a finished still and moves the camera around it. Load one image, choose front,
          three-quarter, profile, low angle, high angle or overhead, then fine-tune orbit, tilt, zoom
          and roll. The subject and background stay where they are; only the viewpoint changes.
        </p>
        <p>
          First and last frames solve a different problem. In Cinematic you can drop two stills and let
          the model travel from one to the other, which fixes the start, the end and the timing of a
          move. Use re-shoot for another angle, frames for a controlled transition.
        </p>
      </>
    ),
  },
  {
    id: "genjutsu-motion",
    title: "Genjutsu motion transfer",
    href: "/genjutsu",
    tryLabel: "transfer a performance",
    body: (
      <>
        <p>
          Genjutsu copies a performance, not a face. Load a source clip between four and thirty
          seconds, then choose motion transfer or object swap. Motion transfer rebuilds the scene
          around a character card while taking movement, camera and timing from the clip. Object swap
          leaves the shot alone and replaces one subject with the references you supply.
        </p>
        <p>
          The character card holds the name, identity images and emotion tags; the swap uses the same
          thirty-image budget. A clip shorter than four seconds is refused, so trim the performance
          before you upload it.
        </p>
      </>
    ),
  },
  {
    id: "edit-cost",
    title: "Editing a clip, extending it and reading the cost line",
    href: "/edit",
    tryLabel: "edit a clip",
    body: (
      <>
        <p>
          Edit starts from a finished clip, not a still. Load it, write what should change and set how
          hard the edit lands: a small strength keeps the original timing and framing, a large one
          rebuilds more of the shot. The run goes back to a video model and re-renders the clip at the
          length you ask for. In this build the request carries the prompt and the length, not the file
          bytes; the loaded clip stays a local preview until a Comfy deployment adds upload.
        </p>
        <p>
          To extend a clip, take its last frame and feed it to the next shot as the first frame;
          Cinematic uses it as the starting image for the next run. The cost line multiplies credits per
          second by the seconds actually sent, and shows the total before Generate.
        </p>
      </>
    ),
  },
];

export function AcademyFlow() {
  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Tutorials</span>
        <h1>Academy</h1>
        <p className={flowStyles.lead}>
          Eight short lessons on building a shot in Kinemi, from camera language to the cost line. This
          build runs without COMFY_URL, so every generation resolves to a demo poster, not a rendered
          frame. Connect a ComfyUI server to see real output.
        </p>
      </header>

      <div className={styles.layout}>
        <nav className={styles.contents} aria-label="Lesson contents">
          <p className={styles.contentsTitle}>Contents</p>
          <ol className={styles.contentsList}>
            {LESSONS.map((lesson, index) => (
              <li key={lesson.id}>
                <a className={styles.contentsLink} href={`#${lesson.id}`}>
                  <span className={styles.contentsNumber} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {lesson.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={styles.prose}>
          {LESSONS.map((lesson, index) => (
            <section key={lesson.id} className={styles.lesson} aria-labelledby={lesson.id}>
              <h2 id={lesson.id} className={styles.lessonTitle}>
                <span className={styles.lessonNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {lesson.title}
              </h2>
              {lesson.body}
              <p className={styles.tryIt}>
                <Link className={styles.tryItLink} href={lesson.href}>
                  Try it: {lesson.tryLabel} →
                </Link>
              </p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

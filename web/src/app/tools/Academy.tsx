// The Academy: four tracks of short lessons. Each has a short read, a live figure built from the studio's
// own controls, a “Try it” that opens the tool set up for it, and a quiz that marks it done. And a glossary.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { GLOSSARY } from '../data/glossary';
import { LESSONS, TRACKS, lessonById, type Lesson, type TryIt } from '../data/lessons';
import { FOLDERS, MODEL_FILES } from '../data/model-files';
import { MODELS } from '../data/models';
import { moveById } from '../data/moves';
import { APERTURES, LENSES, LOOK_SWATCHES } from '../data/options';
import { cx } from '../lib/util';
import { go } from '../router';
import { cast, liveAssets, patchSettings, setDraft, settings } from '../store';
import { Estimate, Segmented, Select } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { Poster } from '../ui/Poster';
import { toast } from '../ui/toast';
import { ANGLES, costCeiling, costView, EXAMPLES, SIZES, speedTier, VIDEO_MODELS, type Angle } from './academy-figures';
import { AspectCards, LookCards, MovePad, Optics } from './camera-controls';
import { graphsFor } from './comfy';
import { ComfyPanel } from './ComfyView';
import { buildFor, defaultsFor } from './recipes';

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

function SizesFigure() {
  const [size, setSize] = useState(2);
  const [angle, setAngle] = useState<Angle>('Eye level');
  const tilt = angle === 'High' ? 9 : angle === 'Low' ? -9 : 0;
  return (
    <div class="acad-fig">
      <div class="acad-frame" style={{ aspectRatio: '16 / 9' }}>
        <div class="acad-zoom" style={{ transform: `perspective(700px) rotateX(${tilt}deg) scale(${SIZES[size][1]})` }}>
          <Poster asset={{ id: 'academy-sizes', scene: 'portrait', seed: 11, kind: 'still' }} density={90} />
        </div>
        <span class="acad-hud mono">
          {SIZES[size][0]} · {angle}
        </span>
      </div>
      <Segmented label="Shot size" value={String(size)} onChange={(v) => setSize(Number(v))} options={SIZES.map(([name], i) => ({ value: String(i), label: name }))} class="seg-block" />
      <Segmented label="Angle" value={angle} onChange={(v) => setAngle(v as Angle)} options={[...ANGLES]} size="sm" />
    </div>
  );
}

function MovesFigure() {
  const [moves, setMoves] = useState<string[]>(['dolly-in']);
  const said = moves.map((id) => moveById(id)?.prompt).filter(Boolean);
  return (
    <div class="acad-fig">
      <MovePad value={moves} onChange={setMoves} lens="35mm" />
      <p class="acad-says">
        <span class="mono">Writes</span> {said.length ? said.join(', then ') : 'a locked-off shot: the camera doesn’t move'}
      </p>
    </div>
  );
}

function OpticsFigure() {
  const [lens, setLens] = useState('85mm');
  const [aperture, setAperture] = useState('f/1.8');
  return (
    <div class="acad-fig">
      <Optics lens={lens} aperture={aperture} look="Golden hour" lenses={LENSES} onLens={setLens} onAperture={setAperture} />
      <p class="acad-says">
        <span class="mono">Writes</span> {lens}, {aperture}
        {APERTURES.indexOf(aperture) <= 2 ? ', shallow depth of field, soft background' : ', deep focus, everything sharp'}
      </p>
    </div>
  );
}

function FrameFigure() {
  const [aspect, setAspect] = useState('2.39:1');
  const [w, h] = aspect.split(':').map(Number);
  return (
    <div class="acad-fig">
      <div class="acad-frames">
        <div class="acad-frame" style={{ aspectRatio: `${w} / ${h}`, maxHeight: '240px' }}>
          <Poster asset={{ id: 'academy-frame', scene: 'desert', seed: 4, kind: 'still' }} density={90} />
          <span class="acad-hud mono">{aspect}</span>
        </div>
      </div>
      <AspectCards value={aspect} set={setAspect} />
    </div>
  );
}

function LookFigure() {
  const [look, setLook] = useState('Blue hour');
  const sw = LOOK_SWATCHES[look] ?? [];
  return (
    <div class="acad-fig">
      <div class="acad-swatches" aria-label={`${look}: its colours`} role="img">
        {sw.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
      </div>
      <LookCards value={look} set={setLook} />
    </div>
  );
}

function PromptFigure() {
  const [i, setI] = useState(0);
  const e = EXAMPLES[i];
  const parts: Array<[string, string]> = [
    ['Subject', e.subject],
    ['Place', e.place],
    ['Light', e.light],
    ['Camera', e.camera],
  ];
  return (
    <div class="acad-fig">
      <ol class="acad-parts">
        {parts.map(([k, v], n) => (
          <li key={k} style={{ '--i': n } as Record<string, number>}>
            <span class="mono">
              {String(n + 1).padStart(2, '0')} · {k}
            </span>
            <span>{v}</span>
          </li>
        ))}
      </ol>
      <p class="acad-says">
        <span class="mono">Prompt</span> {parts.map(([, v]) => v).join(', ')}.
      </p>
      <button type="button" class="btn btn-sm btn-ghost" onClick={() => setI((i + 1) % EXAMPLES.length)}>
        <PxIcon name="refresh" size={12} />
        Another example
      </button>
    </div>
  );
}

function ModelsFigure() {
  return (
    <div class="acad-fig">
      <div class="acad-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Makes</th>
              <th scope="col">Speed</th>
              <th scope="col">License</th>
            </tr>
          </thead>
          <tbody>
            {MODELS.map((m) => (
              <tr key={m.id}>
                <td>
                  <b>{m.name}</b>
                  <small>{m.note}</small>
                </td>
                <td>{m.kind === 'edit' ? 'edits' : m.kind === 'image' ? 'stills' : 'video'}</td>
                <td>
                  <span class={cx('acad-tier', `is-${speedTier(m.speed)}`)}>{speedTier(m.speed)}</span>
                </td>
                <td>
                  <a href={m.license.url} target="_blank" rel="noopener noreferrer">
                    {m.license.name}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CostFigure() {
  const [model, setModel] = useState('ltx-video');
  const [secs, setSecs] = useState('5');
  const [res, setRes] = useState('720p');
  const { lengths, seconds, estimate: e } = costView(model, Number(secs), res);
  const most = costCeiling();
  return (
    <div class="acad-fig">
      <div class="acad-row">
        <Select label="Model" value={model} onChange={setModel} options={VIDEO_MODELS.map((m) => ({ value: m.id, label: m.name }))} icon="cube" />
        <Segmented label="Length" value={String(seconds)} onChange={setSecs} options={lengths.map((s) => ({ value: String(s), label: `${s} s` }))} size="sm" />
        <Segmented label="Resolution" value={res} onChange={setRes} options={['720p', '1080p']} size="sm" />
      </div>
      <div class="acad-cost">
        <Estimate runtime={e.runtime} credits={e.credits} />
        <span class="pxbar set-bar" aria-hidden="true" style={{ '--p': `${Math.max(2, (e.credits / most.estimate.credits) * 100)}%` } as Record<string, string>}>
          <i />
        </span>
        <small>
          The bar is out of the most expensive clip here: {most.estimate.credits} credits for {most.seconds} s of {most.model.name} at 1080p.
        </small>
      </div>
    </div>
  );
}

function GraphFigure() {
  const ctx = { assets: liveAssets.value, cast: cast.value };
  const v = defaultsFor('cinematic', ctx);
  const built = buildFor('cinematic', v, ctx);
  const graphs = graphsFor('cinematic', v, built, ctx);
  if (!graphs.length) return null;
  return (
    <div class="acad-fig acad-graph">
      <ComfyPanel graphs={graphs} view="graph" tool="cinematic" />
    </div>
  );
}

function FilesFigure() {
  const names = settings.value.files;
  return (
    <div class="acad-fig">
      {FOLDERS.map((folder) => (
        <div key={folder} class="acad-folder">
          <span class="mono">ComfyUI/models/{folder}</span>
          <ul>
            {MODEL_FILES.filter((f) => f.folder === folder).map((f) => (
              <li key={f.id}>
                <code class="mono">{names[f.id]?.trim() || f.id}</code>
                <small>
                  {f.role} · {f.usedBy.join(', ')}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const FIGURES = {
  sizes: SizesFigure,
  moves: MovesFigure,
  optics: OpticsFigure,
  frame: FrameFigure,
  look: LookFigure,
  prompt: PromptFigure,
  models: ModelsFigure,
  cost: CostFigure,
  graph: GraphFigure,
  files: FilesFigure,
} satisfies Record<NonNullable<Lesson['figure']>, () => preact.JSX.Element | null>;

/* ------------------------------------------------------------------ */
/* Quiz and lesson                                                     */
/* ------------------------------------------------------------------ */

function Quiz({ lesson, onPass }: { lesson: Lesson; onPass: () => void }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const right = lesson.quiz.filter((q, i) => picked[i] === q.answer).length;
  const all = right === lesson.quiz.length;
  useEffect(() => {
    if (all) onPass();
  }, [all]);
  return (
    <section class="acad-quiz" aria-labelledby={`quiz-${lesson.id}`}>
      <header class="acad-quiz-head">
        <h3 id={`quiz-${lesson.id}`}>Check yourself</h3>
        <span class="mono">
          {right} of {lesson.quiz.length} right
        </span>
      </header>
      {lesson.quiz.map((q, i) => {
        const chose = picked[i];
        const ok = chose === q.answer;
        return (
          <fieldset key={q.q} class="acad-q">
            <legend>{q.q}</legend>
            <div class="acad-opts">
              {q.options.map((o, j) => (
                <button
                  key={o}
                  type="button"
                  class={cx('acad-opt', chose === j && (j === q.answer ? 'is-right' : 'is-wrong'))}
                  aria-pressed={chose === j}
                  disabled={ok && chose !== j}
                  onClick={() => setPicked({ ...picked, [i]: j })}
                >
                  {o}
                </button>
              ))}
            </div>
            {chose !== undefined && (
              <p class={cx('acad-why', ok ? 'is-right' : 'is-wrong')} role="status">
                <b>{ok ? 'Right.' : 'Not quite.'}</b> {ok ? q.why : 'Try another answer.'}
              </p>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}

function tryIt(t: TryIt) {
  if ('settings' in t) return go({ view: 'settings', section: t.settings });
  if ('assets' in t) return go({ view: 'assets' });
  for (const [k, v] of Object.entries(t.values ?? {})) setDraft(t.tool, k, v);
  go({ view: 'tool', tool: t.tool });
}

function Reader({ lesson, next, onOpen }: { lesson: Lesson; next?: Lesson; onOpen: (id: string) => void }) {
  const done = settings.value.lessonsDone.includes(lesson.id);
  const track = TRACKS.find((t) => t.id === lesson.track)!;
  const n = LESSONS.indexOf(lesson) + 1;
  const Figure = lesson.figure ? FIGURES[lesson.figure] : null;
  const mark = (on: boolean) => {
    const list = settings.value.lessonsDone;
    if (on === list.includes(lesson.id)) return;
    patchSettings({ lessonsDone: on ? [...list, lesson.id] : list.filter((d) => d !== lesson.id) });
  };
  return (
    <article class="reader acad-reader" key={lesson.id} aria-labelledby="lesson-title">
      <span class="reader-n mono">
        {track.name} · Lesson {String(n).padStart(2, '0')} · {lesson.minutes} min
      </span>
      <h2 id="lesson-title">{lesson.title}</h2>
      <p class="reader-sum">{lesson.summary}</p>
      <div class="acad-body">
        {lesson.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {Figure && <Figure />}
      <ol class="reader-points" aria-label="Remember">
        {lesson.points.map((p, i) => (
          <li key={i} style={{ '--i': i } as Record<string, number>}>
            <span class="mono">{String(i + 1).padStart(2, '0')}</span>
            {p}
          </li>
        ))}
      </ol>
      {lesson.tryIt && (
        <div class="acad-try">
          <span>
            <b>Try it</b>
            <small>Opens the studio set up for this lesson.</small>
          </span>
          <button type="button" class="btn btn-accent" onClick={() => tryIt(lesson.tryIt!)}>
            <PxIcon name="play" size={12} />
            {lesson.tryIt.label}
          </button>
        </div>
      )}
      <Quiz
        key={lesson.id}
        lesson={lesson}
        onPass={() => {
          if (settings.value.lessonsDone.includes(lesson.id)) return;
          mark(true);
          toast({ title: 'Lesson done', body: `${lesson.title}${next ? ` · next: ${next.title}` : ''}` });
        }}
      />
      <div class="reader-actions">
        <button type="button" class={cx('btn', done ? 'btn-ghost' : 'btn-primary')} aria-pressed={done} onClick={() => mark(!done)}>
          <PxIcon name="check" size={13} />
          {done ? 'Done' : 'Mark as done'}
        </button>
        {next && (
          <button type="button" class="btn btn-ghost" onClick={() => onOpen(next.id)}>
            Next: {next.title}
            <PxIcon name="arrow-right" size={12} />
          </button>
        )}
      </div>
    </article>
  );
}

function Glossary({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => GLOSSARY.filter((t) => !needle || `${t.term} ${t.says}`.toLowerCase().includes(needle)), [needle]);
  return (
    <section class="acad-gloss" aria-label="Glossary">
      <label class="search acad-search">
        <PxIcon name="search" size={14} />
        <span class="sr-only">Find a word</span>
        <input type="search" placeholder={`Find one of ${GLOSSARY.length} words`} value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <dl class="acad-terms">
        {list.map((t) => {
          const lesson = t.lesson ? lessonById(t.lesson) : undefined;
          return (
            <div key={t.term} class="acad-term">
              <dt>{t.term}</dt>
              <dd>
                {t.says}
                {lesson && (
                  <button type="button" class="acad-term-link" onClick={() => onOpen(lesson.id)}>
                    Lesson: {lesson.title} →
                  </button>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {!list.length && <p class="empty-note">No word matches “{q}”.</p>}
    </section>
  );
}

export function Academy() {
  const done = settings.value.lessonsDone;
  const [tab, setTab] = useState<'lessons' | 'glossary'>('lessons');
  const [open, setOpen] = useState(LESSONS.find((l) => !done.includes(l.id))?.id ?? LESSONS[0].id);
  // a deep link opens one lesson: /app/tools/academy/?lesson=lenses
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('lesson');
    if (id && lessonById(id)) setOpen(id);
  }, []);
  const show = (id: string) => {
    setOpen(id);
    setTab('lessons');
    history.replaceState(null, '', `${location.pathname}?lesson=${id}`);
    document.querySelector('.main .ws')?.scrollTo({ top: 0 });
  };
  const lesson = lessonById(open) ?? LESSONS[0];
  const next = LESSONS[LESSONS.indexOf(lesson) + 1];
  const total = LESSONS.reduce((s, l) => s + l.minutes, 0);
  const count = LESSONS.filter((l) => done.includes(l.id)).length;
  return (
    <div class="acad">
      <div class="acad-bar">
        <Segmented
          label="Academy"
          value={tab}
          onChange={(v) => setTab(v as 'lessons' | 'glossary')}
          options={[
            { value: 'lessons', label: `Lessons · ${LESSONS.length}` },
            { value: 'glossary', label: `Glossary · ${GLOSSARY.length}` },
          ]}
        />
        <span class="acad-progress mono">
          {count} of {LESSONS.length} done · {total} min in all
          <span class="pxbar" aria-hidden="true">
            {LESSONS.map((l) => (
              <i key={l.id} class={done.includes(l.id) ? 'on' : undefined} />
            ))}
          </span>
        </span>
      </div>
      {tab === 'glossary' ? (
        <Glossary onOpen={show} />
      ) : (
        <div class="academy">
          <aside class="lessons" aria-label="Lessons">
            {TRACKS.map((t) => (
              <section key={t.id} class="acad-track">
                <h3 class="mono">{t.name}</h3>
                <ol>
                  {LESSONS.filter((l) => l.track === t.id).map((l) => (
                    <li key={l.id}>
                      <button type="button" class={cx('lesson', l.id === lesson.id && 'is-on', done.includes(l.id) && 'is-done')} aria-current={l.id === lesson.id ? 'step' : undefined} onClick={() => show(l.id)}>
                        <span class="lesson-n mono">{done.includes(l.id) ? <PxIcon name="check" size={12} /> : String(LESSONS.indexOf(l) + 1).padStart(2, '0')}</span>
                        <span class="lesson-text">
                          <b>{l.title}</b>
                          <small class="mono">{l.minutes} min</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </aside>
          <Reader lesson={lesson} next={next} onOpen={show} />
        </div>
      )}
    </div>
  );
}

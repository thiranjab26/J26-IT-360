import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { VoiceEvent } from "../hooks/useSpeech";
import portrait from "../assets/examiner.png";

/*
 * The 3D examiner: the Avaturn sample avatar (non-commercial use) animated
 * by TalkingHead (MIT, github.com/met4citizen/TalkingHead), both loaded from jsDelivr at fixed
 * versions. The real question voice plays as before; the avatar mouths the same words silently, timed
 * to the clip, so the lips move with it. Its face never reacts to whether an answer is right.
 * Without WebGL, or when the files cannot load, the still portrait stays.
 */
const THREE = "https://cdn.jsdelivr.net/npm/three@0.180.0/";
const TALKINGHEAD = "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs";
const AVATAR = "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@2afe6d79779313db8909badebf46f9805a6c7b70/avatars/avaturn.glb";

export type ExaminerState = "idle" | "speaking" | "listening" | "thinking" | "nodding";
type Head = {
  showAvatar(o: object): Promise<void>;
  speakAudio(o: object): void;
  stopSpeaking(): void;
  makeEyeContact(ms: number): void;
  lookAhead(ms: number): void;
  speakWithHands(delay?: number, prob?: number): void;
  playGesture(name: string, dur?: number, mirror?: boolean, ms?: number): void;
  setView(view: string, opt?: object): void;
  lookAt(x: number, y: number, ms: number): void;
  start(): void;
  stop(): void;
  audioCtx: AudioContext;
  isSpeaking: boolean;
};

// One examiner per page (browsers limit 3D contexts), moved into whichever card shows it.
let shared: Promise<{ head: Head; node: HTMLDivElement }> | null = null;

function examiner(box: HTMLElement) {
  shared ??= (async () => {
    if (!document.createElement("canvas").getContext("webgl2")) throw new Error("No WebGL");
    if (!document.querySelector("script[data-viva-three]")) {
      const map = document.createElement("script");
      map.type = "importmap";
      map.dataset.vivaThree = "";
      map.textContent = JSON.stringify({ imports: { three: `${THREE}build/three.module.js/+esm`, "three/addons/": `${THREE}examples/jsm/` } });
      document.head.append(map);
    }
    const { TalkingHead } = await import(/* @vite-ignore */ TALKINGHEAD);
    const node = document.createElement("div");
    node.className = "ex-3d-stage";
    box.append(node);
    const head: Head = new TalkingHead(node, {
      lipsyncModules: ["en"],
      cameraView: "upper",
      cameraDistance: 0.25,
      cameraY: 0.22,
      cameraRotateEnable: false,
      cameraPanEnable: false,
      cameraZoomEnable: false,
      avatarIdleEyeContact: 0.85,
      avatarSpeakingEyeContact: 0.9,
    });
    await head.showAvatar({ url: AVATAR, body: "F", avatarMood: "neutral", lipsyncLang: "en" });
    return { head, node };
  })();
  return shared;
}

// Camera framing per place: the viva card shows her upper body; the round start-page picture, her face.
const VIEWS = { upper: { cameraDistance: 0.25, cameraY: 0.22 }, head: { cameraDistance: 0.3 } };

let gestures = 0; // alternates the hand used for the explaining gesture

/**
 * Word start times and lengths. Longer words and punctuation take longer; with the clip's voiced
 * stretches, words are laid only over the parts that have sound, so the lips rest in its pauses.
 */
function mouth(head: Head, text: string, seconds: number, voiced?: [number, number][]) {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[,.;:?!]$/.test(w) ? 2 : 0));
  const spans = voiced?.length ? voiced : [[0, seconds] as [number, number]];
  const sound = spans.reduce((a, [s, e]) => a + (e - s), 0);
  const unit = sound / weights.reduce((a, b) => a + b, 0);
  // Voiced time (seconds of sound so far) to clip time.
  const at = (v: number) => {
    for (const [s, e] of spans) {
      if (v <= e - s) return s + v;
      v -= e - s;
    }
    return spans[spans.length - 1]![1];
  };
  let v = 0;
  const wtimes: number[] = [],
    wdurations: number[] = [];
  for (const w of weights) {
    const start = at(v),
      end = at(v + w * unit);
    wtimes.push(start * 1000);
    wdurations.push(Math.max(80, Math.min(end - start, w * unit * 1.4) * 1000 * 0.9));
    v += w * unit;
  }
  const ctx = head.audioCtx;
  const audio = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * seconds)), ctx.sampleRate); // silent: the real voice plays elsewhere
  head.speakAudio({ audio, words, wtimes, wdurations });
  // Hands: natural movement through the question, and sometimes an explaining finger at the start.
  // Never thumbs-up, "OK" or thumbs-down: the examiner must not look like it judges an answer.
  head.speakWithHands(200, 1);
  if (seconds > 4) window.setTimeout(() => head.isSpeaking && head.speakWithHands(0, 0.8), (seconds * 1000) / 2);
  if (Math.random() < 0.6) head.playGesture("index", 2, gestures++ % 2 === 1, 800);
}

export function Examiner({
  state,
  voice,
  view = "upper",
  follow = false,
  className = "",
}: {
  state: ExaminerState;
  voice?: MutableRefObject<((e: VoiceEvent) => void) | null>;
  view?: keyof typeof VIEWS;
  /** Look towards the pointer (start pages only; in the viva she looks at the student). */
  follow?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<Head | null>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let mounted = true;
    examiner(box.current!)
      .then(({ head: h, node }) => {
        if (!mounted || !box.current) return;
        box.current.append(node); // moves it here if another card showed it before
        h.start();
        h.setView(view, VIEWS[view]);
        head.current = h;
        setLive(true);
      })
      .catch(() => undefined); // the portrait stays
    return () => {
      mounted = false;
      head.current?.stopSpeaking();
      head.current?.stop();
      head.current = null;
    };
  }, []);
  useEffect(() => {
    if (!follow) return;
    // A gentle follow: the point is kept near her face, so a pointer far below never makes her look down.
    const clamp = (v: number, c: number, r: number) => Math.max(c - r, Math.min(c + r, v));
    const move = (e: PointerEvent) => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      head.current?.lookAt(clamp(e.clientX, cx, 160), clamp(e.clientY, cy, 30), 800);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [follow]);
  useEffect(() => {
    if (!voice) return;
    voice.current = (e) => {
      const h = head.current;
      if (!h) return;
      if (e) mouth(h, e.text, e.seconds, e.voiced);
      else h.stopSpeaking();
    };
    return () => {
      voice.current = null;
    };
  }, [voice]);
  useEffect(() => {
    const h = head.current;
    if (!h) return;
    if (state === "listening") {
      h.makeEyeContact(60000);
      h.playGesture("🙂", 3); // a soft, attentive smile while the student answers
    } else if (state === "thinking") {
      h.lookAhead(2500); // a short look away while the answer is marked; the hand-to-chin gesture clipped through the face
    } else if (state === "nodding") {
      h.playGesture("yes", 1); // the same small nod after every answer
      h.makeEyeContact(10000);
    } else if (state === "idle") h.makeEyeContact(20000);
  }, [state, live]);
  const label = {
    idle: "Examiner is waiting",
    speaking: "Examiner is asking a question",
    listening: "Examiner is listening",
    thinking: "Examiner is thinking",
    nodding: "Examiner acknowledges your answer",
  }[state];
  return (
    <div className={`ex ${className} is-${state} ${live ? "is-live" : ""}`} role="img" aria-label={label}>
      <img className="ex-portrait" src={portrait} alt="" />
      <div className="ex-3d" ref={box} />
    </div>
  );
}

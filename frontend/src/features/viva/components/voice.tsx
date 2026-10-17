import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Mic } from "./icons";

/** Loudness from 0 to 1 of what an analyser hears right now (RMS of the waveform, scaled for speech). */
function loudness(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += ((v - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / buffer.length) * 4.5);
}

/**
 * Calls draw(level) on every animation frame while active, outside React state so it stays
 * smooth. `simulate` moves gently when there is nothing to measure (the browser voice).
 */
export function useLevel(
  source: () => AnalyserNode | null,
  active: boolean,
  draw: (level: number, time: number) => void,
  simulate = false,
) {
  const latest = useRef({ source, draw });
  latest.current = { source, draw };
  useEffect(() => {
    let frame = 0,
      smooth = 0,
      buffer: Uint8Array<ArrayBuffer> | null = null;
    const tick = (time: number) => {
      const analyser = active ? latest.current.source() : null;
      let raw = 0;
      if (analyser) {
        if (buffer?.length !== analyser.fftSize) buffer = new Uint8Array(analyser.fftSize);
        raw = loudness(analyser, buffer);
      } else if (active && simulate) raw = 0.3 + 0.3 * Math.abs(Math.sin(time / 140) * Math.sin(time / 410));
      smooth += (raw - smooth) * (raw > smooth ? 0.55 : 0.18); // fast attack, slow release
      latest.current.draw(smooth, time);
      if (active || smooth > 0.005) frame = requestAnimationFrame(tick);
      else latest.current.draw(0, time);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, simulate]);
}

const STEP = 5; // px per bar: 3 px bar, 2 px gap
const SAMPLE_MS = 45;

/** A scrolling bar waveform of a live sound: the student's microphone or the examiner's voice. */
export function VoiceWave({
  source,
  active,
  simulate = false,
  className = "",
}: {
  source: () => AnalyserNode | null;
  active: boolean;
  simulate?: boolean;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ history: [] as number[], last: 0, color: "" });
  useEffect(() => {
    state.current.color = ""; // the colour follows the CSS state (recording, idle)
    if (!active) state.current.history = [];
  }, [active]);
  useLevel(
    source,
    active,
    (level, time) => {
      const c = canvas.current;
      if (!c) return;
      const s = state.current;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth,
        h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      if (!s.color) s.color = getComputedStyle(c).color;
      const bars = Math.floor(w / STEP);
      if (time - s.last >= SAMPLE_MS) {
        s.history.push(level);
        s.last = time;
        if (s.history.length > bars) s.history.splice(0, s.history.length - bars);
      }
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = s.color;
      for (let i = 0; i < bars; i++) {
        const v = s.history[s.history.length - bars + i] ?? 0;
        const bh = Math.max(3, v * (h - 2));
        const x = i * STEP;
        g.globalAlpha = v ? 0.55 + 0.45 * v : 0.28;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, (h - bh) / 2, 3, bh, 1.5);
        else g.rect(x, (h - bh) / 2, 3, bh);
        g.fill();
      }
    },
    simulate,
  );
  return <canvas ref={canvas} className={`st-wave ${className}`} aria-hidden="true" />;
}

type Rig = { stream: MediaStream; ctx: AudioContext; analyser: AnalyserNode };

/** Before the viva: say a few words, see the wave move, get a tick. Releases the mic afterwards. */
export function MicCheck() {
  const [state, setState] = useState<"idle" | "listening" | "quiet" | "ok" | "error">("idle");
  const [open, setOpen] = useState(false);
  const rig = useRef<Rig | null>(null);
  const heard = useRef(0);
  const stop = () => {
    rig.current?.stream.getTracks().forEach((t) => t.stop());
    void rig.current?.ctx.close();
    rig.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (state === "ok") {
      const t = setTimeout(() => {
        stop(); // keep the wave a moment, then free the microphone
        setOpen(false);
      }, 2500);
      return () => clearTimeout(t);
    }
    if (state === "listening") {
      const t = setTimeout(() => setState("quiet"), 8000);
      return () => clearTimeout(t);
    }
  }, [state]);
  async function test() {
    stop();
    heard.current = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      rig.current = { stream, ctx, analyser };
      setOpen(true);
      setState("listening");
    } catch {
      setState("error");
    }
  }
  const live = open;
  useLevel(
    () => rig.current?.analyser ?? null,
    live,
    (level) => {
      if (state !== "listening" && state !== "quiet") return;
      heard.current = level > 0.15 ? heard.current + 1 : Math.max(0, heard.current - 1);
      if (heard.current > 10) setState("ok"); // about a sixth of a second of clear voice
    },
  );
  return (
    <div className="st-miccheck">
      {state === "idle" || state === "error" ? (
        <button className="st-btn st-btn-ghost" onClick={test}>
          <Mic size={16} /> Test your microphone
        </button>
      ) : (
        <VoiceWave className="st-mic-wave" source={() => rig.current?.analyser ?? null} active={live} />
      )}
      <span className={`st-small ${state === "ok" ? "st-ok" : "st-muted"}`} role="status">
        {state === "idle" && "Optional: check that we can hear you."}
        {state === "listening" && 'Say "hello" or count to five…'}
        {state === "quiet" && "We cannot hear you yet. Check the microphone is not muted, or speak a little louder."}
        {state === "ok" && (
          <>
            <CheckCircle2 size={16} /> Your microphone works.
          </>
        )}
        {state === "error" && "We could not open your microphone. Allow access in the browser, or type your answers."}
      </span>
      {state === "ok" && (
        <button className="st-link" onClick={test}>
          Test again
        </button>
      )}
    </div>
  );
}

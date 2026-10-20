import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, VIVA_API_URL } from "../api/client";
import type { AudioMetrics } from "../api/types";

/** Human label for a provider id such as "deepgram:nova-3:live" or "groq:whisper-large-v3-turbo". */
export function providerName(p?: string | null) {
  if (!p) return "";
  if (p === "browser") return "Browser voice";
  if (p === "faster_whisper_local") return "Local Whisper";
  const [vendor, model, live] = p.split(":");
  const name = vendor === "deepgram" ? "Deepgram" : vendor === "groq" ? "Groq" : vendor;
  return `${name} ${model ?? ""}${live === "live" ? " (live)" : ""}`.trim();
}

/** Tells the examiner's face when the question voice starts (words and length) and stops. */
export type VoiceEvent = { text: string; seconds: number; voiced?: [number, number][] } | null;
/** A command the student said on its own ("Stop the viva", "Skip this question"), or null. */
export type SpokenCommand = "stop" | "skip" | null;

/** Stretches of a clip that have sound (seconds), from 20 ms loudness frames; gaps under 0.12 s are joined. */
async function voicedStretches(ctx: BaseAudioContext, blob: Blob): Promise<[number, number][]> {
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const data = audio.getChannelData(0), frame = Math.round(audio.sampleRate * 0.02);
  const loud: number[] = [];
  for (let i = 0; i + frame <= data.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += data[j]! * data[j]!;
    loud.push(Math.sqrt(sum / frame));
  }
  const sorted = [...loud].sort((a, b) => a - b);
  const threshold = Math.max(0.01, 0.12 * (sorted[Math.floor(sorted.length * 0.95)] ?? 0));
  const spans: [number, number][] = [];
  loud.forEach((v, i) => {
    if (v < threshold) return;
    const t = i * 0.02, last = spans[spans.length - 1];
    if (last && t - last[1] < 0.12) last[1] = t + 0.02;
    else spans.push([t, t + 0.02]);
  });
  return spans;
}
export type Heard = { pauses: { char: number; ms: number }[]; fillers: { start_char: number; end_char: number }[] };

/** Code and maths said as words ("2 + 3 * 4" -> "2 plus 3 times 4"). Keep in step with SPOKEN in speech.py. */
const SPOKEN: [RegExp, string][] = [
  [/\bO\(\s*([^()]*?)\s*\)/g, "O of $1"],
  [/([A-Za-z0-9])\^2\b/g, "$1 squared"],
  [/([A-Za-z0-9])\^3\b/g, "$1 cubed"],
  [/([A-Za-z0-9])\^([A-Za-z0-9]+)/g, "$1 to the power $2"],
  [/\s*>=\s*/g, " is greater than or equal to "],
  [/\s*<=\s*/g, " is less than or equal to "],
  [/\s*==\s*/g, " equals "],
  [/\s*!=\s*/g, " is not equal to "],
  [/\s*>\s*/g, " is greater than "],
  [/\s*<\s*/g, " is less than "],
  [/\s*\*\s*/g, " times "],
  [/\s*\+\s*/g, " plus "],
  [/(?<=[\d)])\s*\/\s*(?=[\d(])/g, " divided by "],
  [/(?<=\w)\s+-\s+(?=\w)/g, " minus "],
  [/\s*=\s*/g, " equals "],
  [/([A-Za-z_]\w*)\[([^\]]+)\]/g, "$1 at index $2"],
  [/([A-Za-z_]\w*)\(\)/g, "$1"],
];

export function speakable(text: string) {
  let spoken = SPOKEN.reduce((t, [pattern, words]) => t.replace(pattern, words), text);
  for (let i = 0; i < 3; i++) spoken = spoken.replace(/([A-Za-z_]\w*)\(([^()]+)\)/g, "$1 of $2");
  return spoken.replace(/(?<=[A-Za-z_])\.(?=[A-Za-z_])/g, " dot ").replace(/\s+/g, " ").trim();
}

type Live = { ws: WebSocket; ready: boolean; complete: boolean; queue: Blob[]; finals: string; done: Promise<string> };

export function useSpeech(
  token: string,
  onTranscript: (text: string, metrics: AudioMetrics, latency: number | null, provider: string, heard: Heard, command: SpokenCommand) => void,
  topicId = "",
) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [hasRecording, setHasRecording] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [liveProvider, setLiveProvider] = useState("");
  const [voiceProvider, setVoiceProvider] = useState("");
  const live = useRef<Live | null>(null);
  const liveOff = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const upload = useRef<AbortController | null>(null);
  const saved = useRef<Blob | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const ttsEnd = useRef<number | null>(null);
  const recordingStart = useRef(0);
  // Live sound levels for the waveform and the examiner's mouth: the question audio and the mic.
  const meters = useRef<{ ctx: AudioContext | null; voice: AnalyserNode | null; mic: AnalyserNode | null }>({ ctx: null, voice: null, mic: null });
  const voiceEvents = useRef<((e: VoiceEvent) => void) | null>(null);
  const micSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContext = useCallback(() => {
    const m = meters.current;
    if (!m.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      m.ctx = new Ctx();
    }
    if (m.ctx.state === "suspended") void m.ctx.resume();
    return m.ctx;
  }, []);
  const release = useCallback(() => {
    clearInterval(timer.current);
    micSource.current?.disconnect();
    micSource.current = null;
    meters.current.mic = null;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
  }, []);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Chrome drops an utterance spoken straight after cancel(), and can stop one whose object was
  // garbage collected, so keep a reference and speak a moment after the previous one was cancelled.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // One voice per session: once the cloud voice has played, the browser voice is never mixed in;
  // the browser voice is used throughout only when the server has no cloud voice at all.
  const voiceLock = useRef<"cloud" | "browser" | null>(null);
  // Question audio already fetched in this tab, so "Listen again" plays instantly.
  const clips = useRef(new Map<string, { url: string; provider: string; voiced?: [number, number][] }>());
  const stopSpeaking = useCallback(() => {
    voiceEvents.current?.(null);
    utteranceRef.current = null;
    window.speechSynthesis?.cancel();
    audio.current?.pause();
    audio.current = null;
    meters.current.voice?.disconnect();
    meters.current.voice = null;
    setSpeaking(false);
  }, []);
  const closeLive = useCallback(() => {
    live.current?.ws.close();
    live.current = null;
  }, []);
  const reset = useCallback(() => {
    generation.current++;
    closeLive(); setLiveText(""); setLiveProvider("");
    upload.current?.abort();
    upload.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    release(); stopSpeaking();
    saved.current = null; ttsEnd.current = null; pending.current = false;
    setRecording(false); setStarting(false); setTranscribing(false);
    setHasRecording(false); setSpeechError(""); setSeconds(0); setRetryAt(0);
  }, [release, stopSpeaking, closeLive]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; generation.current++;
      live.current?.ws.close();
      upload.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      release(); window.speechSynthesis?.cancel();
      void meters.current.ctx?.close();
      meters.current = { ctx: null, voice: null, mic: null };
    };
  }, [release, token]);
  const browserSpeak = useCallback((text: string, version: number, rate = 1) => {
    if (!window.speechSynthesis) { setSpeechError("Question audio is unavailable. Read the question on screen."); return; }
    const utterance = new SpeechSynthesisUtterance(speakable(text));
    utteranceRef.current = utterance;
    utterance.rate = rate < 1 ? 0.7 : 0.95;
    // Prefer a natural female English voice; fall back to any female, then the default voice.
    const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
    const female = /female|aria|jenny|zira|samantha|libby|sonia|natasha|michelle|emma|ava|clara|ana\b|susan|hazel|google uk english female/i;
    utterance.voice = voices.find(v => female.test(v.name) && /natural|neural|online/i.test(v.name)) || voices.find(v => female.test(v.name)) || voices.find(v => v.default) || null;
    setVoiceProvider("browser");
    utterance.onstart = () => {
      if (!alive.current || version !== generation.current) return;
      setSpeaking(true);
      // The browser voice gives no length; about 0.38 s a word at normal speed is close enough for the lips.
      voiceEvents.current?.({ text, seconds: (text.split(/\s+/).length * 0.38) / (rate < 1 ? 0.74 : 1) });
    };
    utterance.onend = () => {
      if (!alive.current || version !== generation.current) return;
      ttsEnd.current = performance.now(); setSpeaking(false);
      voiceEvents.current?.(null);
    };
    utterance.onerror = () => { if (alive.current && version === generation.current) setSpeaking(false); };
    window.speechSynthesis.cancel();
    setTimeout(() => {
      if (alive.current && version === generation.current && utteranceRef.current === utterance) window.speechSynthesis.speak(utterance);
    }, 150);
  }, []);
  const fetchClip = useCallback(async (text: string) => {
    const cached = clips.current.get(text);
    if (cached) return cached;
    const response = await fetch(`${VIVA_API_URL}/speech/synthesize`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(/not configured/i.test(detail) ? "not configured" : "cloud voice failed");
    }
    const blob = await response.blob();
    const clip: { url: string; provider: string; voiced?: [number, number][] } = {
      url: URL.createObjectURL(blob),
      provider: response.headers.get("X-Voice-Provider") || "cloud",
    };
    try {
      // Decoding needs no sound output, so a small offline context is enough.
      clip.voiced = await voicedStretches(new OfflineAudioContext(1, 1, 24000), blob);
    } catch {
      clip.voiced = undefined; // the lips then spread the words evenly
    }
    if (clips.current.size >= 20) {
      const [oldest, old] = clips.current.entries().next().value!;
      URL.revokeObjectURL(old.url); clips.current.delete(oldest);
    }
    clips.current.set(text, clip);
    return clip;
  }, [token]);
  /** Read the question aloud; rate below 1 replays it more slowly in the same voice. */
  const speak = useCallback(async (text: string, rate = 1) => {
    stopSpeaking(); ttsEnd.current = null; setSpeechError("");
    const version = generation.current;
    const current = () => alive.current && version === generation.current;
    if (voiceLock.current !== "browser") {
      let clip: { url: string; provider: string; voiced?: [number, number][] } | null = null;
      for (let attempt = 0; attempt < 2 && !clip; attempt++) {
        try {
          clip = await fetchClip(text);
        } catch (error) {
          if ((error as Error).message === "not configured" && voiceLock.current === null) break;
          if (attempt === 0) await new Promise(r => setTimeout(r, 900));
        }
        if (!current()) return;
      }
      if (clip) {
        voiceLock.current = "cloud";
        setVoiceProvider(clip.provider);
        const player = new Audio(clip.url);
        player.playbackRate = rate; // the pitch is kept, so it is the same voice, only slower
        audio.current = player;
        const ctx = audioContext();
        meters.current.voice = null;
        // Route through the analyser only when audio is already running, or the clip would be silent.
        if (ctx?.state === "running") {
          try {
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            ctx.createMediaElementSource(player).connect(analyser);
            analyser.connect(ctx.destination);
            meters.current.voice = analyser;
          } catch { meters.current.voice = null; }
        }
        player.onplay = () => { if (current()) setSpeaking(true); };
        // "playing" (not "play") fires when sound starts, once the clip's length is known.
        player.onplaying = () => {
          if (current() && Number.isFinite(player.duration))
            voiceEvents.current?.({ text, seconds: player.duration / rate, voiced: clip.voiced?.map(([a, b]) => [a / rate, b / rate]) });
        };
        player.onended = () => {
          if (!current()) return;
          ttsEnd.current = performance.now(); setSpeaking(false);
          voiceEvents.current?.(null);
        };
        player.onerror = () => setSpeaking(false);
        try { await player.play(); } catch {
          if (current()) { setSpeaking(false); setSpeechError("Press Listen again to hear the question."); }
        }
        return;
      }
      if (voiceLock.current === "cloud") {
        if (current()) setSpeechError("The examiner's voice did not load. Read the question on screen, or press Listen again.");
        return;
      }
      voiceLock.current = "browser";
    }
    if (current()) browserSpeak(text, version, rate);
  }, [stopSpeaking, browserSpeak, fetchClip, audioContext]);
  // Stream audio to Deepgram through the backend; resolves "" when live text is unavailable.
  function openLive(version: number) {
    if (liveOff.current) return;
    let ws: WebSocket;
    try { ws = new WebSocket(VIVA_API_URL.replace(/^http/, "ws") + "/speech/live"); } catch { return; }
    let resolve: (text: string) => void = () => {};
    const state: Live = { ws, ready: false, complete: false, queue: [], finals: "", done: new Promise(r => { resolve = r; }) };
    const finish = () => resolve(state.complete ? state.finals.trim() : "");
    live.current = state;
    ws.onopen = () => ws.send(JSON.stringify({ token, topic_id: topicId }));
    ws.onmessage = event => {
      const m = JSON.parse(event.data);
      const current = alive.current && version === generation.current;
      if (m.type === "ready") {
        state.ready = true;
        state.queue.forEach(b => ws.send(b)); state.queue = [];
        if (current) setLiveProvider(m.provider);
      } else if (m.type === "transcript") {
        if (m.final && m.text) state.finals += " " + m.text;
        if (current) setLiveText((state.finals + (m.final ? "" : " " + m.text)).trim());
      } else if (m.type === "closed") { state.complete = true; finish(); }
      else if (m.type === "error") {
        state.ready = false; finish();
        if (current) setLiveProvider("");
        // Deepgram is switched off on the server: stop trying for this tab.
        if (/not configured/.test(m.message)) liveOff.current = true;
      }
    };
    ws.onclose = finish;
  }
  async function stopLive() {
    const state = live.current;
    if (!state) return "";
    if (state.ready && state.ws.readyState === WebSocket.OPEN) state.ws.send("stop");
    const text = await Promise.race([state.done, new Promise<string>(r => setTimeout(() => r(""), 6000))]);
    state.ws.close();
    if (live.current === state) live.current = null;
    return text;
  }
  async function transcribe(blob: Blob, version: number, liveTranscript = "") {
    if (upload.current) return;
    if (Date.now() < retryAt) { setSpeechError(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before retrying.`); return; }
    setSpeechError(""); setTranscribing(true);
    const controller = new AbortController(); upload.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120000);
    const form = new FormData();
    form.append("audio", blob, blob.type.includes("mp4") ? "answer.mp4" : "answer.webm");
    if (liveTranscript) form.append("live_transcript", liveTranscript);
    if (topicId) form.append("topic_id", topicId); // course words help the transcriber hear "float", not "bloat"
    try {
      const result = await api<{
        transcript: string; metrics: AudioMetrics; provider: string;
        speech_intervals?: { start: number; end: number }[];
        pause_marks?: Heard["pauses"]; lexical_metrics?: { filler_events?: Heard["fillers"] };
        command?: SpokenCommand;
      }>(
        "/speech/transcribe", token, form, "POST", controller.signal);
      if (!alive.current || version !== generation.current) return;
      const onset = result.speech_intervals?.[0]?.start;
      const latency = onset !== undefined ? Math.max(0, Math.round(onset * 1000)) : null;
      callback.current(result.transcript, result.metrics, latency, result.provider, {
        pauses: result.pause_marks ?? [], fillers: result.lexical_metrics?.filler_events ?? [],
      }, result.command ?? null);
      saved.current = null; setHasRecording(false);
    } catch (error) {
      if (!alive.current || version !== generation.current) return;
      if (error instanceof ApiError && error.retryAfter) setRetryAt(Date.now() + error.retryAfter * 1000);
      setSpeechError((controller.signal.aborted ? "Transcription timed out." : (error as Error).message) + " Your recording is kept in this tab. Retry or type your answer.");
    } finally {
      clearTimeout(timeout);
      if (upload.current === controller) upload.current = null;
      if (alive.current && version === generation.current) setTranscribing(false);
    }
  }
  async function start() {
    if (pending.current || upload.current || recorder.current?.state === "recording") return;
    pending.current = true; setStarting(true); setSpeechError("");
    const version = ++generation.current;
    stopSpeaking();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Recording needs a supported browser on HTTPS or localhost.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (!alive.current || version !== generation.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const ctx = audioContext();
      if (ctx) {
        try {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          micSource.current = ctx.createMediaStreamSource(media);
          micSource.current.connect(analyser); // not to the speakers: no echo
          meters.current.mic = analyser;
        } catch { meters.current.mic = null; }
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(x => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(media, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = e => {
        if (!e.data.size) return;
        chunks.push(e.data);
        const state = live.current;
        if (state?.ready && state.ws.readyState === WebSocket.OPEN) state.ws.send(e.data);
        else if (state && state.ws.readyState <= WebSocket.OPEN) state.queue.push(e.data);
      };
      rec.onerror = () => {
        if (alive.current && version === generation.current) { generation.current++; pending.current = false; setStarting(false); setSpeechError("Recording failed. Check the microphone or type your answer."); release(); setRecording(false); }
      };
      rec.onstop = () => {
        if (!alive.current || version !== generation.current) return;
        release(); setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (!blob.size) { closeLive(); setSpeechError("The recording was empty. Try again."); return; }
        saved.current = blob; setHasRecording(true); setTranscribing(true);
        void stopLive().then(text => { if (alive.current && version === generation.current) void transcribe(blob, version, text); });
      };
      saved.current = null; setHasRecording(false); setSeconds(0); setLiveText("");
      openLive(version);
      recordingStart.current = performance.now();
      // Short slices keep the live transcript close to real time.
      rec.start(250); setRecording(true);
      timer.current = setInterval(() => {
        const elapsed = Math.floor((performance.now() - recordingStart.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 175 && rec.state === "recording") rec.stop();
      }, 250);
    } catch (error) {
      release();
      if (alive.current && version === generation.current) setSpeechError((error as Error).message + " You can type your answer.");
    } finally {
      if (version === generation.current) { pending.current = false; setStarting(false); }
    }
  }
  function stop() { if (recorder.current?.state === "recording") recorder.current.stop(); }
  function retry() { if (saved.current && !pending.current && recorder.current?.state !== 'recording') void transcribe(saved.current, generation.current); }
  // Call from a click (for example "Start the viva") so browsers allow the audio meters to run.
  const prime = useCallback(() => { audioContext(); }, [audioContext]);
  return { recording, starting, transcribing, speaking, speechError, hasRecording, seconds, liveText, liveProvider, voiceProvider, meters, voiceEvents, start, stop, retry, speak, reset, stopSpeaking, prime };
}

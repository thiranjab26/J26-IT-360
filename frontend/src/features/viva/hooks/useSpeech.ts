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

export type Heard = { pauses: { char: number; ms: number }[]; fillers: { start_char: number; end_char: number }[] };

type Live = { ws: WebSocket; ready: boolean; complete: boolean; queue: Blob[]; finals: string; done: Promise<string> };

export function useSpeech(
  token: string,
  onTranscript: (text: string, metrics: AudioMetrics, latency: number | null, provider: string, heard: Heard) => void,
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
  const release = useCallback(() => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
  }, []);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cloudVoice = useRef(true);
  // Question audio already fetched in this tab, so "Listen again" plays instantly.
  const clips = useRef(new Map<string, { url: string; provider: string }>());
  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    audio.current?.pause();
    audio.current = null;
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
    };
  }, [release, token]);
  const browserSpeak = useCallback((text: string, version: number) => {
    if (!window.speechSynthesis) { setSpeechError("Question audio is unavailable. Read the question on screen."); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    // Prefer a natural female English voice; fall back to any female, then the default voice.
    const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
    const female = /female|aria|jenny|zira|samantha|libby|sonia|natasha|michelle|emma|ava|clara|ana\b|susan|hazel|google uk english female/i;
    utterance.voice = voices.find(v => female.test(v.name) && /natural|neural|online/i.test(v.name)) || voices.find(v => female.test(v.name)) || voices.find(v => v.default) || null;
    setVoiceProvider("browser");
    utterance.onstart = () => { if (alive.current && version === generation.current) setSpeaking(true); };
    utterance.onend = () => {
      if (!alive.current || version !== generation.current) return;
      ttsEnd.current = performance.now(); setSpeaking(false);
    };
    utterance.onerror = () => { if (alive.current && version === generation.current) setSpeaking(false); };
    window.speechSynthesis.speak(utterance);
  }, []);
  const speak = useCallback(async (text: string) => {
    stopSpeaking(); ttsEnd.current = null;
    const version = generation.current;
    if (cloudVoice.current) {
      try {
        let clip = clips.current.get(text);
        if (!clip) {
          const response = await fetch(`${VIVA_API_URL}/speech/synthesize`, {
            method: "POST", signal: AbortSignal.timeout(20000),
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (!response.ok) throw new Error("cloud voice unavailable");
          clip = { url: URL.createObjectURL(await response.blob()), provider: response.headers.get("X-Voice-Provider") || "cloud" };
          if (clips.current.size >= 20) {
            const [oldest, old] = clips.current.entries().next().value!;
            URL.revokeObjectURL(old.url); clips.current.delete(oldest);
          }
          clips.current.set(text, clip);
        }
        setVoiceProvider(clip.provider);
        const url = clip.url;
        if (!alive.current || version !== generation.current) return;
        const player = new Audio(url);
        audio.current = player;
        player.onplay = () => { if (alive.current && version === generation.current) setSpeaking(true); };
        player.onended = () => {
          if (!alive.current || version !== generation.current) return;
          ttsEnd.current = performance.now(); setSpeaking(false);
        };
        player.onerror = () => setSpeaking(false);
        await player.play();
        return;
      } catch {
        // Stop asking the server for this tab once its voice is unavailable; use the browser voice.
        if (!audio.current) cloudVoice.current = false;
      }
    }
    if (alive.current && version === generation.current) browserSpeak(text, version);
  }, [token, stopSpeaking, browserSpeak]);
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
    try {
      const result = await api<{
        transcript: string; metrics: AudioMetrics; provider: string;
        speech_intervals?: { start: number; end: number }[];
        pause_marks?: Heard["pauses"]; lexical_metrics?: { filler_events?: Heard["fillers"] };
      }>(
        "/speech/transcribe", token, form, "POST", controller.signal);
      if (!alive.current || version !== generation.current) return;
      const onset = result.speech_intervals?.[0]?.start;
      const latency = onset !== undefined ? Math.max(0, Math.round(onset * 1000)) : null;
      callback.current(result.transcript, result.metrics, latency, result.provider, {
        pauses: result.pause_marks ?? [], fillers: result.lexical_metrics?.filler_events ?? [],
      });
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
  return { recording, starting, transcribing, speaking, speechError, hasRecording, seconds, liveText, liveProvider, voiceProvider, start, stop, retry, speak, reset, stopSpeaking };
}

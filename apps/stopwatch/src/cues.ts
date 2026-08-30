/**
 * Sound cues for the SplitSync Stopwatch (issue #227).
 *
 * Short synthesized beeps for start / stop / lap plus a distinct two-tone
 * target-time cue. Tones are generated in-memory as 16-bit PCM WAV data URIs
 * (no bundled audio assets) and played through `expo-audio`.
 *
 * Settings are persisted in AsyncStorage and are OFF by default.
 *
 * Background limitation (documented, best-effort): the audio session is
 * configured with `shouldPlayInBackground` + `playsInSilentMode`, but cue
 * scheduling runs on the JS timer loop, which the OS may suspend when the
 * app is backgrounded or the screen is locked. Cues are guaranteed while the
 * app is foregrounded (the stopwatch screens hold a keep-awake lock); when
 * backgrounded they fire only if the platform keeps the JS runtime alive.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { AudioPlayer } from "expo-audio";

// ── Settings ───────────────────────────────────────────────────────────────────

export interface CueSettings {
  /** Beeps on start / stop / lap. OFF by default. */
  soundEnabled: boolean;
  /** Single distinct beep when elapsed time crosses the target. OFF by default. */
  targetEnabled: boolean;
  /** Target time in milliseconds (mm:ss granularity in the UI). */
  targetMs: number;
}

export const DEFAULT_CUE_SETTINGS: CueSettings = {
  soundEnabled: false,
  targetEnabled: false,
  targetMs: 60_000,
};

const STORAGE_KEY = "cue_settings_v1";

export async function loadCueSettings(): Promise<CueSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CUE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CueSettings>;
    return {
      soundEnabled: parsed.soundEnabled === true,
      targetEnabled: parsed.targetEnabled === true,
      targetMs:
        typeof parsed.targetMs === "number" && parsed.targetMs > 0
          ? parsed.targetMs
          : DEFAULT_CUE_SETTINGS.targetMs,
    };
  } catch {
    return { ...DEFAULT_CUE_SETTINGS };
  }
}

export async function saveCueSettings(settings: CueSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: settings simply won't persist across launches.
  }
}

// ── WAV synthesis ──────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16_000;

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Minimal base64 encoder (React Native has no Buffer/btoa by default). */
function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 0x3f] : "=";
  }
  return out;
}

interface ToneSegment {
  freq: number; // Hz; 0 = silence
  durationMs: number;
}

/** Render tone segments to a 16-bit PCM mono WAV and return a data: URI. */
function toneWavDataUri(segments: ToneSegment[]): string {
  const totalSamples = segments.reduce(
    (acc, seg) => acc + Math.round((seg.durationMs / 1000) * SAMPLE_RATE),
    0
  );
  const dataSize = totalSamples * 2;
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);

  // RIFF/WAVE header
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let sampleIndex = 0;
  for (const seg of segments) {
    const segSamples = Math.round((seg.durationMs / 1000) * SAMPLE_RATE);
    const fade = Math.min(Math.floor(segSamples / 8), SAMPLE_RATE * 0.005);
    for (let i = 0; i < segSamples; i++) {
      let value = 0;
      if (seg.freq > 0) {
        // Short fade in/out to avoid clicks.
        let envelope = 1;
        if (i < fade) envelope = i / fade;
        else if (i > segSamples - fade) envelope = (segSamples - i) / fade;
        value =
          Math.sin((2 * Math.PI * seg.freq * i) / SAMPLE_RATE) * 0.6 * envelope;
      }
      view.setInt16(44 + sampleIndex * 2, Math.round(value * 32767), true);
      sampleIndex++;
    }
  }

  return `data:audio/wav;base64,${bytesToBase64(buf)}`;
}

// ── Cue playback ───────────────────────────────────────────────────────────────

export type CueType = "start" | "stop" | "lap" | "target" | "alarm";

const CUE_SEGMENTS: Record<CueType, ToneSegment[]> = {
  start: [{ freq: 880, durationMs: 130 }],
  stop: [
    { freq: 440, durationMs: 110 },
    { freq: 0, durationMs: 40 },
    { freq: 440, durationMs: 110 },
  ],
  lap: [{ freq: 660, durationMs: 90 }],
  // Distinct rising two-tone so the target marker can't be confused with a lap.
  target: [
    { freq: 988, durationMs: 140 },
    { freq: 0, durationMs: 30 },
    { freq: 1319, durationMs: 220 },
  ],
  // Countdown-timer completion (#232): three rising tones, longer and louder
  // in character than the short press cues. Played a finite number of times
  // by the caller — never an un-dismissable loop.
  alarm: [
    { freq: 880, durationMs: 160 },
    { freq: 0, durationMs: 40 },
    { freq: 1175, durationMs: 160 },
    { freq: 0, durationMs: 40 },
    { freq: 1568, durationMs: 260 },
  ],
};

const players: Partial<Record<CueType, AudioPlayer>> = {};
let audioModeReady = false;

async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  audioModeReady = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      // Short UI cues: never pause the user's music.
      interruptionMode: "mixWithOthers",
      // Best-effort: keep the audio session alive while backgrounded so a
      // cue can still sound if the JS runtime is running (see module docs).
      shouldPlayInBackground: true,
    });
  } catch {
    // Non-fatal: cues will still play in the default audio mode.
  }
}

/** Play a cue. Never throws — audio failures must not break timing. */
export function playCue(type: CueType): void {
  try {
    void ensureAudioMode();
    let player = players[type];
    if (!player) {
      player = createAudioPlayer({ uri: toneWavDataUri(CUE_SEGMENTS[type]) });
      players[type] = player;
    }
    void player.seekTo(0);
    player.play();
  } catch {
    // Non-fatal.
  }
}

// _verify/sttcheck.ts
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { pipeline, env } from "@xenova/transformers";
env.allowRemoteModels = false;
env.localModelPath = join(process.cwd(), "resources", "models");
var ff = ffmpegStatic;
var scratch = mkdtempSync(join(tmpdir(), "sttcheck-"));
var wav = join(scratch, "speech.wav");
var raw = join(scratch, "speech.f32");
var SENTENCE = "the quick brown fox jumps over the lazy dog";
var ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wav}'); $s.Speak('${SENTENCE}'); $s.Dispose()`;
spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
spawnSync(ff, ["-y", "-i", wav, "-ar", "16000", "-ac", "1", "-f", "f32le", raw], { stdio: "ignore" });
var buf = readFileSync(raw);
var audio = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
try {
  console.log("Loading whisper-base (downloads on first run)\u2026");
  const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-base");
  const out = await transcriber(audio, { language: "english", task: "transcribe" });
  const text = String(out?.text ?? "").trim();
  const words = new Set(text.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean));
  const hits = ["quick", "brown", "fox", "lazy", "dog"].filter((w) => words.has(w)).length;
  writeFileSync(join(scratch, "result.txt"), text);
  console.log("STT_RESULT: " + JSON.stringify(text));
  console.log("STT_MATCH: " + hits + "/5 keywords found \u2192 " + (hits >= 3 ? "PASS" : "WEAK"));
} catch (e) {
  console.log("STT_ERROR: " + (e instanceof Error ? e.stack || e.message : String(e)));
}
process.exit(0);

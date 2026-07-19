// _verify/videocheck.ts
import { mkdtempSync as mkdtempSync2 } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join2 } from "path";
import { spawnSync } from "child_process";
import ffmpegStatic2 from "ffmpeg-static";
import ffprobeStatic2 from "ffprobe-static";

// src/main/video/render.ts
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// src/main/video/ffmpeg.ts
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
function resolveBinary(p) {
  return p.includes("app.asar") ? p.replace("app.asar", "app.asar.unpacked") : p;
}
var ffmpegPath = resolveBinary(ffmpegStatic);
var ffprobePath = resolveBinary(ffprobeStatic.path);
function runFfmpeg(args, onLog) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderrTail = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderrTail = (stderrTail + s).slice(-2e3);
      onLog?.(s);
    });
    proc.on("error", reject);
    proc.on(
      "exit",
      (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.trim()}`))
    );
  });
}

// src/main/video/render.ts
var DIMENSIONS = {
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
  "4k": [3840, 2160],
  "8k": [7680, 4320]
};
function fontArg() {
  const path = `${process.env.WINDIR ?? "C:\\Windows"}\\Fonts\\arial.ttf`;
  return path.replace(/\\/g, "/").replace(/:/g, "\\:");
}
function fileArg(path) {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:");
}
function computeLayout(resolution = "1080p") {
  const [w, h] = DIMENSIONS[resolution] ?? DIMENSIONS["1080p"];
  const k = w / 1920;
  return {
    w,
    h,
    titleFont: Math.round(56 * k),
    cardFont: Math.round(72 * k),
    waveW: w,
    waveH: Math.round(220 * k),
    titleY: Math.round(90 * k),
    waveMargin: Math.round(50 * k)
  };
}
function buildAudioFilter(opts) {
  const { hasMusic, sfxTimesSec, dur, layout } = opts;
  const wave = `showwaves=s=${layout.waveW}x${layout.waveH}:mode=cline:rate=25:colors=0xE8B923@0.85`;
  const needMix = hasMusic || sfxTimesSec.length > 0;
  if (!needMix) {
    return { chains: [`[1:a]${wave}[wave]`], audioMap: "1:a", extraInputs: [] };
  }
  const chains = [`[1:a]asplit=2[awave][anarr]`, `[awave]${wave}[wave]`];
  const mixLabels = ["[anarr]"];
  const extraInputs = [];
  let idx = 2;
  if (hasMusic) {
    const fadeOutStart = Math.max(0.1, dur - 2.5);
    chains.push(
      `[${idx}:a]volume=0.18,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2.5[mus]`
    );
    mixLabels.push("[mus]");
    extraInputs.push("music");
    idx++;
  }
  sfxTimesSec.forEach((t, i) => {
    const ms = Math.max(0, Math.round(t * 1e3));
    chains.push(`[${idx}:a]adelay=${ms}:all=1,volume=0.5[wh${i}]`);
    mixLabels.push(`[wh${i}]`);
    extraInputs.push("sfx");
    idx++;
  });
  chains.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[aout]`);
  return { chains, audioMap: "[aout]", extraInputs };
}
function buildFfmpegArgs(params) {
  const { layout, dur, audioPath, musicPath, sfxCount, whooshPath, filter, videoMap, audioMap, outPath } = params;
  const args = ["-y", "-f", "lavfi", "-i", `color=c=0x0B0F1A:s=${layout.w}x${layout.h}:d=${dur.toFixed(2)}`, "-i", audioPath];
  if (musicPath) args.push("-stream_loop", "-1", "-i", musicPath);
  for (let i = 0; i < sfxCount; i++) args.push("-i", whooshPath);
  args.push(
    "-filter_complex",
    filter,
    "-map",
    videoMap,
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "25",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    outPath
  );
  return args;
}
function extractCards(body, title) {
  const cards = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*\[([^\]]{2,40})\]\s*$/.exec(line);
    if (m) cards.push(m[1].trim());
  }
  const unique = [...new Set(cards)];
  if (unique.length >= 2) return unique;
  return [title.slice(0, 40) || "FinScript", "ANALYSIS", "KEY TAKEAWAY"];
}
function sanitizeCard(text) {
  return text.replace(/[^A-Za-z0-9 ,.!?%&/-]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}
async function makeWhoosh(outPath) {
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=0.35:c=pink:r=44100",
    "-af",
    "afade=t=in:d=0.03,afade=t=out:st=0.15:d=0.2,lowpass=f=2500,volume=0.9",
    outPath
  ]);
}
async function renderVideo(opts) {
  const scratch2 = mkdtempSync(join(tmpdir(), "finscript-video-"));
  try {
    const layout = computeLayout(opts.resolution);
    const cards = extractCards(opts.body, opts.title).map(sanitizeCard).filter(Boolean);
    const dur = Math.max(1, opts.durationSec);
    const titleFile = join(scratch2, "title.txt");
    writeFileSync(titleFile, sanitizeCard(opts.title) || "FINSCRIPT STUDIO", "utf-8");
    const font = fontArg();
    const slot = dur / cards.length;
    const sfxTimesSec = opts.soundEffects ? cards.slice(1).map((_, i) => (i + 1) * slot) : [];
    let whooshPath;
    if (sfxTimesSec.length) {
      whooshPath = join(scratch2, "whoosh.wav");
      await makeWhoosh(whooshPath);
    }
    const audio = buildAudioFilter({ hasMusic: !!opts.musicPath, sfxTimesSec, dur, layout });
    const chains = [...audio.chains];
    chains.push(
      `[0:v]drawtext=fontfile='${font}':textfile='${fileArg(titleFile)}':fontcolor=0xF5E9C8:fontsize=${layout.titleFont}:x=(w-tw)/2:y=${layout.titleY}[v0]`
    );
    chains.push(`[v0][wave]overlay=x=0:y=H-h-${layout.waveMargin}[v1]`);
    let prev = "v1";
    cards.forEach((card, i) => {
      const cardFile = join(scratch2, `card${i}.txt`);
      writeFileSync(cardFile, card, "utf-8");
      const start = i * slot;
      const end = i === cards.length - 1 ? dur : (i + 1) * slot;
      const next = `c${i}`;
      const fadeEnd = (start + 0.6).toFixed(2);
      const alpha = `if(lt(t,${start.toFixed(2)}),0,if(lt(t,${fadeEnd}),(t-${start.toFixed(2)})/0.6,1))`;
      chains.push(
        `[${prev}]drawtext=fontfile='${font}':textfile='${fileArg(cardFile)}':fontcolor=white:fontsize=${layout.cardFont}:x=(w-tw)/2:y=(h-th)/2:alpha='${alpha}':enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[${next}]`
      );
      prev = next;
    });
    const filter = chains.join(";");
    const args = buildFfmpegArgs({
      layout,
      dur,
      audioPath: opts.audioPath,
      musicPath: opts.musicPath,
      sfxCount: sfxTimesSec.length,
      whooshPath,
      filter,
      videoMap: `[${prev}]`,
      audioMap: audio.audioMap,
      outPath: opts.outPath
    });
    await runFfmpeg(args, opts.onLog);
  } finally {
    rmSync(scratch2, { recursive: true, force: true });
  }
}

// _verify/videocheck.ts
var ff = ffmpegStatic2;
var fp = ffprobeStatic2.path;
var scratch = mkdtempSync2(join2(tmpdir2(), "vidcheck-"));
var narration = join2(scratch, "narration.wav");
var music = join2(scratch, "music.wav");
var out = join2(scratch, "out.mp4");
spawnSync(ff, ["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", narration]);
spawnSync(ff, ["-y", "-f", "lavfi", "-i", "sine=frequency=500:duration=2", music]);
try {
  await renderVideo({
    title: "Test Video",
    body: "[INTRO]\nline\n[MIDDLE]\nline\n[END]\nline",
    audioPath: narration,
    durationSec: 3,
    outPath: out,
    resolution: "8k",
    musicPath: music,
    soundEffects: true,
    onLog: () => {
    }
  });
  const dims = spawnSync(fp, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    out
  ]).stdout.toString().trim();
  const acodec = spawnSync(fp, [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "csv=p=0",
    out
  ]).stdout.toString().trim();
  const vcodec = spawnSync(fp, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "csv=p=0",
    out
  ]).stdout.toString().trim();
  console.log("RENDER_OK dims=" + dims + " video=" + vcodec + " audio=" + acodec);
} catch (e) {
  console.log("RENDER_ERROR: " + (e instanceof Error ? e.message : String(e)));
}
process.exit(0);

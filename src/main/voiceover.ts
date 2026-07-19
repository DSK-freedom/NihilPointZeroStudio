import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export function stripStageDirections(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\[[A-Z\s]+\]\s*$/.test(line))
    .join('\n')
}

/**
 * Free, zero-dependency voiceover draft using Windows' built-in speech engine
 * (System.Speech, via a short-lived PowerShell process). Robotic quality —
 * useful for checking pacing/timing, not upload-ready narration.
 */
export async function synthesizeSpeechToFile(scriptText: string, outputWavPath: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'finscript-tts-'))
  const textPath = join(dir, 'script.txt')
  writeFileSync(textPath, stripStageDirections(scriptText), 'utf-8')

  const escapedTextPath = textPath.replace(/'/g, "''")
  const escapedOutPath = outputWavPath.replace(/'/g, "''")
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    // -Encoding UTF8: the file is written UTF-8, but PowerShell 5.1's Get-Content defaults to the
    // system ANSI codepage → em-dashes / curly quotes / accented names become mojibake in the
    // spoken narration. Reading as UTF-8 fixes non-ASCII pronunciation.
    `$text = Get-Content -Path '${escapedTextPath}' -Raw -Encoding UTF8`,
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$synth.SetOutputToWaveFile('${escapedOutPath}')`,
    '$synth.Speak($text)',
    '$synth.Dispose()'
  ].join('; ')

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript])
      let stderr = ''
      proc.stderr.on('data', (d) => {
        stderr += d.toString()
      })
      proc.on('error', reject)
      proc.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Voiceover generation failed (exit ${code}): ${stderr.trim()}`))
      })
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

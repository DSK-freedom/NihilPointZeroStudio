import { describe, expect, it } from 'vitest'
import { parseCommandLine } from './separate'

describe('parseCommandLine', () => {
  it('splits a plain multi-word command', () => {
    expect(parseCommandLine('python -m demucs')).toEqual(['python', '-m', 'demucs'])
  })

  it('keeps a double-quoted executable path with spaces as one argument', () => {
    expect(parseCommandLine('"C:\\Program Files\\demucs\\demucs.exe" -v')).toEqual([
      'C:\\Program Files\\demucs\\demucs.exe',
      '-v'
    ])
  })

  it('supports single quotes', () => {
    expect(parseCommandLine("'/opt/my tools/demucs' --fast")).toEqual(['/opt/my tools/demucs', '--fast'])
  })

  it('returns [] for empty/whitespace input', () => {
    expect(parseCommandLine('')).toEqual([])
    expect(parseCommandLine('   ')).toEqual([])
  })

  it('treats shell metacharacters as literal text, not operators', () => {
    // Without a shell these can never chain commands — they are just (invalid) args.
    expect(parseCommandLine('demucs && evil.exe')).toEqual(['demucs', '&&', 'evil.exe'])
  })
})

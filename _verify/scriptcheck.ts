import { generateScriptFlow } from '../src/main/services'

try {
  const s = await generateScriptFlow({
    topic: 'Why the Pakistani rupee moves',
    length: 'short',
    languageMix: 'balanced',
    styles: ['standard']
  })
  console.log('SCRIPT_OK title=', JSON.stringify(s.title), 'words=', s.estimatedWordCount)
} catch (e) {
  console.log('SCRIPT_ERROR:', e instanceof Error ? e.message : String(e))
}
process.exit(0)

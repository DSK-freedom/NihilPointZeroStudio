import { parseSpreadsheetFile } from './parseFile'
import { analyzeTechnical, isPriceHistorySheet } from './technical'
import { analyzeFundamental } from './fundamental'
import { analyzeFlow, isFlowSheet } from './flow'

export { correlateFlowWithPrice } from './backtest'
export { parseSpreadsheetFile } from './parseFile'

export interface FileAnalysis {
  fileName: string
  kind: 'technical' | 'fundamental' | 'flow' | 'document'
  summary: string
}

/** Parses and analyzes a local file the user picked themselves — never a network fetch. */
export function analyzeImportedFile(filePath: string, fileName: string): FileAnalysis {
  const sheet = parseSpreadsheetFile(filePath)
  if (isFlowSheet(sheet)) {
    return { fileName, kind: 'flow', summary: analyzeFlow(sheet).summary }
  }
  if (isPriceHistorySheet(sheet)) {
    return { fileName, kind: 'technical', summary: analyzeTechnical(sheet) }
  }
  return { fileName, kind: 'fundamental', summary: analyzeFundamental(sheet) }
}

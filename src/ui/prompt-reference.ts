import { loadConfig } from '../core/config'
import { declaredReference, declareReference } from './dir'
import { parseFigmaUrl } from './mockup/fetch'

const FIGMA_URL = /https?:\/\/(?:[\w-]+\.)?figma\.com\/(?:design|file)\/[^\s<>"'`)\]]+/gi
const TRAILING = /[.,;:!?]+$/

export const figmaUrlIn = (prompt: string): string | undefined => {
  for (const match of prompt.matchAll(FIGMA_URL)) {
    const url = match[0].replace(TRAILING, '')
    try {
      parseFigmaUrl(url)
      return url
    } catch {
      continue
    }
  }
  return undefined
}

export const declareReferenceFromPrompt = (root: string, prompt: string): string | undefined => {
  if (loadConfig(root).ui === undefined) return undefined
  const url = figmaUrlIn(prompt)
  if (url === undefined || declaredReference(root) !== undefined) return undefined
  declareReference(root, `figma:${url}`)
  return [
    `jig: the Figma reference figma:${url} is declared for this branch; the UI part follows flows/ui.md.`,
    `jig pre-mr will ask for \`jig ui mockup --figma ${url} --component <node id>\` and \`jig ui reuse\` before the merge request.`,
  ].join('\n')
}

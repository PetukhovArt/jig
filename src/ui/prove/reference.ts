import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { jigPaths } from '../../core/paths'
import { figmaApiKey, FIGMA_KEY_ENVS, parseFigmaUrl } from '../mockup/fetch'

export type ReferenceSpec = { kind: 'figma'; url: string } | { kind: 'image'; path: string }

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; arrayBuffer: () => Promise<ArrayBuffer> }>

export const defaultFetch: FetchFn = (url, init) => fetch(url, init)

export const parseReference = (value: string): ReferenceSpec => {
  if (value.startsWith('figma:')) return { kind: 'figma', url: value.slice('figma:'.length) }
  if (value.startsWith('image:')) return { kind: 'image', path: value.slice('image:'.length) }
  throw new Error(`--reference ${value}: expected figma:<Figma URL with node-id> or image:<path to a PNG>`)
}

export const describeReference = (spec: ReferenceSpec): string => (spec.kind === 'figma' ? `Figma ${spec.url}` : `image ${spec.path}`)

export const figmaImagePath = (root: string, url: string): string => {
  const { fileKey, nodeId } = parseFigmaUrl(url)
  return join(jigPaths(root).ui, 'figma', `${fileKey}-${nodeId.replace(/:/g, '-')}.png`)
}

export const fetchFigmaImage = async (root: string, url: string, fetcher: FetchFn, env: NodeJS.ProcessEnv = process.env): Promise<string> => {
  const file = figmaImagePath(root, url)
  if (existsSync(file)) return file
  const key = figmaApiKey(env)
  if (key === undefined) throw new Error(`no Figma key: set ${FIGMA_KEY_ENVS.join(' or ')}, or pass a PNG export with --reference image:<path>`)
  const { fileKey, nodeId } = parseFigmaUrl(url)
  const listing = await fetcher(`https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`, { headers: { 'X-Figma-Token': key } })
  if (!listing.ok) throw new Error(`Figma images endpoint answered ${listing.status}`)
  const body = (await listing.json()) as { images?: Record<string, string | null> }
  const imageUrl = body.images?.[nodeId]
  if (typeof imageUrl !== 'string') throw new Error(`Figma rendered no image for node ${nodeId}`)
  const image = await fetcher(imageUrl)
  if (!image.ok) throw new Error(`Figma image download answered ${image.status}`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(await image.arrayBuffer()))
  return file
}

export const expandImagePath = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)

export const readImage = (cwd: string, path: string): Buffer | undefined => {
  const file = resolve(cwd, path)
  return existsSync(file) ? readFileSync(file) : undefined
}

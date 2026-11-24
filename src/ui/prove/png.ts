import { deflateSync, inflateSync } from 'node:zlib'

export interface Image {
  width: number
  height: number
  rgba: Buffer
}

export interface PixelDiff {
  width: number
  height: number
  total: number
  differing: number
  ratio: number
  sizeMismatch: boolean
  map: Buffer
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const COLOR_RGB = 2
const COLOR_RGBA = 6
const DIFF_COLOR = [255, 0, 80] as const
const DIM = 0.35

const unfilter = (filter: number, left: number, up: number, upLeft: number): number => {
  switch (filter) {
    case 0:
      return 0
    case 1:
      return left
    case 2:
      return up
    case 3:
      return (left + up) >> 1
    case 4: {
      const estimate = left + up - upLeft
      const toLeft = Math.abs(estimate - left)
      const toUp = Math.abs(estimate - up)
      const toUpLeft = Math.abs(estimate - upLeft)
      return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
    }
    default:
      throw new Error(`unknown PNG filter ${filter}`)
  }
}

export const pngSize = (png: Buffer): { width: number; height: number } => {
  if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

export const decodePng = (png: Buffer): Image => {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file')
  let width = 0
  let height = 0
  let channels = 0
  const data: Buffer[] = []
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const body = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const colorType = body[9]
      if (body[8] !== 8 || (colorType !== COLOR_RGB && colorType !== COLOR_RGBA) || body[12] !== 0) {
        throw new Error(`unsupported PNG (bit depth ${body[8]}, color type ${colorType}, interlace ${body[12]}): 8-bit RGB or RGBA only`)
      }
      channels = colorType === COLOR_RGBA ? 4 : 3
    } else if (type === 'IDAT') {
      data.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = y * stride
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? (pixels[row + i - channels] ?? 0) : 0
      const up = y > 0 ? (pixels[row - stride + i] ?? 0) : 0
      const upLeft = i >= channels && y > 0 ? (pixels[row - stride + i - channels] ?? 0) : 0
      pixels[row + i] = ((line[i] ?? 0) + unfilter(filter, left, up, upLeft)) & 0xff
    }
  }
  if (channels === 4) return { width, height, rgba: pixels }
  const rgba = Buffer.alloc(width * height * 4, 0xff)
  for (let pixel = 0; pixel < width * height; pixel++) pixels.copy(rgba, pixel * 4, pixel * 3, pixel * 3 + 3)
  return { width, height, rgba }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

const crc32 = (bytes: Buffer): number => {
  let value = 0xffffffff
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const chunk = (type: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

export const encodePng = ({ width, height, rgba }: Image): Buffer => {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = COLOR_RGBA
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const pixelAt = (image: Image, x: number, y: number): [number, number, number] | undefined => {
  if (x >= image.width || y >= image.height) return undefined
  const offset = (y * image.width + x) * 4
  const alpha = (image.rgba[offset + 3] ?? 255) / 255
  const channel = (index: number): number => Math.round((image.rgba[offset + index] ?? 0) * alpha + 255 * (1 - alpha))
  return [channel(0), channel(1), channel(2)]
}

export const diffImages = (reference: Image, result: Image, tolerance: number): PixelDiff => {
  const width = Math.max(reference.width, result.width)
  const height = Math.max(reference.height, result.height)
  const map = Buffer.alloc(width * height * 4, 0xff)
  let differing = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const expected = pixelAt(reference, x, y)
      const actual = pixelAt(result, x, y)
      const isDifferent = expected === undefined || actual === undefined || expected.some((value, index) => Math.abs(value - (actual[index] ?? 0)) > tolerance)
      const offset = (y * width + x) * 4
      const shown = actual ?? expected ?? [255, 255, 255]
      const color = isDifferent ? DIFF_COLOR : shown.map((value) => Math.round(255 - (255 - value) * DIM))
      map[offset] = color[0] ?? 0
      map[offset + 1] = color[1] ?? 0
      map[offset + 2] = color[2] ?? 0
      if (isDifferent) differing++
    }
  }
  const total = width * height
  return {
    width,
    height,
    total,
    differing,
    ratio: total === 0 ? 0 : differing / total,
    sizeMismatch: reference.width !== result.width || reference.height !== result.height,
    map: encodePng({ width, height, rgba: map }),
  }
}

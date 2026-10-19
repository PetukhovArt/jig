export class Counter<T extends object = object> {
  /** Current count, never negative. */
  count = 0
  /** Adds one; returns the new count. */
  increment(): number {
    return ++this.count
  }
}
export interface Limits {
  /** Maximum items per page, 1..100. */
  max: number
}
export enum Mode {
  /** Reads only from the cache. */
  Offline,
}
export const enum Level {
  /** Logs everything. */
  Debug,
}
export type Point = {
  /** Pixels from the left edge. */
  x: number
}
export abstract class Shape {
  /** Area in square pixels. */
  abstract area(): number
}

# Design patterns: TypeScript adapter

How the patterns of `<root>/skills/jig/references/patterns/catalog.md` look in TypeScript. Pick the pattern there first; this file only shows the idiom. The rules of atom `typescript` hold in every example: no `as` to silence the compiler, no `any`, no `!` on an unchecked value.

Style rule: a function, a closure or a plain object for a pattern without state. A class when the pattern owns mutable state, a lifecycle or an identity that must stay inside.

## Creational

### Factory Method: pick the type from a registry

```ts
type Env = 'production' | 'development'

const loggers: Record<Env, () => Logger> = {
  production: () => new FileLogger(),
  development: () => new ConsoleLogger(),
}

const createLogger = (env: Env): Logger => {
  const create = loggers[env]
  return create()
}
```

`Record<Env, …>` makes a missing variant a compile error. A `switch` with a `never` default does the same where each branch needs its own arguments.

### Abstract Factory: an interface keeps the family complete

```ts
interface PlatformKit {
  fileSystem(): FileSystem
  windows(): WindowManager
  notifications(): Notifications
}

const desktopKit: PlatformKit = { fileSystem: () => new NodeFs(), windows: () => new ElectronWindows(), notifications: () => new OsNotifications() }
const browserKit: PlatformKit = { fileSystem: () => new OpfsFs(), windows: () => new TabWindows(), notifications: () => new WebNotifications() }
```

### Builder: options object first, chaining when parts depend on each other

```ts
// Usually enough: defaults plus a typed options object.
const createQuery = ({ table, where = {}, limit = 50 }: QueryOptions): Query => ({ table, where, limit })

// Chaining, when the order of steps matters or each step validates.
const query = new QueryBuilder().from('users').where('active', true).orderBy('createdAt', 'desc').limit(50).build()
```

### Singleton: the module is the instance

```ts
// config.ts: ESM caches the module, every importer gets this object.
export const config = loadConfig()
```

Prefer passing `config` as a parameter where tests need another one.

## Structural

### Adapter: a pure function at the boundary

```ts
const toPayment = (raw: StripePayment): Payment => ({
  amount: raw.amount_cents / 100,
  currency: parseCurrency(raw.currency_code), // parse, never `as Currency`
})
```

### Decorator and Wrapper: a higher-order function

```ts
const withCache =
  <T>(fn: (id: string) => Promise<T>, cache: Cache<T>) =>
  (id: string): Promise<T> =>
    cache.getOrSet(id, () => fn(id))

const getUser = withCache(fetchUser, userCache)
```

TypeScript `@decorators` add metadata to classes; use them where the framework reads that metadata, not for plain composition.

### Proxy: same interface, gate inside

```ts
class LazyConnection implements Connection {
  private conn: Connection | undefined

  query(sql: string) {
    this.conn ??= createConnection()
    return this.conn.query(sql)
  }
}
```

The built-in `Proxy` object intercepts any property access; keep it for generic tools (observability, mocks), not domain code: types do not see the interception.

### Facade: a module of functions

```ts
// users.ts: behind each call are auth, cache, storage and events.
export const getUser = (id: UserId): Promise<User> => { ... }
export const renameUser = (id: UserId, name: string): Promise<User> => { ... }
```

### Bridge: inject the implementation dimension

```ts
interface RenderBackend { drawRect(x: number, y: number, w: number, h: number): void }

class Renderer {
  constructor(private readonly backend: RenderBackend) {}
  drawButton(b: Button) { this.backend.drawRect(b.x, b.y, b.w, b.h) }
}

new Renderer(new WebGLBackend())
```

### Composite: one type for a leaf and a tree

```ts
type Node =
  | { kind: 'file'; name: string; size: number }
  | { kind: 'dir'; name: string; children: Node[] }

const size = (n: Node): number => (n.kind === 'file' ? n.size : n.children.reduce((s, c) => s + size(c), 0))
```

### Flyweight: a cache in front of a factory

```ts
const styles = new Map<string, CellStyle>()

const getStyle = (font: string, color: string): CellStyle => {
  const key = `${font}|${color}`
  const hit = styles.get(key)
  if (hit) return hit
  const style = Object.freeze({ font, color })
  styles.set(key, style)
  return style
}
```

### Value Object: a branded type from a parser

```ts
type Email = string & { readonly __brand: 'Email' }

const isEmail = (s: string): s is Email => /^[^@\s]+@[^@\s]+$/.test(s)

const parseEmail = (s: string): Email => {
  if (!isEmail(s)) throw new Error(`Not an email: ${s}`)
  return s
}
```

For a value with several fields (`Money`), a `readonly` object built only by its parser, with an `equals` function.

### Context: an explicit object, or AsyncLocalStorage on the server

```ts
type RequestContext = { userId: UserId; traceId: string; db: Db }

const handle = (ctx: RequestContext, input: Input) => saveOrder(ctx, input)
```

`AsyncLocalStorage` (Node.js) carries context across async calls without parameters; framework DI (`provide`/`inject` in Vue, React context) does the same in UI trees.

## Behavioral

### Strategy: a map of functions

```ts
type SortFn<T> = (items: readonly T[]) => T[]

const sorts = {
  alpha: (items: readonly string[]) => [...items].sort(),
  length: (items: readonly string[]) => [...items].sort((a, b) => a.length - b.length),
} satisfies Record<string, SortFn<string>>

type SortKind = keyof typeof sorts
const sortList = (items: readonly string[], kind: SortKind) => {
  const sort = sorts[kind]
  return sort(items)
}
```

`satisfies` checks every entry and keeps the literal keys for `SortKind`.

### State: a discriminated union plus a transition function

```ts
type Conn =
  | { status: 'idle' }
  | { status: 'connecting'; attempt: number }
  | { status: 'open'; socket: WebSocket }
  | { status: 'failed'; error: Error }

type Event = { type: 'connect' } | { type: 'opened'; socket: WebSocket } | { type: 'error'; error: Error }

const next = (s: Conn, e: Event): Conn => {
  switch (e.type) {
    case 'connect': return s.status === 'idle' || s.status === 'failed' ? { status: 'connecting', attempt: 1 } : s
    case 'opened': return s.status === 'connecting' ? { status: 'open', socket: e.socket } : s
    case 'error': return { status: 'failed', error: e.error }
  }
}
```

The socket exists only in `open`, so no code can send on a closed connection. Many states and guards: a statechart library (XState) instead of a growing switch.

### Command: actions as values, history owns them

```ts
interface Command { execute(): void; undo(): void }

const moveNode = (node: Node, from: Point, to: Point): Command => ({
  execute: () => node.moveTo(to),
  undo: () => node.moveTo(from),
})

class History {
  private readonly done: Command[] = []
  run(cmd: Command) { cmd.execute(); this.done.push(cmd) }
  undo() { this.done.pop()?.undo() }
}
```

A command that crosses a process or the network is a serializable union (`{ type: 'move'; id; to }`), not an object with methods.

### Memento: immutable snapshots

```ts
const snapshots: Readonly<Doc>[] = []
const save = (doc: Doc) => snapshots.push(structuredClone(doc))
const restore = (): Doc | undefined => snapshots.pop()
```

### Chain of Responsibility and Middleware: compose handlers

```ts
type Handler<T, R> = (req: T, next: () => Promise<R>) => Promise<R>

const chain =
  <T, R>(handlers: Handler<T, R>[], last: (req: T) => Promise<R>) =>
  (req: T): Promise<R> => {
    const run = (i: number): Promise<R> => {
      const h = handlers[i]
      return h ? h(req, () => run(i + 1)) : last(req)
    }
    return run(0)
  }

const handle = chain([auth, rateLimit], route)
```

### Observer: a typed emitter owned by the source

```ts
type Events = { saved: { id: string }; failed: { error: Error } }

class Emitter<E extends Record<string, unknown>> {
  private readonly listeners: { [K in keyof E]?: Set<(payload: E[K]) => void> } = {}

  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    const set = (this.listeners[type] ??= new Set())
    set.add(fn)
    return () => set.delete(fn)
  }

  emit<K extends keyof E>(type: K, payload: E[K]) {
    this.listeners[type]?.forEach((fn) => fn(payload))
  }
}
```

`on` returns the unsubscribe function: the subscriber that does not call it leaks. In the browser, `EventTarget` with `CustomEvent` is the built-in variant; in UI frameworks, signals or reactive stores replace hand-written observers.

### Mediator: one coordinator owns the cross-field rules

```ts
class CheckoutForm {
  country = ''
  cities: string[] = []
  paymentVisible = false

  setCountry(country: string) {
    this.country = country
    this.cities = citiesOf(country)
  }

  setPlan(plan: Plan) {
    this.paymentVisible = plan !== 'free'
  }
}
```

Fields do not know each other; only `CheckoutForm` knows that a country changes the city list.

### Iterator: generators

```ts
async function* pages<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; next?: string }>) {
  let cursor: string | undefined
  do {
    const page = await fetchPage(cursor)
    yield* page.items
    cursor = page.next
  } while (cursor)
}

for await (const user of pages(fetchUsers)) { ... }
```

### Template Method: pass the varying steps

```ts
const importFile = async <Row>(file: File, steps: { parse: (text: string) => Row[]; validate: (row: Row) => boolean; save: (rows: Row[]) => Promise<void> }) => {
  const rows = steps.parse(await file.text()).filter(steps.validate)
  await steps.save(rows)
}
```

### Visitor: an exhaustive switch over the union

```ts
type Expr = { kind: 'num'; value: number } | { kind: 'add'; left: Expr; right: Expr }

const evaluate = (e: Expr): number => {
  switch (e.kind) {
    case 'num': return e.value
    case 'add': return evaluate(e.left) + evaluate(e.right)
    default: { const unreachable: never = e; return unreachable }
  }
}
```

Each operation is one such function; a new node kind breaks every operation at compile time until it handles the kind.

### Revealing Constructor

```ts
const done = new Promise<void>((resolve) => worker.once('exit', () => resolve()))
```

The same shape for your own types: the constructor takes `(capabilities) => void` and never stores the capabilities in public fields.

### Actor: a serial queue per owner

```ts
const serial = () => {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

const enqueue = serial()
enqueue(() => saveDraft(doc)) // runs after every earlier task, even a failed one
```

### Null Object

```ts
const silentLogger: Logger = { info: () => {}, error: () => {} }
const run = (logger: Logger = silentLogger) => { ... }
```

## Data access

### Repository over a DAO

```ts
interface OrderRepository {
  byId(id: OrderId): Promise<Order | undefined>
  openFor(customer: CustomerId): Promise<Order[]>
  save(order: Order): Promise<void>
}

const sqlOrders = (db: Db): OrderRepository => ({
  byId: async (id) => { const row = await db.orders.find(id); return row && toOrder(row) },
  openFor: async (c) => (await db.orders.where({ customer: c, status: 'open' })).map(toOrder),
  save: (o) => db.orders.upsert(fromOrder(o)),
})
```

The domain imports `OrderRepository`; only the composition root imports `sqlOrders`. A test passes an in-memory implementation.

### DTO: a type plus a parser at the boundary

```ts
type OrderDto = { id: string; total_cents: number; status: string }

const toOrder = (dto: OrderDto): Order => ({ id: parseOrderId(dto.id), total: dto.total_cents / 100, status: parseStatus(dto.status) })
```

Validate unknown input with a schema library (zod, valibot) where it enters: `const dto = OrderDto.parse(json)`.

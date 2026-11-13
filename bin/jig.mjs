#!/usr/bin/env node

// package.json
var version = "0.5.1";

// src/adapters/install.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";

// src/core/paths.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// src/adapters/project-dir.ts
var JIG_PROJECT_DIR = "JIG_PROJECT_DIR";
var AGENT_PROJECT_DIRS = { claude: "CLAUDE_PROJECT_DIR" };
var PROJECT_DIR_ENVS = [JIG_PROJECT_DIR, ...Object.values(AGENT_PROJECT_DIRS)];

// src/core/git.ts
import { spawnSync } from "node:child_process";
var MAX_BUFFER = 64 * 1024 * 1024;
var git = (args, cwd, input) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
    ...input === void 0 ? {} : { input }
  });
  if (result.error) {
    return { ok: false, code: null, stdout: "", stderr: result.error.message };
  }
  return { ok: result.status === 0, code: result.status, stdout: result.stdout, stderr: result.stderr };
};
var firstLine = (text3) => {
  const line = text3.split("\n")[0]?.trim();
  return line === "" ? void 0 : line;
};
var gitToplevel = (cwd) => {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  return result.ok ? firstLine(result.stdout) : void 0;
};
var gitStatus = (cwd, paths = []) => {
  const result = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", ...paths.length > 0 ? ["--", ...paths] : []], cwd);
  if (!result.ok) return void 0;
  const tokens = result.stdout.split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (token.length < 4) continue;
    const status = token.slice(0, 2);
    entries.push({ status, path: token.slice(3) });
    const hasOriginalPath = status.includes("R") || status.includes("C");
    if (hasOriginalPath) {
      index++;
    }
  }
  return entries;
};
var gitCurrentBranch = (cwd) => {
  const result = git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  return result.ok ? firstLine(result.stdout) : void 0;
};
var gitShortSha = (cwd, length = 7) => {
  const result = git(["rev-parse", `--short=${length}`, "HEAD"], cwd);
  return result.ok ? firstLine(result.stdout) : void 0;
};

// src/core/paths.ts
var LOCAL_CONFIG = "config.local.jsonc";
var JIG_GITIGNORE = `journal/
runs/
cache/
${LOCAL_CONFIG}
`;
var resolveProjectRoot = (cwd, env = process.env, names = PROJECT_DIR_ENVS) => {
  const fromEnv = names.map((name) => env[name]).find(Boolean);
  if (fromEnv) return resolve(fromEnv);
  return resolve(gitToplevel(cwd) ?? cwd);
};
var resolvePluginRoot = (env = process.env, entry = process.argv[1]) => {
  const fromEnv = env["CLAUDE_PLUGIN_ROOT"];
  if (fromEnv) return resolve(fromEnv);
  if (entry === void 0) return process.cwd();
  return dirname(dirname(resolve(entry)));
};
var jigPaths = (projectRoot) => {
  const dir2 = join(projectRoot, ".jig");
  const cache = join(dir2, "cache");
  return {
    dir: dir2,
    config: join(dir2, "config.jsonc"),
    localConfig: join(dir2, "config.local.jsonc"),
    gitignore: join(dir2, ".gitignore"),
    journal: join(dir2, "journal"),
    runs: join(dir2, "runs"),
    cache,
    sessions: join(cache, "sessions"),
    plan: join(cache, "plan.json"),
    heavyLock: join(cache, "heavy.lock"),
    tscCache: join(cache, "tsc"),
    eslintCache: join(cache, "eslint")
  };
};
var ensureJigDir = (projectRoot) => {
  const paths = jigPaths(projectRoot);
  mkdirSync(paths.dir, { recursive: true });
  if (!existsSync(paths.gitignore)) {
    writeFileSync(paths.gitignore, JIG_GITIGNORE);
    return paths;
  }
  const current = readFileSync(paths.gitignore, "utf8");
  if (!current.split(/\r?\n/).includes(LOCAL_CONFIG)) {
    appendFileSync(paths.gitignore, `${current === "" || current.endsWith("\n") ? "" : "\n"}${LOCAL_CONFIG}
`);
  }
  return paths;
};
var toSlash = (path2) => path2.replace(/\\/g, "/");
var toProjectPath = (projectRoot, file, cwd = projectRoot) => {
  const absolute = isAbsolute(file) ? file : resolve(cwd, file);
  return toSlash(relative(projectRoot, absolute));
};

// src/adapters/install.ts
var CODEX_HOOKS = [
  { event: "SessionStart", hook: "session-start", timeout: 15 },
  { event: "UserPromptSubmit", hook: "user-prompt-submit", timeout: 10 },
  { event: "PreToolUse", matcher: "apply_patch|Edit|Write", hook: "pre-edit", timeout: 10 },
  { event: "PreToolUse", matcher: "Bash", hook: "pre-shell", timeout: 10 },
  { event: "PostToolUse", matcher: "apply_patch|Edit|Write", hook: "post-edit", timeout: 30 },
  { event: "PostToolUse", matcher: "Bash", hook: "post-shell", timeout: 10 },
  { event: "PostCompact", hook: "compact", timeout: 10 },
  { event: "SubagentStart", hook: "subagent-start", timeout: 10 },
  { event: "Stop", hook: "stop", timeout: 120 }
];
var MARKER = "_jigManaged";
var USAGE = "usage: jig hooks codex|opencode [--install | --uninstall]";
var OPENCODE_EXPORT = "export { JigPlugin } from ";
var codexHome = () => process.env["CODEX_HOME"] ?? join2(homedir(), ".codex");
var commandFor = (pluginRoot, hook) => `node "${toSlash(join2(pluginRoot, "bin", "jig.mjs"))}" hook ${hook} --agent codex`;
var entriesFor = (pluginRoot) => {
  const byEvent = {};
  for (const spec2 of CODEX_HOOKS) {
    const entry = {
      [MARKER]: true,
      ...spec2.matcher === void 0 ? {} : { matcher: spec2.matcher },
      hooks: [{ type: "command", command: commandFor(pluginRoot, spec2.hook), timeout: spec2.timeout }]
    };
    byEvent[spec2.event] = [...byEvent[spec2.event] ?? [], entry];
  }
  return byEvent;
};
var readHooks = (path2) => {
  if (!existsSync2(path2)) return {};
  const value = JSON.parse(readFileSync2(path2, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path2} is not a JSON object`);
  return value;
};
var withoutJig = (hooks) => Object.fromEntries(
  Object.entries(hooks).map(([event, entries]) => [event, entries.filter((entry) => entry[MARKER] !== true)]).filter(([, entries]) => entries.length > 0)
);
var opencodeHome = () => process.env["OPENCODE_CONFIG_DIR"] ?? join2(homedir(), ".config", "opencode");
var opencodeShim = (pluginRoot) => `${OPENCODE_EXPORT}${JSON.stringify(`file:///${toSlash(join2(pluginRoot, "opencode", "jig.mjs")).replace(/^\/+/, "")}`)}
`;
var runOpencode = (action) => {
  const shim = opencodeShim(resolvePluginRoot());
  if (action === void 0) {
    process.stdout.write(shim);
    return 0;
  }
  if (action !== "--install" && action !== "--uninstall") throw new Error(USAGE);
  const path2 = join2(opencodeHome(), "plugin", "jig.js");
  if (action === "--install") {
    mkdirSync2(dirname2(path2), { recursive: true });
    writeFileSync2(path2, shim);
  } else if (existsSync2(path2) && readFileSync2(path2, "utf8").startsWith(OPENCODE_EXPORT)) {
    rmSync(path2);
  }
  process.stdout.write(`${action === "--install" ? "installed the jig plugin in" : "removed the jig plugin from"} ${toSlash(path2)}
`);
  return 0;
};
var runHooks = (args) => {
  const [agent, action] = args;
  if (agent === "opencode") return runOpencode(action);
  if (agent !== "codex") throw new Error(USAGE);
  const entries = entriesFor(resolvePluginRoot());
  if (action === void 0) {
    process.stdout.write(`${JSON.stringify({ hooks: entries }, null, 2)}
`);
    return 0;
  }
  if (action !== "--install" && action !== "--uninstall") throw new Error(USAGE);
  const path2 = join2(codexHome(), "hooks.json");
  const file = readHooks(path2);
  const kept = withoutJig(file.hooks ?? {});
  const hooks = action === "--uninstall" ? kept : Object.fromEntries([.../* @__PURE__ */ new Set([...Object.keys(kept), ...Object.keys(entries)])].map((event) => [event, [...kept[event] ?? [], ...entries[event] ?? []]]));
  mkdirSync2(dirname2(path2), { recursive: true });
  writeFileSync2(path2, `${JSON.stringify({ ...file, hooks }, null, 2)}
`);
  process.stdout.write(`${action === "--install" ? "installed jig hooks in" : "removed jig hooks from"} ${toSlash(path2)}
`);
  return 0;
};

// src/atoms/atoms.ts
import { readdirSync as readdirSync8, readFileSync as readFileSync15 } from "node:fs";
import { basename as basename4, join as join15 } from "node:path";

// src/core/frontmatter.ts
var FrontmatterError = class extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.line = line;
    this.name = "FrontmatterError";
  }
  line;
};
var FENCE = "---";
var KEY_LINE = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;
var LIST_ITEM = /^\s*-\s+(.*)$/;
var MAP_ENTRY = /^(\s+)([A-Za-z_][\w-]*):(?:\s+(.*))?$/;
var DOUBLE_QUOTE_ESCAPES = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "	", r: "\r", "0": "\0" };
var fail = (cursor, message) => {
  throw new FrontmatterError(message, cursor.line);
};
var readDoubleQuoted = (cursor) => {
  const { text: text3 } = cursor;
  let value = "";
  let index = cursor.index + 1;
  while (index < text3.length) {
    const char = text3[index] ?? "";
    if (char === '"') {
      cursor.index = index + 1;
      return value;
    }
    if (char !== "\\") {
      value += char;
      index++;
      continue;
    }
    const escape = text3[index + 1] ?? "";
    if (escape === "u") {
      const hex = text3.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(cursor, `invalid escape \\u${hex}`);
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 6;
      continue;
    }
    value += DOUBLE_QUOTE_ESCAPES[escape] ?? fail(cursor, `invalid escape \\${escape}`);
    index += 2;
  }
  return fail(cursor, "unterminated double-quoted string");
};
var readSingleQuoted = (cursor) => {
  const { text: text3 } = cursor;
  let value = "";
  let index = cursor.index + 1;
  while (index < text3.length) {
    const char = text3[index] ?? "";
    if (char !== "'") {
      value += char;
      index++;
      continue;
    }
    if (text3[index + 1] === "'") {
      value += "'";
      index += 2;
      continue;
    }
    cursor.index = index + 1;
    return value;
  }
  return fail(cursor, "unterminated single-quoted string");
};
var skipSpaces = (cursor) => {
  while (cursor.text[cursor.index] === " " || cursor.text[cursor.index] === "	") cursor.index++;
};
var isRestEmpty = (cursor) => {
  skipSpaces(cursor);
  const rest = cursor.text.slice(cursor.index);
  return rest === "" || rest.startsWith("#");
};
var stripPlainComment = (text3) => {
  const match = /(^|\s)#/.exec(text3);
  return (match ? text3.slice(0, match.index) : text3).trim();
};
var readFlowItem = (cursor) => {
  const char = cursor.text[cursor.index];
  if (char === '"') return readDoubleQuoted(cursor);
  if (char === "'") return readSingleQuoted(cursor);
  const rest = cursor.text.slice(cursor.index);
  const match = /^[^,\]]*/.exec(rest);
  const raw = match?.[0] ?? "";
  cursor.index += raw.length;
  const value = raw.trim();
  if (value === "") fail(cursor, "empty array item");
  return value;
};
var readFlowArray = (cursor) => {
  const items = [];
  cursor.index++;
  skipSpaces(cursor);
  if (cursor.text[cursor.index] === "]") {
    cursor.index++;
    return items;
  }
  while (cursor.index < cursor.text.length) {
    skipSpaces(cursor);
    items.push(readFlowItem(cursor));
    skipSpaces(cursor);
    const separator = cursor.text[cursor.index];
    cursor.index++;
    if (separator === "]") return items;
    if (separator !== ",") fail(cursor, 'expected "," or "]" in array');
  }
  return fail(cursor, "unterminated array");
};
var readInlineValue = (cursor) => {
  const char = cursor.text[cursor.index];
  const isQuoted = char === '"' || char === "'";
  const isArray = char === "[";
  if (!isQuoted && !isArray) return stripPlainComment(cursor.text.slice(cursor.index));
  const value = isArray ? readFlowArray(cursor) : readFlowItem(cursor);
  if (!isRestEmpty(cursor)) fail(cursor, "unexpected text after value");
  return value;
};
var readScalar = (text3, line) => {
  const cursor = { text: text3, index: 0, line };
  const value = readInlineValue(cursor);
  if (Array.isArray(value)) return fail(cursor, "nested arrays are not supported");
  return value;
};
var isSkippable = (line) => line.trim() === "" || line.trimStart().startsWith("#");
var readList = (lines2, from, firstLine5) => {
  const items = [];
  let index = from;
  while (index < lines2.length) {
    const line = lines2[index] ?? "";
    const item = LIST_ITEM.exec(line);
    if (!item && !isSkippable(line)) break;
    index++;
    if (item) items.push(readScalar(item[1] ?? "", firstLine5 + index - 1));
  }
  return { value: items, next: index };
};
var readMap = (lines2, from, firstLine5, indent) => {
  const map = {};
  let index = from;
  while (index < lines2.length) {
    const line = lines2[index] ?? "";
    const entry = MAP_ENTRY.exec(line);
    if (!entry && !isSkippable(line)) break;
    index++;
    if (!entry) continue;
    const cursor = { text: line, index: 0, line: firstLine5 + index - 1 };
    const key = entry[2] ?? "";
    const inline = entry[3]?.trim() ?? "";
    if (entry[1] !== indent) fail(cursor, `inconsistent indentation before "${key}"`);
    if (Object.hasOwn(map, key)) fail(cursor, `duplicate key "${key}"`);
    if (inline === "" || inline.startsWith("#")) fail(cursor, `"${key}" needs a string value`);
    map[key] = readScalar(inline, cursor.line);
  }
  return { value: map, next: index };
};
var readBlockValue = (lines2, from, firstLine5) => {
  const first = lines2.slice(from).find((line) => !isSkippable(line)) ?? "";
  if (LIST_ITEM.test(first)) return readList(lines2, from, firstLine5);
  const entry = MAP_ENTRY.exec(first);
  if (entry) return readMap(lines2, from, firstLine5, entry[1] ?? "");
  return { value: "", next: from };
};
var parseBlock = (lines2, firstLine5) => {
  const data = {};
  let index = 0;
  while (index < lines2.length) {
    const lineNumber = firstLine5 + index;
    const line = lines2[index] ?? "";
    index++;
    if (isSkippable(line)) continue;
    const match = KEY_LINE.exec(line);
    const cursor = { text: line, index: 0, line: lineNumber };
    if (!match) fail(cursor, `expected "key: value", got "${line}"`);
    const key = match?.[1] ?? "";
    const inline = match?.[2]?.trim() ?? "";
    if (Object.hasOwn(data, key)) fail(cursor, `duplicate key "${key}"`);
    const hasInlineValue = inline !== "" && !inline.startsWith("#");
    if (hasInlineValue) {
      data[key] = readInlineValue({ text: inline, index: 0, line: lineNumber });
      continue;
    }
    const block = readBlockValue(lines2, index, firstLine5);
    data[key] = block.value;
    index = block.next;
  }
  return data;
};
var parseFrontmatter = (text3) => {
  const lines2 = text3.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  if (lines2[0]?.trimEnd() !== FENCE) return void 0;
  const closing = lines2.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE);
  if (closing === -1) throw new FrontmatterError('missing closing "---"', lines2.length);
  const data = parseBlock(lines2.slice(1, closing), 2);
  return { data, body: lines2.slice(closing + 1).join("\n"), bodyLine: closing + 2 };
};

// src/core/plan.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync as mkdirSync7, readdirSync as readdirSync3, readFileSync as readFileSync12, statSync as statSync5 } from "node:fs";
import { dirname as dirname8, join as join10 } from "node:path";

// src/core/glob.ts
var REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/;
var escapeChar = (char) => REGEX_SPECIAL.test(char) ? `\\${char}` : char;
var translateClass = (glob, start) => {
  let index = start + 1;
  let negated = false;
  if (glob[index] === "!" || glob[index] === "^") {
    negated = true;
    index++;
  }
  let body = "";
  if (glob[index] === "]") {
    body += "\\]";
    index++;
  }
  while (index < glob.length && glob[index] !== "]") {
    const char = glob[index] ?? "";
    if (char === "\\" && index + 1 < glob.length) {
      body += `\\${glob[index + 1]}`;
      index += 2;
      continue;
    }
    body += char === "[" || char === "^" ? `\\${char}` : char;
    index++;
  }
  if (index >= glob.length) return void 0;
  return { source: negated ? `[^/${body}]` : `[${body}]`, end: index + 1 };
};
var globToRegExpSource = (glob) => {
  let source = "";
  let braceDepth = 0;
  let index = 0;
  while (index < glob.length) {
    const char = glob[index] ?? "";
    if (char === "*") {
      const isGlobstar = glob[index + 1] === "*";
      if (!isGlobstar) {
        source += "[^/]*";
        index++;
        continue;
      }
      const isDirectoryGlobstar = glob[index + 2] === "/";
      source += isDirectoryGlobstar ? "(?:.*/)?" : ".*";
      index += isDirectoryGlobstar ? 3 : 2;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index++;
      continue;
    }
    if (char === "[") {
      const charClass = translateClass(glob, index);
      source += charClass?.source ?? "\\[";
      index = charClass?.end ?? index + 1;
      continue;
    }
    if (char === "{") {
      braceDepth++;
      source += "(?:";
      index++;
      continue;
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth--;
      source += ")";
      index++;
      continue;
    }
    if (char === "," && braceDepth > 0) {
      source += "|";
      index++;
      continue;
    }
    if (char === "\\" && index + 1 < glob.length) {
      source += escapeChar(glob[index + 1] ?? "");
      index += 2;
      continue;
    }
    source += escapeChar(char);
    index++;
  }
  return source + ")".repeat(braceDepth);
};
var createMatcher = (globs) => {
  if (globs.length === 0) return () => false;
  const pattern = new RegExp(`^(?:${globs.map(globToRegExpSource).join("|")})$`);
  return (path2) => pattern.test(path2.replace(/\\/g, "/"));
};
var matchGlob = (path2, glob) => createMatcher(typeof glob === "string" ? [glob] : glob)(path2);

// src/catalog/lockfiles.json
var lockfiles_default = [
  { file: "package-lock.json", install: "npm ci", resolve: "npm install", deps: "node_modules", manifest: "package.json", stamp: ["node_modules/.package-lock.json"] },
  { file: "npm-shrinkwrap.json", install: "npm ci", resolve: "npm install", deps: "node_modules", manifest: "package.json", stamp: ["node_modules/.package-lock.json"] },
  { file: "pnpm-lock.yaml", install: "pnpm install --frozen-lockfile" },
  { file: "yarn.lock", install: "yarn install --frozen-lockfile", resolve: "yarn install", deps: "node_modules", manifest: "package.json", stamp: ["node_modules/.yarn-integrity", "node_modules/.yarn-state.yml"] },
  { file: "bun.lock", install: "bun install --frozen-lockfile" },
  { file: "bun.lockb", install: "bun install --frozen-lockfile" },
  { file: "deno.lock", install: "deno install --frozen" },
  { file: "uv.lock", install: "uv sync --frozen" },
  { file: "poetry.lock", install: "poetry install --no-root" },
  { file: "Pipfile.lock", install: "pipenv sync" },
  { file: "Gemfile.lock", install: "bundle install" },
  { file: "composer.lock", install: "composer install" },
  { file: "go.sum", install: "go mod download" },
  { file: "Cargo.lock", install: "cargo fetch --locked" },
  { file: "packages.lock.json", install: "dotnet restore --locked-mode" }
];

// src/catalog/languages/index.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { extname, join as join3 } from "node:path";

// src/catalog/languages/lexer.ts
var WORD = /[\p{L}\p{N}_$]/u;
var countNewlines = (text3, from, to) => {
  let count = 0;
  for (let index = from; index < to; index++) {
    if (text3[index] === "\n") {
      count++;
    }
  }
  return count;
};
var lineEnd = (text3, index) => {
  const end = text3.indexOf("\n", index);
  return end === -1 ? text3.length : end;
};
var blockEnd = (text3, index) => {
  const end = text3.indexOf("*/", index + 2);
  return end === -1 ? text3.length : end + 2;
};
var skipQuoted = (text3, from, quote, escapes = true, multiline = false) => {
  let index = from + 1;
  while (index < text3.length && text3[index] !== quote) {
    if (text3[index] === "\n" && !multiline) return index;
    index += escapes && text3[index] === "\\" ? 2 : 1;
  }
  return index + 1;
};
var blankShebang = (source) => {
  if (!source.startsWith("#!")) return source;
  const end = lineEnd(source, 0);
  return " ".repeat(end) + source.slice(end);
};
var kindOf = (text3) => text3.startsWith("/*") || text3.startsWith("<!--") ? "block" : "line";
var commentLexer = (lex) => (source) => {
  const code = blankShebang(source);
  const ranges = lex(code).sort((left, right) => left.start - right.start);
  let line = 1;
  let counted = 0;
  return ranges.map(({ start, end }) => {
    line += countNewlines(code, counted, start);
    counted = start;
    const text3 = code.slice(start, end).replace(/\r$/, "");
    return { text: text3, line, kind: kindOf(text3) };
  });
};

// src/catalog/languages/c-style-lexer.ts
var RUST_RAW_STRING = /^b?r(#*)"/;
var RUST_CHAR = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'/u;
var nestedBlockEnd = (text3, from) => {
  let depth = 0;
  let i = from;
  while (i < text3.length) {
    const pair = text3.slice(i, i + 2);
    if (pair === "/*") depth++;
    else if (pair === "*/") depth--;
    i += pair === "/*" || pair === "*/" ? 2 : 1;
    if (depth === 0) return i;
  }
  return text3.length;
};
var cStyleRanges = (nested, literalEnd) => (text3) => {
  const found = [];
  let i = 0;
  while (i < text3.length) {
    const c = text3[i];
    const d = text3[i + 1];
    if (c === "/" && (d === "/" || d === "*")) {
      const end = d === "/" ? lineEnd(text3, i) : nested ? nestedBlockEnd(text3, i) : blockEnd(text3, i);
      found.push({ start: i, end });
      i = end;
    } else i = literalEnd(text3, i) ?? i + 1;
  }
  return found;
};
var goLiteralEnd = (text3, i) => {
  const c = text3[i];
  if (c === '"' || c === "'") return skipQuoted(text3, i, c);
  if (c === "`") return skipQuoted(text3, i, "`", false, true);
  return void 0;
};
var rustLiteralEnd = (text3, i) => {
  const c = text3[i];
  if ((c === "r" || c === "b") && !WORD.test(text3[i - 1] ?? "")) {
    const raw = RUST_RAW_STRING.exec(text3.slice(i, i + 260));
    if (raw !== null) {
      const hashes = raw[1] ?? "";
      const close = text3.indexOf(`"${hashes}`, i + raw[0].length);
      return close === -1 ? text3.length : close + 1 + hashes.length;
    }
  }
  if (c === '"') return skipQuoted(text3, i, '"', true, true);
  if (c === "'") return i + (RUST_CHAR.exec(text3.slice(i, i + 12))?.[0].length ?? 1);
  return void 0;
};
var lexRust = commentLexer(cStyleRanges(true, rustLiteralEnd));
var lexGo = commentLexer(cStyleRanges(false, goLiteralEnd));

// src/catalog/languages/csharp-lexer.ts
var MESSAGE_DIRECTIVE = /^#\s*(?:error|warning)\b/;
var REGION_DIRECTIVE = /^#\s*(?:region|endregion)\b/;
var CHECK_DIRECTIVE = /^#\s*(?:pragma|nullable)\b/;
var TRAILING_COMMENT = /\s*\/\/.*$/;
var CSharpLexer = class {
  constructor(source) {
    this.source = source;
  }
  source;
  index = 0;
  line = 1;
  comments = [];
  run() {
    this.scanCode(0);
    return this.comments;
  }
  at(offset = 0) {
    return this.source[this.index + offset] ?? "";
  }
  advance() {
    if (this.source[this.index] === "\n") {
      this.line++;
    }
    this.index++;
  }
  runLength(char) {
    let length = 0;
    while (this.at(length) === char) {
      length++;
    }
    return length;
  }
  lineEnd() {
    const newline = this.source.indexOf("\n", this.index);
    return newline === -1 ? this.source.length : newline;
  }
  scanCode(closingBraces) {
    let depth = 0;
    while (this.index < this.source.length) {
      const char = this.at();
      if (char === "}" && depth === 0 && closingBraces > 0) {
        this.index += Math.min(this.runLength("}"), closingBraces);
        return;
      }
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
      }
      this.scanToken(char);
    }
  }
  scanToken(char) {
    if (char === "/" && this.at(1) === "/") {
      this.scanLineComment();
      return;
    }
    if (char === "/" && this.at(1) === "*") {
      this.scanBlockComment();
      return;
    }
    if (char === "#") {
      this.scanDirective();
      return;
    }
    if (char === "'") {
      this.scanChar();
      return;
    }
    if (char === '"' || char === "$" || char === "@") {
      this.scanString();
      return;
    }
    this.advance();
  }
  scanString() {
    let dollars = 0;
    let isVerbatim = false;
    while (this.at() === "$" || this.at() === "@") {
      if (this.at() === "$") {
        dollars++;
      } else {
        isVerbatim = true;
      }
      this.index++;
    }
    if (this.at() !== '"') return;
    const quotes = this.runLength('"');
    if (quotes >= 3 && !isVerbatim) {
      this.scanRawString(quotes, dollars);
      return;
    }
    this.index++;
    this.scanQuotedString(isVerbatim, dollars > 0);
  }
  scanQuotedString(isVerbatim, isInterpolated) {
    while (this.index < this.source.length) {
      const char = this.at();
      if (char === "\\" && !isVerbatim) {
        this.index++;
        this.advance();
        continue;
      }
      if (char === '"') {
        const isEscaped = isVerbatim && this.at(1) === '"';
        this.index += isEscaped ? 2 : 1;
        if (isEscaped) continue;
        return;
      }
      if (char === "\n" && !isVerbatim) return;
      if (isInterpolated && (char === "{" || char === "}") && this.at(1) === char) {
        this.index += 2;
        continue;
      }
      if (isInterpolated && char === "{") {
        this.index++;
        this.scanCode(1);
        continue;
      }
      this.advance();
    }
  }
  scanRawString(quotes, dollars) {
    this.index += quotes;
    while (this.index < this.source.length) {
      const char = this.at();
      if (char === '"') {
        const run3 = this.runLength('"');
        this.index += run3;
        if (run3 >= quotes) return;
        continue;
      }
      if (char === "{" && dollars > 0) {
        const run3 = this.runLength("{");
        this.index += run3;
        if (run3 >= dollars) {
          this.scanCode(dollars);
        }
        continue;
      }
      this.advance();
    }
  }
  scanChar() {
    this.index++;
    while (this.index < this.source.length) {
      const char = this.at();
      if (char === "\\") {
        this.index++;
        this.advance();
        continue;
      }
      if (char === "\n") return;
      this.index++;
      if (char === "'") return;
    }
  }
  scanLineComment() {
    const start = this.index;
    this.index = this.lineEnd();
    const text3 = this.source.slice(start, this.index).replace(/\r$/, "");
    this.comments.push({ text: text3, line: this.line, kind: "line" });
  }
  scanBlockComment() {
    const start = this.index;
    const line = this.line;
    const close = this.source.indexOf("*/", start + 2);
    const stop2 = close === -1 ? this.source.length : close + 2;
    this.line += countNewlines(this.source, start, stop2);
    this.index = stop2;
    this.comments.push({ text: this.source.slice(start, stop2), line, kind: "block" });
  }
  scanDirective() {
    const lineText = this.source.slice(this.index, this.lineEnd()).replace(/\r$/, "");
    if (MESSAGE_DIRECTIVE.test(lineText)) {
      this.index = this.lineEnd();
      return;
    }
    if (REGION_DIRECTIVE.test(lineText)) {
      this.index = this.lineEnd();
      this.comments.push({ text: lineText, line: this.line, kind: "directive" });
      return;
    }
    this.index++;
    if (!CHECK_DIRECTIVE.test(lineText)) return;
    const text3 = lineText.replace(TRAILING_COMMENT, "");
    this.comments.push({ text: text3, line: this.line, kind: "directive" });
  }
};
var lexCSharp = (source) => new CSharpLexer(source).run();

// src/catalog/languages/css-lexer.ts
var URL_START = /^url\(/i;
var NAME_PART = /[\w-]/;
var cssRanges = (lineComments) => (text3) => {
  const found = [];
  const n = text3.length;
  let i = 0;
  while (i < n) {
    const c = text3[i] ?? "";
    const d = text3[i + 1];
    if (c === "/" && (d === "*" || d === "/" && lineComments)) {
      const end = d === "*" ? blockEnd(text3, i) : lineEnd(text3, i);
      found.push({ start: i, end });
      i = end;
    } else if (c === '"' || c === "'") i = skipQuoted(text3, i, c);
    else if ((c === "u" || c === "U") && URL_START.test(text3.slice(i, i + 4)) && !NAME_PART.test(text3[i - 1] ?? "")) {
      i += 4;
      while (i < n && text3[i] !== ")") {
        const quote = text3[i] ?? "";
        i = quote === '"' || quote === "'" ? skipQuoted(text3, i, quote) : i + 1;
      }
    } else i++;
  }
  return found;
};
var lexCss = commentLexer(cssRanges(false));
var lexScss = commentLexer(cssRanges(true));

// src/catalog/languages/hash-lexers.ts
var HEREDOC = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/;
var SHELL_COMMENT_AFTER = /[\s;&|()]/;
var pythonRanges = (text3) => {
  const found = [];
  const n = text3.length;
  let i = 0;
  while (i < n) {
    const c = text3[i] ?? "";
    if (c === "#") {
      const end = lineEnd(text3, i);
      found.push({ start: i, end });
      i = end;
    } else if (c === '"' || c === "'") {
      const triple = c.repeat(3);
      if (!text3.startsWith(triple, i)) {
        i = skipQuoted(text3, i, c);
        continue;
      }
      i += 3;
      while (i < n && !text3.startsWith(triple, i)) i += text3[i] === "\\" ? 2 : 1;
      i += 3;
    } else i++;
  }
  return found;
};
var skipHeredoc = (text3, from, { tag, strip }) => {
  let i = from;
  while (i < text3.length) {
    const end = lineEnd(text3, i);
    const line = text3.slice(i, end).replace(/\r$/, "");
    if ((strip ? line.replace(/^\t+/, "") : line) === tag) return end + 1;
    i = end + 1;
  }
  return text3.length;
};
var shellRanges = (text3) => {
  const found = [];
  const pending = [];
  const n = text3.length;
  let arithmetic = 0;
  let i = 0;
  while (i < n) {
    const c = text3[i];
    if (c === "\n") {
      i++;
      for (let heredoc = pending.shift(); heredoc !== void 0; heredoc = pending.shift()) i = skipHeredoc(text3, i, heredoc);
    } else if (c === "#" && (i === 0 || SHELL_COMMENT_AFTER.test(text3[i - 1] ?? ""))) {
      const end = lineEnd(text3, i);
      found.push({ start: i, end });
      i = end;
    } else if (c === "\\") i += 2;
    else if (c === "'") i = skipQuoted(text3, i, "'", text3[i - 1] === "$", true);
    else if (c === '"') i = skipQuoted(text3, i, '"', true, true);
    else if (c === "(" && text3[i + 1] === "(") {
      arithmetic++;
      i += 2;
    } else if (c === ")" && text3[i + 1] === ")" && arithmetic > 0) {
      arithmetic--;
      i += 2;
    } else if (c === "<" && text3[i + 1] === "<" && text3[i + 2] !== "<" && arithmetic === 0) {
      const heredoc = HEREDOC.exec(text3.slice(i, i + 200));
      if (heredoc !== null) pending.push({ tag: heredoc[3] ?? "", strip: heredoc[1] === "-" });
      i += heredoc === null ? 2 : heredoc[0].length;
    } else i++;
  }
  return found;
};
var lexPython = commentLexer(pythonRanges);
var lexShell = commentLexer(shellRanges);

// src/catalog/languages/js-lexer.ts
var REGEX_AFTER = /* @__PURE__ */ new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
var TYPE_PARAMETERS = /^<\s*(?:const\s+)?[\p{L}_$][\p{L}\p{N}_$]*\s*(?:extends\b|[,=])/u;
var JSX_START = /[\p{L}_$>]/u;
var jsRanges = (jsx2) => (text3) => {
  const found = [];
  const n = text3.length;
  let i = 0;
  const comment = (end) => {
    found.push({ start: i, end });
    i = end;
  };
  const regex = () => {
    let inClass = false;
    i++;
    while (i < n && text3[i] !== "\n") {
      const c = text3[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      i++;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
    }
    while (i < n && /[a-z]/i.test(text3[i] ?? "")) i++;
  };
  const hole = () => {
    i++;
    code(true);
    i++;
  };
  const template = () => {
    i++;
    while (i < n) {
      const c = text3[i];
      if (c === "\\") i += 2;
      else if (c === "`") {
        i++;
        return;
      } else if (c === "$" && text3[i + 1] === "{") {
        i++;
        hole();
      } else i++;
    }
  };
  const tag = () => {
    while (i < n) {
      const c = text3[i];
      const d = text3[i + 1];
      if (c === "/" && d === ">") {
        i += 2;
        return true;
      }
      if (c === ">") {
        i++;
        return false;
      }
      if (c === "/" && d === "/") comment(lineEnd(text3, i));
      else if (c === "/" && d === "*") comment(blockEnd(text3, i));
      else if (c === '"' || c === "'") i = skipQuoted(text3, i, c, false, true);
      else if (c === "{") hole();
      else i++;
    }
    return false;
  };
  const element = () => {
    let depth = 0;
    while (i < n) {
      i++;
      const closing = text3[i] === "/";
      const selfClosing = tag();
      depth += closing ? -1 : selfClosing ? 0 : 1;
      if (depth <= 0) return;
      while (i < n && text3[i] !== "<") {
        if (text3[i] === "{") hole();
        else i++;
      }
    }
  };
  const code = (braced) => {
    let depth = 0;
    let operand = true;
    while (i < n) {
      const c = text3[i] ?? "";
      const d = text3[i + 1] ?? "";
      if (c === "/" && d === "/") comment(lineEnd(text3, i));
      else if (c === "/" && d === "*") comment(blockEnd(text3, i));
      else if (c === " " || c === "	" || c === "\n" || c === "\r") i++;
      else if (c === '"' || c === "'") {
        i = skipQuoted(text3, i, c);
        operand = false;
      } else if (c === "`") {
        template();
        operand = false;
      } else if (c === "/") {
        if (operand) regex();
        else i++;
        operand = !operand;
      } else if (c === "<" && jsx2 && operand && JSX_START.test(d) && !TYPE_PARAMETERS.test(text3.slice(i, i + 64))) {
        element();
        operand = false;
      } else if (c === "{") {
        depth++;
        i++;
        operand = true;
      } else if (c === "}") {
        if (braced && depth === 0) return;
        depth--;
        i++;
        operand = true;
      } else if (WORD.test(c)) {
        const start = i;
        while (i < n && WORD.test(text3[i] ?? "")) i++;
        operand = REGEX_AFTER.has(text3.slice(start, i));
      } else {
        i++;
        operand = c !== ")" && c !== "]";
      }
    }
  };
  code(false);
  return found;
};
var lexJs = commentLexer(jsRanges(true));
var lexTs = commentLexer(jsRanges(false));

// src/catalog/languages/markup-lexer.ts
var jsx = jsRanges(true);
var ts = jsRanges(false);
var scss = cssRanges(true);
var EMBEDDED = {
  js: jsx,
  jsx,
  mjs: jsx,
  cjs: jsx,
  tsx: jsx,
  ts,
  mts: ts,
  cts: ts,
  css: cssRanges(false),
  scss,
  less: scss
};
var TAG_START = /[a-zA-Z/!]/;
var EMBEDDED_BLOCK = /^<(script|style)[\s>]/;
var LANG = /\blang\s*=\s*["']?(\w+)/;
var SFC_TAG = /<(?:script|template|style)\b/i;
var tagEnd = (text3, from) => {
  let i = from;
  while (i < text3.length && text3[i] !== ">") {
    const c = text3[i] ?? "";
    i = c === '"' || c === "'" ? skipQuoted(text3, i, c, false, true) : i + 1;
  }
  return i + 1;
};
var markupRanges = (text3) => {
  const found = [];
  const lower = text3.toLowerCase();
  const n = text3.length;
  let i = 0;
  while (i < n) {
    if (text3.startsWith("<!--", i)) {
      const close2 = text3.indexOf("-->", i + 4);
      const end = close2 === -1 ? n : close2 + 3;
      found.push({ start: i, end });
      i = end;
      continue;
    }
    if (text3[i] !== "<" || !TAG_START.test(text3[i + 1] ?? "")) {
      i++;
      continue;
    }
    const bodyStart = tagEnd(text3, i);
    const block = EMBEDDED_BLOCK.exec(lower.slice(i, i + 8))?.[1];
    if (block === void 0) {
      i = bodyStart;
      continue;
    }
    const close = lower.indexOf(`</${block}`, bodyStart);
    const bodyEnd = close === -1 ? n : close;
    const lang = LANG.exec(lower.slice(i, bodyStart))?.[1] ?? (block === "script" ? "js" : "css");
    const lex = EMBEDDED[lang];
    for (const { start, end } of lex === void 0 ? [] : lex(text3.slice(bodyStart, bodyEnd))) {
      found.push({ start: start + bodyStart, end: end + bodyStart });
    }
    i = bodyEnd;
  }
  return found;
};
var overlaps = (range, others) => others.some((other) => range.start < other.end && other.start < range.end);
var vueRanges = (text3) => {
  const markup = markupRanges(text3);
  if (SFC_TAG.test(text3)) return markup;
  return [...markup, ...jsx(text3).filter((range) => !overlaps(range, markup))];
};
var lexMarkup = commentLexer(markupRanges);
var lexVue = commentLexer(vueRanges);

// src/catalog/languages/index.ts
var isScriptTestPath = createMatcher(["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", "**/__tests__/**"]);
var TEST_SEGMENT = /^(?:tests?|__tests__|_tests_|spec)$/i;
var TEST_AFFIX = /^[Tt]ests?(?![a-z])|(?:^|[^A-Za-z])[Tt]ests?$|[a-z\d]Tests?$/;
var isTestSegmentPath = (file) => {
  const segments = file.replace(/\\/g, "/").split("/");
  const name = segments.pop() ?? "";
  return [...segments, name.slice(0, name.length - extname(name).length)].some((segment) => TEST_SEGMENT.test(segment) || TEST_AFFIX.test(segment));
};
var CSHARP_TEST_ATTRIBUTE = String.raw`\[\s*(?:\w+\.)*(?:Fact|Theory|Test|TestCase|TestCaseSource|TestMethod|DataTestMethod)(?:Attribute)?(?=\s*[(\],])`;
var CSHARP_TEST_CASE = String.raw`(?<![\w)]\s*)(?<!${CSHARP_TEST_ATTRIBUTE}[^\n]*\]\s*)${CSHARP_TEST_ATTRIBUTE}`;
var SCRIPT_TESTS = {
  isTestPath: isScriptTestPath,
  testCase: /(?<![\w$.])(?:it|test)(?:\.\w+)*\s*\(/g,
  testFile: /^\s*(?:describe|it|test)(?:\.\w+)*\s*(?:\([^\n]*?\)\s*)?\(\s*['"`]/m
};
var LANGUAGES = [
  { name: "javascript", extensions: [".ts", ".mts", ".cts"], lexComments: lexTs, ...SCRIPT_TESTS },
  { name: "javascript", extensions: [".tsx", ".js", ".jsx", ".mjs", ".cjs"], lexComments: lexJs, ...SCRIPT_TESTS },
  { name: "vue", extensions: [".vue"], lexComments: lexVue },
  { name: "html", extensions: [".html", ".htm", ".svelte"], lexComments: lexMarkup },
  { name: "css", extensions: [".css"], lexComments: lexCss },
  { name: "scss", extensions: [".scss", ".less"], lexComments: lexScss },
  { name: "python", extensions: [".py", ".pyi"], lexComments: lexPython },
  { name: "shell", extensions: [".sh", ".bash", ".zsh"], lexComments: lexShell },
  { name: "rust", extensions: [".rs"], lexComments: lexRust },
  { name: "go", extensions: [".go"], lexComments: lexGo },
  {
    name: "csharp",
    extensions: [".cs"],
    lexComments: lexCSharp,
    isTestPath: isTestSegmentPath,
    testCase: new RegExp(CSHARP_TEST_CASE, "g"),
    testFile: new RegExp(CSHARP_TEST_CASE)
  }
];
var SCRIPT_FILES = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}"];
var TYPED_FILES = ["**/*.{ts,tsx,mts,cts,vue}"];
var languageFor = (file) => {
  const extension = extname(file).toLowerCase();
  return LANGUAGES.find((language) => language.extensions.includes(extension));
};
var fileSource = (root, file) => () => {
  try {
    return readFileSync3(join3(root, file), "utf8");
  } catch {
    return void 0;
  }
};
var isTestFile = (file, source) => {
  const language = languageFor(file);
  if ((language?.isTestPath ?? isScriptTestPath)(file)) return true;
  const pattern = language?.testFile;
  if (pattern === void 0 || source === void 0) return false;
  const text3 = source();
  return text3 !== void 0 && pattern.test(text3);
};
var lexComments = (file, source) => languageFor(file)?.lexComments(source);

// src/catalog/proofs/proof.ts
var PROOF_KINDS = ["behavior", "look"];
var defineCheck = (definition) => definition;

// src/catalog/proofs/agent-view.ts
var AGENT_VIEW_CONFIG = "agent-view.config.json";
var AGENT_VIEW_BINARY = {
  key: "agentView",
  label: "agent-view",
  command: "agent-view",
  packages: ["@petukhovart/agent-view"],
  configs: [AGENT_VIEW_CONFIG],
  requiresConfig: true
};
var MARKUP_FILES = ["**/*.{vue,tsx,jsx,svelte,html}"];
var STYLE_FILES = ["**/*.{css,scss,less}"];
var isMarkup = createMatcher(MARKUP_FILES);
var isStyle = createMatcher(STYLE_FILES);
var isUiFile = (file) => isMarkup(file) || isStyle(file);
var PROOFS = [
  ["behavior", /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+act\s+replay\b/],
  ["look", /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+(?:screenshot|snap)\b/]
];
var requires = (file, source) => {
  if (isTestFile(file, source)) return [];
  if (isMarkup(file)) return ["behavior", "look"];
  if (isStyle(file)) return ["look"];
  return [];
};
var agentViewCheck = defineCheck({
  name: "agent-view",
  binaries: [AGENT_VIEW_BINARY],
  files: [...MARKUP_FILES, ...STYLE_FILES],
  setup: ["agent-view init"],
  requires,
  proves: (command) => PROOFS.filter(([, pattern]) => pattern.test(command)).map(([kind]) => kind),
  hints: {
    behavior: "agent-view act replay <use case>",
    look: "agent-view screenshot"
  }
});

// src/catalog/proofs/index.ts
var PROOFS2 = [agentViewCheck];

// src/catalog/tools/directives.ts
var DIRECTIVE_ONLY_TOOLS = [
  { name: "biome", comments: { suppressions: [/\bbiome-ignore\b/] } },
  {
    name: "roslyn",
    comments: {
      suppressions: [/^#\s*pragma\s+warning\s+disable\b/, /^#\s*nullable\s+disable\b/],
      allowed: [/^#\s*nullable\b/]
    }
  },
  { name: "resharper", comments: { suppressions: [/\bReSharper\s+disable\b/] } }
];

// src/catalog/tools/eslint.ts
import { dirname as dirname5, resolve as resolve4 } from "node:path";

// src/tools/tool.ts
import { statSync as statSync2 } from "node:fs";
import { dirname as dirname4, join as join5, relative as relative3, resolve as resolve3 } from "node:path";

// src/core/proc.ts
import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync4, realpathSync, rmSync as rmSync2, statSync, writeFileSync as writeFileSync3 } from "node:fs";
import { setPriority } from "node:os";
import { basename, delimiter, dirname as dirname3, extname as extname2, isAbsolute as isAbsolute2, join as join4, relative as relative2, resolve as resolve2 } from "node:path";
var LOW_PRIORITY = 10;
var LOCK_WAIT_MS = 15e3;
var LOCK_STALE_MS = 5 * 60 * 1e3;
var LOCK_POLL_MS = 200;
var KILL_GRACE_MS = 1e3;
var MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
var readPackageJson = (path2) => {
  try {
    return JSON.parse(readFileSync4(path2, "utf8"));
  } catch {
    return void 0;
  }
};
var packageBinName = (pkg) => pkg.split("/").pop() ?? pkg;
var isWithin = (parent, child) => {
  const path2 = relative2(parent, child);
  return path2 === "" || !path2.startsWith("..") && !isAbsolute2(path2);
};
var realPath = (path2) => {
  try {
    return realpathSync.native(path2);
  } catch {
    return resolve2(path2);
  }
};
var searchDirs = (projectRoot) => {
  const start = realPath(projectRoot);
  const gitTop = gitToplevel(start);
  const top = gitTop === void 0 ? void 0 : realPath(gitTop);
  if (top === void 0 || !isWithin(top, start)) return [start];
  const dirs = [start];
  let dir2 = start;
  while (relative2(top, dir2) !== "") {
    const parent = dirname3(dir2);
    if (parent === dir2) break;
    dirs.push(parent);
    dir2 = parent;
  }
  return dirs;
};
var packageBinIn = (dir2, pkg, binName) => {
  const packageDir = join4(dir2, "node_modules", ...pkg.split("/"));
  const manifest = readPackageJson(join4(packageDir, "package.json"));
  const bin = typeof manifest?.bin === "string" ? manifest.bin : manifest?.bin?.[binName];
  if (bin === void 0) return void 0;
  const script = resolve2(packageDir, bin);
  return existsSync3(script) ? [process.execPath, script] : void 0;
};
var resolvePackageBin = (projectRoot, pkg, binName = packageBinName(pkg)) => {
  for (const dir2 of searchDirs(projectRoot)) {
    const bin = packageBinIn(dir2, pkg, binName);
    if (bin !== void 0) return bin;
  }
  return void 0;
};
var isFile = (path2) => {
  try {
    return statSync(path2).isFile();
  } catch {
    return false;
  }
};
var findInPath = (name, env = process.env) => {
  const isWindows2 = process.platform === "win32";
  const pathValue = env["PATH"] ?? env["Path"] ?? "";
  const extensions = isWindows2 && extname2(name) === "" ? (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir2 of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join4(dir2, name + extension.toLowerCase());
      if (isFile(candidate)) return candidate;
    }
  }
  return void 0;
};
var SHIM_EXTENSIONS = /* @__PURE__ */ new Set([".cmd", ".bat"]);
var SCRIPT_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".mjs", ".cjs"]);
var SHIM_TARGET = /"%(?:~dp0|dp0%)\\([^"%]+)"/gi;
var SHIM_VARIABLE = /^\s*SET\s+"(\w+)=%~dp0\\([^"%]+)"/gim;
var SHIM_VARIABLE_USE = /"%NODE_EXE%"\s+"%(\w+)%"/gi;
var NODE_EXECUTABLE = /^node(?:\.exe)?$/i;
var isShim = (path2) => SHIM_EXTENSIONS.has(extname2(path2).toLowerCase());
var readText = (path2) => {
  try {
    return readFileSync4(path2, "utf8");
  } catch {
    return void 0;
  }
};
var shimVariables = (text3) => new Map([...text3.matchAll(SHIM_VARIABLE)].map((match) => [(match[1] ?? "").toUpperCase(), match[2] ?? ""]));
var variableTargets = (text3) => {
  const variables = shimVariables(text3);
  return [...text3.matchAll(SHIM_VARIABLE_USE)].flatMap((match) => variables.get((match[1] ?? "").toUpperCase()) ?? []);
};
var resolveShimTarget = (shimPath) => {
  const text3 = readText(shimPath) ?? "";
  const direct = [...text3.matchAll(SHIM_TARGET)].map((match) => match[1] ?? "");
  const targets = [...direct, ...variableTargets(text3)].map((target2) => target2.replace(/\\/g, "/")).filter((target2) => !NODE_EXECUTABLE.test(basename(target2)));
  const target = targets.at(-1);
  if (target === void 0) return void 0;
  const absolute = resolve2(dirname3(shimPath), target);
  if (!isFile(absolute)) return void 0;
  const extension = extname2(absolute).toLowerCase();
  if (SCRIPT_EXTENSIONS.has(extension)) return [process.execPath, absolute];
  return extension === ".exe" ? [absolute] : void 0;
};
var isPathCommand = (command) => isAbsolute2(command) || /[\\/]/.test(command);
var resolvePathCommand = (projectRoot, command) => {
  const path2 = resolve2(projectRoot, command);
  if (!isFile(path2)) return void 0;
  if (isShim(path2)) return resolveShimTarget(path2);
  return SCRIPT_EXTENSIONS.has(extname2(path2).toLowerCase()) ? [process.execPath, path2] : [path2];
};
var resolveBin = (projectRoot, pkgs, command) => {
  if (isPathCommand(command)) return resolvePathCommand(projectRoot, command);
  for (const pkg of pkgs) {
    const bin = resolvePackageBin(projectRoot, pkg, command);
    if (bin !== void 0) return bin;
  }
  const local = searchDirs(projectRoot).map((dir2) => findInPath(command, { PATH: join4(dir2, "node_modules", ".bin"), PATHEXT: ".CMD" })).find((path2) => path2 !== void 0);
  if (local !== void 0) return isShim(local) ? resolveShimTarget(local) : [local];
  const found = findInPath(command);
  if (found === void 0) return void 0;
  return isShim(found) ? resolveShimTarget(found) : [found];
};
var findUnresolvedShim = (name, env = process.env) => {
  const found = findInPath(name, env);
  const isUnresolved = found !== void 0 && isShim(found) && resolveShimTarget(found) === void 0;
  return isUnresolved ? found : void 0;
};
var lowerPriority = (pid) => {
  if (pid === void 0) return;
  try {
    setPriority(pid, LOW_PRIORITY);
  } catch {
    return;
  }
};
var isWindows = process.platform === "win32";
var killTree = (child, signal) => {
  if (child.pid === void 0) return;
  if (isWindows) {
    spawnSync2("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};
var run = (argv, options) => {
  const [command, ...args] = argv;
  const startedAt = Date.now();
  if (command === void 0) {
    return Promise.resolve({ code: null, stdout: "", stderr: "", timedOut: false, error: "empty argv", durationMs: 0 });
  }
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      detached: !isWindows
    });
    lowerPriority(child.pid);
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let spawnError;
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        target.push(chunk);
      }
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.stdin.on("error", () => void 0);
    child.stdin.end(options.input ?? "");
    let isSettled = false;
    const settle = (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        durationMs: Date.now() - startedAt
      };
      resolveRun(spawnError === void 0 ? result : { ...result, error: spawnError });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      if (!isWindows) setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS).unref();
    }, options.timeoutMs);
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("exit", (code) => {
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle(code);
      }, KILL_GRACE_MS).unref();
    });
    child.on("close", settle);
  });
};
var isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
var readLock = (path2) => {
  try {
    const value = JSON.parse(readFileSync4(path2, "utf8"));
    const isValid = typeof value.pid === "number" && typeof value.at === "number";
    return isValid ? { pid: value.pid, at: value.at } : void 0;
  } catch {
    return void 0;
  }
};
var lockFileAge = (path2, now) => {
  try {
    return now - statSync(path2).mtimeMs;
  } catch {
    return void 0;
  }
};
var isLockAbandoned = (path2, now = Date.now()) => {
  const info = readLock(path2);
  if (info !== void 0) return now - info.at > LOCK_STALE_MS || !isAlive(info.pid);
  const age = lockFileAge(path2, now);
  return age !== void 0 && age > LOCK_STALE_MS;
};
var tryCreateLock = (path2) => {
  try {
    writeFileSync3(path2, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
};
var transferLock = (path2, pid) => {
  writeFileSync3(path2, JSON.stringify({ pid, at: Date.now() }));
};
var sleep = (ms) => new Promise((done) => setTimeout(done, ms));
var acquireLock = async (path2, waitMs = LOCK_WAIT_MS) => {
  mkdirSync3(dirname3(path2), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (; ; ) {
    if (tryCreateLock(path2)) {
      return { path: path2, release: () => rmSync2(path2, { force: true }) };
    }
    if (isLockAbandoned(path2)) {
      rmSync2(path2, { force: true });
      continue;
    }
    if (Date.now() >= deadline) return void 0;
    await sleep(LOCK_POLL_MS);
  }
};

// src/tools/tool.ts
var defineTool = (definition) => ({
  ...definition,
  rule: `gate/${definition.name}`
});
var isFile2 = (path2) => {
  try {
    return statSync2(path2).isFile();
  } catch {
    return false;
  }
};
var nearestMarker = (projectRoot, file, markers) => {
  const top = resolve3(projectRoot);
  let dir2 = dirname4(resolve3(top, file));
  for (; ; ) {
    const found = markers.map((name) => join5(dir2, name)).find(isFile2);
    if (found !== void 0) return found;
    const parent = dirname4(dir2);
    if (relative3(top, dir2) === "" || parent === dir2 || relative3(top, parent).startsWith("..")) return void 0;
    dir2 = parent;
  }
};
var groupByMarker = (projectRoot, files, markers) => {
  const byMarker = /* @__PURE__ */ new Map();
  const skipped = [];
  for (const file of files) {
    const marker = nearestMarker(projectRoot, file, markers);
    if (marker === void 0) {
      skipped.push(file);
      continue;
    }
    byMarker.set(marker, [...byMarker.get(marker) ?? [], file]);
  }
  return { groups: [...byMarker].map(([marker, groupFiles2]) => ({ marker, files: groupFiles2 })), skipped };
};
var withMarker = (entry, marker) => entry === void 0 || marker === void 0 ? void 0 : { bin: entry.bin, config: marker };
var FAILURE_DETAIL_MAX = 200;
var HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
var firstOutputLine = (text3) => text3.trim().split("\n")[0]?.slice(0, FAILURE_DETAIL_MAX) ?? "";
var settleExit = (invocation, exited) => {
  const { tool, okCodes, parse: parse2 } = invocation;
  const failed2 = (failure) => ({ tool, findings: [], durationMs: exited.durationMs, failure });
  const isOkCode = exited.code !== null && okCodes.includes(exited.code);
  if (!isOkCode) return failed2(`exit ${exited.code}: ${firstOutputLine(exited.errorOutput || exited.output)}`);
  try {
    return { tool, findings: parse2(exited.output), durationMs: exited.durationMs };
  } catch (error) {
    return failed2(error instanceof Error ? error.message : String(error));
  }
};
var runTool = async (invocation) => {
  const { tool, argv, cwd, timeoutMs } = invocation;
  const result = await run(argv, { cwd, timeoutMs });
  if (result.timedOut) return { tool, findings: [], durationMs: result.durationMs, failure: `timeout after ${timeoutMs} ms` };
  if (result.error !== void 0) return { tool, findings: [], durationMs: result.durationMs, failure: result.error };
  return settleExit(invocation, { code: result.code, output: result.stdout, errorOutput: result.stderr, durationMs: result.durationMs });
};
var parseDiffLines = (diff) => {
  const lines2 = /* @__PURE__ */ new Map();
  let current;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path2 = line.slice(4).trimEnd();
      current = path2 === "/dev/null" ? void 0 : /* @__PURE__ */ new Set();
      if (current !== void 0) {
        lines2.set(path2, current);
      }
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk === null || current === void 0) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === void 0 ? 1 : Number(hunk[2]);
    for (let at = start; at < start + count; at++) {
      current.add(at);
    }
  }
  return lines2;
};
var changedLines = (projectRoot, files) => {
  const result = /* @__PURE__ */ new Map();
  if (files.length === 0) return result;
  const listed = git(["ls-files", "-z", "--", ...files], projectRoot);
  const tracked = new Set(listed.ok ? listed.stdout.split("\0").filter(Boolean) : []);
  const diff = git(
    ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--unified=0", "--relative", "--no-prefix", "HEAD", "--", ...files],
    projectRoot
  );
  const diffLines = diff.ok ? parseDiffLines(diff.stdout) : /* @__PURE__ */ new Map();
  for (const file of files) {
    const isWholeFile = !diff.ok || !tracked.has(file);
    result.set(file, isWholeFile ? "all" : diffLines.get(file) ?? /* @__PURE__ */ new Set());
  }
  return result;
};
var isOnChangedLine = (lines2, line) => lines2 === "all" || lines2?.has(line) === true;
var keepOnChangedLines = (projectRoot, findings) => {
  if (findings.length === 0) return [];
  const lines2 = changedLines(projectRoot, [...new Set(findings.map((finding) => finding.file))]);
  return findings.filter((finding) => isOnChangedLine(lines2.get(finding.file), finding.line));
};

// src/catalog/tools/eslint.ts
var ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml"
];
var ESLINT_TIMEOUT_MS = 3e4;
var ESLINT_FILE_MS = 1e3;
var OK_CODES = [0, 1];
var ERROR_SEVERITY = 2;
var parseEslint = (stdout, projectRoot, cwd = projectRoot) => {
  if (stdout.trim() === "") return [];
  const results = JSON.parse(stdout);
  return results.flatMap((result) => {
    const file = toProjectPath(projectRoot, resolve4(cwd, result.filePath ?? ""));
    return (result.messages ?? []).map((message) => ({
      tool: "eslint",
      rule: message.ruleId ?? "eslint",
      severity: message.severity === ERROR_SEVERITY ? "error" : "warn",
      file,
      line: message.line ?? 1,
      message: message.message ?? ""
    }));
  });
};
var runEslint = (tool, projectRoot, files, timeoutMs, cwd = projectRoot) => runTool({
  tool: "eslint",
  argv: [
    ...tool.bin,
    "--format",
    "json",
    "--cache",
    "--cache-location",
    `${toSlash(jigPaths(projectRoot).eslintCache)}/`,
    "--no-warn-ignored",
    ...files.map((file) => cwd === projectRoot ? file : resolve4(projectRoot, file))
  ],
  cwd,
  timeoutMs,
  okCodes: OK_CODES,
  parse: (stdout) => parseEslint(stdout, projectRoot, cwd)
});
var eslintTool = defineTool({
  name: "eslint",
  binaries: [{ key: "eslint", label: "eslint", command: "eslint", packages: ["eslint"], configs: ESLINT_CONFIGS, requiresConfig: true }],
  files: SCRIPT_FILES,
  parse: parseEslint,
  comments: {
    suppressions: [/\beslint-disable(?:-next-line|-line)?\b/, /^\/\*\s*eslint\s+[\w@/-]+\s*:/]
  },
  stop: async (tools, input) => {
    const entry = tools.eslint;
    if (entry === void 0) return { runs: [], findings: [] };
    const { groups, skipped } = groupByMarker(input.projectRoot, input.files, ESLINT_CONFIGS);
    for (const file of skipped) {
      input.notes.push({ kind: "gate-skipped", tool: "jig", rule: "gate/eslint", file, message: "no eslint config above the file" });
    }
    const runs = [];
    for (const group of groups) {
      const timeoutMs = input.budget(ESLINT_TIMEOUT_MS + ESLINT_FILE_MS * group.files.length);
      if (timeoutMs === 0) break;
      runs.push(await runEslint({ bin: entry.bin, config: group.marker }, input.projectRoot, group.files, timeoutMs, dirname5(group.marker)));
    }
    const errors = runs.flatMap((toolRun) => toolRun.findings).filter((finding) => finding.severity === "error");
    return { runs, findings: keepOnChangedLines(input.projectRoot, errors) };
  }
});

// src/catalog/tools/oxlint.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { resolve as resolve5 } from "node:path";
var OXLINT_CONFIGS = [".oxlintrc.json", "oxlint.json", "oxlintrc.json"];
var OK_CODES2 = [0, 1];
var lineAtOffset = (path2, offset) => {
  try {
    return readFileSync5(path2, "utf8").slice(0, offset).split("\n").length;
  } catch {
    return 1;
  }
};
var startLine = (diagnostic, absolutePath) => {
  const span = diagnostic.labels?.[0]?.span;
  if (span?.line !== void 0) return span.line;
  if (span?.offset !== void 0) return lineAtOffset(absolutePath, span.offset);
  return 1;
};
var diagnosticsOf = (stdout) => {
  if (stdout.trim() === "") return [];
  const value = JSON.parse(stdout);
  if (Array.isArray(value)) return value;
  const diagnostics = value.diagnostics;
  return Array.isArray(diagnostics) ? diagnostics : [];
};
var parseOxlint = (stdout, projectRoot, cwd = projectRoot) => diagnosticsOf(stdout).map((diagnostic) => {
  const absolutePath = resolve5(cwd, diagnostic.filename ?? "");
  return {
    tool: "oxlint",
    rule: diagnostic.ruleId ?? diagnostic.code ?? "oxlint",
    severity: diagnostic.severity === "error" ? "error" : "warn",
    file: toProjectPath(projectRoot, absolutePath),
    line: startLine(diagnostic, absolutePath),
    message: diagnostic.message ?? ""
  };
});
var runOxlint = (tool, projectRoot, file, timeoutMs) => runTool({
  tool: "oxlint",
  argv: [...tool.bin, "--format", "json", "-c", tool.config, file],
  cwd: projectRoot,
  timeoutMs,
  okCodes: OK_CODES2,
  parse: (stdout) => parseOxlint(stdout, projectRoot)
});
var oxlintTool = defineTool({
  name: "oxlint",
  binaries: [{ key: "oxlint", label: "oxlint", command: "oxlint", packages: ["oxlint"], configs: OXLINT_CONFIGS, requiresConfig: true }],
  files: SCRIPT_FILES,
  parse: parseOxlint,
  comments: { suppressions: [/\boxlint-disable(?:-next-line|-line)?\b/] },
  edit: async (tools, projectRoot, file, timeoutMs) => {
    const entry = withMarker(tools.oxlint, nearestMarker(projectRoot, file, OXLINT_CONFIGS));
    if (entry === void 0) return void 0;
    const result = await runOxlint(entry, projectRoot, file, timeoutMs);
    const errors = result.findings.filter((finding) => finding.severity === "error");
    if (errors.length === 0) return { ...result, findings: [] };
    const lines2 = changedLines(projectRoot, [file]).get(file);
    return { ...result, findings: errors.filter((finding) => isOnChangedLine(lines2, finding.line)) };
  }
});

// src/catalog/tools/stratum.ts
var STRATUM_CONFIG = "stratum.config.jsonc";
var STRATUM_TIMEOUT_MS = 15e3;
var CONTRACT_VERSION = 1;
var OK_CODES3 = [0, 1, 3];
var SEVERITIES = { error: "error", warning: "warn" };
var toFinding = (record2) => {
  const severity = SEVERITIES[record2.severity ?? ""];
  const isUsable = record2.v === CONTRACT_VERSION && severity !== void 0 && record2.rule !== void 0 && record2.file !== void 0;
  if (!isUsable) return void 0;
  return {
    tool: "stratum",
    rule: record2.rule,
    severity,
    file: record2.file,
    line: record2.line ?? 1,
    message: record2.message ?? "",
    ...record2.fix ? { fix: record2.fix } : {}
  };
};
var parseStratum = (stdout) => stdout.split("\n").filter((line) => line.trim() !== "").map((line) => toFinding(JSON.parse(line))).filter((finding) => finding !== void 0);
var runStratum = (tool, projectRoot, files, timeoutMs) => runTool({
  tool: "stratum",
  argv: [...tool.bin, "--format", "jsonl", "--config", tool.config, "--files", ...files],
  cwd: projectRoot,
  timeoutMs,
  okCodes: OK_CODES3,
  parse: parseStratum
});
var stratumTool = defineTool({
  name: "stratum",
  binaries: [
    {
      key: "stratum",
      label: "stratum",
      command: "stratum-lint",
      packages: ["@petukhovart/stratum-lint"],
      configs: [STRATUM_CONFIG],
      requiresConfig: true
    }
  ],
  files: SCRIPT_FILES,
  setup: ["stratum-lint init", "stratum-lint baseline"],
  parse: (stdout) => parseStratum(stdout),
  comments: { suppressions: [/\bstratum-ignore\b/] },
  edit: async (tools, projectRoot, file, timeoutMs) => {
    const entry = withMarker(tools.stratum, nearestMarker(projectRoot, file, [STRATUM_CONFIG]));
    if (entry === void 0) return void 0;
    return runStratum(entry, projectRoot, [file], timeoutMs);
  },
  stop: async (tools, input) => {
    const entry = tools.stratum;
    if (entry === void 0) return { runs: [], findings: [] };
    const { groups, skipped } = groupByMarker(input.projectRoot, input.files, [STRATUM_CONFIG]);
    for (const file of skipped) {
      input.notes.push({ kind: "gate-skipped", tool: "jig", rule: "gate/stratum", file, message: "no stratum config above the file" });
    }
    const runs = [];
    for (const group of groups) {
      const timeoutMs = input.budget(STRATUM_TIMEOUT_MS);
      if (timeoutMs === 0) break;
      runs.push(await runStratum({ bin: entry.bin, config: group.marker }, input.projectRoot, group.files, timeoutMs));
    }
    return { runs, findings: runs.flatMap((toolRun) => toolRun.findings) };
  }
});

// src/catalog/tools/tsc.ts
import { createHash } from "node:crypto";
import { mkdirSync as mkdirSync5, readFileSync as readFileSync7, statSync as statSync3, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname7, extname as extname3, join as join6, relative as relative4, resolve as resolve6 } from "node:path";

// src/core/jsonc.ts
var BOM = "\uFEFF";
var isWhitespace = (char) => char === " " || char === "	" || char === "\n" || char === "\r";
var blank = (text3) => text3.replace(/[^\n]/g, " ");
var skipString = (text3, start) => {
  let index = start + 1;
  while (index < text3.length) {
    const char = text3[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') return index + 1;
    index++;
  }
  return index;
};
var commentEnd = (text3, start) => {
  const next = text3[start + 1];
  if (next === "/") {
    const newline = text3.indexOf("\n", start);
    return newline === -1 ? text3.length : newline;
  }
  if (next === "*") {
    const close = text3.indexOf("*/", start + 2);
    if (close === -1) throw new SyntaxError("unterminated block comment");
    return close + 2;
  }
  return void 0;
};
var stripComments = (text3) => {
  let output = "";
  let index = 0;
  while (index < text3.length) {
    const char = text3[index];
    if (char === '"') {
      const end2 = skipString(text3, index);
      output += text3.slice(index, end2);
      index = end2;
      continue;
    }
    const end = char === "/" ? commentEnd(text3, index) : void 0;
    if (end !== void 0) {
      output += blank(text3.slice(index, end));
      index = end;
      continue;
    }
    output += char;
    index++;
  }
  return output;
};
var stripTrailingCommas = (text3) => {
  const chars = text3.split("");
  let index = 0;
  while (index < chars.length) {
    const char = chars[index];
    if (char === '"') {
      index = skipString(text3, index);
      continue;
    }
    if (char === ",") {
      let next = index + 1;
      while (isWhitespace(chars[next])) next++;
      const isTrailing = chars[next] === "}" || chars[next] === "]";
      if (isTrailing) {
        chars[index] = " ";
      }
    }
    index++;
  }
  return chars.join("");
};
var parseJsonc = (text3) => {
  const source = text3.startsWith(BOM) ? text3.slice(1) : text3;
  return JSON.parse(stripTrailingCommas(stripComments(source)));
};

// src/tools/detach.ts
import { spawn as spawn2 } from "node:child_process";
import { mkdirSync as mkdirSync4, readFileSync as readFileSync6 } from "node:fs";
import { setPriority as setPriority2 } from "node:os";
import { dirname as dirname6 } from "node:path";
var WRAPPER = [
  "const { spawn } = require('node:child_process')",
  "const { closeSync, openSync, readFileSync, rmSync } = require('node:fs')",
  "const { setPriority } = require('node:os')",
  "const [lockPath, outputPath, priority, command, ...args] = process.argv.slice(1)",
  "const output = openSync(outputPath, 'w')",
  "const child = spawn(command, args, { stdio: ['ignore', output, output], windowsHide: true })",
  "try { setPriority(child.pid, Number(priority)) } catch {}",
  "const releaseOwnLock = () => {",
  "  try { if (JSON.parse(readFileSync(lockPath, 'utf8')).pid === process.pid) rmSync(lockPath, { force: true }) } catch {}",
  "}",
  "const finish = (code) => { closeSync(output); releaseOwnLock(); process.exit(code ?? 1) }",
  "child.on('error', () => finish(1))",
  "child.on('exit', (code) => finish(code))"
].join("\n");
var readOutput = (path2) => {
  try {
    return readFileSync6(path2, "utf8");
  } catch {
    return "";
  }
};
var lowerPriority2 = (pid) => {
  if (pid === void 0) return;
  try {
    setPriority2(pid, LOW_PRIORITY);
  } catch {
    return;
  }
};
var runDetachable = (invocation) => {
  const { tool, argv, cwd, timeoutMs, outputPath, lockPath } = invocation;
  mkdirSync4(dirname6(outputPath), { recursive: true });
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  return new Promise((resolveRun) => {
    let isSettled = false;
    const settle = (result) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      resolveRun(result);
    };
    const child = spawn2(process.execPath, ["-e", WRAPPER, lockPath ?? "", outputPath, String(LOW_PRIORITY), ...argv], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    lowerPriority2(child.pid);
    const timer = setTimeout(() => {
      child.unref();
      const pid = child.pid;
      settle({
        tool,
        findings: [],
        durationMs: elapsed(),
        failure: `timeout after ${timeoutMs} ms, detached (pid ${pid}) to finish the incremental cache`,
        ...pid === void 0 ? {} : { detachedPid: pid }
      });
    }, timeoutMs);
    child.on("error", (error) => settle({ tool, findings: [], durationMs: elapsed(), failure: error.message }));
    child.on("exit", (code) => {
      const output = readOutput(outputPath);
      settle(settleExit(invocation, { code, output, errorOutput: output, durationMs: elapsed() }));
    });
  });
};

// src/catalog/tools/tsc.ts
var TYPED_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".vue"]);
var TSCONFIG = "tsconfig.json";
var TYPES_TIMEOUT_MS = 6e4;
var OK_CODES4 = [0, 1, 2];
var HASH_LENGTH = 12;
var TSC_ERROR = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
var GLOBAL_ERROR = /error TS\d+: .*/;
var WILDCARD = /[*?]/;
var DEFAULT_INCLUDE = ["**/*"];
var isTypedFile = (file) => TYPED_EXTENSIONS.has(extname3(file)) && !file.endsWith(".d.ts");
var isFile3 = (path2) => {
  try {
    return statSync3(path2).isFile();
  } catch {
    return false;
  }
};
var readTsconfig = (path2) => {
  const value = parseJsonc(readFileSync7(path2, "utf8"));
  return typeof value === "object" && value !== null ? value : {};
};
var stringsOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : void 0;
var findNearestTsconfig = (projectRoot, file) => {
  const top = resolve6(projectRoot);
  let dir2 = dirname7(resolve6(projectRoot, file));
  for (; ; ) {
    const candidate = join6(dir2, TSCONFIG);
    if (isFile3(candidate)) return candidate;
    const isTop = relative4(top, dir2) === "";
    const parent = dirname7(dir2);
    if (isTop || parent === dir2) return void 0;
    dir2 = parent;
  }
};
var toIncludeGlob = (pattern) => {
  const clean = toSlash(pattern).replace(/^\.\//, "").replace(/\/$/, "");
  const lastSegment = clean.split("/").pop() ?? "";
  const isDirectory2 = !WILDCARD.test(clean) && !lastSegment.includes(".");
  return isDirectory2 ? `${clean}/**/*` : clean;
};
var covers = (configPath, absoluteFile) => {
  const config = readTsconfig(configPath);
  const path2 = toSlash(relative4(dirname7(configPath), absoluteFile));
  const files = stringsOf(config.files) ?? [];
  if (files.some((entry) => toSlash(entry).replace(/^\.\//, "") === path2)) return true;
  const include = stringsOf(config.include) ?? (config.files === void 0 ? DEFAULT_INCLUDE : []);
  return include.length > 0 && matchGlob(path2, include.map(toIncludeGlob));
};
var referencePath = (fromConfig, reference) => {
  const path2 = reference?.path;
  if (typeof path2 !== "string") return void 0;
  const target = resolve6(dirname7(fromConfig), path2);
  return isFile3(target) ? target : join6(target, TSCONFIG);
};
var isSolutionConfig = (config) => Array.isArray(config.files) && config.files.length === 0 && Array.isArray(config.references);
var selectTsconfig = (configPath, absoluteFile) => {
  const config = readTsconfig(configPath);
  if (!isSolutionConfig(config)) return configPath;
  for (const reference of config.references) {
    const target = referencePath(configPath, reference);
    if (target !== void 0 && isFile3(target) && covers(target, absoluteFile)) return target;
  }
  return void 0;
};
var groupByTsconfig = (projectRoot, files) => {
  const byConfig = /* @__PURE__ */ new Map();
  const skipped = [];
  for (const file of files.filter(isTypedFile)) {
    const nearest = findNearestTsconfig(projectRoot, file);
    const selected = nearest === void 0 ? void 0 : selectTsconfig(nearest, resolve6(projectRoot, file));
    if (selected === void 0) {
      skipped.push(file);
      continue;
    }
    byConfig.set(selected, [...byConfig.get(selected) ?? [], file]);
  }
  return { groups: [...byConfig].map(([config, groupFiles2]) => ({ config, files: groupFiles2 })), skipped };
};
var tsconfigHash = (configPath) => createHash("sha1").update(configPath).digest("hex").slice(0, HASH_LENGTH);
var closureConfig = (projectRoot, group) => {
  const configDir = toSlash(dirname7(group.config));
  const hash = tsconfigHash(group.config);
  return {
    extends: toSlash(group.config),
    files: group.files.map((file) => toSlash(resolve6(projectRoot, file))),
    include: [`${configDir}/*.d.ts`, `${configDir}/src/**/*.d.ts`],
    compilerOptions: {
      noEmit: true,
      incremental: true,
      composite: false,
      tsBuildInfoFile: `${toSlash(jigPaths(projectRoot).tscCache)}/${hash}.tsbuildinfo`
    }
  };
};
var writeClosureConfig = (projectRoot, group) => {
  const dir2 = jigPaths(projectRoot).tscCache;
  mkdirSync5(dir2, { recursive: true });
  const path2 = join6(dir2, `tsconfig.${tsconfigHash(group.config)}.json`);
  writeFileSync4(path2, `${JSON.stringify(closureConfig(projectRoot, group), null, 2)}
`);
  return path2;
};
var pathKey = (path2) => process.platform === "win32" ? path2.toLowerCase() : path2;
var parseTscOutput = (stdout, tool, projectRoot, cwd = projectRoot) => stdout.split("\n").map((line) => TSC_ERROR.exec(line.trimEnd())).filter((match) => match !== null).map(([, file = "", line = "1", , code = "", message = ""]) => ({
  tool,
  rule: code,
  severity: "error",
  file: toProjectPath(projectRoot, resolve6(cwd, file)),
  line: Number(line),
  message
}));
var keepGroupFindings = (findings, files) => {
  const keys = new Set(files.map(pathKey));
  return findings.filter((finding) => keys.has(pathKey(finding.file)));
};
var checkerFor = (checkers, group) => {
  const hasVue = group.files.some((file) => file.endsWith(".vue"));
  const isVueTscFirst = hasVue || checkers.tsc === void 0;
  if (isVueTscFirst && checkers.vueTsc !== void 0) return { tool: "vue-tsc", bin: checkers.vueTsc.bin, files: group.files };
  if (checkers.tsc === void 0) return void 0;
  const files = group.files.filter((file) => !file.endsWith(".vue"));
  return files.length === 0 ? void 0 : { tool: "tsc", bin: checkers.tsc.bin, files };
};
var runTypeCheck = async (checkers, projectRoot, group, timeoutMs, lockPath) => {
  const checker = checkerFor(checkers, group);
  if (checker === void 0) return void 0;
  const config = writeClosureConfig(projectRoot, { config: group.config, files: checker.files });
  const argv = checker.tool === "vue-tsc" ? [...checker.bin, "--noEmit", "-p", config] : [...checker.bin, "-p", config, "--pretty", "false"];
  return runDetachable({
    tool: checker.tool,
    argv,
    cwd: projectRoot,
    timeoutMs,
    outputPath: join6(jigPaths(projectRoot).tscCache, `${tsconfigHash(group.config)}.out`),
    ...lockPath === void 0 ? {} : { lockPath },
    okCodes: OK_CODES4,
    parse: (stdout) => {
      const findings = parseTscOutput(stdout, checker.tool, projectRoot);
      const globalError = findings.length === 0 ? GLOBAL_ERROR.exec(stdout)?.[0] : void 0;
      if (globalError !== void 0) throw new Error(globalError);
      return keepGroupFindings(findings, checker.files);
    }
  });
};
var tscTool = defineTool({
  name: "tsc",
  binaries: [
    { key: "tsc", label: "tsc", command: "tsc", packages: ["typescript"], configs: [TSCONFIG], requiresConfig: false },
    { key: "vueTsc", label: "vue-tsc", command: "vue-tsc", packages: ["vue-tsc"], configs: [TSCONFIG], requiresConfig: false }
  ],
  files: TYPED_FILES,
  parse: (stdout, projectRoot, cwd) => parseTscOutput(stdout, "tsc", projectRoot, cwd),
  comments: { suppressions: [/@ts-(?:ignore|expect-error|nocheck)\b/] },
  stop: async (tools, input) => {
    const { groups, skipped } = groupByTsconfig(input.projectRoot, input.files);
    for (const file of skipped) {
      input.notes.push({ kind: "gate-skipped", tool: "jig", rule: "gate/tsc", file, message: "no tsconfig covers the file" });
    }
    const runs = [];
    for (const group of groups) {
      const timeoutMs = input.budget(TYPES_TIMEOUT_MS);
      if (timeoutMs === 0) break;
      const toolRun = await runTypeCheck(tools, input.projectRoot, group, timeoutMs, input.lock.path);
      if (toolRun === void 0) continue;
      runs.push(toolRun);
      if (toolRun.detachedPid !== void 0) {
        input.lock.transfer(toolRun.detachedPid);
        break;
      }
    }
    return { runs, findings: keepOnChangedLines(input.projectRoot, runs.flatMap((toolRun) => toolRun.findings)) };
  }
});

// src/catalog/tools/index.ts
var TOOLS = [oxlintTool, tscTool, eslintTool, stratumTool];
var DIRECTIVE_SOURCES = [...TOOLS, ...DIRECTIVE_ONLY_TOOLS];

// src/catalog/index.ts
var LOCKFILES = lockfiles_default;
var isLockfile = createMatcher(LOCKFILES.map((lockfile) => `**/${lockfile.file}`));
var CATALOG = [
  ...TOOLS.map((tool) => ({ kind: "tool", name: tool.name, binaries: tool.binaries, setup: tool.setup ?? [], tool })),
  ...PROOFS2.map((proof2) => ({ kind: "proof", name: proof2.name, binaries: proof2.binaries, setup: proof2.setup ?? [], proof: proof2 }))
];
var TOOL_NAMES = TOOLS.map((tool) => tool.name);
var PROOF_NAMES = PROOFS2.map((proof2) => proof2.name);
var catalogEntry = (name) => CATALOG.find((entry) => entry.name === name);
var catalogMarkers = (entry) => [...new Set(entry.binaries.flatMap((binary) => binary.configs))];
var ALL_MARKERS = [...new Set(CATALOG.flatMap(catalogMarkers))];
var EXIT_FORMAT = "exit";
var JSONL_FORMAT = "jsonl";
var PARSERS = new Map([
  [JSONL_FORMAT, (stdout) => parseStratum(stdout)],
  ...TOOLS.flatMap((tool) => tool.parse === void 0 ? [] : [[tool.name, tool.parse]])
]);
var OUTPUT_FORMATS = [EXIT_FORMAT, ...PARSERS.keys()];
var outputParser = (format) => PARSERS.get(format);

// src/init/discover.ts
import { readdirSync, readFileSync as readFileSync9 } from "node:fs";
import { join as join8, posix as posix2 } from "node:path";

// src/init/typecheck.ts
import { readFileSync as readFileSync8 } from "node:fs";
import { join as join7, posix } from "node:path";
var ROOT_MANIFEST = "package.json";
var FILE_TAKING_CHECKER = /(^|[\s/\\])ts-decl-check(\.[cm]?js)?(\s|$)/;
var TYPE_CHECK_NAME = /^(typecheck|type-check|types|tsc|check[:-]types?|types?[:-]check|typecheck:.+|type-check:.+)$/;
var SHELL_OPERATOR = /&&|\|\||[|;<>`]|\$\(/;
var TYPED_GLOBS = [
  [".ts", "**/*.ts"],
  [".tsx", "**/*.tsx"],
  [".mts", "**/*.mts"],
  [".cts", "**/*.cts"],
  [".vue", "**/*.vue"]
];
var readScripts = (projectRoot) => {
  try {
    const manifest = JSON.parse(readFileSync8(join7(projectRoot, ROOT_MANIFEST), "utf8"));
    const scripts = manifest["scripts"];
    if (typeof scripts !== "object" || scripts === null) return {};
    return Object.fromEntries(Object.entries(scripts).filter((entry) => typeof entry[1] === "string"));
  } catch {
    return {};
  }
};
var judge = (script, command) => {
  if (SHELL_OPERATOR.test(command)) return { script, command, takesFiles: false, reason: "it uses shell operators, and a check runs without a shell" };
  if (!FILE_TAKING_CHECKER.test(command)) return { script, command, takesFiles: false, reason: "it takes no file list" };
  return { script, command, takesFiles: true, reason: void 0 };
};
var detectTypeCheck = (projectRoot, files) => {
  const scripts = Object.entries(readScripts(projectRoot));
  const takingFiles = scripts.find(([, command]) => FILE_TAKING_CHECKER.test(command) && !SHELL_OPERATOR.test(command));
  const namedLikeTypeCheck = scripts.find(([name, command]) => TYPE_CHECK_NAME.test(name) || FILE_TAKING_CHECKER.test(command));
  const chosen = takingFiles ?? namedLikeTypeCheck;
  const extensions = new Set(files.filter((file) => !file.endsWith(".d.ts")).map((file) => posix.extname(file)));
  const globs = TYPED_GLOBS.filter(([extension]) => extensions.has(extension)).map(([, glob]) => glob);
  return { script: chosen === void 0 ? void 0 : judge(chosen[0], chosen[1]), globs };
};
var TYPES_CHECK_NAME = "types";
var typesCheck = (detection) => {
  const { script, globs } = detection;
  if (script?.takesFiles !== true || globs.length === 0) return void 0;
  return { name: TYPES_CHECK_NAME, files: globs, on: "stop", run: `${script.command} {files}` };
};

// src/init/discover.ts
var SKIPPED_DIRS = /* @__PURE__ */ new Set(["node_modules", "dist", "build", "out", "coverage", "target", "vendor"]);
var WALK_DEPTH = 4;
var DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
var FIXTURE_DIR = /fixture/i;
var isSkippedDir = (part) => SKIPPED_DIRS.has(part) || part === ".git" || FIXTURE_DIR.test(part);
var isSkippedPath = (path2) => path2.split("/").slice(0, -1).some(isSkippedDir);
var walk = (root, dir2 = "", depth = 0) => {
  let entries;
  try {
    entries = readdirSync(join8(root, dir2), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path2 = dir2 === "" ? entry.name : `${dir2}/${entry.name}`;
    if (entry.isFile()) return [path2];
    const isWalked = entry.isDirectory() && depth < WALK_DEPTH && !entry.name.startsWith(".") && !isSkippedDir(entry.name);
    return isWalked ? walk(root, path2, depth + 1) : [];
  });
};
var projectFiles = (projectRoot) => {
  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], projectRoot);
  const files = listed.ok ? listed.stdout.split("\0").filter(Boolean) : walk(projectRoot);
  return files.map((file) => file.replace(/\\/g, "/")).filter((file) => !isSkippedPath(file));
};
var ignoredMarkers = (projectRoot) => {
  const listed = git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"], projectRoot);
  if (!listed.ok) return [];
  const markerNames = new Set(ALL_MARKERS);
  return listed.stdout.split("\0").map((file) => file.replace(/\\/g, "/")).filter((file) => markerNames.has(posix2.basename(file)) && !isSkippedPath(file));
};
var readDependencies = (path2) => {
  try {
    const manifest = JSON.parse(readFileSync9(path2, "utf8"));
    return DEPENDENCY_FIELDS.flatMap((field) => {
      const deps = manifest[field];
      return typeof deps === "object" && deps !== null ? Object.keys(deps) : [];
    });
  } catch {
    return [];
  }
};
var suggestCommand = (entry, declared) => entry.binaries.slice(1).find((binary) => binary.packages.some((pkg) => declared.has(pkg)))?.command;
var inspect = (projectRoot, entry, files, declared) => {
  const markerNames = new Set(catalogMarkers(entry));
  const markers = files.filter((file) => markerNames.has(posix2.basename(file)));
  const packages = [...new Set(entry.binaries.flatMap((binary2) => binary2.packages))].filter((pkg) => declared.has(pkg));
  if (markers.length === 0 && packages.length === 0) return void 0;
  const command = suggestCommand(entry, declared);
  const binary = entry.binaries.find((candidate) => candidate.command === command) ?? entry.binaries[0];
  const bin = binary === void 0 ? void 0 : resolveBin(projectRoot, binary.packages, binary.command);
  const needsMarker = markerNames.size > 0;
  const status = needsMarker && markers.length === 0 ? "needs-setup" : "ready";
  return {
    name: entry.name,
    kind: entry.kind,
    status,
    markers,
    packages,
    ...command === void 0 ? {} : { command },
    ...bin === void 0 ? {} : { bin },
    setup: entry.setup
  };
};
var discover = (projectRoot) => {
  const files = projectFiles(projectRoot);
  const packageFiles = files.filter((file) => posix2.basename(file) === "package.json");
  const declared = new Set(packageFiles.flatMap((file) => readDependencies(join8(projectRoot, file))));
  const markerFiles = [...files, ...ignoredMarkers(projectRoot)];
  const found = CATALOG.map((entry) => inspect(projectRoot, entry, markerFiles, declared)).filter((item) => item !== void 0);
  return { found, packages: [...declared].sort(), packageFiles, typeCheck: detectTypeCheck(projectRoot, files) };
};
var settingsOf = (config, kind) => kind === "tool" ? config.tools : config.proofs;
var isListed = (config, found) => Object.hasOwn(settingsOf(config, found.kind), found.name);
var unlisted = (config, discovery) => discovery.found.filter((found) => found.status === "ready" && !isListed(config, found));

// src/core/command.ts
var TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;
var splitCommand = (text3) => [...text3.matchAll(TOKEN)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
var expandToken = (argv, placeholder, values) => argv.flatMap((token) => token === placeholder ? [...values] : [token]);

// src/core/config.ts
import { existsSync as existsSync4, readFileSync as readFileSync10 } from "node:fs";
var SEVERITIES2 = ["off", "warn", "error"];
var JIG_RULE_IDS = ["jig/comments", "jig/tests"];
var RULE_IDS = JIG_RULE_IDS;
var DEFAULT_SEVERITY = "error";
var DEFAULT_SEVERITIES = {};
var CHECK_STAGES = ["edit", "stop"];
var RUNTIMES = ["electron", "tauri", "browser", "none"];
var VERIFY_RUNTIMES = ["electron", "tauri", "browser"];
var DEFAULT_PORT_TARGET = ".env";
var MAX_PORT = 65535;
var FORGES = ["gitlab", "github"];
var IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
var childPath = (path2, key) => {
  if (typeof key === "number") return `${path2}[${key}]`;
  return IDENTIFIER.test(key) ? `${path2}.${key}` : `${path2}[${JSON.stringify(key)}]`;
};
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var Validator = class {
  errors = [];
  report(path2, problem) {
    this.errors.push(`${path2}: ${problem}`);
    return void 0;
  }
  object(value, path2, keys) {
    if (!isObject(value)) return this.report(path2, "expected an object");
    if (keys === void 0) return value;
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        this.report(childPath(path2, key), "unknown key");
      }
    }
    return value;
  }
  string(value, path2) {
    return typeof value === "string" ? value : this.report(path2, "expected a string");
  }
  oneOf(value, path2, allowed) {
    const isAllowed = typeof value === "string" && allowed.includes(value);
    return isAllowed ? value : this.report(path2, `expected one of ${allowed.join(", ")}`);
  }
  integer(value, path2, min, max = Number.MAX_SAFE_INTEGER) {
    const isInRange = Number.isInteger(value) && value >= min && value <= max;
    if (isInRange) return value;
    const range = max === Number.MAX_SAFE_INTEGER ? `>= ${min}` : `${min}..${max}`;
    return this.report(path2, `expected an integer ${range}`);
  }
  amount(value, path2) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : this.report(path2, "expected a number >= 0");
  }
  strings(value, path2) {
    if (!Array.isArray(value)) return this.report(path2, "expected an array of strings");
    const before = this.errors.length;
    value.forEach((item, index) => this.string(item, childPath(path2, index)));
    return this.errors.length === before ? value : void 0;
  }
};
var required = (validator, object, path2, keys) => {
  const missing = keys.filter((key) => !Object.hasOwn(object, key));
  missing.forEach((key) => validator.report(childPath(path2, key), "is required"));
  return missing.length === 0;
};
var TOOL_KEYS = ["level", "command", "ignoreRules", "timeout"];
var MAX_TIMEOUT_S = 110;
var readTimeout = (validator, value, path2) => validator.integer(value, path2, 1, MAX_TIMEOUT_S);
var readToolSetting = (validator, value, path2) => {
  if (value === false) return false;
  const object = validator.object(value, path2, TOOL_KEYS);
  if (object === void 0) return void 0;
  const setting = { level: DEFAULT_SEVERITY, ignoreRules: [] };
  if (object["level"] !== void 0) {
    setting.level = validator.oneOf(object["level"], childPath(path2, "level"), SEVERITIES2) ?? DEFAULT_SEVERITY;
  }
  if (object["command"] !== void 0) {
    const command = validator.string(object["command"], childPath(path2, "command"));
    if (command !== void 0 && command.trim() === "") validator.report(childPath(path2, "command"), "is empty");
    else if (command !== void 0) setting.command = command;
  }
  if (object["ignoreRules"] !== void 0) {
    setting.ignoreRules = validator.strings(object["ignoreRules"], childPath(path2, "ignoreRules")) ?? [];
  }
  if (object["timeout"] !== void 0) {
    const timeout = readTimeout(validator, object["timeout"], childPath(path2, "timeout"));
    if (timeout !== void 0) setting.timeout = timeout;
  }
  return setting;
};
var readNamed = (validator, root, names) => {
  const settings = {};
  for (const name of names) {
    if (!Object.hasOwn(root, name)) continue;
    const setting = readToolSetting(validator, root[name], childPath("$", name));
    if (setting !== void 0) {
      settings[name] = setting;
    }
  }
  return settings;
};
var readGlobs = (validator, value, path2) => typeof value === "string" ? [value] : validator.strings(value, path2);
var CHECK_KEYS = ["name", "files", "on", "run", "format", "level", "timeout"];
var CHECK_NAME = /^[\w.-]+$/;
var FILES_TOKEN = "{files}";
var readCheck = (validator, value, path2) => {
  const object = validator.object(value, path2, CHECK_KEYS);
  if (object === void 0 || !required(validator, object, path2, ["name", "files", "on", "run"])) return void 0;
  const before = validator.errors.length;
  const name = validator.string(object["name"], childPath(path2, "name"));
  if (name !== void 0 && !CHECK_NAME.test(name)) validator.report(childPath(path2, "name"), 'expected letters, digits, ".", "_" or "-"');
  const files = readGlobs(validator, object["files"], childPath(path2, "files"));
  const on = validator.oneOf(object["on"], childPath(path2, "on"), CHECK_STAGES);
  const run3 = validator.string(object["run"], childPath(path2, "run"));
  if (run3 !== void 0 && !run3.includes(FILES_TOKEN)) validator.report(childPath(path2, "run"), `needs the ${FILES_TOKEN} placeholder`);
  const format = object["format"] === void 0 ? EXIT_FORMAT : validator.oneOf(object["format"], childPath(path2, "format"), OUTPUT_FORMATS);
  const level = object["level"] === void 0 ? DEFAULT_SEVERITY : validator.oneOf(object["level"], childPath(path2, "level"), SEVERITIES2);
  const timeout = object["timeout"] === void 0 ? void 0 : readTimeout(validator, object["timeout"], childPath(path2, "timeout"));
  const isValid = validator.errors.length === before;
  if (!isValid || name === void 0 || files === void 0 || on === void 0 || run3 === void 0 || format === void 0 || level === void 0) {
    return void 0;
  }
  return { name, files, on, run: run3, format, level, ...timeout !== void 0 && { timeout } };
};
var readChecks = (validator, value) => {
  if (value === void 0) return [];
  if (!Array.isArray(value)) return validator.report("$.checks", "expected an array") ?? [];
  const checks = [];
  value.forEach((entry, index) => {
    const path2 = childPath("$.checks", index);
    const check2 = readCheck(validator, entry, path2);
    if (check2 === void 0) return;
    if (checks.some((other) => other.name === check2.name)) {
      validator.report(childPath(path2, "name"), `duplicate check ${check2.name}`);
      return;
    }
    checks.push(check2);
  });
  return checks;
};
var readRules = (validator, value) => {
  const rules = defaultRules();
  if (value === void 0) return rules;
  const object = validator.object(value, "$.rules", RULE_IDS);
  if (object === void 0) return rules;
  for (const rule of RULE_IDS) {
    if (!Object.hasOwn(object, rule)) continue;
    const severity = validator.oneOf(object[rule], childPath("$.rules", rule), SEVERITIES2);
    if (severity !== void 0) {
      rules[rule] = severity;
    }
  }
  return rules;
};
var readStep = (validator, value, path2, keys) => {
  const object = validator.object(value, path2, keys);
  if (object === void 0 || !required(validator, object, path2, ["base", "step"])) return void 0;
  validator.integer(object["base"], childPath(path2, "base"), 1, MAX_PORT);
  validator.integer(object["step"], childPath(path2, "step"), 1);
  return object;
};
var readPorts = (validator, value, path2) => {
  const object = validator.object(value, path2, void 0);
  if (object === void 0) return void 0;
  const ports = {};
  for (const [key, entry] of Object.entries(object)) {
    const portPath = childPath(path2, key);
    const port = readStep(validator, entry, portPath, ["base", "step", "target"]);
    if (port === void 0) continue;
    const target = port["target"] === void 0 ? DEFAULT_PORT_TARGET : validator.string(port["target"], childPath(portPath, "target"));
    ports[key] = { base: port["base"], step: port["step"], target: target ?? DEFAULT_PORT_TARGET };
  }
  return ports;
};
var ENV_KEY = /^[A-Za-z_]\w*$/;
var readSlotEnv = (validator, value, path2) => {
  const object = validator.object(value, path2, ["key", "target"]);
  if (object === void 0 || !required(validator, object, path2, ["key"])) return void 0;
  const key = validator.string(object["key"], childPath(path2, "key"));
  if (key !== void 0 && !ENV_KEY.test(key)) return validator.report(childPath(path2, "key"), "expected an env variable name");
  const target = object["target"] === void 0 ? DEFAULT_PORT_TARGET : validator.string(object["target"], childPath(path2, "target"));
  return key === void 0 || target === void 0 ? void 0 : { key, target };
};
var SLOT_KEYS = [
  "worktreesDir",
  "install",
  "dev",
  "runtime",
  "verifyRuntime",
  "linkedPackages",
  "ports",
  "cdp",
  "slotEnv",
  "instance",
  "clearCache"
];
var readSlots = (validator, value) => {
  const path2 = "$.slots";
  const object = validator.object(value, path2, SLOT_KEYS);
  if (object === void 0 || !required(validator, object, path2, ["worktreesDir"])) return void 0;
  const at = (key) => childPath(path2, key);
  const slots = { worktreesDir: validator.string(object["worktreesDir"], at("worktreesDir")) ?? "" };
  const readers = {
    install: (raw) => validator.string(raw, at("install")),
    dev: (raw) => validator.string(raw, at("dev")),
    runtime: (raw) => validator.oneOf(raw, at("runtime"), RUNTIMES),
    verifyRuntime: (raw) => validator.oneOf(raw, at("verifyRuntime"), VERIFY_RUNTIMES),
    linkedPackages: (raw) => validator.strings(raw, at("linkedPackages")),
    ports: (raw) => readPorts(validator, raw, at("ports")),
    cdp: (raw) => readStep(validator, raw, at("cdp"), ["base", "step"]),
    slotEnv: (raw) => readSlotEnv(validator, raw, at("slotEnv")),
    instance: (raw) => validator.object(raw, at("instance"), void 0),
    clearCache: (raw) => validator.strings(raw, at("clearCache"))
  };
  for (const [key, read] of Object.entries(readers)) {
    if (!Object.hasOwn(object, key)) continue;
    const parsed = read(object[key]);
    if (parsed !== void 0) {
      Object.assign(slots, { [key]: parsed });
    }
  }
  return slots;
};
var WORKTREE_LIST_KEYS = ["seedExclude", "copyFiles"];
var readDepsPool = (validator, value, path2) => {
  const object = validator.object(value, path2, ["after"]);
  if (object === void 0) return void 0;
  if (object["after"] === void 0) return {};
  const after = validator.string(object["after"], childPath(path2, "after"));
  if (after === void 0) return void 0;
  if (after.trim() === "") return validator.report(childPath(path2, "after"), "is empty");
  return { after };
};
var readWorktree = (validator, value) => {
  const path2 = "$.worktree";
  const object = validator.object(value, path2, [...WORKTREE_LIST_KEYS, "depsPool"]);
  if (object === void 0) return void 0;
  const worktree = {};
  if (object["depsPool"] !== void 0) {
    const depsPool = readDepsPool(validator, object["depsPool"], childPath(path2, "depsPool"));
    if (depsPool !== void 0) worktree.depsPool = depsPool;
  }
  for (const key of WORKTREE_LIST_KEYS) {
    if (object[key] === void 0) continue;
    const parsed = validator.strings(object[key], childPath(path2, key));
    if (parsed !== void 0) {
      worktree[key] = parsed;
    }
  }
  return worktree;
};
var REVIEW_CYCLE_KEYS = ["processAdapter", "forge"];
var readReviewCycle = (validator, value) => {
  const path2 = "$.reviewCycle";
  const object = validator.object(value, path2, REVIEW_CYCLE_KEYS);
  if (object === void 0) return void 0;
  const reviewCycle = {};
  if (object["processAdapter"] !== void 0) {
    const adapter = validator.string(object["processAdapter"], childPath(path2, "processAdapter"));
    if (adapter !== void 0 && adapter.trim() === "") validator.report(childPath(path2, "processAdapter"), "is empty");
    else if (adapter !== void 0) reviewCycle.processAdapter = adapter;
  }
  if (object["forge"] !== void 0) {
    const forge = validator.oneOf(object["forge"], childPath(path2, "forge"), FORGES);
    if (forge !== void 0) reviewCycle.forge = forge;
  }
  return reviewCycle;
};
var defaultRules = () => {
  const rules = {};
  for (const rule of RULE_IDS) {
    rules[rule] = DEFAULT_SEVERITIES[rule] ?? DEFAULT_SEVERITY;
  }
  return rules;
};
var defaultConfig = () => ({ rules: defaultRules(), tools: {}, proofs: {}, checks: [] });
var SECTION_KEYS = ["$schema", "rules", "checks", "slots", "worktree", "reviewCycle"];
var ROOT_KEYS = [...SECTION_KEYS, ...TOOL_NAMES, ...PROOF_NAMES];
var validateConfig = (value) => {
  const validator = new Validator();
  const root = validator.object(value, "$", ROOT_KEYS);
  if (root === void 0) return { config: defaultConfig(), errors: validator.errors };
  if (root["$schema"] !== void 0) {
    validator.string(root["$schema"], "$.$schema");
  }
  const rules = readRules(validator, root["rules"]);
  const tools = readNamed(validator, root, TOOL_NAMES);
  const proofs = readNamed(validator, root, PROOF_NAMES);
  const checks = readChecks(validator, root["checks"]);
  const slots = root["slots"] === void 0 ? void 0 : readSlots(validator, root["slots"]);
  const worktree = root["worktree"] === void 0 ? void 0 : readWorktree(validator, root["worktree"]);
  const reviewCycle = root["reviewCycle"] === void 0 ? void 0 : readReviewCycle(validator, root["reviewCycle"]);
  const config = {
    rules,
    tools,
    proofs,
    checks,
    ...slots === void 0 ? {} : { slots },
    ...worktree === void 0 ? {} : { worktree },
    ...reviewCycle === void 0 ? {} : { reviewCycle }
  };
  return { config, errors: validator.errors };
};
var mergeChecks = (shared, local) => {
  if (!Array.isArray(shared) || !Array.isArray(local)) return local;
  const nameOf = (entry) => {
    const name = isObject(entry) ? entry["name"] : void 0;
    return typeof name === "string" ? name : void 0;
  };
  const localNames = new Set(local.map(nameOf).filter((name) => name !== void 0));
  return [...shared.filter((entry) => !localNames.has(nameOf(entry) ?? "")), ...local];
};
var mergeConfigValues = (shared, local, path2 = "$") => {
  if (path2 === "$.checks") return mergeChecks(shared, local);
  if (!isObject(shared) || !isObject(local)) return local;
  const merged2 = { ...shared };
  for (const [key, value] of Object.entries(local)) {
    merged2[key] = Object.hasOwn(shared, key) ? mergeConfigValues(shared[key], value, childPath(path2, key)) : value;
  }
  return merged2;
};
var failed = (files, error) => ({ ...defaultConfig(), files, error });
var parseText = (text3, label) => {
  try {
    return { value: parseJsonc(text3) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `${label}$: ${reason}` };
  }
};
var loadValue = (value, files) => {
  const { config, errors } = validateConfig(value);
  if (errors.length > 0) return failed(files, errors.join("; "));
  return { ...config, files };
};
var readOptional = (path2) => existsSync4(path2) ? readFileSync10(path2, "utf8") : void 0;
var loadConfig = (projectRoot) => {
  const paths = jigPaths(projectRoot);
  const sources = [
    { path: paths.config, label: ".jig/config.jsonc: " },
    { path: paths.localConfig, label: ".jig/config.local.jsonc: " }
  ].flatMap((source) => {
    const text3 = readOptional(source.path);
    return text3 === void 0 ? [] : [{ ...source, text: text3 }];
  });
  const files = sources.map((source) => source.path);
  if (sources.length === 0) return { ...defaultConfig(), files };
  let merged2 = {};
  for (const source of sources) {
    const parsed = parseText(source.text, source.label);
    if ("error" in parsed) return failed(files, parsed.error);
    merged2 = mergeConfigValues(merged2, parsed.value);
  }
  return loadValue(merged2, files);
};
var enabledSetting = (settings, name) => {
  const setting = settings[name];
  return setting === void 0 || setting === false || setting.level === "off" ? void 0 : setting;
};

// src/core/state.ts
import { mkdirSync as mkdirSync6, readdirSync as readdirSync2, readFileSync as readFileSync11, renameSync, rmSync as rmSync3, statSync as statSync4, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join9 } from "node:path";
var MAIN_AGENT = "main";
var STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var RENAME_ATTEMPTS = 20;
var RENAME_RETRY_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var tmpCounter = 0;
var safeName = (id) => id.replace(/[^A-Za-z0-9._-]/g, "_");
var sessionFileName = (sessionId) => `${safeName(sessionId)}.json`;
var shellCallPrefix = (sessionId) => `${safeName(sessionId)}.shell-`;
var sessionStatePath = (projectRoot, sessionId) => join9(jigPaths(projectRoot).sessions, sessionFileName(sessionId));
var shellCallPath = (projectRoot, sessionId, callId) => join9(jigPaths(projectRoot).sessions, `${shellCallPrefix(sessionId)}${safeName(callId)}.json`);
var isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
var openShellCall = (projectRoot, sessionId, callId, call) => {
  mkdirSync6(jigPaths(projectRoot).sessions, { recursive: true });
  writeFileAtomic(shellCallPath(projectRoot, sessionId, callId), JSON.stringify(call));
};
var closeShellCall = (projectRoot, sessionId, callId) => {
  const path2 = shellCallPath(projectRoot, sessionId, callId);
  let text3;
  try {
    text3 = readFileSync11(path2, "utf8");
  } catch {
    return void 0;
  }
  rmSync3(path2, { force: true });
  try {
    const value = JSON.parse(text3);
    if (typeof value !== "object" || value === null || !("snapshot" in value)) return void 0;
    const { snapshot: snapshot3 } = value;
    if (typeof snapshot3 !== "object" || snapshot3 === null) return void 0;
    const worktrees = "worktrees" in value && isStrings(value.worktrees) ? value.worktrees : void 0;
    return worktrees === void 0 ? { snapshot: snapshot3 } : { snapshot: snapshot3, worktrees };
  } catch {
    return void 0;
  }
};
var openShellCalls = (projectRoot, sessionId) => {
  const prefix = shellCallPrefix(sessionId);
  let names;
  try {
    names = readdirSync2(jigPaths(projectRoot).sessions);
  } catch {
    return [];
  }
  return names.filter((name) => name.startsWith(prefix) && name.endsWith(".json")).map((name) => name.slice(prefix.length, -".json".length));
};
var createSessionState = (sessionId, snapshot3, now = /* @__PURE__ */ new Date()) => {
  const iso = now.toISOString();
  return {
    v: 1,
    sessionId,
    turn: 0,
    createdAt: iso,
    updatedAt: iso,
    snapshot: snapshot3,
    edits: [],
    stop: { consecutiveBlocks: 0 }
  };
};
var resetSnapshot = (state, snapshot3) => {
  state.snapshot = snapshot3;
  state.edits = [];
};
var isSessionState = (value) => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return candidate.v === 1 && typeof candidate.sessionId === "string" && typeof candidate.snapshot === "object";
};
var readState = (projectRoot, sessionId) => {
  let text3;
  try {
    text3 = readFileSync11(sessionStatePath(projectRoot, sessionId), "utf8");
  } catch {
    return void 0;
  }
  try {
    const value = JSON.parse(text3);
    if (!isSessionState(value)) return void 0;
    return { ...value, turn: typeof value.turn === "number" ? value.turn : 0 };
  } catch {
    return void 0;
  }
};
var isRetryable = (error) => error instanceof Error && RENAME_RETRY_CODES.has(error.code ?? "");
var renameWithRetry = (from, to) => {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isRetryable(error)) {
        rmSync3(from, { force: true });
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 5);
    }
  }
};
var writeFileAtomic = (path2, text3) => {
  tmpCounter++;
  const tmp = `${path2}.${process.pid}-${tmpCounter}.tmp`;
  writeFileSync5(tmp, text3);
  renameWithRetry(tmp, path2);
};
var writeState = (projectRoot, state, now = /* @__PURE__ */ new Date()) => {
  const path2 = sessionStatePath(projectRoot, state.sessionId);
  mkdirSync6(jigPaths(projectRoot).sessions, { recursive: true });
  state.updatedAt = now.toISOString();
  writeFileAtomic(path2, JSON.stringify(state));
};
var pruneStates = (projectRoot, now = Date.now(), maxAgeMs = STATE_MAX_AGE_MS) => {
  const dir2 = jigPaths(projectRoot).sessions;
  let names;
  try {
    names = readdirSync2(dir2);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    const path2 = join9(dir2, name);
    try {
      if (now - statSync4(path2).mtimeMs <= maxAgeMs) continue;
      rmSync3(path2, { force: true });
      removed.push(name);
    } catch {
      continue;
    }
  }
  return removed;
};

// src/core/plan.ts
var PLAN_VERSION = 2;
var HASHED_INPUTS = [
  ".jig/config.jsonc",
  ".jig/config.local.jsonc",
  "package.json",
  "node_modules/.package-lock.json",
  ...LOCKFILES.map((lockfile) => lockfile.file),
  ...ALL_MARKERS
];
var fileStamp = (path2) => {
  try {
    const stat = statSync5(path2);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
};
var planInputsHash = (projectRoot, pluginRoot) => {
  const lines2 = [
    `version:${version}`,
    `plugin:${pluginRoot}`,
    `bundle:${fileStamp(join10(pluginRoot, "bin", "jig.mjs"))}`,
    ...HASHED_INPUTS.map((name) => `${name}:${fileStamp(join10(projectRoot, name))}`)
  ];
  return createHash2("sha1").update(lines2.join("\n")).digest("hex");
};
var resolveTools = (projectRoot, config) => {
  const tools = {};
  const unresolved2 = [];
  const named = [...Object.keys(config.tools).map((name) => [name, config.tools]), ...Object.keys(config.proofs).map((name) => [name, config.proofs])];
  for (const [name, settings] of named) {
    const setting = enabledSetting(settings, name);
    const entry = catalogEntry(name);
    const [primary] = entry?.binaries ?? [];
    if (setting === void 0 || entry === void 0 || primary === void 0) continue;
    const [command = primary.command, ...args] = splitCommand(setting.command ?? primary.command);
    const binary = entry.binaries.find((candidate) => candidate.command === command);
    const bin = resolveBin(projectRoot, binary?.packages ?? [], command);
    if (bin === void 0) {
      unresolved2.push(name);
      continue;
    }
    tools[(binary ?? primary).key] = { bin: [...bin, ...args] };
  }
  return { tools, unresolved: unresolved2 };
};
var configDrift = (projectRoot, config, unresolved2) => {
  if (config.error !== void 0) return [`.jig config is invalid (${config.error})`];
  const found = unlisted(config, discover(projectRoot));
  if (config.files.length === 0) return found.length === 0 ? [] : [`no .jig/config.jsonc, so nothing runs; found ${found.map((item) => item.name).join(", ")}`];
  return [
    ...found.map((item) => item.kind === "proof" ? `found ${item.name}, not in config: UI proof is off` : `found ${item.name}, not in config`),
    ...unresolved2.map((name) => `${name} is on in config, its binary is not installed`)
  ];
};
var configDriftLine = (plan) => {
  if (plan.drift.length === 0) return void 0;
  const command = plan.config.files.length > 0 ? "jig init --update" : "jig init";
  return `jig: ${plan.drift.join("; ")}. Run ${command} to settle the project config.`;
};
var toPlanAtom = (file) => {
  let data;
  try {
    data = parseFrontmatter(readFileSync12(file, "utf8"))?.data ?? {};
  } catch {
    return void 0;
  }
  const { name, description } = data;
  const isIndexable = typeof name === "string" && typeof description === "string";
  return isIndexable ? { name, description, file } : void 0;
};
var readAtomIndex = (pluginRoot) => {
  const dir2 = join10(pluginRoot, "atoms");
  let names;
  try {
    names = readdirSync3(dir2);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".md")).sort().map((name) => toPlanAtom(join10(dir2, name))).filter((atom) => atom !== void 0);
};
var buildPlan = (projectRoot, pluginRoot, now = /* @__PURE__ */ new Date()) => {
  const config = loadConfig(projectRoot);
  const { tools, unresolved: unresolved2 } = resolveTools(projectRoot, config);
  return {
    v: PLAN_VERSION,
    inputsHash: planInputsHash(projectRoot, pluginRoot),
    pluginVersion: version,
    builtAt: now.toISOString(),
    config,
    tools,
    unresolved: unresolved2,
    drift: configDrift(projectRoot, config, unresolved2),
    atoms: readAtomIndex(pluginRoot)
  };
};
var readPlan = (projectRoot) => {
  try {
    const value = JSON.parse(readFileSync12(jigPaths(projectRoot).plan, "utf8"));
    return value.v === PLAN_VERSION && typeof value.inputsHash === "string" ? value : void 0;
  } catch {
    return void 0;
  }
};
var writePlan = (projectRoot, plan) => {
  const path2 = jigPaths(projectRoot).plan;
  mkdirSync7(dirname8(path2), { recursive: true });
  writeFileAtomic(path2, `${JSON.stringify(plan, null, 2)}
`);
};
var loadPlan = (projectRoot, pluginRoot) => {
  const cached = readPlan(projectRoot);
  if (cached !== void 0 && cached.inputsHash === planInputsHash(projectRoot, pluginRoot)) return cached;
  const plan = buildPlan(projectRoot, pluginRoot);
  writePlan(projectRoot, plan);
  return plan;
};

// src/rules/gate.ts
import { createHash as createHash3 } from "node:crypto";
import { mkdirSync as mkdirSync8, readdirSync as readdirSync4, readFileSync as readFileSync13, rmSync as rmSync4, statSync as statSync6, writeFileSync as writeFileSync6 } from "node:fs";
import { join as join11 } from "node:path";

// src/rules/comments.ts
import { basename as basename2 } from "node:path";
var CONFIG_FILE = [/^\./, /\.(?:config|conf)\./];
var lf = (text3) => text3.replace(/\r\n/g, "\n");
var normalize = (text3) => text3.replace(/\s+/g, " ").trim();
var isConfigFile = (file) => CONFIG_FILE.some((pattern) => pattern.test(basename2(file)));
var commentsIn = (file, text3) => (lexComments(file, text3) ?? []).map((comment) => ({ text: comment.text, key: normalize(comment.text), line: comment.line }));
var isSubsequence = (short2, long) => {
  const wanted = [...short2];
  let found = 0;
  for (const char of long) {
    if (char === wanted[found]) found++;
  }
  return found === wanted.length;
};
var unmatched = (file, before, after) => {
  const left = /* @__PURE__ */ new Map();
  for (const text3 of before) {
    for (const { key } of commentsIn(file, text3)) left.set(key, (left.get(key) ?? 0) + 1);
  }
  const fresh = after.flatMap((text3) => commentsIn(file, text3)).filter(({ key }) => {
    const count = left.get(key) ?? 0;
    if (count > 0) left.set(key, count - 1);
    return count === 0;
  });
  const shortenable = [...left].flatMap(([key, count]) => Array.from({ length: count }, () => key));
  return fresh.filter(({ key }) => {
    const source = shortenable.findIndex((old) => isSubsequence(key, old));
    if (source !== -1) shortenable.splice(source, 1);
    return source === -1;
  });
};
var applyEdits = (current, edits) => {
  let text3 = current;
  for (const edit of edits) {
    const before = lf(edit.before);
    const after = lf(edit.after);
    if (before === "" && text3 === "") {
      text3 = after;
      continue;
    }
    const at = before === "" ? -1 : text3.indexOf(before);
    if (at === -1) return void 0;
    text3 = text3.slice(0, at) + after + text3.slice(at + before.length);
  }
  return text3;
};
var addedComments = (file, edits, current) => {
  if (lexComments(file, "") === void 0) return void 0;
  const original = lf(current ?? "");
  const result = applyEdits(original, edits);
  if (result !== void 0) return unmatched(file, [original], [result]).map((comment) => ({ ...comment, lineIn: "file" }));
  const befores = edits.map((edit) => lf(edit.before));
  const afters = edits.map((edit) => lf(edit.after));
  return unmatched(file, befores, afters).map((comment) => ({ ...comment, lineIn: "new-text" }));
};

// src/rules/suppressions.ts
var firstMatch = (patterns, text3) => {
  for (const pattern of patterns) {
    const match = pattern.exec(text3);
    if (match !== null) return match[0];
  }
  return void 0;
};
var findSuppression = (comment) => firstMatch(DIRECTIVE_SOURCES.flatMap((source) => source.comments?.suppressions ?? []), comment);
var isToolDirective = (comment) => firstMatch(DIRECTIVE_SOURCES.flatMap((source) => source.comments?.allowed ?? []), comment) !== void 0;

// src/rules/tests.ts
var countCases = (source, testCase) => source.match(testCase)?.length ?? 0;
var addedTestCases = (file, edits, source) => {
  const testCase = languageFor(file)?.testCase;
  if (testCase === void 0) return 0;
  const added = edits.reduce((sum, edit) => sum + countCases(edit.after, testCase) - countCases(edit.before, testCase), 0);
  return added > 0 && isTestFile(file, source) ? added : 0;
};

// src/rules/gate.ts
var GATE_ATOMS = ["tests"];
var RETRY = "Read the rules first, then repeat the same call \u2014 it will pass.";
var LEADING_HEADING = /^#[^\n]*\n+/;
var isOn = (config, rule) => (config.rules[rule] ?? "off") !== "off";
var sessionDir = (projectRoot, sessionId) => join11(jigPaths(projectRoot).cache, "gates", sessionId.replace(/[^A-Za-z0-9._-]/g, "_"));
var claimPath = (projectRoot, sessionId, agent, key) => {
  const name = process.platform === "win32" ? key.toLowerCase() : key;
  return join11(sessionDir(projectRoot, sessionId), createHash3("sha1").update(`${agent}
${name}`).digest("hex"));
};
var atomKey = (atom) => `atom
${atom}`;
var claimFirst = ({ projectRoot, sessionId, agent }, key) => {
  mkdirSync8(sessionDir(projectRoot, sessionId), { recursive: true });
  try {
    writeFileSync6(claimPath(projectRoot, sessionId, agent, key), "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};
var atomPath = (pluginRoot, atom) => toSlash(join11(pluginRoot, "atoms", `${atom}.md`));
var rulesText = (input, atom, reminder) => {
  const path2 = atomPath(input.pluginRoot, atom);
  if (!claimFirst(input, atomKey(atom))) return `${reminder} Rules: ${path2}.`;
  try {
    const text3 = readFileSync13(path2, "utf8");
    return (parseFrontmatter(text3)?.body ?? text3).replace(/^\s+/, "").replace(LEADING_HEADING, "").trim();
  } catch {
    return `Rules: ${path2}.`;
  }
};
var where = (file, comment) => comment.lineIn === "file" ? `${file}:${comment.line}` : `${file}, line ${comment.line} of the new text`;
var fileLineOf = (comment) => comment.lineIn === "file" ? { line: comment.line } : {};
var suppressionHits = (file, comments) => comments.flatMap((comment) => {
  const directive = findSuppression(comment.text);
  if (directive === void 0) return [];
  const message = `jig/comments: "${directive}" at ${where(file, comment)} silences a check. Fix the cause instead; only a human adds suppressions.`;
  return [{ rule: "jig/comments", ...fileLineOf(comment), message }];
});
var MAX_KEY_LENGTH = 80;
var COMMENT_ADVICE = 'Remove it and put the reason into a name, a type, the structure or the commit message; removing a comment or part of its text passes, config files are not checked, and a comment that must exist (license header, tool directive) is added by a human, or the project turns the gate off with "rules": { "jig/comments": "off" } in .jig/config.jsonc.';
var shortKey = (key) => key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}...` : key;
var commentSection = (file, comments) => {
  const gated = comments.filter((comment) => findSuppression(comment.text) === void 0 && !isToolDirective(comment.text));
  const [first] = gated;
  if (first === void 0) return void 0;
  const list = gated.map((comment) => `  ${where(file, comment)} ${shortKey(comment.key)}`);
  return {
    text: `jig/comments: the edit adds or rewords ${gated.length} comment(s):
${list.join("\n")}
${COMMENT_ADVICE}`,
    hit: { rule: "jig/comments", ...fileLineOf(first), message: `new comment at ${where(file, first)}` }
  };
};
var TEST_REMINDER = 'Finish "this test fails when a developer <edit>, which breaks <behavior>" with a realistic edit, or drop the test.';
var editedSource = ({ projectRoot, file, edits }) => () => [fileSource(projectRoot, file)() ?? "", ...edits.map((edit) => edit.after)].join("\n");
var testSection = (input) => {
  const added = addedTestCases(input.file, input.edits, editedSource(input));
  if (added <= 0 || !claimFirst(input, `test
${input.file}`)) return void 0;
  const head = `jig/tests: the edit adds ${added} test case(s) to ${input.file}. ${RETRY}`;
  return {
    text: `${head}

${rulesText(input, "tests", TEST_REMINDER)}`,
    hit: { rule: "jig/tests", message: `${added} new test case(s) in ${input.file}` }
  };
};
var gateEdit = (input) => {
  const comments = addedComments(input.file, input.edits, fileSource(input.projectRoot, input.file)()) ?? [];
  const suppressions = suppressionHits(input.file, comments);
  const sections = [
    isOn(input.config, "jig/comments") && !isConfigFile(input.file) ? commentSection(input.file, comments) : void 0,
    isOn(input.config, "jig/tests") ? testSection(input) : void 0
  ].filter((section) => section !== void 0);
  const hits = [...suppressions, ...sections.map((section) => section.hit)];
  if (hits.length === 0) return { hits };
  const texts = [...suppressions.map((hit) => hit.message), ...sections.map((section) => section.text)];
  return { reason: texts.join("\n\n"), hits };
};
var resetGateAtoms = (projectRoot, sessionId, agent) => {
  for (const atom of GATE_ATOMS) {
    rmSync4(claimPath(projectRoot, sessionId, agent, atomKey(atom)), { force: true });
  }
};
var pruneGateClaims = (projectRoot, now = Date.now(), maxAgeMs = STATE_MAX_AGE_MS) => {
  const dir2 = join11(jigPaths(projectRoot).cache, "gates");
  let names;
  try {
    names = readdirSync4(dir2);
  } catch {
    return;
  }
  for (const name of names) {
    const path2 = join11(dir2, name);
    try {
      if (now - statSync6(path2).mtimeMs > maxAgeMs) {
        rmSync4(path2, { recursive: true, force: true });
      }
    } catch {
      continue;
    }
  }
};

// src/atoms/markdown.ts
import { existsSync as existsSync5, readdirSync as readdirSync5, readFileSync as readFileSync14 } from "node:fs";
import { join as join12 } from "node:path";
var listMarkdown = (dir2) => {
  try {
    return readdirSync5(dir2).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
};
var listSkillFolders = (pluginRoot) => {
  try {
    return readdirSync5(join12(pluginRoot, "skills")).filter((name) => existsSync5(join12(pluginRoot, "skills", name, "SKILL.md"))).sort();
  } catch {
    return [];
  }
};
var readText2 = (path2) => {
  try {
    return readFileSync14(path2, "utf8");
  } catch {
    return "";
  }
};
var parseMarkdownFile = (text3) => {
  try {
    return parseFrontmatter(text3) ?? "frontmatter is missing";
  } catch (error) {
    if (error instanceof FrontmatterError) return `frontmatter is invalid (${error.message})`;
    throw error;
  }
};

// src/atoms/doc-refs.ts
import { existsSync as existsSync6, readdirSync as readdirSync6 } from "node:fs";
import { join as join13, posix as posix3 } from "node:path";
var FLOWS_DIR = "skills/jig/flows";
var SHARED_FLOW = "mr";
var SLASH = /(?<=^|[\s`(|"'>])\/(jig(?:[:-][a-z0-9-]+)*)(?![\w/.-])/gm;
var LINK = /\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
var BACKTICKED_PATH = /`((?:skills|references|scripts|agents)\/[^`\s]+)/g;
var SKILL_RELATIVE = /^(?:references|scripts|agents)\//;
var PLACEHOLDER = /[<>*{}[\]]/;
var URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
var FLOW_ROW = /^\| \[[^\]]+\]\((?:\.\/)?skills\/jig\/flows\/([\w-]+)\.md\)/gm;
var listNested = (pluginRoot, dir2) => {
  try {
    return readdirSync6(join13(pluginRoot, dir2), { recursive: true, encoding: "utf8" }).filter((path2) => path2.endsWith(".md")).map((path2) => `${dir2}/${toSlash(path2)}`);
  } catch {
    return [];
  }
};
var exists = (pluginRoot, path2) => existsSync6(join13(pluginRoot, path2));
var lineAt = (text3, index) => text3.slice(0, index).split("\n").length;
var skillOf = (command) => {
  const [plugin, skill] = command.split(":");
  return skill ?? plugin ?? "";
};
var skillRoot = (file) => /^skills\/[^/]+/.exec(file)?.[0];
var checkSlashCommands = ({ file, text: text3 }, skills) => [...text3.matchAll(SLASH)].filter((match) => !skills.has(skillOf(match[1] ?? ""))).map((match) => `${file}:${lineAt(text3, match.index)}: /${match[1]} names no skill in skills/`);
var checkLinks = ({ file, text: text3 }, pluginRoot) => [...text3.matchAll(LINK)].flatMap((match) => {
  const target = (match[1] ?? "").split("#")[0] ?? "";
  if (target === "" || URL_SCHEME.test(target)) return [];
  const path2 = posix3.normalize(posix3.join(posix3.dirname(file), decodeURI(target)));
  return exists(pluginRoot, path2) ? [] : [`${file}:${lineAt(text3, match.index)}: link ${target} points at no file`];
});
var checkBacktickedPaths = ({ file, text: text3 }, pluginRoot) => [...text3.matchAll(BACKTICKED_PATH)].flatMap((match) => {
  const path2 = match[1] ?? "";
  if (PLACEHOLDER.test(path2)) return [];
  const root = SKILL_RELATIVE.test(path2) ? skillRoot(file) : "";
  if (root === void 0) return [];
  const resolved = root === "" ? path2 : `${root}/${path2}`;
  return exists(pluginRoot, resolved) ? [] : [`${file}:${lineAt(text3, match.index)}: \`${path2}\` points at no file`];
});
var checkFlowTable = ({ file, text: text3 }, pluginRoot) => {
  const rows = file === "README.md" ? [...text3.matchAll(FLOW_ROW)] : [];
  const [first] = rows;
  if (first === void 0) return [];
  const listed = new Set(rows.map((row) => row[1] ?? ""));
  const line = lineAt(text3, first.index);
  return listMarkdown(join13(pluginRoot, FLOWS_DIR)).map((name) => name.slice(0, -".md".length)).filter((name) => name !== SHARED_FLOW && !listed.has(name)).map((name) => `${file}:${line}: flow ${name} is missing from the flow table`);
};
var validateDocRefs = (pluginRoot) => {
  const skills = new Set(listSkillFolders(pluginRoot));
  const readme = exists(pluginRoot, "README.md") ? ["README.md"] : [];
  const files = [...readme, ...listNested(pluginRoot, "docs"), ...listNested(pluginRoot, "skills")].sort();
  return files.flatMap((file) => {
    const doc = { file, text: readText2(join13(pluginRoot, file)).replace(/\r\n/g, "\n") };
    return [
      ...checkSlashCommands(doc, skills),
      ...checkLinks(doc, pluginRoot),
      ...checkBacktickedPaths(doc, pluginRoot),
      ...checkFlowTable(doc, pluginRoot)
    ];
  });
};

// src/atoms/skill-docs.ts
import { readdirSync as readdirSync7 } from "node:fs";
import { basename as basename3, join as join14 } from "node:path";
var ROLES_DIR = "skills/jig/references/roles";
var FLOWS_DIR2 = "skills/jig/flows";
var ROLE_KEYS = /* @__PURE__ */ new Set(["name", "description", "metadata"]);
var TIERS = ["deep", "standard", "fast"];
var EFFORTS = ["low", "medium", "high"];
var MAX_DESCRIPTION_LENGTH = 200;
var SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var MAX_SKILL_NAME_LENGTH = 64;
var ROLE_MENTION = /\b[Rr]oles? `[^`]+`(?:(?:, |,? and |,? or )`[^`]+`)*/g;
var BACKTICKED = /`([^`]+)`/g;
var FLOW_MENTION = /\bflows\/([A-Za-z0-9_-]+)\.md/g;
var lineAt2 = (text3, index) => text3.slice(0, index).split("\n").length;
var findMentions = (file, text3) => {
  const roles = [...text3.matchAll(ROLE_MENTION)].flatMap(
    (match) => [...match[0].matchAll(BACKTICKED)].map((name) => ({ name: name[1] ?? "", file, line: lineAt2(text3, match.index) }))
  );
  const flows = [...text3.matchAll(FLOW_MENTION)].map((match) => ({ name: match[1] ?? "", file, line: lineAt2(text3, match.index) }));
  return { roles, flows };
};
var listSkillMarkdown = (pluginRoot) => {
  try {
    return readdirSync7(join14(pluginRoot, "skills"), { recursive: true, encoding: "utf8" }).filter((path2) => path2.endsWith(".md")).map((path2) => `skills/${toSlash(path2)}`).sort();
  } catch {
    return [];
  }
};
var checkDescription = (description) => {
  if (typeof description !== "string" || description.trim() === "") return ["description is missing"];
  if (/[\r\n]/.test(description)) return ["description must be one line"];
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return [`description is longer than ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`];
  }
  return [];
};
var checkName = (name, expected, source = "file name") => {
  if (name === expected) return [];
  return typeof name === "string" && name !== "" ? [`name "${name}" does not match ${source} "${expected}"`] : ["name is missing"];
};
var checkMetadata = (metadata) => {
  if (metadata === void 0 || typeof metadata === "string" || Array.isArray(metadata)) {
    return ["metadata must be a block with tier and effort"];
  }
  const choices = [
    ["tier", TIERS],
    ["effort", EFFORTS]
  ];
  return choices.filter(([key, allowed]) => !allowed.includes(metadata[key] ?? "")).map(([key, allowed]) => `metadata.${key} must be one of ${allowed.join(", ")}`);
};
var checkDoc = (pluginRoot, path2, isRole) => {
  const parsed = parseMarkdownFile(readText2(join14(pluginRoot, path2)));
  if (typeof parsed === "string") return [parsed];
  const { data } = parsed;
  const problems = [...checkName(data["name"], basename3(path2, ".md")), ...checkDescription(data["description"])];
  if (!isRole) return problems;
  const unknownKeys = Object.keys(data).filter((key) => !ROLE_KEYS.has(key));
  return [...unknownKeys.map((key) => `unknown frontmatter key "${key}"`), ...problems, ...checkMetadata(data["metadata"])];
};
var checkSkill = (pluginRoot, folder) => {
  const parsed = parseMarkdownFile(readText2(join14(pluginRoot, "skills", folder, "SKILL.md")));
  const problems = typeof parsed === "string" ? [parsed] : checkName(parsed.data["name"], folder, "folder name");
  if (!SKILL_NAME.test(folder) || folder.length > MAX_SKILL_NAME_LENGTH) {
    problems.push(`folder name is not lowercase words joined by hyphens, at most ${MAX_SKILL_NAME_LENGTH} characters`);
  }
  return problems.map((problem) => `skills/${folder}/SKILL.md: ${problem}`);
};
var validateSkillDocs = (pluginRoot) => {
  const roles = listMarkdown(join14(pluginRoot, ROLES_DIR)).map((name) => basename3(name, ".md"));
  const flows = new Set(listMarkdown(join14(pluginRoot, FLOWS_DIR2)).map((name) => basename3(name, ".md")));
  const mentions = listSkillMarkdown(pluginRoot).map((file) => findMentions(file, readText2(join14(pluginRoot, file)).replace(/\r\n/g, "\n")));
  const roleMentions = mentions.flatMap((found) => found.roles);
  const referenced = new Set(roleMentions.filter((mention) => !mention.file.startsWith(`${ROLES_DIR}/`)).map((mention) => mention.name));
  const roleErrors = roles.flatMap((name) => {
    const path2 = `${ROLES_DIR}/${name}.md`;
    const problems = checkDoc(pluginRoot, path2, true);
    if (!referenced.has(name)) {
      problems.push(`role is never spawned: name it as role \`${name}\` in a flow or reference outside ${ROLES_DIR}/, or delete it`);
    }
    return problems.map((problem) => `${path2}: ${problem}`);
  });
  const flowErrors = [...flows].flatMap((name) => {
    const path2 = `${FLOWS_DIR2}/${name}.md`;
    return checkDoc(pluginRoot, path2, false).map((problem) => `${path2}: ${problem}`);
  });
  const roleNames = new Set(roles);
  const mentionErrors = [
    ...roleMentions.filter((mention) => !roleNames.has(mention.name)).map((mention) => `${mention.file}:${mention.line}: role \`${mention.name}\` does not exist in ${ROLES_DIR}/`),
    ...mentions.flatMap((found) => found.flows).filter((mention) => !flows.has(mention.name)).map((mention) => `${mention.file}:${mention.line}: flows/${mention.name}.md does not exist in ${FLOWS_DIR2}/`)
  ];
  const skillErrors = listSkillFolders(pluginRoot).flatMap((folder) => checkSkill(pluginRoot, folder));
  return [...skillErrors, ...roleErrors, ...flowErrors, ...mentionErrors];
};

// src/atoms/atoms.ts
var ALLOWED_KEYS = /* @__PURE__ */ new Set(["name", "description", "metadata"]);
var KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var DESCRIPTION_START = /^Apply (when|before|after|to) /;
var MAX_DESCRIPTION_LENGTH2 = 300;
var MAX_BODY_LINES = 35;
var ATOMS_LINE = /^\s*Atoms:(.*)$/gm;
var INDEX_LINE = /^\s*- `([a-z0-9-]+)`/gm;
var skillMarkdown = (pluginRoot) => {
  const skillsDir = join15(pluginRoot, "skills");
  try {
    return readdirSync8(skillsDir, { recursive: true, encoding: "utf8" }).filter((path2) => path2.endsWith(".md")).map((path2) => join15(skillsDir, path2));
  } catch {
    return [];
  }
};
var reachableNames = (pluginRoot) => {
  const texts = skillMarkdown(pluginRoot).map((path2) => readText2(path2).replace(/\r\n/g, "\n"));
  const names = new Set(GATE_ATOMS);
  for (const text3 of texts) {
    for (const match of text3.matchAll(/atom `([^`]+)`/g)) {
      names.add(match[1] ?? "");
    }
    for (const match of text3.matchAll(INDEX_LINE)) {
      names.add(match[1] ?? "");
    }
    for (const match of text3.matchAll(ATOMS_LINE)) {
      for (const item of (match[1] ?? "").split(",")) {
        names.add(item.trim().replace(/[`.]/g, ""));
      }
    }
  }
  return names;
};
var bodyLineCount = (body) => {
  const trimmed = body.replace(/\s+$/, "");
  return trimmed === "" ? 0 : trimmed.split("\n").length;
};
var checkName2 = (name, fileName, seen) => {
  if (typeof name !== "string" || name === "") return ["name is missing"];
  const problems = [];
  if (name !== fileName) {
    problems.push(`name "${name}" does not match file name "${fileName}"`);
  }
  if (!KEBAB_CASE.test(name)) {
    problems.push(`name "${name}" is not kebab-case`);
  }
  if (seen.has(name)) {
    problems.push(`duplicate name "${name}"`);
  }
  seen.add(name);
  return problems;
};
var checkDescription2 = (description) => {
  if (typeof description !== "string" || description === "") return ["description is missing"];
  const problems = [];
  if (!DESCRIPTION_START.test(description)) {
    problems.push(`description must match ${DESCRIPTION_START.source}`);
  }
  if (/[\r\n]/.test(description)) {
    problems.push("description must be one line");
  }
  if (description.length > MAX_DESCRIPTION_LENGTH2) {
    problems.push(`description is longer than ${MAX_DESCRIPTION_LENGTH2} characters (${description.length})`);
  }
  return problems;
};
var checkAtom = (path2, seen, reachable) => {
  const fileName = basename4(path2, ".md");
  const parsed = parseMarkdownFile(readText2(path2));
  if (typeof parsed === "string") return [parsed];
  const { data, body } = parsed;
  const unknownKeys = Object.keys(data).filter((key) => !ALLOWED_KEYS.has(key));
  const problems = unknownKeys.map((key) => `unknown frontmatter key "${key}"`);
  problems.push(...checkName2(data["name"], fileName, seen), ...checkDescription2(data["description"]));
  const lineCount = bodyLineCount(body);
  if (lineCount > MAX_BODY_LINES) {
    problems.push(`body is longer than ${MAX_BODY_LINES} lines (${lineCount})`);
  }
  const name = typeof data["name"] === "string" ? data["name"] : fileName;
  if (!reachable.has(name)) {
    problems.push(`atom is unreachable: name it as atom \`${name}\`, in an "Atoms:" line or an index line of a skill file under skills/, or deliver it from a hook gate`);
  }
  return problems;
};
var validateAtoms = (pluginRoot) => {
  const dir2 = join15(pluginRoot, "atoms");
  const reachable = reachableNames(pluginRoot);
  const seen = /* @__PURE__ */ new Set();
  return listMarkdown(dir2).flatMap(
    (name) => checkAtom(join15(dir2, name), seen, reachable).map((problem) => `atoms/${name}: ${problem}`)
  );
};
var readAtomBody = (file) => {
  const text3 = readFileSync15(file, "utf8");
  const body = parseFrontmatter(text3)?.body ?? text3.replace(/\r\n/g, "\n");
  return body.replace(/^\n+/, "").replace(/\s+$/, "");
};
var BUILD_FLAGS = /* @__PURE__ */ new Set(["--atoms-only", "--check"]);
var runBuild = (args) => {
  const unknown = args.find((arg) => !BUILD_FLAGS.has(arg));
  if (unknown !== void 0) {
    process.stderr.write(`jig: unknown argument ${unknown}, expected --atoms-only or --check
`);
    return 2;
  }
  const pluginRoot = resolvePluginRoot();
  const errors = [...validateAtoms(pluginRoot), ...validateSkillDocs(pluginRoot), ...validateDocRefs(pluginRoot)];
  if (errors.length > 0) {
    process.stdout.write(`${errors.join("\n")}
`);
    return 1;
  }
  const isPlanWritten = !args.includes("--atoms-only") && !args.includes("--check");
  if (isPlanWritten) {
    const projectRoot = resolveProjectRoot(process.cwd());
    ensureJigDir(projectRoot);
    writePlan(projectRoot, buildPlan(projectRoot, pluginRoot));
  }
  process.stdout.write("ok\n");
  return 0;
};
var runAtom = (args) => {
  const [name, ...rest] = args;
  if (name === void 0 || rest.length > 0) {
    process.stderr.write("jig: usage: jig atom <name>\n");
    return 2;
  }
  const atom = readAtomIndex(resolvePluginRoot()).find((candidate) => candidate.name === name);
  if (atom === void 0) {
    process.stderr.write(`jig: unknown atom ${name}
`);
    return 1;
  }
  process.stdout.write(`${readAtomBody(atom.file)}
`);
  return 0;
};

// src/context/command.ts
import { resolve as resolve8 } from "node:path";

// src/context/chain.ts
import { lstatSync, readdirSync as readdirSync9, readFileSync as readFileSync16, statSync as statSync7 } from "node:fs";
import { dirname as dirname9, isAbsolute as isAbsolute3, join as join16, relative as relative5, resolve as resolve7 } from "node:path";
var RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md"];
var GLOSSARY = /glossary/i;
var GLOSSARY_MAP = /map/i;
var IMPORT = /(?:^|\s)@([^\s`'"()<>]+\.md)\b/g;
var MAX_IMPORT_DEPTH = 5;
var entriesOf = (dir2) => {
  try {
    return readdirSync9(dir2);
  } catch {
    return [];
  }
};
var hasFile = (dir2, name) => entriesOf(dir2).includes(name);
var isDirectory = (path2) => statSync7(path2, { throwIfNoEntry: false })?.isDirectory() === true;
var repoRootOf = (dir2) => {
  for (let current = resolve7(dir2); ; current = dirname9(current)) {
    if (lstatSync(join16(current, ".git"), { throwIfNoEntry: false }) !== void 0) return current;
    if (dirname9(current) === current) return void 0;
  }
};
var dirsFromRoot = (root, dir2) => {
  const rel = relative5(root, dir2);
  if (rel.startsWith("..") || isAbsolute3(rel)) return [root];
  const parts = rel === "" ? [] : rel.split(/[\\/]/);
  return [root, ...parts.map((_, index) => join16(root, ...parts.slice(0, index + 1)))];
};
var readText3 = (path2) => {
  try {
    return readFileSync16(path2, "utf8");
  } catch {
    return "";
  }
};
var homeDir = () => process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
var importsOf = (file) => [...readText3(file).matchAll(IMPORT)].map((match) => match[1] ?? "").map((ref) => ref.startsWith("~/") ? join16(homeDir(), ref.slice(2)) : resolve7(dirname9(file), ref)).filter((path2) => statSync7(path2, { throwIfNoEntry: false })?.isFile() === true);
var pathKey2 = (path2) => {
  const slash = toSlash(resolve7(path2));
  return process.platform === "win32" ? slash.toLowerCase() : slash;
};
var withImports = (file, out, seen, depth) => {
  const key = pathKey2(file);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(file);
  if (depth >= MAX_IMPORT_DEPTH) return;
  for (const imported of importsOf(file)) withImports(imported, out, seen, depth + 1);
};
var expandImports = (files) => {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const file of files) withImports(file, out, seen, 0);
  return out;
};
var glossaryIn = (dir2) => {
  const name = entriesOf(dir2).filter((entry) => entry.toLowerCase().endsWith(".md") && GLOSSARY.test(entry) && !GLOSSARY_MAP.test(entry)).sort()[0];
  return name === void 0 ? void 0 : join16(dir2, name);
};
var nearestGlossary = (dirs) => {
  for (const dir2 of [...dirs].reverse()) {
    const path2 = glossaryIn(dir2);
    if (path2 !== void 0) return { scope: dir2, path: path2 };
  }
  return void 0;
};
var chainFor = (target, names = RULE_FILES) => {
  const absolute = resolve7(target);
  const dir2 = isDirectory(absolute) ? absolute : dirname9(absolute);
  const repoRoot = repoRootOf(dir2);
  if (repoRoot === void 0) return void 0;
  const dirs = dirsFromRoot(repoRoot, dir2);
  const rules = [];
  const seen = /* @__PURE__ */ new Set();
  for (const current of dirs) {
    const entries = entriesOf(current);
    for (const name of names) {
      if (entries.includes(name)) withImports(join16(current, name), rules, seen, 0);
    }
  }
  const glossary = nearestGlossary(dirs);
  return glossary === void 0 ? { repoRoot, rules } : { repoRoot, rules, glossary };
};
var renderRules = (files) => files.map((file) => `--- ${toSlash(file)} ---
${readText3(file).trimEnd()}`).join("\n\n");
var renderGlossary = (glossary) => `Glossary for ${toSlash(glossary.scope)}: ${toSlash(glossary.path)}. Before you name a new field, type, prop or term there, read it: take the term it defines, never one of its _Avoid_ words.`;

// src/context/command.ts
var USAGE2 = "usage: jig context [--paths] <file or directory>...";
var runContext = (args) => {
  const pathsOnly = args.includes("--paths");
  const targets = args.filter((arg) => arg !== "--paths");
  if (targets.length === 0) throw new Error(USAGE2);
  const rules = [];
  const glossaries = /* @__PURE__ */ new Map();
  for (const target of targets) {
    const chain = chainFor(resolve8(target));
    if (chain === void 0) continue;
    for (const rule of chain.rules) if (!rules.includes(rule)) rules.push(rule);
    if (chain.glossary !== void 0) glossaries.set(chain.glossary.path, renderGlossary(chain.glossary));
  }
  const body = pathsOnly ? rules.map(toSlash).join("\n") : renderRules(rules);
  const out = [body, ...glossaries.values()].filter((part) => part !== "").join("\n\n");
  if (out !== "") process.stdout.write(`${out}
`);
  return 0;
};

// src/doctor.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { existsSync as existsSync8, readFileSync as readFileSync19 } from "node:fs";
import { join as join19 } from "node:path";

// src/core/journal.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync9, readdirSync as readdirSync10, readFileSync as readFileSync17, rmSync as rmSync5, statSync as statSync8 } from "node:fs";
import { join as join17 } from "node:path";
var JOURNAL_MAX_AGE_DAYS = 30;
var JOURNAL_MAX_BYTES = 50 * 1024 * 1024;
var JOURNAL_MESSAGE_MAX = 300;
var DAY_MS = 24 * 60 * 60 * 1e3;
var JOURNAL_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
var truncate = (text3) => text3.length <= JOURNAL_MESSAGE_MAX ? text3 : `${text3.slice(0, JOURNAL_MESSAGE_MAX - 1)}\u2026`;
var appendJournal = (projectRoot, entry) => {
  const record2 = { v: 1, ...entry, ts: entry.ts ?? (/* @__PURE__ */ new Date()).toISOString() };
  if (record2.message !== void 0) {
    record2.message = truncate(record2.message);
  }
  const dir2 = jigPaths(projectRoot).journal;
  mkdirSync9(dir2, { recursive: true });
  appendFileSync2(join17(dir2, `${record2.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record2)}
`);
  return record2;
};
var listJournalFiles = (projectRoot) => {
  const dir2 = jigPaths(projectRoot).journal;
  let names;
  try {
    names = readdirSync10(dir2);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names.sort()) {
    const day = JOURNAL_FILE.exec(name)?.[1];
    if (day === void 0) continue;
    const path2 = join17(dir2, name);
    files.push({ name, path: path2, day, size: statSync8(path2).size });
  }
  return files;
};
var dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
var rotateJournal = (projectRoot, now = Date.now()) => {
  const oldestKept = dayOf(now - JOURNAL_MAX_AGE_DAYS * DAY_MS);
  const removed = [];
  const kept = [];
  for (const file of listJournalFiles(projectRoot)) {
    if (file.day >= oldestKept) {
      kept.push(file);
      continue;
    }
    rmSync5(file.path, { force: true });
    removed.push(file.name);
  }
  let total = kept.reduce((sum, file) => sum + file.size, 0);
  for (const file of kept) {
    if (total <= JOURNAL_MAX_BYTES) break;
    rmSync5(file.path, { force: true });
    removed.push(file.name);
    total -= file.size;
  }
  return removed;
};
var parseRecord = (line) => {
  try {
    const value = JSON.parse(line);
    const isRecord = value.v === 1 && typeof value.ts === "string" && typeof value.kind === "string";
    return isRecord ? value : void 0;
  } catch {
    return void 0;
  }
};
var readJournal = (projectRoot, sinceMs = 0) => {
  const sinceDay = dayOf(sinceMs);
  const records = [];
  for (const file of listJournalFiles(projectRoot)) {
    if (file.day < sinceDay) continue;
    for (const line of readFileSync17(file.path, "utf8").split("\n")) {
      const record2 = line.trim() === "" ? void 0 : parseRecord(line);
      if (record2 !== void 0 && Date.parse(record2.ts) >= sinceMs) {
        records.push(record2);
      }
    }
  }
  return records;
};

// src/tiers/tiers.ts
import { existsSync as existsSync7, readFileSync as readFileSync18 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join18 } from "node:path";
import { parseArgs } from "node:util";
var TIERS2 = ["deep", "standard", "fast"];
var UNKNOWN_AGENT = "unknown";
var USER_CONFIG_ENV = "JIG_USER_CONFIG";
var AGENT_OVERRIDE_ENV = "JIG_AGENT";
var DEFAULT_LABEL = "~/.jig/config.jsonc";
var AGENT_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
var NO_MAPPING = "no mapping: choose a model that fits the tier (deep = strongest reasoning, standard = balanced, fast = cheap mechanical work)";
var DEFAULT_TIERS = {
  claude: { deep: ["opus", "sonnet"], standard: ["sonnet"], fast: ["haiku"] },
  codex: { deep: ["gpt-6.1-sol", "gpt-6.1-terra"], standard: ["gpt-6.1-terra"], fast: ["gpt-6-luna"] }
};
var AGENT_ENV = [
  { agent: "claude", vars: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] },
  { agent: "cursor", vars: ["CURSOR_AGENT", "CURSOR_VERSION"] },
  { agent: "codex", vars: ["CODEX_THREAD_ID", "CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"] }
];
var emptyUserConfig = () => ({ tiers: {}, prices: {} });
var readModels = (validator, value, path2) => {
  const models = validator.strings(value, path2);
  if (models === void 0) return void 0;
  if (models.length === 0) return validator.report(path2, "expected a non-empty array of strings");
  const before = validator.errors.length;
  models.forEach((model, index) => {
    if (model === "") {
      validator.report(childPath(path2, index), "expected a non-empty string");
    }
  });
  return validator.errors.length === before ? models : void 0;
};
var readTierMap = (validator, value, path2) => {
  const object = validator.object(value, path2, TIERS2);
  if (object === void 0) return void 0;
  const map = {};
  for (const tier of TIERS2) {
    if (!Object.hasOwn(object, tier)) continue;
    const models = readModels(validator, object[tier], childPath(path2, tier));
    if (models !== void 0) {
      map[tier] = models;
    }
  }
  return map;
};
var readTiers = (validator, value) => {
  const path2 = "$.tiers";
  const object = validator.object(value, path2, void 0);
  if (object === void 0) return {};
  const tiers = {};
  for (const [agent, entry] of Object.entries(object)) {
    const agentPath = childPath(path2, agent);
    if (!AGENT_ID.test(agent)) {
      validator.report(agentPath, "expected a kebab-case agent id");
      continue;
    }
    const map = readTierMap(validator, entry, agentPath);
    if (map !== void 0) {
      tiers[agent] = map;
    }
  }
  return tiers;
};
var readPrices = (validator, value) => {
  const path2 = "$.prices";
  const object = validator.object(value, path2, void 0);
  if (object === void 0) return {};
  const prices = {};
  for (const [model, entry] of Object.entries(object)) {
    const modelPath = childPath(path2, model);
    const price = validator.object(entry, modelPath, ["input", "output"]);
    if (price === void 0) continue;
    const input = validator.amount(price["input"], childPath(modelPath, "input"));
    const output = validator.amount(price["output"], childPath(modelPath, "output"));
    if (input !== void 0 && output !== void 0) prices[model] = { input, output };
  }
  return prices;
};
var validateUserConfig = (value) => {
  const validator = new Validator();
  const root = validator.object(value, "$", ["$schema", "tiers", "prices"]);
  if (root === void 0) return { config: emptyUserConfig(), errors: validator.errors };
  if (root["$schema"] !== void 0) {
    validator.string(root["$schema"], "$.$schema");
  }
  const tiers = root["tiers"] === void 0 ? {} : readTiers(validator, root["tiers"]);
  const prices = root["prices"] === void 0 ? {} : readPrices(validator, root["prices"]);
  return { config: { tiers, prices }, errors: validator.errors };
};
var parseUserConfig = (text3) => {
  let value;
  try {
    value = parseJsonc(text3);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { config: emptyUserConfig(), error: `$: ${reason}` };
  }
  const { config, errors } = validateUserConfig(value);
  if (errors.length > 0) return { config: emptyUserConfig(), error: errors.join("; ") };
  return { config };
};
var loadUserConfig = (env = process.env) => {
  const override = env[USER_CONFIG_ENV];
  const path2 = override || join18(homedir2(), ".jig", "config.jsonc");
  const label = override || DEFAULT_LABEL;
  if (!existsSync7(path2)) return { path: path2, label, config: emptyUserConfig() };
  return { path: path2, label, ...parseUserConfig(readFileSync18(path2, "utf8")) };
};
var detectAgent = (flag, env = process.env) => {
  if (flag) return flag;
  const override = env[AGENT_OVERRIDE_ENV]?.trim();
  if (override) return override;
  const match = AGENT_ENV.find(({ vars }) => vars.some((name) => Boolean(env[name])));
  return match?.agent ?? UNKNOWN_AGENT;
};
var resolveTiers = (agent, userConfig) => {
  const merged2 = { ...DEFAULT_TIERS[agent], ...userConfig.tiers[agent] };
  return Object.keys(merged2).length > 0 ? merged2 : void 0;
};
var isUserMapped = (agent, userConfig) => Object.hasOwn(userConfig.tiers, agent);
var tierEntries = (tiers) => TIERS2.flatMap((tier) => {
  const models = tiers[tier];
  return models === void 0 ? [] : [[tier, models]];
});
var formatTiers = (agent, tiers) => {
  const head = `agent: ${agent}`;
  if (tiers === void 0) return `${head}
${NO_MAPPING}`;
  const lines2 = tierEntries(tiers).map(([tier, models]) => `${tier}: ${models.join(", ")}`);
  return [head, ...lines2].join("\n");
};
var runTiers = (args) => {
  const { values } = parseArgs({ args, options: { agent: { type: "string" }, json: { type: "boolean" } }, strict: true });
  const loaded = loadUserConfig();
  if (loaded.error !== void 0) {
    throw new Error(`${loaded.label}: ${loaded.error}`);
  }
  const agent = detectAgent(values.agent);
  const tiers = resolveTiers(agent, loaded.config);
  const output = values.json ? JSON.stringify({ agent, tiers: tiers ?? null }) : formatTiers(agent, tiers);
  process.stdout.write(`${output}
`);
  return 0;
};

// src/doctor.ts
var MIN_NODE_MAJOR = 20;
var BYTES_PER_MB = 1024 * 1024;
var STATUS_WIDTH = 4;
var PROTECTED_FOR_DENY = [
  ".jig/config.jsonc",
  "eslint.config.*",
  "tsconfig*.json",
  ".oxlintrc.json",
  "stratum.config.jsonc",
  ".github/workflows/**",
  ".gitlab-ci.yml",
  ".husky/**"
];
var RECOMMENDED_DENY = PROTECTED_FOR_DENY.map((path2) => `Edit(${path2})`);
var formatDenyBlock = () => {
  const rules = RECOMMENDED_DENY.map((rule) => `      "${rule}"`);
  return ["{", '  "permissions": {', '    "deny": [', rules.join(",\n"), "    ]", "  }", "}"].join("\n");
};
var ok = (text3) => ({ status: "ok", text: text3 });
var warn = (text3) => ({ status: "warn", text: text3 });
var fail2 = (text3) => ({ status: "fail", text: text3 });
var checkNode = () => {
  const version2 = process.versions.node;
  const major = Number(version2.split(".")[0]);
  return major >= MIN_NODE_MAJOR ? ok(`node: ${version2}`) : fail2(`node: ${version2}, Node >= ${MIN_NODE_MAJOR} required`);
};
var NODE_NOT_ON_PATH = "node: not on PATH, so every hook (it runs a bare `node`) fails. An agent started from the macOS Dock or Finder gets the launchd PATH without nvm: start it from a terminal, or link node into /usr/local/bin";
var checkNodeOnPath = (env) => {
  const node = findInPath("node", env);
  if (node === void 0) return warn(NODE_NOT_ON_PATH);
  const version2 = spawnSync3(node, ["--version"], { encoding: "utf8", windowsHide: true }).stdout?.trim().replace(/^v/, "") ?? "";
  const major = Number(version2.split(".")[0]);
  return major >= MIN_NODE_MAJOR ? void 0 : warn(`node: ${node} on PATH is ${version2 || "unknown"}, the hooks need Node >= ${MIN_NODE_MAJOR}`);
};
var checkConfig = (config) => {
  if (config.files.length === 0) return warn("config: no .jig/config.jsonc, no tool runs; run jig init");
  const files = config.files.join(" + ");
  return config.error === void 0 ? ok(`config: ${files} valid`) : fail2(`config: ${files} invalid: ${config.error}; run jig init --update`);
};
var checkTiers = () => {
  const { label, config, error } = loadUserConfig();
  if (error !== void 0) return fail2(`tiers: ${label}: ${error}`);
  const agent = detectAgent(void 0);
  const tiers = resolveTiers(agent, config);
  const source = isUserMapped(agent, config) ? label : "built-in";
  if (tiers === void 0) return ok(`tiers: ${agent} no mapping`);
  const pairs = tierEntries(tiers).map(([tier, models]) => `${tier}=${models.join(",")}`);
  return ok(`tiers: ${agent} ${pairs.join(" ")} (${source})`);
};
var settingText = (setting) => {
  const parts = [setting.level, ...setting.command === void 0 ? [] : [`command "${setting.command}"`]];
  return setting.ignoreRules.length === 0 ? parts.join(", ") : `${parts.join(", ")}, ignores ${setting.ignoreRules.join(" ")}`;
};
var checkCatalogEntry = (entry, config, tools, discovery) => {
  const settings = entry.kind === "tool" ? config.tools : config.proofs;
  const setting = settings[entry.name];
  const found = discovery.found.find((item) => item.name === entry.name);
  if (setting === false) return ok(`${entry.name}: off in config`);
  if (setting === void 0) {
    return found?.status === "ready" ? warn(`${entry.name}: found in the project, not in config; run jig init --update`) : ok(`${entry.name}: not used`);
  }
  const bins = entry.binaries.flatMap((binary) => tools[binary.key]?.bin ?? []);
  if (bins.length > 0) return ok(`${entry.name}: ${bins.join(" ")} (${settingText(setting)})`);
  if (setting.level === "off") return ok(`${entry.name}: off in config`);
  const shim = entry.binaries.map((binary) => findUnresolvedShim(binary.command)).find((path2) => path2 !== void 0);
  if (shim !== void 0) return warn(`${entry.name}: shim ${shim} has no recognizable target, tool not used`);
  return warn(`${entry.name}: on in config, binary not installed, tool not used`);
};
var hasUiFiles = (projectRoot) => projectFiles(projectRoot).some(createMatcher(agentViewCheck.files));
var checkAgentViewSetup = (projectRoot, config, discovery) => {
  const setting = config.proofs[agentViewCheck.name];
  if (setting === false || setting?.level === "off") return void 0;
  const agentView = discovery.found.find((item) => item.name === agentViewCheck.name);
  if (agentView?.status === "ready" || !hasUiFiles(projectRoot)) return void 0;
  const setup = agentViewCheck.setup?.join(", then ") ?? "agent-view init";
  return warn(`agent-view: no ${AGENT_VIEW_CONFIG}; UI changes cannot be proven in the running app. Set it up: ${setup}`);
};
var checkCustom = (config) => config.checks.map((check2) => ok(`check ${check2.name}: on ${check2.on}, ${check2.level}, files ${check2.files.join(" ")}, run ${check2.run}`));
var checkGitignore = (projectRoot) => {
  const path2 = jigPaths(projectRoot).gitignore;
  return existsSync8(path2) ? ok(`gitignore: ${path2}`) : warn(`gitignore: ${path2} missing, jig creates it on first run`);
};
var readDenyList = (path2) => {
  const settings = parseJsonc(readFileSync19(path2, "utf8"));
  const deny = settings?.permissions?.deny;
  return Array.isArray(deny) ? deny.filter((entry) => typeof entry === "string") : [];
};
var checkDeny = (projectRoot) => {
  const path2 = join19(projectRoot, ".claude", "settings.json");
  let deny = [];
  if (existsSync8(path2)) {
    try {
      deny = readDenyList(path2);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...warn(`deny: ${path2} unreadable (${reason}), add the recommended block:`), block: formatDenyBlock() };
    }
  }
  const missing = RECOMMENDED_DENY.filter((entry) => !deny.includes(entry));
  if (missing.length === 0) return ok(`deny: ${path2} has the recommended block`);
  const text3 = `deny: ${path2} misses ${missing.length} of ${RECOMMENDED_DENY.length} rules, add the recommended block:`;
  return { ...warn(text3), block: formatDenyBlock() };
};
var AGENTS_READING_CLAUDE_SETTINGS = /* @__PURE__ */ new Set(["claude", UNKNOWN_AGENT]);
var denyApplies = (agent) => AGENTS_READING_CLAUDE_SETTINGS.has(agent);
var checkJournal = (projectRoot) => {
  const files = listJournalFiles(projectRoot);
  const bytes = files.reduce((total, file) => total + file.size, 0);
  const text3 = `journal: ${(bytes / BYTES_PER_MB).toFixed(1)} MB in ${files.length} files`;
  return bytes > JOURNAL_MAX_BYTES ? warn(`${text3}, above ${JOURNAL_MAX_BYTES / BYTES_PER_MB} MB`) : ok(text3);
};
var checkLock = (path2) => {
  if (!existsSync8(path2)) return ok(`lock: ${path2} free`);
  if (isLockAbandoned(path2)) return warn(`lock: ${path2} abandoned, remove it`);
  const holder = readLock(path2);
  return ok(`lock: ${path2} held${holder === void 0 ? "" : ` by pid ${holder.pid}`}`);
};
var formatCheck = (check2) => {
  const line = `${check2.status.padEnd(STATUS_WIDTH)} ${check2.text}`;
  return check2.block === void 0 ? line : `${line}
${check2.block}`;
};
var doctorChecks = (projectRoot, pluginRoot) => {
  const paths = jigPaths(projectRoot);
  const config = loadConfig(projectRoot);
  const { tools } = resolveTools(projectRoot, config);
  const discovery = discover(projectRoot);
  const agentViewSetup = checkAgentViewSetup(projectRoot, config, discovery);
  const nodeOnPath = checkNodeOnPath(process.env);
  return [
    checkNode(),
    ...nodeOnPath === void 0 ? [] : [nodeOnPath],
    ok(`plugin: ${pluginRoot}`),
    ok(`project: ${projectRoot}`),
    checkConfig(config),
    checkTiers(),
    ...CATALOG.map((entry) => checkCatalogEntry(entry, config, tools, discovery)),
    ...agentViewSetup === void 0 ? [] : [agentViewSetup],
    ...checkCustom(config),
    checkGitignore(projectRoot),
    ...denyApplies(detectAgent(void 0)) ? [checkDeny(projectRoot)] : [],
    checkJournal(projectRoot),
    checkLock(paths.heavyLock),
    checkLock(join19(paths.cache, "slot.lock"))
  ];
};
var runDoctor = (args) => {
  if (args.length > 0) {
    throw new Error("usage: jig doctor");
  }
  const checks = doctorChecks(resolveProjectRoot(process.cwd()), resolvePluginRoot());
  process.stdout.write(`${checks.map(formatCheck).join("\n")}
`);
  return checks.some((check2) => check2.status === "fail") ? 1 : 0;
};

// src/gates/stop.ts
import { createHash as createHash5 } from "node:crypto";
import { dirname as dirname12, join as join23 } from "node:path";

// src/core/snapshot.ts
import { createHash as createHash4 } from "node:crypto";
import { statSync as statSync9 } from "node:fs";
import { join as join20 } from "node:path";
var stampOf = (absolutePath) => {
  try {
    const stat = statSync9(absolutePath);
    return stat.isFile() ? { mtimeMs: stat.mtimeMs, size: stat.size } : void 0;
  } catch {
    return void 0;
  }
};
var isInsideProject = (path2) => path2 !== "" && !path2.startsWith("../") && path2 !== "..";
var changedFiles = (projectRoot) => {
  const top = gitToplevel(projectRoot);
  if (top === void 0) return [];
  const entries = gitStatus(top) ?? [];
  const longFormRoot = realPath(projectRoot);
  return entries.map((entry) => toProjectPath(longFormRoot, join20(top, entry.path))).filter(isInsideProject);
};
var takeSnapshot = (projectRoot) => {
  const snapshot3 = {};
  for (const path2 of changedFiles(projectRoot)) {
    const stamp = stampOf(join20(projectRoot, path2));
    if (stamp !== void 0) {
      snapshot3[path2] = stamp;
    }
  }
  return snapshot3;
};
var isSameStamp = (left, right) => left !== void 0 && left.mtimeMs === right.mtimeMs && left.size === right.size;
var diffFingerprint = (stamps) => {
  const lines2 = Object.keys(stamps).sort().map((path2) => `${path2}:${stamps[path2]?.mtimeMs}:${stamps[path2]?.size}`);
  return createHash4("sha1").update(lines2.join("\n")).digest("hex");
};
var changedSince = (projectRoot, before) => {
  const after = takeSnapshot(projectRoot);
  return Object.keys(after).filter((path2) => !isSameStamp(before[path2], after[path2])).sort();
};
var turnDiff = (projectRoot, snapshot3, edits, editsHoldShellChanges = false) => {
  const stamps = {};
  for (const { path: path2 } of edits) {
    const stamp = stampOf(join20(projectRoot, path2));
    if (stamp !== void 0) {
      stamps[path2] = stamp;
    }
  }
  const foreign = [];
  for (const path2 of changedFiles(projectRoot)) {
    if (Object.hasOwn(stamps, path2)) continue;
    const stamp = stampOf(join20(projectRoot, path2));
    if (stamp === void 0 || isSameStamp(snapshot3[path2], stamp)) continue;
    if (editsHoldShellChanges) {
      foreign.push(path2);
    } else {
      stamps[path2] = stamp;
    }
  }
  const files = Object.keys(stamps).sort();
  return { files, stamps, fingerprint: diffFingerprint(stamps), foreign: foreign.sort() };
};

// src/task-status/task-status.ts
import { spawn as spawn3 } from "node:child_process";
import { appendFileSync as appendFileSync3, mkdirSync as mkdirSync10, readFileSync as readFileSync20 } from "node:fs";
import { dirname as dirname10, join as join21 } from "node:path";

// src/task-status/template.html
var template_default = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>jig task status</title>\n<style>\nbody {\n  --paper: #faf9f5; --card: #fff; --sunk: #f0eee6;\n  --ink: #141413; --ink-2: #3d3d3a; --ink-3: #73726c; --line: rgba(31,30,29,.15); --line-2: rgba(31,30,29,.08);\n  --accent: #c6613f; --accent-soft: #f6e7df; --green: #2c7a39; --green-soft: #e2efdf;\n  --red: #b3261e; --red-soft: #f7dfdc; --blue: #2a69b8; --blue-soft: #dde8f5; --float: 0 2px 8px rgba(0,0,0,.08);\n  --sans: ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif; --serif: ui-serif, Georgia, \"Times New Roman\", serif; --mono: ui-monospace, \"SF Mono\", Menlo, Consolas, monospace;\n}\n@media (prefers-color-scheme: dark) { body:not(.light) { color-scheme: dark;\n  --paper: #262624; --card: #30302e; --sunk: #1f1e1d;\n  --ink: #faf9f5; --ink-2: #c2c0b6; --ink-3: #9c9a92; --line: rgba(222,220,209,.15); --line-2: rgba(222,220,209,.08);\n  --accent: #d97757; --accent-soft: #46302a; --green: #6fb37a; --green-soft: #26372a;\n  --red: #e5776e; --red-soft: #432725; --blue: #7aa7e0; --blue-soft: #25313f; --float: 0 2px 8px rgba(0,0,0,.3);\n} }\nbody.dark { color-scheme: dark;\n  --paper: #262624; --card: #30302e; --sunk: #1f1e1d;\n  --ink: #faf9f5; --ink-2: #c2c0b6; --ink-3: #9c9a92; --line: rgba(222,220,209,.15); --line-2: rgba(222,220,209,.08);\n  --accent: #d97757; --accent-soft: #46302a; --green: #6fb37a; --green-soft: #26372a;\n  --red: #e5776e; --red-soft: #432725; --blue: #7aa7e0; --blue-soft: #25313f; --float: 0 2px 8px rgba(0,0,0,.3);\n}\n:where(*) { box-sizing: border-box; }\n[hidden] { display: none !important; }\nbody { margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink); font: 430 16px/1.6 var(--sans); -webkit-text-size-adjust: 100%; overflow-x: clip; }\nh1, h2, p, ol { margin: 0; }\nol { padding: 0; list-style: none; }\nh1 { font: 500 26px/1.15 var(--serif); margin-bottom: 8px; text-wrap: balance; overflow-wrap: anywhere; }\nh2 { font: 500 22px/1.25 var(--serif); margin-bottom: 12px; display: flex; align-items: baseline; gap: 10px; }\na { color: var(--accent); text-underline-offset: 3px; }\nbutton { font: inherit; color: inherit; cursor: pointer; }\na:focus-visible, button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\ntime, .mono { font: 12px/1.5 var(--mono); color: var(--ink-3); font-variant-numeric: tabular-nums; }\n.pill { display: inline-block; font: 550 12px/1 var(--sans); padding: 4px 8px; border-radius: 99px; background: var(--sunk); color: var(--ink-2); border: 1px solid var(--line); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }\n.pill.accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }\n.pill.green { background: var(--green-soft); color: var(--green); border-color: transparent; }\n.pill.red { background: var(--red-soft); color: var(--red); border-color: transparent; }\n\n.page { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 40px; max-width: 1180px; margin: 0 auto; padding: 32px 24px 120px; }\n.rail { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; }\n.meta { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; margin-bottom: 12px; overflow-wrap: anywhere; }\n.live { display: inline-flex; gap: 6px; align-items: center; }\n.big { font: 500 44px/1 var(--serif); margin: 6px 0 10px; }\n.big small { font: 430 16px/1 var(--sans); color: var(--ink-3); }\n.seg { display: flex; gap: 3px; margin-bottom: 8px; }\n.seg i { flex: 1; height: 6px; border-radius: 3px; background: var(--line); }\n.seg i.done { background: var(--green); } .seg i.active { background: var(--accent); } .seg i.blocked { background: var(--red); }\n.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; border: 1.5px solid var(--ink-3); background: var(--paper); }\n.dot.done { background: var(--green); border-color: var(--green); }\n.dot.active { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }\n.dot.blocked { background: var(--red); border-color: var(--red); }\n.dot.skipped { border-style: dashed; border-color: var(--line); }\n.line { position: relative; margin-top: 12px; }\n.line::before { content: \"\"; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 2px; background: var(--line); }\n.line li { position: relative; display: flex; gap: 12px; align-items: flex-start; padding: 5px 0; font-size: 14px; line-height: 1.45; }\n.line li .dot { margin-top: 5px; }\n.line li > div { min-width: 0; overflow-wrap: anywhere; }\n.line li.done > div { color: var(--ink-3); }\n.line li.blocked > div { color: var(--red); }\n.line li.active > div { font-weight: 600; }\n.line li.skipped > div { color: var(--ink-3); text-decoration: line-through; }\n.line small { display: block; font-size: 12px; font-weight: 430; color: var(--ink-3); }\n.line li.blocked small { color: var(--red); }\n.runs { margin-top: 24px; font-size: 13px; color: var(--ink-3); }\n.runs li { padding: 2px 0; overflow-wrap: anywhere; }\n\n.inbox { margin-bottom: 32px; }\n.ask { padding: 16px; background: var(--card); border: 1px solid var(--accent); border-radius: 12px; margin-bottom: 14px; cursor: pointer; }\n.ask[aria-expanded=\"true\"] { cursor: default; }\n.ask:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n.ask .k { font-size: 12px; font-weight: 550; color: var(--ink-3); margin-bottom: 8px; }\n.ask .q { font-weight: 600; margin-bottom: 6px; overflow-wrap: anywhere; }\n.ask .def { font-size: 14px; color: var(--ink-2); overflow-wrap: anywhere; margin-bottom: 8px; }\n.ask .reply { display: block; width: 100%; resize: vertical; font: inherit; font-size: 15px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); }\n\n.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; position: sticky; top: 0; z-index: 4; background: var(--paper); padding: 10px 0; border-bottom: 1px solid var(--line-2); }\n.chips button { font-size: 13px; font-weight: 550; line-height: 1; padding: 7px 11px; border-radius: 99px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); }\n.chips button[aria-pressed=\"true\"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }\n.feed[data-f=\"d\"] .ev:not(.d), .feed[data-f=\"s\"] .ev:not(.s), .feed[data-f=\"q\"] .ev:not(.q) { display: none; }\n.ev { display: grid; grid-template-columns: 48px 26px minmax(0, 1fr); gap: 0 10px; position: relative; }\n.ev::before { content: \"\"; position: absolute; left: 70px; top: 0; bottom: 0; width: 1px; background: var(--line); }\n.ev > time { padding-top: 14px; text-align: right; }\n.ev .ico { width: 26px; height: 26px; margin-top: 12px; border-radius: 50%; display: grid; place-items: center; font: 600 12px/1 var(--mono); position: relative; }\n.ev.d .ico { background: var(--blue-soft); color: var(--blue); }\n.ev.s .ico { background: var(--green-soft); color: var(--green); }\n.ev.q .ico { background: var(--accent-soft); color: var(--accent); }\n.ev.start .ico { background: var(--ink); color: var(--paper); }\n.ev.start .item { border-color: var(--ink-3); background: var(--sunk); }\n.item { padding: 12px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; margin: 6px 0; min-width: 0; }\n.item .top { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }\n.item .top time { display: none; }\n.item p { font-size: 15px; overflow-wrap: anywhere; }\n.item.reverted p { text-decoration: line-through; color: var(--ink-3); }\n.item dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 14px; margin: 8px 0 0; font-size: 14px; }\n.item dt { font-size: 12px; line-height: 1.9; color: var(--ink-3); } .item dd { margin: 0; color: var(--ink-2); overflow-wrap: anywhere; }\n.empty { color: var(--ink-3); font-size: 14px; }\n\n.bar { position: fixed; z-index: 10; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); display: flex; gap: 8px; align-items: center; }\n.theme { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); box-shadow: var(--float); color: var(--ink-2); }\n.copy { font-size: 14px; font-weight: 550; line-height: 1; padding: 13px 16px; border-radius: 99px; border: 0; background: var(--ink); color: var(--paper); box-shadow: var(--float); }\n.copy:disabled { background: var(--sunk); color: var(--ink-3); border: 1px solid var(--line); cursor: default; }\n\n@media (max-width: 900px) {\n  .page { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0 16px 110px; }\n  .rail { position: static; max-height: none; overflow: visible; padding: 14px 0 6px; border-bottom: 1px solid var(--line); }\n  h1 { font-size: 20px; margin-bottom: 4px; }\n  .big { font: 600 15px/1.4 var(--sans); margin: 0; } .big small { font-size: 13px; }\n  .chips { position: static; }\n  .feed { padding-top: 16px; }\n  .ev { grid-template-columns: 40px 22px minmax(0, 1fr); gap: 0 8px; }\n  .ev::before { left: 58px; }\n  .ev .ico { width: 22px; height: 22px; font-size: 11px; }\n}\n@media (max-width: 480px) {\n  .ev { grid-template-columns: 22px minmax(0, 1fr); }\n  .ev > time { display: none; }\n  .ev::before { left: 11px; }\n  .item .top time { display: inline; }\n  .bar { left: 16px; }\n  .copy { flex: 1; }\n}\n</style>\n</head>\n<body>\n<div id=\"app\"></div>\n<script type=\"application/json\" id=\"status\">\n{\"branch\":\"\",\"journal\":\"\",\"builtAt\":\"\",\"lang\":\"en\",\"rows\":[]}\n</script>\n<script>\nconst S = JSON.parse(document.getElementById('status').textContent);\nconst LIVE_MS = 15 * 60e3;\nconst LABELS = {\n  en: {\n    locale: 'en-GB',\n    title: 'jig task status',\n    branch: 'branch',\n    live: ago => `live, last row ${ago}`,\n    quiet: ago => `no rows ${ago}`,\n    built: at => `page built at ${at}, rebuild: jig task-status open`,\n    stepsDone: total => `/ ${total} steps done`,\n    fromRun: run => `from run: ${run}`,\n    steps: 'Steps',\n    runs: 'Runs in this journal',\n    runItem: (at, count) => `${at}, ${count} rows`,\n    theme: 'Light or dark theme',\n    open: 'Open questions',\n    taken: 'went with',\n    answerLabel: question => `Answer to: ${question}`,\n    answerPlaceholder: 'Your answer',\n    answerHint: 'Click to answer',\n    copy: 'Copy answers',\n    copied: n => `copied (${n})`,\n    copyFailed: 'copy failed',\n    answersFor: title => `Answers for run \"${title}\":`,\n    journal: 'Journal',\n    all: 'All',\n    decisions: 'Decisions',\n    stepRows: 'Steps',\n    questions: 'Questions',\n    start: 'run start',\n    why: 'why',\n    evidence: 'evidence',\n    nothing: 'Nothing yet.',\n    justNow: 'just now',\n    minAgo: m => `${m} min ago`,\n    hoursAgo: (h, m) => `${h} h ${m} min ago`,\n    daysAgo: d => `${d} d ago`,\n  },\n  ru: {\n    locale: 'ru-RU',\n    title: '\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u0434\u0430\u0447\u0438 jig',\n    branch: '\u0432\u0435\u0442\u043A\u0430',\n    live: ago => `\u0436\u0438\u0432\u043E\u0439, \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0442\u0440\u043E\u043A\u0430 ${ago}`,\n    quiet: ago => `\u043D\u0435\u0442 \u0441\u0442\u0440\u043E\u043A ${ago}`,\n    built: at => `\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0441\u043E\u0431\u0440\u0430\u043D\u0430 \u0432 ${at}, \u043F\u0435\u0440\u0435\u0441\u043E\u0431\u0440\u0430\u0442\u044C: jig task-status open --lang ru`,\n    stepsDone: total => `/ ${total} \u0448\u0430\u0433\u043E\u0432 \u0433\u043E\u0442\u043E\u0432\u043E`,\n    fromRun: run => `\u0438\u0437 \u043F\u0440\u043E\u0433\u043E\u043D\u0430: ${run}`,\n    steps: '\u0428\u0430\u0433\u0438',\n    runs: '\u041F\u0440\u043E\u0433\u043E\u043D\u044B \u0432 \u0436\u0443\u0440\u043D\u0430\u043B\u0435',\n    runItem: (at, count) => `${at}, \u0441\u0442\u0440\u043E\u043A: ${count}`,\n    theme: '\u0421\u0432\u0435\u0442\u043B\u0430\u044F \u0438\u043B\u0438 \u0442\u0451\u043C\u043D\u0430\u044F \u0442\u0435\u043C\u0430',\n    open: '\u041E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B',\n    taken: '\u0432\u044B\u0431\u0440\u0430\u043D\u043E',\n    answerLabel: question => `\u041E\u0442\u0432\u0435\u0442 \u043D\u0430: ${question}`,\n    answerPlaceholder: '\u0412\u0430\u0448 \u043E\u0442\u0432\u0435\u0442',\n    answerHint: '\u041D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u0432\u0435\u0442\u0438\u0442\u044C',\n    copy: '\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442\u044B',\n    copied: n => `\u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E (${n})`,\n    copyFailed: '\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C',\n    answersFor: title => `\u041E\u0442\u0432\u0435\u0442\u044B \u043F\u043E \u043F\u0440\u043E\u0433\u043E\u043D\u0443 \xAB${title}\xBB:`,\n    journal: '\u0416\u0443\u0440\u043D\u0430\u043B',\n    all: '\u0412\u0441\u0451',\n    decisions: '\u0420\u0435\u0448\u0435\u043D\u0438\u044F',\n    stepRows: '\u0428\u0430\u0433\u0438',\n    questions: '\u0412\u043E\u043F\u0440\u043E\u0441\u044B',\n    start: '\u043D\u0430\u0447\u0430\u043B\u043E \u043F\u0440\u043E\u0433\u043E\u043D\u0430',\n    why: '\u043F\u043E\u0447\u0435\u043C\u0443',\n    evidence: '\u0434\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u043E',\n    nothing: '\u041F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E.',\n    justNow: '\u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E',\n    minAgo: m => `${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`,\n    hoursAgo: (h, m) => `${h} \u0447 ${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`,\n    daysAgo: d => `${d} \u0434\u043D \u043D\u0430\u0437\u0430\u0434`,\n  },\n};\nconst lang = Object.hasOwn(LABELS, S.lang) ? S.lang : 'en';\nconst L = LABELS[lang];\nconst esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'}[c]));\nconst hm = t => {\n  const d = new Date(t);\n  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(L.locale, {hour: '2-digit', minute: '2-digit'});\n};\nconst dayHm = t => {\n  const d = new Date(t);\n  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(L.locale, {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'});\n};\nconst ago = t => {\n  const m = Math.round((Date.now() - new Date(t)) / 60e3);\n  return m < 1 ? L.justNow : m < 60 ? L.minAgo(m) : m < 1440 ? L.hoursAgo(Math.floor(m / 60), m % 60) : L.daysAgo(Math.floor(m / 1440));\n};\n\nconst kindOf = row => row.phase === 'start' ? 'start' : row.phase === 'step' ? 's' : row.phase === 'question' ? 'q' : 'd';\nconst toneOf = result => {\n  if (/\\b(reverted|blocked|failed|fail|red|not verified|inconclusive)\\b/i.test(result)) return 'red';\n  if (/\\b(kept|done|verified|green|passed|pass|answered)\\b/i.test(result)) return 'green';\n  if (/^(open|active)\\b/i.test(result)) return 'accent';\n  return '';\n};\nconst SKIPPED_WORDS = ['skip', 'skipped', 'superseded', 'dropped', 'cancelled', 'canceled'];\nconst stepStatus = result => {\n  const word = (/^\\s*(\\w+)/.exec(result) || [])[1]?.toLowerCase();\n  if (SKIPPED_WORDS.includes(word)) return 'skipped';\n  return ['done', 'active', 'blocked'].includes(word) ? word : 'todo';\n};\nconst latestBy = rows => [...rows.reduce((map, row) => map.set(row.decision, row), new Map()).values()];\n\nconst rows = S.rows;\nconst starts = rows.map((row, i) => ({row, i})).filter(({row}) => row.phase === 'start');\nconst runFrom = starts.length ? starts[starts.length - 1].i : 0;\nconst runRows = rows.slice(runFrom);\nconst title = starts.length ? starts[starts.length - 1].row.decision : L.title;\nconst last = rows[rows.length - 1];\nconst isLive = last !== undefined && Date.now() - new Date(last.ts) < LIVE_MS;\nconst isUnclosed = status => status === 'todo' || status === 'active' || status === 'blocked';\nconst runTitleAt = i => starts.filter(start => start.i <= i).at(-1)?.row.decision ?? '';\nconst stepsIn = (from, to) => latestBy(rows.slice(from, to).map((row, k) => ({...row, at: from + k})).filter(row => row.phase === 'step'))\n  .map(row => ({...row, status: stepStatus(row.result)}));\nconst runSteps = stepsIn(runFrom, rows.length);\nconst runStepTitles = new Set(runSteps.map(s => s.decision));\nconst carriedSteps = stepsIn(0, runFrom).filter(s => isUnclosed(s.status) && !runStepTitles.has(s.decision))\n  .map(s => ({...s, run: runTitleAt(s.at) || dayHm(s.ts)}));\nconst steps = [...carriedSteps, ...runSteps];\nconst counted = steps.filter(s => s.status !== 'skipped');\nconst done = counted.filter(s => s.status === 'done').length;\nconst openQuestions = latestBy(runRows.filter(row => row.phase === 'question')).filter(row => row.result === '' || /^open\\b/i.test(row.result));\nconst runs = (starts.length && starts[0].i === 0 ? starts : [{row: rows[0], i: 0}, ...starts]).filter(({row}) => row !== undefined)\n  .map(({row, i}, n, all) => ({row, count: (all[n + 1]?.i ?? rows.length) - i}));\n\nconst link = text => /^https?:\\/\\/\\S+$/.test(text) ? `<a href=\"${esc(text)}\">${esc(text)}</a>` : esc(text);\nconst rowItem = row => {\n  const tone = toneOf(row.result);\n  const tags = [\n    row.phase === 'start' ? `<span class=\"pill\">${L.start}</span>` : `<span class=\"pill\">${esc(row.phase)}</span>`,\n    row.result ? `<span class=\"pill ${tone}\">${esc(row.result)}</span>` : '',\n  ].join('');\n  const extra = [[L.why, row.why, esc], [L.evidence, row.evidence, link]].filter(([, v]) => v);\n  const more = extra.length ? `<dl>${extra.map(([k, v, show]) => `<dt>${k}</dt><dd>${show(v)}</dd>`).join('')}</dl>` : '';\n  const reverted = /\\breverted\\b/i.test(row.result) ? ' reverted' : '';\n  return `<div class=\"item${reverted}\"><div class=\"top\"><time>${hm(row.ts)}</time>${tags}</div><p>${esc(row.decision)}</p>${more}</div>`;\n};\nconst ICON = {d: '\u25C6', s: '\u2713', q: '?', start: '\u25B6'};\nconst counts = {d: 0, s: 0, q: 0, start: 0};\nfor (const row of rows) counts[kindOf(row)]++;\nconst FILTERS = [['all', L.all, rows.length], ['d', L.decisions, counts.d], ['s', L.stepRows, counts.s], ['q', L.questions, counts.q]];\nconst savedFilter = localStorage.getItem('jig-task-status-filter');\nconst filter = FILTERS.some(([k, , count]) => k === savedFilter && count) ? savedFilter : 'all';\n\nconst stepNote = s => [s.result, s.run ? L.fromRun(s.run) : ''].filter(Boolean).join(' \xB7 ');\nconst stepLine = s => `<li class=\"${s.status}\"><i class=\"dot ${s.status}\"></i><div>${esc(s.decision)}${stepNote(s) ? `<small>${esc(stepNote(s))}</small>` : ''}</div></li>`;\nconst askCard = (q, i) => `<section class=\"ask\" data-i=\"${i}\" tabindex=\"0\" aria-expanded=\"${Boolean(drafts[i])}\" title=\"${L.answerHint}\"><div class=\"k\">${dayHm(q.ts)}</div><p class=\"q\">${esc(q.decision)}</p>${q.why ? `<p class=\"def\">${L.taken}: ${esc(q.why)}</p>` : ''}\n  <textarea class=\"reply\" rows=\"2\" placeholder=\"${L.answerPlaceholder}\" aria-label=\"${esc(L.answerLabel(q.decision))}\"${drafts[i] ? '' : ' hidden'}></textarea></section>`;\n\nconst draftKey = q => `jig-task-status-answer:${location.pathname}:${q.ts}:${q.decision}`;\nconst readDraft = q => {\n  try {\n    return localStorage.getItem(draftKey(q)) ?? '';\n  } catch {\n    return '';\n  }\n};\nconst drafts = openQuestions.map(readDraft);\nconst answersText = () => {\n  const items = openQuestions\n    .map((q, i) => ({q, answer: String(drafts[i] ?? '').trim()}))\n    .filter(item => item.answer !== '')\n    .map(({q, answer}) => `${q.decision}\\n\u2192 ${answer}`);\n  return {count: items.length, text: items.length ? `${L.answersFor(title)}\\n\\n${items.join('\\n\\n')}` : ''};\n};\nconst COPIED_MS = 2500;\n\ndocument.documentElement.lang = lang;\nconst theme = localStorage.getItem('jig-task-status-theme');\ndocument.body.classList.toggle('light', theme === 'light');\ndocument.body.classList.toggle('dark', theme === 'dark');\ndocument.title = title;\ndocument.getElementById('app').innerHTML = `<div class=\"page\">\n  <aside class=\"rail\">\n    <h1>${esc(title)}</h1>\n    <p class=\"meta mono\"><span>${L.branch} ${esc(S.branch)}</span>${last ? `<span class=\"live\"><i class=\"dot ${isLive ? 'done' : 'blocked'}\"></i>${isLive ? L.live(ago(last.ts)) : L.quiet(ago(last.ts))}</span>` : ''}</p>\n    ${steps.length ? `<p class=\"big\">${done}<small> ${L.stepsDone(counted.length)}</small></p>\n    <div class=\"seg\">${counted.map(s => `<i class=\"${s.status}\" title=\"${esc(s.decision)}\"></i>`).join('')}</div>\n    <ol class=\"line\" aria-label=\"${L.steps}\">${steps.map(stepLine).join('')}</ol>` : ''}\n    ${runs.length > 1 ? `<ol class=\"runs\" aria-label=\"${L.runs}\"><li><b>${L.runs}</b></li>${runs.map(({row, count}) => `<li>${esc(row.phase === 'start' ? row.decision : row.phase)} \xB7 ${L.runItem(dayHm(row.ts), count)}</li>`).join('')}</ol>` : ''}\n    <p class=\"runs mono\">${L.built(dayHm(S.builtAt))}<br>${esc(S.journal)}</p>\n  </aside>\n  <main class=\"feed\" data-f=\"${filter}\">\n    ${openQuestions.length ? `<section class=\"inbox\"><h2>${L.open} <span class=\"pill accent\">${openQuestions.length}</span></h2>${openQuestions.map(askCard).join('')}</section>` : ''}\n    <h2>${L.journal}</h2>\n    ${rows.length ? `<div class=\"chips\" role=\"toolbar\">${FILTERS.filter(([, , count]) => count).map(([k, label, count]) => `<button type=\"button\" data-f=\"${k}\" aria-pressed=\"${filter === k}\">${label} \xB7 ${count}</button>`).join('')}</div>\n    ${[...rows].reverse().map(row => `<div class=\"ev ${kindOf(row)}\"><time>${hm(row.ts)}</time><span class=\"ico\">${ICON[kindOf(row)]}</span>${rowItem(row)}</div>`).join('')}` : `<p class=\"empty\">${L.nothing}</p>`}\n  </main>\n</div>\n<div class=\"bar\"><button class=\"theme\" type=\"button\" aria-label=\"${L.theme}\">&#9680;</button>${openQuestions.length ? `<button class=\"copy\" type=\"button\">${L.copy}</button>` : ''}</div>`;\n\nconst copyButton = document.querySelector('.copy');\nconst refreshCopy = () => {\n  if (copyButton) copyButton.disabled = answersText().count === 0;\n};\n\nconst writeClipboard = async text => {\n  try {\n    await navigator.clipboard.writeText(text);\n    return true;\n  } catch {\n    const area = document.createElement('textarea');\n    area.value = text;\n    area.setAttribute('readonly', '');\n    area.style.position = 'fixed';\n    area.style.opacity = '0';\n    document.body.append(area);\n    area.select();\n    const isCopied = document.execCommand('copy');\n    area.remove();\n    return isCopied;\n  }\n};\n\nfor (const box of document.querySelectorAll('.ask')) {\n  const i = Number(box.dataset.i);\n  const q = openQuestions[i];\n  const reply = box.querySelector('.reply');\n  reply.value = drafts[i];\n  const showReply = () => {\n    if (!reply.hidden) return;\n    reply.hidden = false;\n    box.setAttribute('aria-expanded', 'true');\n    reply.focus();\n  };\n  box.addEventListener('click', showReply);\n  box.addEventListener('keydown', event => {\n    if (event.target === box && (event.key === 'Enter' || event.key === ' ')) {\n      event.preventDefault();\n      showReply();\n    }\n  });\n  reply.addEventListener('input', () => {\n    drafts[i] = reply.value;\n    try {\n      if (reply.value.trim() === '') localStorage.removeItem(draftKey(q));\n      else localStorage.setItem(draftKey(q), reply.value);\n    } catch {}\n    refreshCopy();\n  });\n}\n\nrefreshCopy();\ncopyButton?.addEventListener('click', async () => {\n  const {text, count} = answersText();\n  if (count === 0) return;\n  const isCopied = await writeClipboard(text);\n  copyButton.textContent = isCopied ? L.copied(count) : L.copyFailed;\n  setTimeout(() => { copyButton.textContent = L.copy; }, COPIED_MS);\n});\n\nfor (const chip of document.querySelectorAll('.chips button')) {\n  chip.addEventListener('click', () => {\n    document.querySelector('.feed').dataset.f = chip.dataset.f;\n    for (const other of document.querySelectorAll('.chips button')) other.setAttribute('aria-pressed', String(other === chip));\n    localStorage.setItem('jig-task-status-filter', chip.dataset.f);\n  });\n}\n\ndocument.querySelector('.theme').addEventListener('click', () => {\n  const isDark = getComputedStyle(document.body).colorScheme === 'dark';\n  const next = isDark ? 'light' : 'dark';\n  document.body.classList.toggle('light', next === 'light');\n  document.body.classList.toggle('dark', next === 'dark');\n  localStorage.setItem('jig-task-status-theme', next);\n});\n</script>\n</body>\n</html>\n";

// src/task-status/task-status.ts
var COLUMNS = ["ts", "phase", "decision", "why", "evidence", "result"];
var START_PHASE = "start";
var STEP_PHASE = "step";
var TODO_RESULT = "todo";
var PAGE_LANGS = ["en", "ru"];
var ACTIVE_JOURNAL_MAX_AGE_MS = 12 * 60 * 60 * 1e3;
var EXIT_NOT_MET = 1;
var EXIT_USAGE = 2;
var HEADER = COLUMNS.join("	");
var DATA_BLOCK = /(<script type="application\/json" id="status">)([\s\S]*?)(<\/script>)/;
var LOG_FLAGS = /* @__PURE__ */ new Map([
  ["--why", "why"],
  ["--evidence", "evidence"],
  ["--result", "result"]
]);
var LOG_USAGE = "usage: task-status log <phase> <decision> [--why <text>] [--evidence <text>] [--result <text>]";
var PLAN_USAGE = "usage: task-status plan <step> [<step>...]";
var TaskStatusFailure = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var usage = (message) => new TaskStatusFailure(EXIT_USAGE, message);
var branchDirName = (projectRoot) => {
  const branch = gitCurrentBranch(projectRoot);
  if (branch !== void 0) return branch.replace(/[^A-Za-z0-9._-]/g, "_");
  return `detached-${gitShortSha(projectRoot) ?? "none"}`;
};
var journalLocation = (projectRoot) => {
  const branch = branchDirName(projectRoot);
  const dir2 = join21(jigPaths(projectRoot).runs, branch);
  return { branch, journal: join21(dir2, "task-status.tsv"), page: join21(dir2, "task-status.html") };
};
var cleanCell = (value) => value.replace(/\r\n|[\t\n\r]/g, " ").trim();
var formatRow = (row) => COLUMNS.map((column) => cleanCell(row[column])).join("	");
var parseLine = (line) => {
  const [ts2 = "", phase = "", decision = "", why = "", evidence = "", ...result] = line.split("	");
  return { ts: ts2, phase, decision, why, evidence, result: result.join(" ") };
};
var parseJournal = (text3) => text3.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== "" && line !== HEADER).map(parseLine);
var readText4 = (path2) => {
  try {
    return readFileSync20(path2, "utf8");
  } catch {
    return void 0;
  }
};
var readJournalRows = (path2) => {
  const text3 = readText4(path2);
  return text3 === void 0 ? void 0 : parseJournal(text3);
};
var appendRow = (path2, input, now) => {
  const row = {
    ts: now.toISOString(),
    phase: cleanCell(input.phase),
    decision: cleanCell(input.decision),
    why: cleanCell(input.why ?? ""),
    evidence: cleanCell(input.evidence ?? ""),
    result: cleanCell(input.result ?? "")
  };
  mkdirSync10(dirname10(path2), { recursive: true });
  const isFresh = (readText4(path2) ?? "").trim() === "";
  appendFileSync3(path2, `${isFresh ? `${HEADER}
` : ""}${formatRow(row)}
`);
  return row;
};
var isActive = (rows, now) => {
  const last = rows.at(-1);
  if (last === void 0) return false;
  return now.getTime() - Date.parse(last.ts) < ACTIVE_JOURNAL_MAX_AGE_MS;
};
var readActiveJournal = (projectRoot, now = /* @__PURE__ */ new Date()) => {
  const location = journalLocation(projectRoot);
  const rows = readJournalRows(location.journal);
  if (rows === void 0 || !isActive(rows, now)) return void 0;
  return { rows, journal: toSlash(location.journal) };
};
var logToActiveJournal = (projectRoot, input, now = /* @__PURE__ */ new Date()) => {
  const location = journalLocation(projectRoot);
  const rows = readJournalRows(location.journal);
  if (rows === void 0 || !isActive(rows, now)) return false;
  appendRow(location.journal, input, now);
  return true;
};
var lastStart = (rows) => rows.findLast((row) => row.phase === START_PHASE);
var activeRunContext = (projectRoot, now = /* @__PURE__ */ new Date()) => {
  const active = readActiveJournal(projectRoot, now);
  const last = active?.rows.at(-1);
  if (active === void 0 || last === void 0) return void 0;
  const start = lastStart(active.rows);
  const title = start === void 0 ? "" : ` "${start.decision}"`;
  return `jig: task-status run${title}, last row ${last.phase}: "${last.decision}", journal ${active.journal}`;
};
var parseLog = (args) => {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index] ?? "";
    const key = LOG_FLAGS.get(token);
    if (key !== void 0) {
      const value = args[index + 1];
      if (value === void 0) throw usage(`${token} needs a value. ${LOG_USAGE}`);
      options[key] = value;
      index++;
      continue;
    }
    if (token.startsWith("--")) throw usage(`unknown option ${token}. ${LOG_USAGE}`);
    positional.push(token);
  }
  const [phase, decision, ...rest] = positional;
  const isComplete = phase !== void 0 && cleanCell(phase) !== "" && decision !== void 0 && cleanCell(decision) !== "";
  if (!isComplete || rest.length > 0) throw usage(LOG_USAGE);
  return { phase, decision, ...options };
};
var parsePlan = (args) => {
  const titles = args.map(cleanCell);
  const isValid = titles.length > 0 && titles.every((title) => title !== "" && !title.startsWith("--"));
  if (!isValid) throw usage(PLAN_USAGE);
  return [...new Set(titles)];
};
var currentRunRows = (rows) => rows.slice(Math.max(0, rows.findLastIndex((row) => row.phase === START_PHASE)));
var planSteps = (path2, titles, now) => {
  const known = new Set(
    currentRunRows(readJournalRows(path2) ?? []).filter((row) => row.phase === STEP_PHASE).map((row) => row.decision)
  );
  for (const title of titles) {
    if (!known.has(title)) appendRow(path2, { phase: STEP_PHASE, decision: title, result: TODO_RESULT }, now);
  }
};
var isPageLang = (value) => PAGE_LANGS.some((lang) => lang === value);
var OPEN_USAGE = "usage: task-status open [--lang en|ru] [--no-browser]";
var parseOpen = (args) => {
  const options = { lang: "en", isBrowser: true };
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--no-browser") {
      options.isBrowser = false;
      continue;
    }
    if (token !== "--lang") throw usage(OPEN_USAGE);
    const value = args[index + 1];
    if (!isPageLang(value)) throw usage(`--lang must be ${PAGE_LANGS.join(" or ")}, got ${value ?? "nothing"}`);
    options.lang = value;
    index++;
  }
  return options;
};
var browserCommand = (platform, path2) => {
  if (platform === "win32") return ["explorer.exe", path2];
  if (platform === "darwin") return ["open", path2];
  return ["xdg-open", path2];
};
var showInBrowserBestEffort = (path2) => {
  if (process.env["CI"] !== void 0) return;
  const [command = "", ...args] = browserCommand(process.platform, path2);
  try {
    const child = spawn3(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => void 0);
    child.unref();
  } catch {
    return;
  }
};
var renderPage = (data) => {
  const json = JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
  return template_default.replace(DATA_BLOCK, (_match, open, _body, close) => `${open}
${json}
${close}`);
};
var noJournal = (location) => new TaskStatusFailure(EXIT_NOT_MET, `no task-status journal for branch ${location.branch}, start one with: task-status log start "<task title>"`);
var openPage = (location, args, now) => {
  const { lang, isBrowser } = parseOpen(args);
  const rows = readJournalRows(location.journal);
  if (rows === void 0) throw noJournal(location);
  const journal2 = toSlash(location.journal);
  writeFileAtomic(location.page, renderPage({ branch: location.branch, journal: journal2, builtAt: now.toISOString(), lang, rows }));
  if (isBrowser) showInBrowserBestEffort(location.page);
  return toSlash(location.page);
};
var dispatch = (args, now) => {
  const [sub, ...rest] = args;
  const projectRoot = resolveProjectRoot(process.cwd());
  const location = journalLocation(projectRoot);
  const record2 = (write) => {
    ensureJigDir(projectRoot);
    write();
    return toSlash(location.journal);
  };
  if (sub === "log") {
    const input = parseLog(rest);
    return record2(() => appendRow(location.journal, input, now));
  }
  if (sub === "plan") {
    const titles = parsePlan(rest);
    return record2(() => planSteps(location.journal, titles, now));
  }
  if (sub === "open") return openPage(location, rest, now);
  if (sub === "path") {
    if (readJournalRows(location.journal) === void 0) throw noJournal(location);
    return toSlash(location.journal);
  }
  throw usage(`unknown task-status subcommand ${sub ?? "(none)"}, expected log, plan, open or path`);
};
var runTaskStatus = (args) => {
  try {
    process.stdout.write(`${dispatch(args, /* @__PURE__ */ new Date())}
`);
    return 0;
  } catch (error) {
    if (!(error instanceof TaskStatusFailure)) throw error;
    process.stderr.write(`jig: ${error.message}
`);
    return error.code;
  }
};

// src/worktree/list.ts
import { lstatSync as lstatSync2, readFileSync as readFileSync21, realpathSync as realpathSync2 } from "node:fs";
import { dirname as dirname11, join as join22, resolve as resolve9 } from "node:path";
var parseWorktreeList = (porcelain) => {
  const worktrees = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines2 = block.split(/\r?\n/).filter(Boolean);
    const pathLine = lines2.find((line) => line.startsWith("worktree "));
    if (pathLine === void 0) continue;
    const branchLine = lines2.find((line) => line.startsWith("branch "));
    const hasFlag = (flag) => lines2.some((line) => line === flag || line.startsWith(`${flag} `));
    const worktree = {
      path: resolve9(pathLine.slice("worktree ".length)),
      isPrunable: hasFlag("prunable"),
      isLocked: hasFlag("locked")
    };
    if (branchLine !== void 0) {
      worktree.branch = branchLine.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
    worktrees.push(worktree);
  }
  return worktrees;
};
var listWorktrees = (cwd) => {
  const result = git(["worktree", "list", "--porcelain"], cwd);
  if (!result.ok) throw new Error(`git worktree list failed: ${result.stderr.trim()}`);
  return parseWorktreeList(result.stdout);
};
var LINKED_GITDIR = /^gitdir:\s*(.+)$/m;
var linkedWorktreeRoot = (dir2) => {
  for (let current = resolve9(dir2); ; current = dirname11(current)) {
    const dotGit = join22(current, ".git");
    const stats = lstatSync2(dotGit, { throwIfNoEntry: false });
    if (stats?.isFile() === true) {
      const gitdir = LINKED_GITDIR.exec(readFileSync21(dotGit, "utf8"))?.[1] ?? "";
      return /[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(gitdir.trim()) ? current : void 0;
    }
    if (stats !== void 0 || dirname11(current) === current) return void 0;
  }
};
var canonical = (path2) => {
  try {
    return realpathSync2.native(path2);
  } catch {
    return path2;
  }
};
var samePath = (left, right, platform = process.platform) => {
  const normalize2 = (path2) => {
    const slashed = canonical(path2).replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? slashed.toLowerCase() : slashed;
  };
  return normalize2(left) === normalize2(right);
};

// src/tools/finding.ts
var POST_EDIT_LINE_LIMIT = 15;
var STOP_LINE_LIMIT = 20;
var formatFinding = (finding) => `${finding.file}:${finding.line} ${finding.rule} \u2192 ${finding.fix ?? finding.message}`;
var collapseFindings = (findings) => {
  const groups = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    const key = `${finding.rule}\0${finding.file}`;
    const group = groups.get(key);
    if (group === void 0) {
      groups.set(key, { first: finding, count: 1 });
      continue;
    }
    group.count++;
    if (finding.line < group.first.line) {
      group.first = finding;
    }
  }
  return [...groups.values()].map(
    ({ first, count }) => count === 1 ? formatFinding(first) : `${formatFinding(first)} (\xD7${count})`
  );
};
var truncationLine = (hidden, pluginRoot) => `\u2026 ${hidden} more (run: node ${toSlash(pluginRoot)}/bin/jig.mjs check stop)`;
var limitLines = (lines2, limit, pluginRoot) => {
  if (lines2.length <= limit) return [...lines2];
  const kept = lines2.slice(0, limit - 1);
  return [...kept, truncationLine(lines2.length - kept.length, pluginRoot)];
};
var formatFindings = (findings, limit, pluginRoot) => limitLines(collapseFindings(findings), limit, pluginRoot);

// src/gates/custom.ts
var FILES_TOKEN2 = "{files}";
var PARSED_OK_CODES = [0, 1];
var MESSAGE_MAX = 200;
var checkRule = (check2) => `check/${check2.name}`;
var checkFiles = (check2, files) => {
  const matches = createMatcher(check2.files);
  return files.filter(matches);
};
var checkArgv = (projectRoot, check2, files) => {
  const [command = "", ...args] = expandToken(splitCommand(check2.run), FILES_TOKEN2, files);
  return [...resolveBin(projectRoot, [], command) ?? [command], ...args];
};
var firstLine2 = (text3) => text3.split("\n").map((line) => line.trim()).find((line) => line !== "")?.slice(0, MESSAGE_MAX) ?? "";
var exitFinding = (check2, file, output, code) => ({
  tool: check2.name,
  rule: checkRule(check2),
  severity: "error",
  file,
  line: 1,
  message: firstLine2(output) || `exit ${code}`
});
var withSeverity = (findings, level) => {
  if (level === "off") return [];
  return findings.map((finding) => ({ ...finding, severity: level === "warn" ? "warn" : finding.severity }));
};
var runCustomCheck = async (projectRoot, check2, files, timeoutMs) => {
  const argv = checkArgv(projectRoot, check2, files);
  const result = await run(argv, { cwd: projectRoot, timeoutMs });
  const tool = check2.name;
  if (result.timedOut) return { tool, findings: [], durationMs: result.durationMs, failure: `timeout after ${timeoutMs} ms` };
  if (result.error !== void 0) return { tool, findings: [], durationMs: result.durationMs, failure: result.error };
  const parse2 = outputParser(check2.format);
  if (check2.format === EXIT_FORMAT || parse2 === void 0) {
    const isClean2 = result.code === 0;
    const [file = ""] = files;
    const findings2 = isClean2 ? [] : [exitFinding(check2, file, result.stderr || result.stdout, result.code)];
    return { tool, findings: withSeverity(findings2, check2.level), durationMs: result.durationMs };
  }
  const settled = settleExit(
    { tool, argv, cwd: projectRoot, timeoutMs, okCodes: PARSED_OK_CODES, parse: (stdout) => parse2(stdout, projectRoot, projectRoot) },
    { code: result.code, output: result.stdout, errorOutput: result.stderr, durationMs: result.durationMs }
  );
  const findings = keepOnChangedLines(projectRoot, settled.findings).filter((finding) => finding.severity === "error");
  return { ...settled, findings: withSeverity(findings, check2.level) };
};

// src/gates/edit.ts
var EDIT_TOOL_TIMEOUT_MS = 5e3;
var applyLevel = (findings, level) => {
  if (level === "off") return [];
  if (level === "error") return [...findings];
  return findings.map((finding) => ({ ...finding, severity: "warn" }));
};
var applySetting = (findings, setting) => {
  const isIgnored2 = createMatcher(setting.ignoreRules);
  return applyLevel(
    findings.filter((finding) => !isIgnored2(finding.rule)),
    setting.level
  );
};
var toolSetting = (config, tool) => enabledSetting(config.tools, tool.name);
var toolFiles = (tool, files) => files.filter(createMatcher(tool.files));
var editRun = async (tool, plan, projectRoot, file) => {
  const setting = toolSetting(plan.config, tool);
  if (tool.edit === void 0 || setting === void 0 || toolFiles(tool, [file]).length === 0) return void 0;
  const result = await tool.edit(plan.tools, projectRoot, file, EDIT_TOOL_TIMEOUT_MS);
  return result === void 0 ? void 0 : { ...result, findings: applySetting(result.findings, setting) };
};
var customEditRun = (check2, projectRoot, file) => {
  if (check2.on !== "edit" || check2.level === "off" || checkFiles(check2, [file]).length === 0) return void 0;
  return runCustomCheck(projectRoot, check2, [file], EDIT_TOOL_TIMEOUT_MS);
};
var checkEdit = async (plan, projectRoot, file) => {
  const runs = await Promise.all([
    ...TOOLS.map((tool) => editRun(tool, plan, projectRoot, file)),
    ...plan.config.checks.map((check2) => customEditRun(check2, projectRoot, file))
  ]);
  return runs.filter((toolRun) => toolRun !== void 0);
};

// src/gates/stop.ts
var STOP_HARD_LIMIT_MS = 11e4;
var MAX_CONSECUTIVE_BLOCKS = 3;
var EXIT_FINDINGS = 1;
var EXIT_USAGE2 = 2;
var EXIT_INCOMPLETE = 3;
var MS_PER_S = 1e3;
var NONE = { type: "none" };
var isBlocking = (finding) => finding.severity === "error";
var failureNotes = (runs) => runs.filter((toolRun) => toolRun.failure !== void 0).map((toolRun) => ({ kind: "tool-failure", tool: toolRun.tool, message: toolRun.failure ?? "", durationMs: toolRun.durationMs }));
var timed = async (rule, body) => {
  const startedAt = Date.now();
  const { runs, findings } = await body();
  return { rule, runs, findings, durationMs: Date.now() - startedAt };
};
var createBudget = (startedAt) => {
  let isSpent = false;
  const take = (ownMs) => {
    const ms = Math.max(0, Math.min(ownMs, startedAt + STOP_HARD_LIMIT_MS - Date.now()));
    isSpent ||= ms === 0;
    return ms;
  };
  return { take, isSpent: () => isSpent };
};
var withTimeout = (budget, timeout) => timeout === void 0 ? budget : () => budget(timeout * MS_PER_S);
var toolStep = (tool, input, toolInput) => timed(tool.rule, async () => {
  const setting = toolSetting(input.plan.config, tool);
  const files = toolFiles(tool, toolInput.files);
  if (setting === void 0 || tool.stop === void 0 || files.length === 0) return { runs: [], findings: [] };
  const { runs, findings } = await tool.stop(input.plan.tools, { ...toolInput, files, budget: withTimeout(toolInput.budget, setting.timeout) });
  return { runs, findings: applySetting(findings, setting) };
});
var CUSTOM_CHECK_TIMEOUT_MS = 3e4;
var customStep = (check2, input, toolInput) => timed(checkRule(check2), async () => {
  const files = checkFiles(check2, toolInput.files);
  const timeoutMs = withTimeout(toolInput.budget, check2.timeout)(CUSTOM_CHECK_TIMEOUT_MS);
  if (check2.level === "off" || files.length === 0 || timeoutMs === 0) return { runs: [], findings: [] };
  const toolRun = await runCustomCheck(input.projectRoot, check2, files, timeoutMs);
  return { runs: [toolRun], findings: toolRun.findings };
});
var isStopTool = (tool) => tool.stop !== void 0;
var LOCK_BUSY = "the heavy checks lock is busy";
var incompleteReasons = (runs, isSpent) => [
  ...runs.flatMap((toolRun) => toolRun.failure === void 0 ? [] : [`${toolRun.tool} did not finish (${toolRun.failure})`]),
  ...isSpent ? [`the ${STOP_HARD_LIMIT_MS / MS_PER_S} s budget ran out`] : []
];
var incompleteFinding = (reasons) => ({
  tool: "jig",
  rule: "gate/incomplete",
  severity: "error",
  file: "",
  line: 0,
  message: `jig: the end-of-turn checks did not finish, so their result is unknown: ${reasons.join("; ")}. Run that tool on this turn's files yourself and fix its errors; a slow tool gets more time from "timeout" (seconds) on its entry in .jig/config.jsonc, which the user sets.`
});
var runStopChecks = async (input) => {
  const startedAt = Date.now();
  const budget = createBudget(startedAt);
  const notes = [];
  const steps = [];
  const isStopped = () => steps.some((step) => step.findings.some(isBlocking));
  const acquired = await acquireLock(jigPaths(input.projectRoot).heavyLock);
  if (acquired === void 0) {
    notes.push({ kind: "gate-skipped", tool: "jig", message: LOCK_BUSY });
  } else {
    const lock = { path: acquired.path, isTransferred: false };
    const transfer = (pid) => {
      transferLock(lock.path, pid);
      lock.isTransferred = true;
    };
    const toolInput = { projectRoot: input.projectRoot, files: input.diff.files, budget: budget.take, lock: { path: lock.path, transfer }, notes };
    try {
      const queue2 = [
        ...TOOLS.filter(isStopTool).map((tool) => () => toolStep(tool, input, toolInput)),
        ...input.plan.config.checks.filter((check2) => check2.on === "stop").map((check2) => () => customStep(check2, input, toolInput))
      ];
      for (const step of queue2) {
        if (isStopped()) break;
        steps.push(await step());
      }
    } finally {
      if (!lock.isTransferred) {
        acquired.release();
      }
    }
  }
  const findings = steps.flatMap((step) => step.findings);
  const runs = steps.flatMap((step) => step.runs);
  notes.push(...failureNotes(runs));
  const incomplete = incompleteReasons(runs, budget.isSpent());
  const blocking = [...findings.filter(isBlocking), ...incomplete.length === 0 ? [] : [incompleteFinding(incomplete)]];
  return { steps, findings, blocking, incomplete, isLockBusy: acquired === void 0, notes, durationMs: Date.now() - startedAt };
};
var findingsFingerprint = (findings) => createHash5("sha1").update(collapseFindings(findings).sort().join("\n")).digest("hex");
var blockReason = (blocking, pluginRoot) => {
  const toolLines = formatFindings(blocking.filter((finding) => finding.tool !== "jig"), STOP_LINE_LIMIT, pluginRoot);
  const jigLines = blocking.filter((finding) => finding.tool === "jig").map((finding) => finding.message);
  return [...toolLines, ...jigLines].join("\n");
};
var UNRESOLVED_WHY = "the stop hook fired again with no new edits since the last block";
var blockNotes = (blocking) => blocking.map((finding) => ({
  kind: "gate-block",
  tool: finding.tool,
  rule: finding.rule,
  file: finding.file,
  line: finding.line,
  message: finding.message
}));
var foreignChangeNotes = (files) => files.length === 0 ? [] : [{ kind: "foreign-change", tool: "jig", message: files.join(", ") }];
var editsOutsideOtherWorktrees = (projectRoot, edits) => {
  const projectWorktree = linkedWorktreeRoot(projectRoot);
  const isOwnByDir = /* @__PURE__ */ new Map();
  const isOwn = (path2) => {
    const dir2 = dirname12(join23(projectRoot, path2));
    let isOwnDir = isOwnByDir.get(dir2);
    if (isOwnDir === void 0) {
      const worktree = linkedWorktreeRoot(dir2);
      isOwnDir = worktree === void 0 || projectWorktree !== void 0 && samePath(worktree, projectWorktree);
      isOwnByDir.set(dir2, isOwnDir);
    }
    return isOwnDir;
  };
  return edits.filter((edit) => isOwn(edit.path));
};
var stopGate = async (input) => {
  const { projectRoot, pluginRoot, state } = input;
  const diff = turnDiff(projectRoot, state.snapshot, editsOutsideOtherWorktrees(projectRoot, state.edits), input.attributesShell);
  const foreignNotes = foreignChangeNotes(diff.foreign);
  const isQuiet = diff.files.length === 0 || diff.fingerprint === state.stop.lastGreenFingerprint;
  if (isQuiet) return { outcome: NONE, notes: foreignNotes };
  const isUnresolved = input.stopHookActive && diff.fingerprint === state.stop.lastBlockDiffFingerprint;
  if (isUnresolved) {
    logToActiveJournal(projectRoot, { phase: "gate", decision: "gate unresolved", why: UNRESOLVED_WHY });
    return { outcome: NONE, notes: [...foreignNotes, { kind: "gate-unresolved", tool: "jig", message: UNRESOLVED_WHY }] };
  }
  const plan = loadPlan(projectRoot, pluginRoot);
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan, diff });
  if (checks.blocking.length === 0) {
    state.stop = { lastGreenFingerprint: diff.fingerprint, consecutiveBlocks: 0 };
    resetSnapshot(state, takeSnapshot(projectRoot));
    return { outcome: NONE, notes: [...foreignNotes, ...checks.notes, { kind: "gate-pass", tool: "jig", durationMs: checks.durationMs }] };
  }
  const fingerprint = findingsFingerprint(checks.blocking);
  const isRepeat = fingerprint === state.stop.lastBlockFingerprint;
  const consecutiveBlocks = isRepeat ? state.stop.consecutiveBlocks + 1 : 1;
  if (consecutiveBlocks > MAX_CONSECUTIVE_BLOCKS) {
    state.stop = { consecutiveBlocks: 0 };
    const [first] = checks.blocking;
    const giveUp = { kind: "gate-giveup", tool: "jig", durationMs: checks.durationMs, ...first && { rule: first.rule, file: first.file } };
    return { outcome: NONE, notes: [...foreignNotes, ...checks.notes, giveUp] };
  }
  state.stop = { ...state.stop, lastBlockFingerprint: fingerprint, consecutiveBlocks, lastBlockDiffFingerprint: diff.fingerprint };
  return {
    outcome: { type: "block", reason: blockReason(checks.blocking, pluginRoot) },
    notes: [...foreignNotes, ...checks.notes, ...blockNotes(checks.blocking)]
  };
};
var printFailures = (runs) => {
  for (const toolRun of runs) {
    if (toolRun.failure !== void 0) {
      process.stderr.write(`jig: ${toolRun.tool} failed (${toolRun.failure})
`);
    }
  }
};
var stopSummary = (checks, pluginRoot) => {
  const incomplete = [...checks.incomplete, ...checks.isLockBusy ? [LOCK_BUSY] : []];
  const lines2 = [
    ...formatFindings(checks.findings, STOP_LINE_LIMIT, pluginRoot),
    ...incomplete.length === 0 ? [] : [`incomplete: ${incomplete.join("; ")}`]
  ];
  if (checks.findings.some(isBlocking)) return { text: lines2.join("\n"), code: EXIT_FINDINGS };
  if (incomplete.length > 0) return { text: lines2.join("\n"), code: EXIT_INCOMPLETE };
  return { text: lines2.length === 0 ? "clean" : lines2.join("\n"), code: 0 };
};
var checkStopCommand = async (projectRoot, pluginRoot) => {
  const diff = turnDiff(projectRoot, {}, []);
  if (diff.files.length === 0) {
    process.stdout.write("clean\n");
    return 0;
  }
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan: loadPlan(projectRoot, pluginRoot), diff });
  const summary = stopSummary(checks, pluginRoot);
  process.stdout.write(`${summary.text}
`);
  return summary.code;
};
var checkEditCommand = async (projectRoot, pluginRoot, file) => {
  if (file === void 0 || file === "") {
    process.stderr.write("jig: check edit needs a file\n");
    return EXIT_USAGE2;
  }
  const path2 = toProjectPath(projectRoot, file, process.cwd());
  const runs = await checkEdit(loadPlan(projectRoot, pluginRoot), projectRoot, path2);
  printFailures(runs);
  const findings = runs.flatMap((toolRun) => toolRun.findings);
  if (findings.length === 0) return 0;
  process.stdout.write(`${formatFindings(findings, POST_EDIT_LINE_LIMIT, pluginRoot).join("\n")}
`);
  return EXIT_FINDINGS;
};
var runCheck = (args) => {
  const [sub, file] = args;
  const projectRoot = resolveProjectRoot(process.cwd());
  const pluginRoot = resolvePluginRoot();
  if (sub === "stop") {
    ensureJigDir(projectRoot);
    return checkStopCommand(projectRoot, pluginRoot);
  }
  if (sub === "edit") {
    ensureJigDir(projectRoot);
    return checkEditCommand(projectRoot, pluginRoot, file);
  }
  process.stderr.write(`jig: unknown check ${sub ?? "(none)"}, expected edit or stop
`);
  return EXIT_USAGE2;
};

// src/hook/dispatch.ts
import { appendFileSync as appendFileSync4, existsSync as existsSync11 } from "node:fs";
import { basename as basename6, join as join28, resolve as resolve14 } from "node:path";

// src/adapters/claude.ts
import { readFileSync as readFileSync23 } from "node:fs";
import { isAbsolute as isAbsolute6, resolve as resolve12 } from "node:path";

// src/context/touched.ts
import { existsSync as existsSync9 } from "node:fs";
import { basename as basename5, isAbsolute as isAbsolute4, resolve as resolve10 } from "node:path";
var MAX_TOKENS = 200;
var MAX_PATHS = 20;
var SEGMENTS = /[;|&\n]+/;
var TOKENS = /[\s<>()]+/;
var PATHLIKE = /[\\/]|\.[A-Za-z0-9]{1,8}$/;
var GIT_BASH_DRIVE = /^\/([A-Za-z])\/(.*)$/;
var PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;
var MOVE_TO = /^\*\*\* Move to: (.+)$/gm;
var INTERPRETER = /^(node|npx|tsx|ts-node|deno|bun|python[0-9.]*|py|ruby|perl|bash|sh|zsh|pwsh|powershell|cmd)(\.exe)?$/i;
var unquote = (token) => token.replace(/^['"]+|['"]+$/g, "");
var fromFlag = (token) => {
  const at = token.indexOf("=");
  return token.startsWith("-") && at !== -1 ? token.slice(at + 1) : token;
};
var nativePath = (token) => {
  if (process.platform !== "win32") return token;
  const drive = GIT_BASH_DRIVE.exec(token);
  return drive === null ? token : `${drive[1]?.toUpperCase()}:/${drive[2]}`;
};
var argumentsOf = (segment) => {
  const tokens = segment.split(TOKENS).map(unquote).filter(Boolean);
  const program = tokens[0];
  if (program === void 0) return [];
  const rest = tokens.slice(1);
  if (!INTERPRETER.test(basename5(program))) return rest;
  const script = rest.findIndex((token) => !token.startsWith("-"));
  return script === -1 ? rest : rest.filter((_, index) => index !== script);
};
var pathsInCommand = (command, cwd) => {
  const found = /* @__PURE__ */ new Set();
  const tokens = command.split(SEGMENTS).flatMap(argumentsOf).slice(0, MAX_TOKENS);
  for (const raw of tokens) {
    const token = nativePath(fromFlag(raw));
    if (token === "" || token.startsWith("-") || token.includes("://") || !PATHLIKE.test(token)) continue;
    const absolute = isAbsolute4(token) ? token : resolve10(cwd, token);
    if (existsSync9(absolute)) found.add(absolute);
    if (found.size >= MAX_PATHS) break;
  }
  return [...found];
};
var pathsInPatch = (patch, cwd) => {
  const paths = [...patch.matchAll(PATCH_FILE), ...patch.matchAll(MOVE_TO)].map((match) => (match[1] ?? "").trim());
  return [...new Set(paths.filter(Boolean).map((path2) => isAbsolute4(path2) ? path2 : resolve10(cwd, path2)))];
};

// src/context/native.ts
import { dirname as dirname13, isAbsolute as isAbsolute5, join as join24, relative as relative6, resolve as resolve11 } from "node:path";
var CLAUDE_NAMES = ["CLAUDE.md", "CLAUDE.local.md"];
var CODEX_NAMES = ["AGENTS.override.md", "AGENTS.md"];
var OPENCODE_NAMES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"];
var within = (root, path2) => {
  const rel = relative6(root, path2);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute5(rel);
};
var dirsBetween = (top, dir2) => {
  const dirs = [];
  for (let current = resolve11(dir2); within(top, current); current = dirname13(current)) dirs.unshift(current);
  return dirs;
};
var hasAny = (dir2, names) => names.some((name) => hasFile(dir2, name));
var claudeStart = (launchDir) => {
  const claude2 = chainFor(launchDir, CLAUDE_NAMES);
  if (claude2 === void 0) return [];
  if (claude2.rules.length > 0) return claude2.rules;
  return chainFor(launchDir, ["AGENTS.md"])?.rules ?? [];
};
var claudeOnRead = (file, launchDir) => expandImports(
  dirsBetween(launchDir, dirname13(resolve11(file))).flatMap((dir2) => {
    if (hasAny(dir2, CLAUDE_NAMES)) return CLAUDE_NAMES.filter((name) => hasFile(dir2, name)).map((name) => join24(dir2, name));
    return hasFile(dir2, "AGENTS.md") ? [join24(dir2, "AGENTS.md")] : [];
  })
);
var firstPerDir = (launchDir, names) => {
  const root = repoRootOf(launchDir);
  if (root === void 0) return [];
  return [root, ...dirsBetween(root, launchDir)].flatMap((dir2) => {
    const name = names.find((candidate) => hasFile(dir2, candidate));
    return name === void 0 ? [] : [join24(dir2, name)];
  });
};
var opencodeStart = (launchDir) => {
  const root = repoRootOf(launchDir) ?? resolve11(launchDir);
  const dirs = [root, ...dirsBetween(root, launchDir)];
  for (const name of OPENCODE_NAMES) {
    const files = dirs.filter((dir2) => hasFile(dir2, name)).map((dir2) => join24(dir2, name));
    if (files.length > 0) return files;
  }
  return [];
};
var opencodeOnRead = (file, launchDir) => dirsBetween(launchDir, dirname13(resolve11(file))).flatMap((dir2) => {
  const name = OPENCODE_NAMES.find((candidate) => hasFile(dir2, candidate));
  return name === void 0 ? [] : [join24(dir2, name)];
});
var NO_READ_LOADS = () => [];
var NATIVE_RULES = {
  claude: { atStart: claudeStart, onRead: claudeOnRead },
  codex: { atStart: (launchDir) => firstPerDir(launchDir, CODEX_NAMES), onRead: NO_READ_LOADS },
  opencode: { atStart: opencodeStart, onRead: opencodeOnRead },
  grok: { atStart: (launchDir) => chainFor(launchDir)?.rules ?? [], onRead: NO_READ_LOADS }
};

// src/adapters/session-root.ts
import { mkdirSync as mkdirSync11, readdirSync as readdirSync11, readFileSync as readFileSync22, rmSync as rmSync6, statSync as statSync10, writeFileSync as writeFileSync7 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join25 } from "node:path";
var dir = () => join25(tmpdir(), "jig-session-roots");
var fileOf = (sessionId) => join25(dir(), sessionId.replace(/[^A-Za-z0-9._-]/g, "_"));
var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var prune = (now) => {
  for (const name of readdirSync11(dir())) {
    const path2 = join25(dir(), name);
    if (now - statSync10(path2).mtimeMs > MAX_AGE_MS) rmSync6(path2, { force: true });
  }
};
var rememberSessionRoot = (sessionId, root) => {
  try {
    mkdirSync11(dir(), { recursive: true });
    prune(Date.now());
    writeFileSync7(fileOf(sessionId), root);
  } catch {
    return;
  }
};
var sessionRoot = (sessionId) => {
  try {
    const root = readFileSync22(fileOf(sessionId), "utf8").trim();
    return root === "" ? void 0 : root;
  } catch {
    return void 0;
  }
};

// src/adapters/claude.ts
var SHELL_CALL = "shell";
var PATCH_START = "*** Begin Patch";
var PATCH_FILE2 = /^\*\*\* (Update|Add|Delete) File: (.+)$/;
var SESSION_SOURCES = ["startup", "resume", "clear", "compact", "fork"];
var HOOK_EVENT_NAMES = {
  "session-start": "SessionStart",
  compact: "PostCompact",
  prompt: "UserPromptSubmit",
  "pre-edit": "PreToolUse",
  "pre-patch": "PreToolUse",
  "post-edit": "PostToolUse",
  "post-patch": "PostToolUse",
  touch: "PostToolUse",
  "instructions-loaded": "InstructionsLoaded",
  "pre-shell": "PreToolUse",
  "post-shell": "PostToolUse",
  "subagent-start": "SubagentStart",
  stop: "Stop"
};
var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text = (object, key) => {
  const value = object[key];
  return typeof value === "string" ? value : void 0;
};
var readCurrent = (absolutePath) => {
  try {
    return readFileSync23(absolutePath, "utf8");
  } catch {
    return "";
  }
};
var multiEditPairs = (input) => {
  const edits = input["edits"];
  if (!Array.isArray(edits)) return void 0;
  const pairs = [];
  for (const edit of edits) {
    if (!isObject2(edit)) return void 0;
    const before = text(edit, "old_string");
    const after = text(edit, "new_string");
    if (before === void 0 || after === void 0) return void 0;
    pairs.push({ before, after });
  }
  return pairs;
};
var absoluteOf = (raw, paths) => isAbsolute6(raw) ? raw : resolve12(paths.cwd, raw);
var rawFileOf = (toolName, input) => toolName === "NotebookEdit" ? text(input, "notebook_path") : text(input, "file_path") ?? text(input, "path") ?? text(input, "notebook_path");
var commandOf = (input) => {
  const command = input["command"];
  if (typeof command === "string") return command;
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) return command.join(" ");
  return void 0;
};
var patchOf = (input) => [commandOf(input), text(input, "input"), text(input, "patch")].find((value) => value?.includes(PATCH_START) === true);
var patchEdits = (patch, paths) => {
  const files = [];
  let current;
  const flush = () => {
    if (current !== void 0) files.push({ file: current.file, edits: [{ before: current.before.join("\n"), after: current.after.join("\n") }] });
  };
  for (const line of patch.split(/\r?\n/)) {
    const header = PATCH_FILE2.exec(line);
    if (header !== null) {
      flush();
      current = { file: toProjectPath(paths.projectRoot, absoluteOf((header[2] ?? "").trim(), paths)), before: [], after: [] };
    } else if (current !== void 0 && line.startsWith("+") && !line.startsWith("+++")) {
      current.after.push(line.slice(1));
    } else if (current !== void 0 && line.startsWith("-") && !line.startsWith("---")) {
      current.before.push(line.slice(1));
    }
  }
  flush();
  return files;
};
var preEditEvent = (toolName, input, paths) => {
  const patch = patchOf(input);
  if (patch !== void 0) return { kind: "pre-patch", files: patchEdits(patch, paths) };
  const rawFile = rawFileOf(toolName, input);
  if (rawFile === void 0) return void 0;
  const absolute = absoluteOf(rawFile, paths);
  const file = toProjectPath(paths.projectRoot, absolute);
  if (toolName === "MultiEdit") {
    const edits = multiEditPairs(input);
    return edits === void 0 ? void 0 : { kind: "pre-edit", file, edits };
  }
  if (toolName === "NotebookEdit") {
    return { kind: "pre-edit", file, edits: [{ before: "", after: text(input, "new_source") ?? "" }] };
  }
  const content = text(input, "content");
  if (content !== void 0) {
    return { kind: "pre-edit", file, edits: [{ before: readCurrent(absolute), after: content }] };
  }
  const before = text(input, "old_string");
  const after = text(input, "new_string");
  if (before === void 0 || after === void 0) return void 0;
  return { kind: "pre-edit", file, edits: [{ before, after }] };
};
var postEditEvent = (toolName, input, paths) => {
  const patch = patchOf(input);
  if (patch !== void 0) return { kind: "post-patch", files: pathsInPatch(patch, paths.cwd).map((path2) => toProjectPath(paths.projectRoot, path2)) };
  const rawFile = rawFileOf(toolName, input);
  return rawFile === void 0 ? void 0 : { kind: "post-edit", file: toProjectPath(paths.projectRoot, rawFile, paths.cwd) };
};
var touchEvent = (toolName, input, paths) => {
  const raw = rawFileOf(toolName, input);
  if (raw === void 0) return void 0;
  return { kind: "touch", paths: [absoluteOf(raw, paths)], read: toolName === "Read" };
};
var sessionStartEvent = (input) => {
  const source = SESSION_SOURCES.find((candidate) => candidate === input["source"]) ?? "startup";
  return { kind: "session-start", source };
};
var toEvent = (name, input, paths) => {
  const toolName = text(input, "tool_name");
  const toolInput = isObject2(input["tool_input"]) ? input["tool_input"] : {};
  switch (name) {
    case "session-start":
      return sessionStartEvent(input);
    case "compact":
      return { kind: "compact" };
    case "user-prompt-submit":
      return { kind: "prompt" };
    case "pre-edit":
      return preEditEvent(toolName, toolInput, paths);
    case "post-edit":
      return postEditEvent(toolName, toolInput, paths);
    case "touch":
      return touchEvent(toolName, toolInput, paths);
    case "instructions-loaded": {
      const file = text(input, "file_path");
      return file === void 0 ? void 0 : { kind: "instructions-loaded", file: absoluteOf(file, paths) };
    }
    case "pre-shell":
      return { kind: "pre-shell", callId: text(input, "tool_use_id") ?? SHELL_CALL };
    case "post-shell": {
      const touched = pathsInCommand(commandOf(toolInput) ?? "", paths.cwd);
      const event = { kind: "post-shell", callId: text(input, "tool_use_id") ?? SHELL_CALL, isBackground: toolInput["run_in_background"] === true };
      return touched.length === 0 ? event : { ...event, paths: touched };
    }
    case "subagent-start": {
      const agentId = text(input, "agent_id");
      if (agentId === void 0) return void 0;
      const prompt2 = text(input, "prompt");
      const event = { kind: "subagent-start", agentId, agentType: text(input, "agent_type") ?? "" };
      return prompt2 === void 0 ? event : { ...event, prompt: prompt2 };
    }
    case "stop":
      return { kind: "stop", stopHookActive: input["stop_hook_active"] === true };
    default:
      return void 0;
  }
};
var parseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
};
var parserFor = (projectDirEnvs) => (name, raw, env = process.env) => {
  const input = parseJson(raw);
  if (!isObject2(input)) return void 0;
  const sessionId = text(input, "session_id") ?? text(input, "sessionId");
  if (sessionId === void 0) return void 0;
  const cwd = resolve12(text(input, "cwd") ?? process.cwd());
  const fromEnv = projectDirEnvs.some((name2) => env[name2] !== void 0 && env[name2] !== "");
  const remembered = fromEnv || name === "session-start" ? void 0 : sessionRoot(sessionId);
  const projectRoot = remembered ?? resolveProjectRoot(cwd, env, projectDirEnvs);
  if (!fromEnv && name === "session-start") rememberSessionRoot(sessionId, projectRoot);
  const event = toEvent(name, input, { projectRoot, cwd });
  if (event === void 0) return void 0;
  const agentId = text(input, "agent_id");
  const base = agentId === void 0 ? { sessionId, projectRoot, cwd } : { sessionId, agentId, projectRoot, cwd };
  return { event, base };
};
var parseHookInput = parserFor([JIG_PROJECT_DIR, AGENT_PROJECT_DIRS.claude]);
var formatOutcome = (kind, outcome) => {
  const hookEventName = HOOK_EVENT_NAMES[kind];
  switch (outcome.type) {
    case "none":
      return "";
    case "deny":
      return JSON.stringify({
        hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason: outcome.reason }
      });
    case "context":
      return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: outcome.text } });
    case "block":
      return JSON.stringify({ decision: "block", reason: outcome.reason });
  }
};
var compatible = (name, native, projectDirEnvs) => ({
  name,
  attributesShell: true,
  native,
  parseHookInput: parserFor(projectDirEnvs),
  formatOutcome
});
var claude = compatible("claude", NATIVE_RULES.claude, [JIG_PROJECT_DIR, AGENT_PROJECT_DIRS.claude]);
var codex = compatible("codex", NATIVE_RULES.codex, [JIG_PROJECT_DIR]);
var opencode = compatible("opencode", NATIVE_RULES.opencode, [JIG_PROJECT_DIR]);
var grok = compatible("grok", NATIVE_RULES.grok, [JIG_PROJECT_DIR, AGENT_PROJECT_DIRS.claude]);

// src/adapters/index.ts
var ADAPTERS = { claude, codex, grok, opencode };
var DEFAULT_AGENT = "claude";
var DETECT = [
  { agent: "grok", vars: ["GROK_HOOK_EVENT", "GROK_SESSION_ID"] },
  { agent: "claude", vars: ["CLAUDE_PROJECT_DIR"] },
  { agent: "codex", vars: ["CODEX_THREAD_ID"] },
  { agent: "opencode", vars: ["OPENCODE"] }
];
var detectAgent2 = (env = process.env) => DETECT.find(({ vars }) => vars.some((name) => env[name] !== void 0 && env[name] !== ""))?.agent ?? DEFAULT_AGENT;
var resolveAdapter = (name = detectAgent2()) => {
  const adapter = Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : void 0;
  if (adapter === void 0) throw new Error(`unknown agent ${name}, expected one of: ${Object.keys(ADAPTERS).join(", ")}`);
  return adapter;
};

// src/context/deliver.ts
import { readFileSync as readFileSync24 } from "node:fs";
var CONTEXT_BUDGET = 9e3;
var GLOSSARY_KEY = "glossary:";
var HEADER2 = "jig: project instructions for the paths you just touched that your harness has not loaded. They bind the code there like CLAUDE.md and AGENTS.md:";
var toldSet = (state, agent) => new Set(state.toldRules?.[agent] ?? []);
var markTold = (state, agent, paths) => {
  if (paths.length === 0 && state.toldRules?.[agent] !== void 0) return;
  const told = toldSet(state, agent);
  for (const path2 of paths) told.add(path2.startsWith(GLOSSARY_KEY) ? path2 : pathKey2(path2));
  state.toldRules = { ...state.toldRules, [agent]: [...told] };
};
var resetTold = (state, agent) => {
  if (state.toldRules?.[agent] === void 0) return;
  const { [agent]: _dropped, ...rest } = state.toldRules;
  state.toldRules = rest;
};
var untoldFor = (state, agent, targets) => {
  const told = toldSet(state, agent);
  const rules = [];
  const glossaries = [];
  for (const target of targets) {
    const chain = chainFor(target);
    if (chain === void 0) continue;
    for (const rule of chain.rules) {
      const key = pathKey2(rule);
      if (told.has(key)) continue;
      told.add(key);
      rules.push(rule);
    }
    if (chain.glossary !== void 0 && !told.has(GLOSSARY_KEY + pathKey2(chain.glossary.path))) {
      told.add(GLOSSARY_KEY + pathKey2(chain.glossary.path));
      glossaries.push(chain.glossary);
    }
  }
  return { rules, glossaries };
};
var sizeOf = (path2) => {
  try {
    return readFileSync24(path2, "utf8").length;
  } catch {
    return 0;
  }
};
var withinBudget = (rules) => {
  const inline = [];
  const byPath = [];
  let used = HEADER2.length;
  for (const rule of rules) {
    const size = sizeOf(rule) + rule.length + 10;
    if (byPath.length === 0 && used + size <= CONTEXT_BUDGET) {
      inline.push(rule);
      used += size;
    } else {
      byPath.push(rule);
    }
  }
  return { inline, byPath };
};
var render = (inline, byPath, glossaries) => [
  HEADER2,
  ...inline.length === 0 ? [] : [renderRules(inline)],
  ...byPath.length === 0 ? [] : [`Too long to include here, so read each of these with your file-reading tool before you edit there: ${byPath.map(toSlash).join(", ")}`],
  ...glossaries.map(renderGlossary)
].join("\n\n");
var deliver = (state, agent, targets, options = {}) => {
  const { rules, glossaries } = untoldFor(state, agent, targets);
  if (rules.length === 0 && (glossaries.length === 0 || options.requireRules === true)) return void 0;
  const { inline, byPath } = withinBudget(rules);
  markTold(state, agent, [...inline, ...glossaries.map((glossary) => GLOSSARY_KEY + pathKey2(glossary.path))]);
  return { text: render(inline, byPath, glossaries), hasRules: rules.length > 0 };
};

// src/worktree/deps-pool.ts
import { spawnSync as spawnSync4 } from "node:child_process";
import { createHash as createHash6, randomBytes } from "node:crypto";
import {
  copyFileSync as copyFileSync2,
  existsSync as existsSync10,
  linkSync,
  lstatSync as lstatSync4,
  mkdirSync as mkdirSync13,
  readdirSync as readdirSync14,
  readFileSync as readFileSync25,
  readlinkSync as readlinkSync2,
  realpathSync as realpathSync4,
  renameSync as renameSync2,
  rmSync as rmSync7,
  statSync as statSync12,
  utimesSync,
  writeFileSync as writeFileSync8
} from "node:fs";
import { dirname as dirname14, join as join27, posix as posix4, resolve as resolve13 } from "node:path";

// src/worktree/remove.ts
import { readdirSync as readdirSync12, rmdirSync, unlinkSync } from "node:fs";
import { join as join26 } from "node:path";
var entriesOf2 = (dir2) => {
  try {
    return readdirSync12(dir2, { withFileTypes: true });
  } catch {
    return [];
  }
};
var unlinkOne = (path2) => {
  try {
    unlinkSync(path2);
  } catch (error) {
    const isDirectoryLink = error instanceof Error && "code" in error && (error.code === "EPERM" || error.code === "EISDIR");
    if (!isDirectoryLink) throw error;
    rmdirSync(path2);
  }
};
var unlinkLinks = (dir2) => {
  const removed = [];
  for (const entry of entriesOf2(dir2)) {
    const path2 = join26(dir2, entry.name);
    if (entry.isSymbolicLink()) {
      unlinkOne(path2);
      removed.push(path2);
    } else if (entry.isDirectory() && entry.name !== ".git") {
      removed.push(...unlinkLinks(path2));
    }
  }
  return removed;
};
var removeLinkedWorktree = (path2, mainRoot) => {
  let unlinked;
  try {
    unlinked = unlinkLinks(path2).length;
  } catch (error) {
    return { unlinked: 0, error: `could not unlink the links in ${path2}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const result = git(["worktree", "remove", "--force", path2], mainRoot);
  return { unlinked, error: result.ok ? void 0 : result.stderr.trim() };
};

// src/worktree/seed.ts
import { copyFileSync, lstatSync as lstatSync3, mkdirSync as mkdirSync12, readdirSync as readdirSync13, readlinkSync, realpathSync as realpathSync3, statSync as statSync11, symlinkSync } from "node:fs";
import nodePath from "node:path";
var exists2 = (path2) => {
  try {
    lstatSync3(path2);
    return true;
  } catch {
    return false;
  }
};
var canonicalOrRaw = (path2) => {
  try {
    return realpathSync3.native(path2);
  } catch {
    return path2;
  }
};
var relativeInside = (api, root, path2) => {
  const rel = api.relative(root, path2);
  if (rel === ".." || rel.startsWith(`..${api.sep}`) || api.isAbsolute(rel)) return void 0;
  return rel;
};
var linkTarget = (raw, linkDir, main, worktree, api = nodePath, canonical2 = canonicalOrRaw) => {
  const absolute = canonical2(api.isAbsolute(raw) ? api.normalize(raw) : api.resolve(linkDir, raw));
  const inside = relativeInside(api, canonical2(main), absolute);
  return inside === void 0 ? absolute : api.join(worktree, inside);
};
var ignoredEntries = (main) => {
  const result = git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], main);
  if (!result.ok) throw new Error(`git ls-files in ${main} failed: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean);
};
var excluder = (globs) => {
  const matches = createMatcher(globs);
  return (path2) => {
    const parts = path2.replace(/\\/g, "/").replace(/\/$/, "").split("/");
    return parts.some((_part, index) => matches(parts.slice(0, index + 1).join("/")));
  };
};
var typeOf = (path2) => {
  try {
    return statSync11(path2).isDirectory() ? "dir" : "file";
  } catch {
    return void 0;
  }
};
var isPermissionError = (error) => error instanceof Error && "code" in error && error.code === "EPERM";
var createLink = (source, target, destination) => {
  const type = typeOf(target) ?? typeOf(source) ?? "file";
  try {
    symlinkSync(target, destination, type);
  } catch (error) {
    const canUseJunction = process.platform === "win32" && type === "dir" && isPermissionError(error);
    if (!canUseJunction) throw error;
    symlinkSync(target, destination, "junction");
  }
};
var place = (main, worktree, rel) => {
  const source = nodePath.join(main, rel);
  const destination = nodePath.join(worktree, rel);
  const path2 = rel.replace(/\\/g, "/");
  if (exists2(destination)) return { action: "kept", path: path2 };
  try {
    const stats = lstatSync3(source);
    if (!stats.isSymbolicLink() && !stats.isFile()) return { action: "skipped", path: path2, detail: "not a file" };
    mkdirSync12(nodePath.dirname(destination), { recursive: true });
    if (stats.isFile()) {
      copyFileSync(source, destination);
      return { action: "copied", path: path2 };
    }
    const target = linkTarget(readlinkSync(source), nodePath.dirname(source), main, worktree);
    createLink(source, target, destination);
    return { action: "linked", path: path2, detail: target.replace(/\\/g, "/") };
  } catch (error) {
    return { action: "failed", path: path2, detail: error instanceof Error ? error.message : String(error) };
  }
};
var linksInside = (main, dir2) => {
  try {
    return readdirSync13(nodePath.join(main, dir2), { withFileTypes: true }).filter((entry) => entry.isSymbolicLink()).map((entry) => `${dir2}${entry.name}`);
  } catch {
    return [];
  }
};
var copyFileItem = (main, worktree, file, ignoredDirs, files) => {
  const path2 = nodePath.posix.normalize(file.replace(/\\/g, "/"));
  if (nodePath.isAbsolute(file) || path2 === ".." || path2.startsWith("../")) {
    return { action: "failed", path: path2, detail: "copyFiles path leaves the repository" };
  }
  if (files.has(path2)) return { action: "skipped", path: path2, detail: "seeded anyway, drop it from copyFiles" };
  if (!ignoredDirs.some((dir2) => path2.startsWith(dir2))) {
    return { action: "skipped", path: path2, detail: "copyFiles takes only files inside an ignored folder" };
  }
  return place(main, worktree, path2);
};
var JIG_CONFIG_FILES = [".jig/config.jsonc", ".jig/config.local.jsonc", ".jig/review.jsonc"];
var seedWorktree = (main, worktree, options = {}) => {
  const isExcluded = excluder(options.seedExclude ?? []);
  const entries = ignoredEntries(main);
  const ignoredDirs = entries.filter((entry) => entry.endsWith("/"));
  const files = entries.filter((entry) => !entry.endsWith("/"));
  const candidates = [...files, ...ignoredDirs.filter((dir2) => !isExcluded(dir2)).flatMap((dir2) => linksInside(main, dir2))];
  const items = candidates.map((rel) => isExcluded(rel) ? { action: "excluded", path: rel } : place(main, worktree, rel));
  const fileSet = new Set(files);
  for (const file of options.copyFiles ?? []) {
    items.push(copyFileItem(main, worktree, file, ignoredDirs, fileSet));
  }
  const listed = new Set(items.map((item) => item.path));
  const jigConfig = JIG_CONFIG_FILES.filter(
    (file) => !listed.has(file) && !isExcluded(file) && ignoredDirs.some((dir2) => file.startsWith(dir2)) && exists2(nodePath.join(main, file))
  );
  items.push(...jigConfig.map((file) => place(main, worktree, file)));
  return items;
};
var formatSeed = (items) => {
  const lines2 = items.filter((item) => item.action !== "kept" && item.action !== "excluded").map((item) => `${item.action} ${item.path}${item.detail === void 0 ? "" : ` (${item.detail})`}`);
  const count = (action) => items.filter((item) => item.action === action).length;
  lines2.push(
    `seed: ${count("copied")} copied, ${count("linked")} linked, ${count("kept")} kept, ${count("excluded")} excluded, ${count("failed")} failed`
  );
  return lines2;
};

// src/worktree/deps-pool.ts
var POOL_DIR = "deps";
var MANIFEST = "jig-deps.json";
var KEY_HEX_CHARS = 16;
var VERSION_HEX_CHARS = 8;
var STAGING = /^[0-9a-f-]+\.(\d+)-[0-9a-f]+\.tmp$/;
var messageOf = (error) => error instanceof Error ? error.message : String(error);
var codeOf = (error) => error instanceof Error && "code" in error ? error.code : void 0;
var poolOf = (main) => {
  const common = git(["rev-parse", "--git-common-dir"], main);
  if (!common.ok) throw new Error(`git rev-parse --git-common-dir in ${main} failed: ${common.stderr.trim()}`);
  return join27(resolve13(main, common.stdout.trim()), "jig", POOL_DIR);
};
var runCommand = (command, dir2) => spawnSync4(command, { cwd: dir2, shell: true, windowsHide: true, stdio: ["ignore", 2, 2] }).status;
var isPooled = (lockfile) => lockfile.deps !== void 0 && lockfile.resolve !== void 0;
var findLockfile = (checkout) => {
  const present = LOCKFILES.filter((lockfile) => existsSync10(join27(checkout, lockfile.file)));
  const pooled = present.find(isPooled);
  if (pooled !== void 0) return pooled;
  const [first] = present;
  return first === void 0 ? "no lock file at the worktree root" : `${first.file} has no dependency folder that jig pools`;
};
var digest = (parts) => {
  const hash = createHash6("sha256");
  for (const part of parts) {
    hash.update(part).update("\0");
  }
  return hash.digest("hex");
};
var runtimeParts = (install) => [install, process.platform, process.arch, `node${process.versions.node.split(".")[0] ?? ""}`];
var lockKeyOf = (checkout, lockfile, install) => {
  const manifest = lockfile.manifest === void 0 ? void 0 : join27(checkout, lockfile.manifest);
  const manifestBytes = manifest !== void 0 && existsSync10(manifest) ? readFileSync25(manifest) : "";
  return digest([lockfile.file, readFileSync25(join27(checkout, lockfile.file)), manifestBytes, ...runtimeParts(install)]).slice(0, KEY_HEX_CHARS);
};
var trackedManifests = (checkout, manifest) => {
  const listed = git(["ls-files", "-z", "--", `*${manifest}`], checkout);
  if (!listed.ok) throw new Error(`git ls-files in ${checkout} failed: ${listed.stderr.trim()}`);
  return listed.stdout.split("\0").filter((path2) => posix4.basename(path2) === manifest).sort();
};
var manifestsKeyOf = (checkout, lockfile, install, paths) => {
  const manifests = paths.flatMap((path2) => {
    const absolute = join27(checkout, path2);
    return [path2, existsSync10(absolute) ? readFileSync25(absolute) : ""];
  });
  return digest(["manifests", lockfile.file, ...manifests, ...runtimeParts(install)]).slice(0, KEY_HEX_CHARS);
};
var isIgnored = (checkout, file) => git(["check-ignore", "-q", file], checkout).ok;
var keyedOf = (checkout, lockfile, configured) => {
  const storesLock = isIgnored(checkout, lockfile.file);
  const install = configured ?? (storesLock ? lockfile.resolve : lockfile.install);
  if (!storesLock) return { lockfile, install, key: lockKeyOf(checkout, lockfile, install), storesLock, manifests: [] };
  const manifests = lockfile.manifest === void 0 ? [] : trackedManifests(checkout, lockfile.manifest);
  return { lockfile, install, key: manifestsKeyOf(checkout, lockfile, install, manifests), storesLock, manifests };
};
var versionOf = (bytes) => digest([bytes]).slice(0, VERSION_HEX_CHARS);
var lockOf = (keyed, checkout) => keyed.storesLock ? { file: keyed.lockfile.file, bytes: readFileSync25(join27(checkout, keyed.lockfile.file)) } : void 0;
var entryOf = (keyed, lock) => {
  if (lock === void 0) return { name: keyed.key, version: void 0 };
  const version2 = versionOf(lock.bytes);
  return { name: `${keyed.key}-${version2}`, version: version2 };
};
var mtimeOf = (path2) => lstatSync4(path2, { throwIfNoEntry: false })?.mtimeMs;
var freshnessOf = (checkout, keyed) => {
  const { lockfile } = keyed;
  if (lockfile.stamp === void 0) return "unknown";
  const manifests = keyed.manifests.map((path2) => mtimeOf(join27(checkout, path2)) ?? -Infinity);
  const locked = Math.max(mtimeOf(join27(checkout, lockfile.file)) ?? Infinity, ...manifests);
  return lockfile.stamp.some((stamp) => (mtimeOf(join27(checkout, stamp)) ?? -Infinity) >= locked) ? "fresh" : "stale";
};
var hasDepsDir = (checkout, deps) => lstatSync4(join27(checkout, deps), { throwIfNoEntry: false })?.isDirectory() === true;
var isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
var isTransfer = (value) => value === "hardlink" || value === "copy";
var parseManifest = (text3) => {
  let value;
  try {
    value = JSON.parse(text3);
  } catch {
    return void 0;
  }
  if (typeof value !== "object" || value === null || !("lockfile" in value) || !("deps" in value) || !("footprint" in value)) return void 0;
  const { lockfile, deps, footprint } = value;
  if (typeof lockfile !== "string" || !isStringArray(deps) || !isStringArray(footprint)) return void 0;
  const transfer = "transfer" in value && isTransfer(value.transfer) ? value.transfer : void 0;
  const lock = "lock" in value && typeof value.lock === "string" ? value.lock : void 0;
  const published = "published" in value && typeof value.published === "number" ? value.published : void 0;
  return { lockfile, deps, footprint, transfer, lock, published };
};
var readManifest = (entry) => {
  const path2 = join27(entry, MANIFEST);
  return existsSync10(path2) ? parseManifest(readFileSync25(path2, "utf8")) : void 0;
};
var versionsOf = (pool, key) => {
  if (!existsSync10(pool)) return [];
  const versionName = new RegExp(`^${key}-([0-9a-f]{${VERSION_HEX_CHARS}})$`);
  return readdirSync14(pool).flatMap((name) => {
    const version2 = versionName.exec(name)?.[1];
    const manifest = version2 === void 0 ? void 0 : readManifest(join27(pool, name));
    return version2 === void 0 || manifest === void 0 ? [] : [{ name, version: version2, published: manifest.published ?? 0 }];
  }).sort((left, right) => right.published - left.published);
};
var removeTree = (path2) => {
  let isLink;
  try {
    isLink = lstatSync4(path2).isSymbolicLink();
  } catch {
    return;
  }
  if (isLink) {
    unlinkOne(path2);
    return;
  }
  unlinkLinks(path2);
  rmSync7(path2, { recursive: true, force: true });
};
var placeFile = (source, destination, copier) => {
  copier.files++;
  if (copier.transfer === "hardlink") {
    try {
      linkSync(source, destination);
      return;
    } catch (error) {
      const code = codeOf(error);
      if (code !== "EXDEV" && code !== "EPERM") throw error;
      copier.transfer = "copy";
    }
  }
  copyFileSync2(source, destination);
};
var copyTree = (from, to, copier, isDepsRoot) => {
  mkdirSync13(to, { recursive: true });
  const entries = readdirSync14(from, { withFileTypes: true });
  for (const entry of entries.filter((candidate) => !candidate.isFile())) {
    const source = join27(from, entry.name);
    const destination = join27(to, entry.name);
    if (entry.isSymbolicLink()) {
      createLink(source, copier.retarget(readlinkSync2(source), from), destination);
    } else if (entry.isDirectory()) {
      copyTree(source, destination, copier, false);
    }
  }
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const source = join27(from, entry.name);
    const destination = join27(to, entry.name);
    if (isDepsRoot) {
      copyFileSync2(source, destination);
      copier.files++;
    } else {
      placeFile(source, destination, copier);
    }
  }
};
var hasLinkedFile = (dir2) => readdirSync14(dir2, { withFileTypes: true }).some((entry) => {
  const path2 = join27(dir2, entry.name);
  if (entry.isDirectory()) return hasLinkedFile(path2);
  return entry.isFile() && statSync12(path2).nlink > 1;
});
var depsDirsOf = (entries, deps) => {
  const dirs = entries.filter((entry) => entry.endsWith("/") && posix4.basename(entry) === deps).map((entry) => entry.slice(0, -1));
  return dirs.filter((dir2) => !dirs.some((other) => dir2.startsWith(`${other}/`)));
};
var unlinkDepsLinks = (worktree, deps, entries) => {
  const candidates = /* @__PURE__ */ new Set([deps, ...entries.filter((entry) => posix4.basename(entry) === deps).map((entry) => entry.replace(/\/$/, ""))]);
  for (const candidate of candidates) {
    const path2 = join27(worktree, candidate);
    try {
      if (lstatSync4(path2).isSymbolicLink()) unlinkOne(path2);
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw error;
    }
  }
};
var deadStaging = (pool) => readdirSync14(pool).filter((name) => {
  const pid = STAGING.exec(name)?.[1];
  return pid !== void 0 && !isAlive(Number(pid));
});
var publish = (staging, entry) => {
  try {
    renameSync2(staging, entry);
  } catch (error) {
    if (!existsSync10(join27(entry, MANIFEST))) throw error;
    removeTree(staging);
  }
};
var snapshot = (source, pool, entry, contents) => {
  mkdirSync13(pool, { recursive: true });
  for (const name of deadStaging(pool)) {
    removeTree(join27(pool, name));
  }
  const target = join27(realpathSync4.native(pool), entry.name);
  const staging = join27(pool, `${entry.name}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  const copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, source, target), transfer: "hardlink", files: 0 };
  try {
    for (const dir2 of contents.deps) {
      copyTree(join27(source, dir2), join27(staging, dir2), copier, true);
    }
    if (contents.lock !== void 0) writeFileSync8(join27(staging, contents.lock.file), contents.lock.bytes);
    const manifest = {
      lockfile: contents.lockfile,
      deps: contents.deps,
      footprint: contents.footprint,
      transfer: copier.transfer,
      lock: contents.lock?.file,
      published: Date.now()
    };
    writeFileSync8(join27(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}
`);
    publish(staging, target);
  } catch (error) {
    removeTree(staging);
    throw error;
  }
  return copier;
};
var touchStamps = (worktree, stamps) => {
  const now = /* @__PURE__ */ new Date();
  for (const stamp of stamps.map((name) => join27(worktree, name)).filter((path2) => existsSync10(path2))) {
    utimesSync(stamp, now, now);
  }
};
var reuse = (worktree, pool, entry, keyed, after, from) => {
  const pooledEntry = join27(pool, entry.name);
  const manifest = readManifest(pooledEntry);
  if (manifest === void 0) return { kind: "failed", detail: `pool entry ${pooledEntry} has no valid ${MANIFEST}: delete the entry` };
  const real = realpathSync4.native(pooledEntry);
  const copier = { retarget: (raw, linkDir) => linkTarget(raw, linkDir, real, worktree), transfer: "hardlink", files: 0 };
  if (manifest.lock !== void 0) copyFileSync2(join27(real, manifest.lock), join27(worktree, manifest.lock));
  for (const dir2 of manifest.deps) {
    const destination = join27(worktree, dir2);
    if (!existsSync10(dirname14(destination))) continue;
    removeTree(destination);
    copyTree(join27(real, dir2), destination, copier, true);
  }
  touchStamps(worktree, keyed.lockfile.stamp ?? []);
  if (after !== void 0) {
    const status = runCommand(after, worktree);
    if (status !== 0) return { kind: "failed", detail: `after command ${after} failed (exit ${status})` };
  }
  const { files, transfer } = copier;
  const { key } = keyed;
  return { kind: "reused", from, published: manifest.published, lockfile: manifest.lockfile, key, version: entry.version, files, transfer, after, footprint: manifest.footprint };
};
var installedCheckout = (main, keyed, configured, accepts) => {
  for (const checkout of listWorktrees(main)) {
    if (checkout.isPrunable || !accepts(checkout.path)) continue;
    const lockfile = findLockfile(checkout.path);
    if (typeof lockfile === "string") continue;
    const sibling = keyedOf(checkout.path, lockfile, configured);
    if (sibling.key !== keyed.key || freshnessOf(checkout.path, sibling) !== "fresh" || !hasDepsDir(checkout.path, lockfile.deps)) continue;
    const deps = depsDirsOf(ignoredEntries(checkout.path), lockfile.deps);
    if (deps.length > 0) return { path: checkout.path, deps };
  }
  return void 0;
};
var poolFromCheckout = (source, pool, keyed) => {
  try {
    const lock = lockOf(keyed, source.path);
    const entry = entryOf(keyed, lock);
    snapshot(source.path, pool, entry, { lockfile: keyed.lockfile.file, deps: source.deps, footprint: [], lock });
    return entry;
  } catch (error) {
    process.stderr.write(`deps: could not pool the dependencies of ${toSlash(source.path)}, installing instead: ${messageOf(error)}
`);
    return void 0;
  }
};
var installAndPool = (worktree, pool, keyed, after) => {
  const { lockfile, install, key } = keyed;
  const before = ignoredEntries(worktree);
  unlinkDepsLinks(worktree, lockfile.deps, before);
  const status = runCommand(install, worktree);
  if (status !== 0) return { kind: "failed", detail: `install ${install} failed (exit ${status})` };
  const entries = ignoredEntries(worktree);
  const deps = depsDirsOf(entries, lockfile.deps);
  const notPooled = (reason) => ({ kind: "installed", pooled: false, install, lockfile: lockfile.file, key, reason });
  if (deps.length === 0) return notPooled(`install left no ${lockfile.deps} folder`);
  if (keyed.storesLock && !existsSync10(join27(worktree, lockfile.file))) return notPooled(`install left no ${lockfile.file}`);
  const known = new Set(before);
  const footprint = entries.filter((entry2) => !known.has(entry2) && !deps.some((dir2) => entry2 === `${dir2}/` || entry2.startsWith(`${dir2}/`)));
  const lock = lockOf(keyed, worktree);
  const entry = entryOf(keyed, lock);
  let copier;
  try {
    copier = snapshot(worktree, pool, entry, { lockfile: lockfile.file, deps, footprint, lock });
  } catch (error) {
    return notPooled(`could not pool: ${messageOf(error)}`);
  }
  const { files, transfer } = copier;
  return { kind: "installed", pooled: true, install, lockfile: lockfile.file, key, version: entry.version, files, transfer, after, footprint };
};
var reuseOrInstall = (checkout, pool, keyed, options, accepts, stored) => {
  const source = installedCheckout(options.main, keyed, options.install, accepts);
  const pooled = source === void 0 ? void 0 : poolFromCheckout(source, pool, keyed);
  if (source !== void 0 && pooled !== void 0) return reuse(checkout, pool, pooled, keyed, options.after, toSlash(source.path));
  if (stored !== void 0) return reuse(checkout, pool, stored, keyed, options.after, void 0);
  return installAndPool(checkout, pool, keyed, options.after);
};
var provideTracked = (checkout, pool, keyed, options) => {
  if (options.refresh === true) return { kind: "failed", detail: `--refresh is for a gitignored lock file; ${keyed.lockfile.file} is tracked, so its entry already holds what it pins` };
  const entry = entryOf(keyed, void 0);
  if (existsSync10(join27(pool, entry.name))) return reuse(checkout, pool, entry, keyed, options.after, void 0);
  return reuseOrInstall(checkout, pool, keyed, options, (path2) => !samePath(path2, checkout), void 0);
};
var provideIgnored = (checkout, pool, keyed, options) => {
  if (options.refresh === true) return installAndPool(checkout, pool, keyed, options.after);
  const versions = versionsOf(pool, keyed.key);
  const newest = versions[0]?.published ?? -Infinity;
  const known = new Set(versions.map((entry) => entry.version));
  const hasNewerLock = (path2) => {
    const lock = join27(path2, keyed.lockfile.file);
    return (mtimeOf(lock) ?? -Infinity) > newest && !known.has(versionOf(readFileSync25(lock)));
  };
  return reuseOrInstall(checkout, pool, keyed, options, hasNewerLock, versions[0]);
};
var provideDeps = (checkout, options) => {
  const lockfile = findLockfile(checkout);
  if (typeof lockfile === "string") return { kind: "skipped", reason: lockfile };
  try {
    const keyed = keyedOf(checkout, lockfile, options.install);
    const pool = poolOf(options.main);
    return keyed.storesLock ? provideIgnored(checkout, pool, keyed, options) : provideTracked(checkout, pool, keyed, options);
  } catch (error) {
    return { kind: "failed", detail: messageOf(error) };
  }
};
var saveDeps = (checkout, options) => {
  const lockfile = findLockfile(checkout);
  if (typeof lockfile === "string") return { kind: "skipped", reason: lockfile };
  try {
    const keyed = keyedOf(checkout, lockfile, options.install);
    const pool = poolOf(options.main);
    const lock = lockOf(keyed, checkout);
    const entry = entryOf(keyed, lock);
    const { key } = keyed;
    if (existsSync10(join27(pool, entry.name))) return { kind: "kept", lockfile: lockfile.file, key, version: entry.version };
    if (!hasDepsDir(checkout, lockfile.deps)) return { kind: "failed", detail: `${toSlash(checkout)} has no ${lockfile.deps} folder of its own` };
    const freshness = freshnessOf(checkout, keyed);
    if (freshness !== "fresh" && options.force !== true) {
      const why = freshness === "stale" ? `${lockfile.deps} looks older than ${lockfile.file}${keyed.manifests.length === 0 ? "" : ` or a tracked ${lockfile.manifest ?? ""}`} (${(lockfile.stamp ?? []).join(" or ")} is older): install first` : `jig knows no install stamp for ${lockfile.file}, so it cannot tell whether ${lockfile.deps} matches it`;
      return { kind: "failed", detail: `${why}, or pass --force` };
    }
    const deps = depsDirsOf(ignoredEntries(checkout), lockfile.deps);
    const { files, transfer } = snapshot(checkout, pool, entry, { lockfile: lockfile.file, deps, footprint: [], lock });
    return { kind: "saved", lockfile: lockfile.file, key, version: entry.version, files, transfer, after: void 0, footprint: [] };
  } catch (error) {
    return { kind: "failed", detail: messageOf(error) };
  }
};
var prunePool = (main, dryRun) => {
  try {
    const pool = poolOf(main);
    if (!existsSync10(pool)) return { kind: "pruned", dryRun, entries: [], staging: [], copied: [] };
    const staging = deadStaging(pool);
    const keys = readdirSync14(pool, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !STAGING.test(entry.name));
    const copied = keys.filter((entry) => readManifest(join27(pool, entry.name))?.transfer === "copy").map((entry) => entry.name);
    const entries = keys.filter((entry) => !copied.includes(entry.name) && !hasLinkedFile(join27(pool, entry.name))).map((entry) => entry.name);
    if (!dryRun) {
      for (const name of [...entries, ...staging]) {
        removeTree(join27(pool, name));
      }
    }
    return { kind: "pruned", dryRun, entries, staging, copied };
  } catch (error) {
    return { kind: "failed", detail: messageOf(error) };
  }
};
var hasIgnoredLockKeyChange = (checkout, changed) => {
  const lockfile = findLockfile(checkout);
  if (typeof lockfile === "string" || lockfile.manifest === void 0 || changed.length === 0) return false;
  const { manifest } = lockfile;
  return changed.some((path2) => posix4.basename(toSlash(path2)) === manifest) && isIgnored(checkout, lockfile.file);
};
var missingDepsOf = (checkout) => {
  const present = LOCKFILES.filter((lockfile) => existsSync10(join27(checkout, lockfile.file)));
  const candidates = present.length > 0 ? present : LOCKFILES.filter((lockfile) => lockfile.manifest !== void 0 && existsSync10(join27(checkout, lockfile.manifest)));
  const deps = candidates.find(isPooled)?.deps;
  return deps === void 0 || hasDepsDir(checkout, deps) ? void 0 : deps;
};
var unprovisionedWorktrees = (dir2) => listWorktrees(dir2).slice(1).flatMap((worktree) => {
  const deps = worktree.isPrunable ? void 0 : missingDepsOf(worktree.path);
  return deps === void 0 ? [] : [{ path: worktree.path, deps }];
});
var pooledLines = (outcome) => {
  const lines2 = [];
  if (outcome.transfer === "copy") {
    lines2.push("deps: hardlinks failed, files were copied: keep the worktree on the volume of the main checkout");
  }
  if (outcome.footprint.length > 0 && outcome.after === void 0) {
    lines2.push(`deps: install also made ${outcome.footprint.join(", ")}, which a reuse does not: set worktree.depsPool.after to the command that makes them`);
  }
  return lines2;
};
var ranAfter = (after) => after === void 0 ? "" : `, ran ${after}`;
var entryLabel = (outcome) => outcome.version === void 0 ? `pool entry ${outcome.key}` : `pool entry ${outcome.key} version ${outcome.version}`;
var restoredLock = (outcome) => outcome.version === void 0 ? "" : `, restored its ${outcome.lockfile}`;
var MS_PER_HOUR = 60 * 60 * 1e3;
var HOURS_PER_DAY = 24;
var ageOf = (published) => {
  if (published === void 0 || published === 0) return "at an unknown time";
  const hours = Math.max(0, Math.floor((Date.now() - published) / MS_PER_HOUR));
  return hours < HOURS_PER_DAY ? `${hours} h ago` : `${Math.floor(hours / HOURS_PER_DAY)} days ago`;
};
var staleResolution = (outcome) => outcome.version === void 0 ? [] : [
  `deps: ${outcome.lockfile} is gitignored, so this entry holds what an install resolved ${ageOf(outcome.published)}; a dist-tag or range that moved on the registry since is not in it: commit ${outcome.lockfile}, or run jig worktree deps <dir> --refresh`
];
var storedLock = (outcome) => outcome.version === void 0 ? "" : ` along with ${outcome.lockfile}`;
var formatDeps = (outcome) => {
  switch (outcome.kind) {
    case "reused": {
      const counts = `(${outcome.files} files${restoredLock(outcome)})${ranAfter(outcome.after)}`;
      const head = outcome.from === void 0 ? `deps: reused ${entryLabel(outcome)} for ${outcome.lockfile} ${counts}` : `deps: pooled the installed ${outcome.lockfile} dependencies of ${outcome.from} as ${entryLabel(outcome)}, reused them ${counts}`;
      return [head, ...staleResolution(outcome), ...pooledLines(outcome)];
    }
    case "installed":
      if (!outcome.pooled) return [`deps: installed for ${outcome.lockfile} with ${outcome.install}, not pooled: ${outcome.reason}`];
      return [
        `deps: installed for ${outcome.lockfile} with ${outcome.install}, pooled as ${entryLabel(outcome)}${storedLock(outcome)} (${outcome.files} files)`,
        ...pooledLines(outcome)
      ];
    case "saved":
      return [`deps: saved the dependencies for ${outcome.lockfile} as ${entryLabel(outcome)}${storedLock(outcome)} (${outcome.files} files)`, ...pooledLines(outcome)];
    case "kept":
      return [`deps: ${entryLabel(outcome)} for ${outcome.lockfile} already exists, kept as is`];
    case "skipped":
      return [`deps: not pooled, ${outcome.reason}`];
    case "failed":
      return [`deps: failed, ${outcome.detail}`];
    default: {
      const unhandled = outcome;
      return unhandled;
    }
  }
};
var formatPrune = (outcome) => {
  if (outcome.kind === "failed") return [`deps: failed, ${outcome.detail}`];
  const verb = outcome.dryRun ? "would remove" : "removed";
  return [
    ...outcome.entries.map((key) => `deps: ${verb} pool entry ${key}`),
    ...outcome.staging.map((name) => `deps: ${verb} staging folder ${name}`),
    ...outcome.copied.map((key) => `deps: kept pool entry ${key}: its files were copied, not hardlinked, so jig cannot tell whether a checkout uses it`),
    `deps: ${verb} ${outcome.entries.length} pool entries`
  ];
};

// src/hook/dispatch.ts
var NONE2 = { type: "none" };
var AGENT_FLAG = "--agent";
var errorMessage = (error) => error instanceof Error ? error.message : String(error);
var journal = (ctx, entry) => {
  try {
    const turn = ctx.turn ?? readState(ctx.projectRoot, ctx.sessionId)?.turn;
    appendJournal(ctx.projectRoot, { session: ctx.sessionId, agent: ctx.agent, ...entry, ...turn === void 0 ? {} : { turn } });
  } catch {
    return;
  }
};
var journalFailure = (ctx, error) => {
  journal(ctx, { kind: "hook-failure", tool: "jig", message: errorMessage(error) });
};
var trackTurn = (ctx, state) => {
  ctx.turn = state.turn;
  return state;
};
var openSession = (ctx) => trackTurn(ctx, readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, takeSnapshot(ctx.projectRoot)));
var contextOf = (parts) => parts.length === 0 ? NONE2 : { type: "context", text: parts.join("\n") };
var compactRunLine = (ctx, now) => {
  try {
    return activeRunContext(ctx.projectRoot, new Date(now));
  } catch (error) {
    journalFailure(ctx, error);
    return void 0;
  }
};
var hasProjectConfig = (projectRoot) => {
  const paths = jigPaths(projectRoot);
  return existsSync11(paths.config) || existsSync11(paths.localConfig);
};
var isDepsPooled = (projectRoot) => hasProjectConfig(projectRoot) && loadConfig(projectRoot).worktree?.depsPool !== void 0;
var toldWorktrees = (ctx, state) => state.toldWorktrees?.[ctx.agent] ?? [];
var tell = (ctx, state, checked, missing) => {
  state.toldWorktrees = { ...state.toldWorktrees, [ctx.agent]: [...toldWorktrees(ctx, state), ...checked.map(toSlash)] };
  if (missing.length === 0) return void 0;
  const jig = `node "${toSlash(join28(ctx.pluginRoot, "bin", "jig.mjs"))}"`;
  return missing.map(({ path: path2, deps }) => {
    const dir2 = toSlash(path2);
    return `jig: worktree ${dir2} has no ${deps} of its own. Before tests, a build or a dev server there, run \`${jig} worktree seed "${dir2}"\` then \`${jig} worktree deps "${dir2}"\` in the foreground: a pool miss installs, which takes minutes.`;
  }).join("\n");
};
var cwdWorktreeNote = (ctx, state) => {
  const root = linkedWorktreeRoot(ctx.cwd);
  if (root === void 0 || toldWorktrees(ctx, state).some((told) => samePath(told, root)) || !isDepsPooled(ctx.projectRoot)) return void 0;
  const deps = missingDepsOf(root);
  return tell(ctx, state, [root], deps === void 0 ? [] : [{ path: root, deps }]);
};
var worktreePathsOf = (ctx) => {
  try {
    return listWorktrees(ctx.projectRoot).map((worktree) => worktree.path);
  } catch (error) {
    journalFailure(ctx, error);
    return void 0;
  }
};
var newWorktreesNote = (ctx, state, before) => {
  const known = [...before, ...toldWorktrees(ctx, state)];
  const missing = unprovisionedWorktrees(ctx.projectRoot).filter((worktree) => !known.some((path2) => samePath(path2, worktree.path)));
  return tell(ctx, state, missing.map((worktree) => worktree.path), missing);
};
var noteOf = (ctx, note) => {
  try {
    const text3 = note();
    return text3 === void 0 ? [] : [text3];
  } catch (error) {
    journalFailure(ctx, error);
    return [];
  }
};
var launchDirOf = (ctx, state) => state.launchDir ?? ctx.projectRoot;
var rulesSession = (ctx) => {
  const state = openSession(ctx);
  if (state.toldRules?.[ctx.agent] === void 0) markTold(state, ctx.agent, ctx.native?.atStart(launchDirOf(ctx, state)) ?? []);
  return state;
};
var rulesFor = (ctx, state, targets) => noteOf(ctx, () => deliver(state, ctx.agent, targets)?.text);
var absoluteIn = (ctx, file) => resolve14(ctx.projectRoot, file);
var sessionStart = (event, ctx) => {
  const now = Date.now();
  ensureJigDir(ctx.projectRoot);
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot);
  pruneStates(ctx.projectRoot, now);
  pruneGateClaims(ctx.projectRoot, now);
  rotateJournal(ctx.projectRoot, now);
  const snapshot3 = takeSnapshot(ctx.projectRoot);
  const state = readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, snapshot3);
  resetSnapshot(state, snapshot3);
  trackTurn(ctx, state);
  if (event.source !== "compact" && ctx.agent === MAIN_AGENT) state.launchDir = ctx.cwd;
  const parts = [];
  if (event.source === "compact") {
    resetTold(state, ctx.agent);
    resetGateAtoms(ctx.projectRoot, ctx.sessionId, ctx.agent);
    const runLine = compactRunLine(ctx, now);
    if (runLine !== void 0) {
      parts.push(runLine);
    }
  }
  parts.push(...noteOf(ctx, () => cwdWorktreeNote(ctx, state)));
  writeState(ctx.projectRoot, state);
  const driftLine = configDriftLine(plan);
  if (driftLine !== void 0) {
    parts.push(driftLine);
  }
  return contextOf(parts);
};
var compact = (ctx) => {
  const state = openSession(ctx);
  resetTold(state, ctx.agent);
  resetGateAtoms(ctx.projectRoot, ctx.sessionId, ctx.agent);
  writeState(ctx.projectRoot, state);
  return NONE2;
};
var isRuleFile = (path2) => RULE_FILES.includes(basename6(path2));
var markReadRules = (ctx, state, paths) => {
  markTold(state, ctx.agent, paths.filter(isRuleFile));
};
var touch = (event, ctx) => {
  const state = rulesSession(ctx);
  if (event.read) {
    markReadRules(ctx, state, event.paths);
    const native = ctx.native;
    if (native !== void 0) {
      for (const path2 of event.paths) markTold(state, ctx.agent, native.onRead(path2, launchDirOf(ctx, state)));
    }
  }
  const parts = rulesFor(ctx, state, event.paths);
  writeState(ctx.projectRoot, state);
  return contextOf(parts);
};
var instructionsLoaded = (event, ctx) => {
  const state = rulesSession(ctx);
  markTold(state, ctx.agent, [event.file]);
  writeState(ctx.projectRoot, state);
  return NONE2;
};
var RETRY2 = "jig: repeat the same edit after you have taken these instructions into account; it will pass.";
var rulesBackstop = (ctx, files) => {
  const state = rulesSession(ctx);
  const delivery = deliver(state, ctx.agent, files.map((file) => absoluteIn(ctx, file)), { requireRules: true });
  if (delivery === void 0) return void 0;
  writeState(ctx.projectRoot, state);
  return `${delivery.text}

${RETRY2}`;
};
var prompt = (ctx) => {
  const state = openSession(ctx);
  resetSnapshot(state, takeSnapshot(ctx.projectRoot));
  state.turn += 1;
  ctx.turn = state.turn;
  writeState(ctx.projectRoot, state);
  return NONE2;
};
var gateFile = (event, ctx) => {
  const verdict2 = gateEdit({
    projectRoot: ctx.projectRoot,
    pluginRoot: ctx.pluginRoot,
    sessionId: ctx.sessionId,
    agent: ctx.agent,
    file: event.file,
    edits: event.edits,
    config: loadConfig(ctx.projectRoot)
  });
  for (const hit of verdict2.hits) {
    journal(ctx, { kind: "deny", tool: "jig", rule: hit.rule, file: event.file, ...hit.line === void 0 ? {} : { line: hit.line }, message: hit.message });
  }
  return verdict2.reason === void 0 ? NONE2 : { type: "deny", reason: verdict2.reason };
};
var preEdit = (event, ctx) => {
  const rules = rulesBackstop(ctx, [event.file]);
  return rules === void 0 ? gateFile(event, ctx) : { type: "deny", reason: rules };
};
var prePatch = (event, ctx) => {
  const rules = rulesBackstop(ctx, event.files.map((file) => file.file));
  if (rules !== void 0) return { type: "deny", reason: rules };
  const reasons = event.files.map((file) => gateFile(file, ctx)).flatMap((outcome) => outcome.type === "deny" ? [outcome.reason] : []);
  return reasons.length === 0 ? NONE2 : { type: "deny", reason: reasons.join("\n\n") };
};
var editToolFindings = async (ctx, file) => {
  let runs;
  try {
    runs = await checkEdit(loadPlan(ctx.projectRoot, ctx.pluginRoot), ctx.projectRoot, file);
  } catch (error) {
    journalFailure(ctx, error);
    return [];
  }
  for (const toolRun of runs) {
    if (toolRun.failure !== void 0) {
      journal(ctx, { kind: "tool-failure", tool: toolRun.tool, file, message: toolRun.failure, durationMs: toolRun.durationMs });
    }
    for (const finding of toolRun.findings) {
      journal(ctx, { kind: "finding", tool: finding.tool, rule: finding.rule, file: finding.file, line: finding.line, message: finding.message });
    }
  }
  return runs.flatMap((toolRun) => toolRun.findings);
};
var postEdit = async (files, ctx) => {
  const now = Date.now();
  const state = rulesSession(ctx);
  const toolFindings = [];
  for (const file of files) {
    state.edits.push({ path: file, at: now, agent: ctx.agent });
    toolFindings.push(...await editToolFindings(ctx, file));
  }
  const findingLines = collapseFindings(toolFindings);
  const worktreeNote = noteOf(ctx, () => cwdWorktreeNote(ctx, state));
  const rules = rulesFor(ctx, state, files.map((file) => absoluteIn(ctx, file)));
  writeState(ctx.projectRoot, state);
  return contextOf([...rules, ...limitLines(findingLines, POST_EDIT_LINE_LIMIT, ctx.pluginRoot), ...worktreeNote]);
};
var preShell = (event, ctx) => {
  if (!hasProjectConfig(ctx.projectRoot)) return NONE2;
  const snapshot3 = takeSnapshot(ctx.projectRoot);
  const worktrees = isDepsPooled(ctx.projectRoot) ? worktreePathsOf(ctx) : void 0;
  openShellCall(ctx.projectRoot, ctx.sessionId, event.callId, worktrees === void 0 ? { snapshot: snapshot3 } : { snapshot: snapshot3, worktrees });
  return NONE2;
};
var attributeShellChanges = (ctx, state, before) => {
  const at = Date.now();
  for (const path2 of changedSince(ctx.projectRoot, before)) {
    state.edits.push({ path: path2, at, agent: ctx.agent, via: "shell" });
  }
};
var postShell = (event, ctx) => {
  const call = event.isBackground ? void 0 : closeShellCall(ctx.projectRoot, ctx.sessionId, event.callId);
  const paths = event.paths ?? [];
  if (call === void 0 && paths.length === 0) return NONE2;
  const state = rulesSession(ctx);
  markReadRules(ctx, state, paths);
  const rules = rulesFor(ctx, state, paths);
  if (call !== void 0) attributeShellChanges(ctx, state, call.snapshot);
  const before = call?.worktrees;
  const worktreeNote = before === void 0 ? [] : noteOf(ctx, () => newWorktreesNote(ctx, state, before));
  writeState(ctx.projectRoot, state);
  return contextOf([...rules, ...worktreeNote]);
};
var ROLE_PATH = /\S*[\\/]roles[\\/]([\w-]+)\.md\b/g;
var subagentStart = (event, ctx) => {
  const prompt2 = event.prompt?.replace(ROLE_PATH, "role $1");
  journal(ctx, { kind: "subagent-start", tool: "jig", rule: event.agentType, ...prompt2 === void 0 ? {} : { message: prompt2 } });
  const state = openSession(ctx);
  resetTold(state, ctx.agent);
  writeState(ctx.projectRoot, state);
  return NONE2;
};
var stop = async (event, ctx) => {
  const state = openSession(ctx);
  const attributesShell = ctx.attributesShell === true;
  if (attributesShell) {
    for (const callId of openShellCalls(ctx.projectRoot, ctx.sessionId)) {
      const call = closeShellCall(ctx.projectRoot, ctx.sessionId, callId);
      if (call !== void 0) attributeShellChanges(ctx, state, call.snapshot);
    }
  }
  const verdict2 = await stopGate({ projectRoot: ctx.projectRoot, pluginRoot: ctx.pluginRoot, state, stopHookActive: event.stopHookActive, attributesShell });
  writeState(ctx.projectRoot, state);
  for (const note of verdict2.notes) {
    journal(ctx, note);
  }
  return verdict2.outcome;
};
var route = (event, ctx) => {
  switch (event.kind) {
    case "session-start":
      return sessionStart(event, ctx);
    case "compact":
      return compact(ctx);
    case "prompt":
      return prompt(ctx);
    case "pre-edit":
      return preEdit(event, ctx);
    case "pre-patch":
      return prePatch(event, ctx);
    case "post-edit":
      return postEdit([event.file], ctx);
    case "post-patch":
      return postEdit(event.files, ctx);
    case "touch":
      return touch(event, ctx);
    case "instructions-loaded":
      return instructionsLoaded(event, ctx);
    case "pre-shell":
      return preShell(event, ctx);
    case "post-shell":
      return postShell(event, ctx);
    case "subagent-start":
      return subagentStart(event, { ...ctx, agent: event.agentId });
    case "stop":
      return stop(event, ctx);
  }
};
var dispatch2 = async (event, base, pluginRoot = resolvePluginRoot()) => {
  const ctx = { ...base, pluginRoot, agent: base.agentId ?? MAIN_AGENT };
  try {
    return await route(event, ctx);
  } catch (error) {
    journalFailure(ctx, error);
    return NONE2;
  }
};
var handleHook = async (name, raw, env = process.env, adapter = resolveAdapter()) => {
  let parsed;
  try {
    parsed = adapter.parseHookInput(name, raw, env);
  } catch {
    return "";
  }
  if (parsed === void 0) return "";
  const outcome = await dispatch2(parsed.event, { ...parsed.base, attributesShell: adapter.attributesShell, native: adapter.native }, resolvePluginRoot(env));
  return adapter.formatOutcome(parsed.event.kind, outcome);
};
var parseHookArgs = (args) => {
  const at = args.indexOf(AGENT_FLAG);
  if (at === -1) return { name: args[0] ?? "", adapter: resolveAdapter() };
  const agent = args[at + 1];
  if (agent === void 0) throw new Error(`${AGENT_FLAG} needs an agent name`);
  const positional = args.filter((_, index) => index !== at && index !== at + 1);
  return { name: positional[0] ?? "", adapter: resolveAdapter(agent) };
};
var readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};
var traceHook = (name, adapter, raw, output) => {
  const log = process.env["JIG_HOOK_LOG"];
  if (log === void 0 || log === "") return;
  try {
    appendFileSync4(log, `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), name, agent: adapter.name, input: raw, output })}
`);
  } catch {
    return;
  }
};
var runHook = async (args) => {
  const { name, adapter } = parseHookArgs(args);
  try {
    const raw = await readStdin();
    const output = await handleHook(name, raw, process.env, adapter);
    traceHook(name, adapter, raw, output);
    if (output !== "") {
      process.stdout.write(output);
    }
  } catch {
    return 0;
  }
  return 0;
};

// src/init/init.ts
import { existsSync as existsSync12, readFileSync as readFileSync26 } from "node:fs";
var SCHEMA_URL = "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json";
var BOUNDARIES_PLUGIN = "eslint-plugin-boundaries";
var BOUNDARIES_IGNORE = "boundaries/*";
var USAGE3 = "usage: jig init [--update] [--json]";
var EXIT_USAGE3 = 2;
var NAME_WIDTH = 12;
var isObject3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readSharedConfig = (projectRoot) => {
  const path2 = jigPaths(projectRoot).config;
  if (!existsSync12(path2)) return {};
  try {
    const value = parseJsonc(readFileSync26(path2, "utf8"));
    return isObject3(value) ? value : {};
  } catch {
    return {};
  }
};
var proposedSetting = (found) => found.command === void 0 ? {} : { command: found.command };
var buildProposal = (base, discovery, config) => {
  const proposal = { $schema: SCHEMA_URL, ...base };
  for (const found of discovery.found) {
    if (found.status === "ready" && !isListed(config, found)) {
      proposal[found.name] = proposedSetting(found);
    }
  }
  return withTypesCheck(proposal, discovery, config);
};
var withTypesCheck = (proposal, discovery, config) => {
  const check2 = typesCheck(discovery.typeCheck);
  const command = discovery.typeCheck.script?.command;
  if (check2 === void 0 || command === void 0) return proposal;
  if (!isListed(config, { name: "tsc", kind: "tool" })) proposal["tsc"] = false;
  const checks = Array.isArray(proposal["checks"]) ? proposal["checks"] : [];
  const isCovered = checks.some(
    (entry) => isObject3(entry) && (entry["name"] === TYPES_CHECK_NAME || typeof entry["run"] === "string" && entry["run"].startsWith(command))
  );
  if (!isCovered) proposal["checks"] = [...checks, check2];
  return proposal;
};
var typeCheckLine = (detection) => {
  const { script } = detection;
  if (script === void 0) return "type check: no type-check script in package.json, jig runs tsc";
  const named = `script "${script.script}" (${script.command})`;
  if (!script.takesFiles) return `type check: ${named} is not proposed as a check: ${script.reason ?? "it takes no file list"}`;
  if (detection.globs.length === 0) return `type check: ${named} takes files, but the project has no .ts, .tsx or .vue files`;
  return `type check: ${named} takes files: proposed as check "${TYPES_CHECK_NAME}" with "tsc": false`;
};
var questionsFor = (discovery, boundaries, hasSlots) => {
  const byName = new Map(discovery.found.map((found) => [found.name, found]));
  const setupOf = (name) => catalogEntry(name)?.setup.join(", then ") ?? "";
  const questions = hasSlots ? [] : ["App run command (slots.dev) and install command (slots.install), if the project runs an app."];
  const agentView = byName.get("agent-view");
  const agentViewState = agentView === void 0 ? "not installed" : agentView.status === "ready" ? "configured" : "installed, no agent-view.config.json";
  questions.push(`agent-view for UI proof (${agentViewState}): needed? Setup: ${setupOf("agent-view")}.`);
  const stratum = byName.get("stratum");
  const stratumState = stratum === void 0 ? "not installed" : stratum.status === "ready" ? "configured" : "installed, no stratum.config.jsonc";
  const port = boundaries ? ` ${BOUNDARIES_PLUGIN} is present: port its rules to stratum, then "eslint": { "ignoreRules": ["${BOUNDARIES_IGNORE}"] }.` : "";
  questions.push(`stratum for module layers (${stratumState}): needed? Setup: ${setupOf("stratum")}.${port}`);
  const typeCheck = discovery.typeCheck.script;
  if (typeCheck?.takesFiles === true && !typeCheck.command.includes("--unchecked-ok")) {
    questions.push(
      `ts-decl-check exits 2 for a file no tsconfig covers, and check "${TYPES_CHECK_NAME}" then fails: add --unchecked-ok to script "${typeCheck.script}" if such files are fine.`
    );
  }
  return questions;
};
var buildInitReport = (projectRoot, update) => {
  const discovery = discover(projectRoot);
  const config = loadConfig(projectRoot);
  const base = update ? readSharedConfig(projectRoot) : {};
  const boundaries = discovery.packages.includes(BOUNDARIES_PLUGIN);
  const drift = update ? configDrift(projectRoot, config, resolveTools(projectRoot, config).unresolved) : [];
  const listed = update ? config : { tools: {}, proofs: {} };
  return { update, discovery, boundaries, drift, questions: questionsFor(discovery, boundaries, config.slots !== void 0), proposal: buildProposal(base, discovery, listed) };
};
var foundLine = (found) => {
  const facts2 = [
    found.status === "ready" ? "ready" : "needs setup",
    found.markers.length > 0 ? `markers ${found.markers.join(", ")}` : "no marker config",
    ...found.packages.length > 0 ? [`packages ${found.packages.join(", ")}`] : [],
    ...found.command === void 0 ? [] : [`command ${found.command}`],
    found.bin === void 0 ? "binary not installed" : `binary ${found.bin.join(" ")}`,
    ...found.status === "needs-setup" && found.setup.length > 0 ? [`setup: ${found.setup.join(", then ")}`] : []
  ];
  return `  ${found.name.padEnd(NAME_WIDTH)} ${facts2.join("; ")}`;
};
var formatInitReport = (report) => {
  const foundNames = new Set(report.discovery.found.map((found) => found.name));
  const missing = CATALOG.filter((entry) => !foundNames.has(entry.name)).map((entry) => entry.name);
  const lines2 = [
    `jig init${report.update ? " --update" : ""}: discovery by the jig catalog; nothing is written.`,
    "",
    "found:",
    ...report.discovery.found.map(foundLine),
    ...missing.length > 0 ? [`not found: ${missing.join(", ")}`] : [],
    `${BOUNDARIES_PLUGIN}: ${report.boundaries ? "declared in package.json" : "absent"}`,
    typeCheckLine(report.discovery.typeCheck)
  ];
  if (report.update) {
    lines2.push("", "drift:", ...report.drift.length > 0 ? report.drift.map((reason) => `  ${reason}`) : ["  none"]);
  }
  lines2.push("", "ask the user (code cannot know):", ...report.questions.map((question) => `  - ${question}`));
  lines2.push("", "proposal for .jig/config.jsonc:", JSON.stringify(report.proposal, null, 2));
  return `${lines2.join("\n")}
`;
};
var runInit = (args) => {
  const unknown = args.filter((arg) => arg !== "--update" && arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(`jig: ${USAGE3}
`);
    return EXIT_USAGE3;
  }
  const report = buildInitReport(resolveProjectRoot(process.cwd()), args.includes("--update"));
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(report, null, 2)}
` : formatInitReport(report));
  return 0;
};

// src/loop/loop.ts
import { mkdirSync as mkdirSync14, writeFileSync as writeFileSync9 } from "node:fs";
import { join as join29 } from "node:path";
var DEFAULT_DAYS = 7;
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var MIN_TURNS = 2;
var MAX_EXAMPLES = 3;
var SINGLE_RECORD_KINDS = /* @__PURE__ */ new Set(["gate-giveup", "gate-unresolved", "hook-failure", "tool-failure"]);
var DISTINCT_TURN_KINDS = /* @__PURE__ */ new Set(["deny", "finding", "gate-block"]);
var byTime = (left, right) => Date.parse(left.ts) - Date.parse(right.ts);
var turnKey = (record2, index) => record2.turn === void 0 ? `record:${index}` : JSON.stringify([record2.session, record2.turn]);
var isCandidate = (group) => {
  if (SINGLE_RECORD_KINDS.has(group.kind)) return true;
  return DISTINCT_TURN_KINDS.has(group.kind) && group.turns.size >= MIN_TURNS;
};
var compareCandidates = (left, right) => right.count - left.count || left.kind.localeCompare(right.kind) || (left.rule ?? "").localeCompare(right.rule ?? "") || (left.file ?? "").localeCompare(right.file ?? "");
var findCandidates = (records) => {
  const groups = /* @__PURE__ */ new Map();
  for (const [index, record2] of [...records].sort(byTime).entries()) {
    const key = JSON.stringify([record2.kind, record2.rule ?? null, record2.file ?? null]);
    let group = groups.get(key);
    if (group === void 0) {
      group = {
        kind: record2.kind,
        records: [],
        turns: /* @__PURE__ */ new Set(),
        ...record2.rule !== void 0 && { rule: record2.rule },
        ...record2.file !== void 0 && { file: record2.file }
      };
      groups.set(key, group);
    }
    group.records.push(record2);
    group.turns.add(turnKey(record2, index));
  }
  return [...groups.values()].filter(isCandidate).map((group) => ({
    kind: group.kind,
    ...group.rule !== void 0 && { rule: group.rule },
    ...group.file !== void 0 && { file: group.file },
    count: group.records.length,
    examples: group.records.slice(0, MAX_EXAMPLES)
  })).sort(compareCandidates);
};
var cell = (text3) => text3.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
var formatLocation = (record2) => {
  if (record2.file === void 0) return void 0;
  return record2.line === void 0 ? record2.file : `${record2.file}:${record2.line}`;
};
var formatExample = (record2) => {
  const location = formatLocation(record2);
  const parts = [location === void 0 ? void 0 : `\`${location}\``, record2.ts, record2.message];
  return cell(parts.filter((part) => part !== void 0).join(" "));
};
var formatCandidateTable = (candidates) => {
  if (candidates.length === 0) return ["No candidates."];
  const rows = candidates.map(
    (candidate) => `| ${candidate.kind} | ${cell(candidate.rule ?? "")} | ${candidate.count} | ${candidate.examples.map(formatExample).join("<br>")} |`
  );
  return ["| Signal | Rule | Count | Examples |", "| --- | --- | --- | --- |", ...rows];
};
var formatCounts = (records) => {
  const counts = /* @__PURE__ */ new Map();
  for (const record2 of records) {
    counts.set(record2.kind, (counts.get(record2.kind) ?? 0) + 1);
  }
  if (counts.size === 0) return ["No records."];
  const rows = [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([kind, count]) => `| ${kind} | ${count} |`);
  return ["| Kind | Count |", "| --- | --- |", ...rows];
};
var formatCandidates = (records, from, to, days) => [
  "# jig loop candidates",
  "",
  `Window: ${from.toISOString()} .. ${to.toISOString()} (${days} days)`,
  "",
  "## Candidates",
  "",
  ...formatCandidateTable(findCandidates(records)),
  "",
  "## Counts",
  "",
  ...formatCounts(records),
  ""
].join("\n");
var parseDays = (args) => {
  if (args.length === 0) return DEFAULT_DAYS;
  const [flag, value, ...rest] = args;
  const days = Number(value);
  const isValid = flag === "--days" && rest.length === 0 && Number.isInteger(days) && days > 0;
  if (!isValid) {
    throw new Error("usage: jig loop [--days <positive integer>]");
  }
  return days;
};
var runLoop = (args) => {
  const days = parseDays(args);
  const projectRoot = resolveProjectRoot(process.cwd());
  const to = /* @__PURE__ */ new Date();
  const from = new Date(to.getTime() - days * DAY_MS2);
  const records = readJournal(projectRoot, from.getTime());
  const dir2 = join29(ensureJigDir(projectRoot).runs, "_loop", to.toISOString().slice(0, 10));
  mkdirSync14(dir2, { recursive: true });
  const path2 = join29(dir2, "candidates.md");
  writeFileSync9(path2, formatCandidates(records, from, to, days));
  process.stdout.write(`${path2}
`);
  return 0;
};

// src/pre-mr/pre-mr.ts
import { spawnSync as spawnSync5 } from "node:child_process";
import { copyFileSync as copyFileSync3, existsSync as existsSync17, mkdtempSync, rmSync as rmSync9 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import { join as join34, resolve as resolve16 } from "node:path";
import { parseArgs as parseArgs3 } from "node:util";

// src/review/review-plan.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { existsSync as existsSync16, readFileSync as readFileSync30, readdirSync as readdirSync16 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { isAbsolute as isAbsolute7, join as join33, relative as relative7, resolve as resolve15 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";

// src/review/diff-files.ts
import { createHash as createHash7 } from "node:crypto";
import { mkdirSync as mkdirSync15, readdirSync as readdirSync15, rmSync as rmSync8, statSync as statSync13, writeFileSync as writeFileSync10 } from "node:fs";
import { join as join30 } from "node:path";
var DIFF_PART_MAX_LINES = 1500;
var DIFF_FORMAT = "partitions-compact-1";
var DIFF_DIR_PREFIX = "diff-";
var DIFF_DIR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var AUDIENCES = ["code", "tests", "docs"];
var chunkPath = (chunk) => {
  const side = (prefix) => {
    const line = chunk.find((candidate) => candidate.startsWith(prefix));
    const path2 = line?.slice(prefix.length).replace(/\r$/, "");
    return path2 === void 0 || path2 === "/dev/null" ? void 0 : path2.replace(/^[ab]\//, "");
  };
  const header = /^diff --git a\/(.*) b\/(.*?)\r?$/.exec(chunk[0] ?? "");
  return side("+++ ") ?? side("--- ") ?? header?.[2] ?? chunk[0] ?? "";
};
var partName = (partition, audience, index) => `${partition === "" ? "" : `${partition}-`}${audience}-${String(index + 1).padStart(2, "0")}.diff`;
var isGenerated = createMatcher(["**/*.{min.js,min.css,map,snap}", "**/__snapshots__/**"]);
var isUnreviewed = (path2) => isLockfile(path2) || isGenerated(path2);
var compactChunk = (chunk, path2) => {
  if (isUnreviewed(path2)) return void 0;
  const firstHunk = chunk.findIndex((line) => line.startsWith("@@"));
  const header = firstHunk === -1 ? chunk : chunk.slice(0, firstHunk);
  const renamedFrom = header.find((line) => line.startsWith("rename from "))?.slice("rename from ".length);
  if (header.some((line) => line.startsWith("deleted file mode"))) {
    const removed = chunk.filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length;
    return [`=== ${path2} (deleted, ${removed} lines)`];
  }
  if (header.some((line) => line.startsWith("Binary files"))) return [`=== ${path2} (binary)`];
  const notes = [
    ...header.some((line) => line.startsWith("new file mode")) ? ["new"] : [],
    ...renamedFrom === void 0 ? [] : [`renamed from ${renamedFrom}`]
  ];
  return [`=== ${path2}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`, ...firstHunk === -1 ? [] : chunk.slice(firstHunk)];
};
var splitDiff = (text3, audienceOf2 = () => "code", maxLines = DIFF_PART_MAX_LINES, partitionOf = () => "") => {
  const lines2 = text3.split("\n");
  if (lines2.at(-1) === "") lines2.pop();
  const chunks = [];
  for (const line of lines2) {
    if (line.startsWith("diff --git ") || chunks.length === 0) chunks.push({ path: "", raw: [] });
    chunks.at(-1)?.raw.push(line);
  }
  chunks.forEach((chunk) => chunk.path = chunkPath(chunk.raw));
  const partitions = [...new Set(chunks.map((chunk) => partitionOf(chunk.path)))].sort((left, right) => left.localeCompare(right, void 0, { numeric: true }));
  const parts = [];
  const files = [];
  const skipped = [];
  for (const partition of partitions) {
    for (const audience of AUDIENCES) {
      const own = [];
      for (const { path: path2, raw } of chunks) {
        if (partitionOf(path2) !== partition || audienceOf2(path2) !== audience) continue;
        const chunk = compactChunk(raw, path2);
        if (chunk === void 0) {
          skipped.push(path2);
          continue;
        }
        const current = own.at(-1);
        const part = current !== void 0 && current.length + chunk.length <= maxLines ? current : [];
        if (part !== current) own.push(part);
        files.push({ path: path2, audience, partition, part: partName(partition, audience, own.length - 1), start: part.length + 1, end: part.length + chunk.length });
        part.push(...chunk);
      }
      parts.push(...own.map((part, index) => ({ name: partName(partition, audience, index), audience, partition, text: `${part.join("\n")}
` })));
    }
  }
  return { parts, files, skipped };
};
var pruneOldDiffDirs = (reviewDir, keep, now) => {
  for (const name of readdirSync15(reviewDir)) {
    const dir2 = join30(reviewDir, name);
    if (!name.startsWith(DIFF_DIR_PREFIX) || dir2 === keep) continue;
    if (now - statSync13(dir2).mtimeMs > DIFF_DIR_MAX_AGE_MS) rmSync8(dir2, { recursive: true, force: true });
  }
};
var byAudience = (parts, pathOf) => Object.fromEntries(AUDIENCES.map((audience) => [audience, parts.filter((part) => part.audience === audience).map((part) => pathOf(part.name))]));
var writeDiffFiles = (root, diffArgs, reviewDir, audienceOf2, partitions = [], now = Date.now()) => {
  const result = git(["diff", "--no-color", "--no-ext-diff", ...diffArgs], root);
  if (!result.ok) throw new Error(`git diff failed: ${result.stderr.trim()}`);
  const owner = new Map(partitions.flatMap((partition) => partition.files.map((file) => [file, partition.name])));
  const partitionOf = (path2) => owner.get(path2) ?? partitions[0]?.name ?? "";
  const hash = createHash7("sha1").update(DIFF_FORMAT).update(JSON.stringify(partitions)).update(result.stdout).digest("hex").slice(0, 12);
  const dir2 = join30(reviewDir, `${DIFF_DIR_PREFIX}${hash}`);
  mkdirSync15(dir2, { recursive: true });
  pruneOldDiffDirs(reviewDir, dir2, now);
  const { parts, files, skipped } = splitDiff(result.stdout, audienceOf2, DIFF_PART_MAX_LINES, partitionOf);
  for (const part of parts) writeFileSync10(join30(dir2, part.name), part.text);
  const index = join30(dir2, "index.txt");
  writeFileSync10(
    index,
    [...files.map((file) => `${file.path}	${file.part}:${file.start}-${file.end}
`), ...skipped.map((path2) => `${path2}	not written: lock file, minified, source map or snapshot
`)].join("")
  );
  const pathOf = (name) => toSlash(join30(dir2, name));
  const names = [...new Set(parts.map((part) => part.partition))];
  return {
    dir: toSlash(dir2),
    index: toSlash(index),
    parts: parts.map((part) => pathOf(part.name)),
    audiences: byAudience(parts, pathOf),
    partitions: Object.fromEntries(names.map((name) => [name, byAudience(parts.filter((part) => part.partition === name), pathOf)]))
  };
};

// src/review/prices.ts
var DEFAULT_PRICES = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 }
};
var CACHE_MULTIPLIERS = { write5m: 1.25, write1h: 2, read: 0.1 };
var priceOf = (model, prices) => Object.entries(prices).find(([family]) => model.includes(family))?.[1];

// src/review/estimate.ts
var BASE_CONTEXT = 3e4;
var FINDER_BASE_CONTEXT = 2e5;
var TOKENS_PER_LINE = 60;
var FINDER_BASE_TURNS = 85;
var LINES_PER_TURN = 120;
var MAX_TURNS = 150;
var OUTPUT_PER_TURN = 800;
var finderReader = (lines2, model) => ({
  context: FINDER_BASE_CONTEXT + Math.max(0, lines2) * TOKENS_PER_LINE,
  turns: Math.min(MAX_TURNS, FINDER_BASE_TURNS + Math.ceil(Math.max(0, lines2) / LINES_PER_TURN)),
  model
});
var readerEstimate = (reader, prices) => {
  const price = reader.model === void 0 ? void 0 : priceOf(reader.model, prices);
  const cacheReads = reader.turns * ((BASE_CONTEXT + reader.context) / 2);
  const input = cacheReads * CACHE_MULTIPLIERS.read + reader.context * CACHE_MULTIPLIERS.write5m;
  const dollars = price === void 0 ? 0 : (input * price.input + reader.turns * OUTPUT_PER_TURN * price.output) / 1e6;
  return { context: reader.context, turns: reader.turns, dollars, priced: price !== void 0 };
};
var estimateReview = (finders, prices) => {
  const each = finders.map((finder) => readerEstimate(finder, prices));
  const models = [...new Set(finders.map((reader) => reader.model).filter((model) => model !== void 0))];
  return { finders: each, dollars: each.reduce((sum, reader) => sum + reader.dollars, 0), priced: each.every((reader) => reader.priced), models };
};
var thousands = (tokens) => `${Math.round(tokens / 1e3)}k`;
var money = (dollars) => `$${dollars < 10 ? dollars.toFixed(1) : Math.round(dollars).toString()}`;
var estimateLine = (estimate) => {
  const { finders } = estimate;
  const widest = finders.reduce((max, finder) => max === void 0 || finder.context > max.context ? finder : max, void 0);
  const shape = `finders ${finders.length} \xD7 up to ${thousands(widest?.context ?? 0)} context \xD7 ${widest?.turns ?? 0} turns`;
  const models = estimate.models.length > 0 ? estimate.models.join(", ") : "no model resolved";
  if (!estimate.priced) return `cost estimate: no price for ${models} (prices in ~/.jig/config.jsonc) \xB7 ${shape}`;
  return `cost estimate: ~${money(estimate.dollars)} \xB7 ${shape} \xB7 list prices of ${models}; runner and judges not included`;
};

// src/review/partition.ts
import { existsSync as existsSync13, readFileSync as readFileSync27 } from "node:fs";
import { join as join31, posix as posix5 } from "node:path";
var IMPORT_WEIGHT = 4;
var BALANCE = 1.5;
var MIN_SHARE = 0.25;
var IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g;
var importSpecifiers = (source) => [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? "").filter((spec2) => spec2 !== "");
var stripExtension = (path2) => path2.replace(/\.[^./]+$/, "");
var keysOf = (path2) => {
  const bare = stripExtension(path2);
  return bare.endsWith("/index") ? [bare, bare.slice(0, -"/index".length)] : [bare];
};
var aliasTail = (spec2) => {
  const tail = stripExtension(spec2.replace(/^[@~#]\//, ""));
  return tail.includes("/") ? tail : void 0;
};
var makeResolver = (targets) => {
  const byKey = /* @__PURE__ */ new Map();
  for (const path2 of targets) keysOf(path2).forEach((key) => byKey.set(key, path2));
  const keys = [...byKey.keys()];
  return (from, spec2) => {
    if (spec2.startsWith(".")) return byKey.get(stripExtension(posix5.normalize(posix5.join(posix5.dirname(from), spec2))));
    const tail = aliasTail(spec2);
    const key = tail === void 0 ? void 0 : keys.find((candidate) => candidate === tail || candidate.endsWith(`/${tail}`));
    return key === void 0 ? void 0 : byKey.get(key);
  };
};
var resolveEdges = (paths, specifiers) => {
  const target = makeResolver(paths);
  const edges = [];
  for (const from of paths) {
    for (const spec2 of specifiers.get(from) ?? []) {
      const to = target(from, spec2);
      if (to !== void 0 && to !== from) edges.push([from, to]);
    }
  }
  return edges;
};
var SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
var importEdges = (root, paths) => {
  const specifiers = /* @__PURE__ */ new Map();
  for (const path2 of paths) {
    const full = join31(root, path2);
    if (!SOURCE_PATTERN.test(path2) || !existsSync13(full)) continue;
    specifiers.set(path2, importSpecifiers(readFileSync27(full, "utf8")));
  }
  return resolveEdges(paths, specifiers);
};
var dirOf = (path2) => path2.split("/").slice(0, -1);
var commonPrefix = (left, right) => {
  const shared = [];
  for (let index = 0; index < Math.min(left.length, right.length) && left[index] === right[index]; index++) shared.push(left[index] ?? "");
  return shared;
};
var pairKey = (left, right) => left < right ? `${left}\0${right}` : `${right}\0${left}`;
var edgeCounts = (edges) => {
  const counts = /* @__PURE__ */ new Map();
  for (const [from, to] of edges) counts.set(pairKey(from, to), (counts.get(pairKey(from, to)) ?? 0) + 1);
  return counts;
};
var importsBetween = (left, right, counts) => {
  let sum = 0;
  for (const a of left) for (const b of right) sum += counts.get(pairKey(a, b)) ?? 0;
  return sum;
};
var isBetterMerge = (next, best) => {
  if (best === void 0) return true;
  if (next.fits !== best.fits) return next.fits;
  if (next.fits) return next.score > best.score || next.score === best.score && next.weight < best.weight;
  return next.weight < best.weight || next.weight === best.weight && next.score > best.score;
};
var singletons = (code) => [...code].sort((left, right) => left.path.localeCompare(right.path)).map((file) => ({ files: [file.path], weight: file.countedLines, dir: dirOf(file.path) }));
var totalWeight = (clusters) => clusters.reduce((sum, cluster) => sum + cluster.weight, 0);
var merged = (left, right) => ({ files: [...left.files, ...right.files], weight: left.weight + right.weight, dir: commonPrefix(left.dir, right.dir) });
var affinity = (left, right, counts) => importsBetween(left.files, right.files, counts) * IMPORT_WEIGHT + commonPrefix(left.dir, right.dir).length;
var agglomerate = (start, counts, count) => {
  const clusters = [...start];
  const cap = Math.max(Math.ceil(totalWeight(clusters) / count * BALANCE), ...clusters.map((cluster) => cluster.weight));
  while (clusters.length > count) {
    let best;
    clusters.forEach((left, i2) => {
      clusters.slice(i2 + 1).forEach((right, offset) => {
        const weight = left.weight + right.weight;
        const next = { i: i2, j: i2 + 1 + offset, score: affinity(left, right, counts), weight, fits: weight <= cap };
        if (isBetterMerge(next, best)) best = next;
      });
    });
    if (best === void 0) break;
    const { i, j } = best;
    const joined = merged(clusters[i], clusters[j]);
    clusters.splice(j, 1);
    clusters[i] = joined;
  }
  return clusters;
};
var indexOfMax = (items, key) => items.reduce((best, item, index) => best === -1 || key(item) > key(items[best]) ? index : best, -1);
var absorbStragglers = (start, code, counts) => {
  let clusters = [...start];
  const floor = totalWeight(clusters) / clusters.length * MIN_SHARE;
  const sizes = new Map(code.map((file) => [file.path, file.countedLines]));
  for (let round = 0; round < start.length; round++) {
    const lightest = indexOfMax(clusters, (cluster) => -cluster.weight);
    const straggler = clusters[lightest];
    const heaviest = indexOfMax(clusters, (cluster) => cluster.files.length > 1 && cluster !== straggler ? cluster.weight : -1);
    const host = clusters[heaviest];
    if (straggler.weight >= floor || host === void 0 || host.files.length < 2) break;
    const others = clusters.filter((cluster) => cluster !== straggler && cluster !== host);
    const partner = others[indexOfMax(others, (cluster) => affinity(straggler, cluster, counts) * 1e9 - cluster.weight)];
    const halves = agglomerate(
      singletons(host.files.map((path2) => ({ path: path2, countedLines: sizes.get(path2) ?? 0, kind: "code" }))),
      counts,
      2
    );
    const absorbed = partner === void 0 ? [] : [merged(partner, straggler)];
    if (absorbed.length === 0) break;
    clusters = [...others.filter((cluster) => cluster !== partner), ...absorbed, ...halves];
  }
  return clusters;
};
var clusterCode = (code, counts, count) => absorbStragglers(agglomerate(singletons(code), counts, count), code, counts);
var testStem = (path2) => (path2.split("/").pop() ?? path2).replace(/\.[^.]+$/, "").replace(/[._-](?:test|spec|stories|story)$/i, "").replace(/^test_/, "");
var affinityOf = (file, cluster, counts) => [
  file.kind === "tests" && cluster.files.some((path2) => path2 !== file.path && testStem(path2) === testStem(file.path)) ? 1 : 0,
  importsBetween(cluster.files, [file.path], counts),
  Math.max(0, ...cluster.files.map((path2) => commonPrefix(dirOf(path2), dirOf(file.path)).length)),
  -cluster.weight
];
var compareAffinity = (left, right) => {
  for (let index = 0; index < left.length; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
};
var homeOf = (file, clusters, counts) => {
  const scored = clusters.map((cluster) => ({ cluster, affinity: affinityOf(file, cluster, counts) }));
  return scored.reduce((best, next) => compareAffinity(next.affinity, best.affinity) > 0 ? next : best).cluster;
};
var dirsOf = (files) => {
  const counts = /* @__PURE__ */ new Map();
  for (const path2 of files) {
    const dir2 = dirOf(path2).join("/") || ".";
    counts.set(dir2, (counts.get(dir2) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([dir2]) => dir2);
};
var partitionFiles = (files, edges, count) => {
  const counts = edgeCounts(edges);
  const code = files.filter((file) => file.kind === "code");
  const clusters = code.length === 0 ? [{ files: [], weight: 0, dir: [] }] : clusterCode(code, counts, Math.max(1, Math.min(count, code.length)));
  attachRest(clusters, files.filter((file) => file.kind !== "code"), counts);
  const counted = countedOf(files);
  return clusters.map((cluster) => [...cluster.files].sort((left, right) => left.localeCompare(right))).sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")).map((own, index) => toPartition(`p${index + 1}`, own, counted));
};
var attachRest = (clusters, rest, counts) => {
  for (const file of [...rest].sort((left, right) => left.path.localeCompare(right.path))) homeOf(file, clusters, counts).files.push(file.path);
};
var toPartition = (name, files, counted) => {
  const own = [...files].sort((left, right) => left.localeCompare(right));
  return { name, files: own, lines: own.reduce((sum, path2) => sum + (counted.get(path2) ?? 0), 0), dirs: dirsOf(own) };
};
var countedOf = (files) => new Map(files.map((file) => [file.path, file.countedLines]));
var GROUP_NAME = /^[a-z][a-z0-9-]*$/;
var matchesEntry = (path2, entry) => entry.endsWith("/") ? path2.startsWith(entry) : path2 === entry;
var resolveGroups = (specs, files, max) => {
  const errors = [];
  if (specs.length > max) errors.push(`${specs.length} groups, at most ${max} (maxParallel)`);
  const names = /* @__PURE__ */ new Set();
  const owner = /* @__PURE__ */ new Map();
  const groups = specs.map(({ name, entries }) => {
    if (!GROUP_NAME.test(name)) errors.push(`group name ${name}: expected lowercase letters, digits and dashes`);
    if (names.has(name)) errors.push(`group ${name} given twice`);
    names.add(name);
    if (entries.length === 0) errors.push(`group ${name} has no files`);
    const own = [];
    for (const entry of entries) {
      const matched = files.filter((file) => matchesEntry(file.path, entry));
      if (matched.length === 0) errors.push(`${entry} in group ${name}: no changed file of this diff`);
      for (const file of matched) {
        const previous = owner.get(file.path);
        if (previous !== void 0 && previous !== name) errors.push(`${file.path} is in groups ${previous} and ${name}`);
        if (previous !== void 0) continue;
        owner.set(file.path, name);
        own.push(file.path);
      }
    }
    return { name, files: own };
  });
  const missing = files.filter((file) => file.kind === "code" && !owner.has(file.path)).map((file) => file.path);
  if (missing.length > 0) errors.push(`code files in no group: ${missing.join(", ")}`);
  if (errors.length > 0) throw new Error(`--partition: ${errors.join("; ")}`);
  return groups;
};
var groupFiles = (files, edges, groups) => {
  const counts = edgeCounts(edges);
  const counted = countedOf(files);
  const owned = new Set(groups.flatMap((group) => group.files));
  const clusters = groups.map((group) => ({
    files: [...group.files],
    weight: group.files.reduce((sum, path2) => sum + (counted.get(path2) ?? 0), 0),
    dir: group.files.map(dirOf).reduce((shared, dir2) => shared === void 0 ? dir2 : commonPrefix(shared, dir2), void 0) ?? []
  }));
  if (clusters.length > 0) attachRest(clusters, files.filter((file) => !owned.has(file.path)), counts);
  return groups.map((group, index) => toPartition(group.name, clusters[index]?.files ?? [], counted));
};

// src/review/rule-docs.ts
import { existsSync as existsSync14, readFileSync as readFileSync28 } from "node:fs";
import { join as join32, posix as posix6 } from "node:path";
var PROJECT_CONFIG = "review.jsonc";
var DEFAULT_DISCOVER = {
  rules: ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "REVIEW.md"],
  standards: ["**/{standards,conventions}/**/*.md"],
  exclude: ["**/{tracker,packages,adr,adrs,doc}/**", "docs/*.md"]
};
var STANDARD_NAME = /review|convention|standard|code[-_ ]?style|guideline/i;
var GLOSSARY_MAP2 = /(^|\/)glossary[-_ ]?map\.md$/i;
var GLOSSARY2 = /(^|\/)[^/]*glossary[^/]*\.md$/i;
var MARKDOWN_LINK = /\]\(<?([^)>\s#]+\.md)(?:#[^)\s]*)?>?\)|(?:^|\s)@([^\s]+\.md)/g;
var isStrings2 = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
var isTracked = (root, path2) => {
  const result = git(["ls-files", "--", path2], root);
  return result.ok && result.stdout.trim() !== "";
};
var projectConfigFile = (root) => {
  const own = join32(jigPaths(root).dir, PROJECT_CONFIG);
  if (existsSync14(own) && isTracked(root, `.jig/${PROJECT_CONFIG}`)) return { path: own, root };
  const mainRoot = listWorktrees(root)[0]?.path;
  const main = mainRoot === void 0 ? void 0 : join32(jigPaths(mainRoot).dir, PROJECT_CONFIG);
  if (mainRoot !== void 0 && main !== void 0 && existsSync14(main)) return { path: main, root: mainRoot };
  return existsSync14(own) ? { path: own, root } : void 0;
};
var readDiscover = (root) => {
  const path2 = projectConfigFile(root)?.path;
  if (path2 === void 0) return DEFAULT_DISCOVER;
  const config = parseJsonc(readFileSync28(path2, "utf8"));
  const discover2 = config?.discover ?? {};
  const pick = (key) => {
    const value = discover2[key];
    return isStrings2(value) ? value : DEFAULT_DISCOVER[key];
  };
  return { rules: pick("rules"), standards: pick("standards"), exclude: pick("exclude") };
};
var gitList = (root, args) => {
  const result = git(["-c", "core.quotePath=false", ...args], root);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean);
};
var ancestors = (file) => {
  const dirs = [];
  for (let dir2 = posix6.dirname(file); dir2 !== "."; dir2 = posix6.dirname(dir2)) dirs.push(dir2);
  return [...dirs, ""];
};
var sorted = (items) => [...new Set(items)].sort();
var dirOf2 = (path2) => posix6.dirname(path2) === "." ? "" : posix6.dirname(path2);
var depthOf = (dir2) => dir2 === "" ? 0 : dir2.split("/").length;
var linkedDocuments = (index, text3) => [...text3.matchAll(MARKDOWN_LINK)].map((match) => match[1] ?? match[2] ?? "").filter((target) => target !== "" && !/^[a-z]+:/i.test(target)).map((target) => posix6.normalize(target.startsWith("/") ? target.slice(1) : posix6.join(dirOf2(index), target)));
var standardScopes = (root, indexes, standards) => {
  const linkers = /* @__PURE__ */ new Map();
  for (const index of indexes) {
    for (const target of linkedDocuments(index, readFileSync28(join32(root, index), "utf8"))) linkers.set(target, [...linkers.get(target) ?? [], dirOf2(index)]);
  }
  const shallowest = (dirs) => [...dirs].sort((left, right) => depthOf(left) - depthOf(right) || left.localeCompare(right))[0] ?? "";
  return Object.fromEntries(standards.map((path2) => [path2, shallowest(linkers.get(path2) ?? [""])]));
};
var linksOf = (root, path2) => linkedDocuments(path2, readFileSync28(join32(root, path2), "utf8")).filter((target) => existsSync14(join32(root, target)));
var glossariesOf = (root, indexes, documents, dirs) => {
  const fromIndexes = indexes.flatMap((index) => linksOf(root, index));
  const maps = [...documents.filter((path2) => !path2.includes("/") && GLOSSARY_MAP2.test(path2)), ...fromIndexes.filter((path2) => GLOSSARY_MAP2.test(path2))];
  const listed = [...new Set(maps)].flatMap((map) => linksOf(root, map));
  const onWalkUp = documents.filter((path2) => dirs.has(dirOf2(path2)) && GLOSSARY2.test(path2) && !GLOSSARY_MAP2.test(path2));
  return sorted([...onWalkUp, ...fromIndexes, ...listed].filter((path2) => GLOSSARY2.test(path2) && !GLOSSARY_MAP2.test(path2)));
};
var ruleDocuments = (root, changed, env) => {
  const discover2 = readDiscover(root);
  const dirs = new Set(changed.flatMap(ancestors));
  const indexes = sorted(
    [...dirs].flatMap((dir2) => discover2.rules.map((name) => dir2 === "" ? name : `${dir2}/${name}`)).filter((path2) => existsSync14(join32(root, path2)))
  );
  const documents = gitList(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const reviewRules = env["REVIEW_RULES"];
  const isStandard = createMatcher(reviewRules ? [reviewRules] : discover2.standards);
  const isNamedStandard = (path2) => !reviewRules && STANDARD_NAME.test(path2);
  const isExcluded = createMatcher(discover2.exclude);
  const isIndex = (path2) => discover2.rules.includes(posix6.basename(path2));
  const standards = sorted(
    documents.filter((path2) => path2.toLowerCase().endsWith(".md") && !isIndex(path2) && (isStandard(path2) || isNamedStandard(path2)) && !isExcluded(path2))
  );
  const glossaries = glossariesOf(root, indexes, documents, dirs);
  const scopes = {
    ...Object.fromEntries([...indexes, ...glossaries].map((path2) => [path2, dirOf2(path2)])),
    ...standardScopes(root, indexes, standards)
  };
  return { indexes, standards, glossaries, scopes };
};
var changedPaths = (root, mergeBase, paths) => gitList(root, ["diff", "--name-only", "-z", mergeBase, ...paths.length > 0 ? ["--", ...paths] : []]);
var covers2 = (scope, file) => scope === "" || file.startsWith(`${scope}/`);
var rulesFor2 = (inputs, files) => [...inputs.indexes, ...inputs.standards, ...inputs.glossaries].filter((path2) => files.some((file) => covers2(inputs.scopes[path2] ?? "", file)));

// src/review/scope.ts
import { existsSync as existsSync15, readFileSync as readFileSync29 } from "node:fs";
var PATCH = ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff"];
var gitOut = (root, args, input) => {
  const result = git(args, root, input);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
};
var diffHash = (root, range) => gitOut(root, ["hash-object", "--stdin"], gitOut(root, [...PATCH, range])).trim();
var exists3 = (root, sha) => sha !== void 0 && git(["cat-file", "-e", `${sha}^{commit}`], root).ok;
var isClean = (root) => gitOut(root, ["status", "--porcelain", "--untracked-files=no"]).trim() === "";
var changeLines = (patch) => patch.split("\n").filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
var countOf = (lines2) => {
  const counts = /* @__PURE__ */ new Map();
  for (const line of lines2) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
};
var ownChanges = (path2, before, after) => {
  const unmatched2 = countOf(changeLines(before));
  let added = 0;
  for (const line of changeLines(after)) {
    const left = unmatched2.get(line) ?? 0;
    if (left > 0) unmatched2.set(line, left - 1);
    else added++;
  }
  const deleted = [...unmatched2.values()].reduce((sum, count) => sum + count, 0);
  return { path: path2, added, deleted };
};
var patchOf2 = (root, range, ...paths) => gitOut(root, [...PATCH, "-M", range, "--", ...paths]);
var mergeRequestFiles = (root, base) => gitOut(root, ["-c", "core.quotePath=false", "diff", "--name-only", "-M", "-z", `${base}...HEAD`]).split("\0").filter(Boolean);
var renamesBetween = (root, from, to) => {
  const tokens = gitOut(root, ["-c", "core.quotePath=false", "diff", "--name-status", "-M", "--diff-filter=R", "-z", from, to]).split("\0");
  const renames = [];
  for (let index = 0; index + 2 < tokens.length; index += 3) {
    renames.push({ from: tokens[index + 1] ?? "", to: tokens[index + 2] ?? "" });
  }
  return renames;
};
var rereviewScope = (root, state, base) => {
  const files = mergeRequestFiles(root, base);
  const total = files.length;
  const current = `${base}...HEAD`;
  const hash = diffHash(root, current);
  if (hash === state.diff_hash && isClean(root)) return { kind: "unchanged", hash, files: [], total };
  const full = (reason) => ({ kind: "full", reason, files: files.map((path2) => ownChanges(path2, "", patchOf2(root, current, path2))), total });
  if (!exists3(root, state.base_sha) || !exists3(root, state.last_reviewed_sha)) return full("base_sha or last_reviewed_sha is missing locally");
  const reviewed = `${state.base_sha}...${state.last_reviewed_sha}`;
  if (diffHash(root, reviewed) !== state.diff_hash) return full("diff_hash does not match base_sha...last_reviewed_sha");
  const fileSet = new Set(files);
  const renamed = renamesBetween(root, state.last_reviewed_sha, "HEAD").filter((rename) => fileSet.has(rename.to));
  const reviewedPathOf = new Map(renamed.map((rename) => [rename.to, rename.from]));
  const changed = files.map((path2) => {
    const from = reviewedPathOf.get(path2);
    return from === void 0 ? ownChanges(path2, patchOf2(root, reviewed, path2), patchOf2(root, current, path2)) : ownChanges(path2, patchOf2(root, reviewed, from), patchOf2(root, current, from, path2));
  }).filter((stat) => stat.added + stat.deleted > 0);
  return { kind: "patches", files: changed, total, renamed };
};
var readReviewedState = (path2) => {
  if (!existsSync15(path2)) throw new Error(`no state at ${path2}`);
  return JSON.parse(readFileSync29(path2, "utf8"));
};

// src/review/layout.ts
var EFFORTS2 = ["low", "medium", "high"];
var CEILINGS = ["Important", "Nit"];
var LINES_PER_FINDER = 150;
var MAX_FINDERS = 5;
var MAX_PARALLEL = 6;
var ANGLE_TOKENS = {
  1: "bugs",
  2: "bugs",
  3: "bugs",
  4: "bugs",
  5: "bugs",
  8: "efficiency",
  12: "bugs",
  14: "security",
  15: "spec",
  16: "tests",
  18: "ux"
};
var isAngle = (value) => Object.hasOwn(ANGLE_TOKENS, value);
var ANGLES = Object.keys(ANGLE_TOKENS).map(Number).filter(isAngle);
var REMOVED_ANGLES = [6, 7, 9, 10, 11, 13, 17];
var IMPORTANT_ANGLES = [1, 2, 3, 4, 5, 8, 12, 14, 15, 16, 18];
var TOKEN_ANGLES = {
  bugs: [1, 2, 3, 4, 5, 12],
  security: [14],
  efficiency: [8],
  spec: [15],
  tests: [16],
  ux: [18]
};
var SPECIAL_TOKENS = ["important", "deepening"];
var SELECTOR_TOKENS = [...SPECIAL_TOKENS, ...Object.keys(TOKEN_ANGLES), "auto"];
var PRESETS = { full: void 0, quick: "important" };
var DEFAULT_GRADES = {
  behavior: { tier: "deep", effort: "high" },
  conventions: { tier: "standard", effort: "high" },
  tests: { tier: "standard", effort: "medium" },
  ux: { tier: "standard", effort: "high" },
  verify: { tier: "deep", effort: "medium" },
  outcome: { tier: "deep", effort: "medium" },
  composer: { tier: "standard", effort: "medium" },
  deepening: { tier: "deep", effort: "high" }
};
var GRADE_KEYS = Object.keys(DEFAULT_GRADES);
var REMOVED_GRADE_KEYS = ["flow"];
var LAYOUTS = ["auto", "lean", "solo"];
var isLayout = (value) => LAYOUTS.includes(value);
var resolveAuto = (layout) => layout === "auto" ? "lean" : layout;
var PROJECT_ANGLE_KINDS = ["behavior", "conventions"];
var PROJECT_ANGLE_NAME = /^[a-z][a-z0-9-]*$/;
var FINDER_KINDS = ["behavior", "conventions", "tests", "ux"];
var KIND_ANGLES = {
  behavior: [1, 2, 3, 4, 5, 8, 12, 14, 15],
  conventions: [],
  tests: [16],
  ux: [18]
};
var KIND_ROLES = { behavior: "finder", conventions: "finder", tests: "test-reviewer", ux: "finder" };
var REREVIEW_FULL_LAYOUT_LINES = 600;
var isLightRereview = (rereview, lines2) => rereview === true && lines2 < REREVIEW_FULL_LAYOUT_LINES;
var finderCount = (lines2) => Math.min(MAX_FINDERS, Math.ceil(Math.max(0, lines2) / LINES_PER_FINDER));
var ceilingOf = (angle, settings) => settings?.[angle]?.severityCeiling ?? (IMPORTANT_ANGLES.includes(angle) ? "Important" : "Nit");
var autoTokens = (shape) => ["important", ...shape.tests ? ["tests"] : [], ...shape.newSourceFiles > 0 ? ["deepening"] : []];
var parseSelector = (input, shape) => {
  const given = input !== void 0 && input !== "";
  const source = given ? "argument" : "default";
  const raw = given ? input : "full";
  if (Object.hasOwn(PRESETS, raw)) {
    const expanded2 = PRESETS[raw];
    return { input: raw, tokens: expanded2 === void 0 ? [] : [expanded2], source };
  }
  const tokens = raw.split(",").map((token) => token.trim());
  const unknown = tokens.filter((token) => !SELECTOR_TOKENS.includes(token));
  if (unknown.length > 0) {
    throw new Error(`unknown selector token ${unknown.join(", ")}; expected full, quick or tokens of: ${SELECTOR_TOKENS.join(", ")}`);
  }
  const expanded = tokens.flatMap((token) => token === "auto" ? autoTokens(shape) : [token]);
  return { input: raw, tokens: [...new Set(expanded)], source };
};
var selectedAngles = (tokens, settings) => {
  if (tokens.length === 0) return new Set(ANGLES);
  const angles = /* @__PURE__ */ new Set();
  for (const token of tokens) {
    const fromToken = token === "important" ? ANGLES.filter((angle) => ceilingOf(angle, settings) === "Important") : TOKEN_ANGLES[token] ?? [];
    fromToken.forEach((angle) => angles.add(angle));
  }
  return angles;
};
var inapplicable = (angle, shape) => {
  if (angle === 15 && !shape.spec) return "no spec found";
  if (angle === 16 && !shape.tests) return "no tests in the diff";
  if (angle === 18 && !shape.ui) return "no UI files in the diff";
  return void 0;
};
var roleGrade = (key, grades) => grades[key] ?? { tier: "deep", effort: "medium" };
var partitionFinders = (partitions, angles, projectAngles, grades, hasTests, hasUi) => partitions.flatMap(
  (partition) => FINDER_KINDS.map((kind) => ({
    name: `${partition.name}-${kind}`,
    kind,
    role: KIND_ROLES[kind],
    angles: angles.filter((angle) => KIND_ANGLES[kind].includes(angle) && (angle !== 16 || hasTests(partition)) && (angle !== 18 || hasUi(partition))),
    projectAngles: projectAngles.filter((angle) => angle.kind === kind).map((angle) => angle.name),
    partition: partition.name,
    ...roleGrade(kind, grades)
  })).filter((finder) => finder.angles.length + finder.projectAngles.length > 0)
);
var projectAngleWanted = (angle, tokens) => tokens.length === 0 || tokens.includes("important") && (angle.severityCeiling ?? "Important") === "Important";
var skipOrder = (skip) => typeof skip.angle === "number" ? [skip.angle, ""] : [Number.MAX_SAFE_INTEGER, skip.angle];
var bySkipOrder = (left, right) => {
  const [leftNumber, leftName] = skipOrder(left);
  const [rightNumber, rightName] = skipOrder(right);
  return leftNumber - rightNumber || leftName.localeCompare(rightName);
};
var namedPartitions = (count) => Array.from({ length: count }, (_, index) => ({ name: `p${index + 1}`, files: [], lines: 0, dirs: [] }));
var partitionsOf = (input, count) => input.files === void 0 ? namedPartitions(count) : partitionFiles(input.files, input.edges ?? [], count);
var planReview = (input) => {
  const n = finderCount(input.lines);
  const layout = resolveAuto(input.layout ?? "auto");
  const grades = { ...DEFAULT_GRADES, ...input.grades };
  const selection = parseSelector(input.selector, input.shape);
  const wanted = selectedAngles(selection.tokens, input.angles);
  const skipped = [];
  const angles = ANGLES.filter((angle) => {
    if (!wanted.has(angle)) return false;
    const reason = input.angles?.[angle]?.enabled === false ? "disabled in the project config" : inapplicable(angle, input.shape);
    if (reason !== void 0) skipped.push({ angle, reason });
    return reason === void 0;
  });
  const usedForCode = n === 0 ? angles.filter((angle) => angle === 15 || angle === 16) : angles;
  ANGLES.filter((angle) => angles.includes(angle) && !usedForCode.includes(angle)).forEach(
    (angle) => skipped.push({ angle, reason: "no counted code lines" })
  );
  const projectAngles = (input.projectAngles ?? []).filter((angle) => {
    if (!projectAngleWanted(angle, selection.tokens)) return false;
    const reason = angle.enabled === false ? "disabled in the project config" : n === 0 ? "no counted code lines" : void 0;
    if (reason !== void 0) skipped.push({ angle: angle.name, reason });
    return reason === void 0;
  });
  const light = isLightRereview(input.rereview, input.lines);
  const wantsDeepening = !light && (selection.tokens.length === 0 ? input.shape.newSourceFiles > 0 : selection.tokens.includes("deepening"));
  const path2 = usedForCode.length + projectAngles.length === 0 ? "none" : "subagents";
  const codeFiles = (input.files ?? []).filter((file) => file.kind === "code").length;
  const testFiles = new Set((input.files ?? []).filter((file) => file.kind === "tests").map((file) => file.path));
  const grouping = path2 === "none" ? "lines" : input.groups !== void 0 ? "groups" : input.policy === true && !light && codeFiles > 1 ? "pending" : "lines";
  const partitions = path2 === "none" || grouping === "pending" ? [] : input.groups !== void 0 ? groupFiles(input.files ?? [], input.edges ?? [], input.groups) : partitionsOf(input, light ? 1 : Math.max(1, n));
  return {
    lines: input.lines,
    n,
    layout,
    path: path2,
    judging: layout === "solo" ? "self" : "important",
    selection,
    outputTokens: selection.tokens.filter((token) => token !== "deepening"),
    angles: usedForCode,
    projectAngles,
    skipped: skipped.sort(bySkipOrder),
    grouping,
    partitions,
    finders: partitionFinders(
      partitions,
      usedForCode,
      projectAngles,
      grades,
      (partition) => input.files === void 0 || partition.files.some((path3) => testFiles.has(path3)),
      (partition) => input.files === void 0 || partition.files.some(isUiFile)
    ),
    deepening: wantsDeepening && n > 0 ? roleGrade("deepening", grades) : void 0,
    verify: roleGrade("verify", grades),
    outcome: roleGrade("outcome", grades),
    composer: roleGrade("composer", grades)
  };
};
var MODES = ["review", "pre-mr"];
var BUG_ANGLES = [1, 2, 3, 4, 5, 12, 14, 18];
var gateFiles = (angles, projectAngles = []) => [
  ...angles.some((angle) => BUG_ANGLES.includes(angle)) || projectAngles.some((angle) => angle.kind === "behavior") ? ["gates/bugs.md"] : [],
  ...angles.some((angle) => !BUG_ANGLES.includes(angle)) || projectAngles.some((angle) => angle.kind === "conventions") ? ["gates/shape.md"] : [],
  "gates/severity.md"
];
var stepsFor = (plan, mode, state) => {
  const output = { file: "steps/08-output.md", when: mode === "pre-mr" ? 'section "Pre-mr verdict"' : state ? 'sections "Write state" and "Output"' : 'section "Output"' };
  if (plan.path === "none") return [output];
  const steps = [{ file: "steps/02-rules.md" }];
  if (state) {
    steps.push(
      { file: "steps/03-state.md" },
      { file: "references/state-schema.md" },
      { file: "steps/09-rereview.md", when: "only when the state file exists: replaces the next steps up to rank for its scope" }
    );
  }
  if (plan.judging === "important") {
    steps.push({ file: "steps/04-finders.md", when: 'without section "Layout solo"' }, { file: "steps/05-verify.md", when: 'without section "Layout solo"' }, ...gateFiles(plan.angles, plan.projectAngles).map((file) => ({ file })));
  } else steps.push({ file: "steps/04-finders.md" }, { file: "steps/05-verify.md", when: 'without section "Layout lean"' });
  steps.push({ file: "steps/06-rank.md" });
  if (state) steps.push({ file: "steps/07-comments.md" });
  steps.push(output);
  if (state) steps.push({ file: "references/posting.md", when: "only with --post or an explicit request" });
  return steps;
};
var judgeModels = (finderModels, verifyModels) => [...new Set(finderModels)].flatMap((finderModel) => {
  const other = verifyModels.find((model) => model !== finderModel);
  const first = verifyModels[0];
  if (other !== void 0) return [{ finderModel, judgeModel: other, same: false }];
  return first === void 0 ? [] : [{ finderModel, judgeModel: first, same: true }];
});
var isTier = (value) => TIERS2.includes(value);
var angleNumber = (key) => {
  const value = Number(key);
  return Number.isInteger(value) && isAngle(value) ? value : void 0;
};

// src/review/review-plan.ts
var isTestPath = createMatcher(["**/{test,tests,__tests__,_tests_}/**"]);
var isFixturePath = createMatcher(["**/{fixture,fixtures,__fixtures__,__snapshots__}/**", "**/*.snap"]);
var isMarkdown = createMatcher(["**/*.md"]);
var exclusionOf = (path2, root) => {
  if (isMarkdown(path2)) return "markdown";
  if (isLockfile(path2)) return "lockfile";
  if (isTestFile(path2, root === void 0 ? void 0 : fileSource(root, path2)) || isTestPath(path2)) return "test";
  if (isFixturePath(path2)) return "fixture";
  return void 0;
};
var audienceOf = (path2, root, testPaths = []) => {
  const exclusion = exclusionOf(path2, root);
  if (exclusion === "markdown") return "docs";
  if (exclusion !== void 0 || testPaths.length > 0 && createMatcher([...testPaths])(path2)) return "tests";
  return "code";
};
var isTestStat = (path2, root, testPaths) => {
  const exclusion = exclusionOf(path2, root);
  return exclusion === "test" || exclusion === void 0 && audienceOf(path2, root, testPaths) === "tests";
};
var audiencesFor = (angles) => [
  "code",
  ...angles.includes(16) ? ["tests"] : [],
  ...angles.includes(15) ? ["docs"] : []
];
var parseNumstat = (output) => {
  const tokens = output.split("\0");
  const stats = [];
  for (let index = 0; index < tokens.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[index] ?? "");
    if (match === null) continue;
    let path2 = match[3] ?? "";
    if (path2 === "") {
      path2 = tokens[index + 2] ?? "";
      index += 2;
    }
    const count = (value) => value === void 0 || value === "-" ? 0 : Number(value);
    stats.push({ path: path2, added: count(match[1]), deleted: count(match[2]) });
  }
  return stats;
};
var countLines = (stats, root) => {
  const excluded = { test: 0, fixture: 0, markdown: 0, lockfile: 0 };
  let lines2 = 0;
  let counted = 0;
  for (const stat of stats) {
    const exclusion = exclusionOf(stat.path, root);
    if (exclusion !== void 0) {
      excluded[exclusion]++;
      continue;
    }
    lines2 += stat.added + stat.deleted;
    counted++;
  }
  return { lines: lines2, counted, excluded };
};
var PROJECT_KEYS = ["$schema", "iterationsMemory", "discover", "review", "severity", "route", "angles", "tiers", "maxParallel", "layout", "testPaths", "partitions"];
var readPolicy = (validator, value) => {
  const text3 = validator.string(value, "$.partitions");
  if (text3 === void 0) return void 0;
  if (text3.trim() === "") return validator.report("$.partitions", "expected a non-empty text");
  return text3.trim();
};
var SETTING_KEYS = ["enabled", "severityCeiling"];
var PROJECT_ANGLE_KEYS = [...SETTING_KEYS, "file", "kind"];
var readSettings = (validator, settings, path2) => {
  const parsed = {};
  if (settings["enabled"] !== void 0) {
    if (typeof settings["enabled"] === "boolean") parsed.enabled = settings["enabled"];
    else validator.report(childPath(path2, "enabled"), "expected a boolean");
  }
  if (settings["severityCeiling"] !== void 0) {
    const ceiling = validator.oneOf(settings["severityCeiling"], childPath(path2, "severityCeiling"), CEILINGS);
    if (ceiling !== void 0) parsed.severityCeiling = ceiling;
  }
  return parsed;
};
var readProjectAngle = (validator, name, entry, path2) => {
  const settings = validator.object(entry, path2, PROJECT_ANGLE_KEYS);
  if (settings === void 0) return void 0;
  const file = validator.string(settings["file"], childPath(path2, "file"));
  const kind = validator.oneOf(settings["kind"], childPath(path2, "kind"), PROJECT_ANGLE_KINDS);
  const parsed = readSettings(validator, settings, path2);
  return file === void 0 || kind === void 0 ? void 0 : { name, file, kind, ...parsed };
};
var readAngles = (validator, value) => {
  const object = validator.object(value, "$.angles", void 0);
  const angles = {};
  const projectAngles = [];
  for (const [key, entry] of Object.entries(object ?? {})) {
    const path2 = childPath("$.angles", key);
    const angle = angleNumber(key);
    if (angle === void 0 && PROJECT_ANGLE_NAME.test(key)) {
      const parsed = readProjectAngle(validator, key, entry, path2);
      if (parsed !== void 0) projectAngles.push(parsed);
      continue;
    }
    if (angle === void 0 && REMOVED_ANGLES.includes(Number(key))) continue;
    if (angle === void 0) {
      validator.report(path2, `expected an angle number of ${ANGLES.join(", ")} or a project angle name`);
      continue;
    }
    const settings = validator.object(entry, path2, SETTING_KEYS);
    if (settings !== void 0) angles[angle] = readSettings(validator, settings, path2);
  }
  return { angles, projectAngles };
};
var readGrades = (validator, value) => {
  const object = validator.object(value, "$.tiers", [...GRADE_KEYS, ...REMOVED_GRADE_KEYS]);
  if (object === void 0) return {};
  const grades = {};
  for (const [key, entry] of Object.entries(object)) {
    if (REMOVED_GRADE_KEYS.includes(key)) continue;
    const path2 = childPath("$.tiers", key);
    const grade = validator.object(entry, path2, ["tier", "effort"]);
    if (grade === void 0) continue;
    const tier = validator.string(grade["tier"], childPath(path2, "tier"));
    const effort = validator.oneOf(grade["effort"], childPath(path2, "effort"), EFFORTS2);
    if (tier !== void 0 && !isTier(tier)) validator.report(childPath(path2, "tier"), "expected one of deep, standard, fast");
    if (tier !== void 0 && isTier(tier) && effort !== void 0) grades[key] = { tier, effort };
  }
  return grades;
};
var parseProjectConfig = (text3, label) => {
  const validator = new Validator();
  const root = validator.object(parseJsonc(text3), "$", PROJECT_KEYS);
  const { angles, projectAngles } = root?.["angles"] === void 0 ? { angles: {}, projectAngles: [] } : readAngles(validator, root["angles"]);
  const grades = root?.["tiers"] === void 0 ? {} : readGrades(validator, root["tiers"]);
  const maxParallel = root?.["maxParallel"] === void 0 ? MAX_PARALLEL : validator.integer(root["maxParallel"], "$.maxParallel", 1);
  const layout = root?.["layout"] === void 0 ? void 0 : validator.oneOf(root["layout"], "$.layout", LAYOUTS);
  const testPaths = root?.["testPaths"] === void 0 ? [] : validator.strings(root["testPaths"], "$.testPaths");
  const partitions = root?.["partitions"] === void 0 || root["partitions"] === null ? void 0 : readPolicy(validator, root["partitions"]);
  if (validator.errors.length > 0) throw new Error(`${label}: ${validator.errors.join("; ")}`);
  return { layout, angles, projectAngles, grades, maxParallel: maxParallel ?? MAX_PARALLEL, testPaths: testPaths ?? [], partitions };
};
var loadProjectConfig = (root) => {
  const file = projectConfigFile(root);
  if (file === void 0) return void 0;
  const label = file.root === root ? `.jig/${PROJECT_CONFIG}` : `${toSlash(file.root)}/.jig/${PROJECT_CONFIG}`;
  const config = parseProjectConfig(readFileSync30(file.path, "utf8"), label);
  const missing = config.projectAngles.filter((angle) => !existsSync16(join33(file.root, angle.file)));
  if (missing.length > 0) {
    throw new Error(`${label}: ${missing.map((angle) => `${childPath(childPath("$.angles", angle.name), "file")}: ${angle.file} not found under the repository root`).join("; ")}`);
  }
  return { label, config: { ...config, projectAngles: config.projectAngles.map((angle) => ({ ...angle, file: toSlash(join33(file.root, angle.file)) })) } };
};
var firstLine3 = (text3) => text3.split("\n")[0]?.trim() || void 0;
var gitLine = (args, root) => {
  const result = git(args, root);
  return result.ok ? firstLine3(result.stdout) : void 0;
};
var pathspec = (paths) => paths.length > 0 ? ["--", ...paths] : [];
var diffStats = (root, mergeBase, paths) => {
  const result = git(["diff", "--numstat", "-M", "-z", mergeBase, ...pathspec(paths)], root);
  if (!result.ok) throw new Error(`git diff --numstat failed: ${result.stderr.trim()}`);
  return parseNumstat(result.stdout);
};
var resolveBase = (root, given, command = "review-plan", paths = []) => {
  const candidates = given ? [{ ref: given, source: "argument" }] : [
    { ref: gitLine(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], root), source: "upstream" },
    { ref: gitLine(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root), source: "origin-head" }
  ];
  let last;
  for (const { ref, source } of candidates) {
    if (ref === void 0) continue;
    const mergeBase = gitLine(["merge-base", ref, "HEAD"], root);
    if (mergeBase === void 0) {
      if (source === "argument") throw new Error(`no merge base between ${ref} and HEAD`);
      continue;
    }
    last = { ref, mergeBase, source, stats: diffStats(root, mergeBase, paths) };
    if (last.stats.length > 0) return last;
  }
  if (last !== void 0) return last;
  throw new Error(`no base: pass the merge request target, e.g. jig ${command} origin/main`);
};
var addedNewSourceFiles = (root, mergeBase, paths) => {
  const result = git(["diff", "--name-only", "--diff-filter=A", "-M", "-z", mergeBase, ...pathspec(paths)], root);
  if (!result.ok) return 0;
  return result.stdout.split("\0").filter((path2) => path2 !== "" && exclusionOf(path2, root) === void 0).length;
};
var untrackedCount = (root, paths) => (gitStatus(root, paths) ?? []).filter((entry) => entry.status === "??").length;
var shellWord = (word) => /^[\w./:@=+-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
var diffCommand = (mergeBase, paths) => ["git", "diff", mergeBase, ...pathspec(paths)].map(shellWord).join(" ");
var LAYOUT_ENV = "JIG_REVIEW_LAYOUT";
var DEFAULT_LAYOUT = "auto";
var resolveLayout = (argument, env, config) => {
  const given = [
    [argument, "argument", "--layout"],
    [env, "env", LAYOUT_ENV]
  ];
  for (const [value, source, label] of given) {
    if (value === void 0 || value === "") continue;
    if (!isLayout(value)) throw new Error(`unknown layout ${value} in ${label}; expected one of ${LAYOUTS.join(", ")}`);
    return { name: value, source };
  }
  return config === void 0 ? { name: DEFAULT_LAYOUT, source: "default" } : { name: config, source: "config" };
};
var angleAtoms = (text3) => {
  const header = /\*\*Atoms?:\*\*([^\n]*)/.exec(text3)?.[1] ?? "";
  return [...header.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "").filter((name) => name !== "");
};
var readsFor = (pluginRoot, angles, projectFiles2 = []) => {
  const angleDir = join33(pluginRoot, "skills", "jig-review", "angles");
  const atomDir = join33(pluginRoot, "atoms");
  const names = existsSync16(angleDir) ? readdirSync16(angleDir) : [];
  const files = [
    ...angles.flatMap((angle) => names.filter((name) => name.startsWith(`${angle}.`) && name.endsWith(".md")).map((name) => join33(angleDir, name))),
    ...projectFiles2
  ];
  const atoms = [...new Set(files.flatMap((file) => angleAtoms(readFileSync30(file, "utf8"))))].map((name) => join33(atomDir, `${name}.md`)).filter((path2) => existsSync16(path2));
  return { angles: files.map(toSlash), atoms: atoms.map(toSlash), diff: [], rules: [] };
};
var angleList = (angles) => angles.join("+");
var gradeText = (grade, models) => {
  const model = models?.[grade.tier]?.[0];
  return `${grade.tier}/${grade.effort}${model === void 0 ? "" : ` ${model}`}`;
};
var SELECTOR_NOTES = {
  argument: "",
  default: " (default)"
};
var LAYOUT_SOURCE_TEXT = { argument: "--layout", env: LAYOUT_ENV, config: `.jig/${PROJECT_CONFIG}`, default: "default" };
var LAYOUT_TEXT = {
  lean: "a fresh behavior finder per partition (plus a test-reviewer when the partition has changed tests, a ux finder when it has changed UI files, a conventions finder when the project adds convention angles); you judge, a deep judge only for Important",
  solo: "a fresh behavior finder per partition (plus a test-reviewer when the partition has changed tests, a ux finder when it has changed UI files, a conventions finder when the project adds convention angles) proves its own candidates; no judge subagents"
};
var layoutLine = (report) => {
  const { name, source } = report.layout;
  const resolved = report.plan.layout;
  const chosen = name === "auto" ? `auto \u2192 ${resolved}` : resolved;
  return `layout: ${chosen}${source === "default" ? " (default)" : ` (from ${LAYOUT_SOURCE_TEXT[source]})`} \xB7 ${LAYOUT_TEXT[resolved]}`;
};
var stateText = (report) => {
  if (report.state) return "on (merge request known: state file, comment texts, re-review)";
  if (report.mode === "pre-mr") return "off (mode pre-mr: track progress in your todo list; run files in the OS temp dir)";
  return "off (no merge request or --no-state: no state file, no comment texts, no posting; run files in the OS temp dir)";
};
var diffLine = (reads) => reads === void 0 || reads.diff.length === 0 ? [] : [`  diff: ${reads.diff.join(" ")}`];
var angleReadLines = (reads) => reads === void 0 ? [] : [`  read: ${reads.angles.join(" ")}`, ...reads.atoms.length > 0 ? [`  atoms: ${reads.atoms.join(" ")}`] : []];
var rulesLine = (reads) => reads === void 0 || reads.rules.length === 0 ? [] : [`  rules: ${reads.rules.join(" ")}`];
var RUNNER_LINE = "runner: the review runs in one review runner, never in the session that asked for it: that session spawns role review-runner with this run and waits for its return; a review runner (a review cycle's, or one spawned so) goes on";
var MAX_DIRS = 3;
var partitionText = (partition) => {
  if (partition === void 0 || partition.files.length === 0) return "every file";
  const more = partition.dirs.length - MAX_DIRS;
  const dirs = `${partition.dirs.slice(0, MAX_DIRS).join(", ")}${more > 0 ? ` +${more} more` : ""}`;
  return `${partition.files.length} file${partition.files.length === 1 ? "" : "s"}, ${partition.lines} lines, under ${dirs}`;
};
var KIND_TEXT = {
  behavior: "bugs, state, wire contracts, spec",
  conventions: "the project angles of kind conventions; reads its rules",
  tests: "wrong and redundant tests by atom tests; role test-reviewer, reports only, never deletes",
  ux: "what the user of the changed UI meets with realistic data, by atom ux; traces each value to its box owner, wrappers included"
};
var policyText = (policy) => policy.split("\n").join("\n  ");
var groupingLines = (report) => {
  const grouping = report.grouping;
  if (grouping === null || report.policy === null) return [];
  return [
    `partition policy (${report.config ?? `.jig/${PROJECT_CONFIG}`}): ${policyText(report.policy)}`,
    `group the code files below by the policy: each in exactly one group, at most ${report.maxParallel} groups; tests and documents join their code themselves. Then run this command again with the same arguments plus one --partition <name>=<path>,<path> per group (name: lowercase letters, digits, dashes; a path ending in / takes every changed file under it). That run is the plan: its steps, finders and diff parts; this one has none`,
    "code files (counted lines, path):",
    ...grouping.files.map((file) => `  ${file.lines}	${file.path}`),
    ...grouping.imports.length === 0 ? ["imports between them: none"] : ["imports between them:", ...grouping.imports.map(([from, to]) => `  ${from} \u2192 ${to}`)]
  ];
};
var finderLines = (report) => {
  const { plan } = report;
  const byName = new Map(plan.partitions.map((partition) => [partition.name, partition]));
  const lines2 = [];
  const by = plan.grouping === "groups" ? "by --partition" : "by imports between files and shared directories";
  if (plan.finders.length > 0) lines2.push(`partitions: ${plan.partitions.length}, ${by}; a finder traces a link into another partition in the code itself`);
  if (plan.finders.length > 0 && report.policy !== null) lines2.push(`partition policy (to every finder, brief item 7): ${policyText(report.policy)}`);
  for (const finder of plan.finders) {
    lines2.push(
      `finder ${finder.name}: partition ${finder.partition} (${partitionText(byName.get(finder.partition))}) \xB7 ${finder.kind}${finder.role === "finder" ? "" : ` (role ${finder.role})`}: angles ${angleList([...finder.angles, ...finder.projectAngles])} \xB7 ${gradeText(finder, report.models)} \xB7 fresh, never a fork`
    );
    lines2.push(...diffLine(report.reads[finder.name]), ...rulesLine(report.reads[finder.name]));
  }
  for (const kind of FINDER_KINDS) {
    const first = plan.finders.find((finder) => finder.kind === kind);
    if (first !== void 0) lines2.push(`${kind} finders (${KIND_TEXT[kind]}) read:`, ...angleReadLines(report.reads[first.name]));
  }
  return lines2;
};
var formatReport = (report) => {
  const { plan, models } = report;
  const excluded = Object.entries(report.files.excluded).filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`);
  const lines2 = [
    `base: ${report.base.ref} (merge base ${report.base.mergeBase.slice(0, 8)}, from ${report.base.source})`,
    `lines: ${plan.lines} in ${report.files.counted} files${report.scope.length > 0 ? ` (scope: ${report.scope.join(" ")})` : ""}${excluded.length > 0 ? `; excluded: ${excluded.join(", ")}` : ""}${report.files.untracked > 0 ? `; untracked files not counted: ${report.files.untracked} (git add -N to count them)` : ""}`,
    `diff: ${report.diff}`,
    ...report.diffFiles === null ? [] : [
      `diff files: ${report.diffFiles.index} \xB7 ${report.diffFiles.parts.length} part${report.diffFiles.parts.length === 1 ? "" : "s"} of at most ${DIFF_PART_MAX_LINES} lines, each file whole, split by partition, then into code, tests and docs; each reader reads only the parts under its \`diff:\`, never the diff command`
    ],
    `run: ${report.run} (the checkpoints of this run carry it; another run never reuses them)`,
    `partitions: ${report.formula}`,
    layoutLine(report),
    `shape: tests ${report.shape.tests ? "yes" : "no"} \xB7 ui ${report.shape.ui ? "yes" : "no"} \xB7 new source files ${report.shape.newSourceFiles} \xB7 spec ${report.shape.spec ? "yes" : "no"}`,
    `selector: ${plan.selection.input}${plan.selection.tokens.length > 0 && plan.selection.input !== plan.selection.tokens.join(",") ? ` \u2192 ${plan.selection.tokens.join(",")}` : ""}${SELECTOR_NOTES[plan.selection.source]}`,
    `config: ${report.config ?? "default"} \xB7 agent: ${report.agent} \xB7 max parallel subagents: ${report.maxParallel}`,
    `mode: ${report.mode} \xB7 state: ${stateText(report)}`,
    ...report.rereview === null ? [] : [`re-review scope: ${rereviewText(report.rereview)}`],
    ...report.estimate === null ? [] : [estimateLine(report.estimate)],
    ""
  ];
  if (plan.path === "none") lines2.push("finders: none (nothing to review)");
  if (plan.path === "subagents") lines2.push(RUNNER_LINE);
  if (plan.grouping === "pending") return [...lines2, ...groupingLines(report)].join("\n");
  lines2.push(...finderLines(report));
  if (plan.deepening !== void 0) lines2.push(`deepening: ${gradeText(plan.deepening, models)}`);
  if (plan.judging === "self") {
    lines2.push("verify: no judge subagents; every finder proves its own candidates, you dedup and apply the verdicts");
  } else {
    lines2.push(`verify: you judge every candidate by the gate files; one judge subagent for the Important ones, ${plan.verify.tier}/${plan.verify.effort}`);
    for (const judge2 of report.judge) {
      lines2.push(`  candidates from ${judge2.finderModel} \u2192 judge ${judge2.judgeModel}${judge2.same ? " (same model: one model in the tier)" : ""}`);
    }
    if (report.judge.length === 0) lines2.push(`  judge: a ${plan.verify.tier} model other than the finder's`);
  }
  lines2.push(`outcome check: ${gradeText(plan.outcome, models)} \xB7 composer: ${gradeText(plan.composer, models)}`);
  if (plan.skipped.length > 0) {
    lines2.push(`skipped angles: ${plan.skipped.map((skip) => `${skip.angle} (${skip.reason})`).join(", ")}`);
  }
  lines2.push(`output filter: ${plan.outputTokens.length > 0 ? plan.outputTokens.join(",") : "all findings"}`);
  lines2.push("", "steps for this run (read each when you reach it; no other step file applies):");
  lines2.push(...report.steps.map((step) => `  ${report.skill}/${step.file}${step.when === void 0 ? "" : ` \xB7 ${step.when}`}`));
  return lines2.join("\n");
};
var scopeOf = (root, base, paths, statePath2) => {
  if (statePath2 === void 0) return { stats: base.stats, diffBase: base.mergeBase, paths: [...paths], diffPaths: [...paths], rereview: null };
  const state = readReviewedState(statePath2);
  const rereview = rereviewScope(root, state, base.mergeBase);
  const diffBase = rereview.kind === "patches" && state.last_reviewed_sha !== void 0 ? state.last_reviewed_sha : base.mergeBase;
  const scoped = rereview.files.map((file) => file.path);
  const renamedFrom = rereview.kind === "patches" ? rereview.renamed.filter((rename) => scoped.includes(rename.to)).map((rename) => rename.from) : [];
  return { stats: rereview.files, diffBase, paths: scoped, diffPaths: [...scoped, ...renamedFrom], rereview };
};
var rereviewText = (scope) => {
  if (scope.kind === "unchanged") return `unchanged: the merge request diff is the reviewed one (${scope.hash.slice(0, 12)}); only the developer's replies can have moved`;
  const files = scope.files.map((file) => `${file.path} +${file.added} -${file.deleted}`).join(", ");
  const counted = `${scope.files.length} of ${scope.total} files${files === "" ? "" : `: ${files}`}`;
  if (scope.kind === "full") return `full (${scope.reason}): ${counted}`;
  const renamed = scope.renamed.map((rename) => `${rename.from} \u2192 ${rename.to}`).join(", ");
  return `patches: ${counted}, the branch's own changes since the last review${renamed === "" ? "" : `; renamed since the last review: ${renamed}`}`;
};
var partitionInput = (stats, root, testPaths) => stats.filter((stat) => !isUnreviewed(stat.path)).map((stat) => {
  const kind = audienceOf(stat.path, root, testPaths);
  return { path: stat.path, kind, countedLines: kind === "code" ? stat.added + stat.deleted : 0 };
});
var newRunId = () => `${Date.now().toString(36)}-${randomBytes2(3).toString("hex")}`;
var reviewDirOf = (root, state) => state ? join33(ensureJigDir(listWorktrees(root)[0]?.path ?? root).runs, "review") : join33(tmpdir2(), "jig-review");
var formulaOf = (plan, lines2, policy) => {
  if (plan.grouping === "pending") return "by the project policy, not by lines: group the code files below, then run again with --partition";
  if (plan.grouping === "groups") return `${plan.partitions.length} from --partition${policy ? ", grouped by the project policy" : ""}; two finders each`;
  return `ceil(${lines2}/${LINES_PER_FINDER}) = ${Math.ceil(lines2 / LINES_PER_FINDER)}, max ${MAX_FINDERS} \u2192 N = ${plan.n}, at least 1; two finders each`;
};
var buildReport = (root, options) => {
  const base = resolveBase(root, options.base, "review-plan", options.paths ?? []);
  const { stats, diffBase, paths, diffPaths, rereview } = scopeOf(root, base, options.paths ?? [], options.statePath);
  const isEmpty = rereview !== null && stats.length === 0;
  const untracked = isEmpty ? 0 : untrackedCount(root, paths);
  if (rereview === null) requireScopedChanges(paths, stats.length + untracked, base.ref);
  const { lines: lines2, counted, excluded } = countLines(stats, root);
  const project = loadProjectConfig(root);
  const testPaths = project?.config.testPaths ?? [];
  const shape = {
    tests: stats.some((stat) => stat.added > 0 && isTestStat(stat.path, root, testPaths)),
    ui: stats.some((stat) => !isTestStat(stat.path, root, testPaths) && isUiFile(stat.path)),
    newSourceFiles: isEmpty ? 0 : addedNewSourceFiles(root, diffBase, diffPaths),
    spec: options.spec
  };
  const layout = resolveLayout(options.layout, options.layoutEnv, project?.config.layout);
  const files = partitionInput(stats, root, testPaths);
  const edges = importEdges(
    root,
    files.filter((file) => file.kind !== "docs").map((file) => file.path)
  );
  const maxParallel = project?.config.maxParallel ?? MAX_PARALLEL;
  const policy = project?.config.partitions;
  const groups = options.partitions === void 0 ? void 0 : resolveGroups(options.partitions, files, maxParallel);
  const plan = planReview({
    lines: lines2,
    shape,
    layout: layout.name,
    selector: options.selector,
    angles: project?.config.angles ?? {},
    projectAngles: project?.config.projectAngles ?? [],
    grades: project?.config.grades ?? {},
    rereview: options.rereview === true || rereview !== null,
    files,
    edges,
    groups,
    policy: policy !== void 0
  });
  const pending = plan.grouping === "pending";
  const code = new Set(files.filter((file) => file.kind === "code").map((file) => file.path));
  const loaded = loadUserConfig();
  if (loaded.error !== void 0) throw new Error(`${loaded.label}: ${loaded.error}`);
  const agent = detectAgent(options.agent);
  const models = resolveTiers(agent, loaded.config);
  const finderModels = Object.fromEntries(plan.finders.map((finder) => [finder.name, models?.[finder.tier]?.[0]]));
  const verifyModels = models?.[plan.verify.tier] ?? [];
  const usedModels = Object.values(finderModels).filter((model) => model !== void 0);
  const run3 = newRunId();
  const mode = options.mode ?? "review";
  const state = mode === "review" && options.mergeRequest === true && options.noState !== true;
  const pluginRoot = options.pluginRoot ?? resolvePluginRoot();
  const diffFiles = plan.path === "none" || pending ? null : writeDiffFiles(root, [diffBase, ...pathspec(diffPaths)], reviewDirOf(root, state), (path2) => audienceOf(path2, root, testPaths), plan.partitions);
  const partsOf = (partition, angles) => {
    if (diffFiles === null) return [];
    const own = partition === void 0 ? diffFiles.audiences : diffFiles.partitions[partition];
    return own === void 0 ? [] : audiencesFor(angles).flatMap((audience) => own[audience]);
  };
  const ruleInputs = ruleDocuments(root, stats.map((stat) => stat.path), process.env);
  const filesOf = (partition) => plan.partitions.filter((own) => partition === void 0 || own.name === partition).flatMap((own) => own.files);
  const projectFiles2 = (kind) => plan.projectAngles.filter((angle) => angle.kind === kind).map((angle) => angle.file);
  const readsOf = (partition, kind, angles) => ({
    ...readsFor(pluginRoot, angles, projectFiles2(kind)),
    diff: partsOf(partition, angles),
    rules: kind === "conventions" ? rulesFor2(ruleInputs, filesOf(partition)) : []
  });
  const readers = plan.finders.map((finder) => [finder.name, readsOf(finder.partition, finder.kind, finder.angles)]);
  const byPartition = new Map(plan.partitions.map((partition) => [partition.name, partition.lines]));
  const finderReaders = plan.finders.map((finder) => finderReader(byPartition.get(finder.partition) ?? 0, finderModels[finder.name]));
  return {
    base: { ref: base.ref, mergeBase: base.mergeBase, source: base.source },
    files: { counted, excluded, untracked },
    scope: [...paths],
    diff: diffCommand(diffBase, diffPaths),
    diffFiles,
    formula: formulaOf(plan, lines2, policy !== void 0),
    policy: policy ?? null,
    grouping: pending ? {
      files: files.filter((file) => file.kind === "code").map((file) => ({ path: file.path, lines: file.countedLines })),
      imports: edges.filter(([from, to]) => code.has(from) && code.has(to))
    } : null,
    layout,
    shape,
    plan,
    mode,
    state,
    rereview,
    skill: toSlash(join33(pluginRoot, "skills", "jig-review")),
    steps: stepsFor(plan, mode, state),
    reads: Object.fromEntries(readers),
    maxParallel,
    config: project?.label ?? null,
    agent,
    models,
    finderModels,
    judge: plan.judging === "self" ? [] : judgeModels(usedModels, verifyModels),
    run: run3,
    estimate: plan.path === "none" || pending ? null : estimateReview(finderReaders, { ...DEFAULT_PRICES, ...loaded.config.prices })
  };
};
var isMode = (value) => MODES.includes(value);
var USAGE4 = "usage: jig review-plan [<base>] [--selector full|quick|auto|<tokens>] [--layout auto|lean|solo] [--spec] [--mode review|pre-mr] [--mr] [--no-state] [--rereview] [--state <path>] [--partition <name>=<path>,<dir>/...]... [--agent <id>] [--json] [-- <pathspec>...]";
var parseGroupSpec = (text3) => {
  const separator = text3.indexOf("=");
  const name = separator === -1 ? "" : text3.slice(0, separator).trim();
  if (!GROUP_NAME.test(name)) throw new Error(`--partition ${text3}: expected <name>=<path>,<path> with a name of lowercase letters, digits and dashes`);
  const entries = text3.slice(separator + 1).split(",").map((entry) => toSlash(entry.trim()).replace(/^\.\//, "")).filter((entry) => entry !== "");
  return { name, entries };
};
var splitPathspec = (args) => {
  const separator = args.indexOf("--");
  return separator === -1 ? { options: [...args], paths: void 0 } : { options: args.slice(0, separator), paths: args.slice(separator + 1) };
};
var toRootPaths = (root, cwd, paths) => {
  const from = realPath(cwd);
  return paths.map((path2) => {
    if (path2.startsWith(":")) return path2;
    const fromRoot = toSlash(relative7(realPath(root), resolve15(from, path2)));
    if (fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute7(fromRoot)) throw new Error(`${path2} is outside the repository`);
    return fromRoot === "" ? "." : fromRoot;
  });
};
var requireScopedChanges = (paths, changed, baseRef) => {
  if (paths.length > 0 && changed === 0) throw new Error(`nothing changed against ${baseRef} under ${paths.join(" ")}; paths after -- are relative to the current directory`);
};
var runReviewPlan = (args) => {
  const split = splitPathspec(args);
  if (split.paths?.length === 0) throw new Error(`no path after --; ${USAGE4}`);
  const { values, positionals } = parseArgs2({
    args: split.options,
    allowPositionals: true,
    strict: true,
    options: {
      selector: { type: "string" },
      layout: { type: "string" },
      spec: { type: "boolean" },
      agent: { type: "string" },
      mode: { type: "string" },
      mr: { type: "boolean" },
      "no-state": { type: "boolean" },
      rereview: { type: "boolean" },
      state: { type: "string" },
      partition: { type: "string", multiple: true },
      json: { type: "boolean" }
    }
  });
  if (positionals.length > 1) throw new Error(USAGE4);
  const mode = values.mode ?? "review";
  if (!isMode(mode)) throw new Error(`unknown mode ${mode}; ${USAGE4}`);
  const root = gitToplevel(process.cwd());
  if (root === void 0) throw new Error("not inside a git repository");
  const paths = toRootPaths(root, process.cwd(), split.paths ?? []);
  const report = buildReport(root, {
    base: positionals[0],
    selector: values.selector,
    layout: values.layout,
    layoutEnv: process.env[LAYOUT_ENV],
    spec: values.spec === true,
    agent: values.agent,
    mode,
    mergeRequest: values.mr === true,
    noState: values["no-state"] === true,
    rereview: values.rereview === true,
    statePath: values.state,
    paths,
    partitions: values.partition?.map(parseGroupSpec)
  });
  process.stdout.write(`${values.json ? JSON.stringify(report) : formatReport(report)}
`);
  return 0;
};

// src/pre-mr/pre-mr.ts
var VERIFY_LEVELS = ["unit-test", "type-check", "none"];
var EXIT_MISSING = 1;
var EXIT_USAGE4 = 2;
var CLI_SESSION = "cli";
var MAX_BUFFER2 = 64 * 1024 * 1024;
var PRE_MR_USAGE = 'usage: jig pre-mr [<base>] [-- <pathspec>...] |jig pre-mr proof "<command>" | jig pre-mr bug-bash "<result>"';
var SKIP_USAGE = `usage: jig skip-verify --level ${VERIFY_LEVELS.join("|")} --why "<reason>"`;
var UsageError = class extends Error {
};
var isUsageError = (error) => error instanceof UsageError || error instanceof TypeError && "code" in error && typeof error.code === "string" && error.code.startsWith("ERR_PARSE_ARGS");
var isVerifyLevel = (value) => VERIFY_LEVELS.some((level) => level === value);
var gitLine2 = (args, cwd) => {
  const result = git(args, cwd);
  return result.ok ? result.stdout.split("\n")[0]?.trim() || void 0 : void 0;
};
var requireRoot = (cwd) => {
  const root = gitToplevel(cwd);
  if (root === void 0) throw new Error("not inside a git repository");
  return root;
};
var workingTree = (root) => {
  const dir2 = mkdtempSync(join34(tmpdir3(), "jig-pre-mr-"));
  try {
    const index = join34(dir2, "index");
    const current = gitLine2(["rev-parse", "--git-path", "index"], root);
    if (current !== void 0 && existsSync17(resolve16(root, current))) copyFileSync3(resolve16(root, current), index);
    const withIndex = (args) => spawnSync5("git", args, { cwd: root, env: { ...process.env, GIT_INDEX_FILE: index }, encoding: "utf8", windowsHide: true, maxBuffer: MAX_BUFFER2 });
    const added = withIndex(["add", "-A"]);
    if (added.status !== 0) throw new Error(`git add -A into a temporary index failed: ${String(added.stderr).trim()}`);
    const tree = withIndex(["write-tree"]);
    const sha = String(tree.stdout).trim();
    if (tree.status !== 0 || sha === "") throw new Error(`git write-tree failed: ${String(tree.stderr).trim()}`);
    return sha;
  } finally {
    rmSync9(dir2, { recursive: true, force: true });
  }
};
var snapshot2 = (root) => {
  const head = gitLine2(["rev-parse", "HEAD"], root);
  if (head === void 0) throw new Error("HEAD has no commit yet");
  return { head, tree: workingTree(root) };
};
var normalizeCommand = (command) => command.replace(/["']/g, "").replace(/[^\s;&|]*[\\/](?=[^\s\\/;&|]+(?:\s|$))/g, "").replace(/\.(?:cmd|exe|bat|ps1)(?=\s|$)/gi, "");
var provenKinds = (command) => {
  const normalized = normalizeCommand(command);
  return PROOFS2.map((check2) => ({ check: check2.name, kinds: check2.proves(normalized) })).filter((entry) => entry.kinds.length > 0);
};
var configuredChecks = (root) => {
  const { proofs } = loadConfig(root);
  return PROOFS2.filter((check2) => enabledSetting(proofs, check2.name) !== void 0);
};
var requirements = (root, files, checks = PROOFS2) => PROOF_KINDS.map((kind) => ({
  kind,
  files: files.filter((file) => checks.some((check2) => check2.requires(file, fileSource(root, file)).includes(kind)))
})).filter(
  (requirement) => requirement.files.length > 0
);
var hintFor = (kind) => PROOFS2.map((check2) => check2.hints[kind]).find((hint) => hint !== void 0) ?? kind;
var record = (root, entry) => appendJournal(root, { session: CLI_SESSION, agent: MAIN_AGENT, ...entry });
var mirror = (root, decision, fields) => {
  try {
    logToActiveJournal(root, { phase: "verify", decision, ...fields });
  } catch {
    return;
  }
};
var recordsOf = (root) => {
  let paths;
  try {
    paths = listWorktrees(root).map((worktree) => worktree.path);
  } catch {
    paths = [];
  }
  const seen = /* @__PURE__ */ new Set();
  const records = [];
  for (const path2 of [root, ...paths]) {
    const key = resolve16(path2).replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(...readJournal(path2).filter((entry) => entry.kind === "proof" || entry.kind === "bug-bash" || entry.kind === "skip-verify"));
  }
  return records.sort((left, right) => right.ts.localeCompare(left.ts));
};
var changedPaths2 = (root, older, newer) => {
  const result = git(["diff", "--name-only", "--no-renames", "-z", older, newer], root);
  return result.ok ? new Set(result.stdout.split("\0").filter(Boolean)) : void 0;
};
var branchCommits = (root, mergeBase, head) => {
  const result = git(["rev-list", `${mergeBase}..${head}`], root);
  const commits = new Set(result.ok ? result.stdout.split("\n").map((line) => line.trim()).filter(Boolean) : []);
  commits.add(head);
  return commits;
};
var evaluate = ({ root, mergeBase, head, tree, files, records, checks }) => {
  const needed = requirements(root, files, checks);
  if (needed.length === 0) {
    const ui = requirements(root, files).flatMap((requirement) => requirement.files);
    return ui.length === 0 ? { type: "no-ui" } : { type: "no-proof-tool", files: [...new Set(ui)] };
  }
  const diffs = /* @__PURE__ */ new Map();
  const editedSince = (entry) => {
    const from = entry.tree ?? "";
    if (!diffs.has(from)) diffs.set(from, from === "" ? void 0 : changedPaths2(root, from, tree));
    return diffs.get(from);
  };
  const covers4 = (entry, paths) => {
    const edited = editedSince(entry);
    return edited !== void 0 && paths.every((path2) => !edited.has(path2));
  };
  const gaps = [];
  const proofs = [];
  for (const { kind, files: kindFiles } of needed) {
    const candidates = records.filter((entry) => entry.kind === "proof" && (entry.rule ?? "").split(",").includes(kind));
    const proof2 = candidates.find((entry) => covers4(entry, kindFiles));
    if (proof2 !== void 0) {
      proofs.push(proof2);
      continue;
    }
    const latest2 = candidates[0];
    gaps.push({ what: "proof", kind, files: kindFiles, hint: hintFor(kind), ...latest2 === void 0 ? {} : { latest: latest2 } });
  }
  const commits = branchCommits(root, mergeBase, head);
  const bugBash2 = records.find((entry) => entry.kind === "bug-bash" && entry.head !== void 0 && commits.has(entry.head));
  if (bugBash2 === void 0) gaps.push({ what: "bug-bash" });
  if (gaps.length === 0 && bugBash2 !== void 0) return { type: "proven", proofs, bugBash: bugBash2 };
  const skip = records.find((entry) => entry.kind === "skip-verify" && entry.tree !== void 0 && editedSince(entry)?.size === 0);
  if (skip === void 0) return { type: "missing", gaps };
  return { type: "skipped", skip, gaps, ...bugBash2 === void 0 ? {} : { bugBash: bugBash2 } };
};
var untrackedPaths = (root, paths) => (gitStatus(root, paths) ?? []).filter((entry) => entry.status === "??").map((entry) => entry.path);
var levelLine = (skip) => `Verification level: ${skip.rule ?? "none"} (${skip.message ?? "no reason given"})`;
var fileList = (files) => {
  const shown = files.slice(0, 5).join(", ");
  return files.length > 5 ? `${shown} and ${files.length - 5} more` : shown;
};
var describeGap = (gap) => {
  if (gap.what === "bug-bash") return '- bug-bash: no record on this branch. Run flows/bug-bash.md on your diff, then: jig pre-mr bug-bash "<bugs found and fixed, what could not be tested>"';
  const state = gap.latest === void 0 ? "never proven" : `last proof at ${gap.latest.ts} (\`${gap.latest.message ?? ""}\`) predates edits`;
  return `- ${gap.kind}: ${state} for ${fileList(gap.files)}. Run: jig pre-mr proof "${gap.hint}"`;
};
var formatVerdict = (verdict2, baseLine) => {
  switch (verdict2.type) {
    case "no-ui":
      return [baseLine, "UI files: none", "Bug-bash: UI not touched", "Verification level: full"];
    case "no-proof-tool":
      return [
        baseLine,
        `UI files: ${fileList(verdict2.files)}; no UI proof tool in .jig/config.jsonc, UI not proven`,
        "Bug-bash: not run, no UI proof tool configured",
        "Verification level: no UI proof tool configured"
      ];
    case "proven":
      return [
        baseLine,
        ...[...new Set(verdict2.proofs)].map((proof2) => `proof: \`${proof2.message ?? ""}\` at ${proof2.ts}`),
        `Bug-bash: ${verdict2.bugBash.message ?? ""}`,
        "Verification level: full"
      ];
    case "skipped":
      return [
        baseLine,
        `not proven: ${verdict2.gaps.map((gap) => gap.what === "proof" ? gap.kind : gap.what).join(", ")}`,
        `Bug-bash: ${verdict2.bugBash?.message ?? "not run, verification skipped"}`,
        levelLine(verdict2.skip)
      ];
    case "missing":
      return [
        baseLine,
        "pre-mr: the branch touches UI files and lacks:",
        ...verdict2.gaps.map(describeGap),
        `The proof cannot run here: jig skip-verify --level ${VERIFY_LEVELS.join("|")} --why "<reason>"`
      ];
  }
};
var check = (args, ctx) => {
  const split = splitPathspec(args);
  if (split.paths?.length === 0) throw new UsageError(PRE_MR_USAGE);
  const { positionals } = parseArgs3({ args: split.options, allowPositionals: true, strict: true, options: {} });
  if (positionals.length > 1) throw new UsageError(PRE_MR_USAGE);
  const root = requireRoot(ctx.cwd);
  const paths = toRootPaths(root, ctx.cwd, split.paths ?? []);
  const base = resolveBase(root, positionals[0], "pre-mr", paths);
  const files = [.../* @__PURE__ */ new Set([...base.stats.map((stat) => stat.path), ...untrackedPaths(root, paths)])];
  requireScopedChanges(paths, files.length, base.ref);
  const { head, tree } = snapshot2(root);
  const verdict2 = evaluate({ root, mergeBase: base.mergeBase, head, tree, files, records: recordsOf(root), checks: configuredChecks(root) });
  const baseLine = `base: ${base.ref} (merge base ${base.mergeBase.slice(0, 8)}, from ${base.source})`;
  const lines2 = formatVerdict(verdict2, baseLine);
  if (verdict2.type === "missing") {
    ctx.io.err(`${lines2.join("\n")}
`);
    return EXIT_MISSING;
  }
  ctx.io.out(`${lines2.join("\n")}
`);
  return 0;
};
var textArgument = (args, usage2) => {
  const parts = args[0] === "--" ? args.slice(1) : args;
  const text3 = parts.join(" ").trim();
  if (text3 === "" || args[0] !== "--" && text3.startsWith("-")) throw new UsageError(usage2);
  return text3;
};
var proof = (args, ctx) => {
  const command = textArgument(args, `usage: jig pre-mr proof "<command>", e.g. jig pre-mr proof "${hintFor("behavior")}"`);
  const proven = provenKinds(command);
  if (proven.length === 0) {
    const hints = PROOF_KINDS.map(hintFor).join("`, `");
    throw new UsageError(`\`${command}\` proves nothing jig knows; proof commands: \`${hints}\``);
  }
  const root = requireRoot(ctx.cwd);
  ensureJigDir(root);
  const state = snapshot2(root);
  const code = ctx.exec(command, ctx.cwd);
  if (code !== 0) {
    ctx.io.err(`jig: \`${command}\` exited ${code}; no proof recorded
`);
    return code;
  }
  for (const { check: name, kinds } of proven) {
    const entry = record(root, { kind: "proof", tool: name, rule: kinds.join(","), message: command, ...state });
    mirror(root, `proof:${kinds.join(",")}`, { evidence: command, result: "passed" });
    ctx.io.out(`jig: recorded ${kinds.join(", ")} proof at ${entry.ts}
`);
  }
  return 0;
};
var bugBash = (args, ctx) => {
  const result = textArgument(args, 'usage: jig pre-mr bug-bash "<bugs found and fixed, what could not be tested and why>"');
  const root = requireRoot(ctx.cwd);
  ensureJigDir(root);
  const entry = record(root, { kind: "bug-bash", message: result, ...snapshot2(root) });
  mirror(root, "bug-bash", { result });
  ctx.io.out(`jig: recorded bug-bash at ${entry.ts}
`);
  return 0;
};
var withUsage = (run3, io) => {
  try {
    return run3();
  } catch (error) {
    if (!isUsageError(error)) throw error;
    io.err(`jig: ${error.message}
`);
    return EXIT_USAGE4;
  }
};
var preMr = (args, ctx) => withUsage(() => {
  const [sub, ...rest] = args;
  if (sub === "proof") return proof(rest, ctx);
  if (sub === "bug-bash") return bugBash(rest, ctx);
  return check(args, ctx);
}, ctx.io);
var skipVerify = (args, ctx) => withUsage(() => {
  const { values, positionals } = parseArgs3({ args, allowPositionals: true, strict: true, options: { level: { type: "string" }, why: { type: "string" } } });
  const why = values.why?.trim() ?? "";
  if (positionals.length > 0 || !isVerifyLevel(values.level) || why === "") throw new UsageError(SKIP_USAGE);
  const root = requireRoot(ctx.cwd);
  ensureJigDir(root);
  const entry = record(root, { kind: "skip-verify", rule: values.level, message: why, ...snapshot2(root) });
  mirror(root, `skip-verify:${values.level}`, { why });
  ctx.io.out(`${levelLine(entry)}
jig pre-mr passes with this level until the next edit
`);
  return 0;
}, ctx.io);
var shellExec = (command, cwd) => {
  const result = spawnSync5(command, { cwd, shell: true, stdio: "inherit", windowsHide: true });
  if (result.error !== void 0) {
    process.stderr.write(`jig: ${result.error.message}
`);
    return 1;
  }
  return result.status ?? 1;
};
var processIo = {
  out: (text3) => process.stdout.write(text3),
  err: (text3) => process.stderr.write(text3)
};
var runPreMr = (args) => preMr(args, { cwd: process.cwd(), io: processIo, exec: shellExec });
var runSkipVerify = (args) => skipVerify(args, { cwd: process.cwd(), io: processIo });

// src/review/cost.ts
import { appendFileSync as appendFileSync5, existsSync as existsSync18, mkdirSync as mkdirSync16, readdirSync as readdirSync17, readFileSync as readFileSync31, statSync as statSync14 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { basename as basename7, dirname as dirname15, join as join35 } from "node:path";
import { parseArgs as parseArgs4 } from "node:util";
var ROLES = ["runner", "finder", "judge", "deepener", "outcome", "poster", "other"];
var ROLE_PATTERNS = [
  ["runner", /^review\b/i],
  ["finder", /^finder\b/i],
  ["deepener", /^deepen/i],
  ["outcome", /^outcome\b/i],
  ["judge", /^(?:judge|verifier)\b/i],
  ["poster", /^post\b/i]
];
var emptyUsage = () => ({ input: 0, write5m: 0, write1h: 0, read: 0, output: 0 });
var addUsage = (into, from) => {
  into.input += from.input;
  into.write5m += from.write5m;
  into.write1h += from.write1h;
  into.read += from.read;
  into.output += from.output;
};
var dollarsOf = (usage2, price) => {
  if (price === void 0) return 0;
  const input = usage2.input + usage2.write5m * CACHE_MULTIPLIERS.write5m + usage2.write1h * CACHE_MULTIPLIERS.write1h + usage2.read * CACHE_MULTIPLIERS.read;
  return (input * price.input + usage2.output * price.output) / 1e6;
};
var cacheHit = (usage2) => {
  const total = usage2.input + usage2.write5m + usage2.write1h + usage2.read;
  return total === 0 ? 0 : usage2.read / total;
};
var toUsage = (raw) => {
  const created = raw.cache_creation_input_tokens ?? 0;
  const write5m = raw.cache_creation?.ephemeral_5m_input_tokens;
  const write1h = raw.cache_creation?.ephemeral_1h_input_tokens;
  const split = write5m !== void 0 || write1h !== void 0;
  return {
    input: raw.input_tokens ?? 0,
    write5m: split ? write5m ?? 0 : created,
    write1h: split ? write1h ?? 0 : 0,
    read: raw.cache_read_input_tokens ?? 0,
    output: raw.output_tokens ?? 0
  };
};
var parseEntry = (line) => {
  if (line.trim() === "") return void 0;
  try {
    return JSON.parse(line);
  } catch {
    return void 0;
  }
};
var messageIds = (text3) => {
  const ids = /* @__PURE__ */ new Set();
  for (const line of text3.split("\n")) {
    const id = parseEntry(line)?.message?.id;
    if (id !== void 0) ids.add(id);
  }
  return ids;
};
var readTranscript = (text3, inherited = /* @__PURE__ */ new Set()) => {
  const usageByMessageId = /* @__PURE__ */ new Map();
  let model = "";
  let firstTimestamp = "";
  let startedAt = "";
  for (const line of text3.split("\n")) {
    const entry = parseEntry(line);
    if (entry === void 0) continue;
    if (firstTimestamp === "" && typeof entry.timestamp === "string") firstTimestamp = entry.timestamp;
    const message = entry.message;
    if (message?.usage === void 0 || message.id !== void 0 && inherited.has(message.id)) continue;
    if (startedAt === "" && typeof entry.timestamp === "string") startedAt = entry.timestamp;
    if (typeof message.model === "string" && !message.model.startsWith("<")) model = message.model;
    usageByMessageId.set(message.id ?? entry.uuid ?? String(usageByMessageId.size), toUsage(message.usage));
  }
  const usage2 = emptyUsage();
  for (const each of usageByMessageId.values()) addUsage(usage2, each);
  return { model, turns: usageByMessageId.size, startedAt: inherited.size === 0 || startedAt === "" ? firstTimestamp : startedAt, usage: usage2 };
};
var roleOf = (description) => ROLE_PATTERNS.find(([, pattern]) => pattern.test(description))?.[0] ?? "other";
var mrOf = (description) => /(?:!|\bMR\s*#?)(\d+)/i.exec(description)?.[1];
var mrOfArgs = (args) => mrOf(args) ?? /\/(?:merge_requests|pull)\/(\d+)/.exec(args)?.[1];
var REVIEW_SKILL = /^(?:[\w-]+:)?(jig-review(?:-cycle)?)$/;
var REVIEW_COMMAND = /<command-name>\/(?:[\w-]+:)?(jig-review(?:-cycle)?)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/;
var invocationOf = (entry) => {
  const content = entry.message?.content;
  if (typeof content === "string") {
    const command = REVIEW_COMMAND.exec(content);
    return command?.[1] === void 0 ? void 0 : { skill: command[1], args: command[2] ?? "" };
  }
  if (!Array.isArray(content)) return void 0;
  for (const block of content) {
    const skill = block.type === "tool_use" && block.name === "Skill" && typeof block.input?.skill === "string" ? REVIEW_SKILL.exec(block.input.skill)?.[1] : void 0;
    if (skill !== void 0) return { skill, args: typeof block.input?.args === "string" ? block.input.args : "" };
  }
  return void 0;
};
var isHumanPrompt = (entry) => entry.type === "user" && entry.origin?.kind === "human";
var mostSpawnedMr = (agents, run3) => {
  const counts = /* @__PURE__ */ new Map();
  for (const agent of agents) {
    if (agent.mr !== void 0 && agent.startedAt >= run3.startedAt && agent.startedAt <= run3.endedAt) counts.set(agent.mr, (counts.get(agent.mr) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0];
};
var readSessionRuns = (text3, session, prices, subagents) => {
  const runs = [];
  let current;
  for (const line of text3.split("\n")) {
    const entry = parseEntry(line);
    if (entry === void 0) continue;
    const invocation = invocationOf(entry);
    if (invocation !== void 0) {
      current = { ...invocation, startedAt: entry.timestamp ?? "", endedAt: entry.timestamp ?? "", model: "", usage: /* @__PURE__ */ new Map() };
      runs.push(current);
    } else if (isHumanPrompt(entry)) {
      current = void 0;
    }
    const message = entry.message;
    if (current === void 0 || message?.usage === void 0) continue;
    if (typeof message.model === "string" && !message.model.startsWith("<")) current.model = message.model;
    current.usage.set(message.id ?? entry.uuid ?? String(current.usage.size), toUsage(message.usage));
    if (entry.timestamp !== void 0) current.endedAt = entry.timestamp;
  }
  return runs.filter((run3) => run3.model !== "").map((run3, index) => {
    const usage2 = emptyUsage();
    for (const each of run3.usage.values()) addUsage(usage2, each);
    const isRunner = run3.skill === "jig-review";
    return {
      id: `${session}#${index + 1}`,
      description: `${run3.skill} in the session`,
      role: isRunner ? "runner" : "other",
      mr: isRunner ? mrOfArgs(run3.args) ?? mostSpawnedMr(subagents, run3) : void 0,
      model: run3.model,
      turns: run3.usage.size,
      startedAt: run3.startedAt,
      usage: usage2,
      dollars: dollarsOf(usage2, priceOf(run3.model, prices))
    };
  });
};
var claudeProjectsDir = (env = process.env) => join35(env["CLAUDE_CONFIG_DIR"] ?? join35(homedir3(), ".claude"), "projects");
var projectSlug = (dir2) => dir2.replace(/[^a-zA-Z0-9]/g, "-");
var TRANSCRIPTS_ONLY = "jig review cost reads Claude Code transcripts only";
var resolveSessionDir = (given, projectDir, projectsDir) => {
  if (given !== void 0 && existsSync18(join35(given, "subagents"))) return given;
  if (given !== void 0) {
    const found = existsSync18(projectsDir) ? readdirSync17(projectsDir).map((slug) => join35(projectsDir, slug, given)).find((dir2) => existsSync18(dir2)) : void 0;
    if (found === void 0) throw new Error(`session ${given} not found under ${toSlash(projectsDir)}; ${TRANSCRIPTS_ONLY}`);
    return found;
  }
  const slugDir = join35(projectsDir, projectSlug(projectDir));
  if (!existsSync18(slugDir)) throw new Error(`no sessions for ${toSlash(projectDir)} under ${toSlash(projectsDir)}; ${TRANSCRIPTS_ONLY}`);
  const sessions = readdirSync17(slugDir).map((name) => join35(slugDir, name)).filter((dir2) => existsSync18(join35(dir2, "subagents"))).sort((left, right) => statSync14(right).mtimeMs - statSync14(left).mtimeMs);
  if (sessions[0] === void 0) throw new Error(`no session with subagents under ${toSlash(slugDir)}; ${TRANSCRIPTS_ONLY}`);
  return sessions[0];
};
var readAgents = (sessionDir2, prices) => {
  const subagents = join35(sessionDir2, "subagents");
  const sessionTranscript = `${sessionDir2}.jsonl`;
  const sessionIds = existsSync18(sessionTranscript) ? messageIds(readFileSync31(sessionTranscript, "utf8")) : /* @__PURE__ */ new Set();
  const read = readdirSync17(subagents).filter((name) => name.endsWith(".jsonl")).map((name) => {
    const metaPath = join35(subagents, name.replace(/\.jsonl$/, ".meta.json"));
    const meta = existsSync18(metaPath) ? JSON.parse(readFileSync31(metaPath, "utf8")) : {};
    return { id: name.replace(/^agent-/, "").replace(/\.jsonl$/, ""), meta, text: readFileSync31(join35(subagents, name), "utf8") };
  });
  const idsByAgent = new Map(read.map((agent) => [agent.id, messageIds(agent.text)]));
  return read.map(({ id, meta, text: text3 }) => {
    const description = meta.description ?? "";
    const transcript = readTranscript(text3, (meta.parentAgentId === void 0 ? void 0 : idsByAgent.get(meta.parentAgentId)) ?? sessionIds);
    return {
      id,
      description,
      role: roleOf(description),
      mr: mrOf(description),
      parent: meta.parentAgentId,
      ...transcript,
      dollars: dollarsOf(transcript.usage, priceOf(transcript.model, prices))
    };
  });
};
var runnerAncestor = (agent, byId) => {
  const seen = /* @__PURE__ */ new Set([agent.id]);
  for (let parent = byId.get(agent.parent ?? ""); parent !== void 0 && !seen.has(parent.id); parent = byId.get(parent.parent ?? "")) {
    if (parent.role === "runner") return parent;
    seen.add(parent.id);
  }
  return void 0;
};
var groupByLatestRunner = (agents) => {
  const sorted2 = [...agents].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const groups = /* @__PURE__ */ new Map();
  const latestRunner = /* @__PURE__ */ new Map();
  for (const agent of sorted2) {
    const owner = runnerAncestor(agent, byId);
    const mr = owner?.mr ?? agent.mr;
    if (mr === void 0) continue;
    if (owner === void 0 && agent.role === "runner") latestRunner.set(mr, agent.id);
    const runner = owner?.id ?? latestRunner.get(mr);
    const key = `${mr}:${runner ?? ""}`;
    const group = groups.get(key) ?? { mr, runner, agents: [], dollars: 0, byRole: {}, rerun: void 0, diff: void 0, threads: void 0 };
    group.agents.push(agent);
    group.dollars += agent.dollars;
    group.byRole[agent.role] = (group.byRole[agent.role] ?? 0) + agent.dollars;
    groups.set(key, group);
  }
  return [...groups.values()];
};
var readStates = (projectRoot) => {
  const dir2 = join35(projectRoot, ".jig", "runs", "review");
  if (!existsSync18(dir2)) return [];
  return readdirSync17(dir2).filter((name) => /^[0-9a-f]+\.json$/.test(name)).flatMap((name) => {
    try {
      return [JSON.parse(readFileSync31(join35(dir2, name), "utf8"))];
    } catch {
      return [];
    }
  });
};
var diffSize = (projectRoot, base, head) => {
  const result = git(["diff", "--numstat", "-M", "-z", `${base}...${head}`], projectRoot);
  if (!result.ok) return void 0;
  const size = { code: 0, tests: 0, docs: 0 };
  for (const stat of parseNumstat(result.stdout)) {
    const kind = exclusionOf(stat.path);
    const lines2 = stat.added + stat.deleted;
    if (kind === "lockfile") continue;
    if (kind === "markdown") size.docs += lines2;
    else if (kind === void 0) size.code += lines2;
    else size.tests += lines2;
  }
  return size;
};
var attachStates = (groups, projectRoot) => {
  const states = readStates(projectRoot);
  for (const group of groups) {
    const state = states.find((candidate) => candidate.target === group.mr);
    if (state === void 0) continue;
    group.rerun = (state.runs ?? 1) > 1;
    group.threads = (state.findings ?? []).filter((finding) => finding.discussion_id !== void 0).length;
    if (state.base_sha !== void 0 && state.last_reviewed_sha !== void 0) group.diff = diffSize(projectRoot, state.base_sha, state.last_reviewed_sha);
  }
};
var money2 = (value) => `$${value.toFixed(2)}`;
var totalLines = (diff) => diff.code + diff.tests + diff.docs;
var perThousandLines = (dollars, diff) => {
  const lines2 = diff === void 0 ? 0 : totalLines(diff);
  return lines2 === 0 ? void 0 : dollars * 1e3 / lines2;
};
var roleCell = (byRole) => ROLES.filter((role) => (byRole[role] ?? 0) > 0).map((role) => `${role} ${money2(byRole[role] ?? 0)}`).join(" \xB7 ");
var formatSession = (session, agents, groups) => {
  const total = agents.reduce((sum, agent) => sum + agent.dollars, 0);
  const usage2 = emptyUsage();
  agents.forEach((agent) => addUsage(usage2, agent.usage));
  const byRole = {};
  for (const agent of agents) byRole[agent.role] = (byRole[agent.role] ?? 0) + agent.dollars;
  const lines2 = [
    `session: ${session} \xB7 agents: ${agents.length} \xB7 total ${money2(total)} (estimate) \xB7 cache hit ${(cacheHit(usage2) * 100).toFixed(0)}%`,
    `by role: ${roleCell(byRole)}`,
    ""
  ];
  for (const group of groups) {
    const per1k = perThousandLines(group.dollars, group.diff);
    const diff = group.diff === void 0 ? "?" : `${group.diff.code}/${group.diff.tests}/${group.diff.docs}`;
    const perThread = group.threads === void 0 || group.threads === 0 || group.rerun === true ? "-" : money2(group.dollars / group.threads);
    lines2.push(`!${group.mr}${group.rerun === true ? " (re-review)" : ""}: ${money2(group.dollars)} \xB7 ${roleCell(group.byRole)}`);
    lines2.push(`  diff code/tests/docs ${diff} \xB7 $/1k lines ${per1k === void 0 ? "-" : money2(per1k)} \xB7 threads ${group.threads ?? "?"} \xB7 $/thread ${perThread}`);
  }
  const unassigned = agents.filter((agent) => agent.mr === void 0);
  if (unassigned.length > 0) lines2.push(`no merge request in the description: ${unassigned.map((agent) => `${agent.description || agent.id} ${money2(agent.dollars)}`).join(", ")}`);
  lines2.push("", "prices are estimates: per 1M tokens from ~/.jig/config.jsonc `prices`, else built-in list prices; cache write 5m \xD71.25, 1h \xD72, cache read \xD70.1");
  return lines2.join("\n");
};
var costLogPath = (env = process.env) => env["JIG_COST_LOG"] ?? join35(homedir3(), ".jig", "review-cost.jsonl");
var readLog = (path2) => existsSync18(path2) ? readFileSync31(path2, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line)) : [];
var toRecords = (session, project, groups) => groups.filter((group) => group.runner !== void 0).map((group) => {
  const usage2 = emptyUsage();
  group.agents.forEach((agent) => addUsage(usage2, agent.usage));
  return {
    date: group.agents[0]?.startedAt.slice(0, 10) ?? "",
    project,
    session,
    mr: group.mr,
    runner: group.runner ?? "",
    rerun: group.rerun ?? null,
    lines: group.diff ?? null,
    threads: group.threads ?? null,
    dollars: Number(group.dollars.toFixed(4)),
    byRole: Object.fromEntries(Object.entries(group.byRole).map(([role, value]) => [role, Number(value.toFixed(4))])),
    cacheHit: Number(cacheHit(usage2).toFixed(3))
  };
});
var recordRuns = (path2, records) => {
  const known = new Set(readLog(path2).map((record2) => record2.runner));
  const fresh = records.filter((record2) => !known.has(record2.runner));
  if (fresh.length === 0) return 0;
  mkdirSync16(dirname15(path2), { recursive: true });
  appendFileSync5(path2, fresh.map((record2) => `${JSON.stringify(record2)}
`).join(""));
  return fresh.length;
};
var isoWeek = (date) => {
  const day = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 3 - (day.getUTCDay() + 6) % 7);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 864e5 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};
var formatReport2 = (records, by) => {
  const rows = /* @__PURE__ */ new Map();
  for (const record2 of records) {
    const key = by === "project" ? record2.project : `${record2.project} ${isoWeek(record2.date)}`;
    const row = rows.get(key) ?? { runs: 0, reruns: 0, dollars: 0, lines: 0, threads: 0, firstDollars: 0 };
    row.runs++;
    if (record2.rerun === true) row.reruns++;
    row.dollars += record2.dollars;
    row.lines += record2.lines === null ? 0 : totalLines(record2.lines);
    if (record2.rerun !== true) {
      row.threads += record2.threads ?? 0;
      row.firstDollars += record2.dollars;
    }
    rows.set(key, row);
  }
  if (rows.size === 0) return `no runs recorded in ${toSlash(costLogPath())}: run jig review cost --record after a review`;
  return [...rows.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([key, row]) => `${key}: runs ${row.runs} (re-reviews ${row.reruns}) \xB7 ${money2(row.dollars)} \xB7 $/1k lines ${row.lines === 0 ? "-" : money2(row.dollars * 1e3 / row.lines)} \xB7 $/thread (first runs) ${row.threads === 0 ? "-" : money2(row.firstDollars / row.threads)}`
  ).join("\n");
};
var projectName = (root) => {
  const remote = git(["remote", "get-url", "origin"], root);
  const url = remote.ok ? remote.stdout.trim() : "";
  return url === "" ? basename7(root) : url.replace(/\.git$/, "").replace(/^.*[/:]([^/:]+\/[^/:]+)$/, "$1");
};
var USAGE5 = "usage: jig review cost [<session id or dir>] [--project <dir>] [--record] [--json] | jig review cost --report [--by project|week]";
var runReviewCost = (args) => {
  const { values, positionals } = parseArgs4({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      project: { type: "string" },
      record: { type: "boolean" },
      report: { type: "boolean" },
      by: { type: "string" },
      json: { type: "boolean" }
    }
  });
  if (values.report === true) {
    const by = values.by ?? "project";
    if (by !== "project" && by !== "week") throw new Error(`--by expects project or week, got ${by}`);
    process.stdout.write(`${formatReport2(readLog(costLogPath()), by)}
`);
    return 0;
  }
  if (positionals.length > 1) throw new Error(USAGE5);
  const cwd = values.project ?? process.cwd();
  const projectRoot = listWorktrees(cwd)[0]?.path ?? cwd;
  const loaded = loadUserConfig();
  if (loaded.error !== void 0) throw new Error(`${loaded.label}: ${loaded.error}`);
  const prices = { ...DEFAULT_PRICES, ...loaded.config.prices };
  const sessionDir2 = resolveSessionDir(positionals[0], projectRoot, claudeProjectsDir());
  const session = basename7(sessionDir2);
  const subagents = readAgents(sessionDir2, prices);
  const transcript = `${sessionDir2}.jsonl`;
  const agents = [...existsSync18(transcript) ? readSessionRuns(readFileSync31(transcript, "utf8"), session, prices, subagents) : [], ...subagents];
  const groups = groupByLatestRunner(agents);
  attachStates(groups, projectRoot);
  if (values.json === true) {
    process.stdout.write(`${JSON.stringify({ session, agents, groups: groups.map(({ agents: members, ...group }) => ({ ...group, agents: members.map((agent) => agent.id) })) }, null, 2)}
`);
  } else {
    process.stdout.write(`${formatSession(session, agents, groups)}
`);
  }
  if (values.record === true) {
    const path2 = costLogPath();
    const added = recordRuns(path2, toRecords(session, projectName(projectRoot), groups));
    process.stdout.write(`recorded: ${added} new run${added === 1 ? "" : "s"} in ${toSlash(path2)}
`);
  }
  return 0;
};

// src/review/route.ts
import { readFileSync as readFileSync32 } from "node:fs";
import { parseArgs as parseArgs5 } from "node:util";
var FORGE_CONTEXT_LINES = 3;
var gitOut2 = (root, args) => {
  const result = git(args, root);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
};
var parseDiff = (patch) => {
  const files = /* @__PURE__ */ new Map();
  let current;
  for (const line of patch.split("\n")) {
    const header = /^\+\+\+ (?:b\/)?(.*)$/.exec(line);
    if (header !== null) {
      const path2 = header[1] ?? "";
      current = path2 === "/dev/null" ? void 0 : { shown: /* @__PURE__ */ new Set(), changed: /* @__PURE__ */ new Set() };
      if (current !== void 0) files.set(path2, current);
      continue;
    }
    if (current === void 0 || line.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk !== null) {
      const start = Number(hunk[1]);
      const length = hunk[2] === void 0 ? 1 : Number(hunk[2]);
      for (let offset = 0; offset < length; offset++) current.shown.add(start + offset);
    } else if (line.startsWith("+") || line.startsWith("-")) {
      current.changed.add(line.slice(1).trim());
    }
  }
  return files;
};
var fileAt = (root, sha, path2) => {
  const result = git(["show", `${sha}:${path2}`], root);
  return result.ok ? result.stdout.split("\n").map((line) => line.trim()) : void 0;
};
var isPostable = (finding, held) => !held.has(finding.id ?? "") && (finding.status === "optional" || finding.status === "open" && (finding.discussion_id ?? void 0) === void 0);
var routeFindings = (root, state, base, head, hold = []) => {
  const diff = parseDiff(gitOut2(root, ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "-M", `-U${FORGE_CONTEXT_LINES}`, `${base}...${head}`]));
  const held = new Set(hold);
  const isProvenCause = (finding, cause) => {
    const causeFile = cause.file === void 0 ? void 0 : diff.get(cause.file);
    if (causeFile === void 0 || cause.diff_line === void 0 || cause.victim_line === void 0 || finding.file === void 0) return false;
    return causeFile.changed.has(cause.diff_line.trim()) && (fileAt(root, head, finding.file)?.includes(cause.victim_line.trim()) ?? false);
  };
  const routeOf = (finding) => {
    const severity = finding.status === "optional" ? "optional" : finding.severity ?? "?";
    const at = `${finding.file ?? "?"}:${finding.line ?? "?"}`;
    const item = { id: finding.id ?? at, severity, at };
    if (finding.status === "optional") return { route: "fyi", ...item };
    const file = finding.file === void 0 ? void 0 : diff.get(finding.file);
    if (file !== void 0) return { route: finding.line !== void 0 && file.shown.has(finding.line) ? "thread" : "discussion", ...item };
    const cause = finding.caused_by ?? void 0;
    if (cause !== void 0 && isProvenCause(finding, cause)) return { route: "promoted", ...item, at: `${cause.file}:${cause.line ?? "?"}`, victim: at };
    return { route: finding.severity === "Important" ? "discussion" : "fyi", ...item };
  };
  const findings = state.findings ?? [];
  const postable = findings.filter((finding) => isPostable(finding, held));
  const isSpec = (finding) => finding.category === "spec" && finding.status !== "optional";
  const routed = postable.filter((finding) => !isSpec(finding)).map(routeOf);
  const spec2 = postable.filter(isSpec).map(routeOf);
  if (spec2.length > 0) {
    const openThread = findings.find((finding) => isSpec(finding) && finding.status === "open" && (finding.discussion_id ?? void 0) !== void 0);
    const ordered = [...spec2].sort((a, b) => Number(b.severity === "Important") - Number(a.severity === "Important"));
    const lead = openThread === void 0 ? ordered.find((item) => item.route === "thread") ?? ordered[0] : void 0;
    const leadId = openThread?.id ?? lead?.id ?? "";
    for (const item of lead === void 0 ? ordered : [lead, ...ordered.filter((other) => other !== lead)]) {
      if (item === lead) {
        const heaviest = spec2.some((other) => other.severity === "Important") ? "Important" : item.severity;
        routed.push({ route: item.route === "thread" ? "thread" : "discussion", id: item.id, severity: heaviest, at: item.victim ?? item.at });
      } else {
        routed.push({ route: "spec-item", id: item.id, severity: item.severity, at: item.at, lead: leadId });
      }
    }
  }
  return state.deepening === void 0 || state.deepening === null ? routed : [...routed, { route: "fyi", id: "deepening", severity: "deepening", at: "" }];
};
var ROUTES = ["thread", "promoted", "discussion", "spec-item", "fyi"];
var formatRoutes = (routed) => [
  ...routed.map(
    (item) => [item.route, item.id, item.severity, item.at, ...item.victim === void 0 ? [] : [`victim ${item.victim}`], ...item.lead === void 0 ? [] : [`lead ${item.lead}`]].join("	")
  ),
  `routes: ${ROUTES.map((route2) => `${routed.filter((item) => item.route === route2).length} ${route2}`).join(" \xB7 ")}`
];
var USAGE6 = "usage: jig review route <state file> <base_sha> <head_sha> [--hold <id>]...";
var runReviewRoute = (args) => {
  const { values, positionals } = parseArgs5({ args, options: { hold: { type: "string", multiple: true } }, allowPositionals: true, strict: true });
  const [path2, base, head] = positionals;
  if (path2 === void 0 || base === void 0 || head === void 0 || positionals.length > 3) throw new Error(USAGE6);
  const state = JSON.parse(readFileSync32(path2, "utf8"));
  process.stdout.write(`${formatRoutes(routeFindings(process.cwd(), state, base, head, values.hold ?? [])).join("\n")}
`);
  return 0;
};

// src/review/glossary-avoid.ts
import { readFileSync as readFileSync33 } from "node:fs";
import { join as join36 } from "node:path";
var AVOID_MARKER = /(?:^|[\s(|>*_-])[_*]{0,2}(?:avoid|не\s+использовать|избегать)[_*]{0,2}\s*:\s*[_*]{0,2}/iu;
var isMarkdown2 = createMatcher(["**/*.md"]);
var wordsOf = (text3) => (text3.match(/[\p{L}\p{N}]+/gu) ?? []).flatMap((token) => token.split(new RegExp("(?<=\\p{Ll})(?=\\p{Lu})|(?<=\\p{Lu})(?=\\p{Lu}\\p{Ll})", "u"))).map((word) => word.toLowerCase());
var cleanTerm = (raw) => raw.replace(/\([^)]*\)/g, "").replace(/[`"'«»“”*_]/g, " ").replace(/\s+/g, " ").replace(/[.:]+$/, "").trim();
var avoidTerms = (text3) => text3.split(/\r?\n/).flatMap((source, index) => {
  const marker = AVOID_MARKER.exec(source);
  if (marker === null) return [];
  return source.slice(marker.index + marker[0].length).split(/[,;/]/).map(cleanTerm).filter((word) => word !== "").map((word) => ({ word, words: wordsOf(word), line: index + 1, quote: source.trim() })).filter((term) => term.words.length > 0);
});
var holds = (haystack, needle) => haystack.some((_, start) => needle.every((word, offset) => haystack[start + offset] === word));
var addedLines = (root, mergeBase, paths) => {
  const result = git(["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-ext-diff", mergeBase, ...paths.length > 0 ? ["--", ...paths] : []], root);
  if (!result.ok) throw new Error(`git diff ${mergeBase} failed: ${result.stderr.trim()}`);
  const lines2 = [];
  let file;
  let next = 0;
  for (const raw of result.stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("+++ ")) {
      const path2 = line.slice(4);
      file = path2 === "/dev/null" ? void 0 : path2.replace(/^b\//, "");
    } else if (line.startsWith("@@")) {
      next = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
    } else if (line.startsWith("+") && file !== void 0) {
      lines2.push({ file, line: next, text: line.slice(1) });
      next += 1;
    }
  }
  return lines2;
};
var covers3 = (scope, file) => scope === "" || file.startsWith(`${scope}/`);
var glossaryAvoidHits = (root, mergeBase, paths, inputs) => {
  const glossaries = inputs.glossaries.map((path2) => ({ path: path2, scope: inputs.scopes[path2] ?? "", terms: avoidTerms(readFileSync33(join36(root, path2), "utf8")) }));
  if (glossaries.every((glossary) => glossary.terms.length === 0)) return [];
  const hits = /* @__PURE__ */ new Map();
  for (const added of addedLines(root, mergeBase, paths)) {
    if (isMarkdown2(added.file) || isUnreviewed(added.file)) continue;
    const words = wordsOf(added.text);
    for (const glossary of glossaries) {
      if (!covers3(glossary.scope, added.file)) continue;
      for (const term of glossary.terms) {
        if (!holds(words, term.words)) continue;
        const key = `${added.file}\0${glossary.path}\0${term.line}\0${term.word}`;
        const hit = hits.get(key);
        if (hit === void 0) hits.set(key, { file: added.file, line: added.line, lines: 1, word: term.word, glossary: glossary.path, glossaryLine: term.line, quote: term.quote });
        else hit.lines += 1;
      }
    }
  }
  return [...hits.values()];
};

// src/review/rules.ts
var reviewInputs = (root, base, paths, env) => {
  const { mergeBase } = resolveBase(root, base, "review rules", paths);
  const inputs = ruleDocuments(root, changedPaths(root, mergeBase, paths), env);
  return { ...inputs, avoid: glossaryAvoidHits(root, mergeBase, paths, inputs) };
};
var avoidLine = (hit) => `avoid ${hit.file}:${hit.line} ${hit.word}${hit.lines > 1 ? ` (${hit.lines} lines)` : ""} \xB7 ${hit.glossary}:${hit.glossaryLine} ${hit.quote}`;
var USAGE7 = "usage: jig review rules [<base>] [-- <pathspec>...]";
var runReviewRules = (args) => {
  const split = splitPathspec(args);
  if (split.options.length > 1) throw new Error(USAGE7);
  const root = gitToplevel(process.cwd());
  if (root === void 0) throw new Error("not inside a git repository");
  const paths = toRootPaths(root, process.cwd(), split.paths ?? []);
  const inputs = reviewInputs(root, split.options[0] ?? "", paths, process.env);
  const scope = (path2) => inputs.scopes[path2] === "" ? "" : ` \xB7 scope ${inputs.scopes[path2]}/`;
  const output = [
    ...inputs.indexes.map((path2) => `index ${path2}${scope(path2)}`),
    ...inputs.standards.map((path2) => `standard ${path2}${scope(path2)}`),
    ...inputs.glossaries.map((path2) => `glossary ${path2}${scope(path2)}`),
    ...inputs.avoid.map(avoidLine)
  ];
  process.stdout.write(`${output.join("\n")}
`);
  return 0;
};

// src/review/state-summary.ts
import { readFileSync as readFileSync34 } from "node:fs";
var SUMMARY_WIDTH = 100;
var SHA_WIDTH = 12;
var short = (value, width) => {
  if (value === void 0) return "-";
  return value.length > width ? `${value.slice(0, width - 1)}\u2026` : value;
};
var postableLine = (findings, hasDeepening) => {
  const unposted = findings.filter((finding) => finding.status === "open" && finding.discussion_id === void 0).length;
  const optional = findings.filter((finding) => finding.status === "optional").length;
  return `postable: ${unposted} open without a thread \xB7 ${optional} optional \xB7 deepening ${hasDeepening ? "yes" : "no"}`;
};
var summarizeState = (state) => {
  const findings = state.findings ?? [];
  const byStatus = /* @__PURE__ */ new Map();
  findings.forEach((finding) => byStatus.set(finding.status ?? "?", (byStatus.get(finding.status ?? "?") ?? 0) + 1));
  const tally = Object.entries(state.tally ?? {}).filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`).join(", ");
  return [
    `key ${state.key ?? "-"} \xB7 target ${state.target ?? "-"} \xB7 runs ${state.runs ?? 0} \xB7 base ${short(state.base_sha, SHA_WIDTH)} \xB7 last reviewed ${short(state.last_reviewed_sha, SHA_WIDTH)} \xB7 diff hash ${short(state.diff_hash, SHA_WIDTH)}`,
    `tally: ${tally === "" ? "all zero" : tally}`,
    postableLine(findings, state.deepening !== void 0),
    `findings: ${findings.length}${byStatus.size > 0 ? ` (${[...byStatus.entries()].map(([status, count]) => `${status} ${count}`).join(", ")})` : ""} \xB7 deepening ${state.deepening === void 0 ? "no" : "yes"}`,
    ...findings.map(
      (finding) => `  ${finding.status ?? "?"} \xB7 ${finding.severity ?? "?"} \xB7 angle ${finding.angle ?? "?"} \xB7 ${finding.file ?? "?"}:${finding.line ?? "?"} \xB7 thread ${short(finding.discussion_id, SHA_WIDTH)} \xB7 ${finding.id ?? "?"} \xB7 ${short(finding.summary, SUMMARY_WIDTH)}`
    )
  ].join("\n");
};
var runReviewState = (args) => {
  const [path2] = args;
  if (path2 === void 0 || args.length > 1) throw new Error("usage: jig review state <state file>");
  process.stdout.write(`${summarizeState(JSON.parse(readFileSync34(path2, "utf8")))}
`);
  return 0;
};

// src/review/review.ts
var SUBCOMMANDS = /* @__PURE__ */ new Map([
  ["cost", runReviewCost],
  ["route", runReviewRoute],
  ["rules", runReviewRules],
  ["state", runReviewState]
]);
var runReview = (args) => {
  const [sub, ...rest] = args;
  const command = sub === void 0 ? void 0 : SUBCOMMANDS.get(sub);
  if (command === void 0) throw new Error(`usage: jig review <${[...SUBCOMMANDS.keys()].join("|")}> ...`);
  return command(rest);
};

// src/review-cycle/review-cycle.ts
import { existsSync as existsSync22, readFileSync as readFileSync37 } from "node:fs";
import { basename as basename9, relative as relative8, resolve as resolve18 } from "node:path";
import { parseArgs as parseArgs6 } from "node:util";

// src/review-cycle/adapter.ts
import { existsSync as existsSync19 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { dirname as dirname16, extname as extname4, isAbsolute as isAbsolute8, join as join37, resolve as resolve17 } from "node:path";

// src/review-cycle/exec.ts
import { spawnSync as spawnSync6 } from "node:child_process";
var MAX_BUFFER3 = 256 * 1024 * 1024;
var spawnExec = (command, args, cwd) => {
  const result = spawnSync6(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: MAX_BUFFER3 });
  if (result.error) return { code: null, stdout: "", stderr: "", error: result.error.message };
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};
var EnvironmentError = class extends Error {
  exitCode = 3;
};
var BlockedRefError = class extends Error {
  exitCode = 4;
};
var firstLine4 = (text3) => text3.trim().split(/\r?\n/)[0] ?? "";
var parseJsonPages = (text3) => {
  const values = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text3.length; index++) {
    const char = text3[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "[" || char === "{") {
      if (depth === 0) start = index;
      depth++;
    } else if (char === "]" || char === "}") {
      depth--;
      if (depth === 0) values.push(JSON.parse(text3.slice(start, index + 1)));
    }
  }
  if (depth !== 0 || inString) throw new Error("truncated JSON");
  return values.flatMap((value) => Array.isArray(value) ? value : [value]);
};

// src/review-cycle/adapter.ts
var nativePath2 = (path2, platform = process.platform) => {
  if (platform !== "win32") return path2;
  const drive = /^\/([a-zA-Z])(\/.*)?$/.exec(path2);
  return drive?.[1] === void 0 ? path2 : `${drive[1].toUpperCase()}:${drive[2] ?? "/"}`;
};
var truthy = (value) => /^(true|1|yes)$/i.test(value.trim());
var parseQueue = (output, platform = process.platform) => {
  const queue2 = { rows: [], notes: [] };
  for (const line of output.split(/\r?\n/)) {
    const [kind, ...cells] = line.split("	");
    if (kind === "NOTE") {
      queue2.notes.push({ refs: cells[0] ?? "", text: cells.slice(1).join("	") });
      continue;
    }
    if (kind !== "ROW") continue;
    const [refs, repoDir, iid, sourceBranch, draft, approval, webUrl] = cells;
    if (refs === void 0 || repoDir === void 0 || webUrl === void 0 || !/^\d+$/.test(iid ?? "")) {
      throw new EnvironmentError(`adapter queue: malformed row: ${line}`);
    }
    queue2.rows.push({
      refs,
      repoDir: nativePath2(repoDir, platform),
      iid: Number(iid),
      sourceBranch: sourceBranch ?? "",
      draft: truthy(draft ?? ""),
      approved: approval === "APPROVED",
      webUrl
    });
  }
  return queue2;
};
var parseRules = (output) => new Map(
  output.split(/\r?\n/).map((line) => /^([\w-]+)=(.*)$/.exec(line.trim())).flatMap((match) => match?.[1] === void 0 ? [] : [[match[1], (match[2] ?? "").trim()]])
);
var lines = (output) => output.split(/\r?\n/).filter((line) => line.trim() !== "");
var findBash = (env = process.env, platform = process.platform) => {
  const fromEnv = env["JIG_BASH"];
  if (fromEnv) return fromEnv;
  if (platform !== "win32") return findInPath("bash", env);
  const git2 = findInPath("git.exe", env);
  if (git2 !== void 0) {
    for (const root of [dirname16(dirname16(git2)), dirname16(dirname16(dirname16(git2)))]) {
      const candidate = join37(root, "bin", "bash.exe");
      if (existsSync19(candidate)) return candidate;
    }
  }
  const bash = findInPath("bash", env);
  return bash !== void 0 && !/system32/i.test(bash) ? bash : void 0;
};
var adapterCommand = (path2, env = process.env, platform = process.platform) => {
  const extension = extname4(path2).toLowerCase();
  if ([".mjs", ".js", ".cjs"].includes(extension)) return [process.execPath, path2];
  if (extension === ".sh") {
    const bash = findBash(env, platform);
    if (bash === void 0) throw new EnvironmentError(`no bash to run ${path2}: install Git for Windows or set JIG_BASH`);
    return [bash, path2];
  }
  if (extension === ".ps1") return [platform === "win32" ? "powershell" : "pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path2];
  return [path2];
};
var resolveAdapterPath = (path2, base) => {
  if (path2 === "~" || path2.startsWith("~/")) return join37(homedir4(), path2.slice(1));
  return isAbsolute8(path2) ? path2 : resolve17(base, path2);
};
var scriptAdapter = (path2, exec, cwd) => {
  if (!existsSync19(path2)) throw new EnvironmentError(`process adapter not found: ${path2}`);
  const [command, ...prefix] = adapterCommand(path2);
  if (command === void 0) throw new EnvironmentError(`process adapter: cannot run ${path2}`);
  const op = (args) => {
    const result = exec(command, [...prefix, ...args], cwd);
    const reason = result.error ?? (firstLine4(result.stderr).replace(/^ERROR\s+/, "") || `exit ${String(result.code)}`);
    if (result.code === 0) return result.stdout;
    if (result.code === 4) throw new BlockedRefError(reason);
    throw new EnvironmentError(`adapter ${args[0] ?? ""}: ${reason}`);
  };
  return {
    label: path2,
    queue: () => parseQueue(op(["queue"])),
    rules: (refs) => parseRules(op(["rules", refs])),
    spec: (refs) => lines(op(["spec", refs]))[0]?.trim(),
    baseCheck: () => lines(op(["base-check"])).filter((line) => line.startsWith("- ")),
    transition: (ref, target) => lines(op(["transition", ref, target]))
  };
};
var defaultAdapter = (forge, repoDir) => ({
  label: `built-in (${forge.name} reviewer queue)`,
  warning: `built-in adapter: ${forge.name} reviewer queue, no tracker spec, verdicts not recorded; set reviewCycle.processAdapter for the team's queue`,
  queue: () => ({
    rows: forge.reviewQueue().map((request) => ({
      refs: `!${request.iid}`,
      repoDir,
      iid: request.iid,
      sourceBranch: request.sourceBranch,
      draft: request.draft,
      approved: forge.approved(request.iid),
      webUrl: request.webUrl
    })),
    notes: []
  }),
  rules: () => /* @__PURE__ */ new Map([["stale", "on"]]),
  spec: () => void 0,
  baseCheck: () => [],
  transition: (ref, target) => [`${ref} \u2192 ${target}: no process adapter, nothing recorded`]
});

// src/review-cycle/filter.ts
var OPTIONAL_OPENING = /^\*\*(\[[^\]]*(Nit|Pre-existing)|(Улучшения|Упрощения) — по желанию)/;
var isOptionalNote = (note) => OPTIONAL_OPENING.test(note.body.trim());
var FYI_MARKER = "<!-- review-fyi -->";
var isFyiNote = (note) => note.body.includes(FYI_MARKER);
var humanNotes = (discussion) => discussion.notes.filter((note) => !note.system);
var isOpen = (discussion) => discussion.notes.some((note) => note.resolvable && !note.resolved);
var time = (iso) => {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
};
var latest = (stamps) => stamps.reduce((best, stamp) => best === void 0 || time(stamp) > time(best) ? stamp : best, void 0);
var countUnresolved = (discussions) => discussions.filter((discussion) => {
  const [opening] = humanNotes(discussion);
  return opening !== void 0 && !isOptionalNote(opening) && isOpen(discussion);
}).length;
var threadFacts = (discussions, me) => {
  const isMine = (note) => note.author === me && !note.system;
  let myLastNote;
  let myUnresolved = 0;
  let unanswered = 0;
  for (const discussion of discussions) {
    const mine = discussion.notes.filter(isMine);
    const [myFirst] = mine;
    if (myFirst === void 0) continue;
    const open = isOpen(discussion);
    if (open && !isOptionalNote(myFirst)) myUnresolved++;
    const myLastHere = latest(mine.map((note) => note.createdAt)) ?? "";
    myLastNote = latest(myLastNote === void 0 ? [myLastHere] : [myLastNote, myLastHere]);
    const [opening] = discussion.notes;
    const ownsThread = opening !== void 0 && isMine(opening);
    const answeredAfter = discussion.notes.some((note) => !note.system && !isMine(note) && time(note.createdAt) > time(myLastHere));
    const awaitsAnswer = open || opening !== void 0 && isFyiNote(opening);
    if (awaitsAnswer && ownsThread && answeredAfter) unanswered++;
  }
  return { myLastNote, myUnresolved, unanswered };
};
var standingBlocking = (findings, discussions) => {
  const open = new Set(discussions.filter(isOpen).map((discussion) => discussion.id));
  return findings.filter((finding) => finding.discussionId !== void 0 && open.has(finding.discussionId)).length;
};
var lastCommit = (commitDates) => latest(commitDates);
var SKIP_REASONS = ["approved", "draft", "busy", "unchanged", "stale"];
var skipOutcome = (reason, blocking) => {
  if (reason === "approved") return "approved";
  if ((reason === "unchanged" || reason === "stale") && blocking > 0) return "returned";
  return "held";
};
var preDecision = (row) => {
  if (row.approved) return { kind: "skip", reason: "approved" };
  if (row.draft) return { kind: "skip", reason: "draft" };
  if (row.busy) return { kind: "skip", reason: "busy" };
  return void 0;
};
var needsHeadSha = (threads, reviewedSha) => reviewedSha !== void 0 && threads.unanswered === 0;
var reviewDecision = (facts2) => {
  const { threads } = facts2;
  const isUnchanged = threads.unanswered === 0 && facts2.reviewedSha !== void 0 && facts2.headSha !== void 0 && (facts2.reviewedSha === facts2.headSha || facts2.reviewedDiff);
  if (isUnchanged) return { kind: "skip", reason: "unchanged" };
  const isStale = threads.myUnresolved > 0 && threads.unanswered === 0 && threads.myLastNote !== void 0 && facts2.lastCommit !== void 0 && time(facts2.lastCommit) <= time(threads.myLastNote);
  if (isStale && facts2.staleRule) return { kind: "skip", reason: "stale" };
  return { kind: "actionable" };
};

// src/review-cycle/forge.ts
import { mkdtempSync as mkdtempSync2, rmSync as rmSync10, writeFileSync as writeFileSync11 } from "node:fs";
import { tmpdir as tmpdir4 } from "node:os";
import { join as join38 } from "node:path";
var detectForge = (remote) => /github/i.test(remote) ? "github" : "gitlab";
var isObject4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text2 = (value) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
var Cli = class {
  constructor(exec, bin, cwd) {
    this.exec = exec;
    this.bin = bin;
    this.cwd = cwd;
  }
  exec;
  bin;
  cwd;
  run(args, label) {
    const result = this.exec(this.bin, args, this.cwd);
    if (result.code === 0) return result.stdout;
    const reason = result.error ?? (firstLine4(result.stderr) || firstLine4(result.stdout) || `exit ${String(result.code)}`);
    throw new EnvironmentError(`${this.bin} ${label}: ${reason}`);
  }
  json(args, label) {
    const output = this.run(args, label);
    try {
      return parseJsonPages(output);
    } catch {
      throw new EnvironmentError(`${this.bin} ${label}: unreadable JSON`);
    }
  }
  one(args, label) {
    const [value] = this.json(args, label);
    if (!isObject4(value)) throw new EnvironmentError(`${this.bin} ${label}: expected an object`);
    return value;
  }
};
var objects = (values) => values.filter(isObject4);
var gitlabNote = (raw) => ({
  id: text2(raw["id"]),
  author: isObject4(raw["author"]) ? text2(raw["author"]["id"]) : "",
  system: raw["system"] === true,
  resolvable: raw["resolvable"] === true,
  resolved: raw["resolved"] === true,
  createdAt: text2(raw["created_at"]),
  body: text2(raw["body"])
});
var gitlabDiscussion = (raw) => ({
  id: text2(raw["id"]),
  notes: Array.isArray(raw["notes"]) ? objects(raw["notes"]).map(gitlabNote) : []
});
var gitlabForge = (exec, cwd) => {
  const cli = new Cli(exec, "glab", cwd);
  const mr = (iid) => `projects/:fullpath/merge_requests/${iid}`;
  let me;
  return {
    name: "gitlab",
    me() {
      if (me !== void 0) return me;
      const id = text2(cli.one(["api", "user"], "api user")["id"]);
      if (!/^\d+$/.test(id)) throw new EnvironmentError(`glab api user: no numeric user id (host, token or remote is wrong)`);
      me = id;
      return me;
    },
    reviewQueue() {
      const path2 = `projects/:fullpath/merge_requests?state=opened&reviewer_id=${this.me()}&per_page=100`;
      return objects(cli.json(["api", path2, "--paginate"], `api ${path2}`)).map((raw) => ({
        iid: Number(raw["iid"]),
        sourceBranch: text2(raw["source_branch"]),
        draft: raw["draft"] === true || raw["work_in_progress"] === true,
        webUrl: text2(raw["web_url"])
      }));
    },
    approved(iid) {
      const approvals = cli.one(["api", `${mr(iid)}/approvals`], `api ${mr(iid)}/approvals`);
      const by = approvals["approved_by"];
      return Array.isArray(by) && by.length > 0;
    },
    head(iid) {
      const raw = cli.one(["api", mr(iid)], `api ${mr(iid)}`);
      const sha = text2(raw["sha"]);
      if (sha === "") throw new EnvironmentError(`glab api ${mr(iid)}: no head sha`);
      return { sha, target: text2(raw["target_branch"]) };
    },
    commitDates(iid) {
      const path2 = `${mr(iid)}/commits?per_page=100`;
      return objects(cli.json(["api", path2, "--paginate"], `api ${path2}`)).map((raw) => text2(raw["created_at"]));
    },
    discussions(iid) {
      const path2 = `${mr(iid)}/discussions?per_page=100`;
      return objects(cli.json(["api", path2, "--paginate"], `api ${path2}`)).map(gitlabDiscussion);
    },
    discussion(iid, id) {
      const path2 = `${mr(iid)}/discussions/${id}`;
      try {
        return gitlabDiscussion(cli.one(["api", path2], `api ${path2}`));
      } catch (error) {
        if (error instanceof EnvironmentError && /404/.test(error.message)) return void 0;
        throw error;
      }
    },
    deleteNote(iid, noteId) {
      const path2 = `${mr(iid)}/notes/${noteId}`;
      cli.run(["api", "--method", "DELETE", path2], `api DELETE ${path2}`);
    },
    reply(iid, discussionId, body) {
      const path2 = `${mr(iid)}/discussions/${discussionId}/notes`;
      const dir2 = mkdtempSync2(join38(tmpdir4(), "jig-note-"));
      try {
        const payload = join38(dir2, "payload.json");
        writeFileSync11(payload, JSON.stringify({ body }));
        cli.run(["api", "--method", "POST", path2, "-H", "Content-Type: application/json", "--input", payload], `api POST ${path2}`);
      } finally {
        rmSync10(dir2, { recursive: true, force: true });
      }
    },
    resolve(iid, discussionId) {
      const path2 = `${mr(iid)}/discussions/${discussionId}`;
      cli.run(["api", "--method", "PUT", path2, "-f", "resolved=true"], `api PUT ${path2}`);
    }
  };
};
var THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes {
    id isResolved comments(first: 100) { nodes { databaseId author { login } createdAt body } }
  } } } }
}`;
var githubComment = (raw, resolvable, resolved) => ({
  id: text2(raw["databaseId"] ?? raw["id"]),
  author: isObject4(raw["author"]) ? text2(raw["author"]["login"]) : isObject4(raw["user"]) ? text2(raw["user"]["login"]) : "",
  system: false,
  resolvable,
  resolved,
  createdAt: text2(raw["createdAt"] ?? raw["created_at"]),
  body: text2(raw["body"])
});
var path = (value, keys) => keys.reduce((current, key) => isObject4(current) ? current[key] : void 0, value);
var nodes = (value) => {
  const list = path(value, ["nodes"]);
  return Array.isArray(list) ? objects(list) : [];
};
var githubThreads = (response) => nodes(path(response, ["data", "repository", "pullRequest", "reviewThreads"])).map((thread) => {
  const resolved = thread["isResolved"] === true;
  return { id: text2(thread["id"]), notes: nodes(thread["comments"]).map((comment) => githubComment(comment, true, resolved)) };
});
var githubForge = (exec, cwd) => {
  const cli = new Cli(exec, "gh", cwd);
  const view = (iid, fields) => cli.one(["pr", "view", String(iid), "--json", fields], `pr view ${iid}`);
  const unsupported = (operation) => {
    throw new EnvironmentError(`${operation} is not supported on GitHub yet`);
  };
  let me;
  return {
    name: "github",
    me() {
      me ??= text2(cli.one(["api", "user"], "api user")["login"]);
      if (me === "") throw new EnvironmentError("gh api user: no login (run gh auth login)");
      return me;
    },
    reviewQueue() {
      const seen = /* @__PURE__ */ new Map();
      for (const search of ["review-requested:@me", "reviewed-by:@me"]) {
        const args = ["pr", "list", "--state", "open", "--search", search, "--limit", "200", "--json", "number,headRefName,isDraft,url"];
        for (const raw of objects(cli.json(args, `pr list --search ${search}`))) {
          const iid = Number(raw["number"]);
          seen.set(iid, { iid, sourceBranch: text2(raw["headRefName"]), draft: raw["isDraft"] === true, webUrl: text2(raw["url"]) });
        }
      }
      return [...seen.values()];
    },
    approved(iid) {
      const reviews = view(iid, "latestReviews")["latestReviews"];
      return Array.isArray(reviews) && objects(reviews).some((review) => review["state"] === "APPROVED");
    },
    head(iid) {
      const raw = view(iid, "headRefOid,baseRefName");
      const sha = text2(raw["headRefOid"]);
      if (sha === "") throw new EnvironmentError(`gh pr view ${iid}: no head sha`);
      return { sha, target: text2(raw["baseRefName"]) };
    },
    commitDates(iid) {
      const commits = view(iid, "commits")["commits"];
      return Array.isArray(commits) ? objects(commits).map((commit) => text2(commit["committedDate"])) : [];
    },
    discussions(iid) {
      const args = ["api", "graphql", "-F", "owner={owner}", "-F", "repo={repo}", "-F", `number=${iid}`, "-f", `query=${THREADS_QUERY}`];
      const threads = githubThreads(cli.one(args, `api graphql reviewThreads ${iid}`));
      const issuePath = `repos/{owner}/{repo}/issues/${iid}/comments`;
      const general = objects(cli.json(["api", issuePath, "--paginate"], `api ${issuePath}`)).map((raw) => ({
        id: text2(raw["id"]),
        notes: [githubComment(raw, false, false)]
      }));
      return [...threads, ...general];
    },
    discussion: () => unsupported("withdraw and merge"),
    deleteNote: () => unsupported("withdraw"),
    reply: () => unsupported("merge"),
    resolve: () => unsupported("merge")
  };
};
var createForge = (name, exec, cwd) => name === "github" ? githubForge(exec, cwd) : gitlabForge(exec, cwd);

// src/review-cycle/import-state.ts
import { createHash as createHash9 } from "node:crypto";
import { copyFileSync as copyFileSync5, existsSync as existsSync21, mkdirSync as mkdirSync17, readdirSync as readdirSync18, readFileSync as readFileSync36, statSync as statSync15, writeFileSync as writeFileSync13 } from "node:fs";
import { tmpdir as tmpdir5 } from "node:os";
import { basename as basename8, dirname as dirname17, join as join40 } from "node:path";

// src/review-cycle/state.ts
import { createHash as createHash8 } from "node:crypto";
import { copyFileSync as copyFileSync4, existsSync as existsSync20, readFileSync as readFileSync35, writeFileSync as writeFileSync12 } from "node:fs";
import { join as join39 } from "node:path";
var FINDING_STATUSES = ["open", "fixed", "skipped", "unverified", "no_change_needed", "optional"];
var reviewStateKey = (remote, target) => {
  const content = Buffer.from(`${remote}:${target}`, "utf8");
  return createHash8("sha1").update(`blob ${content.length}\0`).update(content).digest("hex").slice(0, 12);
};
var reviewStatePath = (mainRoot, remote, target) => join39(mainRoot, ".jig", "runs", "review", `${reviewStateKey(remote, target)}.json`);
var isObject5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var optionalText = (value) => typeof value === "string" && value !== "" ? value : void 0;
var isStatus = (value) => typeof value === "string" && FINDING_STATUSES.includes(value);
var parseReviewState = (text3, label) => {
  let raw;
  try {
    raw = JSON.parse(text3);
  } catch {
    throw new EnvironmentError(`${label}: not JSON`);
  }
  if (!isObject5(raw) || !Array.isArray(raw["findings"])) throw new EnvironmentError(`${label}: no findings array`);
  const parsed = raw["findings"].map((entry, index) => {
    if (!isObject5(entry)) return `findings[${index}]: not an object`;
    const status = entry["status"];
    if (!isStatus(status)) return `findings[${index}] (${optionalText(entry["id"]) ?? "no id"}): status ${JSON.stringify(status ?? null)}`;
    return {
      id: optionalText(entry["id"]) ?? `#${index}`,
      status,
      severity: optionalText(entry["severity"]),
      category: optionalText(entry["category"]),
      discussionId: optionalText(entry["discussion_id"]),
      specQuote: typeof entry["spec_quote"] === "string" ? entry["spec_quote"] : void 0
    };
  });
  const invalid = parsed.filter((item) => typeof item === "string");
  if (invalid.length > 0) {
    throw new EnvironmentError(
      `${label}: ${invalid.join(", ")} not one of ${FINDING_STATUSES.join("|")}; the state was edited outside jig: fix the status (a duplicate thread: jig review-cycle merge) or restore a .bak copy`
    );
  }
  const findings = parsed.filter((item) => typeof item !== "string");
  return { lastReviewedSha: optionalText(raw["last_reviewed_sha"]), diffHash: optionalText(raw["diff_hash"]), findings };
};
var readReviewState = (path2) => {
  if (!existsSync20(path2)) return void 0;
  let text3;
  try {
    text3 = readFileSync35(path2, "utf8");
  } catch (error) {
    throw new EnvironmentError(`${path2}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseReviewState(text3, path2);
};
var CLOSED = /* @__PURE__ */ new Set(["fixed", "no_change_needed", "optional"]);
var standingFindings = (state) => state.findings.filter((finding) => !CLOSED.has(finding.status));
var STANDING = /* @__PURE__ */ new Set(["open", "skipped"]);
var blockingFindings = (state) => state.findings.filter((finding) => finding.severity === "Important" && STANDING.has(finding.status) && finding.discussionId !== void 0);
var PRIOR_KEYS = ["prior_fixed", "prior_skipped", "prior_unverified", "prior_no_change_needed"];
var parseTally = (text3) => {
  let raw;
  try {
    raw = JSON.parse(text3);
  } catch {
    throw new EnvironmentError("tally: not JSON");
  }
  if (!isObject5(raw)) throw new EnvironmentError("tally: expected an object");
  let prior = 0;
  for (const key of PRIOR_KEYS) {
    const value = raw[key];
    if (value === void 0 || value === null) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new EnvironmentError(`tally: ${key} is not a count`);
    prior += value;
  }
  const degraded = raw["degraded"];
  return { degraded: typeof degraded === "string" && degraded.trim() !== "" ? degraded : void 0, prior };
};
var reconcile = (before, tally) => {
  if (tally.degraded !== void 0) return { kind: "blocked", reason: `degraded: ${tally.degraded}`, firstRun: before === void 0 };
  const standing2 = before === void 0 ? 0 : standingFindings(before).length;
  if (tally.prior < standing2) {
    return { kind: "blocked", reason: `tally accounts for ${tally.prior} of ${standing2} standing findings`, firstRun: before === void 0 };
  }
  return { kind: "ok", standing: standing2, accounted: tally.prior };
};
var flat = (text3) => text3.replace(/\s+/g, " ").trim();
var specHold = (state, spec2) => {
  const specText = flat(spec2);
  const isQuoted = (finding) => finding.specQuote !== void 0 && flat(finding.specQuote) !== "" && specText.includes(flat(finding.specQuote));
  return state.findings.filter((finding) => finding.category === "spec" && finding.status === "open" && finding.discussionId === void 0 && !isQuoted(finding)).map((finding) => finding.id);
};
var updateFindings = (path2, ids, backup, change, now) => {
  if (ids.length === 0 || !existsSync20(path2)) return 0;
  const raw = JSON.parse(readFileSync35(path2, "utf8"));
  if (!isObject5(raw) || !Array.isArray(raw["findings"])) throw new EnvironmentError(`${path2}: no findings array`);
  const hits = raw["findings"].filter(
    (finding) => isObject5(finding) && typeof finding["discussion_id"] === "string" && ids.includes(finding["discussion_id"])
  );
  if (hits.length === 0) return 0;
  copyFileSync4(path2, `${path2}.bak-${backup}-${now.toISOString().replace(/[:.]/g, "-")}`);
  hits.forEach(change);
  writeFileSync12(path2, `${JSON.stringify(raw, null, 2)}
`);
  return hits.length;
};
var mergeInState = (path2, merged2, now = /* @__PURE__ */ new Date()) => updateFindings(path2, merged2, "merge", (finding) => {
  finding["status"] = "no_change_needed";
}, now);
var withdrawFromState = (path2, gone, now = /* @__PURE__ */ new Date()) => updateFindings(path2, gone, "withdraw", (finding) => {
  finding["status"] = "no_change_needed";
  finding["discussion_id"] = null;
}, now);

// src/review-cycle/import-state.ts
var LEGACY_STATE_DIR = "claude-review";
var defaultImportDir = () => join40(tmpdir5(), LEGACY_STATE_DIR);
var legacyStateKey = (remote, iid) => createHash9("sha1").update(`${remote}:${iid}`).digest("hex").slice(0, 12);
var LEGACY_FILE = /^(.+)-([0-9a-f]{12})\.json$/;
var MAX_IID = 99999;
var TOP_FIELDS = /* @__PURE__ */ new Set([
  "key",
  "remote",
  "target",
  "source_branch",
  "base_sha",
  "last_reviewed_sha",
  "diff_hash",
  "runs",
  "tokens",
  "timings",
  "tally",
  "findings",
  "deepening"
]);
var FINDING_FIELDS = /* @__PURE__ */ new Set([
  "id",
  "file",
  "line",
  "angle",
  "category",
  "severity",
  "severity_class",
  "severity_gate",
  "verdict",
  "models",
  "summary",
  "mrComment",
  "caused_by",
  "discussion_id",
  "status",
  "blocks",
  "spec_quote"
]);
var isObject6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var hintedIid = (target) => {
  const text3 = typeof target === "string" || typeof target === "number" ? String(target) : "";
  const match = /^!?(\d+)$/.exec(text3) ?? /merge_requests\/(\d+)/.exec(text3) ?? /pull\/(\d+)/.exec(text3);
  return match?.[1] === void 0 ? void 0 : Number(match[1]);
};
var legacyIid = (raw, remote, fileKey) => {
  const hinted = hintedIid(raw["target"]);
  if (hinted !== void 0 && legacyStateKey(remote, hinted) === fileKey) return hinted;
  for (let iid = 1; iid <= MAX_IID; iid++) if (legacyStateKey(remote, iid) === fileKey) return iid;
  return void 0;
};
var convertLegacyState = (raw, jigKey, iid) => {
  const dropped = /* @__PURE__ */ new Set();
  const state = {};
  for (const [field, value] of Object.entries(raw)) {
    if (TOP_FIELDS.has(field)) state[field] = value;
    else if (field !== "degraded") dropped.add(field);
  }
  state["key"] = jigKey;
  state["target"] = String(iid);
  const tally = isObject6(raw["tally"]) ? { ...raw["tally"] } : {};
  const degraded = raw["degraded"];
  const movesDegraded = typeof degraded === "string" && degraded.trim() !== "" && tally["degraded"] === void 0;
  if (movesDegraded) tally["degraded"] = degraded;
  else if (degraded !== void 0) dropped.add("degraded");
  state["tally"] = tally;
  const findings = Array.isArray(raw["findings"]) ? raw["findings"] : [];
  state["findings"] = findings.map((finding) => {
    const kept = {};
    for (const [field, value] of Object.entries(isObject6(finding) ? finding : {})) {
      if (FINDING_FIELDS.has(field)) kept[field] = value;
      else dropped.add(`findings[].${field}`);
    }
    return kept;
  });
  return { state, dropped: [...dropped].sort() };
};
var finishedAt = (raw, path2) => {
  const stamp = isObject6(raw) && isObject6(raw["timings"]) ? raw["timings"]["finished_at"] : void 0;
  const parsed = typeof stamp === "string" ? Date.parse(stamp) : Number.NaN;
  return Number.isNaN(parsed) ? statSync15(path2).mtimeMs : parsed;
};
var readJson = (path2) => {
  try {
    return JSON.parse(readFileSync36(path2, "utf8"));
  } catch {
    return void 0;
  }
};
var sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
var importLegacyStates = (options) => {
  const { from, mainRoot, remote, dryRun } = options;
  if (!existsSync21(from)) throw new EnvironmentError(`no such directory ${toSlash(from)}`);
  const lines2 = [];
  let imported = 0;
  let skipped = 0;
  let other = 0;
  const skip = (label, reason) => {
    skipped++;
    lines2.push(`SKIP	${label}	${reason}`);
  };
  for (const name of readdirSync18(from).sort()) {
    const fileKey = LEGACY_FILE.exec(name)?.[2];
    if (fileKey === void 0) continue;
    const source = join40(from, name);
    const raw = readJson(source);
    if (!isObject6(raw) || raw["remote"] !== remote) {
      other++;
      continue;
    }
    const iid = legacyIid(raw, remote, fileKey);
    if (iid === void 0) {
      skip(name, "no merge request number matches the file key");
      continue;
    }
    const label = `!${iid}	${name}`;
    try {
      parseReviewState(JSON.stringify(raw), name);
    } catch (error) {
      skip(label, error instanceof Error ? error.message : String(error));
      continue;
    }
    const destination = reviewStatePath(mainRoot, remote, String(iid));
    const { state, dropped } = convertLegacyState(raw, basename8(destination, ".json"), iid);
    if (existsSync21(destination)) {
      const current = readJson(destination);
      if (sameJson(current, state)) {
        skip(label, "already imported");
        continue;
      }
      if (current !== void 0 && finishedAt(current, destination) >= finishedAt(raw, source)) {
        skip(label, `jig state ${toSlash(destination)} is as new or newer`);
        continue;
      }
      if (!dryRun) copyFileSync5(destination, `${destination}.bak-import-${(options.now ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`);
    }
    if (!dryRun) {
      mkdirSync17(dirname17(destination), { recursive: true });
      writeFileSync13(destination, `${JSON.stringify(state, null, 2)}
`);
    }
    imported++;
    lines2.push(`${dryRun ? "WOULD IMPORT" : "IMPORTED"}	${label}	${toSlash(destination)}${dropped.length > 0 ? `	dropped ${dropped.join(", ")}` : ""}`);
  }
  lines2.push(`import-state: ${imported} ${dryRun ? "to import" : "imported"}, ${skipped} skipped, ${other} of other repositories (from ${toSlash(from)})`);
  return { lines: lines2, imported, skipped };
};

// src/review-cycle/verdict.ts
var OUTCOMES = ["returned", "ready", "approved", "held"];
var splitRefs = (refs) => refs.split(",").map((ref) => ref.trim()).filter((ref) => ref !== "");
var foldVerdicts = (outcomes) => {
  const byRef = /* @__PURE__ */ new Map();
  for (const { refs, outcome } of outcomes) {
    for (const ref of splitRefs(refs)) {
      byRef.set(ref, [...byRef.get(ref) ?? [], outcome]);
    }
  }
  const verdicts = /* @__PURE__ */ new Map();
  for (const [ref, list] of byRef) {
    if (list.includes("returned")) verdicts.set(ref, "returned");
    else if (list.every((outcome) => outcome === "approved")) verdicts.set(ref, "none");
    else if (list.every((outcome) => outcome === "ready" || outcome === "approved")) verdicts.set(ref, "ready");
    else verdicts.set(ref, void 0);
  }
  return verdicts;
};
var applyVerdicts = (adapter, verdicts, dryRun) => {
  const lines2 = [];
  for (const [ref, target] of verdicts) {
    if (target === void 0) {
      lines2.push({ ref, text: `${ref}: no transition (an MR of it was skipped, blocked or still open)`, failed: false });
      continue;
    }
    if (dryRun) {
      lines2.push({ ref, text: `${ref} \u2192 ${target} (dry run)`, failed: false });
      continue;
    }
    try {
      const output = adapter.transition(ref, target);
      lines2.push(...(output.length > 0 ? output : [`${ref} \u2192 ${target}`]).map((text3) => ({ ref, text: text3, failed: false })));
    } catch (error) {
      if (error instanceof BlockedRefError) lines2.push({ ref, text: `${ref}: ${error.message}`, failed: false });
      else if (error instanceof EnvironmentError) lines2.push({ ref, text: `${ref}: status not recorded, ${error.message}`, failed: true });
      else throw error;
    }
  }
  return lines2;
};

// src/review-cycle/review-cycle.ts
var USAGE8 = [
  "usage: jig review-cycle <subcommand>",
  "  queue [--adapter <path>] [--json]",
  "  state-path <mr> [--repo <dir>]",
  "  import-state [--from <dir>] [--repo <dir>] [--dry-run]",
  "  base-check [--adapter <path>]",
  "  spec <refs> [--adapter <path>]",
  "  reconcile <state-before|none> <tally-file|tally-json>",
  "  unresolved <mr> [--repo <dir>]",
  "  standing <mr> [--repo <dir>]",
  "  head <mr> [--reviewed <sha>] [--repo <dir>]",
  "  spec-hold <state> <spec>",
  "  withdraw <mr> <discussion-id>... [--repo <dir>]",
  "  merge <mr> <keep-discussion-id> <duplicate-discussion-id>... --note <file> [--repo <dir>]",
  "  verdict <refs>=<outcome>... [--adapter <path>] [--dry-run]"
].join("\n");
var UsageError2 = class extends Error {
};
var DEFAULT_WORKTREES_DIR = "..";
var worktreesOf = (dir2) => {
  try {
    return listWorktrees(dir2);
  } catch (error) {
    throw new EnvironmentError(error instanceof Error ? error.message : String(error));
  }
};
var repoContext = (dir2, exec) => {
  const remote = git(["remote", "get-url", "origin"], dir2);
  if (!remote.ok) throw new EnvironmentError(`no origin remote in ${toSlash(dir2)}`);
  const mainRoot = worktreesOf(dir2)[0]?.path;
  if (mainRoot === void 0) throw new EnvironmentError(`not a git repository: ${toSlash(dir2)}`);
  const config = loadConfig(mainRoot);
  if (config.error !== void 0) throw new EnvironmentError(`.jig/config.jsonc: ${config.error}`);
  const url = remote.stdout.trim();
  const forgeName = config.reviewCycle?.forge ?? detectForge(url);
  return {
    mainRoot,
    remote: url,
    forge: createForge(forgeName, exec, mainRoot),
    worktreesDir: config.slots?.worktreesDir ?? DEFAULT_WORKTREES_DIR
  };
};
var adapterFor = (repo, flag, deps) => {
  if (flag !== void 0) return scriptAdapter(resolveAdapterPath(flag, deps.cwd), deps.exec, repo.mainRoot);
  const configured = loadConfig(repo.mainRoot).reviewCycle?.processAdapter;
  if (configured !== void 0) return scriptAdapter(resolveAdapterPath(configured, repo.mainRoot), deps.exec, repo.mainRoot);
  return defaultAdapter(repo.forge, repo.mainRoot);
};
var reviewWorktreePath = (repo, iid) => resolve18(repo.mainRoot, repo.worktreesDir, `${basename9(repo.mainRoot)}-review-${iid}`);
var fetched = (root, ref) => git(["fetch", "-q", "--no-tags", "origin", ref], root).ok ? git(["rev-parse", "FETCH_HEAD"], root).stdout.trim() : void 0;
var hasCommit = (root, sha) => git(["cat-file", "-e", `${sha}^{commit}`], root).ok || fetched(root, sha) !== void 0;
var hasReviewedDiff = (root, head, reviewedHash) => {
  const target = head.target === "" ? void 0 : fetched(root, head.target);
  if (target === void 0) return false;
  if (!hasCommit(root, head.sha)) return false;
  try {
    return diffHash(root, `${target}...${head.sha}`) === reviewedHash;
  } catch {
    return false;
  }
};
var isBusy = (repo, worktree) => existsSync22(worktree) || worktreesOf(repo.mainRoot).some((entry) => samePath(entry.path, worktree));
var judgeRow = (row, adapter, repos) => {
  try {
    const repo = repos(row.repoDir);
    const worktree = reviewWorktreePath(repo, row.iid);
    const pre = preDecision({ approved: row.approved, draft: row.draft, busy: isBusy(repo, worktree) });
    if (pre?.kind === "skip") return { kind: "skip", row, reason: pre.reason, outcome: skipOutcome(pre.reason, 0), threads: void 0, lastCommit: void 0 };
    const staleRule = adapter.rules(row.refs).get("stale") === "on";
    const statePath2 = reviewStatePath(repo.mainRoot, repo.remote, String(row.iid));
    const state = readReviewState(statePath2);
    const me = repo.forge.me();
    const discussions = repo.forge.discussions(row.iid);
    const threads = threadFacts(discussions, me);
    const latestCommit = lastCommit(repo.forge.commitDates(row.iid));
    const reviewedSha = state?.lastReviewedSha;
    const head = needsHeadSha(threads, reviewedSha) ? repo.forge.head(row.iid) : void 0;
    const headSha = head?.sha;
    const reviewedDiff = head !== void 0 && head.sha !== reviewedSha && state?.diffHash !== void 0 && hasReviewedDiff(repo.mainRoot, head, state.diffHash);
    const decision = reviewDecision({ staleRule, threads, lastCommit: latestCommit, reviewedSha, headSha, reviewedDiff });
    if (decision.kind === "skip") {
      const blocking = state === void 0 ? 0 : standingBlocking(blockingFindings(state), discussions);
      return { kind: "skip", row, reason: decision.reason, outcome: skipOutcome(decision.reason, blocking), threads, lastCommit: latestCommit };
    }
    return {
      kind: "actionable",
      row,
      worktree,
      state: state === void 0 ? void 0 : statePath2,
      standing: state === void 0 ? 0 : standingFindings(state).length,
      threads,
      lastCommit: latestCommit
    };
  } catch (error) {
    if (error instanceof EnvironmentError || error instanceof BlockedRefError) return { kind: "blocked", row, reason: error.message };
    throw error;
  }
};
var facts = (threads, commit) => threads === void 0 ? "" : `	last_commit=${commit ?? "none"}	my_last_note=${threads.myLastNote ?? "none"}	my_unresolved=${threads.myUnresolved}`;
var formatEntry = (entry) => {
  const { row } = entry;
  const id = `${row.refs}	${toSlash(row.repoDir)}	${row.iid}`;
  switch (entry.kind) {
    case "actionable":
      return `ACTIONABLE	${id}	${row.sourceBranch}	${row.webUrl}	worktree=${toSlash(entry.worktree)}	state=${entry.state === void 0 ? "none" : toSlash(entry.state)}	standing=${entry.standing}${facts(entry.threads, entry.lastCommit)}`;
    case "skip":
      return `SKIP	${entry.reason}	${id}	${row.webUrl}	outcome=${entry.outcome}${facts(entry.threads, entry.lastCommit)}`;
    case "blocked":
      return `BLOCKED	${id}	${row.webUrl}	${entry.reason}`;
    default: {
      const unreachable = entry;
      return unreachable;
    }
  }
};
var skippedLine = (entries) => {
  const counts = SKIP_REASONS.map((reason) => [reason, entries.filter((entry) => entry.kind === "skip" && entry.reason === reason).length]).filter(
    ([, count]) => count > 0
  );
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  return total === 0 ? void 0 : `skipped: ${total} (${counts.map(([reason, count]) => `${reason} ${count}`).join(", ")})`;
};
var flagOptions = {
  adapter: { type: "string" },
  json: { type: "boolean" },
  repo: { type: "string" },
  from: { type: "string" },
  reviewed: { type: "string" },
  note: { type: "string" },
  "dry-run": { type: "boolean" }
};
var parse = (args) => {
  try {
    return parseArgs6({ args, options: flagOptions, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError2(error instanceof Error ? error.message : String(error));
  }
};
var mrNumber = (value) => {
  const match = /^!?(\d+)$/.exec(value ?? "");
  if (match?.[1] === void 0) throw new UsageError2(`expected a merge request number, got ${value ?? "nothing"}`);
  return Number(match[1]);
};
var queue = (args, deps) => {
  const { values } = parse(args);
  const cache = /* @__PURE__ */ new Map();
  const repos = (dir2) => {
    const key = toSlash(resolve18(dir2)).toLowerCase();
    const known = cache.get(key);
    if (known !== void 0) return known;
    const repo = repoContext(dir2, deps.exec);
    cache.set(key, repo);
    return repo;
  };
  const home = repos(deps.cwd);
  const adapter = adapterFor(home, values.adapter, deps);
  const discovered = adapter.queue();
  const entries = discovered.rows.map((row) => judgeRow(row, adapter, repos));
  if (values.json === true) {
    deps.print(JSON.stringify({ adapter: adapter.label, warning: adapter.warning, entries, notes: discovered.notes }, null, 2));
    return 0;
  }
  if (adapter.warning !== void 0) deps.print(`WARNING	${adapter.warning}`);
  deps.print(`adapter: ${adapter.label}`);
  entries.forEach((entry) => deps.print(formatEntry(entry)));
  discovered.notes.forEach((note) => deps.print(`NOTE	${note.refs}	${note.text}`));
  const skipped = skippedLine(entries);
  if (skipped !== void 0) deps.print(skipped);
  return 0;
};
var statePath = (args, deps) => {
  const { values, positionals } = parse(args);
  const repo = repoContext(resolve18(deps.cwd, values.repo ?? "."), deps.exec);
  deps.print(toSlash(reviewStatePath(repo.mainRoot, repo.remote, String(mrNumber(positionals[0])))));
  return 0;
};
var importState = (args, deps) => {
  const { values, positionals } = parse(args);
  if (positionals.length > 0) throw new UsageError2(`import-state takes no positional arguments, got ${positionals.join(" ")}`);
  const repo = repoContext(resolve18(deps.cwd, values.repo ?? "."), deps.exec);
  const dryRun = values["dry-run"] === true;
  const probe = toSlash(relative8(repo.mainRoot, reviewStatePath(repo.mainRoot, repo.remote, "0")));
  if (!dryRun && !git(["check-ignore", "-q", probe], repo.mainRoot).ok) {
    throw new EnvironmentError(`${probe} is not gitignored in ${toSlash(repo.mainRoot)}: ignore .jig/runs/ first`);
  }
  const from = values.from === void 0 ? defaultImportDir() : resolve18(deps.cwd, values.from);
  importLegacyStates({ from, mainRoot: repo.mainRoot, remote: repo.remote, dryRun }).lines.forEach((line) => deps.print(line));
  return 0;
};
var baseCheck = (args, deps) => {
  const { values } = parse(args);
  adapterFor(repoContext(deps.cwd, deps.exec), values.adapter, deps).baseCheck().forEach((line) => deps.print(line));
  return 0;
};
var spec = (args, deps) => {
  const { values, positionals } = parse(args);
  const [refs] = positionals;
  if (refs === void 0) throw new UsageError2("spec needs <refs>");
  const path2 = adapterFor(repoContext(deps.cwd, deps.exec), values.adapter, deps).spec(refs);
  if (path2 !== void 0) deps.print(path2);
  return 0;
};
var readText5 = (path2) => {
  try {
    return readFileSync37(path2, "utf8");
  } catch (error) {
    throw new EnvironmentError(`${path2}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
var reconcileCommand = (args, deps) => {
  const { positionals } = parse(args);
  const [beforePath, tallyArg] = positionals;
  if (beforePath === void 0 || tallyArg === void 0) throw new UsageError2("reconcile needs <state-before|none> <tally>");
  const tally = parseTally(tallyArg.trim().startsWith("{") ? tallyArg : readText5(resolve18(deps.cwd, tallyArg)));
  const before = beforePath === "none" ? void 0 : parseReviewState(readText5(resolve18(deps.cwd, beforePath)), beforePath);
  const result = reconcile(before, tally);
  if (result.kind === "ok") {
    deps.print(`OK	standing=${result.standing}	accounted=${result.accounted}`);
    return 0;
  }
  deps.print(`BLOCKED	${result.reason}`);
  if (result.firstRun) deps.print("first run: delete the state file this run wrote, so the next run is a full review again");
  return 1;
};
var unresolved = (args, deps) => {
  const { values, positionals } = parse(args);
  const repo = repoContext(resolve18(deps.cwd, values.repo ?? "."), deps.exec);
  deps.print(String(countUnresolved(repo.forge.discussions(mrNumber(positionals[0])))));
  return 0;
};
var standing = (args, deps) => {
  const { values, positionals } = parse(args);
  const iid = mrNumber(positionals[0]);
  const repo = repoContext(resolve18(deps.cwd, values.repo ?? "."), deps.exec);
  const state = readReviewState(reviewStatePath(repo.mainRoot, repo.remote, String(iid)));
  deps.print(String(state === void 0 ? 0 : standingBlocking(blockingFindings(state), repo.forge.discussions(iid))));
  return 0;
};
var commitsBetween = (root, from, to) => {
  if (!hasCommit(root, from) || !hasCommit(root, to)) return "unknown";
  const count = git(["rev-list", "--count", `${from}..${to}`], root);
  return count.ok ? count.stdout.trim() : "unknown";
};
var headCommand = (args, deps) => {
  const { values, positionals } = parse(args);
  const iid = mrNumber(positionals[0]);
  const repo = repoContext(resolve18(deps.cwd, values.repo ?? "."), deps.exec);
  const reviewed = values.reviewed ?? readReviewState(reviewStatePath(repo.mainRoot, repo.remote, String(iid)))?.lastReviewedSha;
  if (reviewed === void 0) throw new UsageError2(`head needs --reviewed <sha>: no last_reviewed_sha in the state of !${iid}`);
  const head = repo.forge.head(iid).sha;
  if (head === reviewed) {
    deps.print(`UNCHANGED	${head}`);
    return 0;
  }
  deps.print(`MOVED	${reviewed}	${head}	commits=${commitsBetween(repo.mainRoot, reviewed, head)}`);
  return 1;
};
var specHoldCommand = (args, deps) => {
  const { positionals } = parse(args);
  const [state, specFile] = positionals;
  if (state === void 0 || specFile === void 0) throw new UsageError2("spec-hold needs <state> <spec>");
  const parsed = parseReviewState(readText5(resolve18(deps.cwd, state)), state);
  specHold(parsed, readText5(resolve18(deps.cwd, specFile))).forEach((id) => deps.print(id));
  return 0;
};
var withdraw = (args, deps) => {
  const { values, positionals } = parse(args);
  const [mr, ...ids] = positionals;
  const iid = mrNumber(mr);
  if (ids.length === 0) throw new UsageError2("withdraw needs at least one discussion id");
  const repo = repoContext(resolve18(deps.cwd, values.repo ?? "."), deps.exec);
  const path2 = reviewStatePath(repo.mainRoot, repo.remote, String(iid));
  const me = repo.forge.me();
  const gone = [];
  const writeState2 = () => {
    const count = withdrawFromState(path2, gone);
    deps.print(existsSync22(path2) ? `state: ${toSlash(path2)} \xB7 findings withdrawn: ${count}` : "state: none");
  };
  try {
    for (const id of ids) {
      const discussion = repo.forge.discussion(iid, id);
      if (discussion === void 0) {
        gone.push(id);
        deps.print(`MISSING ${id}`);
        continue;
      }
      const notes = discussion.notes.filter((note) => !note.system);
      const other = notes.find((note) => note.author !== me);
      if (other !== void 0) {
        deps.print(`REFUSED ${id} reply by ${other.author}, a human decides`);
        continue;
      }
      if (notes.length === 0) {
        deps.print(`REFUSED ${id} no note of mine`);
        continue;
      }
      for (const note of [...notes].reverse()) repo.forge.deleteNote(iid, note.id);
      gone.push(id);
      deps.print(`DELETED ${id} ${notes.length}`);
    }
  } catch (error) {
    writeState2();
    throw error;
  }
  writeState2();
  return 0;
};
var merge = (args, deps) => {
  const { values, positionals } = parse(args);
  const [mr, keep, ...duplicates] = positionals;
  const iid = mrNumber(mr);
  if (keep === void 0 || duplicates.length === 0) throw new UsageError2("merge needs <keep-discussion-id> and at least one duplicate discussion id");
  if (values.note === void 0) throw new UsageError2("merge needs --note <file>: the reply each duplicate thread gets before it is resolved");
  const note = readText5(resolve18(deps.cwd, values.note)).trim();
  if (note === "") throw new UsageError2(`merge: ${values.note} is empty`);
  const repo = repoContext(resolve18(deps.cwd, values.repo ?? "."), deps.exec);
  if (repo.forge.discussion(iid, keep) === void 0) throw new EnvironmentError(`no thread ${keep} on !${iid} to keep`);
  const path2 = reviewStatePath(repo.mainRoot, repo.remote, String(iid));
  const me = repo.forge.me();
  const merged2 = [];
  const writeState2 = () => {
    const count = mergeInState(path2, merged2);
    deps.print(existsSync22(path2) ? `state: ${toSlash(path2)} \xB7 findings merged: ${count}` : "state: none");
  };
  try {
    for (const id of duplicates) {
      const discussion = repo.forge.discussion(iid, id);
      if (discussion === void 0) {
        deps.print(`MISSING ${id}`);
        continue;
      }
      const opening = discussion.notes.find((item) => !item.system);
      if (opening === void 0 || opening.author !== me) {
        deps.print(`REFUSED ${id} opened by ${opening?.author ?? "nobody"}, not by you`);
        continue;
      }
      repo.forge.reply(iid, id, note);
      repo.forge.resolve(iid, id);
      merged2.push(id);
      deps.print(`MERGED ${id} \u2192 ${keep}`);
    }
  } catch (error) {
    writeState2();
    throw error;
  }
  writeState2();
  return 0;
};
var HELD_ALIASES = /* @__PURE__ */ new Set(["skipped", "blocked", "stale", "unchanged", "draft", "busy", "open"]);
var isOutcome = (word) => OUTCOMES.includes(word);
var parseOutcome = (arg) => {
  const split = arg.lastIndexOf("=");
  const refs = arg.slice(0, split);
  const word = arg.slice(split + 1);
  if (split <= 0) throw new UsageError2(`expected <refs>=<outcome>, got ${arg}`);
  if (isOutcome(word)) return { refs, outcome: word };
  if (HELD_ALIASES.has(word)) return { refs, outcome: "held" };
  throw new UsageError2(`unknown outcome ${word}: expected ${OUTCOMES.join(", ")} or ${[...HELD_ALIASES].join(", ")}`);
};
var verdict = (args, deps) => {
  const { values, positionals } = parse(args);
  if (positionals.length === 0) throw new UsageError2("verdict needs <refs>=<outcome>...");
  const outcomes = positionals.map(parseOutcome);
  const adapter = adapterFor(repoContext(deps.cwd, deps.exec), values.adapter, deps);
  const lines2 = applyVerdicts(adapter, foldVerdicts(outcomes), values["dry-run"] === true);
  lines2.forEach((line) => deps.print(line.text));
  return lines2.some((line) => line.failed) ? 3 : 0;
};
var subcommands = /* @__PURE__ */ new Map([
  ["queue", queue],
  ["state-path", statePath],
  ["import-state", importState],
  ["base-check", baseCheck],
  ["spec", spec],
  ["reconcile", reconcileCommand],
  ["unresolved", unresolved],
  ["standing", standing],
  ["head", headCommand],
  ["spec-hold", specHoldCommand],
  ["withdraw", withdraw],
  ["merge", merge],
  ["verdict", verdict]
]);
var runReviewCycleWith = (args, deps) => {
  const [name, ...rest] = args;
  const subcommand = name === void 0 ? void 0 : subcommands.get(name);
  if (subcommand === void 0) {
    process.stderr.write(`${USAGE8}
`);
    return 2;
  }
  try {
    return subcommand(rest, deps);
  } catch (error) {
    if (error instanceof UsageError2) {
      process.stderr.write(`jig review-cycle ${name}: ${error.message}
${USAGE8}
`);
      return 2;
    }
    if (error instanceof EnvironmentError || error instanceof BlockedRefError) {
      process.stderr.write(`ERROR ${error.message}
`);
      return error.exitCode;
    }
    throw error;
  }
};
var runReviewCycle = (args) => runReviewCycleWith(args, { exec: spawnExec, cwd: process.cwd(), print: (line) => process.stdout.write(`${line}
`) });

// src/slot/slot.ts
import { spawnSync as spawnSync8 } from "node:child_process";
import { existsSync as existsSync23, mkdirSync as mkdirSync19, readFileSync as readFileSync39, rmSync as rmSync12, writeFileSync as writeFileSync15 } from "node:fs";
import { basename as basename10, dirname as dirname19, isAbsolute as isAbsolute9, join as join42, relative as relative9, resolve as resolve19 } from "node:path";
import { parseArgs as parseArgs7 } from "node:util";

// src/slot/guard.ts
import { spawnSync as spawnSync7 } from "node:child_process";
import { mkdirSync as mkdirSync18, readFileSync as readFileSync38, rmSync as rmSync11, writeFileSync as writeFileSync14 } from "node:fs";
import { dirname as dirname18, join as join41 } from "node:path";
var HOLD_WINDOW_MS = 2 * 60 * 60 * 1e3;
var MAX_ANCESTORS = 12;
var REFLOG_LIMIT = "50";
var SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "cmd", "powershell", "pwsh", "conhost"]);
var SESSION_ENV = [
  ["CLAUDE_CODE_SESSION_ID", "claude"],
  ["CLAUDE_SESSION_ID", "claude"]
];
var processInfoOf = (pid) => {
  const result = process.platform === "win32" ? spawnSync7(
    "powershell",
    ["-NoProfile", "-Command", `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { "$($p.ParentProcessId) $($p.Name)" }`],
    { encoding: "utf8", windowsHide: true }
  ) : spawnSync7("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8" });
  const match = result.status === 0 ? /^\s*(\d+)\s+(.+?)\s*$/m.exec(result.stdout) : null;
  return match?.[1] === void 0 || match[2] === void 0 ? void 0 : { ppid: Number(match[1]), name: match[2] };
};
var isShell = (name) => SHELLS.has(name.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase());
var firstNonShellAncestor = (ppid, infoOf) => {
  let pid = ppid;
  for (let depth = 0; depth < MAX_ANCESTORS; depth++) {
    const info = infoOf(pid);
    if (info === void 0 || !isShell(info.name) || info.ppid <= 1) return pid;
    pid = info.ppid;
  }
  return pid;
};
var ownerIdOf = ({ flag, env = process.env, ppid = process.ppid, infoOf = processInfoOf }) => {
  if (flag !== void 0 && flag !== "") return flag;
  for (const [variable, agent] of SESSION_ENV) {
    const value = env[variable];
    if (value !== void 0 && value !== "") return `${agent}:${value}`;
  }
  return `pid:${firstNonShellAncestor(ppid, infoOf)}`;
};
var ownerMarkerPath = (dir2) => {
  const gitDir = git(["rev-parse", "--absolute-git-dir"], dir2);
  return join41(gitDir.ok ? gitDir.stdout.trim() : join41(dir2, ".git"), "jig", "slot-owner.json");
};
var readOwner = (dir2) => {
  try {
    const marker = JSON.parse(readFileSync38(ownerMarkerPath(dir2), "utf8"));
    return typeof marker.owner === "string" && typeof marker.commit === "string" && typeof marker.at === "number" ? marker : void 0;
  } catch {
    return void 0;
  }
};
var writeOwner = (dir2, { owner, commit, now = Date.now() }) => {
  const path2 = ownerMarkerPath(dir2);
  mkdirSync18(dirname18(path2), { recursive: true });
  writeFileSync14(path2, `${JSON.stringify({ owner, commit, at: now })}
`);
};
var clearOwner = (dir2) => {
  rmSync11(ownerMarkerPath(dir2), { force: true });
};
var minutesOf = (ms) => Math.max(0, Math.round(ms / 6e4));
var recentCheckoutEntry = (dir2, now) => {
  const log = git(["reflog", "show", "--date=unix", "--format=%gd%x09%gs", "-n", REFLOG_LIMIT, "HEAD"], dir2);
  if (!log.ok) return void 0;
  const lines2 = log.stdout.split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines2.entries()) {
    const [selector, subject] = line.split("	");
    const seconds = Number(/\{(\d+)\}$/.exec(selector ?? "")?.[1]);
    if (subject === void 0 || !subject.startsWith("checkout:") || !Number.isFinite(seconds)) continue;
    const age = now - seconds * 1e3;
    return age > HOLD_WINDOW_MS ? void 0 : `HEAD@{${index}}: ${subject} (${minutesOf(age)} min ago)`;
  }
  return void 0;
};
var refusalOf = ({ dir: dir2, owner, now = Date.now() }) => {
  const marker = readOwner(dir2);
  if (marker === void 0 || marker.owner === owner) return void 0;
  const age = now - marker.at;
  if (age < HOLD_WINDOW_MS) return `held by ${marker.owner}, which showed ${marker.commit.slice(0, 7)} ${minutesOf(age)} min ago`;
  const head = git(["rev-parse", "HEAD"], dir2);
  if (!head.ok || head.stdout.trim() === marker.commit) return void 0;
  const entry = recentCheckoutEntry(dir2, now);
  return entry === void 0 ? void 0 : `moved by a git checkout outside jig since ${marker.owner} showed ${marker.commit.slice(0, 7)}: ${entry}`;
};

// src/worktree/lockfiles.ts
import { posix as posix7 } from "node:path";
var installSteps = (changed, install, lockfiles = LOCKFILES) => {
  const byName = new Map(lockfiles.map((lockfile) => [lockfile.file, lockfile.install]));
  const detected = changed.flatMap((raw) => {
    const path2 = raw.replace(/\\/g, "/");
    const command = byName.get(posix7.basename(path2));
    return command === void 0 ? [] : [{ dir: posix7.dirname(path2), command }];
  });
  if (detected.length === 0) return [];
  if (install !== void 0) return [{ dir: ".", command: install }];
  return [...new Map(detected.map((step) => [`${step.dir}\0${step.command}`, step])).values()];
};

// src/slot/slot.ts
var SLOT_LOCK = "slot.lock";
var AGENT_VIEW_CONFIG2 = "agent-view.config.json";
var SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var NO_VALUE = "none";
var fail3 = (message, code) => {
  process.stderr.write(`jig: ${message}
`);
  return code;
};
var print = (text3) => {
  process.stdout.write(`${text3}
`);
};
var escapeRegExp = (text3) => text3.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var slotNumber = (dirName, repo) => {
  const match = new RegExp(`^${escapeRegExp(repo)}-s(\\d+)(?:-|$)`).exec(dirName);
  if (match?.[1] === void 0) return void 0;
  const slot = Number(match[1]);
  return slot >= 1 ? slot : void 0;
};
var slotWorktrees = (worktrees, repo) => worktrees.flatMap((worktree) => {
  const slot = slotNumber(basename10(worktree.path), repo);
  return slot === void 0 ? [] : [{ ...worktree, slot }];
});
var findDuplicates = (slots) => {
  const bySlot = /* @__PURE__ */ new Map();
  for (const slot of slots) {
    bySlot.set(slot.slot, [...bySlot.get(slot.slot) ?? [], slot]);
  }
  return new Map([...bySlot].filter(([, group]) => group.length > 1));
};
var lowestFreeSlot = (slots) => {
  const taken = new Set(slots.map((slot2) => slot2.slot));
  let slot = 1;
  while (taken.has(slot)) {
    slot++;
  }
  return slot;
};
var slotDirName = (repo, slot, slug) => slug === void 0 ? `${repo}-s${slot}` : `${repo}-s${slot}-${slug}`;
var slotPorts = (config, slot) => Object.fromEntries(Object.entries(config.ports ?? {}).map(([key, port]) => [key, port.base + slot * port.step]));
var slotCdpPort = (config, slot) => config.cdp === void 0 ? void 0 : config.cdp.base + slot * config.cdp.step;
var setEnvValue = (text3, key, value) => {
  const eol = text3.includes("\r\n") ? "\r\n" : "\n";
  const line = new RegExp(`^([ \\t]*(?:export[ \\t]+)?)${escapeRegExp(key)}[ \\t]*=.*$`, "gm");
  if (line.test(text3)) return text3.replace(line, (_match, prefix) => `${prefix}${key}=${value}`);
  const separator = text3 === "" || text3.endsWith("\n") ? "" : eol;
  return `${text3}${separator}${key}=${value}${eol}`;
};
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
var slotUrl = (url, ports, slot) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!LOCAL_HOSTS.has(parsed.hostname) || parsed.port === "") return url;
  const port = Object.values(ports).find((entry) => entry.base === Number(parsed.port));
  if (port === void 0) return void 0;
  parsed.port = String(port.base + slot * port.step);
  return parsed.toString();
};
var agentViewConfig = (base, config, slot, cdpPort) => {
  const result = { ...base, port: cdpPort };
  if (typeof base["url"] === "string") {
    const url = slotUrl(base["url"], config.ports ?? {}, slot);
    if (url === void 0) {
      delete result["url"];
      process.stderr.write(`jig: agent-view url ${base["url"]} names a local port no slots.ports entry starts at: left out of the slot's ${AGENT_VIEW_CONFIG2}
`);
    } else {
      result["url"] = url;
    }
  }
  const runtime = config.verifyRuntime ?? config.runtime;
  if (runtime !== void 0 && runtime !== "none") {
    result["runtime"] = runtime;
  }
  if (result["launch"] === void 0 && config.dev !== void 0) {
    result["launch"] = config.dev;
  }
  return result;
};
var formatPorts = (ports) => {
  const entries = Object.entries(ports).map(([key, value]) => `${key}=${value}`);
  return entries.length === 0 ? NO_VALUE : entries.join(" ");
};
var loadContext = () => {
  const projectRoot = resolveProjectRoot(process.cwd());
  const config = loadConfig(projectRoot);
  if (config.error !== void 0) throw new Error(`.jig/config.jsonc: ${config.error}`);
  const mainRoot = listWorktrees(projectRoot)[0]?.path ?? projectRoot;
  const context = { projectRoot, mainRoot, repo: basename10(mainRoot) };
  if (config.slots !== void 0) {
    context.slots = config.slots;
  }
  if (config.worktree !== void 0) {
    context.worktree = config.worktree;
  }
  return context;
};
var formatDuplicates = (duplicates) => [...duplicates].map(([slot, group]) => `s${slot}: ${group.map((worktree) => toSlash(worktree.path)).join(", ")}`).join("; ");
var isTracked2 = (dir2, file) => git(["ls-files", "--error-unmatch", "--", file], dir2).ok;
var writeLocalFile = (dir2, file, content) => {
  const path2 = join42(dir2, file);
  mkdirSync19(dirname19(path2), { recursive: true });
  writeFileSync15(path2, content);
  if (isTracked2(dir2, file)) {
    git(["update-index", "--skip-worktree", "--", file], dir2);
  }
};
var insideDir = (dir2, file) => {
  const path2 = resolve19(dir2, file);
  const rel = relative9(dir2, path2);
  if (rel === "" || rel.startsWith("..") || isAbsolute9(rel)) throw new Error(`path ${file} leaves the slot dir`);
  return path2;
};
var writeEnv = (dir2, target, key, value) => {
  const path2 = insideDir(dir2, target);
  const text3 = existsSync23(path2) ? readFileSync39(path2, "utf8") : "";
  writeLocalFile(dir2, target, setEnvValue(text3, key, String(value)));
};
var writePorts = (dir2, slots, slot) => {
  for (const [key, port] of Object.entries(slots.ports ?? {})) {
    writeEnv(dir2, port.target, key, port.base + slot * port.step);
  }
  if (slots.slotEnv !== void 0) {
    writeEnv(dir2, slots.slotEnv.target, slots.slotEnv.key, slot);
  }
};
var readJsonObject = (path2) => {
  if (!existsSync23(path2)) return {};
  const value = parseJsonc(readFileSync39(path2, "utf8"));
  const isObject7 = typeof value === "object" && value !== null && !Array.isArray(value);
  return isObject7 ? value : {};
};
var writeAgentView = (mainRoot, dir2, slots, slot, cdpPort) => {
  const own = join42(dir2, AGENT_VIEW_CONFIG2);
  const base = readJsonObject(existsSync23(own) ? own : join42(mainRoot, AGENT_VIEW_CONFIG2));
  writeLocalFile(dir2, AGENT_VIEW_CONFIG2, `${JSON.stringify(agentViewConfig(base, slots, slot, cdpPort), null, 2)}
`);
};
var branchExists = (cwd, branch) => git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd).ok;
var worktreeAddArgs = (cwd, dir2, branch) => {
  if (branch === void 0) return ["worktree", "add", "--detach", dir2];
  return branchExists(cwd, branch) ? ["worktree", "add", dir2, branch] : ["worktree", "add", dir2, "-b", branch];
};
var reserveSlot = async (context, slots, options) => {
  const lock = await acquireLock(join42(ensureJigDir(context.mainRoot).cache, SLOT_LOCK));
  if (lock === void 0) return fail3("slot new is running elsewhere, retry", 1);
  try {
    git(["worktree", "prune"], context.projectRoot);
    const worktrees = listWorktrees(context.projectRoot);
    const taken = slotWorktrees(worktrees, context.repo);
    const duplicates = findDuplicates(taken);
    if (duplicates.size > 0) return fail3(`duplicate slot numbers: ${formatDuplicates(duplicates)}`, 1);
    for (const prunable of taken.filter((worktree) => worktree.isPrunable)) {
      process.stderr.write(`jig: s${prunable.slot} stays prunable after prune: ${toSlash(prunable.path)}
`);
    }
    const slot = lowestFreeSlot(taken);
    const dir2 = resolve19(context.mainRoot, slots.worktreesDir, slotDirName(context.repo, slot, options.slug));
    const added = git(worktreeAddArgs(context.projectRoot, dir2, options.branch), context.projectRoot);
    if (!added.ok) return fail3(`git worktree add failed: ${added.stderr.trim()}`, 2);
    return { slot, dir: dir2 };
  } finally {
    lock.release();
  }
};
var runInstall = (install, dir2) => spawnSync8(install, { cwd: dir2, shell: true, windowsHide: true, stdio: ["ignore", 2, 2] }).status;
var poolDeps = (context, dir2) => {
  const depsPool = context.worktree?.depsPool;
  if (depsPool === void 0) return void 0;
  const outcome = provideDeps(dir2, { main: context.mainRoot, install: context.slots?.install, after: depsPool.after });
  for (const line of formatDeps(outcome)) {
    process.stderr.write(`jig: ${line}
`);
  }
  return outcome;
};
var isPoolServed = (outcome) => outcome !== void 0 && outcome.kind !== "skipped";
var slotNew = async (args) => {
  const { values } = parseArgs7({ args, options: { slug: { type: "string" }, branch: { type: "string" } }, strict: true });
  const slug = values.slug;
  if (slug !== void 0 && !SLUG.test(slug)) return fail3(`invalid --slug ${slug}: use letters, digits, ., _, -`, 2);
  const context = loadContext();
  const slots = context.slots;
  if (slots === void 0) return fail3("no slots section in .jig/config.jsonc: a human fills it (see skill jig-slots)", 1);
  const reserved = await reserveSlot(context, slots, {
    ...slug === void 0 ? {} : { slug },
    ...values.branch === void 0 ? {} : { branch: values.branch }
  });
  if (typeof reserved === "number") return reserved;
  const { slot, dir: dir2 } = reserved;
  for (const line of formatSeed(seedWorktree(context.mainRoot, dir2, context.worktree))) {
    process.stderr.write(`jig: ${line}
`);
  }
  writePorts(dir2, slots, slot);
  const cdpPort = slotCdpPort(slots, slot);
  if (cdpPort !== void 0) {
    writeAgentView(context.mainRoot, dir2, slots, slot, cdpPort);
  }
  for (const cache of slots.clearCache ?? []) {
    rmSync12(insideDir(dir2, cache), { recursive: true, force: true });
  }
  const deps = poolDeps(context, dir2);
  if (deps?.kind === "failed") return fail3(`install failed in slot ${slot} ${toSlash(dir2)}: ${deps.detail}`, 1);
  if (!isPoolServed(deps) && slots.install !== void 0) {
    const status = runInstall(slots.install, dir2);
    if (status !== 0) return fail3(`install failed (exit ${status}) in slot ${slot} ${toSlash(dir2)}`, 1);
  }
  print(`slot ${slot} ${toSlash(dir2)} ports ${formatPorts(slotPorts(slots, slot))} cdp ${cdpPort ?? NO_VALUE}`);
  return 0;
};
var slotLs = (args) => {
  const { values } = parseArgs7({ args, options: { json: { type: "boolean" } }, strict: true });
  const context = loadContext();
  const rows = slotWorktrees(listWorktrees(context.projectRoot), context.repo).sort((left, right) => left.slot - right.slot).map((worktree) => ({
    slot: worktree.slot,
    path: toSlash(worktree.path),
    branch: worktree.branch ?? null,
    ports: context.slots === void 0 ? {} : slotPorts(context.slots, worktree.slot),
    cdp: context.slots === void 0 ? null : slotCdpPort(context.slots, worktree.slot) ?? null
  }));
  if (values.json === true) {
    print(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const row of rows) {
    print(`s${row.slot}  ${row.path}  ${row.branch ?? "(detached)"}  ports ${formatPorts(row.ports)}  cdp ${row.cdp ?? NO_VALUE}`);
  }
  return 0;
};
var parseSlotNumber = (text3) => {
  const slot = Number(text3?.replace(/^s/, ""));
  return Number.isInteger(slot) && slot >= 1 ? slot : void 0;
};
var findSlot = (context, slot) => {
  const matches = slotWorktrees(listWorktrees(context.projectRoot), context.repo).filter((worktree2) => worktree2.slot === slot);
  const [worktree] = matches;
  if (worktree === void 0) return `no slot ${slot}`;
  if (matches.length > 1) return `duplicate slot numbers: ${formatDuplicates(/* @__PURE__ */ new Map([[slot, matches]]))}`;
  return worktree;
};
var trackedChanges = (dir2) => git(["status", "--porcelain=v1", "--untracked-files=no"], dir2).stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3));
var slotRm = (args) => {
  const { values, positionals } = parseArgs7({
    args,
    options: { force: { type: "boolean" } },
    allowPositionals: true,
    strict: true
  });
  const slot = parseSlotNumber(positionals[0]);
  if (positionals.length !== 1 || slot === void 0) return fail3("usage: slot rm <N> [--force]", 2);
  const context = loadContext();
  const worktree = findSlot(context, slot);
  if (typeof worktree === "string") return fail3(worktree, 1);
  const changes = trackedChanges(worktree.path);
  if (values.force !== true && changes.length > 0) {
    return fail3(`slot ${slot} has tracked changes, commit them or pass --force: ${changes.join(", ")}`, 1);
  }
  const removed = removeLinkedWorktree(worktree.path, context.projectRoot);
  if (removed.error !== void 0) return fail3(`git worktree remove failed: ${removed.error}`, 1);
  print(`removed ${toSlash(worktree.path)}`);
  return 0;
};
var headOf = (dir2) => {
  const result = git(["rev-parse", "HEAD"], dir2);
  return result.ok ? result.stdout.trim() : void 0;
};
var changedFiles2 = (dir2, from, to) => from === to ? [] : git(["diff", "--name-only", "-z", from, to], dir2).stdout.split("\0").filter(Boolean);
var slotRelease = (args) => {
  const { positionals } = parseArgs7({ args, options: {}, allowPositionals: true, strict: true });
  const slot = parseSlotNumber(positionals[0]);
  if (positionals.length !== 1 || slot === void 0) return fail3("usage: slot release <N>", 2);
  const worktree = findSlot(loadContext(), slot);
  if (typeof worktree === "string") return fail3(worktree, 1);
  clearOwner(worktree.path);
  print(`slot ${slot} released`);
  return 0;
};
var slotShow = (args) => {
  const { values, positionals } = parseArgs7({
    args,
    options: { force: { type: "boolean" }, owner: { type: "string" } },
    allowPositionals: true,
    strict: true
  });
  const [slotText, ref] = positionals;
  const slot = parseSlotNumber(slotText);
  if (positionals.length !== 2 || slot === void 0 || ref === void 0) return fail3("usage: slot show <N> <branch|commit> [--force] [--owner <id>]", 2);
  const context = loadContext();
  const worktree = findSlot(context, slot);
  if (typeof worktree === "string") return fail3(worktree, 1);
  const changes = trackedChanges(worktree.path);
  if (changes.length > 0) {
    return fail3(`slot ${slot} has tracked changes; a slot only shows branches, edits belong in a feature worktree: ${changes.join(", ")}`, 1);
  }
  const owner = ownerIdOf({ flag: values.owner });
  if (values.force !== true) {
    const reason = refusalOf({ dir: worktree.path, owner });
    if (reason !== void 0) {
      return fail3(`slot ${slot} is ${reason}; switching it to ${ref} can break that work: pass --force to take the slot over (you are ${owner})`, 1);
    }
  }
  const before = headOf(worktree.path);
  const checkout = git(["checkout", "--detach", ref], worktree.path);
  if (!checkout.ok) return fail3(`git checkout --detach ${ref} failed in slot ${slot}: ${checkout.stderr.trim()}`, 1);
  const after = headOf(worktree.path);
  if (after !== void 0) writeOwner(worktree.path, { owner, commit: after });
  const changed = before === void 0 || after === void 0 ? [] : changedFiles2(worktree.path, before, after);
  const steps = installSteps(changed, context.slots?.install);
  const isRootDepsChange = steps.some((step) => step.dir === ".") || hasIgnoredLockKeyChange(worktree.path, changed);
  const deps = isRootDepsChange ? poolDeps(context, worktree.path) : void 0;
  if (deps?.kind === "failed") return fail3(`install failed in slot ${slot} ${toSlash(worktree.path)}: ${deps.detail}`, 1);
  for (const step of steps.filter((candidate) => candidate.dir !== "." || !isPoolServed(deps))) {
    process.stderr.write(`jig: lock file changed, running ${step.command} in ${step.dir}
`);
    const status = runInstall(step.command, resolve19(worktree.path, step.dir));
    if (status !== 0) return fail3(`install failed (exit ${status}) in slot ${slot} ${toSlash(worktree.path)}`, 1);
  }
  print(`slot ${slot} ${toSlash(worktree.path)} at ${(after ?? "").slice(0, 12)} ${ref}`);
  return 0;
};
var subcommands2 = /* @__PURE__ */ new Map([
  ["new", slotNew],
  ["show", slotShow],
  ["release", slotRelease],
  ["ls", slotLs],
  ["rm", slotRm]
]);
var runSlot = (args) => {
  const [name, ...rest] = args;
  const subcommand = name === void 0 ? void 0 : subcommands2.get(name);
  if (subcommand === void 0) return fail3(`usage: slot <${[...subcommands2.keys()].join("|")}>`, 2);
  return subcommand(rest);
};

// src/worktree/worktree.ts
import { existsSync as existsSync24 } from "node:fs";
import { basename as basename12, resolve as resolve21 } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs as parseArgs8 } from "node:util";

// src/worktree/sweep.ts
import { spawnSync as spawnSync9 } from "node:child_process";
import { basename as basename11, resolve as resolve20 } from "node:path";
var KEPT_BUCKETS = /* @__PURE__ */ new Set(["hold-current", "hold-locked", "hold-wip"]);
var RECENT_MS = 24 * 60 * 60 * 1e3;
var MS_PER_SECOND = 1e3;
var SLOT_ITEM = /^s?(\d+)$/;
var runJson = (bin, args, cwd) => {
  const result = spawnSync9(bin, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return void 0;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return void 0;
  }
};
var branchNames = (value, field) => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item[field] === "string" ? [item[field]] : []);
};
var openMrBranches = (cwd) => {
  const remote = git(["remote", "get-url", "origin"], cwd).stdout;
  const isGithub = (loadConfig(cwd).reviewCycle?.forge ?? detectForge(remote)) === "github";
  const tool = isGithub ? findInPath("gh") : findInPath("glab");
  if (tool === void 0) return /* @__PURE__ */ new Set();
  const branches = isGithub ? branchNames(runJson(tool, ["pr", "list", "--state", "open", "--limit", "200", "--json", "headRefName"], cwd), "headRefName") : branchNames(runJson(tool, ["mr", "list", "--per-page", "100", "--output", "json"], cwd), "source_branch");
  return new Set(branches);
};
var isRecent = (path2, now) => {
  const result = git(["log", "-1", "--format=%ct"], path2);
  const committedAt = Number(result.stdout.trim()) * MS_PER_SECOND;
  return result.ok && now - committedAt < RECENT_MS;
};
var bucketOf = (worktree, scope) => {
  if (worktree.isPrunable) return "prunable";
  if (scope.current !== void 0 && samePath(worktree.path, scope.current)) return "hold-current";
  if (worktree.isLocked) return "hold-locked";
  const status = git(["status", "--porcelain=v1"], worktree.path);
  if (!status.ok || status.stdout.trim() !== "") return "hold-wip";
  if (worktree.branch !== void 0 && scope.openBranches.has(worktree.branch)) return "hold-open-mr";
  return isRecent(worktree.path, scope.now) ? "recent" : "safe";
};
var auditWorktrees = (worktrees, scope) => worktrees.filter((worktree) => !samePath(worktree.path, scope.mainRoot)).map((worktree) => ({
  bucket: bucketOf(worktree, scope),
  slot: slotNumber(basename11(worktree.path), scope.repo) ?? null,
  path: toSlash(worktree.path),
  branch: worktree.branch ?? null
}));
var currentWorktree = (cwd) => gitToplevel(cwd);
var matchItems = (rows, items, cwd) => {
  const matched = [];
  const unknown = [];
  for (const item of items) {
    const slot = SLOT_ITEM.exec(item)?.[1];
    const row = rows.find(
      (candidate) => slot === void 0 ? samePath(candidate.path, resolve20(cwd, item)) : candidate.slot === Number(slot)
    );
    if (row === void 0) {
      unknown.push(item);
    } else if (!matched.includes(row)) {
      matched.push(row);
    }
  }
  return { rows: matched, unknown };
};
var removeWorktree = (row, mainRoot) => {
  if (row.bucket !== "prunable") return removeLinkedWorktree(row.path, mainRoot).error;
  const result = git(["worktree", "prune"], mainRoot);
  return result.ok ? void 0 : result.stderr.trim();
};
var formatRow2 = (row) => `${row.bucket}  ${row.path}  ${row.branch ?? "(detached)"}${row.slot === null ? "" : `  slot ${row.slot}`}`;

// src/worktree/worktree.ts
var fail4 = (message, code) => {
  process.stderr.write(`jig: ${message}
`);
  return code;
};
var print2 = (text3) => {
  process.stdout.write(`${text3}
`);
};
var mainCheckout = (cwd) => {
  const main = listWorktrees(cwd)[0]?.path;
  if (main === void 0) throw new Error(`no git worktrees found from ${toSlash(cwd)}`);
  return main;
};
var checkoutTarget = (positionals, usage2) => {
  const [target] = positionals;
  if (positionals.length !== 1 || target === void 0) return fail4(`usage: ${usage2}`, 2);
  const dir2 = resolve21(target);
  if (!existsSync24(dir2)) return fail4(`no such dir ${toSlash(dir2)}`, 1);
  const toplevel = gitToplevel(dir2);
  if (toplevel === void 0 || !samePath(toplevel, dir2)) return fail4(`${toSlash(dir2)} is not the root of a git worktree`, 1);
  const main = mainCheckout(dir2);
  const config = loadConfig(main);
  if (config.error !== void 0) return fail4(`.jig/config.jsonc: ${config.error}`, 1);
  return { dir: dir2, main, config };
};
var worktreeSeed = (args) => {
  const { positionals } = parseArgs8({ args, options: {}, allowPositionals: true, strict: true });
  const target = checkoutTarget(positionals, "worktree seed <dir>");
  if (typeof target === "number") return target;
  if (samePath(target.main, target.dir)) return fail4(`${toSlash(target.dir)} is the main checkout, seed fills another worktree from it`, 1);
  const items = seedWorktree(target.main, target.dir, target.config.worktree);
  for (const line of formatSeed(items)) {
    print2(line);
  }
  return items.some((item) => item.action === "failed") ? 1 : 0;
};
var DEPS_USAGE = "worktree deps <dir> [--save [--force] | --refresh] | worktree deps --prune [--dry-run]";
var worktreeDeps = (args) => {
  const { values, positionals } = parseArgs8({
    args,
    options: { save: { type: "boolean" }, force: { type: "boolean" }, refresh: { type: "boolean" }, prune: { type: "boolean" }, "dry-run": { type: "boolean" } },
    allowPositionals: true,
    strict: true
  });
  const isSave = values.save === true;
  const refresh = values.refresh === true;
  if (values.prune === true) {
    if (positionals.length > 0 || isSave || refresh || values.force === true) return fail4(`usage: ${DEPS_USAGE}`, 2);
    const pruned = prunePool(mainCheckout(process.cwd()), values["dry-run"] === true);
    formatPrune(pruned).forEach((line) => print2(line));
    return pruned.kind === "failed" ? 1 : 0;
  }
  if (values["dry-run"] === true || values.force === true && !isSave || refresh && isSave) return fail4(`usage: ${DEPS_USAGE}`, 2);
  const target = checkoutTarget(positionals, DEPS_USAGE);
  if (typeof target === "number") return target;
  const { dir: dir2, main, config } = target;
  const install = config.slots?.install;
  const outcome = isSave ? saveDeps(dir2, { main, install, force: values.force }) : provideDeps(dir2, { main, install, after: config.worktree?.depsPool?.after, refresh });
  formatDeps(outcome).forEach((line) => print2(line));
  return outcome.kind === "failed" ? 1 : 0;
};
var worktreeRemove = (args) => {
  const { positionals } = parseArgs8({ args, options: {}, allowPositionals: true, strict: true });
  const [target] = positionals;
  if (positionals.length !== 1 || target === void 0) return fail4("usage: worktree remove <dir>", 2);
  const dir2 = resolve21(target);
  const worktrees = listWorktrees(existsSync24(dir2) ? dir2 : process.cwd());
  const main = worktrees[0]?.path;
  if (main === void 0) return fail4(`no git worktrees found from ${toSlash(dir2)}`, 1);
  if (samePath(main, dir2)) return fail4(`${toSlash(dir2)} is the main checkout, remove takes a linked worktree`, 1);
  if (!worktrees.some((worktree) => samePath(worktree.path, dir2))) return fail4(`${toSlash(dir2)} is not a worktree of ${toSlash(main)}`, 1);
  const removal = removeLinkedWorktree(dir2, main);
  if (removal.error !== void 0) return fail4(`could not remove ${toSlash(dir2)}: ${removal.error}`, 1);
  print2(`removed ${toSlash(dir2)} (${removal.unlinked} links unlinked first)`);
  return 0;
};
var terminalConfirm = () => {
  if (process.stdin.isTTY !== true) return void 0;
  return async (question) => {
    const prompt2 = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return /^y(es)?$/i.test((await prompt2.question(`${question} [y/N] `)).trim());
    } finally {
      prompt2.close();
    }
  };
};
var removeRows = (rows, mainRoot) => {
  let code = 0;
  for (const row of rows) {
    if (KEPT_BUCKETS.has(row.bucket)) {
      code = fail4(`kept ${row.path}: ${row.bucket}`, 1);
      continue;
    }
    const error = removeWorktree(row, mainRoot);
    if (error === void 0) {
      print2(`removed ${row.path}`);
    } else {
      code = fail4(`git could not remove ${row.path}: ${error}`, 1);
    }
  }
  return code;
};
var worktreeSweep = async (args, confirm = terminalConfirm()) => {
  const { values } = parseArgs8({
    args,
    options: { json: { type: "boolean" }, ask: { type: "boolean" }, yes: { type: "string", multiple: true } },
    strict: true
  });
  const projectRoot = resolveProjectRoot(process.cwd());
  const worktrees = listWorktrees(projectRoot);
  const mainRoot = worktrees[0]?.path ?? projectRoot;
  const rows = auditWorktrees(worktrees, {
    mainRoot,
    repo: basename12(mainRoot),
    current: currentWorktree(process.cwd()),
    openBranches: openMrBranches(projectRoot),
    now: Date.now()
  });
  if (values.json === true) {
    print2(JSON.stringify(rows, null, 2));
  } else {
    rows.forEach((row) => print2(formatRow2(row)));
  }
  const named = matchItems(rows, values.yes ?? [], process.cwd());
  if (named.unknown.length > 0) return fail4(`not a worktree of this repo: ${named.unknown.join(", ")}`, 1);
  if (values.ask === true) {
    if (confirm === void 0) return fail4("--ask needs an interactive terminal; ask the user, then pass --yes <path|slot> per item", 1);
    for (const row of rows.filter((candidate) => !KEPT_BUCKETS.has(candidate.bucket) && !named.rows.includes(candidate))) {
      if (await confirm(`remove ${row.bucket} ${row.path}?`)) {
        named.rows.push(row);
      }
    }
  }
  return removeRows(named.rows, mainRoot);
};
var subcommands3 = /* @__PURE__ */ new Map([
  ["seed", worktreeSeed],
  ["deps", worktreeDeps],
  ["remove", worktreeRemove],
  ["sweep", (args) => worktreeSweep(args)]
]);
var runWorktree = (args) => {
  const [name, ...rest] = args;
  const subcommand = name === void 0 ? void 0 : subcommands3.get(name);
  if (subcommand === void 0) return fail4(`usage: worktree <${[...subcommands3.keys()].join("|")}>`, 2);
  return subcommand(rest);
};

// src/cli/main.ts
var EXIT_FAILURE = 2;
var MIN_NODE_MAJOR2 = 20;
var runVersion = () => {
  process.stdout.write(`jig ${version}
`);
  return 0;
};
var commands = /* @__PURE__ */ new Map([
  ["hook", runHook],
  ["hooks", runHooks],
  ["check", runCheck],
  ["build", runBuild],
  ["atom", runAtom],
  ["context", runContext],
  ["slot", runSlot],
  ["worktree", runWorktree],
  ["task-status", runTaskStatus],
  ["loop", runLoop],
  ["init", runInit],
  ["doctor", runDoctor],
  ["tiers", runTiers],
  ["review", runReview],
  ["review-plan", runReviewPlan],
  ["review-cycle", runReviewCycle],
  ["pre-mr", runPreMr],
  ["skip-verify", runSkipVerify],
  ["version", runVersion]
]);
var fail5 = (message) => {
  process.stderr.write(`jig: ${message}
`);
  return EXIT_FAILURE;
};
var run2 = async (argv) => {
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  if (nodeMajor < MIN_NODE_MAJOR2) {
    return fail5(`Node >= ${MIN_NODE_MAJOR2} required, found ${nodeVersion}`);
  }
  const [name, ...args] = argv;
  if (name === void 0) {
    return fail5(`missing command, expected one of: ${[...commands.keys()].join(", ")}`);
  }
  const command = commands.get(name);
  if (command === void 0) {
    return fail5(`unknown command ${name}`);
  }
  try {
    return await command(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail5(message);
  }
};
process.exitCode = await run2(process.argv.slice(2));

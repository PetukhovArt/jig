#!/usr/bin/env node

// package.json
var version = "0.1.0";

// src/atoms/atoms.ts
import { readdirSync as readdirSync7, readFileSync as readFileSync12 } from "node:fs";
import { basename as basename3, join as join10 } from "node:path";

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
  const { text: text2 } = cursor;
  let value = "";
  let index = cursor.index + 1;
  while (index < text2.length) {
    const char = text2[index] ?? "";
    if (char === '"') {
      cursor.index = index + 1;
      return value;
    }
    if (char !== "\\") {
      value += char;
      index++;
      continue;
    }
    const escape = text2[index + 1] ?? "";
    if (escape === "u") {
      const hex = text2.slice(index + 2, index + 6);
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
  const { text: text2 } = cursor;
  let value = "";
  let index = cursor.index + 1;
  while (index < text2.length) {
    const char = text2[index] ?? "";
    if (char !== "'") {
      value += char;
      index++;
      continue;
    }
    if (text2[index + 1] === "'") {
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
var stripPlainComment = (text2) => {
  const match = /(^|\s)#/.exec(text2);
  return (match ? text2.slice(0, match.index) : text2).trim();
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
var readScalar = (text2, line) => {
  const cursor = { text: text2, index: 0, line };
  const value = readInlineValue(cursor);
  if (Array.isArray(value)) return fail(cursor, "nested arrays are not supported");
  return value;
};
var isSkippable = (line) => line.trim() === "" || line.trimStart().startsWith("#");
var readList = (lines, from, firstLine4) => {
  const items = [];
  let index = from;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const item = LIST_ITEM.exec(line);
    if (!item && !isSkippable(line)) break;
    index++;
    if (item) items.push(readScalar(item[1] ?? "", firstLine4 + index - 1));
  }
  return { value: items, next: index };
};
var readMap = (lines, from, firstLine4, indent) => {
  const map = {};
  let index = from;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const entry = MAP_ENTRY.exec(line);
    if (!entry && !isSkippable(line)) break;
    index++;
    if (!entry) continue;
    const cursor = { text: line, index: 0, line: firstLine4 + index - 1 };
    const key = entry[2] ?? "";
    const inline = entry[3]?.trim() ?? "";
    if (entry[1] !== indent) fail(cursor, `inconsistent indentation before "${key}"`);
    if (Object.hasOwn(map, key)) fail(cursor, `duplicate key "${key}"`);
    if (inline === "" || inline.startsWith("#")) fail(cursor, `"${key}" needs a string value`);
    map[key] = readScalar(inline, cursor.line);
  }
  return { value: map, next: index };
};
var readBlockValue = (lines, from, firstLine4) => {
  const first = lines.slice(from).find((line) => !isSkippable(line)) ?? "";
  if (LIST_ITEM.test(first)) return readList(lines, from, firstLine4);
  const entry = MAP_ENTRY.exec(first);
  if (entry) return readMap(lines, from, firstLine4, entry[1] ?? "");
  return { value: "", next: from };
};
var parseBlock = (lines, firstLine4) => {
  const data = {};
  let index = 0;
  while (index < lines.length) {
    const lineNumber = firstLine4 + index;
    const line = lines[index] ?? "";
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
    const block = readBlockValue(lines, index, firstLine4);
    data[key] = block.value;
    index = block.next;
  }
  return data;
};
var parseFrontmatter = (text2) => {
  const lines = text2.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== FENCE) return void 0;
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE);
  if (closing === -1) throw new FrontmatterError('missing closing "---"', lines.length);
  const data = parseBlock(lines.slice(1, closing), 2);
  return { data, body: lines.slice(closing + 1).join("\n"), bodyLine: closing + 2 };
};

// src/core/paths.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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
var firstLine = (text2) => {
  const line = text2.split("\n")[0]?.trim();
  return line === "" ? void 0 : line;
};
var gitToplevel = (cwd) => {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  return result.ok ? firstLine(result.stdout) : void 0;
};
var gitStatus = (cwd) => {
  const result = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd);
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
var resolveProjectRoot = (cwd, env = process.env) => {
  const fromEnv = env["CLAUDE_PROJECT_DIR"];
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
  const dir = join(projectRoot, ".jig");
  const cache = join(dir, "cache");
  return {
    dir,
    config: join(dir, "config.jsonc"),
    localConfig: join(dir, "config.local.jsonc"),
    gitignore: join(dir, ".gitignore"),
    journal: join(dir, "journal"),
    runs: join(dir, "runs"),
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
var toSlash = (path) => path.replace(/\\/g, "/");
var toProjectPath = (projectRoot, file, cwd = projectRoot) => {
  const absolute = isAbsolute(file) ? file : resolve(cwd, file);
  return toSlash(relative(projectRoot, absolute));
};

// src/core/plan.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync as mkdirSync6, readdirSync as readdirSync3, readFileSync as readFileSync9, statSync as statSync5 } from "node:fs";
import { dirname as dirname7, join as join7 } from "node:path";

// src/catalog/lockfiles.json
var lockfiles_default = [
  { file: "package-lock.json", install: "npm ci" },
  { file: "npm-shrinkwrap.json", install: "npm ci" },
  { file: "pnpm-lock.yaml", install: "pnpm install --frozen-lockfile" },
  { file: "yarn.lock", install: "yarn install --frozen-lockfile" },
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
  return (path) => pattern.test(path.replace(/\\/g, "/"));
};
var matchGlob = (path, glob) => createMatcher(typeof glob === "string" ? [glob] : glob)(path);

// src/catalog/languages/index.ts
import { extname } from "node:path";

// src/catalog/languages/js-lexer.ts
var REGEX_KEYWORDS = /* @__PURE__ */ new Set(["return", "typeof", "case", "do", "else"]);
var DIVISION_AFTER = /* @__PURE__ */ new Set([")", "]"]);
var IDENTIFIER_START = /[A-Za-z_$\u0080-￿]/;
var IDENTIFIER_PART = /[\w$\u0080-￿]/;
var DIGIT = /\d/;
var NUMBER_PART = /[\w.]/;
var WHITESPACE = /\s/;
var SCRIPT_BLOCK = /(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi;
var STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
var HTML_COMMENT = /<!--[\s\S]*?-->/g;
var SFC_TAG = /<(?:script|template|style)\b/i;
var countNewlines = (text2, from, to) => {
  let count = 0;
  for (let index = from; index < to; index++) {
    if (text2[index] === "\n") {
      count++;
    }
  }
  return count;
};
var JsLexer = class {
  constructor(source, end, start, firstLine4) {
    this.source = source;
    this.end = end;
    this.index = start;
    this.line = firstLine4;
  }
  source;
  end;
  index = 0;
  line;
  isRegexAllowed = true;
  isInTemplate = false;
  templateDepths = [];
  comments = [];
  run() {
    while (this.index < this.end) {
      if (this.isInTemplate) {
        this.scanTemplate();
        continue;
      }
      this.scanCode();
    }
    return this.comments;
  }
  at(offset = 0) {
    const position = this.index + offset;
    return position < this.end ? this.source[position] ?? "" : "";
  }
  advance() {
    if (this.source[this.index] === "\n") {
      this.line++;
    }
    this.index++;
  }
  scanCode() {
    const char = this.at();
    if (WHITESPACE.test(char)) {
      this.advance();
      return;
    }
    if (char === "/") {
      this.scanSlash();
      return;
    }
    if (char === '"' || char === "'") {
      this.scanString(char);
      return;
    }
    if (char === "`") {
      this.index++;
      this.isInTemplate = true;
      return;
    }
    if (IDENTIFIER_START.test(char)) {
      this.scanWord();
      return;
    }
    if (DIGIT.test(char)) {
      this.scanNumber();
      return;
    }
    this.scanPunctuator(char);
  }
  scanPunctuator(char) {
    this.index++;
    this.isRegexAllowed = !DIVISION_AFTER.has(char);
    this.updateTemplateDepth(char);
  }
  updateTemplateDepth(char) {
    const top = this.templateDepths.length - 1;
    const depth = this.templateDepths[top];
    if (depth === void 0) return;
    if (char === "{") {
      this.templateDepths[top] = depth + 1;
      return;
    }
    if (char !== "}") return;
    if (depth > 0) {
      this.templateDepths[top] = depth - 1;
      return;
    }
    this.templateDepths.pop();
    this.isInTemplate = true;
  }
  scanWord() {
    const start = this.index;
    while (this.index < this.end && IDENTIFIER_PART.test(this.at())) {
      this.index++;
    }
    this.isRegexAllowed = REGEX_KEYWORDS.has(this.source.slice(start, this.index));
  }
  scanNumber() {
    while (this.index < this.end && NUMBER_PART.test(this.at())) {
      this.index++;
    }
    this.isRegexAllowed = false;
  }
  scanString(quote) {
    this.index++;
    while (this.index < this.end) {
      const char = this.at();
      if (char === "\\") {
        this.index++;
        this.advance();
        continue;
      }
      if (char === quote || char === "\n") break;
      this.index++;
    }
    if (this.at() === quote) {
      this.index++;
    }
    this.isRegexAllowed = false;
  }
  scanTemplate() {
    while (this.index < this.end) {
      const char = this.at();
      if (char === "\\") {
        this.index++;
        this.advance();
        continue;
      }
      if (char === "`") {
        this.index++;
        this.isInTemplate = false;
        this.isRegexAllowed = false;
        return;
      }
      if (char === "$" && this.at(1) === "{") {
        this.index += 2;
        this.templateDepths.push(0);
        this.isInTemplate = false;
        this.isRegexAllowed = true;
        return;
      }
      this.advance();
    }
  }
  scanSlash() {
    const next = this.at(1);
    if (next === "/") {
      this.scanLineComment();
      return;
    }
    if (next === "*") {
      this.scanBlockComment();
      return;
    }
    if (this.isRegexAllowed && this.scanRegex()) return;
    this.index++;
    this.isRegexAllowed = true;
  }
  scanLineComment() {
    const start = this.index;
    while (this.index < this.end && this.at() !== "\n") {
      this.index++;
    }
    const text2 = this.source.slice(start, this.index).replace(/\r$/, "");
    this.comments.push({ text: text2, line: this.line, kind: "line", start, end: this.index });
  }
  scanBlockComment() {
    const start = this.index;
    const line = this.line;
    const close = this.source.indexOf("*/", start + 2);
    const stop2 = close === -1 || close + 2 > this.end ? this.end : close + 2;
    this.line += countNewlines(this.source, start, stop2);
    this.index = stop2;
    const text2 = this.source.slice(start, stop2);
    this.comments.push({ text: text2, line, kind: "block", start, end: stop2 });
  }
  scanRegex() {
    let position = this.index + 1;
    let isInClass = false;
    while (position < this.end) {
      const char = this.source[position];
      if (char === "\n") return false;
      if (char === "\\") {
        position += 2;
        continue;
      }
      if (char === "[") {
        isInClass = true;
      } else if (char === "]") {
        isInClass = false;
      } else if (char === "/" && !isInClass) {
        break;
      }
      position++;
    }
    if (position >= this.end) return false;
    position++;
    while (position < this.end && IDENTIFIER_PART.test(this.source[position] ?? "")) {
      position++;
    }
    this.index = position;
    this.isRegexAllowed = false;
    return true;
  }
};
var skipShebang = (source) => {
  if (!source.startsWith("#!")) return 0;
  const newline = source.indexOf("\n");
  return newline === -1 ? source.length : newline;
};
var lexJs = (source) => new JsLexer(source, source.length, skipShebang(source), 1).run();
var lineAt = (source, offset) => countNewlines(source, 0, offset) + 1;
var isInside = (offset, ranges) => ranges.some((range) => offset >= range.start && offset < range.end);
var lexVue = (source) => {
  const comments = SFC_TAG.test(source) ? [] : lexJs(source);
  const skipped = [];
  for (const match of source.matchAll(SCRIPT_BLOCK)) {
    const start = match.index + (match[1]?.length ?? 0);
    const end = start + (match[2]?.length ?? 0);
    comments.push(...new JsLexer(source, end, start, lineAt(source, start)).run());
    skipped.push({ start: match.index, end: match.index + match[0].length });
  }
  for (const match of source.matchAll(STYLE_BLOCK)) {
    skipped.push({ start: match.index, end: match.index + match[0].length });
  }
  for (const match of source.matchAll(HTML_COMMENT)) {
    if (isInside(match.index, skipped)) continue;
    const end = match.index + match[0].length;
    comments.push({ text: match[0], line: lineAt(source, match.index), kind: "block", start: match.index, end });
  }
  return comments.sort((left, right) => left.end - right.end);
};

// src/catalog/languages/index.ts
var SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
var LANGUAGES = [
  {
    name: "javascript",
    extensions: SCRIPT_EXTENSIONS,
    lexComments: lexJs,
    testFiles: ["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", "**/__tests__/**"],
    testCase: /(?<![\w$.])(?:it|test)(?:\.\w+)*\s*\(/g
  },
  { name: "vue", extensions: [".vue"], lexComments: lexVue, testFiles: [] }
];
var SCRIPT_FILES = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}"];
var TYPED_FILES = ["**/*.{ts,tsx,mts,cts,vue}"];
var TEST_FILE_GLOBS = [...new Set(LANGUAGES.flatMap((language) => language.testFiles))];
var isTestFile = createMatcher(TEST_FILE_GLOBS);
var languageFor = (file) => {
  const extension = extname(file).toLowerCase();
  return LANGUAGES.find((language) => language.extensions.includes(extension));
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
var PROOFS = [
  ["behavior", /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+act\s+replay\b/],
  ["look", /(?:^|[\s;&|])(?:npx\s+)?agent-view\s+(?:screenshot|snap)\b/]
];
var requires = (file) => {
  if (isTestFile(file)) return [];
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
  { name: "biome", comments: { suppressions: [/\bbiome-ignore\b/], allowed: [] } },
  { name: "vite", comments: { suppressions: [], allowed: [/@vite-ignore/] } },
  { name: "webpack", comments: { suppressions: [], allowed: [/webpack[A-Z]\w*\s*:/] } },
  { name: "minifiers", comments: { suppressions: [], allowed: [/[@#]__(?:PURE|NO_SIDE_EFFECTS)__/] } }
];

// src/catalog/tools/eslint.ts
import { dirname as dirname4, resolve as resolve4 } from "node:path";

// src/tools/tool.ts
import { statSync as statSync2 } from "node:fs";
import { dirname as dirname3, join as join3, relative as relative3, resolve as resolve3 } from "node:path";

// src/core/proc.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, realpathSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { setPriority } from "node:os";
import { basename, delimiter, dirname as dirname2, extname as extname2, isAbsolute as isAbsolute2, join as join2, relative as relative2, resolve as resolve2 } from "node:path";
var LOW_PRIORITY = 10;
var LOCK_WAIT_MS = 15e3;
var LOCK_STALE_MS = 5 * 60 * 1e3;
var LOCK_POLL_MS = 200;
var KILL_GRACE_MS = 1e3;
var MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
var readPackageJson = (path) => {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return void 0;
  }
};
var packageBinName = (pkg) => pkg.split("/").pop() ?? pkg;
var isWithin = (parent, child) => {
  const path = relative2(parent, child);
  return path === "" || !path.startsWith("..") && !isAbsolute2(path);
};
var realPath = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve2(path);
  }
};
var searchDirs = (projectRoot) => {
  const start = realPath(projectRoot);
  const gitTop = gitToplevel(start);
  const top = gitTop === void 0 ? void 0 : realPath(gitTop);
  if (top === void 0 || !isWithin(top, start)) return [start];
  const dirs = [start];
  let dir = start;
  while (relative2(top, dir) !== "") {
    const parent = dirname2(dir);
    if (parent === dir) break;
    dirs.push(parent);
    dir = parent;
  }
  return dirs;
};
var packageBinIn = (dir, pkg, binName) => {
  const packageDir = join2(dir, "node_modules", ...pkg.split("/"));
  const manifest = readPackageJson(join2(packageDir, "package.json"));
  const bin = typeof manifest?.bin === "string" ? manifest.bin : manifest?.bin?.[binName];
  if (bin === void 0) return void 0;
  const script = resolve2(packageDir, bin);
  return existsSync2(script) ? [process.execPath, script] : void 0;
};
var resolvePackageBin = (projectRoot, pkg, binName = packageBinName(pkg)) => {
  for (const dir of searchDirs(projectRoot)) {
    const bin = packageBinIn(dir, pkg, binName);
    if (bin !== void 0) return bin;
  }
  return void 0;
};
var isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
var findInPath = (name, env = process.env) => {
  const isWindows = process.platform === "win32";
  const pathValue = env["PATH"] ?? env["Path"] ?? "";
  const extensions = isWindows && extname2(name) === "" ? (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join2(dir, name + extension.toLowerCase());
      if (isFile(candidate)) return candidate;
    }
  }
  return void 0;
};
var SHIM_EXTENSIONS = /* @__PURE__ */ new Set([".cmd", ".bat"]);
var SCRIPT_EXTENSIONS2 = /* @__PURE__ */ new Set([".js", ".mjs", ".cjs"]);
var SHIM_TARGET = /"%(?:~dp0|dp0%)\\([^"%]+)"/gi;
var NODE_EXECUTABLE = /^node(?:\.exe)?$/i;
var isShim = (path) => SHIM_EXTENSIONS.has(extname2(path).toLowerCase());
var readText = (path) => {
  try {
    return readFileSync2(path, "utf8");
  } catch {
    return void 0;
  }
};
var resolveShimTarget = (shimPath) => {
  const text2 = readText(shimPath) ?? "";
  const targets = [...text2.matchAll(SHIM_TARGET)].map((match) => (match[1] ?? "").replace(/\\/g, "/")).filter((target2) => !NODE_EXECUTABLE.test(basename(target2)));
  const target = targets.at(-1);
  if (target === void 0) return void 0;
  const absolute = resolve2(dirname2(shimPath), target);
  if (!isFile(absolute)) return void 0;
  const extension = extname2(absolute).toLowerCase();
  if (SCRIPT_EXTENSIONS2.has(extension)) return [process.execPath, absolute];
  return extension === ".exe" ? [absolute] : void 0;
};
var resolveBin = (projectRoot, pkgs, command) => {
  for (const pkg of pkgs) {
    const bin = resolvePackageBin(projectRoot, pkg, command);
    if (bin !== void 0) return bin;
  }
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
      stdio: ["pipe", "pipe", "pipe"]
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
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, options.timeoutMs);
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        durationMs: Date.now() - startedAt
      };
      resolveRun(spawnError === void 0 ? result : { ...result, error: spawnError });
    });
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
var readLock = (path) => {
  try {
    const value = JSON.parse(readFileSync2(path, "utf8"));
    const isValid = typeof value.pid === "number" && typeof value.at === "number";
    return isValid ? { pid: value.pid, at: value.at } : void 0;
  } catch {
    return void 0;
  }
};
var lockFileAge = (path, now) => {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return void 0;
  }
};
var isLockAbandoned = (path, now = Date.now()) => {
  const info = readLock(path);
  if (info !== void 0) return now - info.at > LOCK_STALE_MS || !isAlive(info.pid);
  const age = lockFileAge(path, now);
  return age !== void 0 && age > LOCK_STALE_MS;
};
var tryCreateLock = (path) => {
  try {
    writeFileSync2(path, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
};
var transferLock = (path, pid) => {
  writeFileSync2(path, JSON.stringify({ pid, at: Date.now() }));
};
var sleep = (ms) => new Promise((done) => setTimeout(done, ms));
var acquireLock = async (path, waitMs = LOCK_WAIT_MS) => {
  mkdirSync2(dirname2(path), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (; ; ) {
    if (tryCreateLock(path)) {
      return { path, release: () => rmSync(path, { force: true }) };
    }
    if (isLockAbandoned(path)) {
      rmSync(path, { force: true });
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
var isFile2 = (path) => {
  try {
    return statSync2(path).isFile();
  } catch {
    return false;
  }
};
var nearestMarker = (projectRoot, file, markers) => {
  const top = resolve3(projectRoot);
  let dir = dirname3(resolve3(top, file));
  for (; ; ) {
    const found = markers.map((name) => join3(dir, name)).find(isFile2);
    if (found !== void 0) return found;
    const parent = dirname3(dir);
    if (relative3(top, dir) === "" || parent === dir || relative3(top, parent).startsWith("..")) return void 0;
    dir = parent;
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
  return { groups: [...byMarker].map(([marker, groupFiles]) => ({ marker, files: groupFiles })), skipped };
};
var withMarker = (entry, marker) => entry === void 0 || marker === void 0 ? void 0 : { bin: entry.bin, config: marker };
var FAILURE_DETAIL_MAX = 200;
var HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
var firstOutputLine = (text2) => text2.trim().split("\n")[0]?.slice(0, FAILURE_DETAIL_MAX) ?? "";
var settleExit = (invocation, exited) => {
  const { tool, okCodes, parse } = invocation;
  const failed2 = (failure) => ({ tool, findings: [], durationMs: exited.durationMs, failure });
  const isOkCode = exited.code !== null && okCodes.includes(exited.code);
  if (!isOkCode) return failed2(`exit ${exited.code}: ${firstOutputLine(exited.errorOutput || exited.output)}`);
  try {
    return { tool, findings: parse(exited.output), durationMs: exited.durationMs };
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
  const lines = /* @__PURE__ */ new Map();
  let current;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trimEnd();
      current = path === "/dev/null" ? void 0 : /* @__PURE__ */ new Set();
      if (current !== void 0) {
        lines.set(path, current);
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
  return lines;
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
var isOnChangedLine = (lines, line) => lines === "all" || lines?.has(line) === true;
var keepOnChangedLines = (projectRoot, findings) => {
  if (findings.length === 0) return [];
  const lines = changedLines(projectRoot, [...new Set(findings.map((finding) => finding.file))]);
  return findings.filter((finding) => isOnChangedLine(lines.get(finding.file), finding.line));
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
    suppressions: [/\beslint-disable(?:-next-line|-line)?\b/, /^\/\*\s*eslint\s+[\w@/-]+\s*:/],
    allowed: [/\beslint-enable\b/]
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
      const timeoutMs = input.budget(ESLINT_TIMEOUT_MS);
      if (timeoutMs === 0) break;
      runs.push(await runEslint({ bin: entry.bin, config: group.marker }, input.projectRoot, group.files, timeoutMs, dirname4(group.marker)));
    }
    const errors = runs.flatMap((toolRun) => toolRun.findings).filter((finding) => finding.severity === "error");
    return { runs, findings: keepOnChangedLines(input.projectRoot, errors) };
  }
});

// src/catalog/tools/oxlint.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { resolve as resolve5 } from "node:path";
var OXLINT_CONFIGS = [".oxlintrc.json", "oxlint.json", "oxlintrc.json"];
var OK_CODES2 = [0, 1];
var lineAtOffset = (path, offset) => {
  try {
    return readFileSync3(path, "utf8").slice(0, offset).split("\n").length;
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
  comments: { suppressions: [/\boxlint-disable(?:-next-line|-line)?\b/], allowed: [/\boxlint-enable\b/] },
  edit: async (tools, projectRoot, file, timeoutMs) => {
    const entry = withMarker(tools.oxlint, nearestMarker(projectRoot, file, OXLINT_CONFIGS));
    if (entry === void 0) return void 0;
    const result = await runOxlint(entry, projectRoot, file, timeoutMs);
    const errors = result.findings.filter((finding) => finding.severity === "error");
    if (errors.length === 0) return { ...result, findings: [] };
    const lines = changedLines(projectRoot, [file]).get(file);
    return { ...result, findings: errors.filter((finding) => isOnChangedLine(lines, finding.line)) };
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
  comments: { suppressions: [/\bstratum-ignore\b/], allowed: [/@stratum-purity\s+\d/] },
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
import { mkdirSync as mkdirSync4, readFileSync as readFileSync5, statSync as statSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname6, extname as extname3, join as join4, relative as relative4, resolve as resolve6 } from "node:path";

// src/core/jsonc.ts
var BOM = "\uFEFF";
var isWhitespace = (char) => char === " " || char === "	" || char === "\n" || char === "\r";
var blank = (text2) => text2.replace(/[^\n]/g, " ");
var skipString = (text2, start) => {
  let index = start + 1;
  while (index < text2.length) {
    const char = text2[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') return index + 1;
    index++;
  }
  return index;
};
var commentEnd = (text2, start) => {
  const next = text2[start + 1];
  if (next === "/") {
    const newline = text2.indexOf("\n", start);
    return newline === -1 ? text2.length : newline;
  }
  if (next === "*") {
    const close = text2.indexOf("*/", start + 2);
    if (close === -1) throw new SyntaxError("unterminated block comment");
    return close + 2;
  }
  return void 0;
};
var stripComments = (text2) => {
  let output = "";
  let index = 0;
  while (index < text2.length) {
    const char = text2[index];
    if (char === '"') {
      const end2 = skipString(text2, index);
      output += text2.slice(index, end2);
      index = end2;
      continue;
    }
    const end = char === "/" ? commentEnd(text2, index) : void 0;
    if (end !== void 0) {
      output += blank(text2.slice(index, end));
      index = end;
      continue;
    }
    output += char;
    index++;
  }
  return output;
};
var stripTrailingCommas = (text2) => {
  const chars = text2.split("");
  let index = 0;
  while (index < chars.length) {
    const char = chars[index];
    if (char === '"') {
      index = skipString(text2, index);
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
var parseJsonc = (text2) => {
  const source = text2.startsWith(BOM) ? text2.slice(1) : text2;
  return JSON.parse(stripTrailingCommas(stripComments(source)));
};

// src/tools/detach.ts
import { spawn as spawn2 } from "node:child_process";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync4 } from "node:fs";
import { setPriority as setPriority2 } from "node:os";
import { dirname as dirname5 } from "node:path";
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
var readOutput = (path) => {
  try {
    return readFileSync4(path, "utf8");
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
  mkdirSync3(dirname5(outputPath), { recursive: true });
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
var isFile3 = (path) => {
  try {
    return statSync3(path).isFile();
  } catch {
    return false;
  }
};
var readTsconfig = (path) => {
  const value = parseJsonc(readFileSync5(path, "utf8"));
  return typeof value === "object" && value !== null ? value : {};
};
var stringsOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : void 0;
var findNearestTsconfig = (projectRoot, file) => {
  const top = resolve6(projectRoot);
  let dir = dirname6(resolve6(projectRoot, file));
  for (; ; ) {
    const candidate = join4(dir, TSCONFIG);
    if (isFile3(candidate)) return candidate;
    const isTop = relative4(top, dir) === "";
    const parent = dirname6(dir);
    if (isTop || parent === dir) return void 0;
    dir = parent;
  }
};
var toIncludeGlob = (pattern) => {
  const clean = toSlash(pattern).replace(/^\.\//, "").replace(/\/$/, "");
  const lastSegment = clean.split("/").pop() ?? "";
  const isDirectory = !WILDCARD.test(clean) && !lastSegment.includes(".");
  return isDirectory ? `${clean}/**/*` : clean;
};
var covers = (configPath, absoluteFile) => {
  const config = readTsconfig(configPath);
  const path = toSlash(relative4(dirname6(configPath), absoluteFile));
  const files = stringsOf(config.files) ?? [];
  if (files.some((entry) => toSlash(entry).replace(/^\.\//, "") === path)) return true;
  const include = stringsOf(config.include) ?? (config.files === void 0 ? DEFAULT_INCLUDE : []);
  return include.length > 0 && matchGlob(path, include.map(toIncludeGlob));
};
var referencePath = (fromConfig, reference) => {
  const path = reference?.path;
  if (typeof path !== "string") return void 0;
  const target = resolve6(dirname6(fromConfig), path);
  return isFile3(target) ? target : join4(target, TSCONFIG);
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
  return { groups: [...byConfig].map(([config, groupFiles]) => ({ config, files: groupFiles })), skipped };
};
var tsconfigHash = (configPath) => createHash("sha1").update(configPath).digest("hex").slice(0, HASH_LENGTH);
var closureConfig = (projectRoot, group) => {
  const configDir = toSlash(dirname6(group.config));
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
  const dir = jigPaths(projectRoot).tscCache;
  mkdirSync4(dir, { recursive: true });
  const path = join4(dir, `tsconfig.${tsconfigHash(group.config)}.json`);
  writeFileSync3(path, `${JSON.stringify(closureConfig(projectRoot, group), null, 2)}
`);
  return path;
};
var pathKey = (path) => process.platform === "win32" ? path.toLowerCase() : path;
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
    outputPath: join4(jigPaths(projectRoot).tscCache, `${tsconfigHash(group.config)}.out`),
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
  comments: { suppressions: [/@ts-(?:ignore|expect-error|nocheck)\b/], allowed: [/^\/\/\/\s*<reference\b/] },
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
import { readdirSync, readFileSync as readFileSync6 } from "node:fs";
import { join as join5, posix } from "node:path";
var SKIPPED_DIRS = /* @__PURE__ */ new Set(["node_modules", "dist", "build", "out", "coverage", "target", "vendor"]);
var WALK_DEPTH = 4;
var DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
var FIXTURE_DIR = /fixture/i;
var isSkippedDir = (part) => SKIPPED_DIRS.has(part) || part === ".git" || FIXTURE_DIR.test(part);
var isSkippedPath = (path) => path.split("/").slice(0, -1).some(isSkippedDir);
var walk = (root, dir = "", depth = 0) => {
  let entries;
  try {
    entries = readdirSync(join5(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isFile()) return [path];
    const isWalked = entry.isDirectory() && depth < WALK_DEPTH && !entry.name.startsWith(".") && !isSkippedDir(entry.name);
    return isWalked ? walk(root, path, depth + 1) : [];
  });
};
var projectFiles = (projectRoot) => {
  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], projectRoot);
  const files = listed.ok ? listed.stdout.split("\0").filter(Boolean) : walk(projectRoot);
  return files.map((file) => file.replace(/\\/g, "/")).filter((file) => !isSkippedPath(file));
};
var readDependencies = (path) => {
  try {
    const manifest = JSON.parse(readFileSync6(path, "utf8"));
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
  const markers = files.filter((file) => markerNames.has(posix.basename(file)));
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
  const packageFiles = files.filter((file) => posix.basename(file) === "package.json");
  const declared = new Set(packageFiles.flatMap((file) => readDependencies(join5(projectRoot, file))));
  const found = CATALOG.map((entry) => inspect(projectRoot, entry, files, declared)).filter((item) => item !== void 0);
  return { found, packages: [...declared].sort(), packageFiles };
};
var settingsOf = (config, kind) => kind === "tool" ? config.tools : config.proofs;
var isListed = (config, found) => Object.hasOwn(settingsOf(config, found.kind), found.name);
var unlisted = (config, discovery) => discovery.found.filter((found) => found.status === "ready" && !isListed(config, found));

// src/core/command.ts
var TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;
var splitCommand = (text2) => [...text2.matchAll(TOKEN)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
var expandToken = (argv, placeholder, values) => argv.flatMap((token) => token === placeholder ? [...values] : [token]);

// src/core/config.ts
import { existsSync as existsSync3, readFileSync as readFileSync7 } from "node:fs";
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
var IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
var childPath = (path, key) => {
  if (typeof key === "number") return `${path}[${key}]`;
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
};
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var Validator = class {
  errors = [];
  report(path, problem) {
    this.errors.push(`${path}: ${problem}`);
    return void 0;
  }
  object(value, path, keys) {
    if (!isObject(value)) return this.report(path, "expected an object");
    if (keys === void 0) return value;
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        this.report(childPath(path, key), "unknown key");
      }
    }
    return value;
  }
  string(value, path) {
    return typeof value === "string" ? value : this.report(path, "expected a string");
  }
  oneOf(value, path, allowed) {
    const isAllowed = typeof value === "string" && allowed.includes(value);
    return isAllowed ? value : this.report(path, `expected one of ${allowed.join(", ")}`);
  }
  integer(value, path, min, max = Number.MAX_SAFE_INTEGER) {
    const isInRange = Number.isInteger(value) && value >= min && value <= max;
    if (isInRange) return value;
    const range = max === Number.MAX_SAFE_INTEGER ? `>= ${min}` : `${min}..${max}`;
    return this.report(path, `expected an integer ${range}`);
  }
  strings(value, path) {
    if (!Array.isArray(value)) return this.report(path, "expected an array of strings");
    const before = this.errors.length;
    value.forEach((item, index) => this.string(item, childPath(path, index)));
    return this.errors.length === before ? value : void 0;
  }
};
var required = (validator, object, path, keys) => {
  const missing = keys.filter((key) => !Object.hasOwn(object, key));
  missing.forEach((key) => validator.report(childPath(path, key), "is required"));
  return missing.length === 0;
};
var TOOL_KEYS = ["level", "command", "ignoreRules"];
var readToolSetting = (validator, value, path) => {
  if (value === false) return false;
  const object = validator.object(value, path, TOOL_KEYS);
  if (object === void 0) return void 0;
  const setting = { level: DEFAULT_SEVERITY, ignoreRules: [] };
  if (object["level"] !== void 0) {
    setting.level = validator.oneOf(object["level"], childPath(path, "level"), SEVERITIES2) ?? DEFAULT_SEVERITY;
  }
  if (object["command"] !== void 0) {
    const command = validator.string(object["command"], childPath(path, "command"));
    if (command !== void 0 && command.trim() === "") validator.report(childPath(path, "command"), "is empty");
    else if (command !== void 0) setting.command = command;
  }
  if (object["ignoreRules"] !== void 0) {
    setting.ignoreRules = validator.strings(object["ignoreRules"], childPath(path, "ignoreRules")) ?? [];
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
var readGlobs = (validator, value, path) => typeof value === "string" ? [value] : validator.strings(value, path);
var CHECK_KEYS = ["name", "files", "on", "run", "format", "level"];
var CHECK_NAME = /^[\w.-]+$/;
var FILES_TOKEN = "{files}";
var readCheck = (validator, value, path) => {
  const object = validator.object(value, path, CHECK_KEYS);
  if (object === void 0 || !required(validator, object, path, ["name", "files", "on", "run"])) return void 0;
  const before = validator.errors.length;
  const name = validator.string(object["name"], childPath(path, "name"));
  if (name !== void 0 && !CHECK_NAME.test(name)) validator.report(childPath(path, "name"), 'expected letters, digits, ".", "_" or "-"');
  const files = readGlobs(validator, object["files"], childPath(path, "files"));
  const on = validator.oneOf(object["on"], childPath(path, "on"), CHECK_STAGES);
  const run3 = validator.string(object["run"], childPath(path, "run"));
  if (run3 !== void 0 && !run3.includes(FILES_TOKEN)) validator.report(childPath(path, "run"), `needs the ${FILES_TOKEN} placeholder`);
  const format = object["format"] === void 0 ? EXIT_FORMAT : validator.oneOf(object["format"], childPath(path, "format"), OUTPUT_FORMATS);
  const level = object["level"] === void 0 ? DEFAULT_SEVERITY : validator.oneOf(object["level"], childPath(path, "level"), SEVERITIES2);
  const isValid = validator.errors.length === before;
  if (!isValid || name === void 0 || files === void 0 || on === void 0 || run3 === void 0 || format === void 0 || level === void 0) {
    return void 0;
  }
  return { name, files, on, run: run3, format, level };
};
var readChecks = (validator, value) => {
  if (value === void 0) return [];
  if (!Array.isArray(value)) return validator.report("$.checks", "expected an array") ?? [];
  const checks = [];
  value.forEach((entry, index) => {
    const path = childPath("$.checks", index);
    const check2 = readCheck(validator, entry, path);
    if (check2 === void 0) return;
    if (checks.some((other) => other.name === check2.name)) {
      validator.report(childPath(path, "name"), `duplicate check ${check2.name}`);
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
var readStep = (validator, value, path, keys) => {
  const object = validator.object(value, path, keys);
  if (object === void 0 || !required(validator, object, path, ["base", "step"])) return void 0;
  validator.integer(object["base"], childPath(path, "base"), 1, MAX_PORT);
  validator.integer(object["step"], childPath(path, "step"), 1);
  return object;
};
var readPorts = (validator, value, path) => {
  const object = validator.object(value, path, void 0);
  if (object === void 0) return void 0;
  const ports = {};
  for (const [key, entry] of Object.entries(object)) {
    const portPath = childPath(path, key);
    const port = readStep(validator, entry, portPath, ["base", "step", "target"]);
    if (port === void 0) continue;
    const target = port["target"] === void 0 ? DEFAULT_PORT_TARGET : validator.string(port["target"], childPath(portPath, "target"));
    ports[key] = { base: port["base"], step: port["step"], target: target ?? DEFAULT_PORT_TARGET };
  }
  return ports;
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
  "instance",
  "clearCache"
];
var readSlots = (validator, value) => {
  const path = "$.slots";
  const object = validator.object(value, path, SLOT_KEYS);
  if (object === void 0 || !required(validator, object, path, ["worktreesDir"])) return void 0;
  const at = (key) => childPath(path, key);
  const slots = { worktreesDir: validator.string(object["worktreesDir"], at("worktreesDir")) ?? "" };
  const readers = {
    install: (raw) => validator.string(raw, at("install")),
    dev: (raw) => validator.string(raw, at("dev")),
    runtime: (raw) => validator.oneOf(raw, at("runtime"), RUNTIMES),
    verifyRuntime: (raw) => validator.oneOf(raw, at("verifyRuntime"), VERIFY_RUNTIMES),
    linkedPackages: (raw) => validator.strings(raw, at("linkedPackages")),
    ports: (raw) => readPorts(validator, raw, at("ports")),
    cdp: (raw) => readStep(validator, raw, at("cdp"), ["base", "step"]),
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
var WORKTREE_KEYS = ["seedExclude", "copyFiles"];
var readWorktree = (validator, value) => {
  const path = "$.worktree";
  const object = validator.object(value, path, WORKTREE_KEYS);
  if (object === void 0) return void 0;
  const worktree = {};
  for (const key of WORKTREE_KEYS) {
    if (object[key] === void 0) continue;
    const parsed = validator.strings(object[key], childPath(path, key));
    if (parsed !== void 0) {
      worktree[key] = parsed;
    }
  }
  return worktree;
};
var defaultRules = () => {
  const rules = {};
  for (const rule of RULE_IDS) {
    rules[rule] = DEFAULT_SEVERITIES[rule] ?? DEFAULT_SEVERITY;
  }
  return rules;
};
var defaultConfig = () => ({ rules: defaultRules(), tools: {}, proofs: {}, checks: [] });
var SECTION_KEYS = ["$schema", "rules", "checks", "slots", "worktree"];
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
  const config = {
    rules,
    tools,
    proofs,
    checks,
    ...slots === void 0 ? {} : { slots },
    ...worktree === void 0 ? {} : { worktree }
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
var mergeConfigValues = (shared, local, path = "$") => {
  if (path === "$.checks") return mergeChecks(shared, local);
  if (!isObject(shared) || !isObject(local)) return local;
  const merged = { ...shared };
  for (const [key, value] of Object.entries(local)) {
    merged[key] = Object.hasOwn(shared, key) ? mergeConfigValues(shared[key], value, childPath(path, key)) : value;
  }
  return merged;
};
var failed = (files, error) => ({ ...defaultConfig(), files, error });
var parseText = (text2, label) => {
  try {
    return { value: parseJsonc(text2) };
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
var readOptional = (path) => existsSync3(path) ? readFileSync7(path, "utf8") : void 0;
var loadConfig = (projectRoot) => {
  const paths = jigPaths(projectRoot);
  const sources = [
    { path: paths.config, label: ".jig/config.jsonc: " },
    { path: paths.localConfig, label: ".jig/config.local.jsonc: " }
  ].flatMap((source) => {
    const text2 = readOptional(source.path);
    return text2 === void 0 ? [] : [{ ...source, text: text2 }];
  });
  const files = sources.map((source) => source.path);
  if (sources.length === 0) return { ...defaultConfig(), files };
  let merged = {};
  for (const source of sources) {
    const parsed = parseText(source.text, source.label);
    if ("error" in parsed) return failed(files, parsed.error);
    merged = mergeConfigValues(merged, parsed.value);
  }
  return loadValue(merged, files);
};
var enabledSetting = (settings, name) => {
  const setting = settings[name];
  return setting === void 0 || setting === false || setting.level === "off" ? void 0 : setting;
};

// src/core/state.ts
import { mkdirSync as mkdirSync5, readdirSync as readdirSync2, readFileSync as readFileSync8, renameSync, rmSync as rmSync2, statSync as statSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join6 } from "node:path";
var MAIN_AGENT = "main";
var STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var RENAME_ATTEMPTS = 20;
var RENAME_RETRY_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var tmpCounter = 0;
var sessionFileName = (sessionId) => `${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
var sessionStatePath = (projectRoot, sessionId) => join6(jigPaths(projectRoot).sessions, sessionFileName(sessionId));
var createSessionState = (sessionId, snapshot2, now = /* @__PURE__ */ new Date()) => {
  const iso = now.toISOString();
  return {
    v: 1,
    sessionId,
    turn: 0,
    createdAt: iso,
    updatedAt: iso,
    snapshot: snapshot2,
    edits: [],
    stop: { consecutiveBlocks: 0 }
  };
};
var resetSnapshot = (state, snapshot2) => {
  state.snapshot = snapshot2;
  state.edits = [];
};
var isSessionState = (value) => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return candidate.v === 1 && typeof candidate.sessionId === "string" && typeof candidate.snapshot === "object";
};
var readState = (projectRoot, sessionId) => {
  let text2;
  try {
    text2 = readFileSync8(sessionStatePath(projectRoot, sessionId), "utf8");
  } catch {
    return void 0;
  }
  try {
    const value = JSON.parse(text2);
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
        rmSync2(from, { force: true });
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 5);
    }
  }
};
var writeFileAtomic = (path, text2) => {
  tmpCounter++;
  const tmp = `${path}.${process.pid}-${tmpCounter}.tmp`;
  writeFileSync4(tmp, text2);
  renameWithRetry(tmp, path);
};
var writeState = (projectRoot, state, now = /* @__PURE__ */ new Date()) => {
  const path = sessionStatePath(projectRoot, state.sessionId);
  mkdirSync5(jigPaths(projectRoot).sessions, { recursive: true });
  state.updatedAt = now.toISOString();
  writeFileAtomic(path, JSON.stringify(state));
};
var pruneStates = (projectRoot, now = Date.now(), maxAgeMs = STATE_MAX_AGE_MS) => {
  const dir = jigPaths(projectRoot).sessions;
  let names;
  try {
    names = readdirSync2(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    const path = join6(dir, name);
    try {
      if (now - statSync4(path).mtimeMs <= maxAgeMs) continue;
      rmSync2(path, { force: true });
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
var fileStamp = (path) => {
  try {
    const stat = statSync5(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
};
var planInputsHash = (projectRoot, pluginRoot) => {
  const lines = [`version:${version}`, `plugin:${pluginRoot}`, ...HASHED_INPUTS.map((name) => `${name}:${fileStamp(join7(projectRoot, name))}`)];
  return createHash2("sha1").update(lines.join("\n")).digest("hex");
};
var resolveTools = (projectRoot, config) => {
  const tools = {};
  const unresolved = [];
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
      unresolved.push(name);
      continue;
    }
    tools[(binary ?? primary).key] = { bin: [...bin, ...args] };
  }
  return { tools, unresolved };
};
var configDrift = (projectRoot, config, unresolved) => {
  if (config.error !== void 0) return [`.jig config is invalid (${config.error})`];
  const found = unlisted(config, discover(projectRoot));
  if (config.files.length === 0) return found.length === 0 ? [] : [`no .jig/config.jsonc, so nothing runs; found ${found.map((item) => item.name).join(", ")}`];
  return [
    ...found.map((item) => item.kind === "proof" ? `found ${item.name}, not in config: UI proof is off` : `found ${item.name}, not in config`),
    ...unresolved.map((name) => `${name} is on in config, its binary is not installed`)
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
    data = parseFrontmatter(readFileSync9(file, "utf8"))?.data ?? {};
  } catch {
    return void 0;
  }
  const { name, description } = data;
  const isIndexable = typeof name === "string" && typeof description === "string";
  return isIndexable ? { name, description, file } : void 0;
};
var readAtomIndex = (pluginRoot) => {
  const dir = join7(pluginRoot, "atoms");
  let names;
  try {
    names = readdirSync3(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".md")).sort().map((name) => toPlanAtom(join7(dir, name))).filter((atom) => atom !== void 0);
};
var buildPlan = (projectRoot, pluginRoot, now = /* @__PURE__ */ new Date()) => {
  const config = loadConfig(projectRoot);
  const { tools, unresolved } = resolveTools(projectRoot, config);
  return {
    v: PLAN_VERSION,
    inputsHash: planInputsHash(projectRoot, pluginRoot),
    pluginVersion: version,
    builtAt: now.toISOString(),
    config,
    tools,
    unresolved,
    drift: configDrift(projectRoot, config, unresolved),
    atoms: readAtomIndex(pluginRoot)
  };
};
var readPlan = (projectRoot) => {
  try {
    const value = JSON.parse(readFileSync9(jigPaths(projectRoot).plan, "utf8"));
    return value.v === PLAN_VERSION && typeof value.inputsHash === "string" ? value : void 0;
  } catch {
    return void 0;
  }
};
var writePlan = (projectRoot, plan) => {
  const path = jigPaths(projectRoot).plan;
  mkdirSync6(dirname7(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(plan, null, 2)}
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
import { mkdirSync as mkdirSync7, readdirSync as readdirSync4, readFileSync as readFileSync10, rmSync as rmSync3, statSync as statSync6, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join8 } from "node:path";

// src/rules/rule.ts
var fileLine = (edit, fragmentLine) => fragmentLine + (edit.line ?? 1) - 1;

// src/rules/comments.ts
var normalize = (text2) => text2.replace(/\s+/g, " ").trim();
var countExisting = (file, edits) => {
  const counts = /* @__PURE__ */ new Map();
  for (const edit of edits) {
    for (const comment of lexComments(file, edit.before) ?? []) {
      const key = normalize(comment.text);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
};
var commentsOf = (file, edit) => {
  if (edit.prefix === void 0) {
    return (lexComments(file, edit.after) ?? []).map((comment) => ({ comment, line: fileLine(edit, comment.line) }));
  }
  const { prefix } = edit;
  return (lexComments(file, prefix + edit.after) ?? []).filter((comment) => comment.start >= prefix.length).map((comment) => ({ comment, line: comment.line }));
};
var addedComments = (file, edits) => {
  if (lexComments(file, "") === void 0) return void 0;
  const existing = countExisting(file, edits);
  const added = [];
  for (const edit of edits) {
    for (const { comment, line } of commentsOf(file, edit)) {
      const key = normalize(comment.text);
      const remaining = existing.get(key) ?? 0;
      if (remaining > 0) {
        existing.set(key, remaining - 1);
        continue;
      }
      added.push({ text: comment.text, key, line });
    }
  }
  return added;
};

// src/rules/suppressions.ts
var firstMatch = (patterns, text2) => {
  for (const pattern of patterns) {
    const match = pattern.exec(text2);
    if (match !== null) return match[0];
  }
  return void 0;
};
var findSuppression = (comment) => firstMatch(DIRECTIVE_SOURCES.flatMap((source) => source.comments?.suppressions ?? []), comment);
var isToolDirective = (comment) => firstMatch(DIRECTIVE_SOURCES.flatMap((source) => source.comments?.allowed ?? []), comment) !== void 0;

// src/rules/tests.ts
var countCases = (source, testCase) => source.match(testCase)?.length ?? 0;
var addedTestCases = (file, edits) => {
  const testCase = languageFor(file)?.testCase;
  if (testCase === void 0 || !isTestFile(file)) return 0;
  return edits.reduce((sum, edit) => sum + countCases(edit.after, testCase) - countCases(edit.before, testCase), 0);
};

// src/rules/gate.ts
var GATE_ATOMS = ["comments", "tests"];
var RETRY = "Read the rules first, then repeat the same call \u2014 it will pass.";
var LEADING_HEADING = /^#[^\n]*\n+/;
var isOn = (config, rule) => (config.rules[rule] ?? "off") !== "off";
var sessionDir = (projectRoot, sessionId) => join8(jigPaths(projectRoot).cache, "gates", sessionId.replace(/[^A-Za-z0-9._-]/g, "_"));
var claimPath = (projectRoot, sessionId, agent, key) => {
  const name = process.platform === "win32" ? key.toLowerCase() : key;
  return join8(sessionDir(projectRoot, sessionId), createHash3("sha1").update(`${agent}
${name}`).digest("hex"));
};
var atomKey = (atom) => `atom
${atom}`;
var claimFirst = ({ projectRoot, sessionId, agent }, key) => {
  mkdirSync7(sessionDir(projectRoot, sessionId), { recursive: true });
  try {
    writeFileSync5(claimPath(projectRoot, sessionId, agent, key), "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};
var atomPath = (pluginRoot, atom) => toSlash(join8(pluginRoot, "atoms", `${atom}.md`));
var rulesText = (input, atom, reminder) => {
  const path = atomPath(input.pluginRoot, atom);
  if (!claimFirst(input, atomKey(atom))) return `${reminder} Rules: ${path}.`;
  try {
    const text2 = readFileSync10(path, "utf8");
    return (parseFrontmatter(text2)?.body ?? text2).replace(/^\s+/, "").replace(LEADING_HEADING, "").trim();
  } catch {
    return `Rules: ${path}.`;
  }
};
var suppressionHits = (file, comments) => comments.flatMap((comment) => {
  const directive = findSuppression(comment.text);
  if (directive === void 0) return [];
  const message = `jig/comments: "${directive}" at ${file}:${comment.line} silences a check. Fix the cause instead; only a human adds suppressions.`;
  return [{ rule: "jig/comments", line: comment.line, message }];
});
var COMMENT_REMINDER = "Keep a comment only if it is a license header, a TODO with a ticket, public-API JSDoc beyond the signature, or an external constraint with a link.";
var commentSection = (input, comments) => {
  const gated = comments.filter((comment) => findSuppression(comment.text) === void 0 && !isToolDirective(comment.text));
  const unseen = gated.filter((comment) => claimFirst(input, `comment
${input.file}
${comment.key}`));
  const [first] = unseen;
  if (first === void 0) return void 0;
  const list = unseen.map((comment) => `  ${input.file}:${comment.line} ${comment.key}`);
  const head = `jig/comments: the edit adds ${unseen.length} comment(s):
${list.join("\n")}
${RETRY} Keep only the comments the rules allow.`;
  return {
    text: `${head}

${rulesText(input, "comments", COMMENT_REMINDER)}`,
    hit: { rule: "jig/comments", line: first.line, message: `new comment at ${input.file}:${first.line}` }
  };
};
var TEST_REMINDER = 'Finish "this test fails when a developer <edit>, which breaks <behavior>" with a realistic edit, or drop the test.';
var testSection = (input) => {
  const added = addedTestCases(input.file, input.edits);
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
  const comments = addedComments(input.file, input.edits) ?? [];
  const suppressions = suppressionHits(input.file, comments);
  const sections = [
    isOn(input.config, "jig/comments") ? commentSection(input, comments) : void 0,
    isOn(input.config, "jig/tests") ? testSection(input) : void 0
  ].filter((section) => section !== void 0);
  const hits = [...suppressions, ...sections.map((section) => section.hit)];
  if (hits.length === 0) return { hits };
  const texts = [...suppressions.map((hit) => hit.message), ...sections.map((section) => section.text)];
  return { reason: texts.join("\n\n"), hits };
};
var resetGateAtoms = (projectRoot, sessionId, agent) => {
  for (const atom of GATE_ATOMS) {
    rmSync3(claimPath(projectRoot, sessionId, agent, atomKey(atom)), { force: true });
  }
};
var pruneGateClaims = (projectRoot, now = Date.now(), maxAgeMs = STATE_MAX_AGE_MS) => {
  const dir = join8(jigPaths(projectRoot).cache, "gates");
  let names;
  try {
    names = readdirSync4(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join8(dir, name);
    try {
      if (now - statSync6(path).mtimeMs > maxAgeMs) {
        rmSync3(path, { recursive: true, force: true });
      }
    } catch {
      continue;
    }
  }
};

// src/atoms/markdown.ts
import { readdirSync as readdirSync5, readFileSync as readFileSync11 } from "node:fs";
var listMarkdown = (dir) => {
  try {
    return readdirSync5(dir).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
};
var readText2 = (path) => {
  try {
    return readFileSync11(path, "utf8");
  } catch {
    return "";
  }
};
var parseMarkdownFile = (text2) => {
  try {
    return parseFrontmatter(text2) ?? "frontmatter is missing";
  } catch (error) {
    if (error instanceof FrontmatterError) return `frontmatter is invalid (${error.message})`;
    throw error;
  }
};

// src/atoms/skill-docs.ts
import { readdirSync as readdirSync6 } from "node:fs";
import { basename as basename2, join as join9 } from "node:path";
var ROLES_DIR = "skills/jig/references/roles";
var FLOWS_DIR = "skills/jig/flows";
var ROLE_KEYS = /* @__PURE__ */ new Set(["name", "description", "metadata"]);
var TIERS = ["deep", "standard", "fast"];
var EFFORTS = ["low", "medium", "high"];
var MAX_DESCRIPTION_LENGTH = 200;
var ROLE_MENTION = /\b[Rr]oles? `[^`]+`(?:(?:, |,? and |,? or )`[^`]+`)*/g;
var BACKTICKED = /`([^`]+)`/g;
var FLOW_MENTION = /\bflows\/([A-Za-z0-9_-]+)\.md/g;
var lineAt2 = (text2, index) => text2.slice(0, index).split("\n").length;
var findMentions = (file, text2) => {
  const roles = [...text2.matchAll(ROLE_MENTION)].flatMap(
    (match) => [...match[0].matchAll(BACKTICKED)].map((name) => ({ name: name[1] ?? "", file, line: lineAt2(text2, match.index) }))
  );
  const flows = [...text2.matchAll(FLOW_MENTION)].map((match) => ({ name: match[1] ?? "", file, line: lineAt2(text2, match.index) }));
  return { roles, flows };
};
var listSkillMarkdown = (pluginRoot) => {
  try {
    return readdirSync6(join9(pluginRoot, "skills"), { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".md")).map((path) => `skills/${toSlash(path)}`).sort();
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
var checkName = (name, fileName) => {
  if (name === fileName) return [];
  return typeof name === "string" && name !== "" ? [`name "${name}" does not match file name "${fileName}"`] : ["name is missing"];
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
var checkDoc = (pluginRoot, path, isRole) => {
  const parsed = parseMarkdownFile(readText2(join9(pluginRoot, path)));
  if (typeof parsed === "string") return [parsed];
  const { data } = parsed;
  const problems = [...checkName(data["name"], basename2(path, ".md")), ...checkDescription(data["description"])];
  if (!isRole) return problems;
  const unknownKeys = Object.keys(data).filter((key) => !ROLE_KEYS.has(key));
  return [...unknownKeys.map((key) => `unknown frontmatter key "${key}"`), ...problems, ...checkMetadata(data["metadata"])];
};
var validateSkillDocs = (pluginRoot) => {
  const roles = listMarkdown(join9(pluginRoot, ROLES_DIR)).map((name) => basename2(name, ".md"));
  const flows = new Set(listMarkdown(join9(pluginRoot, FLOWS_DIR)).map((name) => basename2(name, ".md")));
  const mentions = listSkillMarkdown(pluginRoot).map((file) => findMentions(file, readText2(join9(pluginRoot, file)).replace(/\r\n/g, "\n")));
  const roleMentions = mentions.flatMap((found) => found.roles);
  const referenced = new Set(roleMentions.filter((mention) => !mention.file.startsWith(`${ROLES_DIR}/`)).map((mention) => mention.name));
  const roleErrors = roles.flatMap((name) => {
    const path = `${ROLES_DIR}/${name}.md`;
    const problems = checkDoc(pluginRoot, path, true);
    if (!referenced.has(name)) {
      problems.push(`role is never spawned: name it as role \`${name}\` in a flow or reference outside ${ROLES_DIR}/, or delete it`);
    }
    return problems.map((problem) => `${path}: ${problem}`);
  });
  const flowErrors = [...flows].flatMap((name) => {
    const path = `${FLOWS_DIR}/${name}.md`;
    return checkDoc(pluginRoot, path, false).map((problem) => `${path}: ${problem}`);
  });
  const roleNames = new Set(roles);
  const mentionErrors = [
    ...roleMentions.filter((mention) => !roleNames.has(mention.name)).map((mention) => `${mention.file}:${mention.line}: role \`${mention.name}\` does not exist in ${ROLES_DIR}/`),
    ...mentions.flatMap((found) => found.flows).filter((mention) => !flows.has(mention.name)).map((mention) => `${mention.file}:${mention.line}: flows/${mention.name}.md does not exist in ${FLOWS_DIR}/`)
  ];
  return [...roleErrors, ...flowErrors, ...mentionErrors];
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
  const skillsDir = join10(pluginRoot, "skills");
  try {
    return readdirSync7(skillsDir, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".md")).map((path) => join10(skillsDir, path));
  } catch {
    return [];
  }
};
var reachableNames = (pluginRoot) => {
  const texts = skillMarkdown(pluginRoot).map((path) => readText2(path).replace(/\r\n/g, "\n"));
  const names = new Set(GATE_ATOMS);
  for (const text2 of texts) {
    for (const match of text2.matchAll(/atom `([^`]+)`/g)) {
      names.add(match[1] ?? "");
    }
    for (const match of text2.matchAll(INDEX_LINE)) {
      names.add(match[1] ?? "");
    }
    for (const match of text2.matchAll(ATOMS_LINE)) {
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
var checkAtom = (path, seen, reachable) => {
  const fileName = basename3(path, ".md");
  const parsed = parseMarkdownFile(readText2(path));
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
  const dir = join10(pluginRoot, "atoms");
  const reachable = reachableNames(pluginRoot);
  const seen = /* @__PURE__ */ new Set();
  return listMarkdown(dir).flatMap(
    (name) => checkAtom(join10(dir, name), seen, reachable).map((problem) => `atoms/${name}: ${problem}`)
  );
};
var readAtomBody = (file) => {
  const text2 = readFileSync12(file, "utf8");
  const body = parseFrontmatter(text2)?.body ?? text2.replace(/\r\n/g, "\n");
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
  const errors = [...validateAtoms(pluginRoot), ...validateSkillDocs(pluginRoot)];
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

// src/doctor.ts
import { existsSync as existsSync5, readFileSync as readFileSync15 } from "node:fs";
import { join as join13 } from "node:path";

// src/core/journal.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync8, readdirSync as readdirSync8, readFileSync as readFileSync13, rmSync as rmSync4, statSync as statSync7 } from "node:fs";
import { join as join11 } from "node:path";
var JOURNAL_MAX_AGE_DAYS = 30;
var JOURNAL_MAX_BYTES = 50 * 1024 * 1024;
var JOURNAL_MESSAGE_MAX = 300;
var DAY_MS = 24 * 60 * 60 * 1e3;
var JOURNAL_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
var truncate = (text2) => text2.length <= JOURNAL_MESSAGE_MAX ? text2 : `${text2.slice(0, JOURNAL_MESSAGE_MAX - 1)}\u2026`;
var appendJournal = (projectRoot, entry) => {
  const record2 = { v: 1, ...entry, ts: entry.ts ?? (/* @__PURE__ */ new Date()).toISOString() };
  if (record2.message !== void 0) {
    record2.message = truncate(record2.message);
  }
  const dir = jigPaths(projectRoot).journal;
  mkdirSync8(dir, { recursive: true });
  appendFileSync2(join11(dir, `${record2.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record2)}
`);
  return record2;
};
var listJournalFiles = (projectRoot) => {
  const dir = jigPaths(projectRoot).journal;
  let names;
  try {
    names = readdirSync8(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names.sort()) {
    const day = JOURNAL_FILE.exec(name)?.[1];
    if (day === void 0) continue;
    const path = join11(dir, name);
    files.push({ name, path, day, size: statSync7(path).size });
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
    rmSync4(file.path, { force: true });
    removed.push(file.name);
  }
  let total = kept.reduce((sum, file) => sum + file.size, 0);
  for (const file of kept) {
    if (total <= JOURNAL_MAX_BYTES) break;
    rmSync4(file.path, { force: true });
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
    for (const line of readFileSync13(file.path, "utf8").split("\n")) {
      const record2 = line.trim() === "" ? void 0 : parseRecord(line);
      if (record2 !== void 0 && Date.parse(record2.ts) >= sinceMs) {
        records.push(record2);
      }
    }
  }
  return records;
};

// src/tiers/tiers.ts
import { existsSync as existsSync4, readFileSync as readFileSync14 } from "node:fs";
import { homedir } from "node:os";
import { join as join12 } from "node:path";
import { parseArgs } from "node:util";
var TIERS2 = ["deep", "standard", "fast"];
var UNKNOWN_AGENT = "unknown";
var USER_CONFIG_ENV = "JIG_USER_CONFIG";
var DEFAULT_LABEL = "~/.jig/config.jsonc";
var AGENT_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
var NO_MAPPING = "no mapping: choose a model that fits the tier (deep = strongest reasoning, standard = balanced, fast = cheap mechanical work)";
var DEFAULT_TIERS = {
  claude: { deep: ["opus", "sonnet"], standard: ["sonnet"], fast: ["haiku"] }
};
var AGENT_ENV = [
  { agent: "claude", vars: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] },
  { agent: "cursor", vars: ["CURSOR_AGENT", "CURSOR_VERSION"] },
  { agent: "codex", vars: ["CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"] }
];
var emptyUserConfig = () => ({ tiers: {} });
var readModels = (validator, value, path) => {
  const models = validator.strings(value, path);
  if (models === void 0) return void 0;
  if (models.length === 0) return validator.report(path, "expected a non-empty array of strings");
  const before = validator.errors.length;
  models.forEach((model, index) => {
    if (model === "") {
      validator.report(childPath(path, index), "expected a non-empty string");
    }
  });
  return validator.errors.length === before ? models : void 0;
};
var readTierMap = (validator, value, path) => {
  const object = validator.object(value, path, TIERS2);
  if (object === void 0) return void 0;
  const map = {};
  for (const tier of TIERS2) {
    if (!Object.hasOwn(object, tier)) continue;
    const models = readModels(validator, object[tier], childPath(path, tier));
    if (models !== void 0) {
      map[tier] = models;
    }
  }
  return map;
};
var readTiers = (validator, value) => {
  const path = "$.tiers";
  const object = validator.object(value, path, void 0);
  if (object === void 0) return {};
  const tiers = {};
  for (const [agent, entry] of Object.entries(object)) {
    const agentPath = childPath(path, agent);
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
var validateUserConfig = (value) => {
  const validator = new Validator();
  const root = validator.object(value, "$", ["$schema", "tiers"]);
  if (root === void 0) return { config: emptyUserConfig(), errors: validator.errors };
  if (root["$schema"] !== void 0) {
    validator.string(root["$schema"], "$.$schema");
  }
  const tiers = root["tiers"] === void 0 ? {} : readTiers(validator, root["tiers"]);
  return { config: { tiers }, errors: validator.errors };
};
var parseUserConfig = (text2) => {
  let value;
  try {
    value = parseJsonc(text2);
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
  const path = override || join12(homedir(), ".jig", "config.jsonc");
  const label = override || DEFAULT_LABEL;
  if (!existsSync4(path)) return { path, label, config: emptyUserConfig() };
  return { path, label, ...parseUserConfig(readFileSync14(path, "utf8")) };
};
var detectAgent = (flag, env = process.env) => {
  if (flag) return flag;
  const match = AGENT_ENV.find(({ vars }) => vars.some((name) => Boolean(env[name])));
  return match?.agent ?? UNKNOWN_AGENT;
};
var resolveTiers = (agent, userConfig) => {
  const merged = { ...DEFAULT_TIERS[agent], ...userConfig.tiers[agent] };
  return Object.keys(merged).length > 0 ? merged : void 0;
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
  const lines = tierEntries(tiers).map(([tier, models]) => `${tier}: ${models.join(", ")}`);
  return [head, ...lines].join("\n");
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
var RECOMMENDED_DENY = PROTECTED_FOR_DENY.flatMap((path) => [`Edit(${path})`, `Write(${path})`]);
var formatDenyBlock = () => {
  const pairs = PROTECTED_FOR_DENY.map((path) => `      "Edit(${path})", "Write(${path})"`);
  return ["{", '  "permissions": {', '    "deny": [', pairs.join(",\n"), "    ]", "  }", "}"].join("\n");
};
var ok = (text2) => ({ status: "ok", text: text2 });
var warn = (text2) => ({ status: "warn", text: text2 });
var fail2 = (text2) => ({ status: "fail", text: text2 });
var checkNode = () => {
  const version2 = process.versions.node;
  const major = Number(version2.split(".")[0]);
  return major >= MIN_NODE_MAJOR ? ok(`node: ${version2}`) : fail2(`node: ${version2}, Node >= ${MIN_NODE_MAJOR} required`);
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
  const shim = entry.binaries.map((binary) => findUnresolvedShim(binary.command)).find((path) => path !== void 0);
  if (shim !== void 0) return warn(`${entry.name}: shim ${shim} has no recognizable target, tool not used`);
  return warn(`${entry.name}: on in config, binary not installed, tool not used`);
};
var checkAgentViewSetup = (discovery) => {
  const agentView = discovery.found.find((item) => item.name === agentViewCheck.name);
  if (agentView?.status === "ready") return void 0;
  const setup = agentViewCheck.setup?.join(", then ") ?? "agent-view init";
  return warn(`agent-view: no ${AGENT_VIEW_CONFIG}; UI changes cannot be proven in the running app. Set it up: ${setup}`);
};
var checkCustom = (config) => config.checks.map((check2) => ok(`check ${check2.name}: on ${check2.on}, ${check2.level}, files ${check2.files.join(" ")}, run ${check2.run}`));
var checkGitignore = (projectRoot) => {
  const path = jigPaths(projectRoot).gitignore;
  return existsSync5(path) ? ok(`gitignore: ${path}`) : warn(`gitignore: ${path} missing, jig creates it on first run`);
};
var readDenyList = (path) => {
  const settings = parseJsonc(readFileSync15(path, "utf8"));
  const deny = settings?.permissions?.deny;
  return Array.isArray(deny) ? deny.filter((entry) => typeof entry === "string") : [];
};
var checkDeny = (projectRoot) => {
  const path = join13(projectRoot, ".claude", "settings.json");
  let deny = [];
  if (existsSync5(path)) {
    try {
      deny = readDenyList(path);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...warn(`deny: ${path} unreadable (${reason}), add the recommended block:`), block: formatDenyBlock() };
    }
  }
  const missing = RECOMMENDED_DENY.filter((entry) => !deny.includes(entry));
  if (missing.length === 0) return ok(`deny: ${path} has the recommended block`);
  const text2 = `deny: ${path} misses ${missing.length} of ${RECOMMENDED_DENY.length} rules, add the recommended block:`;
  return { ...warn(text2), block: formatDenyBlock() };
};
var checkJournal = (projectRoot) => {
  const files = listJournalFiles(projectRoot);
  const bytes = files.reduce((total, file) => total + file.size, 0);
  const text2 = `journal: ${(bytes / BYTES_PER_MB).toFixed(1)} MB in ${files.length} files`;
  return bytes > JOURNAL_MAX_BYTES ? warn(`${text2}, above ${JOURNAL_MAX_BYTES / BYTES_PER_MB} MB`) : ok(text2);
};
var checkLock = (path) => {
  if (!existsSync5(path)) return ok(`lock: ${path} free`);
  if (isLockAbandoned(path)) return warn(`lock: ${path} abandoned, remove it`);
  const holder = readLock(path);
  return ok(`lock: ${path} held${holder === void 0 ? "" : ` by pid ${holder.pid}`}`);
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
  const agentViewSetup = checkAgentViewSetup(discovery);
  return [
    checkNode(),
    ok(`plugin: ${pluginRoot}`),
    ok(`project: ${projectRoot}`),
    checkConfig(config),
    checkTiers(),
    ...CATALOG.map((entry) => checkCatalogEntry(entry, config, tools, discovery)),
    ...agentViewSetup === void 0 ? [] : [agentViewSetup],
    ...checkCustom(config),
    checkGitignore(projectRoot),
    checkDeny(projectRoot),
    checkJournal(projectRoot),
    checkLock(paths.heavyLock),
    checkLock(join13(paths.cache, "slot.lock"))
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

// src/core/snapshot.ts
import { createHash as createHash4 } from "node:crypto";
import { statSync as statSync8 } from "node:fs";
import { join as join14 } from "node:path";
var stampOf = (absolutePath) => {
  try {
    const stat = statSync8(absolutePath);
    return stat.isFile() ? { mtimeMs: stat.mtimeMs, size: stat.size } : void 0;
  } catch {
    return void 0;
  }
};
var isInsideProject = (path) => path !== "" && !path.startsWith("../") && path !== "..";
var changedFiles = (projectRoot) => {
  const top = gitToplevel(projectRoot);
  if (top === void 0) return [];
  const entries = gitStatus(top) ?? [];
  return entries.map((entry) => toProjectPath(projectRoot, join14(top, entry.path))).filter(isInsideProject);
};
var takeSnapshot = (projectRoot) => {
  const snapshot2 = {};
  for (const path of changedFiles(projectRoot)) {
    const stamp = stampOf(join14(projectRoot, path));
    if (stamp !== void 0) {
      snapshot2[path] = stamp;
    }
  }
  return snapshot2;
};
var isSameStamp = (left, right) => left !== void 0 && left.mtimeMs === right.mtimeMs && left.size === right.size;
var diffFingerprint = (stamps) => {
  const lines = Object.keys(stamps).sort().map((path) => `${path}:${stamps[path]?.mtimeMs}:${stamps[path]?.size}`);
  return createHash4("sha1").update(lines.join("\n")).digest("hex");
};
var turnDiff = (projectRoot, snapshot2, edits) => {
  const stamps = {};
  for (const { path } of edits) {
    const stamp = stampOf(join14(projectRoot, path));
    if (stamp !== void 0) {
      stamps[path] = stamp;
    }
  }
  for (const path of changedFiles(projectRoot)) {
    if (Object.hasOwn(stamps, path)) continue;
    const stamp = stampOf(join14(projectRoot, path));
    if (stamp === void 0 || isSameStamp(snapshot2[path], stamp)) continue;
    stamps[path] = stamp;
  }
  const files = Object.keys(stamps).sort();
  return { files, stamps, fingerprint: diffFingerprint(stamps) };
};

// src/task-status/task-status.ts
import { appendFileSync as appendFileSync3, mkdirSync as mkdirSync9, readFileSync as readFileSync16 } from "node:fs";
import { dirname as dirname8, join as join15 } from "node:path";

// src/task-status/template.html
var template_default = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>jig task status</title>\n<style>\nbody {\n  --paper: #faf9f5; --card: #fff; --sunk: #f0eee6;\n  --ink: #141413; --ink-2: #3d3d3a; --ink-3: #73726c; --line: rgba(31,30,29,.15); --line-2: rgba(31,30,29,.08);\n  --accent: #c6613f; --accent-soft: #f6e7df; --green: #2c7a39; --green-soft: #e2efdf;\n  --red: #b3261e; --red-soft: #f7dfdc; --blue: #2a69b8; --blue-soft: #dde8f5; --float: 0 2px 8px rgba(0,0,0,.08);\n  --sans: ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif; --serif: ui-serif, Georgia, \"Times New Roman\", serif; --mono: ui-monospace, \"SF Mono\", Menlo, Consolas, monospace;\n}\n@media (prefers-color-scheme: dark) { body:not(.light) { color-scheme: dark;\n  --paper: #262624; --card: #30302e; --sunk: #1f1e1d;\n  --ink: #faf9f5; --ink-2: #c2c0b6; --ink-3: #9c9a92; --line: rgba(222,220,209,.15); --line-2: rgba(222,220,209,.08);\n  --accent: #d97757; --accent-soft: #46302a; --green: #6fb37a; --green-soft: #26372a;\n  --red: #e5776e; --red-soft: #432725; --blue: #7aa7e0; --blue-soft: #25313f; --float: 0 2px 8px rgba(0,0,0,.3);\n} }\nbody.dark { color-scheme: dark;\n  --paper: #262624; --card: #30302e; --sunk: #1f1e1d;\n  --ink: #faf9f5; --ink-2: #c2c0b6; --ink-3: #9c9a92; --line: rgba(222,220,209,.15); --line-2: rgba(222,220,209,.08);\n  --accent: #d97757; --accent-soft: #46302a; --green: #6fb37a; --green-soft: #26372a;\n  --red: #e5776e; --red-soft: #432725; --blue: #7aa7e0; --blue-soft: #25313f; --float: 0 2px 8px rgba(0,0,0,.3);\n}\n:where(*) { box-sizing: border-box; }\n[hidden] { display: none !important; }\nbody { margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink); font: 430 16px/1.6 var(--sans); -webkit-text-size-adjust: 100%; overflow-x: clip; }\nh1, h2, p, ol { margin: 0; }\nol { padding: 0; list-style: none; }\nh1 { font: 500 26px/1.15 var(--serif); margin-bottom: 8px; text-wrap: balance; overflow-wrap: anywhere; }\nh2 { font: 500 22px/1.25 var(--serif); margin-bottom: 12px; display: flex; align-items: baseline; gap: 10px; }\na { color: var(--accent); text-underline-offset: 3px; }\nbutton { font: inherit; color: inherit; cursor: pointer; }\na:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\ntime, .mono { font: 12px/1.5 var(--mono); color: var(--ink-3); font-variant-numeric: tabular-nums; }\n.pill { display: inline-block; font: 550 12px/1 var(--sans); padding: 4px 8px; border-radius: 99px; background: var(--sunk); color: var(--ink-2); border: 1px solid var(--line); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }\n.pill.accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }\n.pill.green { background: var(--green-soft); color: var(--green); border-color: transparent; }\n.pill.red { background: var(--red-soft); color: var(--red); border-color: transparent; }\n\n.page { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 40px; max-width: 1180px; margin: 0 auto; padding: 32px 24px 120px; }\n.rail { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; }\n.meta { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; margin-bottom: 12px; overflow-wrap: anywhere; }\n.live { display: inline-flex; gap: 6px; align-items: center; }\n.big { font: 500 44px/1 var(--serif); margin: 6px 0 10px; }\n.big small { font: 430 16px/1 var(--sans); color: var(--ink-3); }\n.seg { display: flex; gap: 3px; margin-bottom: 8px; }\n.seg i { flex: 1; height: 6px; border-radius: 3px; background: var(--line); }\n.seg i.done { background: var(--green); } .seg i.active { background: var(--accent); } .seg i.blocked { background: var(--red); }\n.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; border: 1.5px solid var(--ink-3); background: var(--paper); }\n.dot.done { background: var(--green); border-color: var(--green); }\n.dot.active { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }\n.dot.blocked { background: var(--red); border-color: var(--red); }\n.line { position: relative; margin-top: 12px; }\n.line::before { content: \"\"; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 2px; background: var(--line); }\n.line li { position: relative; display: flex; gap: 12px; align-items: flex-start; padding: 5px 0; font-size: 14px; line-height: 1.45; }\n.line li .dot { margin-top: 5px; }\n.line li > div { min-width: 0; overflow-wrap: anywhere; }\n.line li.done > div { color: var(--ink-3); }\n.line li.blocked > div { color: var(--red); }\n.line li.active > div { font-weight: 600; }\n.line small { display: block; font-size: 12px; font-weight: 430; color: var(--ink-3); }\n.line li.blocked small { color: var(--red); }\n.runs { margin-top: 24px; font-size: 13px; color: var(--ink-3); }\n.runs li { padding: 2px 0; overflow-wrap: anywhere; }\n\n.inbox { margin-bottom: 32px; }\n.ask { padding: 16px; background: var(--card); border: 1px solid var(--accent); border-radius: 12px; margin-bottom: 14px; }\n.ask .k { font-size: 12px; font-weight: 550; color: var(--ink-3); margin-bottom: 8px; }\n.ask .q { font-weight: 600; margin-bottom: 6px; overflow-wrap: anywhere; }\n.ask .def { font-size: 14px; color: var(--ink-2); overflow-wrap: anywhere; }\n\n.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; position: sticky; top: 0; z-index: 4; background: var(--paper); padding: 10px 0; border-bottom: 1px solid var(--line-2); }\n.chips button { font-size: 13px; font-weight: 550; line-height: 1; padding: 7px 11px; border-radius: 99px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); }\n.chips button[aria-pressed=\"true\"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }\n.feed[data-f=\"d\"] .ev:not(.d), .feed[data-f=\"s\"] .ev:not(.s), .feed[data-f=\"q\"] .ev:not(.q) { display: none; }\n.ev { display: grid; grid-template-columns: 48px 26px minmax(0, 1fr); gap: 0 10px; position: relative; }\n.ev::before { content: \"\"; position: absolute; left: 70px; top: 0; bottom: 0; width: 1px; background: var(--line); }\n.ev > time { padding-top: 14px; text-align: right; }\n.ev .ico { width: 26px; height: 26px; margin-top: 12px; border-radius: 50%; display: grid; place-items: center; font: 600 12px/1 var(--mono); position: relative; }\n.ev.d .ico { background: var(--blue-soft); color: var(--blue); }\n.ev.s .ico { background: var(--green-soft); color: var(--green); }\n.ev.q .ico { background: var(--accent-soft); color: var(--accent); }\n.ev.start .ico { background: var(--ink); color: var(--paper); }\n.ev.start .item { border-color: var(--ink-3); background: var(--sunk); }\n.item { padding: 12px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; margin: 6px 0; min-width: 0; }\n.item .top { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }\n.item .top time { display: none; }\n.item p { font-size: 15px; overflow-wrap: anywhere; }\n.item.reverted p { text-decoration: line-through; color: var(--ink-3); }\n.item dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 14px; margin: 8px 0 0; font-size: 14px; }\n.item dt { font-size: 12px; line-height: 1.9; color: var(--ink-3); } .item dd { margin: 0; color: var(--ink-2); overflow-wrap: anywhere; }\n.empty { color: var(--ink-3); font-size: 14px; }\n\n.bar { position: fixed; z-index: 10; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); display: flex; gap: 8px; align-items: center; }\n.theme { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); box-shadow: var(--float); color: var(--ink-2); }\n\n@media (max-width: 900px) {\n  .page { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0 16px 110px; }\n  .rail { position: static; max-height: none; overflow: visible; padding: 14px 0 6px; border-bottom: 1px solid var(--line); }\n  h1 { font-size: 20px; margin-bottom: 4px; }\n  .big { font: 600 15px/1.4 var(--sans); margin: 0; } .big small { font-size: 13px; }\n  .chips { position: static; }\n  .feed { padding-top: 16px; }\n  .ev { grid-template-columns: 40px 22px minmax(0, 1fr); gap: 0 8px; }\n  .ev::before { left: 58px; }\n  .ev .ico { width: 22px; height: 22px; font-size: 11px; }\n}\n@media (max-width: 480px) {\n  .ev { grid-template-columns: 22px minmax(0, 1fr); }\n  .ev > time { display: none; }\n  .ev::before { left: 11px; }\n  .item .top time { display: inline; }\n}\n</style>\n</head>\n<body>\n<div id=\"app\"></div>\n<script type=\"application/json\" id=\"status\">\n{\"branch\":\"\",\"journal\":\"\",\"builtAt\":\"\",\"lang\":\"en\",\"rows\":[]}\n</script>\n<script>\nconst S = JSON.parse(document.getElementById('status').textContent);\nconst LIVE_MS = 15 * 60e3;\nconst LABELS = {\n  en: {\n    locale: 'en-GB',\n    title: 'jig task status',\n    branch: 'branch',\n    live: ago => `live, last row ${ago}`,\n    quiet: ago => `no rows ${ago}`,\n    built: at => `page built at ${at}, rebuild: jig task-status open`,\n    stepsDone: total => `/ ${total} steps done`,\n    steps: 'Steps',\n    runs: 'Runs in this journal',\n    runItem: (at, count) => `${at}, ${count} rows`,\n    theme: 'Light or dark theme',\n    open: 'Open questions',\n    taken: 'went with',\n    journal: 'Journal',\n    all: 'All',\n    decisions: 'Decisions',\n    stepRows: 'Steps',\n    questions: 'Questions',\n    start: 'run start',\n    why: 'why',\n    evidence: 'evidence',\n    nothing: 'Nothing yet.',\n    justNow: 'just now',\n    minAgo: m => `${m} min ago`,\n    hoursAgo: (h, m) => `${h} h ${m} min ago`,\n    daysAgo: d => `${d} d ago`,\n  },\n  ru: {\n    locale: 'ru-RU',\n    title: '\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u0434\u0430\u0447\u0438 jig',\n    branch: '\u0432\u0435\u0442\u043A\u0430',\n    live: ago => `\u0436\u0438\u0432\u043E\u0439, \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0442\u0440\u043E\u043A\u0430 ${ago}`,\n    quiet: ago => `\u043D\u0435\u0442 \u0441\u0442\u0440\u043E\u043A ${ago}`,\n    built: at => `\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0441\u043E\u0431\u0440\u0430\u043D\u0430 \u0432 ${at}, \u043F\u0435\u0440\u0435\u0441\u043E\u0431\u0440\u0430\u0442\u044C: jig task-status open --lang ru`,\n    stepsDone: total => `/ ${total} \u0448\u0430\u0433\u043E\u0432 \u0433\u043E\u0442\u043E\u0432\u043E`,\n    steps: '\u0428\u0430\u0433\u0438',\n    runs: '\u041F\u0440\u043E\u0433\u043E\u043D\u044B \u0432 \u0436\u0443\u0440\u043D\u0430\u043B\u0435',\n    runItem: (at, count) => `${at}, \u0441\u0442\u0440\u043E\u043A: ${count}`,\n    theme: '\u0421\u0432\u0435\u0442\u043B\u0430\u044F \u0438\u043B\u0438 \u0442\u0451\u043C\u043D\u0430\u044F \u0442\u0435\u043C\u0430',\n    open: '\u041E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B',\n    taken: '\u0432\u044B\u0431\u0440\u0430\u043D\u043E',\n    journal: '\u0416\u0443\u0440\u043D\u0430\u043B',\n    all: '\u0412\u0441\u0451',\n    decisions: '\u0420\u0435\u0448\u0435\u043D\u0438\u044F',\n    stepRows: '\u0428\u0430\u0433\u0438',\n    questions: '\u0412\u043E\u043F\u0440\u043E\u0441\u044B',\n    start: '\u043D\u0430\u0447\u0430\u043B\u043E \u043F\u0440\u043E\u0433\u043E\u043D\u0430',\n    why: '\u043F\u043E\u0447\u0435\u043C\u0443',\n    evidence: '\u0434\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u043E',\n    nothing: '\u041F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E.',\n    justNow: '\u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E',\n    minAgo: m => `${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`,\n    hoursAgo: (h, m) => `${h} \u0447 ${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`,\n    daysAgo: d => `${d} \u0434\u043D \u043D\u0430\u0437\u0430\u0434`,\n  },\n};\nconst lang = Object.hasOwn(LABELS, S.lang) ? S.lang : 'en';\nconst L = LABELS[lang];\nconst esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'}[c]));\nconst hm = t => {\n  const d = new Date(t);\n  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(L.locale, {hour: '2-digit', minute: '2-digit'});\n};\nconst dayHm = t => {\n  const d = new Date(t);\n  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(L.locale, {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'});\n};\nconst ago = t => {\n  const m = Math.round((Date.now() - new Date(t)) / 60e3);\n  return m < 1 ? L.justNow : m < 60 ? L.minAgo(m) : m < 1440 ? L.hoursAgo(Math.floor(m / 60), m % 60) : L.daysAgo(Math.floor(m / 1440));\n};\n\nconst kindOf = row => row.phase === 'start' ? 'start' : row.phase === 'step' ? 's' : row.phase === 'question' ? 'q' : 'd';\nconst toneOf = result => {\n  if (/\\b(reverted|blocked|failed|fail|red|not verified|inconclusive)\\b/i.test(result)) return 'red';\n  if (/\\b(kept|done|verified|green|passed|pass|answered)\\b/i.test(result)) return 'green';\n  if (/^(open|active)\\b/i.test(result)) return 'accent';\n  return '';\n};\nconst stepStatus = result => {\n  const word = (/^\\s*(\\w+)/.exec(result) || [])[1]?.toLowerCase();\n  return ['done', 'active', 'blocked'].includes(word) ? word : 'todo';\n};\nconst latestBy = rows => [...rows.reduce((map, row) => map.set(row.decision, row), new Map()).values()];\n\nconst rows = S.rows;\nconst starts = rows.map((row, i) => ({row, i})).filter(({row}) => row.phase === 'start');\nconst runFrom = starts.length ? starts[starts.length - 1].i : 0;\nconst runRows = rows.slice(runFrom);\nconst title = starts.length ? starts[starts.length - 1].row.decision : L.title;\nconst last = rows[rows.length - 1];\nconst isLive = last !== undefined && Date.now() - new Date(last.ts) < LIVE_MS;\nconst steps = latestBy(runRows.filter(row => row.phase === 'step')).map(row => ({...row, status: stepStatus(row.result)}));\nconst done = steps.filter(s => s.status === 'done').length;\nconst openQuestions = latestBy(runRows.filter(row => row.phase === 'question')).filter(row => row.result === '' || /^open\\b/i.test(row.result));\nconst runs = (starts.length && starts[0].i === 0 ? starts : [{row: rows[0], i: 0}, ...starts]).filter(({row}) => row !== undefined)\n  .map(({row, i}, n, all) => ({row, count: (all[n + 1]?.i ?? rows.length) - i}));\n\nconst link = text => /^https?:\\/\\/\\S+$/.test(text) ? `<a href=\"${esc(text)}\">${esc(text)}</a>` : esc(text);\nconst rowItem = row => {\n  const tone = toneOf(row.result);\n  const tags = [\n    row.phase === 'start' ? `<span class=\"pill\">${L.start}</span>` : `<span class=\"pill\">${esc(row.phase)}</span>`,\n    row.result ? `<span class=\"pill ${tone}\">${esc(row.result)}</span>` : '',\n  ].join('');\n  const extra = [[L.why, row.why, esc], [L.evidence, row.evidence, link]].filter(([, v]) => v);\n  const more = extra.length ? `<dl>${extra.map(([k, v, show]) => `<dt>${k}</dt><dd>${show(v)}</dd>`).join('')}</dl>` : '';\n  const reverted = /\\breverted\\b/i.test(row.result) ? ' reverted' : '';\n  return `<div class=\"item${reverted}\"><div class=\"top\"><time>${hm(row.ts)}</time>${tags}</div><p>${esc(row.decision)}</p>${more}</div>`;\n};\nconst ICON = {d: '\u25C6', s: '\u2713', q: '?', start: '\u25B6'};\nconst counts = {d: 0, s: 0, q: 0, start: 0};\nfor (const row of rows) counts[kindOf(row)]++;\nconst FILTERS = [['all', L.all, rows.length], ['d', L.decisions, counts.d], ['s', L.stepRows, counts.s], ['q', L.questions, counts.q]];\nconst savedFilter = localStorage.getItem('jig-task-status-filter');\nconst filter = FILTERS.some(([k, , count]) => k === savedFilter && count) ? savedFilter : 'all';\n\nconst stepLine = s => `<li class=\"${s.status}\"><i class=\"dot ${s.status}\"></i><div>${esc(s.decision)}${s.result ? `<small>${esc(s.result)}</small>` : ''}</div></li>`;\nconst askCard = q => `<section class=\"ask\"><div class=\"k\">${dayHm(q.ts)}</div><p class=\"q\">${esc(q.decision)}</p>${q.why ? `<p class=\"def\">${L.taken}: ${esc(q.why)}</p>` : ''}</section>`;\n\ndocument.documentElement.lang = lang;\nconst theme = localStorage.getItem('jig-task-status-theme');\ndocument.body.classList.toggle('light', theme === 'light');\ndocument.body.classList.toggle('dark', theme === 'dark');\ndocument.title = title;\ndocument.getElementById('app').innerHTML = `<div class=\"page\">\n  <aside class=\"rail\">\n    <h1>${esc(title)}</h1>\n    <p class=\"meta mono\"><span>${L.branch} ${esc(S.branch)}</span>${last ? `<span class=\"live\"><i class=\"dot ${isLive ? 'done' : 'blocked'}\"></i>${isLive ? L.live(ago(last.ts)) : L.quiet(ago(last.ts))}</span>` : ''}</p>\n    ${steps.length ? `<p class=\"big\">${done}<small> ${L.stepsDone(steps.length)}</small></p>\n    <div class=\"seg\">${steps.map(s => `<i class=\"${s.status}\" title=\"${esc(s.decision)}\"></i>`).join('')}</div>\n    <ol class=\"line\" aria-label=\"${L.steps}\">${steps.map(stepLine).join('')}</ol>` : ''}\n    ${runs.length > 1 ? `<ol class=\"runs\" aria-label=\"${L.runs}\"><li><b>${L.runs}</b></li>${runs.map(({row, count}) => `<li>${esc(row.phase === 'start' ? row.decision : row.phase)} \xB7 ${L.runItem(dayHm(row.ts), count)}</li>`).join('')}</ol>` : ''}\n    <p class=\"runs mono\">${L.built(dayHm(S.builtAt))}<br>${esc(S.journal)}</p>\n  </aside>\n  <main class=\"feed\" data-f=\"${filter}\">\n    ${openQuestions.length ? `<section class=\"inbox\"><h2>${L.open} <span class=\"pill accent\">${openQuestions.length}</span></h2>${openQuestions.map(askCard).join('')}</section>` : ''}\n    <h2>${L.journal}</h2>\n    ${rows.length ? `<div class=\"chips\" role=\"toolbar\">${FILTERS.filter(([, , count]) => count).map(([k, label, count]) => `<button type=\"button\" data-f=\"${k}\" aria-pressed=\"${filter === k}\">${label} \xB7 ${count}</button>`).join('')}</div>\n    ${[...rows].reverse().map(row => `<div class=\"ev ${kindOf(row)}\"><time>${hm(row.ts)}</time><span class=\"ico\">${ICON[kindOf(row)]}</span>${rowItem(row)}</div>`).join('')}` : `<p class=\"empty\">${L.nothing}</p>`}\n  </main>\n</div>\n<div class=\"bar\"><button class=\"theme\" type=\"button\" aria-label=\"${L.theme}\">&#9680;</button></div>`;\n\nfor (const chip of document.querySelectorAll('.chips button')) {\n  chip.addEventListener('click', () => {\n    document.querySelector('.feed').dataset.f = chip.dataset.f;\n    for (const other of document.querySelectorAll('.chips button')) other.setAttribute('aria-pressed', String(other === chip));\n    localStorage.setItem('jig-task-status-filter', chip.dataset.f);\n  });\n}\n\ndocument.querySelector('.theme').addEventListener('click', () => {\n  const isDark = getComputedStyle(document.body).colorScheme === 'dark';\n  const next = isDark ? 'light' : 'dark';\n  document.body.classList.toggle('light', next === 'light');\n  document.body.classList.toggle('dark', next === 'dark');\n  localStorage.setItem('jig-task-status-theme', next);\n});\n</script>\n</body>\n</html>\n";

// src/task-status/task-status.ts
var COLUMNS = ["ts", "phase", "decision", "why", "evidence", "result"];
var START_PHASE = "start";
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
  const dir = join15(jigPaths(projectRoot).runs, branch);
  return { branch, journal: join15(dir, "task-status.tsv"), page: join15(dir, "task-status.html") };
};
var cleanCell = (value) => value.replace(/\r\n|[\t\n\r]/g, " ").trim();
var formatRow = (row) => COLUMNS.map((column) => cleanCell(row[column])).join("	");
var parseLine = (line) => {
  const [ts = "", phase = "", decision = "", why = "", evidence = "", ...result] = line.split("	");
  return { ts, phase, decision, why, evidence, result: result.join(" ") };
};
var parseJournal = (text2) => text2.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== "" && line !== HEADER).map(parseLine);
var readText3 = (path) => {
  try {
    return readFileSync16(path, "utf8");
  } catch {
    return void 0;
  }
};
var readJournalRows = (path) => {
  const text2 = readText3(path);
  return text2 === void 0 ? void 0 : parseJournal(text2);
};
var appendRow = (path, input, now) => {
  const row = {
    ts: now.toISOString(),
    phase: cleanCell(input.phase),
    decision: cleanCell(input.decision),
    why: cleanCell(input.why ?? ""),
    evidence: cleanCell(input.evidence ?? ""),
    result: cleanCell(input.result ?? "")
  };
  mkdirSync9(dirname8(path), { recursive: true });
  const isFresh = (readText3(path) ?? "").trim() === "";
  appendFileSync3(path, `${isFresh ? `${HEADER}
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
var isPageLang = (value) => PAGE_LANGS.some((lang) => lang === value);
var parseOpen = (args) => {
  if (args.length === 0) return "en";
  const [flag, value, ...rest] = args;
  if (flag !== "--lang" || rest.length > 0) throw usage("usage: task-status open [--lang en|ru]");
  if (!isPageLang(value)) throw usage(`--lang must be ${PAGE_LANGS.join(" or ")}, got ${value ?? "nothing"}`);
  return value;
};
var renderPage = (data) => {
  const json = JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
  return template_default.replace(DATA_BLOCK, (_match, open, _body, close) => `${open}
${json}
${close}`);
};
var noJournal = (location) => new TaskStatusFailure(EXIT_NOT_MET, `no task-status journal for branch ${location.branch}, start one with: task-status log start "<task title>"`);
var openPage = (location, args, now) => {
  const lang = parseOpen(args);
  const rows = readJournalRows(location.journal);
  if (rows === void 0) throw noJournal(location);
  const journal2 = toSlash(location.journal);
  writeFileAtomic(location.page, renderPage({ branch: location.branch, journal: journal2, builtAt: now.toISOString(), lang, rows }));
  return toSlash(location.page);
};
var dispatch = (args, now) => {
  const [sub, ...rest] = args;
  const projectRoot = resolveProjectRoot(process.cwd());
  const location = journalLocation(projectRoot);
  if (sub === "log") {
    const input = parseLog(rest);
    ensureJigDir(projectRoot);
    appendRow(location.journal, input, now);
    return toSlash(location.journal);
  }
  if (sub === "open") return openPage(location, rest, now);
  if (sub === "path") {
    if (readJournalRows(location.journal) === void 0) throw noJournal(location);
    return toSlash(location.journal);
  }
  throw usage(`unknown task-status subcommand ${sub ?? "(none)"}, expected log, open or path`);
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
var limitLines = (lines, limit, pluginRoot) => {
  if (lines.length <= limit) return [...lines];
  const kept = lines.slice(0, limit - 1);
  return [...kept, truncationLine(lines.length - kept.length, pluginRoot)];
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
var firstLine2 = (text2) => text2.split("\n").map((line) => line.trim()).find((line) => line !== "")?.slice(0, MESSAGE_MAX) ?? "";
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
  const parse = outputParser(check2.format);
  if (check2.format === EXIT_FORMAT || parse === void 0) {
    const isClean = result.code === 0;
    const [file = ""] = files;
    const findings2 = isClean ? [] : [exitFinding(check2, file, result.stderr || result.stdout, result.code)];
    return { tool, findings: withSeverity(findings2, check2.level), durationMs: result.durationMs };
  }
  const settled = settleExit(
    { tool, argv, cwd: projectRoot, timeoutMs, okCodes: PARSED_OK_CODES, parse: (stdout) => parse(stdout, projectRoot, projectRoot) },
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
  const isIgnored = createMatcher(setting.ignoreRules);
  return applyLevel(
    findings.filter((finding) => !isIgnored(finding.rule)),
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
var NONE = { type: "none" };
var isBlocking = (finding) => finding.severity === "error";
var failureNotes = (runs) => runs.filter((toolRun) => toolRun.failure !== void 0).map((toolRun) => ({ kind: "tool-failure", tool: toolRun.tool, message: toolRun.failure ?? "", durationMs: toolRun.durationMs }));
var timed = async (rule, body) => {
  const startedAt = Date.now();
  const { runs, findings } = await body();
  return { rule, runs, findings, durationMs: Date.now() - startedAt };
};
var createBudget = (startedAt) => (ownMs) => Math.max(0, Math.min(ownMs, startedAt + STOP_HARD_LIMIT_MS - Date.now()));
var toolStep = (tool, input, toolInput) => timed(tool.rule, async () => {
  const setting = toolSetting(input.plan.config, tool);
  const files = toolFiles(tool, toolInput.files);
  if (setting === void 0 || tool.stop === void 0 || files.length === 0) return { runs: [], findings: [] };
  const { runs, findings } = await tool.stop(input.plan.tools, { ...toolInput, files });
  return { runs, findings: applySetting(findings, setting) };
});
var CUSTOM_CHECK_TIMEOUT_MS = 3e4;
var customStep = (check2, input, toolInput) => timed(checkRule(check2), async () => {
  const files = checkFiles(check2, toolInput.files);
  const timeoutMs = toolInput.budget(CUSTOM_CHECK_TIMEOUT_MS);
  if (check2.level === "off" || files.length === 0 || timeoutMs === 0) return { runs: [], findings: [] };
  const toolRun = await runCustomCheck(input.projectRoot, check2, files, timeoutMs);
  return { runs: [toolRun], findings: toolRun.findings };
});
var isStopTool = (tool) => tool.stop !== void 0;
var runStopChecks = async (input) => {
  const startedAt = Date.now();
  const budget = createBudget(startedAt);
  const notes = [];
  const steps = [];
  const isStopped = () => steps.some((step) => step.findings.some(isBlocking));
  const acquired = await acquireLock(jigPaths(input.projectRoot).heavyLock);
  if (acquired === void 0) {
    notes.push({ kind: "gate-skipped", tool: "jig", message: "heavy checks lock is busy" });
  } else {
    const lock = { path: acquired.path, isTransferred: false };
    const transfer = (pid) => {
      transferLock(lock.path, pid);
      lock.isTransferred = true;
    };
    const toolInput = { projectRoot: input.projectRoot, files: input.diff.files, budget, lock: { path: lock.path, transfer }, notes };
    try {
      const queue = [
        ...TOOLS.filter(isStopTool).map((tool) => () => toolStep(tool, input, toolInput)),
        ...input.plan.config.checks.filter((check2) => check2.on === "stop").map((check2) => () => customStep(check2, input, toolInput))
      ];
      for (const step of queue) {
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
  notes.push(...failureNotes(steps.flatMap((step) => step.runs)));
  return { steps, findings, blocking: findings.filter(isBlocking), notes, durationMs: Date.now() - startedAt };
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
var stopGate = async (input) => {
  const { projectRoot, pluginRoot, state } = input;
  const diff = turnDiff(projectRoot, state.snapshot, state.edits);
  const isQuiet = diff.files.length === 0 || diff.fingerprint === state.stop.lastGreenFingerprint;
  if (isQuiet) return { outcome: NONE, notes: [] };
  const isUnresolved = input.stopHookActive && diff.fingerprint === state.stop.lastBlockDiffFingerprint;
  if (isUnresolved) {
    logToActiveJournal(projectRoot, { phase: "gate", decision: "gate unresolved", why: UNRESOLVED_WHY });
    return { outcome: NONE, notes: [{ kind: "gate-unresolved", tool: "jig", message: UNRESOLVED_WHY }] };
  }
  const plan = loadPlan(projectRoot, pluginRoot);
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan, diff });
  if (checks.blocking.length === 0) {
    state.stop = { lastGreenFingerprint: diff.fingerprint, consecutiveBlocks: 0 };
    resetSnapshot(state, takeSnapshot(projectRoot));
    return { outcome: NONE, notes: [...checks.notes, { kind: "gate-pass", tool: "jig", durationMs: checks.durationMs }] };
  }
  const fingerprint = findingsFingerprint(checks.blocking);
  const isRepeat = fingerprint === state.stop.lastBlockFingerprint;
  const consecutiveBlocks = isRepeat ? state.stop.consecutiveBlocks + 1 : 1;
  if (consecutiveBlocks > MAX_CONSECUTIVE_BLOCKS) {
    state.stop = { consecutiveBlocks: 0 };
    const [first] = checks.blocking;
    const giveUp = { kind: "gate-giveup", tool: "jig", durationMs: checks.durationMs, ...first && { rule: first.rule, file: first.file } };
    return { outcome: NONE, notes: [...checks.notes, giveUp] };
  }
  state.stop = { ...state.stop, lastBlockFingerprint: fingerprint, consecutiveBlocks, lastBlockDiffFingerprint: diff.fingerprint };
  return {
    outcome: { type: "block", reason: blockReason(checks.blocking, pluginRoot) },
    notes: [...checks.notes, ...blockNotes(checks.blocking)]
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
var checkStopCommand = async (projectRoot, pluginRoot) => {
  const diff = turnDiff(projectRoot, {}, []);
  if (diff.files.length === 0) {
    process.stdout.write("clean\n");
    return 0;
  }
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan: loadPlan(projectRoot, pluginRoot), diff });
  printFailures(checks.steps.flatMap((step) => step.runs));
  if (checks.findings.length === 0) {
    process.stdout.write("clean\n");
    return 0;
  }
  process.stdout.write(`${formatFindings(checks.findings, STOP_LINE_LIMIT, pluginRoot).join("\n")}
`);
  return checks.blocking.length > 0 ? EXIT_FINDINGS : 0;
};
var checkEditCommand = async (projectRoot, pluginRoot, file) => {
  if (file === void 0 || file === "") {
    process.stderr.write("jig: check edit needs a file\n");
    return EXIT_USAGE2;
  }
  const path = toProjectPath(projectRoot, file, process.cwd());
  const runs = await checkEdit(loadPlan(projectRoot, pluginRoot), projectRoot, path);
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
import { readFileSync as readFileSync18 } from "node:fs";
import { join as join16 } from "node:path";

// src/adapters/claude.ts
import { readFileSync as readFileSync17 } from "node:fs";
import { isAbsolute as isAbsolute3, resolve as resolve7 } from "node:path";
var SESSION_SOURCES = ["startup", "resume", "clear", "compact", "fork"];
var HOOK_EVENT_NAMES = {
  "session-start": "SessionStart",
  prompt: "UserPromptSubmit",
  "pre-edit": "PreToolUse",
  "post-edit": "PostToolUse",
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
    return readFileSync17(absolutePath, "utf8");
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
var preEditEvent = (toolName, input, paths) => {
  const rawFile = toolName === "NotebookEdit" ? text(input, "notebook_path") : text(input, "file_path");
  if (rawFile === void 0) return void 0;
  const absolute = isAbsolute3(rawFile) ? rawFile : resolve7(paths.cwd, rawFile);
  const file = toProjectPath(paths.projectRoot, absolute);
  if (toolName === "Edit") {
    const before = text(input, "old_string");
    const after = text(input, "new_string");
    if (before === void 0 || after === void 0) return void 0;
    return { kind: "pre-edit", file, edits: [{ before, after }] };
  }
  if (toolName === "MultiEdit") {
    const edits = multiEditPairs(input);
    return edits === void 0 ? void 0 : { kind: "pre-edit", file, edits };
  }
  if (toolName === "Write") {
    const content = text(input, "content");
    if (content === void 0) return void 0;
    return { kind: "pre-edit", file, edits: [{ before: readCurrent(absolute), after: content }], wholeFile: content };
  }
  if (toolName === "NotebookEdit") {
    return { kind: "pre-edit", file, edits: [{ before: "", after: text(input, "new_source") ?? "" }] };
  }
  return void 0;
};
var toolFile = (input, paths) => {
  const rawFile = text(input, "file_path") ?? text(input, "notebook_path");
  return rawFile === void 0 ? void 0 : toProjectPath(paths.projectRoot, rawFile, paths.cwd);
};
var toEvent = (name, input, paths) => {
  const toolName = text(input, "tool_name");
  const toolInput = isObject2(input["tool_input"]) ? input["tool_input"] : {};
  switch (name) {
    case "session-start": {
      const source = SESSION_SOURCES.find((candidate) => candidate === input["source"]) ?? "startup";
      return { kind: "session-start", source };
    }
    case "user-prompt-submit":
      return { kind: "prompt" };
    case "pre-edit":
      return preEditEvent(toolName, toolInput, paths);
    case "post-edit": {
      const file = toolFile(toolInput, paths);
      return file === void 0 ? void 0 : { kind: "post-edit", file };
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
var parseHookInput = (name, raw, env = process.env) => {
  const input = parseJson(raw);
  if (!isObject2(input)) return void 0;
  const sessionId = text(input, "session_id");
  if (sessionId === void 0) return void 0;
  const cwd = resolve7(text(input, "cwd") ?? process.cwd());
  const projectRoot = resolveProjectRoot(cwd, env);
  const event = toEvent(name, input, { projectRoot, cwd });
  if (event === void 0) return void 0;
  const agentId = text(input, "agent_id");
  const base = agentId === void 0 ? { sessionId, projectRoot, cwd } : { sessionId, agentId, projectRoot, cwd };
  return { event, base };
};
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
var claude = { name: "claude", parseHookInput, formatOutcome };

// src/adapters/index.ts
var ADAPTERS = { claude };
var DEFAULT_AGENT = "claude";
var resolveAdapter = (name = DEFAULT_AGENT) => {
  const adapter = Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : void 0;
  if (adapter === void 0) throw new Error(`unknown agent ${name}, expected one of: ${Object.keys(ADAPTERS).join(", ")}`);
  return adapter;
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
var sessionStart = (event, ctx) => {
  const now = Date.now();
  ensureJigDir(ctx.projectRoot);
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot);
  pruneStates(ctx.projectRoot, now);
  pruneGateClaims(ctx.projectRoot, now);
  rotateJournal(ctx.projectRoot, now);
  const snapshot2 = takeSnapshot(ctx.projectRoot);
  const state = readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, snapshot2);
  resetSnapshot(state, snapshot2);
  trackTurn(ctx, state);
  const parts = [];
  if (event.source === "compact") {
    resetGateAtoms(ctx.projectRoot, ctx.sessionId, ctx.agent);
    const runLine = compactRunLine(ctx, now);
    if (runLine !== void 0) {
      parts.push(runLine);
    }
  }
  writeState(ctx.projectRoot, state);
  const driftLine = configDriftLine(plan);
  if (driftLine !== void 0) {
    parts.push(driftLine);
  }
  return contextOf(parts);
};
var prompt = (ctx) => {
  const state = openSession(ctx);
  resetSnapshot(state, takeSnapshot(ctx.projectRoot));
  state.turn += 1;
  ctx.turn = state.turn;
  writeState(ctx.projectRoot, state);
  return NONE2;
};
var readCurrent2 = (path) => {
  try {
    return readFileSync18(path, "utf8");
  } catch {
    return "";
  }
};
var locateEdits = (event, projectRoot) => {
  if (event.wholeFile !== void 0) return event.edits.map((edit) => ({ ...edit, line: 1, prefix: "" }));
  const current = readCurrent2(join16(projectRoot, event.file));
  return event.edits.map((edit) => {
    const at = edit.before === "" ? -1 : current.indexOf(edit.before);
    if (at === -1) return edit;
    const prefix = current.slice(0, at);
    return { ...edit, line: prefix.split("\n").length, prefix };
  });
};
var preEdit = (event, ctx) => {
  const verdict = gateEdit({
    projectRoot: ctx.projectRoot,
    pluginRoot: ctx.pluginRoot,
    sessionId: ctx.sessionId,
    agent: ctx.agent,
    file: event.file,
    edits: locateEdits(event, ctx.projectRoot),
    config: loadConfig(ctx.projectRoot)
  });
  for (const hit of verdict.hits) {
    journal(ctx, { kind: "deny", tool: "jig", rule: hit.rule, file: event.file, ...hit.line === void 0 ? {} : { line: hit.line }, message: hit.message });
  }
  return verdict.reason === void 0 ? NONE2 : { type: "deny", reason: verdict.reason };
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
var postEdit = async (event, ctx) => {
  const now = Date.now();
  const state = openSession(ctx);
  state.edits.push({ path: event.file, at: now, agent: ctx.agent });
  const toolFindings = await editToolFindings(ctx, event.file);
  const findingLines = collapseFindings(toolFindings);
  writeState(ctx.projectRoot, state);
  return contextOf(limitLines(findingLines, POST_EDIT_LINE_LIMIT, ctx.pluginRoot));
};
var ROLE_PATH = /\S*[\\/]roles[\\/]([\w-]+)\.md\b/g;
var subagentStart = (event, ctx) => {
  const prompt2 = event.prompt?.replace(ROLE_PATH, "role $1");
  journal(ctx, { kind: "subagent-start", tool: "jig", rule: event.agentType, ...prompt2 === void 0 ? {} : { message: prompt2 } });
  return NONE2;
};
var stop = async (event, ctx) => {
  const state = openSession(ctx);
  const verdict = await stopGate({ projectRoot: ctx.projectRoot, pluginRoot: ctx.pluginRoot, state, stopHookActive: event.stopHookActive });
  writeState(ctx.projectRoot, state);
  for (const note of verdict.notes) {
    journal(ctx, note);
  }
  return verdict.outcome;
};
var route = (event, ctx) => {
  switch (event.kind) {
    case "session-start":
      return sessionStart(event, ctx);
    case "prompt":
      return prompt(ctx);
    case "pre-edit":
      return preEdit(event, ctx);
    case "post-edit":
      return postEdit(event, ctx);
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
  const outcome = await dispatch2(parsed.event, parsed.base, resolvePluginRoot(env));
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
var runHook = async (args) => {
  const { name, adapter } = parseHookArgs(args);
  try {
    const output = await handleHook(name, await readStdin(), process.env, adapter);
    if (output !== "") {
      process.stdout.write(output);
    }
  } catch {
    return 0;
  }
  return 0;
};

// src/init/init.ts
import { existsSync as existsSync6, readFileSync as readFileSync19 } from "node:fs";
var SCHEMA_URL = "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json";
var BOUNDARIES_PLUGIN = "eslint-plugin-boundaries";
var BOUNDARIES_IGNORE = "boundaries/*";
var USAGE = "usage: jig init [--update] [--json]";
var EXIT_USAGE3 = 2;
var NAME_WIDTH = 12;
var isObject3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readSharedConfig = (projectRoot) => {
  const path = jigPaths(projectRoot).config;
  if (!existsSync6(path)) return {};
  try {
    const value = parseJsonc(readFileSync19(path, "utf8"));
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
  return proposal;
};
var questionsFor = (discovery, boundaries) => {
  const byName = new Map(discovery.found.map((found) => [found.name, found]));
  const setupOf = (name) => catalogEntry(name)?.setup.join(", then ") ?? "";
  const questions = [
    "App run command (slots.dev) and install command (slots.install), if the project runs an app."
  ];
  const agentView = byName.get("agent-view");
  const agentViewState = agentView === void 0 ? "not installed" : agentView.status === "ready" ? "configured" : "installed, no agent-view.config.json";
  questions.push(`agent-view for UI proof (${agentViewState}): needed? Setup: ${setupOf("agent-view")}.`);
  const stratum = byName.get("stratum");
  const stratumState = stratum === void 0 ? "not installed" : stratum.status === "ready" ? "configured" : "installed, no stratum.config.jsonc";
  const port = boundaries ? ` ${BOUNDARIES_PLUGIN} is present: port its rules to stratum, then "eslint": { "ignoreRules": ["${BOUNDARIES_IGNORE}"] }.` : "";
  questions.push(`stratum for module layers (${stratumState}): needed? Setup: ${setupOf("stratum")}.${port}`);
  return questions;
};
var buildInitReport = (projectRoot, update) => {
  const discovery = discover(projectRoot);
  const config = loadConfig(projectRoot);
  const base = update ? readSharedConfig(projectRoot) : {};
  const boundaries = discovery.packages.includes(BOUNDARIES_PLUGIN);
  const drift = update ? configDrift(projectRoot, config, resolveTools(projectRoot, config).unresolved) : [];
  const listed = update ? config : { tools: {}, proofs: {} };
  return { update, discovery, boundaries, drift, questions: questionsFor(discovery, boundaries), proposal: buildProposal(base, discovery, listed) };
};
var foundLine = (found) => {
  const facts = [
    found.status === "ready" ? "ready" : "needs setup",
    found.markers.length > 0 ? `markers ${found.markers.join(", ")}` : "no marker config",
    ...found.packages.length > 0 ? [`packages ${found.packages.join(", ")}`] : [],
    ...found.command === void 0 ? [] : [`command ${found.command}`],
    found.bin === void 0 ? "binary not installed" : `binary ${found.bin.join(" ")}`,
    ...found.status === "needs-setup" && found.setup.length > 0 ? [`setup: ${found.setup.join(", then ")}`] : []
  ];
  return `  ${found.name.padEnd(NAME_WIDTH)} ${facts.join("; ")}`;
};
var formatInitReport = (report) => {
  const foundNames = new Set(report.discovery.found.map((found) => found.name));
  const missing = CATALOG.filter((entry) => !foundNames.has(entry.name)).map((entry) => entry.name);
  const lines = [
    `jig init${report.update ? " --update" : ""}: discovery by the jig catalog; nothing is written.`,
    "",
    "found:",
    ...report.discovery.found.map(foundLine),
    ...missing.length > 0 ? [`not found: ${missing.join(", ")}`] : [],
    `${BOUNDARIES_PLUGIN}: ${report.boundaries ? "declared in package.json" : "absent"}`
  ];
  if (report.update) {
    lines.push("", "drift:", ...report.drift.length > 0 ? report.drift.map((reason) => `  ${reason}`) : ["  none"]);
  }
  lines.push("", "ask the user (code cannot know):", ...report.questions.map((question) => `  - ${question}`));
  lines.push("", "proposal for .jig/config.jsonc:", JSON.stringify(report.proposal, null, 2));
  return `${lines.join("\n")}
`;
};
var runInit = (args) => {
  const unknown = args.filter((arg) => arg !== "--update" && arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(`jig: ${USAGE}
`);
    return EXIT_USAGE3;
  }
  const report = buildInitReport(resolveProjectRoot(process.cwd()), args.includes("--update"));
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(report, null, 2)}
` : formatInitReport(report));
  return 0;
};

// src/loop/loop.ts
import { mkdirSync as mkdirSync10, writeFileSync as writeFileSync6 } from "node:fs";
import { join as join17 } from "node:path";
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
var cell = (text2) => text2.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
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
  const dir = join17(ensureJigDir(projectRoot).runs, "_loop", to.toISOString().slice(0, 10));
  mkdirSync10(dir, { recursive: true });
  const path = join17(dir, "candidates.md");
  writeFileSync6(path, formatCandidates(records, from, to, days));
  process.stdout.write(`${path}
`);
  return 0;
};

// src/pre-mr/pre-mr.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { copyFileSync, existsSync as existsSync8, mkdtempSync, rmSync as rmSync5 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join19, resolve as resolve9 } from "node:path";
import { parseArgs as parseArgs3 } from "node:util";

// src/review/review-plan.ts
import { existsSync as existsSync7, readFileSync as readFileSync20, readdirSync as readdirSync9 } from "node:fs";
import { join as join18 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";

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
  6: "reuse",
  7: "simplification",
  8: "efficiency",
  9: "altitude",
  10: "conventions",
  11: "docs",
  12: "bugs",
  13: "architecture",
  14: "security",
  15: "spec",
  16: "tests",
  17: "comments"
};
var isAngle = (value) => Object.hasOwn(ANGLE_TOKENS, value);
var ANGLES = Object.keys(ANGLE_TOKENS).map(Number).filter(isAngle);
var IMPORTANT_ANGLES = [1, 2, 3, 4, 5, 8, 10, 12, 13, 14, 15];
var TOKEN_ANGLES = {
  bugs: [1, 2, 3, 4, 5, 12],
  security: [14],
  reuse: [6],
  simplification: [7],
  efficiency: [8],
  altitude: [9],
  conventions: [10],
  smells: [10],
  docs: [11],
  adr: [13, 11],
  glossary: [13, 11],
  architecture: [13],
  spec: [15],
  tests: [16],
  comments: [17]
};
var SPECIAL_TOKENS = ["important", "deepening"];
var SELECTOR_TOKENS = [...SPECIAL_TOKENS, ...Object.keys(TOKEN_ANGLES), "auto"];
var PRESETS = { full: void 0, quick: "important" };
var DEFAULT_GRADES = {
  bugs: { tier: "deep", effort: "high" },
  efficiency: { tier: "standard", effort: "high" },
  security: { tier: "standard", effort: "high" },
  architecture: { tier: "deep", effort: "high" },
  spec: { tier: "deep", effort: "high" },
  reuse: { tier: "standard", effort: "high" },
  conventions: { tier: "standard", effort: "high" },
  docs: { tier: "standard", effort: "high" },
  altitude: { tier: "deep", effort: "high" },
  simplification: { tier: "standard", effort: "high" },
  tests: { tier: "standard", effort: "medium" },
  comments: { tier: "standard", effort: "medium" },
  verify: { tier: "deep", effort: "medium" },
  outcome: { tier: "deep", effort: "medium" },
  composer: { tier: "standard", effort: "medium" },
  deepening: { tier: "deep", effort: "high" }
};
var GRADE_KEYS = Object.keys(DEFAULT_GRADES);
var BUG_GROUPS = {
  1: [[1, 2, 3, 4, 5, 8, 12, 14]],
  2: [
    [1, 4, 8, 14],
    [2, 3, 5, 12]
  ],
  3: [[1, 4, 8, 14], [2, 3], [5, 12]],
  4: [[1, 4, 8], [14], [2, 3], [5, 12]]
};
var MAX_BUG_FINDERS = 4;
var CLEANUP = [7, 9];
var RULES = [6, 10, 11, 13, 15];
var MECHANICAL = [16, 17];
var CLEANUP_TOKENS = ["reuse", "simplification", "altitude", "conventions"];
var finderCount = (lines) => Math.min(MAX_FINDERS, Math.ceil(Math.max(0, lines) / LINES_PER_FINDER));
var ceilingOf = (angle, settings) => settings?.[angle]?.severityCeiling ?? (IMPORTANT_ANGLES.includes(angle) ? "Important" : "Nit");
var autoTokens = (shape, n) => {
  const tokens = ["important"];
  if (shape.tests) tokens.push("tests");
  if (shape.comments) tokens.push("comments");
  if (shape.docs) tokens.push("docs");
  if (shape.newSourceFiles > 0) tokens.push("architecture", "deepening");
  if (n === 1) tokens.push(...CLEANUP_TOKENS);
  return tokens;
};
var parseSelector = (input, shape, n) => {
  const given = input !== void 0 && input !== "";
  const source = given ? "argument" : n === 1 ? "small-diff" : "default";
  const raw = given ? input : n === 1 ? "quick" : "full";
  if (Object.hasOwn(PRESETS, raw)) {
    const expanded2 = PRESETS[raw];
    return { input: raw, tokens: expanded2 === void 0 ? [] : [expanded2], source };
  }
  const tokens = raw.split(",").map((token) => token.trim());
  const unknown = tokens.filter((token) => !SELECTOR_TOKENS.includes(token));
  if (unknown.length > 0) {
    throw new Error(`unknown selector token ${unknown.join(", ")}; expected full, quick or tokens of: ${SELECTOR_TOKENS.join(", ")}`);
  }
  const expanded = tokens.flatMap((token) => token === "auto" ? autoTokens(shape, n) : [token]);
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
  if (angle === 11 && !shape.docs) return "no Markdown in the diff";
  if (angle === 15 && !shape.spec) return "no spec found";
  if (angle === 16 && !shape.tests) return "no tests in the diff";
  if (angle === 17 && !shape.comments) return "no added comments";
  return void 0;
};
var gradeOf = (angle, grades) => grades[ANGLE_TOKENS[angle]] ?? DEFAULT_GRADES[ANGLE_TOKENS[angle]] ?? { tier: "standard", effort: "high" };
var roleGrade = (key, grades) => grades[key] ?? { tier: "deep", effort: "medium" };
var splitByGrade = (name, kind, angles, grades) => {
  const byGrade = /* @__PURE__ */ new Map();
  for (const angle of angles) {
    const grade = gradeOf(angle, grades);
    const key = `${grade.tier}-${grade.effort}`;
    const entry = byGrade.get(key) ?? { grade, angles: [] };
    entry.angles.push(angle);
    byGrade.set(key, entry);
  }
  const entries = [...byGrade.entries()];
  return entries.map(([key, { grade, angles: own }]) => ({
    name: entries.length === 1 ? name : `${name}-${key}`,
    kind,
    angles: own,
    ...grade
  }));
};
var layoutFinders = (n, angles, grades) => {
  const has = (angle) => angles.includes(angle);
  const groups = [];
  if (n >= 2) {
    const bugGroups = BUG_GROUPS[Math.min(n - 1, MAX_BUG_FINDERS)] ?? [];
    bugGroups.map((group) => group.filter(has)).filter((group) => group.length > 0).forEach((group, index) => groups.push({ name: `bugs-${index + 1}`, kind: "bugs", angles: group }));
    groups.push({ name: "cleanup", kind: "cleanup", angles: CLEANUP.filter(has) });
    groups.push({ name: "rules", kind: "rules", angles: RULES.filter(has) });
  } else {
    groups.push({ name: "rules", kind: "rules", angles: [11, 15].filter(has) });
  }
  groups.push({ name: "mechanical", kind: "mechanical", angles: MECHANICAL.filter(has) });
  return groups.filter((group) => group.angles.length > 0).flatMap((group) => splitByGrade(group.name, group.kind, group.angles, grades));
};
var planReview = (input) => {
  const n = finderCount(input.lines);
  const grades = { ...DEFAULT_GRADES, ...input.grades };
  const selection = parseSelector(input.selector, input.shape, n);
  const wanted = selectedAngles(selection.tokens, input.angles);
  const skipped = [];
  const angles = ANGLES.filter((angle) => {
    if (!wanted.has(angle)) return false;
    const reason = input.angles?.[angle]?.enabled === false ? "disabled in the project config" : inapplicable(angle, input.shape);
    if (reason !== void 0) skipped.push({ angle, reason });
    return reason === void 0;
  });
  const usedForCode = n === 0 ? angles.filter((angle) => angle === 11 || angle === 15 || angle === 16 || angle === 17) : angles;
  ANGLES.filter((angle) => angles.includes(angle) && !usedForCode.includes(angle)).forEach(
    (angle) => skipped.push({ angle, reason: "no counted code lines" })
  );
  const wantsDeepening = selection.tokens.length === 0 ? input.shape.newSourceFiles > 0 : selection.tokens.includes("deepening");
  const path = usedForCode.length === 0 ? "none" : n === 1 ? "inline" : "subagents";
  return {
    lines: input.lines,
    n,
    path,
    selection,
    outputTokens: selection.tokens.filter((token) => token !== "deepening"),
    angles: usedForCode,
    skipped: skipped.sort((left, right) => left.angle - right.angle),
    finders: path === "subagents" ? layoutFinders(n, usedForCode, grades) : [],
    deepening: wantsDeepening && n > 0 ? roleGrade("deepening", grades) : void 0,
    verify: roleGrade("verify", grades),
    outcome: roleGrade("outcome", grades),
    composer: roleGrade("composer", grades)
  };
};
var MODES = ["review", "pre-mr"];
var BUG_ANGLES = [1, 2, 3, 4, 5, 12, 14];
var gateFiles = (angles) => [
  ...angles.some((angle) => BUG_ANGLES.includes(angle)) ? ["gates/bugs.md"] : [],
  ...angles.some((angle) => !BUG_ANGLES.includes(angle)) ? ["gates/shape.md"] : [],
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
  if (plan.path === "inline") steps.push({ file: "steps/04-inline.md" }, ...gateFiles(plan.angles).map((file) => ({ file })));
  else steps.push({ file: "steps/04-finders.md" }, { file: "steps/05-verify.md" });
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
var PROJECT_CONFIG = "review.jsonc";
var isTestPath = createMatcher(["**/{test,tests,__tests__}/**"]);
var isFixturePath = createMatcher(["**/{fixture,fixtures,__fixtures__,__snapshots__}/**", "**/*.snap"]);
var isMarkdown = createMatcher(["**/*.md"]);
var isChangelog = createMatcher(["**/CHANGELOG.md"]);
var exclusionOf = (path) => {
  if (isMarkdown(path)) return "markdown";
  if (isTestFile(path) || isTestPath(path)) return "test";
  if (isFixturePath(path)) return "fixture";
  return void 0;
};
var parseNumstat = (output) => {
  const tokens = output.split("\0");
  const stats = [];
  for (let index = 0; index < tokens.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[index] ?? "");
    if (match === null) continue;
    let path = match[3] ?? "";
    if (path === "") {
      path = tokens[index + 2] ?? "";
      index += 2;
    }
    const count = (value) => value === void 0 || value === "-" ? 0 : Number(value);
    stats.push({ path, added: count(match[1]), deleted: count(match[2]) });
  }
  return stats;
};
var countLines = (stats) => {
  const excluded = { test: 0, fixture: 0, markdown: 0 };
  let lines = 0;
  let counted = 0;
  for (const stat of stats) {
    const exclusion = exclusionOf(stat.path);
    if (exclusion !== void 0) {
      excluded[exclusion]++;
      continue;
    }
    lines += stat.added + stat.deleted;
    counted++;
  }
  return { lines, counted, excluded };
};
var addedLines = (patch) => {
  const files = /* @__PURE__ */ new Map();
  let current;
  for (const line of patch.split("\n")) {
    const file = /^\+\+\+ (?:b\/)?(.*)$/.exec(line);
    if (file !== null) {
      const path = file[1] ?? "";
      current = path === "/dev/null" ? void 0 : /* @__PURE__ */ new Set();
      if (current !== void 0) files.set(path, current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null || current === void 0) continue;
    const start = Number(hunk[1]);
    const length = hunk[2] === void 0 ? 1 : Number(hunk[2]);
    for (let offset = 0; offset < length; offset++) current.add(start + offset);
  }
  return files;
};
var hasAddedComment = (file, source, added) => {
  const comments = lexComments(file, source) ?? [];
  return comments.some((comment) => {
    const last = comment.line + (comment.text.match(/\n/g)?.length ?? 0);
    for (let line = comment.line; line <= last; line++) {
      if (added.has(line)) return true;
    }
    return false;
  });
};
var PROJECT_KEYS = ["$schema", "iterationsMemory", "discover", "review", "severity", "route", "angles", "tiers", "maxParallel"];
var readAngles = (validator, value) => {
  const object = validator.object(value, "$.angles", void 0);
  if (object === void 0) return {};
  const angles = {};
  for (const [key, entry] of Object.entries(object)) {
    const path = childPath("$.angles", key);
    const angle = angleNumber(key);
    if (angle === void 0) {
      validator.report(path, "expected an angle number 1..17");
      continue;
    }
    const settings = validator.object(entry, path, ["enabled", "severityCeiling"]);
    if (settings === void 0) continue;
    const parsed = {};
    if (settings["enabled"] !== void 0) {
      if (typeof settings["enabled"] === "boolean") parsed.enabled = settings["enabled"];
      else validator.report(childPath(path, "enabled"), "expected a boolean");
    }
    if (settings["severityCeiling"] !== void 0) {
      const ceiling = validator.oneOf(settings["severityCeiling"], childPath(path, "severityCeiling"), CEILINGS);
      if (ceiling !== void 0) parsed.severityCeiling = ceiling;
    }
    angles[angle] = parsed;
  }
  return angles;
};
var readGrades = (validator, value) => {
  const object = validator.object(value, "$.tiers", GRADE_KEYS);
  if (object === void 0) return {};
  const grades = {};
  for (const [key, entry] of Object.entries(object)) {
    const path = childPath("$.tiers", key);
    const grade = validator.object(entry, path, ["tier", "effort"]);
    if (grade === void 0) continue;
    const tier = validator.string(grade["tier"], childPath(path, "tier"));
    const effort = validator.oneOf(grade["effort"], childPath(path, "effort"), EFFORTS2);
    if (tier !== void 0 && !isTier(tier)) validator.report(childPath(path, "tier"), "expected one of deep, standard, fast");
    if (tier !== void 0 && isTier(tier) && effort !== void 0) grades[key] = { tier, effort };
  }
  return grades;
};
var parseProjectConfig = (text2, label) => {
  const validator = new Validator();
  const root = validator.object(parseJsonc(text2), "$", PROJECT_KEYS);
  const angles = root?.["angles"] === void 0 ? {} : readAngles(validator, root["angles"]);
  const grades = root?.["tiers"] === void 0 ? {} : readGrades(validator, root["tiers"]);
  const maxParallel = root?.["maxParallel"] === void 0 ? MAX_PARALLEL : validator.integer(root["maxParallel"], "$.maxParallel", 1);
  if (validator.errors.length > 0) throw new Error(`${label}: ${validator.errors.join("; ")}`);
  return { angles, grades, maxParallel: maxParallel ?? MAX_PARALLEL };
};
var loadProjectConfig = (root) => {
  const path = join18(jigPaths(root).dir, PROJECT_CONFIG);
  if (!existsSync7(path)) return void 0;
  const label = `.jig/${PROJECT_CONFIG}`;
  return { label, config: parseProjectConfig(readFileSync20(path, "utf8"), label) };
};
var firstLine3 = (text2) => text2.split("\n")[0]?.trim() || void 0;
var gitLine = (args, root) => {
  const result = git(args, root);
  return result.ok ? firstLine3(result.stdout) : void 0;
};
var diffStats = (root, mergeBase) => {
  const result = git(["diff", "--numstat", "-M", "-z", mergeBase], root);
  if (!result.ok) throw new Error(`git diff --numstat failed: ${result.stderr.trim()}`);
  return parseNumstat(result.stdout);
};
var resolveBase = (root, given, command = "review-plan") => {
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
    last = { ref, mergeBase, source, stats: diffStats(root, mergeBase) };
    if (last.stats.length > 0) return last;
  }
  if (last !== void 0) return last;
  throw new Error(`no base: pass the merge request target, e.g. jig ${command} origin/main`);
};
var addedNewSourceFiles = (root, mergeBase) => {
  const result = git(["diff", "--name-only", "--diff-filter=A", "-M", "-z", mergeBase], root);
  if (!result.ok) return 0;
  return result.stdout.split("\0").filter((path) => path !== "" && exclusionOf(path) === void 0).length;
};
var anyAddedComment = (root, mergeBase, stats) => {
  const candidates = stats.filter((stat) => stat.added > 0 && lexComments(stat.path, "") !== void 0).map((stat) => stat.path);
  if (candidates.length === 0) return false;
  const result = git(["diff", "-U0", "-M", "--no-color", "--no-ext-diff", mergeBase, "--", ...candidates], root);
  if (!result.ok) return false;
  for (const [file, lines] of addedLines(result.stdout)) {
    const path = join18(root, file);
    if (lines.size > 0 && existsSync7(path) && hasAddedComment(file, readFileSync20(path, "utf8"), lines)) return true;
  }
  return false;
};
var untrackedCount = (root) => (gitStatus(root) ?? []).filter((entry) => entry.status === "??").length;
var INLINE_READER = "inline";
var angleAtoms = (text2) => {
  const header = /\*\*Atoms?:\*\*([^\n]*)/.exec(text2)?.[1] ?? "";
  return [...header.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "").filter((name) => name !== "");
};
var readsFor = (pluginRoot, angles) => {
  const angleDir = join18(pluginRoot, "skills", "jig-review", "angles");
  const atomDir = join18(pluginRoot, "atoms");
  const names = existsSync7(angleDir) ? readdirSync9(angleDir) : [];
  const files = angles.flatMap((angle) => names.filter((name) => name.startsWith(`${angle}.`) && name.endsWith(".md")).map((name) => join18(angleDir, name)));
  const atoms = [...new Set(files.flatMap((file) => angleAtoms(readFileSync20(file, "utf8"))))].map((name) => join18(atomDir, `${name}.md`)).filter((path) => existsSync7(path));
  return { angles: files.map(toSlash), atoms: atoms.map(toSlash) };
};
var angleList = (angles) => angles.join("+");
var gradeText = (grade, models) => {
  const model = models?.[grade.tier]?.[0];
  return `${grade.tier}/${grade.effort}${model === void 0 ? "" : ` ${model}`}`;
};
var SELECTOR_NOTES = {
  argument: "",
  default: " (default)",
  "small-diff": " (default for N = 1; --selector full for every angle)"
};
var stateText = (report) => {
  if (report.state) return "on (merge request known: state file, comment texts, re-review)";
  if (report.mode === "pre-mr") return "off (mode pre-mr: track progress in your todo list)";
  return "off (no merge request or --no-state: no state file, no comment texts, no posting)";
};
var readLines = (reads) => reads === void 0 ? [] : [`  read: ${reads.angles.join(" ")}`, ...reads.atoms.length > 0 ? [`  atoms: ${reads.atoms.join(" ")}`] : []];
var formatReport = (report) => {
  const { plan, models } = report;
  const excluded = Object.entries(report.files.excluded).filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`);
  const lines = [
    `base: ${report.base.ref} (merge base ${report.base.mergeBase.slice(0, 8)}, from ${report.base.source})`,
    `lines: ${plan.lines} in ${report.files.counted} files${excluded.length > 0 ? `; excluded: ${excluded.join(", ")}` : ""}${report.files.untracked > 0 ? `; untracked files not counted: ${report.files.untracked} (git add -N to count them)` : ""}`,
    `finders: ${report.formula}`,
    `shape: tests ${report.shape.tests ? "yes" : "no"} \xB7 added comments ${report.shape.comments ? "yes" : "no"} \xB7 markdown ${report.shape.docs ? "yes" : "no"} \xB7 new source files ${report.shape.newSourceFiles} \xB7 spec ${report.shape.spec ? "yes" : "no"}`,
    `selector: ${plan.selection.input}${plan.selection.tokens.length > 0 && plan.selection.input !== plan.selection.tokens.join(",") ? ` \u2192 ${plan.selection.tokens.join(",")}` : ""}${SELECTOR_NOTES[plan.selection.source]}`,
    `config: ${report.config ?? "default"} \xB7 agent: ${report.agent} \xB7 max parallel subagents: ${report.maxParallel}`,
    `mode: ${report.mode} \xB7 state: ${stateText(report)}`,
    ""
  ];
  if (plan.path === "none") lines.push("finders: none (nothing to review)");
  if (plan.path === "inline") {
    lines.push(`path: inline: review in this session, angles ${angleList(plan.angles)}; no finder subagents; no judge subagents unless an Important candidate survives your own gates`);
    lines.push(...readLines(report.reads[INLINE_READER]));
  }
  for (const finder of plan.finders) {
    lines.push(`finder ${finder.name}: angles ${angleList(finder.angles)} \xB7 ${gradeText(finder, models)}`);
    lines.push(...readLines(report.reads[finder.name]));
  }
  if (plan.deepening !== void 0) lines.push(`deepening: ${gradeText(plan.deepening, models)}`);
  if (plan.path === "inline") {
    lines.push(`judge for Important candidates: one subagent, ${plan.verify.tier}/${plan.verify.effort}`);
    for (const judge of report.judge) {
      lines.push(`  your model ${judge.finderModel} \u2192 judge ${judge.judgeModel}${judge.same ? " (same model: one model in the tier)" : ""}`);
    }
  } else {
    lines.push(`verify: ${plan.verify.tier}/${plan.verify.effort}`);
    for (const judge of report.judge) {
      lines.push(`  candidates from ${judge.finderModel} \u2192 judge ${judge.judgeModel}${judge.same ? " (same model: one model in the tier)" : ""}`);
    }
  }
  if (report.judge.length === 0) lines.push(`  judge: a ${plan.verify.tier} model other than the finder's`);
  lines.push(`outcome check: ${gradeText(plan.outcome, models)} \xB7 composer: ${gradeText(plan.composer, models)}`);
  if (plan.skipped.length > 0) {
    lines.push(`skipped angles: ${plan.skipped.map((skip) => `${skip.angle} (${skip.reason})`).join(", ")}`);
  }
  lines.push(`output filter: ${plan.outputTokens.length > 0 ? plan.outputTokens.join(",") : "all findings"}`);
  lines.push("", "steps for this run (read each when you reach it; no other step file applies):");
  lines.push(...report.steps.map((step) => `  ${report.skill}/${step.file}${step.when === void 0 ? "" : ` \xB7 ${step.when}`}`));
  return lines.join("\n");
};
var buildReport = (root, options) => {
  const base = resolveBase(root, options.base);
  const { lines, counted, excluded } = countLines(base.stats);
  const changed = base.stats.filter((stat) => stat.added > 0);
  const shape = {
    tests: changed.some((stat) => exclusionOf(stat.path) === "test"),
    comments: anyAddedComment(root, base.mergeBase, base.stats),
    docs: changed.some((stat) => exclusionOf(stat.path) === "markdown" && !isChangelog(stat.path)),
    newSourceFiles: addedNewSourceFiles(root, base.mergeBase),
    spec: options.spec
  };
  const project = loadProjectConfig(root);
  const plan = planReview({
    lines,
    shape,
    selector: options.selector,
    angles: project?.config.angles ?? {},
    grades: project?.config.grades ?? {}
  });
  const loaded = loadUserConfig();
  if (loaded.error !== void 0) throw new Error(`${loaded.label}: ${loaded.error}`);
  const agent = detectAgent(options.agent);
  const models = resolveTiers(agent, loaded.config);
  const finderModels = Object.fromEntries(plan.finders.map((finder) => [finder.name, models?.[finder.tier]?.[0]]));
  const verifyModels = models?.[plan.verify.tier] ?? [];
  const usedModels = plan.path === "inline" ? verifyModels : Object.values(finderModels).filter((model) => model !== void 0);
  const mode = options.mode ?? "review";
  const state = mode === "review" && options.mergeRequest === true && options.noState !== true;
  const pluginRoot = options.pluginRoot ?? resolvePluginRoot();
  const readers = plan.path === "inline" ? [[INLINE_READER, plan.angles]] : plan.finders.map((finder) => [finder.name, finder.angles]);
  return {
    base: { ref: base.ref, mergeBase: base.mergeBase, source: base.source },
    files: { counted, excluded, untracked: untrackedCount(root) },
    formula: `ceil(${lines}/${LINES_PER_FINDER}) = ${Math.ceil(lines / LINES_PER_FINDER)}, max ${MAX_FINDERS} \u2192 N = ${plan.n}`,
    shape,
    plan,
    mode,
    state,
    skill: toSlash(join18(pluginRoot, "skills", "jig-review")),
    steps: stepsFor(plan, mode, state),
    reads: Object.fromEntries(readers.map(([name, angles]) => [name, readsFor(pluginRoot, angles)])),
    maxParallel: project?.config.maxParallel ?? MAX_PARALLEL,
    config: project?.label ?? null,
    agent,
    models,
    finderModels,
    judge: judgeModels(usedModels, verifyModels)
  };
};
var isMode = (value) => MODES.includes(value);
var USAGE2 = "usage: jig review-plan [<base>] [--selector full|quick|auto|<tokens>] [--spec] [--mode review|pre-mr] [--mr] [--no-state] [--agent <id>] [--json]";
var runReviewPlan = (args) => {
  const { values, positionals } = parseArgs2({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      selector: { type: "string" },
      spec: { type: "boolean" },
      agent: { type: "string" },
      mode: { type: "string" },
      mr: { type: "boolean" },
      "no-state": { type: "boolean" },
      json: { type: "boolean" }
    }
  });
  if (positionals.length > 1) throw new Error(USAGE2);
  const mode = values.mode ?? "review";
  if (!isMode(mode)) throw new Error(`unknown mode ${mode}; ${USAGE2}`);
  const root = gitToplevel(process.cwd());
  if (root === void 0) throw new Error("not inside a git repository");
  const report = buildReport(root, {
    base: positionals[0],
    selector: values.selector,
    spec: values.spec === true,
    agent: values.agent,
    mode,
    mergeRequest: values.mr === true,
    noState: values["no-state"] === true
  });
  process.stdout.write(`${values.json ? JSON.stringify(report) : formatReport(report)}
`);
  return 0;
};

// src/worktree/list.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { resolve as resolve8 } from "node:path";
var parseWorktreeList = (porcelain) => {
  const worktrees = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (pathLine === void 0) continue;
    const branchLine = lines.find((line) => line.startsWith("branch "));
    const hasFlag = (flag) => lines.some((line) => line === flag || line.startsWith(`${flag} `));
    const worktree = {
      path: resolve8(pathLine.slice("worktree ".length)),
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
var canonical = (path) => {
  try {
    return realpathSync2.native(path);
  } catch {
    return path;
  }
};
var samePath = (left, right, platform = process.platform) => {
  const normalize2 = (path) => {
    const slashed = canonical(path).replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? slashed.toLowerCase() : slashed;
  };
  return normalize2(left) === normalize2(right);
};

// src/pre-mr/pre-mr.ts
var VERIFY_LEVELS = ["unit-test", "type-check", "none"];
var EXIT_MISSING = 1;
var EXIT_USAGE4 = 2;
var CLI_SESSION = "cli";
var MAX_BUFFER2 = 64 * 1024 * 1024;
var PRE_MR_USAGE = 'usage: jig pre-mr [<base>] | jig pre-mr proof "<command>" | jig pre-mr bug-bash "<result>"';
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
  const dir = mkdtempSync(join19(tmpdir(), "jig-pre-mr-"));
  try {
    const index = join19(dir, "index");
    const current = gitLine2(["rev-parse", "--git-path", "index"], root);
    if (current !== void 0 && existsSync8(resolve9(root, current))) copyFileSync(resolve9(root, current), index);
    const withIndex = (args) => spawnSync2("git", args, { cwd: root, env: { ...process.env, GIT_INDEX_FILE: index }, encoding: "utf8", windowsHide: true, maxBuffer: MAX_BUFFER2 });
    const added = withIndex(["add", "-A"]);
    if (added.status !== 0) throw new Error(`git add -A into a temporary index failed: ${String(added.stderr).trim()}`);
    const tree = withIndex(["write-tree"]);
    const sha = String(tree.stdout).trim();
    if (tree.status !== 0 || sha === "") throw new Error(`git write-tree failed: ${String(tree.stderr).trim()}`);
    return sha;
  } finally {
    rmSync5(dir, { recursive: true, force: true });
  }
};
var snapshot = (root) => {
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
var requirements = (files, checks = PROOFS2) => PROOF_KINDS.map((kind) => ({ kind, files: files.filter((file) => checks.some((check2) => check2.requires(file).includes(kind))) })).filter(
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
  for (const path of [root, ...paths]) {
    const key = resolve9(path).replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(...readJournal(path).filter((entry) => entry.kind === "proof" || entry.kind === "bug-bash" || entry.kind === "skip-verify"));
  }
  return records.sort((left, right) => right.ts.localeCompare(left.ts));
};
var changedPaths = (root, older, newer) => {
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
  const needed = requirements(files, checks);
  if (needed.length === 0) {
    const ui = requirements(files).flatMap((requirement) => requirement.files);
    return ui.length === 0 ? { type: "no-ui" } : { type: "no-proof-tool", files: [...new Set(ui)] };
  }
  const diffs = /* @__PURE__ */ new Map();
  const editedSince = (entry) => {
    const from = entry.tree ?? "";
    if (!diffs.has(from)) diffs.set(from, from === "" ? void 0 : changedPaths(root, from, tree));
    return diffs.get(from);
  };
  const covers2 = (entry, paths) => {
    const edited = editedSince(entry);
    return edited !== void 0 && paths.every((path) => !edited.has(path));
  };
  const gaps = [];
  const proofs = [];
  for (const { kind, files: kindFiles } of needed) {
    const candidates = records.filter((entry) => entry.kind === "proof" && (entry.rule ?? "").split(",").includes(kind));
    const proof2 = candidates.find((entry) => covers2(entry, kindFiles));
    if (proof2 !== void 0) {
      proofs.push(proof2);
      continue;
    }
    const latest = candidates[0];
    gaps.push({ what: "proof", kind, files: kindFiles, hint: hintFor(kind), ...latest === void 0 ? {} : { latest } });
  }
  const commits = branchCommits(root, mergeBase, head);
  const bugBash2 = records.find((entry) => entry.kind === "bug-bash" && entry.head !== void 0 && commits.has(entry.head));
  if (bugBash2 === void 0) gaps.push({ what: "bug-bash" });
  if (gaps.length === 0 && bugBash2 !== void 0) return { type: "proven", proofs, bugBash: bugBash2 };
  const skip = records.find((entry) => entry.kind === "skip-verify" && entry.tree !== void 0 && editedSince(entry)?.size === 0);
  if (skip === void 0) return { type: "missing", gaps };
  return { type: "skipped", skip, gaps, ...bugBash2 === void 0 ? {} : { bugBash: bugBash2 } };
};
var untrackedPaths = (root) => (gitStatus(root) ?? []).filter((entry) => entry.status === "??").map((entry) => entry.path);
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
var formatVerdict = (verdict, baseLine) => {
  switch (verdict.type) {
    case "no-ui":
      return [baseLine, "UI files: none", "Bug-bash: UI not touched", "Verification level: full"];
    case "no-proof-tool":
      return [
        baseLine,
        `UI files: ${fileList(verdict.files)}; no UI proof tool in .jig/config.jsonc, UI not proven`,
        "Bug-bash: not run, no UI proof tool configured",
        "Verification level: no UI proof tool configured"
      ];
    case "proven":
      return [
        baseLine,
        ...[...new Set(verdict.proofs)].map((proof2) => `proof: \`${proof2.message ?? ""}\` at ${proof2.ts}`),
        `Bug-bash: ${verdict.bugBash.message ?? ""}`,
        "Verification level: full"
      ];
    case "skipped":
      return [
        baseLine,
        `not proven: ${verdict.gaps.map((gap) => gap.what === "proof" ? gap.kind : gap.what).join(", ")}`,
        `Bug-bash: ${verdict.bugBash?.message ?? "not run, verification skipped"}`,
        levelLine(verdict.skip)
      ];
    case "missing":
      return [
        baseLine,
        "pre-mr: the branch touches UI files and lacks:",
        ...verdict.gaps.map(describeGap),
        `The proof cannot run here: jig skip-verify --level ${VERIFY_LEVELS.join("|")} --why "<reason>"`
      ];
  }
};
var check = (args, ctx) => {
  const { positionals } = parseArgs3({ args, allowPositionals: true, strict: true, options: {} });
  if (positionals.length > 1) throw new UsageError(PRE_MR_USAGE);
  const root = requireRoot(ctx.cwd);
  const base = resolveBase(root, positionals[0], "pre-mr");
  const files = [.../* @__PURE__ */ new Set([...base.stats.map((stat) => stat.path), ...untrackedPaths(root)])];
  const { head, tree } = snapshot(root);
  const verdict = evaluate({ root, mergeBase: base.mergeBase, head, tree, files, records: recordsOf(root), checks: configuredChecks(root) });
  const baseLine = `base: ${base.ref} (merge base ${base.mergeBase.slice(0, 8)}, from ${base.source})`;
  const lines = formatVerdict(verdict, baseLine);
  if (verdict.type === "missing") {
    ctx.io.err(`${lines.join("\n")}
`);
    return EXIT_MISSING;
  }
  ctx.io.out(`${lines.join("\n")}
`);
  return 0;
};
var textArgument = (args, usage2) => {
  const parts = args[0] === "--" ? args.slice(1) : args;
  const text2 = parts.join(" ").trim();
  if (text2 === "" || args[0] !== "--" && text2.startsWith("-")) throw new UsageError(usage2);
  return text2;
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
  const state = snapshot(root);
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
  const entry = record(root, { kind: "bug-bash", message: result, ...snapshot(root) });
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
  const entry = record(root, { kind: "skip-verify", rule: values.level, message: why, ...snapshot(root) });
  mirror(root, `skip-verify:${values.level}`, { why });
  ctx.io.out(`${levelLine(entry)}
jig pre-mr passes with this level until the next edit
`);
  return 0;
}, ctx.io);
var shellExec = (command, cwd) => {
  const result = spawnSync2(command, { cwd, shell: true, stdio: "inherit", windowsHide: true });
  if (result.error !== void 0) {
    process.stderr.write(`jig: ${result.error.message}
`);
    return 1;
  }
  return result.status ?? 1;
};
var processIo = {
  out: (text2) => process.stdout.write(text2),
  err: (text2) => process.stderr.write(text2)
};
var runPreMr = (args) => preMr(args, { cwd: process.cwd(), io: processIo, exec: shellExec });
var runSkipVerify = (args) => skipVerify(args, { cwd: process.cwd(), io: processIo });

// src/slot/slot.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { existsSync as existsSync9, mkdirSync as mkdirSync12, readFileSync as readFileSync21, rmSync as rmSync6, writeFileSync as writeFileSync7 } from "node:fs";
import { basename as basename4, dirname as dirname9, isAbsolute as isAbsolute4, join as join20, relative as relative5, resolve as resolve10 } from "node:path";
import { parseArgs as parseArgs4 } from "node:util";

// src/worktree/lockfiles.ts
import { posix as posix2 } from "node:path";
var installSteps = (changed, install, lockfiles = LOCKFILES) => {
  const byName = new Map(lockfiles.map((lockfile) => [lockfile.file, lockfile.install]));
  const detected = changed.flatMap((raw) => {
    const path = raw.replace(/\\/g, "/");
    const command = byName.get(posix2.basename(path));
    return command === void 0 ? [] : [{ dir: posix2.dirname(path), command }];
  });
  if (detected.length === 0) return [];
  if (install !== void 0) return [{ dir: ".", command: install }];
  return [...new Map(detected.map((step) => [`${step.dir}\0${step.command}`, step])).values()];
};

// src/worktree/seed.ts
import { copyFileSync as copyFileSync2, lstatSync, mkdirSync as mkdirSync11, readdirSync as readdirSync10, readlinkSync, realpathSync as realpathSync3, statSync as statSync9, symlinkSync } from "node:fs";
import nodePath from "node:path";
var exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};
var canonicalOrRaw = (path) => {
  try {
    return realpathSync3.native(path);
  } catch {
    return path;
  }
};
var relativeInside = (api, root, path) => {
  const rel = api.relative(root, path);
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
  return (path) => {
    const parts = path.replace(/\\/g, "/").replace(/\/$/, "").split("/");
    return parts.some((_part, index) => matches(parts.slice(0, index + 1).join("/")));
  };
};
var symlinkType = (source) => {
  try {
    return statSync9(source).isDirectory() ? "dir" : "file";
  } catch {
    return "file";
  }
};
var isPermissionError = (error) => error instanceof Error && "code" in error && error.code === "EPERM";
var createLink = (source, target, destination) => {
  const type = symlinkType(source);
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
  const path = rel.replace(/\\/g, "/");
  if (exists(destination)) return { action: "kept", path };
  try {
    const stats = lstatSync(source);
    if (!stats.isSymbolicLink() && !stats.isFile()) return { action: "skipped", path, detail: "not a file" };
    mkdirSync11(nodePath.dirname(destination), { recursive: true });
    if (stats.isFile()) {
      copyFileSync2(source, destination);
      return { action: "copied", path };
    }
    const target = linkTarget(readlinkSync(source), nodePath.dirname(source), main, worktree);
    createLink(source, target, destination);
    return { action: "linked", path, detail: target.replace(/\\/g, "/") };
  } catch (error) {
    return { action: "failed", path, detail: error instanceof Error ? error.message : String(error) };
  }
};
var linksInside = (main, dir) => {
  try {
    return readdirSync10(nodePath.join(main, dir), { withFileTypes: true }).filter((entry) => entry.isSymbolicLink()).map((entry) => `${dir}${entry.name}`);
  } catch {
    return [];
  }
};
var copyFileItem = (main, worktree, file, ignoredDirs, files) => {
  const path = nodePath.posix.normalize(file.replace(/\\/g, "/"));
  if (nodePath.isAbsolute(file) || path === ".." || path.startsWith("../")) {
    return { action: "failed", path, detail: "copyFiles path leaves the repository" };
  }
  if (files.has(path)) return { action: "skipped", path, detail: "seeded anyway, drop it from copyFiles" };
  if (!ignoredDirs.some((dir) => path.startsWith(dir))) {
    return { action: "skipped", path, detail: "copyFiles takes only files inside an ignored folder" };
  }
  return place(main, worktree, path);
};
var seedWorktree = (main, worktree, options = {}) => {
  const isExcluded = excluder(options.seedExclude ?? []);
  const entries = ignoredEntries(main);
  const ignoredDirs = entries.filter((entry) => entry.endsWith("/"));
  const files = entries.filter((entry) => !entry.endsWith("/"));
  const candidates = [...files, ...ignoredDirs.filter((dir) => !isExcluded(dir)).flatMap((dir) => linksInside(main, dir))];
  const items = candidates.map((rel) => isExcluded(rel) ? { action: "excluded", path: rel } : place(main, worktree, rel));
  const fileSet = new Set(files);
  for (const file of options.copyFiles ?? []) {
    items.push(copyFileItem(main, worktree, file, ignoredDirs, fileSet));
  }
  return items;
};
var formatSeed = (items) => {
  const lines = items.filter((item) => item.action !== "kept" && item.action !== "excluded").map((item) => `${item.action} ${item.path}${item.detail === void 0 ? "" : ` (${item.detail})`}`);
  const count = (action) => items.filter((item) => item.action === action).length;
  lines.push(
    `seed: ${count("copied")} copied, ${count("linked")} linked, ${count("kept")} kept, ${count("excluded")} excluded, ${count("failed")} failed`
  );
  return lines;
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
var print = (text2) => {
  process.stdout.write(`${text2}
`);
};
var escapeRegExp = (text2) => text2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var slotNumber = (dirName, repo) => {
  const match = new RegExp(`^${escapeRegExp(repo)}-s(\\d+)(?:-|$)`).exec(dirName);
  if (match?.[1] === void 0) return void 0;
  const slot = Number(match[1]);
  return slot >= 1 ? slot : void 0;
};
var slotWorktrees = (worktrees, repo) => worktrees.flatMap((worktree) => {
  const slot = slotNumber(basename4(worktree.path), repo);
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
var setEnvValue = (text2, key, value) => {
  const eol = text2.includes("\r\n") ? "\r\n" : "\n";
  const line = new RegExp(`^([ \\t]*(?:export[ \\t]+)?)${escapeRegExp(key)}[ \\t]*=.*$`, "gm");
  if (line.test(text2)) return text2.replace(line, (_match, prefix) => `${prefix}${key}=${value}`);
  const separator = text2 === "" || text2.endsWith("\n") ? "" : eol;
  return `${text2}${separator}${key}=${value}${eol}`;
};
var agentViewConfig = (base, config, cdpPort) => {
  const result = { ...base, port: cdpPort };
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
  const context = { projectRoot, mainRoot, repo: basename4(mainRoot) };
  if (config.slots !== void 0) {
    context.slots = config.slots;
  }
  if (config.worktree !== void 0) {
    context.worktree = config.worktree;
  }
  return context;
};
var formatDuplicates = (duplicates) => [...duplicates].map(([slot, group]) => `s${slot}: ${group.map((worktree) => toSlash(worktree.path)).join(", ")}`).join("; ");
var isTracked = (dir, file) => git(["ls-files", "--error-unmatch", "--", file], dir).ok;
var writeLocalFile = (dir, file, content) => {
  const path = join20(dir, file);
  mkdirSync12(dirname9(path), { recursive: true });
  writeFileSync7(path, content);
  if (isTracked(dir, file)) {
    git(["update-index", "--skip-worktree", "--", file], dir);
  }
};
var insideDir = (dir, file) => {
  const path = resolve10(dir, file);
  const rel = relative5(dir, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute4(rel)) throw new Error(`path ${file} leaves the slot dir`);
  return path;
};
var writePorts = (dir, slots, slot) => {
  for (const [key, port] of Object.entries(slots.ports ?? {})) {
    const path = insideDir(dir, port.target);
    const text2 = existsSync9(path) ? readFileSync21(path, "utf8") : "";
    writeLocalFile(dir, port.target, setEnvValue(text2, key, String(port.base + slot * port.step)));
  }
};
var readJsonObject = (path) => {
  if (!existsSync9(path)) return {};
  const value = parseJsonc(readFileSync21(path, "utf8"));
  const isObject4 = typeof value === "object" && value !== null && !Array.isArray(value);
  return isObject4 ? value : {};
};
var writeAgentView = (mainRoot, dir, slots, cdpPort) => {
  const own = join20(dir, AGENT_VIEW_CONFIG2);
  const base = readJsonObject(existsSync9(own) ? own : join20(mainRoot, AGENT_VIEW_CONFIG2));
  writeLocalFile(dir, AGENT_VIEW_CONFIG2, `${JSON.stringify(agentViewConfig(base, slots, cdpPort), null, 2)}
`);
};
var branchExists = (cwd, branch) => git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd).ok;
var worktreeAddArgs = (cwd, dir, branch) => {
  if (branch === void 0) return ["worktree", "add", "--detach", dir];
  return branchExists(cwd, branch) ? ["worktree", "add", dir, branch] : ["worktree", "add", dir, "-b", branch];
};
var reserveSlot = async (context, slots, options) => {
  const lock = await acquireLock(join20(ensureJigDir(context.mainRoot).cache, SLOT_LOCK));
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
    const dir = resolve10(context.mainRoot, slots.worktreesDir, slotDirName(context.repo, slot, options.slug));
    const added = git(worktreeAddArgs(context.projectRoot, dir, options.branch), context.projectRoot);
    if (!added.ok) return fail3(`git worktree add failed: ${added.stderr.trim()}`, 2);
    return { slot, dir };
  } finally {
    lock.release();
  }
};
var runInstall = (install, dir) => spawnSync3(install, { cwd: dir, shell: true, windowsHide: true, stdio: ["ignore", 2, 2] }).status;
var slotNew = async (args) => {
  const { values } = parseArgs4({ args, options: { slug: { type: "string" }, branch: { type: "string" } }, strict: true });
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
  const { slot, dir } = reserved;
  for (const line of formatSeed(seedWorktree(context.mainRoot, dir, context.worktree))) {
    process.stderr.write(`jig: ${line}
`);
  }
  writePorts(dir, slots, slot);
  const cdpPort = slotCdpPort(slots, slot);
  if (cdpPort !== void 0) {
    writeAgentView(context.mainRoot, dir, slots, cdpPort);
  }
  for (const cache of slots.clearCache ?? []) {
    rmSync6(insideDir(dir, cache), { recursive: true, force: true });
  }
  if (slots.install !== void 0) {
    const status = runInstall(slots.install, dir);
    if (status !== 0) return fail3(`install failed (exit ${status}) in slot ${slot} ${toSlash(dir)}`, 1);
  }
  print(`slot ${slot} ${toSlash(dir)} ports ${formatPorts(slotPorts(slots, slot))} cdp ${cdpPort ?? NO_VALUE}`);
  return 0;
};
var slotLs = (args) => {
  const { values } = parseArgs4({ args, options: { json: { type: "boolean" } }, strict: true });
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
var parseSlotNumber = (text2) => {
  const slot = Number(text2?.replace(/^s/, ""));
  return Number.isInteger(slot) && slot >= 1 ? slot : void 0;
};
var findSlot = (context, slot) => {
  const matches = slotWorktrees(listWorktrees(context.projectRoot), context.repo).filter((worktree2) => worktree2.slot === slot);
  const [worktree] = matches;
  if (worktree === void 0) return `no slot ${slot}`;
  if (matches.length > 1) return `duplicate slot numbers: ${formatDuplicates(/* @__PURE__ */ new Map([[slot, matches]]))}`;
  return worktree;
};
var trackedChanges = (dir) => git(["status", "--porcelain=v1", "--untracked-files=no"], dir).stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3));
var slotRm = (args) => {
  const { values, positionals } = parseArgs4({
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
  const removed = git(["worktree", "remove", "--force", worktree.path], context.projectRoot);
  if (!removed.ok) return fail3(`git worktree remove failed: ${removed.stderr.trim()}`, 1);
  print(`removed ${toSlash(worktree.path)}`);
  return 0;
};
var headOf = (dir) => {
  const result = git(["rev-parse", "HEAD"], dir);
  return result.ok ? result.stdout.trim() : void 0;
};
var changedFiles2 = (dir, from, to) => from === to ? [] : git(["diff", "--name-only", "-z", from, to], dir).stdout.split("\0").filter(Boolean);
var slotShow = (args) => {
  const { positionals } = parseArgs4({ args, options: {}, allowPositionals: true, strict: true });
  const [slotText, ref] = positionals;
  const slot = parseSlotNumber(slotText);
  if (positionals.length !== 2 || slot === void 0 || ref === void 0) return fail3("usage: slot show <N> <branch|commit>", 2);
  const context = loadContext();
  const worktree = findSlot(context, slot);
  if (typeof worktree === "string") return fail3(worktree, 1);
  const changes = trackedChanges(worktree.path);
  if (changes.length > 0) {
    return fail3(`slot ${slot} has tracked changes; a slot only shows branches, edits belong in a feature worktree: ${changes.join(", ")}`, 1);
  }
  const before = headOf(worktree.path);
  const checkout = git(["checkout", "--detach", ref], worktree.path);
  if (!checkout.ok) return fail3(`git checkout --detach ${ref} failed in slot ${slot}: ${checkout.stderr.trim()}`, 1);
  const after = headOf(worktree.path);
  const changed = before === void 0 || after === void 0 ? [] : changedFiles2(worktree.path, before, after);
  for (const step of installSteps(changed, context.slots?.install)) {
    process.stderr.write(`jig: lock file changed, running ${step.command} in ${step.dir}
`);
    const status = runInstall(step.command, resolve10(worktree.path, step.dir));
    if (status !== 0) return fail3(`install failed (exit ${status}) in slot ${slot} ${toSlash(worktree.path)}`, 1);
  }
  print(`slot ${slot} ${toSlash(worktree.path)} at ${(after ?? "").slice(0, 12)} ${ref}`);
  return 0;
};
var subcommands = /* @__PURE__ */ new Map([
  ["new", slotNew],
  ["show", slotShow],
  ["ls", slotLs],
  ["rm", slotRm]
]);
var runSlot = (args) => {
  const [name, ...rest] = args;
  const subcommand = name === void 0 ? void 0 : subcommands.get(name);
  if (subcommand === void 0) return fail3(`usage: slot <${[...subcommands.keys()].join("|")}>`, 2);
  return subcommand(rest);
};

// src/worktree/worktree.ts
import { existsSync as existsSync10 } from "node:fs";
import { basename as basename6, resolve as resolve12 } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs as parseArgs5 } from "node:util";

// src/worktree/sweep.ts
import { spawnSync as spawnSync4 } from "node:child_process";
import { basename as basename5, resolve as resolve11 } from "node:path";
var KEPT_BUCKETS = /* @__PURE__ */ new Set(["hold-current", "hold-locked", "hold-wip"]);
var RECENT_MS = 24 * 60 * 60 * 1e3;
var MS_PER_SECOND = 1e3;
var SLOT_ITEM = /^s?(\d+)$/;
var runJson = (bin, args, cwd) => {
  const result = spawnSync4(bin, args, { cwd, encoding: "utf8", windowsHide: true });
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
  const isGithub = remote.includes("github.com");
  const tool = isGithub ? findInPath("gh") : findInPath("glab");
  if (tool === void 0) return /* @__PURE__ */ new Set();
  const branches = isGithub ? branchNames(runJson(tool, ["pr", "list", "--state", "open", "--limit", "200", "--json", "headRefName"], cwd), "headRefName") : branchNames(runJson(tool, ["mr", "list", "--per-page", "100", "--output", "json"], cwd), "source_branch");
  return new Set(branches);
};
var isRecent = (path, now) => {
  const result = git(["log", "-1", "--format=%ct"], path);
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
  slot: slotNumber(basename5(worktree.path), scope.repo) ?? null,
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
      (candidate) => slot === void 0 ? samePath(candidate.path, resolve11(cwd, item)) : candidate.slot === Number(slot)
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
  const result = row.bucket === "prunable" ? git(["worktree", "prune"], mainRoot) : git(["worktree", "remove", "--force", row.path], mainRoot);
  return result.ok ? void 0 : result.stderr.trim();
};
var formatRow2 = (row) => `${row.bucket}  ${row.path}  ${row.branch ?? "(detached)"}${row.slot === null ? "" : `  slot ${row.slot}`}`;

// src/worktree/worktree.ts
var fail4 = (message, code) => {
  process.stderr.write(`jig: ${message}
`);
  return code;
};
var print2 = (text2) => {
  process.stdout.write(`${text2}
`);
};
var mainCheckout = (cwd) => {
  const main = listWorktrees(cwd)[0]?.path;
  if (main === void 0) throw new Error(`no git worktrees found from ${toSlash(cwd)}`);
  return main;
};
var worktreeSeed = (args) => {
  const { positionals } = parseArgs5({ args, options: {}, allowPositionals: true, strict: true });
  const [target] = positionals;
  if (positionals.length !== 1 || target === void 0) return fail4("usage: worktree seed <dir>", 2);
  const dir = resolve12(target);
  if (!existsSync10(dir)) return fail4(`no such dir ${toSlash(dir)}`, 1);
  const toplevel = gitToplevel(dir);
  if (toplevel === void 0 || !samePath(toplevel, dir)) return fail4(`${toSlash(dir)} is not the root of a git worktree`, 1);
  const main = mainCheckout(dir);
  if (samePath(main, dir)) return fail4(`${toSlash(dir)} is the main checkout, seed fills another worktree from it`, 1);
  const config = loadConfig(main);
  if (config.error !== void 0) return fail4(`.jig/config.jsonc: ${config.error}`, 1);
  const items = seedWorktree(main, dir, config.worktree);
  for (const line of formatSeed(items)) {
    print2(line);
  }
  return items.some((item) => item.action === "failed") ? 1 : 0;
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
  const { values } = parseArgs5({
    args,
    options: { json: { type: "boolean" }, ask: { type: "boolean" }, yes: { type: "string", multiple: true } },
    strict: true
  });
  const projectRoot = resolveProjectRoot(process.cwd());
  const worktrees = listWorktrees(projectRoot);
  const mainRoot = worktrees[0]?.path ?? projectRoot;
  const rows = auditWorktrees(worktrees, {
    mainRoot,
    repo: basename6(mainRoot),
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
var subcommands2 = /* @__PURE__ */ new Map([
  ["seed", worktreeSeed],
  ["sweep", (args) => worktreeSweep(args)]
]);
var runWorktree = (args) => {
  const [name, ...rest] = args;
  const subcommand = name === void 0 ? void 0 : subcommands2.get(name);
  if (subcommand === void 0) return fail4(`usage: worktree <${[...subcommands2.keys()].join("|")}>`, 2);
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
  ["check", runCheck],
  ["build", runBuild],
  ["atom", runAtom],
  ["slot", runSlot],
  ["worktree", runWorktree],
  ["task-status", runTaskStatus],
  ["loop", runLoop],
  ["init", runInit],
  ["doctor", runDoctor],
  ["tiers", runTiers],
  ["review-plan", runReviewPlan],
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

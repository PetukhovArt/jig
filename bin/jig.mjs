#!/usr/bin/env node

// package.json
var version = "0.1.0";

// src/atoms/atoms.ts
import { readdirSync as readdirSync3, readFileSync as readFileSync5 } from "node:fs";
import { basename as basename2, join as join4 } from "node:path";

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
var DOUBLE_QUOTE_ESCAPES = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "	", r: "\r", "0": "\0" };
var fail = (cursor, message) => {
  throw new FrontmatterError(message, cursor.line);
};
var readDoubleQuoted = (cursor) => {
  const { text } = cursor;
  let value = "";
  let index = cursor.index + 1;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === '"') {
      cursor.index = index + 1;
      return value;
    }
    if (char !== "\\") {
      value += char;
      index++;
      continue;
    }
    const escape = text[index + 1] ?? "";
    if (escape === "u") {
      const hex = text.slice(index + 2, index + 6);
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
  const { text } = cursor;
  let value = "";
  let index = cursor.index + 1;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char !== "'") {
      value += char;
      index++;
      continue;
    }
    if (text[index + 1] === "'") {
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
var stripPlainComment = (text) => {
  const match = /(^|\s)#/.exec(text);
  return (match ? text.slice(0, match.index) : text).trim();
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
var readScalar = (text, line) => {
  const cursor = { text, index: 0, line };
  const value = readInlineValue(cursor);
  if (Array.isArray(value)) return fail(cursor, "nested arrays are not supported");
  return value;
};
var isSkippable = (line) => line.trim() === "" || line.trimStart().startsWith("#");
var parseBlock = (lines, firstLine2) => {
  const data = {};
  let index = 0;
  while (index < lines.length) {
    const lineNumber = firstLine2 + index;
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
    const items = [];
    while (index < lines.length) {
      const itemLine = lines[index] ?? "";
      const item = LIST_ITEM.exec(itemLine);
      if (!item && !isSkippable(itemLine)) break;
      index++;
      if (!item) continue;
      items.push(readScalar(item[1] ?? "", firstLine2 + index - 1));
    }
    data[key] = items.length > 0 ? items : "";
  }
  return data;
};
var parseFrontmatter = (text) => {
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== FENCE) return void 0;
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE);
  if (closing === -1) throw new FrontmatterError('missing closing "---"', lines.length);
  const data = parseBlock(lines.slice(1, closing), 2);
  return { data, body: lines.slice(closing + 1).join("\n"), bodyLine: closing + 2 };
};

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

// src/core/paths.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
var firstLine = (text) => {
  const line = text.split("\n")[0]?.trim();
  return line === "" ? void 0 : line;
};
var gitToplevel = (cwd) => {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  return result.ok ? firstLine(result.stdout) : void 0;
};
var gitLsFiles = (cwd) => {
  const result = git(["ls-files", "-z"], cwd);
  return result.ok ? result.stdout.split("\0").filter(Boolean) : [];
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
var JIG_GITIGNORE = "journal/\nruns/\ncache/\n";
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
  }
  return paths;
};
var toSlash = (path) => path.replace(/\\/g, "/");

// src/core/plan.ts
import { createHash } from "node:crypto";
import { mkdirSync as mkdirSync4, readdirSync as readdirSync2, readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";

// src/core/config.ts
import { existsSync as existsSync2, readFileSync } from "node:fs";

// src/core/jsonc.ts
var BOM = "\uFEFF";
var isWhitespace = (char) => char === " " || char === "	" || char === "\n" || char === "\r";
var blank = (text) => text.replace(/[^\n]/g, " ");
var skipString = (text, start) => {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') return index + 1;
    index++;
  }
  return index;
};
var commentEnd = (text, start) => {
  const next = text[start + 1];
  if (next === "/") {
    const newline = text.indexOf("\n", start);
    return newline === -1 ? text.length : newline;
  }
  if (next === "*") {
    const close = text.indexOf("*/", start + 2);
    if (close === -1) throw new SyntaxError("unterminated block comment");
    return close + 2;
  }
  return void 0;
};
var stripComments = (text) => {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const end2 = skipString(text, index);
      output += text.slice(index, end2);
      index = end2;
      continue;
    }
    const end = char === "/" ? commentEnd(text, index) : void 0;
    if (end !== void 0) {
      output += blank(text.slice(index, end));
      index = end;
      continue;
    }
    output += char;
    index++;
  }
  return output;
};
var stripTrailingCommas = (text) => {
  const chars = text.split("");
  let index = 0;
  while (index < chars.length) {
    const char = chars[index];
    if (char === '"') {
      index = skipString(text, index);
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
var parseJsonc = (text) => {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  return JSON.parse(stripTrailingCommas(stripComments(source)));
};

// src/core/config.ts
var SEVERITIES = ["off", "warn", "error"];
var RULE_IDS = [
  "jig/comments",
  "jig/suppressions",
  "jig/protected-paths",
  "jig/no-verify",
  "jig/test-review",
  "jig/verify-fact",
  "gate/oxlint",
  "gate/stratum",
  "gate/tsc",
  "gate/eslint"
];
var DEFAULT_SEVERITY = "error";
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
var readRules = (validator, value) => {
  const rules = defaultRules();
  if (value === void 0) return rules;
  const object = validator.object(value, "$.rules", RULE_IDS);
  if (object === void 0) return rules;
  for (const rule of RULE_IDS) {
    if (!Object.hasOwn(object, rule)) continue;
    const severity = validator.oneOf(object[rule], childPath("$.rules", rule), SEVERITIES);
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
  "copyFiles",
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
    copyFiles: (raw) => validator.strings(raw, at("copyFiles")),
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
var defaultRules = () => Object.fromEntries(RULE_IDS.map((rule) => [rule, DEFAULT_SEVERITY]));
var defaultConfig = () => ({ rules: defaultRules() });
var validateConfig = (value) => {
  const validator = new Validator();
  const root = validator.object(value, "$", ["$schema", "rules", "slots"]);
  if (root === void 0) return { config: defaultConfig(), errors: validator.errors };
  if (root["$schema"] !== void 0) {
    validator.string(root["$schema"], "$.$schema");
  }
  const rules = readRules(validator, root["rules"]);
  const slots = root["slots"] === void 0 ? void 0 : readSlots(validator, root["slots"]);
  const config = slots === void 0 ? { rules } : { rules, slots };
  return { config, errors: validator.errors };
};
var parseConfig = (text) => {
  let value;
  try {
    value = parseJsonc(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...defaultConfig(), error: `$: ${reason}` };
  }
  const { config, errors } = validateConfig(value);
  if (errors.length > 0) return { ...defaultConfig(), error: errors.join("; ") };
  return config;
};
var loadConfig = (projectRoot) => {
  const { config } = jigPaths(projectRoot);
  if (!existsSync2(config)) return defaultConfig();
  return parseConfig(readFileSync(config, "utf8"));
};

// src/core/proc.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, realpathSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { basename, delimiter, dirname as dirname2, extname, isAbsolute as isAbsolute2, join as join2, relative as relative2, resolve as resolve2 } from "node:path";
var LOCK_WAIT_MS = 15e3;
var LOCK_STALE_MS = 5 * 60 * 1e3;
var LOCK_POLL_MS = 200;
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
  return existsSync3(script) ? [process.execPath, script] : void 0;
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
  const extensions = isWindows && extname(name) === "" ? (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join2(dir, name + extension.toLowerCase());
      if (isFile(candidate)) return candidate;
    }
  }
  return void 0;
};
var SHIM_EXTENSIONS = /* @__PURE__ */ new Set([".cmd", ".bat"]);
var SCRIPT_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".mjs", ".cjs"]);
var SHIM_TARGET = /"%(?:~dp0|dp0%)\\([^"%]+)"/gi;
var NODE_EXECUTABLE = /^node(?:\.exe)?$/i;
var isShim = (path) => SHIM_EXTENSIONS.has(extname(path).toLowerCase());
var readText = (path) => {
  try {
    return readFileSync2(path, "utf8");
  } catch {
    return void 0;
  }
};
var resolveShimTarget = (shimPath) => {
  const text = readText(shimPath) ?? "";
  const targets = [...text.matchAll(SHIM_TARGET)].map((match) => (match[1] ?? "").replace(/\\/g, "/")).filter((target2) => !NODE_EXECUTABLE.test(basename(target2)));
  const target = targets.at(-1);
  if (target === void 0) return void 0;
  const absolute = resolve2(dirname2(shimPath), target);
  if (!isFile(absolute)) return void 0;
  const extension = extname(absolute).toLowerCase();
  if (SCRIPT_EXTENSIONS.has(extension)) return [process.execPath, absolute];
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

// src/core/state.ts
import { mkdirSync as mkdirSync3, readdirSync, readFileSync as readFileSync3, renameSync, rmSync as rmSync2, statSync as statSync2, writeFileSync as writeFileSync3 } from "node:fs";
var STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var RENAME_ATTEMPTS = 20;
var RENAME_RETRY_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var tmpCounter = 0;
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
var writeFileAtomic = (path, text) => {
  tmpCounter++;
  const tmp = `${path}.${process.pid}-${tmpCounter}.tmp`;
  writeFileSync3(tmp, text);
  renameWithRetry(tmp, path);
};

// src/core/plan.ts
var OXLINT_CONFIGS = [".oxlintrc.json", "oxlint.json", "oxlintrc.json"];
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
var STRATUM_CONFIG = "stratum.config.jsonc";
var AGENT_VIEW_CONFIG = "agent-view.config.json";
var TSCONFIG = "tsconfig.json";
var TEST_FILE_GLOBS = ["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", "**/__tests__/**"];
var RUNTIME_VISIBLE_GLOBS = ["**/*.{vue,tsx,jsx,svelte,html,css,scss,less}"];
var isTestFile = createMatcher(TEST_FILE_GLOBS);
var matchesRuntimeGlob = createMatcher(RUNTIME_VISIBLE_GLOBS);
var HASHED_INPUTS = [
  ...OXLINT_CONFIGS,
  ...ESLINT_CONFIGS,
  STRATUM_CONFIG,
  AGENT_VIEW_CONFIG,
  TSCONFIG,
  "package.json",
  ".jig/config.jsonc"
];
var fileStamp = (path) => {
  try {
    const stat = statSync3(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
};
var isFile2 = (path) => fileStamp(path) !== "missing";
var planInputsHash = (projectRoot, pluginRoot) => {
  const lines = [`version:${version}`, `plugin:${pluginRoot}`, ...HASHED_INPUTS.map((name) => `${name}:${fileStamp(join3(projectRoot, name))}`)];
  return createHash("sha1").update(lines.join("\n")).digest("hex");
};
var findConfig = (projectRoot, names) => names.map((name) => join3(projectRoot, name)).find(isFile2);
var withConfig = (config, bin) => config !== void 0 && bin !== void 0 ? { bin, config } : void 0;
var detectTools = (projectRoot) => {
  const oxlint = withConfig(findConfig(projectRoot, OXLINT_CONFIGS), resolveBin(projectRoot, ["oxlint"], "oxlint"));
  const eslint = withConfig(findConfig(projectRoot, ESLINT_CONFIGS), resolveBin(projectRoot, ["eslint"], "eslint"));
  const tsc = resolveBin(projectRoot, ["typescript"], "tsc");
  const vueTsc = resolveBin(projectRoot, ["vue-tsc"], "vue-tsc");
  const stratum = withConfig(
    findConfig(projectRoot, [STRATUM_CONFIG]),
    resolveBin(projectRoot, ["@petukhovart/stratum-lint"], "stratum-lint")
  );
  const agentView = withConfig(
    findConfig(projectRoot, [AGENT_VIEW_CONFIG]),
    resolveBin(projectRoot, ["@petukhovart/agent-view"], "agent-view")
  );
  return {
    ...oxlint && { oxlint },
    ...eslint && { eslint },
    ...tsc && { tsc: { bin: tsc } },
    ...vueTsc && { vueTsc: { bin: vueTsc } },
    ...stratum && { stratum },
    ...agentView && { agentView }
  };
};
var toPlanAtom = (file) => {
  let data;
  try {
    data = parseFrontmatter(readFileSync4(file, "utf8"))?.data ?? {};
  } catch {
    return void 0;
  }
  const { name, description, paths } = data;
  const isIndexable = typeof name === "string" && typeof description === "string";
  if (!isIndexable) return void 0;
  const atom = { name, description, file };
  if (Array.isArray(paths) && paths.length > 0) {
    atom.paths = paths;
  }
  return atom;
};
var readAtomIndex = (pluginRoot) => {
  const dir = join3(pluginRoot, "atoms");
  let names;
  try {
    names = readdirSync2(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".md")).sort().map((name) => toPlanAtom(join3(dir, name))).filter((atom) => atom !== void 0);
};
var buildPlan = (projectRoot, pluginRoot, now = /* @__PURE__ */ new Date()) => ({
  v: 1,
  inputsHash: planInputsHash(projectRoot, pluginRoot),
  pluginVersion: version,
  builtAt: now.toISOString(),
  config: loadConfig(projectRoot),
  tools: detectTools(projectRoot),
  atoms: readAtomIndex(pluginRoot)
});
var writePlan = (projectRoot, plan) => {
  const path = jigPaths(projectRoot).plan;
  mkdirSync4(dirname3(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(plan, null, 2)}
`);
};

// src/atoms/atoms.ts
var ALLOWED_KEYS = /* @__PURE__ */ new Set(["name", "description", "paths"]);
var KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var DESCRIPTION_START = /^Apply (when|before|after|to) /;
var MAX_DESCRIPTION_LENGTH = 300;
var MAX_BODY_LINES = 35;
var ATOMS_LINE = /^\s*Atoms:(.*)$/gm;
var listMarkdown = (dir) => {
  try {
    return readdirSync3(dir).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
};
var readText2 = (path) => {
  try {
    return readFileSync5(path, "utf8");
  } catch {
    return "";
  }
};
var reachableNames = (pluginRoot) => {
  const skillDir = join4(pluginRoot, "skills", "jig");
  const flowsDir = join4(skillDir, "flows");
  const texts = [
    readText2(join4(skillDir, "SKILL.md")),
    ...listMarkdown(flowsDir).map((name) => readText2(join4(flowsDir, name)))
  ].map((text) => text.replace(/\r\n/g, "\n"));
  const names = /* @__PURE__ */ new Set();
  for (const text of texts) {
    for (const match of text.matchAll(/atom `([^`]+)`/g)) {
      names.add(match[1] ?? "");
    }
    for (const match of text.matchAll(ATOMS_LINE)) {
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
var isGlobList = (value) => Array.isArray(value) && value.length > 0 && value.every((glob) => glob.trim() !== "");
var checkName = (name, fileName, seen) => {
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
var checkDescription = (description) => {
  if (typeof description !== "string" || description === "") return ["description is missing"];
  const problems = [];
  if (!DESCRIPTION_START.test(description)) {
    problems.push(`description must match ${DESCRIPTION_START.source}`);
  }
  if (/[\r\n]/.test(description)) {
    problems.push("description must be one line");
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    problems.push(`description is longer than ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }
  return problems;
};
var parseAtomFile = (text) => {
  try {
    return parseFrontmatter(text) ?? "frontmatter is missing";
  } catch (error) {
    if (error instanceof FrontmatterError) return `frontmatter is invalid (${error.message})`;
    throw error;
  }
};
var checkAtom = (path, seen, reachable) => {
  const fileName = basename2(path, ".md");
  const parsed = parseAtomFile(readText2(path));
  if (typeof parsed === "string") return [parsed];
  const { data, body } = parsed;
  const unknownKeys = Object.keys(data).filter((key) => !ALLOWED_KEYS.has(key));
  const problems = unknownKeys.map((key) => `unknown frontmatter key "${key}"`);
  problems.push(...checkName(data["name"], fileName, seen), ...checkDescription(data["description"]));
  const lineCount = bodyLineCount(body);
  if (lineCount > MAX_BODY_LINES) {
    problems.push(`body is longer than ${MAX_BODY_LINES} lines (${lineCount})`);
  }
  const paths = data["paths"];
  const hasPaths = paths !== void 0;
  if (hasPaths && !isGlobList(paths)) {
    problems.push("paths must be a non-empty array of globs");
  }
  const name = typeof data["name"] === "string" ? data["name"] : fileName;
  if (!hasPaths && !reachable.has(name)) {
    problems.push(`atom is unreachable: name it as atom \`${name}\` or in an "Atoms:" line of skills/jig/SKILL.md or a flow, or add paths`);
  }
  return problems;
};
var validateAtoms = (pluginRoot) => {
  const dir = join4(pluginRoot, "atoms");
  const reachable = reachableNames(pluginRoot);
  const seen = /* @__PURE__ */ new Set();
  return listMarkdown(dir).flatMap(
    (name) => checkAtom(join4(dir, name), seen, reachable).map((problem) => `atoms/${name}: ${problem}`)
  );
};
var readAtomBody = (atom) => {
  const text = readFileSync5(atom.file, "utf8");
  const body = parseFrontmatter(text)?.body ?? text.replace(/\r\n/g, "\n");
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
  const errors = validateAtoms(pluginRoot);
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
  process.stdout.write(`${readAtomBody(atom)}
`);
  return 0;
};

// src/dash/dash.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync6 } from "node:fs";
import { dirname as dirname4, join as join5 } from "node:path";

// src/dash/template.html
var template_default = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta http-equiv=\"refresh\" content=\"30\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>jig run</title>\n<style>\n*{box-sizing:border-box}\nh1,h2,p,ol,ul{margin:0}\nol,ul{padding:0;list-style:none}\na:focus-visible,button:focus-visible{outline:3px solid currentColor;outline-offset:2px;border-radius:2px}\n@media (prefers-reduced-motion:reduce){*{animation:none!important}}\nbody{--bg:#141B26;--ink:#E6EAF0;--muted:#8A96A8;--go:#2FB38A;--now:#4C8DFF;--stop:#F0564A;--wait:#465264;--sign:#FFC72C;--sign-ink:#14213D;--rule:#2A3444;\n  margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}\nbody.light{--bg:#EEF1F4;--ink:#14213D;--muted:#5B6678;--go:#1F8A70;--now:#2F6FEB;--stop:#E03E2F;--wait:#B8C2CC;--rule:#14213D}\na{color:var(--now)}\n.wrap{padding:24px 32px}\n.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-bottom:14px;border-bottom:2px solid var(--rule)}\n.head h1{font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-.01em}\n.sub{margin-top:3px;color:var(--muted);font-size:14px}\n.pos{font-size:17px;font-weight:500;color:var(--muted);display:flex;gap:14px;align-items:center}\n.pos b{color:var(--ink);font-weight:700}\n.theme{background:none;border:1px solid var(--rule);color:var(--muted);border-radius:6px;padding:2px 8px;font:inherit;font-size:14px;cursor:pointer}\n.body{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:32px;margin-top:18px;align-items:start}\n.line{width:fit-content;max-width:100%;margin:0 auto}\n.line li{display:grid;grid-template-columns:46px 28px minmax(0,1fr);min-height:36px}\n.line time{font-size:13px;color:var(--muted);padding-top:1px;font-variant-numeric:tabular-nums}\n.st{position:relative}\n.st::before{content:\"\";position:absolute;left:11px;top:6px;bottom:-6px;width:6px;background:var(--c)}\n.line li:last-child .st::before{display:none}\n.st i{position:absolute;left:5px;top:1px;width:18px;height:18px;border-radius:50%;background:var(--bg);border:5px solid var(--c);z-index:1}\n.s-done{--c:var(--go)}\n.s-done .nm{color:var(--muted)}\n.s-todo{--c:var(--wait)}\n.s-todo .st::before{background:repeating-linear-gradient(var(--wait) 0 8px,transparent 8px 14px)}\n.s-blocked{--c:var(--stop)}\n.s-blocked .st i{background:var(--stop)}\n.s-blocked .st i::after{content:\"\";position:absolute;left:1px;right:1px;top:50%;height:3px;margin-top:-1.5px;background:#fff}\n.s-active{--c:var(--now)}\n.s-active .st i{left:1px;top:-3px;width:26px;height:26px;border-width:7px;animation:pulse 1.6s ease-out 1}\n@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--now) 60%,transparent)}100%{box-shadow:0 0 0 14px transparent}}\n.nm{padding:0 0 9px 8px}\n.nm b{font-weight:600}\n.nm small{display:block;font-size:13px;color:var(--muted)}\n.s-blocked small,.stale small{color:var(--stop);font-weight:500}\n.here{display:inline-block;margin-left:6px;padding:0 7px;border-radius:4px;background:var(--now);color:#fff;font-size:12px;font-weight:600;vertical-align:1px}\n.signs{display:flex;gap:16px;margin-top:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;scrollbar-color:var(--wait) transparent}\n.sign{flex:0 0 min(320px,85%);scroll-snap-align:start;background:var(--sign);color:var(--sign-ink);padding:14px 16px;border-radius:6px}\n.sign h2{font-size:14px;font-weight:700}\n.sign p{margin-top:6px;font-size:15px;line-height:1.4;font-weight:500}\n.sign .def{margin-top:10px;padding-top:8px;border-top:2px solid var(--sign-ink);font-size:14px}\n.sign .when{margin-top:4px;font-size:12px}\naside h2,.decided h2{font-size:14px;font-weight:700}\naside{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow-y:auto;padding-right:6px;scrollbar-color:var(--wait) transparent}\naside section+section{margin-top:20px}\naside .list li{padding:8px 0;margin:0;border-bottom:1px solid color-mix(in srgb,var(--muted) 22%,transparent);overflow-wrap:anywhere}\n.decided{margin-top:28px}\n.decided ol{margin-top:10px;max-width:110ch}\n.decided li{display:grid;grid-template-columns:46px 28px minmax(0,1fr);padding-bottom:14px;position:relative}\n.decided li::before{content:\"\";grid-column:2;justify-self:center;width:10px;height:10px;margin-top:6px;border-radius:50%;border:2px solid var(--muted);background:var(--bg);z-index:1}\n.decided li::after{content:\"\";position:absolute;left:59px;top:10px;bottom:-4px;width:2px;background:color-mix(in srgb,var(--muted) 35%,transparent)}\n.decided li:last-child::after{display:none}\n.decided li.reverted::before{border-color:var(--stop);background:var(--stop)}\n.decided li.reverted b{text-decoration:line-through;text-decoration-color:var(--stop)}\n.decided time{grid-row:1;grid-column:1;font-size:13px;color:var(--muted);padding-top:1px;font-variant-numeric:tabular-nums}\n.decided .txt{padding-left:8px;line-height:1.55;color:var(--muted)}\n.decided .txt b{display:block;color:var(--ink);font-weight:600}\n.decided .tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:4px;background:var(--stop);color:#fff;font-size:12px;font-weight:600}\n.decided dl{margin:2px 0 0;display:grid;grid-template-columns:auto 1fr;gap:0 8px;font-size:14px}\n.decided dt{color:var(--ink);font-weight:500}\n.decided dd{margin:0;overflow-wrap:anywhere}\n.closed li{display:grid;grid-template-columns:20px 1fr;gap:8px;margin-top:7px}\n.closed li::before{content:\"\";width:16px;height:16px;margin-top:2px;border-radius:50%;background:var(--stop) linear-gradient(#fff,#fff) center/10px 3px no-repeat}\n.closed small{display:block;color:var(--muted);font-size:13px}\n.list li{margin-top:6px;display:grid;grid-template-columns:42px 1fr;gap:6px;font-size:14px;line-height:1.4}\n.list time{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}\n.list small{display:block;color:var(--muted);font-size:13px}\n@media (max-width:900px){.body{grid-template-columns:1fr}aside{position:static;max-height:none}}\n</style>\n</head>\n<body>\n<div id=\"app\"></div>\n<script type=\"application/json\" id=\"run\">\n{\"v\":1,\"title\":\"\",\"branch\":\"\",\"createdAt\":\"\",\"updatedAt\":\"\",\"steps\":[],\"decisions\":[],\"results\":[],\"asks\":[]}\n</script>\n<script>\nconst R = JSON.parse(document.getElementById('run').textContent);\nconst STALE_MS = 15 * 60e3;\nconst esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'}[c]));\nconst pad = n => String(n).padStart(2, '0');\nconst hm = t => {\n  const d = new Date(t);\n  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;\n};\nconst ago = t => {\n  const m = Math.round((Date.now() - new Date(t)) / 60e3);\n  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min ago` : `${Math.floor(m / 1440)} d ago`;\n};\nconst steps = R.steps.map(s => ({...s, stale: s.status === 'active' && Date.now() - new Date(R.updatedAt) > STALE_MS}));\nconst stuck = steps.filter(s => s.status === 'blocked' || s.stale);\nconst done = steps.filter(s => s.status === 'done').length;\nconst current = steps.find(s => s.status === 'active');\nconst openAsks = R.asks.filter(a => a.answer === undefined);\nconst answered = R.asks.filter(a => a.answer !== undefined);\nconst link = d => d.href ? `<a href=\"${esc(d.href)}\">${esc(d.title)}</a>` : esc(d.title);\nconst why = s => s.stale ? `no news since ${hm(R.updatedAt)}, ${ago(R.updatedAt)}` : `waits for ${esc(s.waitsFor)}`;\nconst newest = (items, key) => [...items].sort((a, b) => (b[key] || '').localeCompare(a[key] || ''));\nconst headline = t => {\n  const m = String(t).match(/^(.{1,160}?[.:?])\\s+([\\s\\S]+)$/);\n  return m ? `<b>${esc(m[1])}</b>${esc(m[2])}` : `<b>${esc(t)}</b>`;\n};\nconst details = d => [['why', d.why], ['evidence', d.evidence]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');\nconst decision = d => {\n  const isReverted = d.result === 'reverted';\n  const extra = details(d);\n  return `<li class=\"${isReverted ? 'reverted' : ''}\"><time>${hm(d.at)}</time><div class=\"txt\">${headline(d.text)}${isReverted ? '<span class=\"tag\">reverted</span>' : ''}${extra ? `<dl>${extra}</dl>` : ''}</div></li>`;\n};\n\ndocument.body.classList.toggle('light', localStorage.getItem('jig-dash-theme') === 'light');\ndocument.title = R.title || 'jig run';\ndocument.getElementById('app').innerHTML = `<div class=\"wrap\">\n  <header class=\"head\"><div><h1>${esc(R.title)}</h1><p class=\"sub\">Branch ${esc(R.branch)}, updated at ${hm(R.updatedAt)}, ${ago(R.updatedAt)}</p></div>\n    <p class=\"pos\"><span>${current ? `Step <b>${current.n}</b> of ${steps.length}` : `Done <b>${done}</b> of ${steps.length}`}</span>\n    <button class=\"theme\" aria-label=\"Light or dark theme\">&#9680;</button></p></header>\n  <div class=\"body\"><div>\n    <ol class=\"line\" aria-label=\"Steps\">${steps.map(s => `<li class=\"s-${s.status}${s.stale ? ' stale' : ''}\">\n      <time>${s.status === 'todo' ? '' : hm(s.at)}</time><span class=\"st\"><i></i></span>\n      <div class=\"nm\"><b>${s.n}. ${esc(s.title)}</b>${s === current ? '<span class=\"here\">now here</span>' : ''}\n        ${s.status === 'blocked' || s.stale ? `<small>${why(s)}</small>` : s === current ? `<small>since ${hm(s.at)}</small>` : ''}</div></li>`).join('')}</ol>\n    ${openAsks.length ? `<div class=\"signs\">${openAsks.map(q => `<section class=\"sign\"><h2>Your decision needed (#${q.n})</h2><p>${esc(q.question)}</p>\n      <p class=\"def\">Going with the default meanwhile: <b>${esc(q.default)}</b></p><p class=\"when\">Asked at ${hm(q.askedAt)}, ${ago(q.askedAt)}</p></section>`).join('')}</div>` : ''}\n    ${R.decisions.length ? `<section class=\"decided\"><h2>Decisions</h2><ol>${newest(R.decisions, 'at').map(decision).join('')}</ol></section>` : ''}</div>\n    <aside>\n      ${stuck.length ? `<section><h2>Stuck</h2><ul class=\"closed\">${stuck.map(s => `<li><div>${s.n}. ${esc(s.title)}<small>${why(s)}</small></div></li>`).join('')}</ul></section>` : ''}\n      ${R.results.length ? `<section><h2>Results</h2><ul class=\"list\">${newest(R.results, 'at').map(d => `<li><time>${hm(d.at)}</time><span>${link(d)}</span></li>`).join('')}</ul></section>` : ''}\n      ${answered.length ? `<section><h2>Answered</h2><ul class=\"list\">${newest(answered, 'answeredAt').map(a => `<li><time>${hm(a.answeredAt)}</time><span>${esc(a.question)}<small>${esc(a.answer)}</small></span></li>`).join('')}</ul></section>` : ''}\n    </aside>\n  </div>\n</div>`;\ndocument.querySelector('.theme').onclick = () => {\n  const isLight = document.body.classList.toggle('light');\n  localStorage.setItem('jig-dash-theme', isLight ? 'light' : 'dark');\n};\n</script>\n</body>\n</html>\n";

// src/dash/dash.ts
var ACTIVE_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1e3;
var EXIT_NOT_MET = 1;
var EXIT_USAGE = 2;
var RUN_BLOCK = /(<script type="application\/json" id="run">)([\s\S]*?)(<\/script>)/;
var DECISION_FLAGS = /* @__PURE__ */ new Set(["--why", "--evidence", "--result"]);
var DECISION_RESULTS = /* @__PURE__ */ new Set(["kept", "reverted"]);
var PLAIN_STATUSES = /* @__PURE__ */ new Set(["active", "done", "todo"]);
var DashFailure = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var usage = (message) => new DashFailure(EXIT_USAGE, message);
var branchDirName = (projectRoot) => {
  const branch = gitCurrentBranch(projectRoot);
  if (branch !== void 0) return branch.replace(/[^A-Za-z0-9._-]/g, "_");
  return `detached-${gitShortSha(projectRoot) ?? "none"}`;
};
var runLocation = (projectRoot) => {
  const branch = branchDirName(projectRoot);
  const dir = join5(jigPaths(projectRoot).runs, branch);
  return { branch, data: join5(dir, "run.json"), page: join5(dir, "index.html") };
};
var isRun = (value) => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return candidate.v === 1 && typeof candidate.updatedAt === "string" && Array.isArray(candidate.steps);
};
var readRun = (path) => {
  let text;
  try {
    text = readFileSync6(path, "utf8");
  } catch {
    return void 0;
  }
  const value = JSON.parse(text);
  return isRun(value) ? value : void 0;
};
var isActive = (run2, now) => now.getTime() - Date.parse(run2.updatedAt) < ACTIVE_RUN_MAX_AGE_MS;
var renderPage = (run2) => {
  const json = JSON.stringify(run2, null, 2).replace(/</g, "\\u003c");
  return template_default.replace(RUN_BLOCK, (_match, open, _body, close) => `${open}
${json}
${close}`);
};
var saveRun = (location, run2) => {
  mkdirSync5(dirname4(location.data), { recursive: true });
  writeFileAtomic(location.data, `${JSON.stringify(run2, null, 2)}
`);
  writeFileAtomic(location.page, renderPage(run2));
};
var required2 = (value, what) => {
  if (value === void 0 || value === "") throw usage(`${what} is required`);
  return value;
};
var parseNumber = (value, what) => {
  const text = required2(value, what);
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) throw new DashFailure(EXIT_NOT_MET, `${what} must be a positive integer, got ${text}`);
  return n;
};
var stepAt = (run2, n) => {
  const step = run2.steps.find((candidate) => candidate.n === n);
  if (step === void 0) throw new DashFailure(EXIT_NOT_MET, `no step ${n}, the run has ${run2.steps.length}`);
  return step;
};
var nextNumber = (items) => items.reduce((max, item) => Math.max(max, item.n), 0) + 1;
var setStep = (run2, [nText, status, waitsFor], at) => {
  const step = stepAt(run2, parseNumber(nText, "step number"));
  delete step.waitsFor;
  step.at = at;
  if (status === "blocked") {
    step.status = "blocked";
    step.waitsFor = required2(waitsFor, "what the blocked step waits for");
    return "ok";
  }
  const isPlainStatus = status !== void 0 && PLAIN_STATUSES.has(status);
  if (!isPlainStatus) throw usage(`step status must be active, done, todo or blocked, got ${status ?? "nothing"}`);
  step.status = status;
  return "ok";
};
var addStep = (run2, [title], at) => {
  run2.steps.push({ n: nextNumber(run2.steps), title: required2(title, "step title"), status: "todo", at });
  return "ok";
};
var parseDecisionFlags = (args) => {
  const flags = /* @__PURE__ */ new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? "";
    if (!DECISION_FLAGS.has(flag)) throw usage(`unknown decision option ${flag}`);
    flags.set(flag, required2(args[index + 1], `value of ${flag}`));
  }
  return flags;
};
var addDecision = (run2, [text, ...rest], at) => {
  const flags = parseDecisionFlags(rest);
  const why = flags.get("--why");
  const evidence = flags.get("--evidence");
  const result = flags.get("--result");
  if (result !== void 0 && !DECISION_RESULTS.has(result)) throw usage(`--result must be kept or reverted, got ${result}`);
  run2.decisions.push({
    n: nextNumber(run2.decisions),
    text: required2(text, "decision text"),
    ...why === void 0 ? {} : { why },
    ...evidence === void 0 ? {} : { evidence },
    ...result === void 0 ? {} : { result },
    at
  });
  return "ok";
};
var addResult = (run2, [title, href], at) => {
  run2.results.push({ title: required2(title, "result title"), ...href ? { href } : {}, at });
  return "ok";
};
var addAsk = (run2, [question, fallback], at) => {
  const n = nextNumber(run2.asks);
  run2.asks.push({ n, question: required2(question, "question"), default: required2(fallback, "default answer"), askedAt: at });
  return String(n);
};
var answerAsk = (run2, [nText, answer], at) => {
  const n = parseNumber(nText, "question number");
  const text = required2(answer, "answer");
  const ask = run2.asks.find((candidate) => candidate.n === n && candidate.answer === void 0);
  if (ask === void 0) throw new DashFailure(EXIT_NOT_MET, `no open question ${n}`);
  ask.answer = text;
  ask.answeredAt = at;
  run2.decisions.push({ n: nextNumber(run2.decisions), text: `${ask.question} ${text}`, at });
  return "ok";
};
var MUTATIONS = /* @__PURE__ */ new Map([
  ["step", setStep],
  ["add", addStep],
  ["decision", addDecision],
  ["result", addResult],
  ["ask", addAsk],
  ["answer", answerAsk]
]);
var sameShape = (run2, title, steps) => run2.title === title && run2.steps.length === steps.length && run2.steps.every((step, index) => step.title === steps[index]);
var initRun = (projectRoot, location, [title, ...steps], now) => {
  const runTitle = required2(title, "run title");
  if (steps.length === 0) throw usage("init needs at least one step");
  ensureJigDir(projectRoot);
  const at = now.toISOString();
  const existing = readRun(location.data);
  const isKept = existing !== void 0 && sameShape(existing, runTitle, steps);
  const run2 = isKept ? { ...existing, updatedAt: at } : {
    v: 1,
    title: runTitle,
    branch: location.branch,
    createdAt: at,
    updatedAt: at,
    steps: steps.map((stepTitle, index) => ({
      n: index + 1,
      title: stepTitle,
      status: index === 0 ? "active" : "todo",
      at
    })),
    decisions: [],
    results: [],
    asks: []
  };
  saveRun(location, run2);
  return toSlash(location.page);
};
var dispatch = (args, now) => {
  const [sub, ...rest] = args;
  const projectRoot = resolveProjectRoot(process.cwd());
  const location = runLocation(projectRoot);
  if (sub === "init") return initRun(projectRoot, location, rest, now);
  const mutation = sub === void 0 ? void 0 : MUTATIONS.get(sub);
  if (sub !== "path" && mutation === void 0) {
    throw usage(`unknown dash subcommand ${sub ?? "(none)"}, expected init, step, add, decision, result, ask, answer or path`);
  }
  const run2 = readRun(location.data);
  if (run2 === void 0 || !isActive(run2, now)) {
    throw new DashFailure(EXIT_NOT_MET, `no active run for branch ${location.branch}, start one with: dash init "<title>" "<step>"...`);
  }
  if (mutation === void 0) return toSlash(location.page);
  const at = now.toISOString();
  const output = mutation(run2, rest, at);
  run2.updatedAt = at;
  saveRun(location, run2);
  return output;
};
var runDash = (args) => {
  try {
    process.stdout.write(`${dispatch(args, /* @__PURE__ */ new Date())}
`);
    return 0;
  } catch (error) {
    if (!(error instanceof DashFailure)) throw error;
    process.stderr.write(`jig: ${error.message}
`);
    return error.code;
  }
};

// src/doctor.ts
import { existsSync as existsSync4, readFileSync as readFileSync8 } from "node:fs";
import { join as join7 } from "node:path";

// src/core/journal.ts
import { appendFileSync, mkdirSync as mkdirSync6, readdirSync as readdirSync4, readFileSync as readFileSync7, rmSync as rmSync3, statSync as statSync4 } from "node:fs";
import { join as join6 } from "node:path";
var JOURNAL_MAX_BYTES = 50 * 1024 * 1024;
var DAY_MS = 24 * 60 * 60 * 1e3;
var JOURNAL_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
var listJournalFiles = (projectRoot) => {
  const dir = jigPaths(projectRoot).journal;
  let names;
  try {
    names = readdirSync4(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names.sort()) {
    const day = JOURNAL_FILE.exec(name)?.[1];
    if (day === void 0) continue;
    const path = join6(dir, name);
    files.push({ name, path, day, size: statSync4(path).size });
  }
  return files;
};
var dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
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
    for (const line of readFileSync7(file.path, "utf8").split("\n")) {
      const record = line.trim() === "" ? void 0 : parseRecord(line);
      if (record !== void 0 && Date.parse(record.ts) >= sinceMs) {
        records.push(record);
      }
    }
  }
  return records;
};

// src/doctor.ts
var MIN_NODE_MAJOR = 20;
var BYTES_PER_MB = 1024 * 1024;
var STATUS_WIDTH = 4;
var TOOLS = [
  { key: "oxlint", label: "oxlint", command: "oxlint", configs: OXLINT_CONFIGS },
  { key: "eslint", label: "eslint", command: "eslint", configs: ESLINT_CONFIGS },
  { key: "tsc", label: "tsc", command: "tsc", configs: [TSCONFIG] },
  { key: "vueTsc", label: "vue-tsc", command: "vue-tsc", configs: [] },
  { key: "stratum", label: "stratum", command: "stratum-lint", configs: [STRATUM_CONFIG] },
  { key: "agentView", label: "agent-view", command: "agent-view", configs: [AGENT_VIEW_CONFIG] }
];
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
var ok = (text) => ({ status: "ok", text });
var warn = (text) => ({ status: "warn", text });
var fail2 = (text) => ({ status: "fail", text });
var checkNode = () => {
  const version2 = process.versions.node;
  const major = Number(version2.split(".")[0]);
  return major >= MIN_NODE_MAJOR ? ok(`node: ${version2}`) : fail2(`node: ${version2}, Node >= ${MIN_NODE_MAJOR} required`);
};
var checkConfig = (projectRoot) => {
  const path = jigPaths(projectRoot).config;
  if (!existsSync4(path)) return ok(`config: ${path} absent, defaults apply`);
  const { error } = loadConfig(projectRoot);
  return error === void 0 ? ok(`config: ${path} valid`) : fail2(`config: ${path} invalid: ${error}`);
};
var firstExisting = (projectRoot, names) => names.map((name) => join7(projectRoot, name)).find((path) => existsSync4(path));
var checkTool = (projectRoot, tools, spec) => {
  const found = tools[spec.key];
  if (found !== void 0) {
    const config2 = "config" in found ? ` config ${found.config}` : "";
    return ok(`${spec.label}: ${found.bin.join(" ")}${config2}`);
  }
  const shim = findUnresolvedShim(spec.command);
  if (shim !== void 0) return warn(`${spec.label}: shim ${shim} has no recognizable target, tool not used`);
  const config = firstExisting(projectRoot, spec.configs);
  if (config === void 0) return ok(`${spec.label}: not used`);
  return warn(`${spec.label}: ${config} found, binary not found, tool not used`);
};
var checkGitignore = (projectRoot) => {
  const path = jigPaths(projectRoot).gitignore;
  return existsSync4(path) ? ok(`gitignore: ${path}`) : warn(`gitignore: ${path} missing, jig creates it on first run`);
};
var readDenyList = (path) => {
  const settings = parseJsonc(readFileSync8(path, "utf8"));
  const deny = settings?.permissions?.deny;
  return Array.isArray(deny) ? deny.filter((entry) => typeof entry === "string") : [];
};
var checkDeny = (projectRoot) => {
  const path = join7(projectRoot, ".claude", "settings.json");
  let deny = [];
  if (existsSync4(path)) {
    try {
      deny = readDenyList(path);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...warn(`deny: ${path} unreadable (${reason}), add the recommended block:`), block: formatDenyBlock() };
    }
  }
  const missing = RECOMMENDED_DENY.filter((entry) => !deny.includes(entry));
  if (missing.length === 0) return ok(`deny: ${path} has the recommended block`);
  const text = `deny: ${path} misses ${missing.length} of ${RECOMMENDED_DENY.length} rules (${missing.join(", ")}), add the recommended block:`;
  return { ...warn(text), block: formatDenyBlock() };
};
var checkAtomPaths = (projectRoot, pluginRoot) => {
  const files = gitLsFiles(projectRoot);
  const checks = [];
  let globs = 0;
  for (const atom of readAtomIndex(pluginRoot)) {
    for (const glob of atom.paths ?? []) {
      globs++;
      const matches = createMatcher([glob]);
      if (!files.some(matches)) {
        checks.push(warn(`atom ${atom.name}: paths glob ${glob} matches no file`));
      }
    }
  }
  return checks.length > 0 ? checks : [ok(`atoms: ${globs} paths globs match files`)];
};
var checkJournal = (projectRoot) => {
  const files = listJournalFiles(projectRoot);
  const bytes = files.reduce((total, file) => total + file.size, 0);
  const text = `journal: ${(bytes / BYTES_PER_MB).toFixed(1)} MB in ${files.length} files`;
  return bytes > JOURNAL_MAX_BYTES ? warn(`${text}, above ${JOURNAL_MAX_BYTES / BYTES_PER_MB} MB`) : ok(text);
};
var checkLock = (path) => {
  if (!existsSync4(path)) return ok(`lock: ${path} free`);
  if (isLockAbandoned(path)) return warn(`lock: ${path} abandoned, remove it`);
  const holder = readLock(path);
  return ok(`lock: ${path} held${holder === void 0 ? "" : ` by pid ${holder.pid}`}`);
};
var formatCheck = (check) => {
  const line = `${check.status.padEnd(STATUS_WIDTH)} ${check.text}`;
  return check.block === void 0 ? line : `${line}
${check.block}`;
};
var runDoctor = (args) => {
  if (args.length > 0) {
    throw new Error("usage: jig doctor");
  }
  const projectRoot = resolveProjectRoot(process.cwd());
  const pluginRoot = resolvePluginRoot();
  const paths = jigPaths(projectRoot);
  const tools = detectTools(projectRoot);
  const checks = [
    checkNode(),
    ok(`plugin: ${pluginRoot}`),
    ok(`project: ${projectRoot}`),
    checkConfig(projectRoot),
    ...TOOLS.map((spec) => checkTool(projectRoot, tools, spec)),
    checkGitignore(projectRoot),
    checkDeny(projectRoot),
    ...checkAtomPaths(projectRoot, pluginRoot),
    checkJournal(projectRoot),
    checkLock(paths.heavyLock),
    checkLock(join7(paths.cache, "slot.lock"))
  ];
  process.stdout.write(`${checks.map(formatCheck).join("\n")}
`);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
};

// src/loop/loop.ts
import { mkdirSync as mkdirSync7, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join8 } from "node:path";
var DEFAULT_DAYS = 7;
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var MIN_RECORDS = 2;
var MIN_TURNS = 2;
var MAX_EXAMPLES = 3;
var SINGLE_RECORD_KINDS = /* @__PURE__ */ new Set(["gate-giveup", "gate-unresolved", "hook-failure", "tool-failure"]);
var DISTINCT_TURN_KINDS = /* @__PURE__ */ new Set(["deny", "finding"]);
var TURN_CLOSING_KINDS = /* @__PURE__ */ new Set(["gate-pass", "gate-skipped", "gate-unresolved", "gate-giveup"]);
var byTime = (left, right) => Date.parse(left.ts) - Date.parse(right.ts);
var assignTurns = (records) => {
  const closedTurns = /* @__PURE__ */ new Map();
  const turns = /* @__PURE__ */ new Map();
  for (const record of records) {
    const actor = `${record.session}\0${record.agent}`;
    const index = closedTurns.get(actor) ?? 0;
    turns.set(record, `${actor}\0${index}`);
    if (TURN_CLOSING_KINDS.has(record.kind)) {
      closedTurns.set(actor, index + 1);
    }
  }
  return turns;
};
var isCandidate = (group) => {
  if (SINGLE_RECORD_KINDS.has(group.kind)) return true;
  if (DISTINCT_TURN_KINDS.has(group.kind)) return group.turns.size >= MIN_TURNS;
  return group.records.length >= MIN_RECORDS;
};
var compareCandidates = (left, right) => right.count - left.count || left.kind.localeCompare(right.kind) || (left.rule ?? "").localeCompare(right.rule ?? "") || (left.file ?? "").localeCompare(right.file ?? "");
var findCandidates = (records) => {
  const sorted = [...records].sort(byTime);
  const turns = assignTurns(sorted);
  const groups = /* @__PURE__ */ new Map();
  for (const record of sorted) {
    const key = JSON.stringify([record.kind, record.rule ?? null, record.file ?? null]);
    let group = groups.get(key);
    if (group === void 0) {
      group = {
        kind: record.kind,
        records: [],
        turns: /* @__PURE__ */ new Set(),
        ...record.rule !== void 0 && { rule: record.rule },
        ...record.file !== void 0 && { file: record.file }
      };
      groups.set(key, group);
    }
    group.records.push(record);
    group.turns.add(turns.get(record) ?? "");
  }
  return [...groups.values()].filter(isCandidate).map((group) => ({
    kind: group.kind,
    ...group.rule !== void 0 && { rule: group.rule },
    ...group.file !== void 0 && { file: group.file },
    count: group.records.length,
    examples: group.records.slice(0, MAX_EXAMPLES)
  })).sort(compareCandidates);
};
var cell = (text) => text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
var formatLocation = (record) => {
  if (record.file === void 0) return void 0;
  return record.line === void 0 ? record.file : `${record.file}:${record.line}`;
};
var formatExample = (record) => {
  const location = formatLocation(record);
  const parts = [location === void 0 ? void 0 : `\`${location}\``, record.ts, record.message];
  return cell(parts.filter((part) => part !== void 0).join(" "));
};
var formatCandidates = (candidates, from, to, days) => {
  const header = [
    "# jig loop candidates",
    "",
    `Window: ${from.toISOString()} .. ${to.toISOString()} (${days} days)`,
    ""
  ];
  if (candidates.length === 0) return [...header, "No candidates.", ""].join("\n");
  const rows = candidates.map(
    (candidate) => `| ${candidate.kind} | ${cell(candidate.rule ?? "")} | ${candidate.count} | ${candidate.examples.map(formatExample).join("<br>")} |`
  );
  return [...header, "| Signal | Rule | Count | Examples |", "| --- | --- | --- | --- |", ...rows, ""].join("\n");
};
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
  const candidates = findCandidates(readJournal(projectRoot, from.getTime()));
  const dir = join8(ensureJigDir(projectRoot).runs, "_loop", to.toISOString().slice(0, 10));
  mkdirSync7(dir, { recursive: true });
  const path = join8(dir, "candidates.md");
  writeFileSync4(path, formatCandidates(candidates, from, to, days));
  process.stdout.write(`${path}
`);
  return 0;
};

// src/slot/slot.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { cpSync, existsSync as existsSync5, mkdirSync as mkdirSync8, readdirSync as readdirSync5, readFileSync as readFileSync9, rmSync as rmSync4, writeFileSync as writeFileSync5 } from "node:fs";
import { basename as basename3, dirname as dirname5, isAbsolute as isAbsolute3, join as join9, relative as relative3, resolve as resolve3 } from "node:path";
import { parseArgs } from "node:util";
var SLOT_LOCK = "slot.lock";
var AGENT_VIEW_CONFIG2 = "agent-view.config.json";
var RECENT_MS = 24 * 60 * 60 * 1e3;
var MS_PER_SECOND = 1e3;
var SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var ENV_FILE = /^\.env/;
var NO_VALUE = "none";
var fail3 = (message, code) => {
  process.stderr.write(`jig: ${message}
`);
  return code;
};
var print = (text) => {
  process.stdout.write(`${text}
`);
};
var escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var parseWorktreeList = (porcelain) => {
  const worktrees = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (pathLine === void 0) continue;
    const branchLine = lines.find((line) => line.startsWith("branch "));
    const worktree = {
      path: resolve3(pathLine.slice("worktree ".length)),
      isPrunable: lines.some((line) => line === "prunable" || line.startsWith("prunable "))
    };
    if (branchLine !== void 0) {
      worktree.branch = branchLine.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
    worktrees.push(worktree);
  }
  return worktrees;
};
var slotNumber = (dirName, repo) => {
  const match = new RegExp(`^${escapeRegExp(repo)}-s(\\d+)(?:-|$)`).exec(dirName);
  if (match?.[1] === void 0) return void 0;
  const slot = Number(match[1]);
  return slot >= 1 ? slot : void 0;
};
var slotWorktrees = (worktrees, repo) => worktrees.flatMap((worktree) => {
  const slot = slotNumber(basename3(worktree.path), repo);
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
var setEnvValue = (text, key, value) => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const line = new RegExp(`^([ \\t]*(?:export[ \\t]+)?)${escapeRegExp(key)}[ \\t]*=.*$`, "gm");
  if (line.test(text)) return text.replace(line, (_match, prefix) => `${prefix}${key}=${value}`);
  const separator = text === "" || text.endsWith("\n") ? "" : eol;
  return `${text}${separator}${key}=${value}${eol}`;
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
var listWorktrees = (cwd) => {
  const result = git(["worktree", "list", "--porcelain"], cwd);
  if (!result.ok) throw new Error(`git worktree list failed: ${result.stderr.trim()}`);
  return parseWorktreeList(result.stdout);
};
var loadContext = () => {
  const projectRoot = resolveProjectRoot(process.cwd());
  const config = loadConfig(projectRoot);
  if (config.error !== void 0) throw new Error(`.jig/config.jsonc: ${config.error}`);
  const mainRoot = listWorktrees(projectRoot)[0]?.path ?? projectRoot;
  const context = { projectRoot, mainRoot, repo: basename3(mainRoot) };
  if (config.slots !== void 0) {
    context.slots = config.slots;
  }
  return context;
};
var formatDuplicates = (duplicates) => [...duplicates].map(([slot, group]) => `s${slot}: ${group.map((worktree) => toSlash(worktree.path)).join(", ")}`).join("; ");
var isTracked = (dir, file) => git(["ls-files", "--error-unmatch", "--", file], dir).ok;
var writeLocalFile = (dir, file, content) => {
  const path = join9(dir, file);
  mkdirSync8(dirname5(path), { recursive: true });
  writeFileSync5(path, content);
  if (isTracked(dir, file)) {
    git(["update-index", "--skip-worktree", "--", file], dir);
  }
};
var insideDir = (dir, file) => {
  const path = resolve3(dir, file);
  const rel = relative3(dir, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute3(rel)) throw new Error(`path ${file} leaves the slot dir`);
  return path;
};
var copyFromMain = (mainRoot, dir, copyFiles) => {
  const rootEnvFiles = readdirSync5(mainRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && ENV_FILE.test(entry.name)).map((entry) => entry.name);
  for (const file of /* @__PURE__ */ new Set([...rootEnvFiles, ...copyFiles])) {
    const source = join9(mainRoot, file);
    if (!existsSync5(source)) {
      process.stderr.write(`jig: copyFiles ${file} is missing in ${toSlash(mainRoot)}
`);
      continue;
    }
    cpSync(source, insideDir(dir, file), { recursive: true });
  }
};
var writePorts = (dir, slots, slot) => {
  for (const [key, port] of Object.entries(slots.ports ?? {})) {
    const path = insideDir(dir, port.target);
    const text = existsSync5(path) ? readFileSync9(path, "utf8") : "";
    writeLocalFile(dir, port.target, setEnvValue(text, key, String(port.base + slot * port.step)));
  }
};
var readJsonObject = (path) => {
  if (!existsSync5(path)) return {};
  const value = parseJsonc(readFileSync9(path, "utf8"));
  const isObject2 = typeof value === "object" && value !== null && !Array.isArray(value);
  return isObject2 ? value : {};
};
var writeAgentView = (mainRoot, dir, slots, cdpPort) => {
  const own = join9(dir, AGENT_VIEW_CONFIG2);
  const base = readJsonObject(existsSync5(own) ? own : join9(mainRoot, AGENT_VIEW_CONFIG2));
  writeLocalFile(dir, AGENT_VIEW_CONFIG2, `${JSON.stringify(agentViewConfig(base, slots, cdpPort), null, 2)}
`);
};
var branchExists = (cwd, branch) => git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd).ok;
var worktreeAddArgs = (cwd, dir, branch) => {
  if (branch === void 0) return ["worktree", "add", dir];
  return branchExists(cwd, branch) ? ["worktree", "add", dir, branch] : ["worktree", "add", dir, "-b", branch];
};
var reserveSlot = async (context, slots, options) => {
  const lock = await acquireLock(join9(ensureJigDir(context.mainRoot).cache, SLOT_LOCK));
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
    const dir = resolve3(context.mainRoot, slots.worktreesDir, slotDirName(context.repo, slot, options.slug));
    const added = git(worktreeAddArgs(context.projectRoot, dir, options.branch), context.projectRoot);
    if (!added.ok) return fail3(`git worktree add failed: ${added.stderr.trim()}`, 2);
    return { slot, dir };
  } finally {
    lock.release();
  }
};
var runInstall = (install, dir) => spawnSync2(install, { cwd: dir, shell: true, windowsHide: true, stdio: ["ignore", 2, 2] }).status;
var slotNew = async (args) => {
  const { values } = parseArgs({ args, options: { slug: { type: "string" }, branch: { type: "string" } }, strict: true });
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
  copyFromMain(context.mainRoot, dir, slots.copyFiles ?? []);
  writePorts(dir, slots, slot);
  const cdpPort = slotCdpPort(slots, slot);
  if (cdpPort !== void 0) {
    writeAgentView(context.mainRoot, dir, slots, cdpPort);
  }
  for (const cache of slots.clearCache ?? []) {
    rmSync4(insideDir(dir, cache), { recursive: true, force: true });
  }
  if (slots.install !== void 0) {
    const status = runInstall(slots.install, dir);
    if (status !== 0) return fail3(`install failed (exit ${status}) in slot ${slot} ${toSlash(dir)}`, 1);
  }
  print(`slot ${slot} ${toSlash(dir)} ports ${formatPorts(slotPorts(slots, slot))} cdp ${cdpPort ?? NO_VALUE}`);
  return 0;
};
var slotLs = (args) => {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: true });
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
var slotRm = (args) => {
  const { values, positionals } = parseArgs({
    args,
    options: { force: { type: "boolean" } },
    allowPositionals: true,
    strict: true
  });
  const slot = Number(positionals[0]?.replace(/^s/, ""));
  if (positionals.length !== 1 || !Number.isInteger(slot) || slot < 1) return fail3("usage: slot rm <N> [--force]", 2);
  const context = loadContext();
  const matches = slotWorktrees(listWorktrees(context.projectRoot), context.repo).filter((worktree2) => worktree2.slot === slot);
  const [worktree] = matches;
  if (worktree === void 0) return fail3(`no slot ${slot}`, 1);
  if (matches.length > 1) return fail3(`duplicate slot numbers: ${formatDuplicates(/* @__PURE__ */ new Map([[slot, matches]]))}`, 1);
  const isForced = values.force === true;
  const status = git(["status", "--porcelain=v1", "--untracked-files=no"], worktree.path);
  const changes = status.stdout.split(/\r?\n/).filter(Boolean);
  if (!isForced && changes.length > 0) {
    return fail3(`slot ${slot} has tracked changes, commit them or pass --force: ${changes.map((line) => line.slice(3)).join(", ")}`, 1);
  }
  const removed = git(["worktree", "remove", "--force", worktree.path], context.projectRoot);
  if (!removed.ok) return fail3(`git worktree remove failed: ${removed.stderr.trim()}`, 1);
  print(`removed ${toSlash(worktree.path)}`);
  return 0;
};
var runJson = (bin, args, cwd) => {
  const result = spawnSync2(bin, args, { cwd, encoding: "utf8", windowsHide: true });
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
var bucketOf = (worktree, openBranches, now) => {
  const status = git(["status", "--porcelain=v1"], worktree.path);
  if (status.stdout.trim() !== "") return "hold-wip";
  if (worktree.branch !== void 0 && openBranches.has(worktree.branch)) return "hold-open-mr";
  return isRecent(worktree.path, now) ? "recent" : "safe";
};
var slotSweep = (args) => {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: true });
  const context = loadContext();
  const worktrees = listWorktrees(context.projectRoot).filter((worktree) => worktree.path !== context.mainRoot);
  const openBranches = openMrBranches(context.projectRoot);
  const now = Date.now();
  const rows = worktrees.map((worktree) => ({
    bucket: bucketOf(worktree, openBranches, now),
    slot: slotNumber(basename3(worktree.path), context.repo) ?? null,
    path: toSlash(worktree.path),
    branch: worktree.branch ?? null
  }));
  if (values.json === true) {
    print(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const row of rows) {
    print(`${row.bucket}  ${row.path}  ${row.branch ?? "(detached)"}`);
  }
  return 0;
};
var subcommands = /* @__PURE__ */ new Map([
  ["new", slotNew],
  ["ls", slotLs],
  ["rm", slotRm],
  ["sweep", slotSweep]
]);
var runSlot = (args) => {
  const [name, ...rest] = args;
  const subcommand = name === void 0 ? void 0 : subcommands.get(name);
  if (subcommand === void 0) return fail3(`usage: slot <${[...subcommands.keys()].join("|")}>`, 2);
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
  ["build", runBuild],
  ["atom", runAtom],
  ["slot", runSlot],
  ["dash", runDash],
  ["loop", runLoop],
  ["doctor", runDoctor],
  ["version", runVersion]
]);
var fail4 = (message) => {
  process.stderr.write(`jig: ${message}
`);
  return EXIT_FAILURE;
};
var run = async (argv) => {
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  if (nodeMajor < MIN_NODE_MAJOR2) {
    return fail4(`Node >= ${MIN_NODE_MAJOR2} required, found ${nodeVersion}`);
  }
  const [name, ...args] = argv;
  if (name === void 0) {
    return fail4(`missing command, expected one of: ${[...commands.keys()].join(", ")}`);
  }
  const command = commands.get(name);
  if (command === void 0) {
    return fail4(`unknown command ${name}`);
  }
  try {
    return await command(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail4(message);
  }
};
process.exitCode = await run(process.argv.slice(2));

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
var LOCK_STALE_MS = 5 * 60 * 1e3;
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
var ATOMS_LINE = /^Atoms:(.*)$/gm;
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

// src/cli/main.ts
var EXIT_FAILURE = 2;
var MIN_NODE_MAJOR = 20;
var runVersion = () => {
  process.stdout.write(`jig ${version}
`);
  return 0;
};
var commands = /* @__PURE__ */ new Map([
  ["build", runBuild],
  ["atom", runAtom],
  ["version", runVersion]
]);
var fail2 = (message) => {
  process.stderr.write(`jig: ${message}
`);
  return EXIT_FAILURE;
};
var run = async (argv) => {
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  if (nodeMajor < MIN_NODE_MAJOR) {
    return fail2(`Node >= ${MIN_NODE_MAJOR} required, found ${nodeVersion}`);
  }
  const [name, ...args] = argv;
  if (name === void 0) {
    return fail2(`missing command, expected one of: ${[...commands.keys()].join(", ")}`);
  }
  const command = commands.get(name);
  if (command === void 0) {
    return fail2(`unknown command ${name}`);
  }
  try {
    return await command(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail2(message);
  }
};
process.exitCode = await run(process.argv.slice(2));

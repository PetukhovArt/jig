#!/usr/bin/env node

// package.json
var version = "0.1.0";

// src/atoms/atoms.ts
import { readdirSync as readdirSync3, readFileSync as readFileSync8 } from "node:fs";
import { basename as basename2, join as join6 } from "node:path";

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
var parseFrontmatter = (text2) => {
  const lines = text2.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
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
var matchGlob = (path, glob) => createMatcher(typeof glob === "string" ? [glob] : glob)(path);

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
var gitLsFiles = (cwd) => {
  const result = git(["ls-files", "-z"], cwd);
  return result.ok ? result.stdout.split("\0").filter(Boolean) : [];
};
var gitStagedFiles = (cwd) => {
  const result = git(["diff", "--cached", "--name-only", "-z"], cwd);
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
var toProjectPath = (projectRoot, file, cwd = projectRoot) => {
  const absolute = isAbsolute(file) ? file : resolve(cwd, file);
  return toSlash(relative(projectRoot, absolute));
};

// src/core/plan.ts
import { createHash as createHash2 } from "node:crypto";
import { mkdirSync as mkdirSync6, readdirSync as readdirSync2, readFileSync as readFileSync7, statSync as statSync4 } from "node:fs";
import { dirname as dirname5, join as join5 } from "node:path";

// src/core/test-files.ts
var TEST_FILE_GLOBS = ["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", "**/__tests__/**"];
var isTestFile = createMatcher(TEST_FILE_GLOBS);

// src/checks/check.ts
var PROOF_KINDS = ["behavior", "look"];
var defineCheck = (definition) => definition;
var isCheckActive = (check, tools) => check.binaries.every((binary) => tools[binary.key] !== void 0);

// src/checks/agent-view.ts
var AGENT_VIEW_CONFIG = "agent-view.config.json";
var AGENT_VIEW_BINARY = {
  key: "agentView",
  label: "agent-view",
  command: "agent-view",
  packages: ["@petukhovart/agent-view"],
  configs: [AGENT_VIEW_CONFIG],
  requiresConfig: true
};
var isMarkup = createMatcher(["**/*.{vue,tsx,jsx,svelte,html}"]);
var isStyle = createMatcher(["**/*.{css,scss,less}"]);
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
  requires,
  proves: (command) => PROOFS.filter(([, pattern]) => pattern.test(command)).map(([kind]) => kind),
  hints: {
    behavior: "agent-view act replay <use case>",
    look: "agent-view screenshot"
  }
});

// src/checks/index.ts
var CHECKS = [agentViewCheck];

// src/tools/eslint.ts
import { resolve as resolve3 } from "node:path";

// src/tools/tool.ts
import { extname as extname2 } from "node:path";

// src/core/proc.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, realpathSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { setPriority } from "node:os";
import { basename, delimiter, dirname as dirname2, extname, isAbsolute as isAbsolute2, join as join2, relative as relative2, resolve as resolve2 } from "node:path";
var LOW_PRIORITY = 10;
var LOCK_WAIT_MS = 15e3;
var LOCK_STALE_MS = 5 * 60 * 1e3;
var LOCK_POLL_MS = 200;
var KILL_GRACE_MS = 1e3;
var MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
var readPackageJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
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
    return readFileSync(path, "utf8");
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
    const value = JSON.parse(readFileSync(path, "utf8"));
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
var hasConfig = (entry) => entry?.config !== void 0;
var CODE_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue"]);
var isCodeFile = (file) => CODE_EXTENSIONS.has(extname2(file));
var FAILURE_DETAIL_MAX = 200;
var HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
var firstOutputLine = (text2) => text2.trim().split("\n")[0]?.slice(0, FAILURE_DETAIL_MAX) ?? "";
var settleExit = (invocation, exited) => {
  const { tool, okCodes, parse } = invocation;
  const failed = (failure) => ({ tool, findings: [], durationMs: exited.durationMs, failure });
  const isOkCode = exited.code !== null && okCodes.includes(exited.code);
  if (!isOkCode) return failed(`exit ${exited.code}: ${firstOutputLine(exited.errorOutput || exited.output)}`);
  try {
    return { tool, findings: parse(exited.output), durationMs: exited.durationMs };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
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

// src/tools/eslint.ts
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
    const file = toProjectPath(projectRoot, resolve3(cwd, result.filePath ?? ""));
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
var runEslint = (tool, projectRoot, files, timeoutMs) => runTool({
  tool: "eslint",
  argv: [
    ...tool.bin,
    "--format",
    "json",
    "--cache",
    "--cache-location",
    `${toSlash(jigPaths(projectRoot).eslintCache)}/`,
    "--no-warn-ignored",
    ...files
  ],
  cwd: projectRoot,
  timeoutMs,
  okCodes: OK_CODES,
  parse: (stdout) => parseEslint(stdout, projectRoot)
});
var eslintTool = defineTool({
  name: "eslint",
  binaries: [{ key: "eslint", label: "eslint", command: "eslint", packages: ["eslint"], configs: ESLINT_CONFIGS, requiresConfig: true }],
  stop: async (tools, input) => {
    const files = input.files.filter(isCodeFile);
    const timeoutMs = input.budget(ESLINT_TIMEOUT_MS);
    const entry = tools.eslint;
    const isSkipped2 = files.length === 0 || timeoutMs === 0;
    if (isSkipped2 || !hasConfig(entry)) return { runs: [], findings: [] };
    const toolRun = await runEslint(entry, input.projectRoot, files, timeoutMs);
    const errors = toolRun.findings.filter((finding) => finding.severity === "error");
    return { runs: [toolRun], findings: keepOnChangedLines(input.projectRoot, errors) };
  }
});

// src/tools/oxlint.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { resolve as resolve4 } from "node:path";
var OXLINT_CONFIGS = [".oxlintrc.json", "oxlint.json", "oxlintrc.json"];
var OK_CODES2 = [0, 1];
var lineAtOffset = (path, offset) => {
  try {
    return readFileSync2(path, "utf8").slice(0, offset).split("\n").length;
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
  const absolutePath = resolve4(cwd, diagnostic.filename ?? "");
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
  edit: async (tools, projectRoot, file, timeoutMs) => {
    const entry = tools.oxlint;
    if (!hasConfig(entry)) return void 0;
    const result = await runOxlint(entry, projectRoot, file, timeoutMs);
    const errors = result.findings.filter((finding) => finding.severity === "error");
    if (errors.length === 0) return { ...result, findings: [] };
    const lines = changedLines(projectRoot, [file]).get(file);
    return { ...result, findings: errors.filter((finding) => isOnChangedLine(lines, finding.line)) };
  }
});

// src/tools/stratum.ts
var STRATUM_CONFIG = "stratum.config.jsonc";
var STRATUM_TIMEOUT_MS = 15e3;
var CONTRACT_VERSION = 1;
var OK_CODES3 = [0, 1, 3];
var SEVERITIES = { error: "error", warning: "warn" };
var toFinding = (record) => {
  const severity = SEVERITIES[record.severity ?? ""];
  const isUsable = record.v === CONTRACT_VERSION && severity !== void 0 && record.rule !== void 0 && record.file !== void 0;
  if (!isUsable) return void 0;
  return {
    tool: "stratum",
    rule: record.rule,
    severity,
    file: record.file,
    line: record.line ?? 1,
    message: record.message ?? "",
    ...record.fix ? { fix: record.fix } : {}
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
  edit: async (tools, projectRoot, file, timeoutMs) => {
    const entry = tools.stratum;
    if (!hasConfig(entry)) return void 0;
    return runStratum(entry, projectRoot, [file], timeoutMs);
  },
  stop: async (tools, input) => {
    const files = input.files.filter(isCodeFile);
    const timeoutMs = input.budget(STRATUM_TIMEOUT_MS);
    const entry = tools.stratum;
    const isSkipped2 = files.length === 0 || timeoutMs === 0;
    if (isSkipped2 || !hasConfig(entry)) return { runs: [], findings: [] };
    const toolRun = await runStratum(entry, input.projectRoot, files, timeoutMs);
    return { runs: [toolRun], findings: toolRun.findings };
  }
});

// src/tools/tsc.ts
import { createHash } from "node:crypto";
import { mkdirSync as mkdirSync4, readFileSync as readFileSync4, statSync as statSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname4, extname as extname3, join as join3, relative as relative3, resolve as resolve5 } from "node:path";

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
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3 } from "node:fs";
import { setPriority as setPriority2 } from "node:os";
import { dirname as dirname3 } from "node:path";
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
    return readFileSync3(path, "utf8");
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
  mkdirSync3(dirname3(outputPath), { recursive: true });
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

// src/tools/tsc.ts
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
var isFile2 = (path) => {
  try {
    return statSync2(path).isFile();
  } catch {
    return false;
  }
};
var readTsconfig = (path) => {
  const value = parseJsonc(readFileSync4(path, "utf8"));
  return typeof value === "object" && value !== null ? value : {};
};
var stringsOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : void 0;
var findNearestTsconfig = (projectRoot, file) => {
  const top = resolve5(projectRoot);
  let dir = dirname4(resolve5(projectRoot, file));
  for (; ; ) {
    const candidate = join3(dir, TSCONFIG);
    if (isFile2(candidate)) return candidate;
    const isTop = relative3(top, dir) === "";
    const parent = dirname4(dir);
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
  const path = toSlash(relative3(dirname4(configPath), absoluteFile));
  const files = stringsOf(config.files) ?? [];
  if (files.some((entry) => toSlash(entry).replace(/^\.\//, "") === path)) return true;
  const include = stringsOf(config.include) ?? (config.files === void 0 ? DEFAULT_INCLUDE : []);
  return include.length > 0 && matchGlob(path, include.map(toIncludeGlob));
};
var referencePath = (fromConfig, reference) => {
  const path = reference?.path;
  if (typeof path !== "string") return void 0;
  const target = resolve5(dirname4(fromConfig), path);
  return isFile2(target) ? target : join3(target, TSCONFIG);
};
var isSolutionConfig = (config) => Array.isArray(config.files) && config.files.length === 0 && Array.isArray(config.references);
var selectTsconfig = (configPath, absoluteFile) => {
  const config = readTsconfig(configPath);
  if (!isSolutionConfig(config)) return configPath;
  for (const reference of config.references) {
    const target = referencePath(configPath, reference);
    if (target !== void 0 && isFile2(target) && covers(target, absoluteFile)) return target;
  }
  return void 0;
};
var groupByTsconfig = (projectRoot, files) => {
  const byConfig = /* @__PURE__ */ new Map();
  const skipped = [];
  for (const file of files.filter(isTypedFile)) {
    const nearest = findNearestTsconfig(projectRoot, file);
    const selected = nearest === void 0 ? void 0 : selectTsconfig(nearest, resolve5(projectRoot, file));
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
  const configDir = toSlash(dirname4(group.config));
  const hash = tsconfigHash(group.config);
  return {
    extends: toSlash(group.config),
    files: group.files.map((file) => toSlash(resolve5(projectRoot, file))),
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
  const path = join3(dir, `tsconfig.${tsconfigHash(group.config)}.json`);
  writeFileSync3(path, `${JSON.stringify(closureConfig(projectRoot, group), null, 2)}
`);
  return path;
};
var pathKey = (path) => process.platform === "win32" ? path.toLowerCase() : path;
var parseTscOutput = (stdout, tool, projectRoot, cwd = projectRoot) => stdout.split("\n").map((line) => TSC_ERROR.exec(line.trimEnd())).filter((match) => match !== null).map(([, file = "", line = "1", , code = "", message = ""]) => ({
  tool,
  rule: code,
  severity: "error",
  file: toProjectPath(projectRoot, resolve5(cwd, file)),
  line: Number(line),
  message
}));
var keepGroupFindings = (findings, files) => {
  const keys = new Set(files.map(pathKey));
  return findings.filter((finding) => keys.has(pathKey(finding.file)));
};
var checkerFor = (checkers, group) => {
  const hasVue = group.files.some((file) => file.endsWith(".vue"));
  if (hasVue && checkers.vueTsc !== void 0) return { tool: "vue-tsc", bin: checkers.vueTsc.bin, files: group.files };
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
    outputPath: join3(jigPaths(projectRoot).tscCache, `${tsconfigHash(group.config)}.out`),
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
    { key: "vueTsc", label: "vue-tsc", command: "vue-tsc", packages: ["vue-tsc"], configs: [], requiresConfig: false }
  ],
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

// src/tools/index.ts
var TOOLS = [oxlintTool, tscTool, eslintTool, stratumTool];

// src/core/config.ts
import { existsSync as existsSync3, readFileSync as readFileSync5 } from "node:fs";
var SEVERITIES2 = ["off", "warn", "error"];
var JIG_RULE_IDS = [
  "jig/comments",
  "jig/suppressions",
  "jig/protected-paths",
  "jig/no-verify",
  "jig/verify-fact"
];
var RULE_IDS = [...JIG_RULE_IDS, ...TOOLS.map((tool) => tool.rule)];
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
    const isAllowed2 = typeof value === "string" && allowed.includes(value);
    return isAllowed2 ? value : this.report(path, `expected one of ${allowed.join(", ")}`);
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
var parseConfig = (text2) => {
  let value;
  try {
    value = parseJsonc(text2);
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
  if (!existsSync3(config)) return defaultConfig();
  return parseConfig(readFileSync5(config, "utf8"));
};

// src/core/state.ts
import { mkdirSync as mkdirSync5, readdirSync, readFileSync as readFileSync6, renameSync, rmSync as rmSync2, statSync as statSync3, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join4 } from "node:path";
var MAIN_AGENT = "main";
var STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var RENAME_ATTEMPTS = 20;
var RENAME_RETRY_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var tmpCounter = 0;
var sessionFileName = (sessionId) => `${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
var sessionStatePath = (projectRoot, sessionId) => join4(jigPaths(projectRoot).sessions, sessionFileName(sessionId));
var createSessionState = (sessionId, snapshot, now = /* @__PURE__ */ new Date()) => {
  const iso = now.toISOString();
  return {
    v: 1,
    sessionId,
    turn: 0,
    createdAt: iso,
    updatedAt: iso,
    snapshot,
    edits: [],
    checks: {},
    delivered: {},
    sessionAtoms: [],
    pendingWarnings: [],
    stop: { consecutiveBlocks: 0 }
  };
};
var resetSnapshot = (state, snapshot) => {
  state.snapshot = snapshot;
  state.edits = [];
};
var stampCheck = (state, check, kinds, field, at) => {
  if (kinds.length === 0) return;
  const times = state.checks[check] ?? {};
  for (const kind of kinds) {
    times[kind] = { ...times[kind], [field]: at };
  }
  state.checks[check] = times;
};
var isSessionState = (value) => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return candidate.v === 1 && typeof candidate.sessionId === "string" && typeof candidate.snapshot === "object";
};
var readState = (projectRoot, sessionId) => {
  let text2;
  try {
    text2 = readFileSync6(sessionStatePath(projectRoot, sessionId), "utf8");
  } catch {
    return void 0;
  }
  try {
    const value = JSON.parse(text2);
    if (!isSessionState(value)) return void 0;
    const checks = typeof value.checks === "object" && value.checks !== null ? value.checks : {};
    return { ...value, turn: typeof value.turn === "number" ? value.turn : 0, checks };
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
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    const path = join4(dir, name);
    try {
      if (now - statSync3(path).mtimeMs <= maxAgeMs) continue;
      rmSync2(path, { force: true });
      removed.push(name);
    } catch {
      continue;
    }
  }
  return removed;
};

// src/core/plan.ts
var PLAN_BINARIES = [
  ...TOOLS.flatMap((tool) => tool.binaries),
  ...CHECKS.flatMap((check) => check.binaries)
];
var HASHED_INPUTS = [
  ...new Set(PLAN_BINARIES.flatMap((binary) => binary.configs)),
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "node_modules/.package-lock.json",
  ".jig/config.jsonc"
];
var fileStamp = (path) => {
  try {
    const stat = statSync4(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
};
var isFile3 = (path) => fileStamp(path) !== "missing";
var planInputsHash = (projectRoot, pluginRoot) => {
  const lines = [`version:${version}`, `plugin:${pluginRoot}`, ...HASHED_INPUTS.map((name) => `${name}:${fileStamp(join5(projectRoot, name))}`)];
  return createHash2("sha1").update(lines.join("\n")).digest("hex");
};
var findConfig = (projectRoot, names) => names.map((name) => join5(projectRoot, name)).find(isFile3);
var detectBinary = (projectRoot, binary) => {
  const bin = resolveBin(projectRoot, binary.packages, binary.command);
  if (bin === void 0) return void 0;
  if (!binary.requiresConfig) return { bin };
  const config = findConfig(projectRoot, binary.configs);
  return config === void 0 ? void 0 : { bin, config };
};
var detectTools = (projectRoot) => {
  const tools = {};
  for (const binary of PLAN_BINARIES) {
    const entry = detectBinary(projectRoot, binary);
    if (entry !== void 0) {
      tools[binary.key] = entry;
    }
  }
  return tools;
};
var toPlanAtom = (file) => {
  let data;
  try {
    data = parseFrontmatter(readFileSync7(file, "utf8"))?.data ?? {};
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
  const dir = join5(pluginRoot, "atoms");
  let names;
  try {
    names = readdirSync2(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".md")).sort().map((name) => toPlanAtom(join5(dir, name))).filter((atom) => atom !== void 0);
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
var readPlan = (projectRoot) => {
  try {
    const value = JSON.parse(readFileSync7(jigPaths(projectRoot).plan, "utf8"));
    return value.v === 1 && typeof value.inputsHash === "string" ? value : void 0;
  } catch {
    return void 0;
  }
};
var writePlan = (projectRoot, plan) => {
  const path = jigPaths(projectRoot).plan;
  mkdirSync6(dirname5(path), { recursive: true });
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

// src/atoms/atoms.ts
var ALLOWED_KEYS = /* @__PURE__ */ new Set(["name", "description", "paths"]);
var KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var DESCRIPTION_START = /^Apply (when|before|after|to) /;
var MAX_DESCRIPTION_LENGTH = 300;
var MAX_BODY_LINES = 35;
var MAX_ATOMS_PER_EVENT = 3;
var MAX_SESSION_ATOMS = 10;
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
    return readFileSync8(path, "utf8");
  } catch {
    return "";
  }
};
var reachableNames = (pluginRoot) => {
  const skillDir = join6(pluginRoot, "skills", "jig");
  const flowsDir = join6(skillDir, "flows");
  const texts = [
    readText2(join6(skillDir, "SKILL.md")),
    ...listMarkdown(flowsDir).map((name) => readText2(join6(flowsDir, name)))
  ].map((text2) => text2.replace(/\r\n/g, "\n"));
  const names = /* @__PURE__ */ new Set();
  for (const text2 of texts) {
    for (const match of text2.matchAll(/atom `([^`]+)`/g)) {
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
var parseAtomFile = (text2) => {
  try {
    return parseFrontmatter(text2) ?? "frontmatter is missing";
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
  const dir = join6(pluginRoot, "atoms");
  const reachable = reachableNames(pluginRoot);
  const seen = /* @__PURE__ */ new Set();
  return listMarkdown(dir).flatMap(
    (name) => checkAtom(join6(dir, name), seen, reachable).map((problem) => `atoms/${name}: ${problem}`)
  );
};
var selectAtoms = (atoms, file, delivered) => {
  return atoms.filter((atom) => atom.paths !== void 0 && !delivered.includes(atom.name) && matchGlob(file, atom.paths)).sort((left, right) => left.name.localeCompare(right.name)).slice(0, MAX_ATOMS_PER_EVENT);
};
var readAtomBody = (atom) => {
  const text2 = readFileSync8(atom.file, "utf8");
  const body = parseFrontmatter(text2)?.body ?? text2.replace(/\r\n/g, "\n");
  return body.replace(/^\n+/, "").replace(/\s+$/, "");
};
var formatAtomDelivery = (atom, file) => {
  return `jig: atom ${atom.name} applies to ${file}:
${readAtomBody(atom)}`;
};
var formatSessionAtoms = (atoms, pluginRoot) => {
  if (atoms.length === 0) return "";
  const root = toSlash(pluginRoot);
  const lines = atoms.slice(-MAX_SESSION_ATOMS).map((atom) => `- ${atom.name} (${root}/atoms/${atom.name}.md): ${atom.description}`);
  return ["jig: atoms active in this session (read the ones your task touches):", ...lines].join("\n");
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
import { mkdirSync as mkdirSync7, readFileSync as readFileSync9 } from "node:fs";
import { dirname as dirname6, join as join7 } from "node:path";

// src/dash/template.html
var template_default = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>jig run</title>\n<style>\nbody {\n  --paper: #faf9f5; --card: #fff; --sunk: #f0eee6;\n  --ink: #141413; --ink-2: #3d3d3a; --ink-3: #73726c; --line: rgba(31,30,29,.15); --line-2: rgba(31,30,29,.08);\n  --accent: #c6613f; --accent-soft: #f6e7df; --green: #2c7a39; --green-soft: #e2efdf;\n  --red: #b3261e; --red-soft: #f7dfdc; --blue: #2a69b8; --blue-soft: #dde8f5; --float: 0 2px 8px rgba(0,0,0,.08);\n  --sans: ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif; --serif: ui-serif, Georgia, \"Times New Roman\", serif; --mono: ui-monospace, \"SF Mono\", Menlo, Consolas, monospace;\n}\n@media (prefers-color-scheme: dark) { body:not(.light) { color-scheme: dark;\n  --paper: #262624; --card: #30302e; --sunk: #1f1e1d;\n  --ink: #faf9f5; --ink-2: #c2c0b6; --ink-3: #9c9a92; --line: rgba(222,220,209,.15); --line-2: rgba(222,220,209,.08);\n  --accent: #d97757; --accent-soft: #46302a; --green: #6fb37a; --green-soft: #26372a;\n  --red: #e5776e; --red-soft: #432725; --blue: #7aa7e0; --blue-soft: #25313f; --float: 0 2px 8px rgba(0,0,0,.3);\n} }\nbody.dark { color-scheme: dark;\n  --paper: #262624; --card: #30302e; --sunk: #1f1e1d;\n  --ink: #faf9f5; --ink-2: #c2c0b6; --ink-3: #9c9a92; --line: rgba(222,220,209,.15); --line-2: rgba(222,220,209,.08);\n  --accent: #d97757; --accent-soft: #46302a; --green: #6fb37a; --green-soft: #26372a;\n  --red: #e5776e; --red-soft: #432725; --blue: #7aa7e0; --blue-soft: #25313f; --float: 0 2px 8px rgba(0,0,0,.3);\n}\n:where(*) { box-sizing: border-box; }\n[hidden] { display: none !important; }\nbody { margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink); font: 430 16px/1.6 var(--sans); -webkit-text-size-adjust: 100%; overflow-x: clip; }\nh1, h2, p, ol { margin: 0; }\nol { padding: 0; list-style: none; }\nh1 { font: 500 26px/1.15 var(--serif); margin-bottom: 8px; text-wrap: balance; overflow-wrap: anywhere; }\nh2 { font: 500 22px/1.25 var(--serif); margin-bottom: 12px; display: flex; align-items: baseline; gap: 10px; }\na { color: var(--accent); text-underline-offset: 3px; }\nbutton { font: inherit; color: inherit; cursor: pointer; }\na:focus-visible, button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\ntime, .mono { font: 12px/1.5 var(--mono); color: var(--ink-3); font-variant-numeric: tabular-nums; }\n.pill { display: inline-block; font: 550 12px/1 var(--sans); padding: 4px 8px; border-radius: 99px; background: var(--sunk); color: var(--ink-2); border: 1px solid var(--line); white-space: nowrap; }\n.pill.accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }\n.pill.green { background: var(--green-soft); color: var(--green); border-color: transparent; }\n.pill.red { background: var(--red-soft); color: var(--red); border-color: transparent; }\n.pill.here { background: var(--accent); color: #fff; border-color: transparent; margin-left: 6px; vertical-align: 1px; }\n\n.page { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 40px; max-width: 1180px; margin: 0 auto; padding: 32px 24px 120px; }\n.rail { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; }\n.meta { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; margin-bottom: 12px; }\n.live { display: inline-flex; gap: 6px; align-items: center; }\n.big { font: 500 44px/1 var(--serif); margin: 6px 0 10px; }\n.big small { font: 430 16px/1 var(--sans); color: var(--ink-3); }\n.seg { display: flex; gap: 3px; margin-bottom: 8px; }\n.seg i { flex: 1; height: 6px; border-radius: 3px; background: var(--line); }\n.seg i.done { background: var(--green); } .seg i.active { background: var(--accent); } .seg i.blocked, .seg i.stale { background: var(--red); }\n.steps-toggle { display: none; border: 0; background: none; padding: 4px 0; font-size: 13px; color: var(--ink-3); }\n.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; border: 1.5px solid var(--ink-3); background: var(--paper); }\n.dot.done { background: var(--green); border-color: var(--green); }\n.dot.active { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }\n.dot.blocked, .dot.stale { background: var(--red); border-color: var(--red); }\n.line { position: relative; margin-top: 12px; }\n.line::before { content: \"\"; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 2px; background: var(--line); }\n.line li { position: relative; display: flex; gap: 12px; align-items: flex-start; padding: 5px 0; font-size: 14px; line-height: 1.45; }\n.line li .dot { margin-top: 5px; }\n.line li > div { min-width: 0; overflow-wrap: anywhere; }\n.line li.done > div { color: var(--ink-3); }\n.line li.blocked > div, .line li.stale > div { color: var(--red); }\n.line li.active > div { font-weight: 600; }\n.line small { display: block; font-size: 12px; font-weight: 430; color: var(--ink-3); }\n.line li.blocked small, .line li.stale small { color: var(--red); }\n\n.inbox { margin-bottom: 32px; }\n.ask { padding: 16px; background: var(--card); border: 1px solid var(--accent); border-radius: 12px; margin-bottom: 14px; }\n.ask .k { font-size: 12px; font-weight: 550; color: var(--ink-3); margin-bottom: 8px; display: flex; gap: 8px; flex-wrap: wrap; }\n.ask .k b { color: var(--accent); font-weight: 550; }\n.ask .q { font-weight: 600; margin-bottom: 10px; overflow-wrap: anywhere; }\n.ask .def { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); font-size: 15px; line-height: 1.4; margin-bottom: 8px; }\n.ask .def small { display: block; font-size: 13px; color: var(--ink-2); margin-top: 2px; }\n.reply { display: block; width: 100%; min-height: 72px; font: 15px/1.5 var(--sans); padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); resize: vertical; }\n.reply:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }\n\n.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; position: sticky; top: 0; z-index: 4; background: var(--paper); padding: 10px 0; border-bottom: 1px solid var(--line-2); }\n.chips button { font-size: 13px; font-weight: 550; line-height: 1; padding: 7px 11px; border-radius: 99px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); }\n.chips button[aria-pressed=\"true\"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }\n.feed[data-f=\"d\"] .ev:not(.d), .feed[data-f=\"r\"] .ev:not(.r), .feed[data-f=\"s\"] .ev:not(.s), .feed[data-f=\"a\"] .ev:not(.a) { display: none; }\n.ev { display: grid; grid-template-columns: 48px 26px minmax(0, 1fr); gap: 0 10px; position: relative; }\n.ev::before { content: \"\"; position: absolute; left: 70px; top: 0; bottom: 0; width: 1px; background: var(--line); }\n.ev > time { padding-top: 14px; text-align: right; }\n.ev .ico { width: 26px; height: 26px; margin-top: 12px; border-radius: 50%; display: grid; place-items: center; font: 600 12px/1 var(--mono); position: relative; }\n.ev.d .ico { background: var(--blue-soft); color: var(--blue); }\n.ev.r .ico { background: var(--green-soft); color: var(--green); }\n.ev.a .ico { background: var(--accent-soft); color: var(--accent); }\n.ev.s .ico { background: var(--red-soft); color: var(--red); }\n.item { padding: 12px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; margin: 6px 0; min-width: 0; }\n.item .top { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }\n.item .top:empty { display: none; }\n.item .top time { display: none; }\n.item p { font-size: 15px; overflow-wrap: anywhere; }\n.item.reverted p { text-decoration: line-through; color: var(--ink-3); }\n.item details summary { cursor: pointer; font-size: 13px; color: var(--ink-3); margin-top: 6px; }\n.item dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 14px; margin: 8px 0 0; font-size: 14px; }\n.item dt { font-size: 12px; line-height: 1.9; color: var(--ink-3); } .item dd { margin: 0; color: var(--ink-2); overflow-wrap: anywhere; }\n.empty { color: var(--ink-3); font-size: 14px; }\n\n.bar { position: fixed; z-index: 10; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); display: flex; gap: 8px; align-items: center; }\n.theme { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); box-shadow: var(--float); color: var(--ink-2); }\n.copy { font-size: 14px; font-weight: 550; line-height: 1; padding: 13px 16px; border-radius: 99px; border: 0; background: var(--ink); color: var(--paper); box-shadow: var(--float); }\n.copy:disabled { background: var(--sunk); color: var(--ink-3); border: 1px solid var(--line); cursor: default; }\n\n@media (max-width: 900px) {\n  .page { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0 16px 110px; }\n  .rail { position: sticky; top: 0; z-index: 6; max-height: none; overflow: visible; background: var(--paper); padding: 14px 0 6px; border-bottom: 1px solid var(--line); }\n  h1 { font-size: 20px; margin-bottom: 4px; }\n  .meta { margin-bottom: 4px; }\n  .big { font: 600 15px/1.4 var(--sans); margin: 0; } .big small { font-size: 13px; }\n  .seg { margin: 6px 0 2px; }\n  .steps-toggle { display: block; }\n  .rail:not(.open) .line { display: none; }\n  .rail.open .line { max-height: 45vh; overflow: auto; }\n  .chips { position: static; }\n  .feed { padding-top: 16px; }\n  .ev { grid-template-columns: 40px 22px minmax(0, 1fr); gap: 0 8px; }\n  .ev::before { left: 58px; }\n  .ev .ico { width: 22px; height: 22px; font-size: 11px; }\n}\n@media (max-width: 480px) {\n  .ev { grid-template-columns: 22px minmax(0, 1fr); }\n  .ev > time { display: none; }\n  .ev::before { left: 11px; }\n  .item .top time { display: inline; }\n  .bar { left: 16px; }\n  .copy { flex: 1; }\n}\n</style>\n</head>\n<body>\n<div id=\"app\"></div>\n<script type=\"application/json\" id=\"run\">\n{\"v\":1,\"title\":\"\",\"lang\":\"en\",\"branch\":\"\",\"createdAt\":\"\",\"updatedAt\":\"\",\"steps\":[],\"decisions\":[],\"results\":[],\"asks\":[]}\n</script>\n<script>\nconst R = JSON.parse(document.getElementById('run').textContent);\nconst STALE_MS = 15 * 60e3;\nconst REFRESH_MS = 30e3;\nconst COPIED_MS = 2500;\nconst LABELS = {\n  en: {\n    locale: 'en-GB',\n    run: 'jig run',\n    branch: 'branch',\n    live: ago => `live, ${ago}`,\n    quiet: ago => `no news ${ago}`,\n    stepsDone: total => `/ ${total} steps done`,\n    stepsToggle: (stuck, current) => [stuck && `${stuck} stuck`, current && `now step ${current}`].filter(Boolean).join(', ') || 'Steps',\n    theme: 'Light or dark theme',\n    steps: 'Steps',\n    here: 'now here',\n    since: 'since',\n    waitsFor: 'waits for',\n    stale: (at, ago) => `no news since ${at}, ${ago}`,\n    waiting: 'Waiting for your answer',\n    ask: (i, total) => `Question ${i} of ${total}`,\n    asked: (n, at, ago) => `#${n} \xB7 asked at ${at}, ${ago}`,\n    fallback: 'The agent goes with this until you answer.',\n    answerLabel: n => `Answer to question #${n}`,\n    answerPlaceholder: 'Your own answer',\n    copy: 'Copy answers',\n    copied: n => `copied (${n})`,\n    copyFailed: 'copy failed',\n    answersFor: title => `Answers for run \"${title}\":`,\n    answerItem: (n, question) => `#${n} ${question}`,\n    journal: 'Journal',\n    all: 'All',\n    decisions: 'Decisions',\n    results: 'Results',\n    stuck: 'Stuck',\n    answered: 'Answers',\n    why: 'why',\n    evidence: 'evidence',\n    reverted: 'reverted',\n    kept: 'kept',\n    result: 'result',\n    answer: 'answer',\n    stepStuck: 'step stuck',\n    nothing: 'Nothing yet.',\n    justNow: 'just now',\n    minAgo: m => `${m} min ago`,\n    hoursAgo: (h, m) => `${h} h ${m} min ago`,\n    daysAgo: d => `${d} d ago`,\n  },\n  ru: {\n    locale: 'ru-RU',\n    run: '\u041F\u0440\u043E\u0433\u043E\u043D jig',\n    branch: '\u0432\u0435\u0442\u043A\u0430',\n    live: ago => `\u0436\u0438\u0432\u043E\u0439, ${ago}`,\n    quiet: ago => `\u043D\u0435\u0442 \u0432\u0435\u0441\u0442\u0435\u0439 ${ago}`,\n    stepsDone: total => `/ ${total} \u0448\u0430\u0433\u043E\u0432 \u0433\u043E\u0442\u043E\u0432\u043E`,\n    stepsToggle: (stuck, current) => [stuck && `${stuck} \u0441\u0442\u043E\u044F\u0442`, current && `\u0441\u0435\u0439\u0447\u0430\u0441 \u0448\u0430\u0433 ${current}`].filter(Boolean).join(', ') || '\u0428\u0430\u0433\u0438',\n    theme: '\u0421\u0432\u0435\u0442\u043B\u0430\u044F \u0438\u043B\u0438 \u0442\u0451\u043C\u043D\u0430\u044F \u0442\u0435\u043C\u0430',\n    steps: '\u0428\u0430\u0433\u0438',\n    here: '\u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0434\u0435\u0441\u044C',\n    since: '\u0438\u0434\u0451\u0442 \u0441',\n    waitsFor: '\u0436\u0434\u0451\u0442',\n    stale: (at, ago) => `\u043D\u0435\u0442 \u0432\u0435\u0441\u0442\u0435\u0439 \u0441 ${at}, ${ago}`,\n    waiting: '\u0416\u0434\u0443\u0442 \u0432\u0430\u0448\u0435\u0433\u043E \u043E\u0442\u0432\u0435\u0442\u0430',\n    ask: (i, total) => `\u0412\u043E\u043F\u0440\u043E\u0441 ${i} \u0438\u0437 ${total}`,\n    asked: (n, at, ago) => `\u2116${n} \xB7 \u0441\u043F\u0440\u043E\u0441\u0438\u043B \u0432 ${at}, ${ago}`,\n    fallback: '\u0410\u0433\u0435\u043D\u0442 \u0438\u0434\u0451\u0442 \u0441 \u044D\u0442\u0438\u043C \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u043E\u043C, \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430.',\n    answerLabel: n => `\u041E\u0442\u0432\u0435\u0442 \u043D\u0430 \u0432\u043E\u043F\u0440\u043E\u0441 \u2116${n}`,\n    answerPlaceholder: '\u0421\u0432\u043E\u0439 \u043E\u0442\u0432\u0435\u0442',\n    copy: '\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442\u044B',\n    copied: n => `\u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E (${n})`,\n    copyFailed: '\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C',\n    answersFor: title => `\u041E\u0442\u0432\u0435\u0442\u044B \u043F\u043E \u043F\u0440\u043E\u0433\u043E\u043D\u0443 \xAB${title}\xBB:`,\n    answerItem: (n, question) => `\u2116${n} ${question}`,\n    journal: '\u0416\u0443\u0440\u043D\u0430\u043B',\n    all: '\u0412\u0441\u0451',\n    decisions: '\u0420\u0435\u0448\u0435\u043D\u0438\u044F',\n    results: '\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B',\n    stuck: '\u0421\u0442\u043E\u044F\u0442',\n    answered: '\u041E\u0442\u0432\u0435\u0442\u044B',\n    why: '\u043F\u043E\u0447\u0435\u043C\u0443',\n    evidence: '\u0434\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u043E',\n    reverted: '\u043E\u0442\u0431\u0440\u043E\u0448\u0435\u043D\u043E',\n    kept: '\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E',\n    result: '\u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442',\n    answer: '\u043E\u0442\u0432\u0435\u0442',\n    stepStuck: '\u0448\u0430\u0433 \u0441\u0442\u043E\u0438\u0442',\n    nothing: '\u041F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E.',\n    justNow: '\u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E',\n    minAgo: m => `${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`,\n    hoursAgo: (h, m) => `${h} \u0447 ${m} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`,\n    daysAgo: d => `${d} \u0434\u043D \u043D\u0430\u0437\u0430\u0434`,\n  },\n};\nconst lang = Object.hasOwn(LABELS, R.lang) ? R.lang : 'en';\nconst L = LABELS[lang];\nconst esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'}[c]));\nconst hm = t => {\n  const d = new Date(t);\n  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(L.locale, {hour: '2-digit', minute: '2-digit'});\n};\nconst ago = t => {\n  const m = Math.round((Date.now() - new Date(t)) / 60e3);\n  return m < 1 ? L.justNow : m < 60 ? L.minAgo(m) : m < 1440 ? L.hoursAgo(Math.floor(m / 60), m % 60) : L.daysAgo(Math.floor(m / 1440));\n};\nconst isQuiet = Date.now() - new Date(R.updatedAt) > STALE_MS;\nconst steps = R.steps.map(s => ({...s, stale: s.status === 'active' && isQuiet}));\nconst stuck = steps.filter(s => s.status === 'blocked' || s.stale);\nconst done = steps.filter(s => s.status === 'done').length;\nconst current = steps.find(s => s.status === 'active');\nconst openAsks = R.asks.filter(a => a.answer === undefined);\nconst answered = R.asks.filter(a => a.answer !== undefined);\nconst link = d => d.href ? `<a href=\"${esc(d.href)}\">${esc(d.title)}</a>` : esc(d.title);\nconst why = s => s.stale ? L.stale(hm(R.updatedAt), ago(R.updatedAt)) : `${L.waitsFor} ${esc(s.waitsFor)}`;\nconst newest = (items, key) => [...items].sort((a, b) => (b[key] || '').localeCompare(a[key] || '') || (b.n || 0) - (a.n || 0));\nconst stepClass = s => s.stale ? 'stale' : s.status;\n\nconst item = (at, tag, body, extraClass = '') => `<div class=\"item${extraClass}\"><div class=\"top\"><time>${hm(at)}</time>${tag}</div>${body}</div>`;\nconst decisionItem = d => {\n  const extra = [[L.why, d.why], [L.evidence, d.evidence]].filter(([, v]) => v);\n  const tag = d.result === 'reverted' ? `<span class=\"pill red\">${L.reverted}</span>` : d.result === 'kept' ? `<span class=\"pill green\">${L.kept}</span>` : '';\n  const more = extra.length ? `<details><summary>${extra.map(([k]) => k).join(' \xB7 ')}</summary><dl>${extra.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : '';\n  return item(d.at, tag, `<p>${esc(d.text)}</p>${more}`, d.result === 'reverted' ? ' reverted' : '');\n};\nconst events = [\n  ...R.decisions.map(d => ({k: 'd', at: d.at, html: decisionItem(d)})),\n  ...R.results.map(r => ({k: 'r', at: r.at, html: item(r.at, `<span class=\"pill green\">${L.result}</span>`, `<p>${link(r)}</p>`)})),\n  ...answered.map(a => ({k: 'a', at: a.answeredAt, html: item(a.answeredAt, `<span class=\"pill\">${L.answer}</span>`, `<p>${esc(a.question)}</p><p class=\"mono\">\u2192 ${esc(a.answer)}</p>`)})),\n  ...stuck.map(s => ({k: 's', at: s.at, html: item(s.at, `<span class=\"pill red\">${L.stepStuck}</span>`, `<p>${s.n}. ${esc(s.title)}</p><p class=\"mono\">${why(s)}</p>`)})),\n];\nconst ICON = {d: '\u25C6', r: '\u2713', a: '?', s: '!'};\nconst FILTERS = [['all', L.all, events.length], ['d', L.decisions, R.decisions.length], ['r', L.results, R.results.length], ['s', L.stuck, stuck.length], ['a', L.answered, answered.length]];\nconst savedFilter = localStorage.getItem('jig-dash-filter');\nconst filter = FILTERS.some(([k, , count]) => k === savedFilter && count) ? savedFilter : 'all';\n\nconst askCard = (q, i) => `<section class=\"ask\" data-n=\"${q.n}\">\n  <div class=\"k\"><b>${L.ask(i + 1, openAsks.length)}</b><span>${L.asked(q.n, hm(q.askedAt), ago(q.askedAt))}</span></div>\n  <p class=\"q\">${esc(q.question)}</p>\n  <p class=\"def\">${esc(q.default)}<small>${L.fallback}</small></p>\n  <textarea class=\"reply\" rows=\"2\" placeholder=\"${L.answerPlaceholder}\" aria-label=\"${L.answerLabel(q.n)}\"></textarea></section>`;\nconst stepLine = s => `<li class=\"${stepClass(s)}\"><i class=\"dot ${stepClass(s)}\"></i><div>${s.n}. ${esc(s.title)}${s === current ? `<span class=\"pill here\">${L.here}</span>` : ''}\n  ${s.status === 'blocked' || s.stale ? `<small>${why(s)}</small>` : s === current ? `<small>${L.since} ${hm(s.at)}</small>` : ''}</div></li>`;\n\nfunction draftKey(q) {\n  return `jig-dash-answer:${location.pathname}:${q.n}:${q.askedAt}`;\n}\n\nfunction answersText(drafts) {\n  const items = openAsks\n    .map(q => ({q, answer: String(drafts[q.n] ?? '').trim()}))\n    .filter(item => item.answer !== '')\n    .sort((a, b) => a.q.n - b.q.n)\n    .map(({q, answer}) => `${L.answerItem(q.n, q.question)}\\n\u2192 ${answer}`);\n  return {count: items.length, text: items.length ? `${L.answersFor(R.title)}\\n${items.join('\\n\\n')}` : ''};\n}\n\nconst readDraft = q => {\n  try {\n    return localStorage.getItem(draftKey(q)) ?? '';\n  } catch {\n    return '';\n  }\n};\n\nconst drafts = Object.fromEntries(openAsks.map(q => [q.n, readDraft(q)]));\nlet hasUnsaved = false;\n\ndocument.documentElement.lang = lang;\nconst theme = localStorage.getItem('jig-dash-theme');\ndocument.body.classList.toggle('light', theme === 'light');\ndocument.body.classList.toggle('dark', theme === 'dark');\ndocument.title = R.title || L.run;\ndocument.getElementById('app').innerHTML = `<div class=\"page\">\n  <aside class=\"rail\">\n    <h1>${esc(R.title)}</h1>\n    <p class=\"meta mono\"><span>${L.branch} ${esc(R.branch)}</span><span class=\"live\"><i class=\"dot ${isQuiet ? 'blocked' : 'done'}\"></i>${isQuiet ? L.quiet(ago(R.updatedAt)) : L.live(ago(R.updatedAt))}</span></p>\n    <p class=\"big\">${done}<small> ${L.stepsDone(steps.length)}</small></p>\n    <div class=\"seg\">${steps.map(s => `<i class=\"${stepClass(s)}\" title=\"${s.n}. ${esc(s.title)}\"></i>`).join('')}</div>\n    <button class=\"steps-toggle\" type=\"button\" aria-expanded=\"false\">\u25B8 ${L.stepsToggle(stuck.length, current?.n)}</button>\n    <ol class=\"line\" aria-label=\"${L.steps}\">${steps.map(stepLine).join('')}</ol>\n  </aside>\n  <main class=\"feed\" data-f=\"${filter}\">\n    ${openAsks.length ? `<section class=\"inbox\"><h2>${L.waiting} <span class=\"pill accent\">${openAsks.length}</span></h2>${openAsks.map(askCard).join('')}</section>` : ''}\n    <h2>${L.journal}</h2>\n    ${events.length ? `<div class=\"chips\" role=\"toolbar\">${FILTERS.filter(([, , count]) => count).map(([k, label, count]) => `<button type=\"button\" data-f=\"${k}\" aria-pressed=\"${filter === k}\">${label} \xB7 ${count}</button>`).join('')}</div>\n    ${newest(events, 'at').map(e => `<div class=\"ev ${e.k}\"><time>${hm(e.at)}</time><span class=\"ico\">${ICON[e.k]}</span>${e.html}</div>`).join('')}` : `<p class=\"empty\">${L.nothing}</p>`}\n  </main>\n</div>\n<div class=\"bar\"><button class=\"theme\" type=\"button\" aria-label=\"${L.theme}\">&#9680;</button>${openAsks.length ? `<button class=\"copy\" type=\"button\">${L.copy}</button>` : ''}</div>`;\n\nconst copyButton = document.querySelector('.copy');\nconst refreshCopy = () => {\n  if (copyButton) copyButton.disabled = answersText(drafts).count === 0;\n};\n\nconst writeClipboard = async text => {\n  try {\n    await navigator.clipboard.writeText(text);\n    return true;\n  } catch {\n    const area = document.createElement('textarea');\n    area.value = text;\n    area.setAttribute('readonly', '');\n    area.style.position = 'fixed';\n    area.style.opacity = '0';\n    document.body.append(area);\n    area.select();\n    const isCopied = document.execCommand('copy');\n    area.remove();\n    return isCopied;\n  }\n};\n\nfor (const box of document.querySelectorAll('.ask')) {\n  const q = openAsks.find(a => String(a.n) === box.dataset.n);\n  const reply = box.querySelector('.reply');\n  reply.value = drafts[q.n];\n  reply.addEventListener('input', () => {\n    drafts[q.n] = reply.value;\n    try {\n      if (reply.value.trim() === '') localStorage.removeItem(draftKey(q));\n      else localStorage.setItem(draftKey(q), reply.value);\n      hasUnsaved = false;\n    } catch {\n      hasUnsaved = true;\n    }\n    refreshCopy();\n  });\n}\n\nfor (const chip of document.querySelectorAll('.chips button')) {\n  chip.addEventListener('click', () => {\n    document.querySelector('.feed').dataset.f = chip.dataset.f;\n    for (const other of document.querySelectorAll('.chips button')) other.setAttribute('aria-pressed', String(other === chip));\n    localStorage.setItem('jig-dash-filter', chip.dataset.f);\n  });\n}\n\ndocument.querySelector('.steps-toggle').addEventListener('click', event => {\n  const isOpen = document.querySelector('.rail').classList.toggle('open');\n  event.currentTarget.setAttribute('aria-expanded', String(isOpen));\n  event.currentTarget.textContent = `${isOpen ? '\u25BE' : '\u25B8'} ${L.stepsToggle(stuck.length, current?.n)}`;\n});\n\nrefreshCopy();\ncopyButton?.addEventListener('click', async () => {\n  const {text, count} = answersText(drafts);\n  if (count === 0) return;\n  const isCopied = await writeClipboard(text);\n  copyButton.textContent = isCopied ? L.copied(count) : L.copyFailed;\n  setTimeout(() => { copyButton.textContent = L.copy; }, COPIED_MS);\n});\n\ndocument.querySelector('.theme').addEventListener('click', () => {\n  const isDark = getComputedStyle(document.body).colorScheme === 'dark';\n  const next = isDark ? 'light' : 'dark';\n  document.body.classList.toggle('light', next === 'light');\n  document.body.classList.toggle('dark', next === 'dark');\n  localStorage.setItem('jig-dash-theme', next);\n});\n\nsetInterval(() => {\n  const isTyping = document.activeElement?.classList?.contains('reply');\n  if (!isTyping && !hasUnsaved) location.reload();\n}, REFRESH_MS);\n</script>\n</body>\n</html>\n";

// src/dash/dash.ts
var RUN_LANGS = ["en", "ru"];
var ACTIVE_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1e3;
var EXIT_NOT_MET = 1;
var EXIT_USAGE = 2;
var RUN_BLOCK = /(<script type="application\/json" id="run">)([\s\S]*?)(<\/script>)/;
var DECISION_FLAGS = /* @__PURE__ */ new Set(["--why", "--evidence", "--result"]);
var DECISION_RESULTS = /* @__PURE__ */ new Set(["kept", "reverted"]);
var PLAIN_STATUSES = /* @__PURE__ */ new Set(["active", "done", "todo"]);
var CURRENT_STEP_ORDER = ["active", "blocked", "todo"];
var DashFailure = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var usage = (message) => new DashFailure(EXIT_USAGE, message);
var noActiveRun = (location) => new DashFailure(EXIT_NOT_MET, `no active run for branch ${location.branch}, start one with: dash init --lang <en|ru> "<title>" "<step>"...`);
var branchDirName = (projectRoot) => {
  const branch = gitCurrentBranch(projectRoot);
  if (branch !== void 0) return branch.replace(/[^A-Za-z0-9._-]/g, "_");
  return `detached-${gitShortSha(projectRoot) ?? "none"}`;
};
var runLocation = (projectRoot) => {
  const branch = branchDirName(projectRoot);
  const dir = join7(jigPaths(projectRoot).runs, branch);
  return { branch, data: join7(dir, "run.json"), page: join7(dir, "index.html") };
};
var isRun = (value) => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return candidate.v === 1 && typeof candidate.updatedAt === "string" && Array.isArray(candidate.steps);
};
var readRun = (path) => {
  let text2;
  try {
    text2 = readFileSync9(path, "utf8");
  } catch {
    return void 0;
  }
  const value = JSON.parse(text2);
  return isRun(value) ? value : void 0;
};
var isActive = (run3, now) => now.getTime() - Date.parse(run3.updatedAt) < ACTIVE_RUN_MAX_AGE_MS;
var readActiveRun = (projectRoot, now = /* @__PURE__ */ new Date()) => {
  const location = runLocation(projectRoot);
  const run3 = readRun(location.data);
  if (run3 === void 0 || !isActive(run3, now)) return void 0;
  return { run: run3, page: toSlash(location.page) };
};
var currentStep = (run3) => {
  for (const status of CURRENT_STEP_ORDER) {
    const step = run3.steps.find((candidate) => candidate.status === status);
    if (step) return step;
  }
  return run3.steps.at(-1);
};
var activeRunContext = (projectRoot, now = /* @__PURE__ */ new Date()) => {
  const active = readActiveRun(projectRoot, now);
  if (active === void 0) return void 0;
  const step = currentStep(active.run);
  const stepPart = step ? `step ${step.n} "${step.title}"` : "no steps";
  return `jig: flow run "${active.run.title}", ${stepPart}, dashboard ${active.page}`;
};
var renderPage = (run3) => {
  const json = JSON.stringify(run3, null, 2).replace(/</g, "\\u003c");
  return template_default.replace(RUN_BLOCK, (_match, open, _body, close) => `${open}
${json}
${close}`);
};
var saveRun = (location, run3) => {
  mkdirSync7(dirname6(location.data), { recursive: true });
  writeFileAtomic(location.data, `${JSON.stringify(run3, null, 2)}
`);
  writeFileAtomic(location.page, renderPage(run3));
};
var required2 = (value, what) => {
  if (value === void 0 || value === "") throw usage(`${what} is required`);
  return value;
};
var parseNumber = (value, what) => {
  const text2 = required2(value, what);
  const n = Number(text2);
  if (!Number.isInteger(n) || n < 1) throw new DashFailure(EXIT_NOT_MET, `${what} must be a positive integer, got ${text2}`);
  return n;
};
var stepAt = (run3, n) => {
  const step = run3.steps.find((candidate) => candidate.n === n);
  if (step === void 0) throw new DashFailure(EXIT_NOT_MET, `no step ${n}, the run has ${run3.steps.length}`);
  return step;
};
var nextNumber = (items) => items.reduce((max, item) => Math.max(max, item.n), 0) + 1;
var setStep = (run3, [nText, status, waitsFor], at) => {
  const step = stepAt(run3, parseNumber(nText, "step number"));
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
var addStep = (run3, [title], at) => {
  run3.steps.push({ n: nextNumber(run3.steps), title: required2(title, "step title"), status: "todo", at });
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
var addRunDecision = (projectRoot, text2, why, details = {}, now = /* @__PURE__ */ new Date()) => {
  const location = runLocation(projectRoot);
  const run3 = readRun(location.data);
  if (run3 === void 0 || !isActive(run3, now)) return false;
  const at = now.toISOString();
  run3.decisions.push({
    n: nextNumber(run3.decisions),
    text: required2(text2, "decision text"),
    ...why === void 0 ? {} : { why },
    ...details.evidence === void 0 ? {} : { evidence: details.evidence },
    ...details.result === void 0 ? {} : { result: details.result },
    at
  });
  run3.updatedAt = at;
  saveRun(location, run3);
  return true;
};
var recordDecision = (projectRoot, location, [text2, ...rest], now) => {
  const flags = parseDecisionFlags(rest);
  const evidence = flags.get("--evidence");
  const result = flags.get("--result");
  if (result !== void 0 && !DECISION_RESULTS.has(result)) throw usage(`--result must be kept or reverted, got ${result}`);
  const details = {
    ...evidence === void 0 ? {} : { evidence },
    ...result === void 0 ? {} : { result }
  };
  if (!addRunDecision(projectRoot, required2(text2, "decision text"), flags.get("--why"), details, now)) throw noActiveRun(location);
  return "ok";
};
var addResult = (run3, [title, href], at) => {
  run3.results.push({ title: required2(title, "result title"), ...href ? { href } : {}, at });
  return "ok";
};
var addAsk = (run3, [question, fallback], at) => {
  const n = nextNumber(run3.asks);
  run3.asks.push({ n, question: required2(question, "question"), default: required2(fallback, "default answer"), askedAt: at });
  return String(n);
};
var answerAsk = (run3, [nText, answer], at) => {
  const n = parseNumber(nText, "question number");
  const text2 = required2(answer, "answer");
  const ask = run3.asks.find((candidate) => candidate.n === n && candidate.answer === void 0);
  if (ask === void 0) throw new DashFailure(EXIT_NOT_MET, `no open question ${n}`);
  ask.answer = text2;
  ask.answeredAt = at;
  run3.decisions.push({ n: nextNumber(run3.decisions), text: `${ask.question} ${text2}`, at });
  return "ok";
};
var MUTATIONS = /* @__PURE__ */ new Map([
  ["step", setStep],
  ["add", addStep],
  ["result", addResult],
  ["ask", addAsk],
  ["answer", answerAsk]
]);
var sameShape = (run3, title, steps) => run3.title === title && run3.steps.length === steps.length && run3.steps.every((step, index) => step.title === steps[index]);
var isRunLang = (value) => RUN_LANGS.some((lang) => lang === value);
var parseLang = ([flag, value, ...rest]) => {
  if (flag !== "--lang") throw usage("init needs --lang <en|ru> first: the language the session is held in");
  if (!isRunLang(value)) throw usage(`--lang must be ${RUN_LANGS.join(" or ")}, got ${value ?? "nothing"}`);
  return { lang: value, rest };
};
var initRun = (projectRoot, location, args, now) => {
  const { lang, rest: [title, ...steps] } = parseLang(args);
  const runTitle = required2(title, "run title");
  if (steps.length === 0) throw usage("init needs at least one step");
  ensureJigDir(projectRoot);
  const at = now.toISOString();
  const existing = readRun(location.data);
  const isKept = existing !== void 0 && sameShape(existing, runTitle, steps);
  const run3 = isKept ? { ...existing, lang, updatedAt: at } : {
    v: 1,
    title: runTitle,
    lang,
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
  saveRun(location, run3);
  return toSlash(location.page);
};
var dispatch = (args, now) => {
  const [sub, ...rest] = args;
  const projectRoot = resolveProjectRoot(process.cwd());
  const location = runLocation(projectRoot);
  if (sub === "init") return initRun(projectRoot, location, rest, now);
  if (sub === "decision") return recordDecision(projectRoot, location, rest, now);
  const mutation = sub === void 0 ? void 0 : MUTATIONS.get(sub);
  if (sub !== "path" && mutation === void 0) {
    throw usage(`unknown dash subcommand ${sub ?? "(none)"}, expected init, step, add, decision, result, ask, answer or path`);
  }
  const run3 = readRun(location.data);
  if (run3 === void 0 || !isActive(run3, now)) throw noActiveRun(location);
  if (mutation === void 0) return toSlash(location.page);
  const at = now.toISOString();
  const output = mutation(run3, rest, at);
  run3.updatedAt = at;
  saveRun(location, run3);
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
import { existsSync as existsSync5, readFileSync as readFileSync12 } from "node:fs";
import { join as join10 } from "node:path";

// src/core/journal.ts
import { appendFileSync, mkdirSync as mkdirSync8, readdirSync as readdirSync4, readFileSync as readFileSync10, rmSync as rmSync3, statSync as statSync5 } from "node:fs";
import { join as join8 } from "node:path";
var JOURNAL_MAX_AGE_DAYS = 30;
var JOURNAL_MAX_BYTES = 50 * 1024 * 1024;
var JOURNAL_MESSAGE_MAX = 300;
var DAY_MS = 24 * 60 * 60 * 1e3;
var JOURNAL_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
var truncate = (text2) => text2.length <= JOURNAL_MESSAGE_MAX ? text2 : `${text2.slice(0, JOURNAL_MESSAGE_MAX - 1)}\u2026`;
var appendJournal = (projectRoot, entry) => {
  const record = { v: 1, ...entry, ts: entry.ts ?? (/* @__PURE__ */ new Date()).toISOString() };
  if (record.message !== void 0) {
    record.message = truncate(record.message);
  }
  const dir = jigPaths(projectRoot).journal;
  mkdirSync8(dir, { recursive: true });
  appendFileSync(join8(dir, `${record.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}
`);
  return record;
};
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
    const path = join8(dir, name);
    files.push({ name, path, day, size: statSync5(path).size });
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
    rmSync3(file.path, { force: true });
    removed.push(file.name);
  }
  let total = kept.reduce((sum, file) => sum + file.size, 0);
  for (const file of kept) {
    if (total <= JOURNAL_MAX_BYTES) break;
    rmSync3(file.path, { force: true });
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
    for (const line of readFileSync10(file.path, "utf8").split("\n")) {
      const record = line.trim() === "" ? void 0 : parseRecord(line);
      if (record !== void 0 && Date.parse(record.ts) >= sinceMs) {
        records.push(record);
      }
    }
  }
  return records;
};

// src/tiers/tiers.ts
import { existsSync as existsSync4, readFileSync as readFileSync11 } from "node:fs";
import { homedir } from "node:os";
import { join as join9 } from "node:path";
import { parseArgs } from "node:util";
var TIERS = ["deep", "standard", "fast"];
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
  const object = validator.object(value, path, TIERS);
  if (object === void 0) return void 0;
  const map = {};
  for (const tier of TIERS) {
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
  const path = override || join9(homedir(), ".jig", "config.jsonc");
  const label = override || DEFAULT_LABEL;
  if (!existsSync4(path)) return { path, label, config: emptyUserConfig() };
  return { path, label, ...parseUserConfig(readFileSync11(path, "utf8")) };
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
var tierEntries = (tiers) => TIERS.flatMap((tier) => {
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
var checkConfig = (projectRoot) => {
  const path = jigPaths(projectRoot).config;
  if (!existsSync5(path)) return ok(`config: ${path} absent, defaults apply`);
  const { error } = loadConfig(projectRoot);
  return error === void 0 ? ok(`config: ${path} valid`) : fail2(`config: ${path} invalid: ${error}`);
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
var firstExisting = (projectRoot, names) => names.map((name) => join10(projectRoot, name)).find((path) => existsSync5(path));
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
var checkRuntime = (tools) => CHECKS.map((check) => ok(`check ${check.name}: ${isCheckActive(check, tools) ? `active, proves ${Object.keys(check.hints).join(", ")}` : "not used"}`));
var checkGitignore = (projectRoot) => {
  const path = jigPaths(projectRoot).gitignore;
  return existsSync5(path) ? ok(`gitignore: ${path}`) : warn(`gitignore: ${path} missing, jig creates it on first run`);
};
var readDenyList = (path) => {
  const settings = parseJsonc(readFileSync12(path, "utf8"));
  const deny = settings?.permissions?.deny;
  return Array.isArray(deny) ? deny.filter((entry) => typeof entry === "string") : [];
};
var checkDeny = (projectRoot) => {
  const path = join10(projectRoot, ".claude", "settings.json");
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
  const text2 = `journal: ${(bytes / BYTES_PER_MB).toFixed(1)} MB in ${files.length} files`;
  return bytes > JOURNAL_MAX_BYTES ? warn(`${text2}, above ${JOURNAL_MAX_BYTES / BYTES_PER_MB} MB`) : ok(text2);
};
var checkLock = (path) => {
  if (!existsSync5(path)) return ok(`lock: ${path} free`);
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
    checkTiers(),
    ...PLAN_BINARIES.map((spec) => checkTool(projectRoot, tools, spec)),
    ...checkRuntime(tools),
    checkGitignore(projectRoot),
    checkDeny(projectRoot),
    ...checkAtomPaths(projectRoot, pluginRoot),
    checkJournal(projectRoot),
    checkLock(paths.heavyLock),
    checkLock(join10(paths.cache, "slot.lock"))
  ];
  process.stdout.write(`${checks.map(formatCheck).join("\n")}
`);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
};

// src/gates/stop.ts
import { createHash as createHash4 } from "node:crypto";

// src/core/snapshot.ts
import { createHash as createHash3 } from "node:crypto";
import { statSync as statSync6 } from "node:fs";
import { join as join11 } from "node:path";
var stampOf = (absolutePath) => {
  try {
    const stat = statSync6(absolutePath);
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
  return entries.map((entry) => toProjectPath(projectRoot, join11(top, entry.path))).filter(isInsideProject);
};
var takeSnapshot = (projectRoot) => {
  const snapshot = {};
  for (const path of changedFiles(projectRoot)) {
    const stamp = stampOf(join11(projectRoot, path));
    if (stamp !== void 0) {
      snapshot[path] = stamp;
    }
  }
  return snapshot;
};
var isSameStamp = (left, right) => left !== void 0 && left.mtimeMs === right.mtimeMs && left.size === right.size;
var diffFingerprint = (stamps) => {
  const lines = Object.keys(stamps).sort().map((path) => `${path}:${stamps[path]?.mtimeMs}:${stamps[path]?.size}`);
  return createHash3("sha1").update(lines.join("\n")).digest("hex");
};
var turnDiff = (projectRoot, snapshot, edits) => {
  const stamps = {};
  for (const { path } of edits) {
    const stamp = stampOf(join11(projectRoot, path));
    if (stamp !== void 0) {
      stamps[path] = stamp;
    }
  }
  for (const path of changedFiles(projectRoot)) {
    if (Object.hasOwn(stamps, path)) continue;
    const stamp = stampOf(join11(projectRoot, path));
    if (stamp === void 0 || isSameStamp(snapshot[path], stamp)) continue;
    stamps[path] = stamp;
  }
  const files = Object.keys(stamps).sort();
  return { files, stamps, fingerprint: diffFingerprint(stamps) };
};

// src/tools/finding.ts
var POST_EDIT_LINE_LIMIT = 15;
var STOP_LINE_LIMIT = 20;
var formatFinding = (finding) => `${finding.file}:${finding.line} ${finding.rule} \u2192 ${finding.fix ?? finding.message}`;
var formatDenial = (finding) => finding.message;
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

// src/gates/edit.ts
var EDIT_TOOL_TIMEOUT_MS = 5e3;
var ruleLevel = (plan, rule) => plan.config.rules[rule] ?? "error";
var applyLevel = (findings, level) => {
  if (level === "off") return [];
  if (level === "error") return [...findings];
  return findings.map((finding) => ({ ...finding, severity: "warn" }));
};
var editRun = async (tool, plan, projectRoot, file) => {
  const level = ruleLevel(plan, tool.rule);
  if (tool.edit === void 0 || level === "off") return void 0;
  const result = await tool.edit(plan.tools, projectRoot, file, EDIT_TOOL_TIMEOUT_MS);
  return result === void 0 ? void 0 : { ...result, findings: applyLevel(result.findings, level) };
};
var checkEdit = async (plan, projectRoot, file) => {
  if (!isCodeFile(file)) return [];
  const runs = await Promise.all(TOOLS.map((tool) => editRun(tool, plan, projectRoot, file)));
  return runs.filter((toolRun) => toolRun !== void 0);
};

// src/gates/stop.ts
var STOP_HARD_LIMIT_MS = 11e4;
var MAX_CONSECUTIVE_BLOCKS = 3;
var EXIT_FINDINGS = 1;
var EXIT_USAGE2 = 2;
var NONE = { type: "none" };
var SKIP_VERIFY = "skip-verify";
var isBlocking = (finding) => finding.severity === "error";
var failureNotes = (runs) => runs.filter((toolRun) => toolRun.failure !== void 0).map((toolRun) => ({ kind: "tool-failure", tool: toolRun.tool, message: toolRun.failure ?? "", durationMs: toolRun.durationMs }));
var timed = async (rule, body) => {
  const startedAt = Date.now();
  const { runs, findings } = await body();
  return { rule, runs, findings, durationMs: Date.now() - startedAt };
};
var createBudget = (startedAt) => (ownMs) => Math.max(0, Math.min(ownMs, startedAt + STOP_HARD_LIMIT_MS - Date.now()));
var toolStep = (tool, input, toolInput) => timed(tool.rule, async () => {
  const level = ruleLevel(input.plan, tool.rule);
  if (level === "off" || tool.stop === void 0) return { runs: [], findings: [] };
  const { runs, findings } = await tool.stop(input.plan.tools, toolInput);
  return { runs, findings: applyLevel(findings, level) };
});
var latestEdit = (diff, files, recorded) => Math.max(recorded ?? 0, ...files.map((file) => diff.stamps[file]?.mtimeMs ?? 0));
var jigFinding = (rule, file, message) => ({
  tool: "jig",
  rule,
  severity: "error",
  file,
  line: 1,
  message
});
var skipScope = (text2) => {
  if (!text2.startsWith(SKIP_VERIFY)) return void 0;
  const rest = text2.slice(SKIP_VERIFY.length);
  if (!rest.startsWith(":")) return "all";
  const named = rest.slice(1).split(/\s/)[0];
  return PROOF_KINDS.find((kind) => kind === named);
};
var readSkipDecisions = (projectRoot) => {
  const active = readActiveRun(projectRoot);
  if (active === void 0) return [];
  const skips = [];
  for (const decision of active.run.decisions) {
    const scope = skipScope(decision.text);
    if (scope !== void 0 && (decision.why ?? "").trim() !== "") {
      skips.push({ scope, at: Date.parse(decision.at) });
    }
  }
  return skips;
};
var isSkipped = (skips, kind, since) => skips.some((skip) => (skip.scope === "all" || skip.scope === kind) && skip.at > since);
var missingProofs = (check, input, times, skips, notes) => {
  const recorded = times.checks[check.name] ?? {};
  const missing = [];
  for (const kind of PROOF_KINDS) {
    const files = input.diff.files.filter((file) => check.requires(file).includes(kind));
    const [first] = files;
    if (first === void 0) continue;
    const editAt = latestEdit(input.diff, files, recorded[kind]?.editAt);
    const proofAt = recorded[kind]?.proofAt;
    if (proofAt !== void 0 && proofAt >= editAt) continue;
    if (isSkipped(skips(), kind, editAt)) {
      notes.push({ kind: "skip-verify", tool: "jig", rule: "jig/verify-fact", file: first, message: `${check.name} ${kind}` });
      continue;
    }
    missing.push({ kind, files });
  }
  return missing;
};
var verifyFactMessage = (check, missing, pluginRoot) => {
  const files = [...new Set(missing.flatMap((proof) => proof.files))];
  const skip = `node ${toSlash(pluginRoot)}/bin/jig.mjs dash decision`;
  const options = missing.map((proof) => {
    const hint = check.hints[proof.kind];
    const run3 = hint === void 0 ? "" : `run ${hint}, or `;
    return `${proof.kind}: ${run3}if not needed: ${skip} "skip-verify:${proof.kind}" --why "<reason>".`;
  });
  return [
    `jig/verify-fact: ${check.name} has no ${missing.map((proof) => proof.kind).join(" and ")} proof since files changed (${files.length}: ${files.slice(0, 3).join(", ")}).`,
    ...options,
    `To skip all: ${skip} "skip-verify" --why "<reason>".`
  ].join(" ");
};
var verifyFactFindings = (input, times, notes) => {
  let skips;
  const loadSkips = () => skips ??= readSkipDecisions(input.projectRoot);
  const findings = [];
  for (const check of CHECKS.filter((candidate) => isCheckActive(candidate, input.plan.tools))) {
    const missing = missingProofs(check, input, times, loadSkips, notes);
    const [first] = missing.flatMap((proof) => proof.files);
    if (first === void 0) continue;
    findings.push(jigFinding("jig/verify-fact", first, verifyFactMessage(check, missing, input.pluginRoot)));
  }
  return applyLevel(findings, ruleLevel(input.plan, "jig/verify-fact"));
};
var stateStep = (rule, findings) => timed(rule, () => Promise.resolve({ runs: [], findings: findings() }));
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
      for (const tool of TOOLS.filter((candidate) => candidate.stop !== void 0)) {
        if (isStopped()) break;
        steps.push(await toolStep(tool, input, toolInput));
      }
    } finally {
      if (!lock.isTransferred) {
        acquired.release();
      }
    }
  }
  const times = input.times;
  if (times !== void 0 && !isStopped()) {
    steps.push(await stateStep("jig/verify-fact", () => verifyFactFindings(input, times, notes)));
  }
  const findings = steps.flatMap((step) => step.findings);
  notes.push(...failureNotes(steps.flatMap((step) => step.runs)));
  return { steps, findings, blocking: findings.filter(isBlocking), notes, durationMs: Date.now() - startedAt };
};
var findingsFingerprint = (findings) => createHash4("sha1").update(collapseFindings(findings).sort().join("\n")).digest("hex");
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
    addRunDecision(projectRoot, "gate unresolved", UNRESOLVED_WHY);
    return { outcome: NONE, notes: [{ kind: "gate-unresolved", tool: "jig", message: UNRESOLVED_WHY }] };
  }
  const plan = loadPlan(projectRoot, pluginRoot);
  const checks = await runStopChecks({ projectRoot, pluginRoot, plan, diff, times: state });
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
import { readFileSync as readFileSync14 } from "node:fs";
import { join as join14 } from "node:path";

// src/adapters/claude.ts
import { readFileSync as readFileSync13 } from "node:fs";
import { isAbsolute as isAbsolute3, resolve as resolve6 } from "node:path";
var SESSION_SOURCES = ["startup", "resume", "clear", "compact", "fork"];
var HOOK_EVENT_NAMES = {
  "session-start": "SessionStart",
  prompt: "UserPromptSubmit",
  "pre-edit": "PreToolUse",
  "pre-bash": "PreToolUse",
  "post-edit": "PostToolUse",
  "post-read": "PostToolUse",
  "post-bash": "PostToolUse",
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
    return readFileSync13(absolutePath, "utf8");
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
  const absolute = isAbsolute3(rawFile) ? rawFile : resolve6(paths.cwd, rawFile);
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
var isBashSuccess = (response) => {
  if (!isObject2(response)) return true;
  const exitCode = response["exit_code"] ?? response["exitCode"];
  const hasFailedExit = typeof exitCode === "number" && exitCode !== 0;
  return response["interrupted"] !== true && response["is_error"] !== true && !hasFailedExit;
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
    case "pre-bash": {
      const command = text(toolInput, "command");
      return command === void 0 ? void 0 : { kind: "pre-bash", command };
    }
    case "post-edit":
    case "post-read": {
      const file = toolFile(toolInput, paths);
      return file === void 0 ? void 0 : { kind: name, file };
    }
    case "post-bash": {
      const command = text(toolInput, "command");
      return command === void 0 ? void 0 : { kind: "post-bash", command, ok: isBashSuccess(input["tool_response"]) };
    }
    case "subagent-start": {
      const agentId = text(input, "agent_id");
      if (agentId === void 0) return void 0;
      return { kind: "subagent-start", agentId, agentType: text(input, "agent_type") ?? "" };
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
  const cwd = resolve6(text(input, "cwd") ?? process.cwd());
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

// src/rules/comments.ts
import { join as join12 } from "node:path";

// src/rules/lexer.ts
var SCRIPT_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
var VUE_EXTENSION = /\.vue$/i;
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
var EXPORT_MODIFIERS = /* @__PURE__ */ new Set(["default", "abstract", "declare", "const"]);
var EXPORT_BODY_KEYWORDS = /* @__PURE__ */ new Set(["class", "interface", "enum"]);
var countNewlines = (text2, from, to) => {
  let count = 0;
  for (let index = from; index < to; index++) {
    if (text2[index] === "\n") {
      count++;
    }
  }
  return count;
};
var ExportBodyTracker = class {
  state = "none";
  bodyDepth;
  word(word, depth) {
    if (depth !== 0) return;
    if (word === "export") {
      this.state = "modifiers";
      return;
    }
    if (this.state === "type-value") {
      this.state = "none";
      return;
    }
    if (this.state !== "modifiers") return;
    if (EXPORT_MODIFIERS.has(word)) return;
    if (word === "type") {
      this.state = "type-name";
      return;
    }
    this.state = EXPORT_BODY_KEYWORDS.has(word) ? "declaration" : "none";
  }
  punctuator(char, depth) {
    if (char === "{" && depth === 1) {
      const isBodyOpen = this.state === "declaration" || this.state === "type-value";
      this.bodyDepth = isBodyOpen ? depth : this.bodyDepth;
      this.state = "none";
      return;
    }
    if (this.bodyDepth !== void 0 && depth < this.bodyDepth) {
      this.bodyDepth = void 0;
    }
    if (depth !== 0 || char === "{") return;
    if (this.state === "type-name" && char === "=") {
      this.state = "type-value";
      return;
    }
    const isTypeParameter = this.state === "type-name" || this.state === "declaration";
    if (char === ";" || !isTypeParameter) {
      this.state = "none";
    }
  }
  other() {
    if (this.state === "type-value" || this.state === "modifiers") {
      this.state = "none";
    }
  }
  isMember(depth) {
    return this.bodyDepth !== void 0 && depth === this.bodyDepth;
  }
};
var JsLexer = class {
  constructor(source, end, start, firstLine2) {
    this.source = source;
    this.end = end;
    this.index = start;
    this.line = firstLine2;
  }
  source;
  end;
  index = 0;
  line;
  isRegexAllowed = true;
  isInTemplate = false;
  templateDepths = [];
  braceDepth = 0;
  exportBody = new ExportBodyTracker();
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
      this.exportBody.other();
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
    const isInterpolationEnd = this.updateTemplateDepth(char);
    if (char === "{") {
      this.braceDepth++;
    } else if (char === "}" && !isInterpolationEnd) {
      this.braceDepth--;
    }
    this.exportBody.punctuator(char, this.braceDepth);
  }
  updateTemplateDepth(char) {
    const top = this.templateDepths.length - 1;
    const depth = this.templateDepths[top];
    if (depth === void 0) return false;
    if (char === "{") {
      this.templateDepths[top] = depth + 1;
      return false;
    }
    if (char !== "}") return false;
    if (depth > 0) {
      this.templateDepths[top] = depth - 1;
      return false;
    }
    this.templateDepths.pop();
    this.isInTemplate = true;
    return true;
  }
  isExportMember() {
    return this.templateDepths.length === 0 && this.exportBody.isMember(this.braceDepth);
  }
  scanWord() {
    const start = this.index;
    while (this.index < this.end && IDENTIFIER_PART.test(this.at())) {
      this.index++;
    }
    const word = this.source.slice(start, this.index);
    this.isRegexAllowed = REGEX_KEYWORDS.has(word);
    this.exportBody.word(word, this.braceDepth);
  }
  scanNumber() {
    this.exportBody.other();
    while (this.index < this.end && NUMBER_PART.test(this.at())) {
      this.index++;
    }
    this.isRegexAllowed = false;
  }
  scanString(quote) {
    this.exportBody.other();
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
    this.comments.push({ text: text2, line: this.line, kind: "line", start, end: this.index, isExportMember: this.isExportMember() });
  }
  scanBlockComment() {
    const start = this.index;
    const line = this.line;
    const close = this.source.indexOf("*/", start + 2);
    const stop2 = close === -1 || close + 2 > this.end ? this.end : close + 2;
    this.line += countNewlines(this.source, start, stop2);
    this.index = stop2;
    const text2 = this.source.slice(start, stop2);
    this.comments.push({ text: text2, line, kind: "block", start, end: stop2, isExportMember: this.isExportMember() });
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
    this.exportBody.other();
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
    comments.push({ text: match[0], line: lineAt(source, match.index), kind: "block", start: match.index, end, isExportMember: false });
  }
  return comments.sort((left, right) => left.end - right.end);
};
var lexComments = (file, source) => {
  if (SCRIPT_EXTENSION.test(file)) return lexJs(source);
  if (VUE_EXTENSION.test(file)) return lexVue(source);
  return void 0;
};

// src/rules/rule.ts
var fileLine = (edit, fragmentLine) => fragmentLine + (edit.line ?? 1) - 1;
var activeSeverity = (config, rule) => {
  const severity = config.rules[rule];
  return severity === "off" ? void 0 : severity;
};
var jigFinding2 = (rule, severity, hit) => ({
  tool: "jig",
  rule,
  severity,
  ...hit
});

// src/rules/suppressions.ts
var RULE = "jig/suppressions";
var DIRECTIVES = [
  /\beslint-disable(?:-next-line|-line)?\b/,
  /\boxlint-disable(?:-next-line|-line)?\b/,
  /\bbiome-ignore\b/,
  /@ts-(?:ignore|expect-error|nocheck)\b/,
  /\bstratum-ignore\b/
];
var LINE_BREAK = /\r?\n/;
var findDirective = (line) => {
  for (const directive of DIRECTIVES) {
    const match = directive.exec(line);
    if (match !== null) return match[0];
  }
  return void 0;
};
var checkSuppressions = (file, edits, config) => {
  const severity = activeSeverity(config, RULE);
  if (severity === void 0) return [];
  const existing = new Set(edits.flatMap((edit) => edit.before.split(LINE_BREAK).map((line) => line.trim())));
  const findings = [];
  for (const edit of edits) {
    edit.after.split(LINE_BREAK).forEach((text2, index) => {
      if (existing.has(text2.trim())) return;
      const directive = findDirective(text2);
      if (directive === void 0) return;
      const line = fileLine(edit, index + 1);
      const message = `${RULE}: "${directive}" at ${file}:${line} silences a check. Fix the cause instead; only a human adds suppressions.`;
      findings.push(jigFinding2(RULE, severity, { file, line, message }));
    });
  }
  return findings;
};

// src/rules/comments.ts
var RULE2 = "jig/comments";
var LICENSE_HEADER_LINES = 15;
var LICENSE = /SPDX-License-Identifier|copyright|license/i;
var TICKET_TODO = /^\s*(?:\/\/+|\/\*+|\*)?\s*TODO\((?:[A-Z][A-Z0-9]+-\d+|#\d+)\):\s*\S/;
var LINE_BREAK2 = /\r?\n/;
var COMMENT_PREFIX = /^\s*(?:\/\/+|\/\*+|\*+)/;
var COMMENT_CLOSE = /\*+\/\s*$/;
var SUPPRESSION_PAIR = /\beslint-enable\b/;
var isSuppression = (text2) => findDirective(text2) !== void 0 || SUPPRESSION_PAIR.test(text2);
var EXTERNAL_LINK = /https?:\/\//;
var TOOL_DIRECTIVES = [
  /^\s*\/\/\/\s*<reference\b/,
  /@stratum-purity\s+\d/,
  /@vite-ignore/,
  /webpack[A-Z]\w*\s*:/,
  /[@#]__PURE__/
];
var DECORATOR_NAME = /^@[\w$.]+/;
var EXPORT_KEYWORD = /^export\b/;
var LEADING_WHITESPACE = /^\s+/;
var normalize = (text2) => text2.replace(/\s+/g, " ").trim();
var skipParentheses = (source, start) => {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
};
var isFollowedByExport = (source, end) => {
  let rest = source.slice(end);
  for (; ; ) {
    rest = rest.replace(LEADING_WHITESPACE, "");
    const decorator = DECORATOR_NAME.exec(rest);
    if (decorator === null) return EXPORT_KEYWORD.test(rest);
    rest = rest.slice(decorator[0].length);
    if (rest.startsWith("(")) {
      rest = rest.slice(skipParentheses(rest, 0));
    }
  }
};
var firstContentLine = (text2) => text2.split(LINE_BREAK2).map((line) => line.replace(COMMENT_CLOSE, "").replace(COMMENT_PREFIX, "").trim()).find((line) => line !== "") ?? "";
var isAllowed = (comment, source) => {
  const { text: text2 } = comment;
  const isLicense = comment.line <= LICENSE_HEADER_LINES && LICENSE.test(text2);
  const isJsDoc = comment.kind === "block" && text2.startsWith("/**");
  const isPublicJsDoc = isJsDoc && (comment.isExportMember || isFollowedByExport(source, comment.end));
  return isLicense || isSuppression(text2) || TICKET_TODO.test(firstContentLine(text2)) || isPublicJsDoc || EXTERNAL_LINK.test(text2) || TOOL_DIRECTIVES.some((directive) => directive.test(text2));
};
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
var addedComments = (file, edit) => {
  if (edit.prefix === void 0) {
    const located = (comment) => ({ comment, line: fileLine(edit, comment.line), source: edit.after });
    return (lexComments(file, edit.after) ?? []).map(located);
  }
  const { prefix } = edit;
  const source = prefix + edit.after;
  return (lexComments(file, source) ?? []).filter((comment) => comment.start >= prefix.length).map((comment) => ({ comment, line: comment.line, source }));
};
var checkComments = (file, edits, config) => {
  const severity = activeSeverity(config, RULE2);
  if (severity === void 0) return [];
  if (lexComments(file, "") === void 0) return [];
  const existing = countExisting(file, edits);
  const atom = toSlash(join12(resolvePluginRoot(), "atoms", "comments.md"));
  const findings = [];
  for (const edit of edits) {
    for (const { comment, line, source } of addedComments(file, edit)) {
      const key = normalize(comment.text);
      const remaining = existing.get(key) ?? 0;
      if (remaining > 0) {
        existing.set(key, remaining - 1);
        continue;
      }
      if (isAllowed({ ...comment, line }, source)) continue;
      const message = `${RULE2}: new comment at ${file}:${line} is not allowed. Allowed: license header, TODO(<TICKET-1>), JSDoc on an export, an external constraint with a link, a tool directive. Remove it and express the intent in code (atom comments: ${atom}).`;
      findings.push(jigFinding2(RULE2, severity, { file, line, message }));
    }
  }
  return findings;
};

// src/rules/no-verify.ts
import { createHash as createHash5 } from "node:crypto";
import { join as join13 } from "node:path";

// src/rules/shell.ts
var SEGMENT_BREAKS = /* @__PURE__ */ new Set([";", "&", "|", "\n", "(", ")"]);
var BLANK = /\s/;
var FD_NUMBER = /^\d+$/;
var FD_TARGET = /[\d-]/;
var ShellTokenizer = class {
  constructor(command) {
    this.command = command;
  }
  command;
  index = 0;
  token = "";
  hasToken = false;
  isTokenQuoted = false;
  isRedirectNext = false;
  segment = { words: [], redirects: [] };
  segments = [];
  run() {
    while (this.index < this.command.length) {
      this.step(this.command[this.index] ?? "");
    }
    this.endSegment();
    return this.segments;
  }
  step(char) {
    if (char === '"' || char === "'") {
      this.scanQuoted(char);
      return;
    }
    if (char === ">" || char === "&" && this.command[this.index + 1] === ">") {
      this.scanRedirect();
      return;
    }
    this.index++;
    if (SEGMENT_BREAKS.has(char)) {
      this.endSegment();
      return;
    }
    if (BLANK.test(char) || char === "<") {
      this.endToken();
      return;
    }
    this.token += char;
    this.hasToken = true;
  }
  scanQuoted(quote) {
    this.index++;
    this.hasToken = true;
    this.isTokenQuoted = true;
    while (this.index < this.command.length && this.command[this.index] !== quote) {
      const isEscape = quote === '"' && this.command[this.index] === "\\" && this.index + 1 < this.command.length;
      if (isEscape) {
        this.index++;
      }
      this.token += this.command[this.index];
      this.index++;
    }
    this.index++;
  }
  scanRedirect() {
    const isFdPrefix = this.hasToken && !this.isTokenQuoted && FD_NUMBER.test(this.token);
    if (isFdPrefix) {
      this.resetToken();
    } else {
      this.endToken();
    }
    if (this.command[this.index] === "&") {
      this.index++;
    }
    while (this.command[this.index] === ">") {
      this.index++;
    }
    if (this.command[this.index] !== "&") {
      this.isRedirectNext = true;
      return;
    }
    this.index++;
    while (FD_TARGET.test(this.command[this.index] ?? "")) {
      this.index++;
    }
  }
  resetToken() {
    this.token = "";
    this.hasToken = false;
    this.isTokenQuoted = false;
  }
  endToken() {
    if (this.hasToken) {
      const target = this.isRedirectNext ? this.segment.redirects : this.segment.words;
      target.push(this.token);
      this.isRedirectNext = false;
    }
    this.resetToken();
  }
  endSegment() {
    this.endToken();
    this.isRedirectNext = false;
    const isEmpty = this.segment.words.length === 0 && this.segment.redirects.length === 0;
    if (!isEmpty) {
      this.segments.push(this.segment);
    }
    this.segment = { words: [], redirects: [] };
  }
};
var splitShell = (command) => new ShellTokenizer(command).run();

// src/rules/no-verify.ts
var RULE3 = "jig/no-verify";
var ALLOWANCE_MS = 10 * 60 * 1e3;
var SESSION_ENV = "CLAUDE_CODE_SESSION_ID";
var HUSKY_OFF = /^(?:\$env:)?(?:HUSKY=0|HUSKY_SKIP_HOOKS=1)$/;
var GIT_BINARY = /(?:^|[/\\])git(?:\.exe)?$/i;
var HOOKS_PATH_KEY = /^core\.hookspath(?:=|$)/i;
var COMMIT_ARGUMENT_OPTIONS = /* @__PURE__ */ new Set(["m", "F", "C", "c", "t"]);
var SHORT_CLUSTER = /^-[A-Za-z]+$/;
var ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
var OUTPUT_TOKEN = /[^\s'"`()<>,;[\]{}]+/g;
var LOCATION_SUFFIX = /(?::\d+)+:?$|[:.]+$/;
var isNoVerifyCluster = (token) => {
  if (!SHORT_CLUSTER.test(token)) return false;
  for (const flag of token.slice(1)) {
    if (flag === "n") return true;
    if (COMMIT_ARGUMENT_OPTIONS.has(flag)) return false;
  }
  return false;
};
var takesValue = (token) => SHORT_CLUSTER.test(token) && COMMIT_ARGUMENT_OPTIONS.has(token.slice(-1)) && !isNoVerifyCluster(token);
var commitSkipsHooks = (args) => {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") return false;
    if (arg === "--no-verify" || isNoVerifyCluster(arg)) return true;
    if (takesValue(arg)) {
      index++;
    }
  }
  return false;
};
var gitBypass = (tokens) => {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "-c" || token === "-C") {
      const value = tokens[index + 1] ?? "";
      if (token === "-c" && HOOKS_PATH_KEY.test(value)) return "other";
      index += 2;
      continue;
    }
    if (token.startsWith("-")) {
      index++;
      continue;
    }
    break;
  }
  const subcommand = tokens[index];
  const args = tokens.slice(index + 1);
  if (subcommand === "config" && args.some((arg) => HOOKS_PATH_KEY.test(arg))) return "other";
  if (subcommand === "push" && args.includes("--no-verify")) return "other";
  if (subcommand === "commit" && commitSkipsHooks(args)) return "commit";
  return void 0;
};
var segmentBypass = (tokens) => {
  if (tokens.some((token) => HUSKY_OFF.test(token))) return "other";
  let result;
  tokens.forEach((token, index) => {
    if (result === "other" || !GIT_BINARY.test(token)) return;
    result = gitBypass(tokens.slice(index + 1)) ?? result;
  });
  return result;
};
var detectBypass = (command) => {
  let result;
  for (const segment of splitShell(command)) {
    const bypass = segmentBypass(segment.words);
    if (bypass === "other") return bypass;
    result = bypass ?? result;
  }
  return result;
};
var stagedHash = (files) => createHash5("sha256").update([...files].sort().join("\n")).digest("hex");
var consumeAllowance = (projectRoot, sessionId, now) => {
  const state = readState(projectRoot, sessionId);
  const allowance = state?.noVerifyAllowance;
  if (state === void 0 || allowance === void 0) return false;
  const isValid = !allowance.used && allowance.until > now && allowance.stagedHash === stagedHash(gitStagedFiles(projectRoot));
  if (!isValid) return false;
  state.noVerifyAllowance = { ...allowance, used: true };
  writeState(projectRoot, state);
  return true;
};
var jigCommand = () => toSlash(join13(resolvePluginRoot(), "bin", "jig.mjs"));
var checkNoVerify = (command, ctx) => {
  const severity = activeSeverity(ctx.config, RULE3);
  if (severity === void 0) return void 0;
  const bypass = detectBypass(command);
  if (bypass === void 0) return void 0;
  if (bypass === "commit" && consumeAllowance(ctx.projectRoot, ctx.sessionId, Date.now())) return void 0;
  const message = `${RULE3}: commits keep their hooks. If the pre-commit fails only on files outside your change, run: node ${jigCommand()} allow-no-verify`;
  return jigFinding2(RULE3, severity, { file: "", line: 1, message });
};
var findRepoPaths = (output, projectRoot, tracked) => {
  const root = `${toSlash(projectRoot).toLowerCase()}/`;
  const found = /* @__PURE__ */ new Set();
  for (const [raw] of toSlash(output.replace(ANSI, "")).matchAll(OUTPUT_TOKEN)) {
    let candidate = raw.replace(LOCATION_SUFFIX, "").replace(/^\.\//, "");
    if (candidate.toLowerCase().startsWith(root)) {
      candidate = candidate.slice(root.length);
    }
    if (tracked.has(candidate)) {
      found.add(candidate);
    }
  }
  return [...found].sort();
};
var print = (text2) => {
  process.stdout.write(`${text2}
`);
};
var recordAllowed = (projectRoot, sessionId, paths) => {
  try {
    appendJournal(projectRoot, { session: sessionId, agent: MAIN_AGENT, kind: "no-verify-allowed", rule: RULE3, message: paths.join(", ") });
  } catch (error) {
    process.stderr.write(`jig: journal write failed (${error instanceof Error ? error.message : String(error)})
`);
  }
};
var runAllowNoVerify = () => {
  const projectRoot = resolveProjectRoot(process.cwd());
  const sessionId = process.env[SESSION_ENV];
  if (!sessionId) {
    print(`jig: ${SESSION_ENV} is not set; run allow-no-verify from the agent session`);
    return 1;
  }
  const state = readState(projectRoot, sessionId);
  if (state === void 0) {
    print(`jig: no jig state for session ${sessionId}`);
    return 1;
  }
  const staged = gitStagedFiles(projectRoot);
  if (staged.length === 0) {
    print("jig: nothing staged");
    return 1;
  }
  const hook = git(["hook", "run", "pre-commit"], projectRoot);
  if (hook.ok) {
    print("jig: pre-commit passes; commit without --no-verify");
    return 1;
  }
  const paths = findRepoPaths(`${hook.stdout}
${hook.stderr}`, projectRoot, new Set(gitLsFiles(projectRoot)));
  const stagedSet = new Set(staged);
  const failedStaged = paths.filter((path) => stagedSet.has(path));
  if (paths.length === 0 || failedStaged.length > 0) {
    const listed = failedStaged.length > 0 ? failedStaged.join(", ") : "no repository paths in the pre-commit output";
    print(`jig: pre-commit fails on your staged files, fix them: ${listed}`);
    return 1;
  }
  state.noVerifyAllowance = { stagedHash: stagedHash(staged), until: Date.now() + ALLOWANCE_MS, used: false };
  writeState(projectRoot, state);
  recordAllowed(projectRoot, sessionId, paths);
  print(`jig: --no-verify allowed for one commit within 10 minutes; pre-commit fails only outside your change: ${paths.join(", ")}`);
  return 0;
};

// src/rules/protected.ts
import { isAbsolute as isAbsolute4, posix } from "node:path";
var RULE4 = "jig/protected-paths";
var PROTECTED_GLOBS = [
  ".jig/config.jsonc",
  ".jig/config.json",
  "eslint.config.*",
  ".eslintrc",
  ".eslintrc.*",
  ".oxlintrc.json",
  "oxlint.json",
  "oxlintrc.json",
  "tsconfig*.json",
  "**/tsconfig*.json",
  "jsconfig*.json",
  "stratum.config.jsonc",
  "**/*stratum*baseline*",
  ".betterer.results",
  ".gitlab-ci.yml",
  ".gitlab/**",
  ".github/workflows/**",
  ".husky/**",
  "lefthook.yml",
  "lefthook.yaml",
  ".lintstagedrc",
  ".lintstagedrc.*",
  "lint-staged.config.*",
  ".claude/settings.json"
];
var ASSIGNMENT = /^[A-Za-z_]\w*=/;
var IN_PLACE_FLAG = /^-[A-Za-z]*i|^--in-place/;
var DESTINATION_FLAG = /^-dest/i;
var COMMAND_DIR = /^.*[/\\]/;
var EXE_SUFFIX = /\.exe$/;
var operands = (args) => args.filter((arg) => !arg.startsWith("-"));
var lastOperand = (args) => operands(args).slice(-1);
var inPlaceOperands = (args) => args.some((arg) => IN_PLACE_FLAG.test(arg)) ? operands(args) : [];
var gitTargets = (args) => {
  const subcommand = operands(args)[0];
  const rest = args.slice(args.indexOf(subcommand ?? "") + 1);
  if (subcommand === "restore") return operands(rest);
  if (subcommand !== "checkout" || !rest.includes("--")) return [];
  return rest.slice(rest.indexOf("--") + 1);
};
var copyItemTarget = (args) => {
  const flag = args.findIndex((arg) => DESTINATION_FLAG.test(arg));
  return flag === -1 ? lastOperand(args) : args.slice(flag + 1, flag + 2);
};
var WRITERS = {
  rm: operands,
  del: operands,
  truncate: operands,
  mv: operands,
  tee: operands,
  cp: lastOperand,
  sed: inPlaceOperands,
  perl: inPlaceOperands,
  git: gitTargets,
  "set-content": operands,
  "add-content": operands,
  "out-file": operands,
  "remove-item": operands,
  "move-item": operands,
  "copy-item": copyItemTarget
};
var NULL_TARGETS = /* @__PURE__ */ new Set(["/dev/null", "$null"]);
var isProtected = createMatcher(PROTECTED_GLOBS);
var writeTargets = (words) => {
  const start = words.findIndex((word) => !ASSIGNMENT.test(word));
  const name = (words[start] ?? "").replace(COMMAND_DIR, "").replace(EXE_SUFFIX, "").toLowerCase();
  const pick = Object.hasOwn(WRITERS, name) ? WRITERS[name] : void 0;
  return pick === void 0 ? [] : pick(words.slice(start + 1));
};
var denial = (path) => `${RULE4}: ${path} configures the checks and is protected. Do not change it; tell the user what change you need and why.`;
var pathSuffixes = (token) => {
  const parts = toSlash(token).replace(/^\.\//, "").split("/");
  return parts.map((_, index) => parts.slice(index).join("/")).filter(Boolean);
};
var protectedSuffix = (target) => pathSuffixes(target).find((suffix) => isProtected(suffix));
var insideProject = (path) => {
  const normalized = posix.normalize(toSlash(path));
  const isOutside = normalized === ".." || normalized.startsWith("../") || isAbsolute4(normalized);
  return isOutside ? void 0 : normalized.replace(/^\.\//, "");
};
var protectedInProject = (target, ctx) => {
  const path = insideProject(toProjectPath(ctx.projectRoot, target, ctx.cwd));
  return path !== void 0 && isProtected(path) ? path : void 0;
};
var checkProtectedPath = (file, config) => {
  const severity = activeSeverity(config, RULE4);
  const path = insideProject(file);
  if (severity === void 0 || path === void 0 || !isProtected(path)) return void 0;
  return jigFinding2(RULE4, severity, { file, line: 1, message: denial(file) });
};
var checkShellWrite = (command, config, ctx) => {
  const severity = activeSeverity(config, RULE4);
  if (severity === void 0) return void 0;
  for (const segment of splitShell(command)) {
    for (const target of [...segment.redirects, ...writeTargets(segment.words)]) {
      if (NULL_TARGETS.has(target)) continue;
      const path = ctx === void 0 ? protectedSuffix(target) : protectedInProject(target, ctx);
      if (path !== void 0) return jigFinding2(RULE4, severity, { file: path, line: 1, message: denial(path) });
    }
  }
  return void 0;
};

// src/hook/dispatch.ts
var NONE2 = { type: "none" };
var SUBAGENT_ATOM_LIMIT = 10;
var GUARDED_KINDS = /* @__PURE__ */ new Set(["pre-edit", "pre-bash"]);
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
var guardFailure = (ctx, error) => {
  journalFailure(ctx, error);
  const root = toSlash(ctx.pluginRoot);
  return {
    type: "deny",
    reason: `jig: guard failed (${errorMessage(error)}); the action is blocked. Run "node ${root}/bin/jig.mjs doctor" and report it`
  };
};
var trackTurn = (ctx, state) => {
  ctx.turn = state.turn;
  return state;
};
var openSession = (ctx) => trackTurn(ctx, readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, takeSnapshot(ctx.projectRoot)));
var deliverAtoms = (ctx, state, file) => {
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot);
  const delivered = state.delivered[ctx.agent] ?? [];
  const atoms = selectAtoms(plan.atoms, file, delivered);
  const names = [];
  const texts = [];
  for (const atom of atoms) {
    try {
      texts.push(formatAtomDelivery(atom, file));
      names.push(atom.name);
    } catch (error) {
      journalFailure(ctx, error);
    }
  }
  if (names.length === 0) return [];
  state.delivered[ctx.agent] = [...delivered, ...names];
  if (ctx.agent === MAIN_AGENT) {
    state.sessionAtoms = [...state.sessionAtoms.filter((name) => !names.includes(name)), ...names];
  }
  for (const name of names) {
    journal(ctx, { kind: "atom", tool: "jig", rule: name, file });
  }
  return texts;
};
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
  rotateJournal(ctx.projectRoot, now);
  const snapshot = takeSnapshot(ctx.projectRoot);
  const state = readState(ctx.projectRoot, ctx.sessionId) ?? createSessionState(ctx.sessionId, snapshot);
  resetSnapshot(state, snapshot);
  trackTurn(ctx, state);
  const parts = [];
  if (event.source === "compact") {
    state.delivered[MAIN_AGENT] = [];
    const runLine = compactRunLine(ctx, now);
    if (runLine !== void 0) {
      parts.push(runLine);
    }
  }
  writeState(ctx.projectRoot, state);
  if (plan.config.error !== void 0) {
    parts.push(`jig: .jig/config.jsonc is invalid (${plan.config.error}); defaults are used`);
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
var runOpenCheck = (ctx, check) => {
  try {
    return [check() ?? []].flat();
  } catch (error) {
    journalFailure(ctx, error);
    return [];
  }
};
var settleFindings = (ctx, findings) => {
  const denial2 = findings.find((finding) => finding.severity === "error");
  if (denial2 !== void 0) {
    journal(ctx, { kind: "deny", tool: "jig", rule: denial2.rule, file: denial2.file, line: denial2.line, message: denial2.message });
    return { type: "deny", reason: formatDenial(denial2) };
  }
  if (findings.length === 0) return NONE2;
  for (const finding of findings) {
    journal(ctx, { kind: "finding", tool: "jig", rule: finding.rule, file: finding.file, line: finding.line, message: finding.message });
  }
  try {
    const state = openSession(ctx);
    state.pendingWarnings = [...state.pendingWarnings, ...collapseFindings(findings)];
    writeState(ctx.projectRoot, state);
  } catch (error) {
    journalFailure(ctx, error);
  }
  return NONE2;
};
var runChecks = (ctx, guard, openChecks) => {
  let guarded;
  try {
    guarded = [guard() ?? []].flat();
  } catch (error) {
    return guardFailure(ctx, error);
  }
  const findings = [...guarded];
  for (const check of openChecks) {
    if (findings.some((finding) => finding.severity === "error")) break;
    findings.push(...runOpenCheck(ctx, check));
  }
  return settleFindings(ctx, findings);
};
var readCurrent2 = (path) => {
  try {
    return readFileSync14(path, "utf8");
  } catch {
    return "";
  }
};
var locateEdits = (event, projectRoot) => {
  if (event.wholeFile !== void 0) return event.edits.map((edit) => ({ ...edit, line: 1, prefix: "" }));
  const current = readCurrent2(join14(projectRoot, event.file));
  return event.edits.map((edit) => {
    const at = edit.before === "" ? -1 : current.indexOf(edit.before);
    if (at === -1) return edit;
    const prefix = current.slice(0, at);
    return { ...edit, line: prefix.split("\n").length, prefix };
  });
};
var preEdit = (event, ctx) => {
  let config;
  const guard = () => {
    config = loadConfig(ctx.projectRoot);
    return checkProtectedPath(event.file, config);
  };
  const withConfig = (check) => () => config === void 0 ? [] : check(config);
  const edits = locateEdits(event, ctx.projectRoot);
  return runChecks(ctx, guard, [
    withConfig((loaded) => checkSuppressions(event.file, edits, loaded)),
    withConfig((loaded) => checkComments(event.file, edits, loaded))
  ]);
};
var preBash = (event, ctx) => {
  let config;
  const guard = () => {
    config = loadConfig(ctx.projectRoot);
    return checkNoVerify(event.command, { projectRoot: ctx.projectRoot, sessionId: ctx.sessionId, config });
  };
  const shellWrite = () => config === void 0 ? void 0 : checkShellWrite(event.command, config, { projectRoot: ctx.projectRoot, cwd: ctx.cwd });
  return runChecks(ctx, guard, [shellWrite]);
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
  const parts = [];
  for (const check of CHECKS) {
    stampCheck(state, check.name, check.requires(event.file), "editAt", now);
  }
  const toolFindings = await editToolFindings(ctx, event.file);
  const toolLines = collapseFindings(toolFindings);
  const findingLines = [...toolLines, ...state.pendingWarnings];
  const shown = limitLines(findingLines, POST_EDIT_LINE_LIMIT, ctx.pluginRoot);
  const isTruncated = shown.length < findingLines.length;
  const toolShownCount = isTruncated ? Math.min(toolLines.length, POST_EDIT_LINE_LIMIT - 1) : toolLines.length;
  parts.push(...shown.slice(0, toolShownCount));
  parts.push(...deliverAtoms(ctx, state, event.file));
  parts.push(...shown.slice(toolShownCount));
  state.pendingWarnings = [];
  writeState(ctx.projectRoot, state);
  return contextOf(parts);
};
var postRead = (event, ctx) => {
  const state = openSession(ctx);
  const parts = deliverAtoms(ctx, state, event.file);
  if (parts.length === 0) return NONE2;
  writeState(ctx.projectRoot, state);
  return contextOf(parts);
};
var postBash = (event, ctx) => {
  if (!event.ok) return NONE2;
  const proofs = CHECKS.map((check) => ({ name: check.name, kinds: check.proves(event.command) })).filter((proof) => proof.kinds.length > 0);
  if (proofs.length === 0) return NONE2;
  const now = Date.now();
  const state = openSession(ctx);
  for (const proof of proofs) {
    stampCheck(state, proof.name, proof.kinds, "proofAt", now);
  }
  writeState(ctx.projectRoot, state);
  return NONE2;
};
var subagentStart = (ctx) => {
  const state = readState(ctx.projectRoot, ctx.sessionId);
  if (state === void 0 || state.sessionAtoms.length === 0) return NONE2;
  const plan = loadPlan(ctx.projectRoot, ctx.pluginRoot);
  const recent = state.sessionAtoms.slice(-SUBAGENT_ATOM_LIMIT);
  const atoms = recent.map((name) => plan.atoms.find((atom) => atom.name === name)).filter((atom) => atom !== void 0);
  if (atoms.length === 0) return NONE2;
  return { type: "context", text: formatSessionAtoms(atoms, ctx.pluginRoot) };
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
    case "pre-bash":
      return preBash(event, ctx);
    case "post-edit":
      return postEdit(event, ctx);
    case "post-read":
      return postRead(event, ctx);
    case "post-bash":
      return postBash(event, ctx);
    case "subagent-start":
      return subagentStart({ ...ctx, agent: event.agentId });
    case "stop":
      return stop(event, ctx);
  }
};
var dispatch2 = async (event, base, pluginRoot = resolvePluginRoot()) => {
  const ctx = { ...base, pluginRoot, agent: base.agentId ?? MAIN_AGENT };
  try {
    return await route(event, ctx);
  } catch (error) {
    if (GUARDED_KINDS.has(event.kind)) return guardFailure(ctx, error);
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

// src/loop/loop.ts
import { mkdirSync as mkdirSync9, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join15 } from "node:path";
var DEFAULT_DAYS = 7;
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var MIN_TURNS = 2;
var MAX_EXAMPLES = 3;
var SINGLE_RECORD_KINDS = /* @__PURE__ */ new Set(["gate-giveup", "gate-unresolved", "hook-failure", "tool-failure"]);
var DISTINCT_TURN_KINDS = /* @__PURE__ */ new Set(["deny", "finding", "gate-block"]);
var byTime = (left, right) => Date.parse(left.ts) - Date.parse(right.ts);
var turnKey = (record, index) => record.turn === void 0 ? `record:${index}` : JSON.stringify([record.session, record.turn]);
var isCandidate = (group) => {
  if (SINGLE_RECORD_KINDS.has(group.kind)) return true;
  return DISTINCT_TURN_KINDS.has(group.kind) && group.turns.size >= MIN_TURNS;
};
var compareCandidates = (left, right) => right.count - left.count || left.kind.localeCompare(right.kind) || (left.rule ?? "").localeCompare(right.rule ?? "") || (left.file ?? "").localeCompare(right.file ?? "");
var findCandidates = (records) => {
  const groups = /* @__PURE__ */ new Map();
  for (const [index, record] of [...records].sort(byTime).entries()) {
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
    group.turns.add(turnKey(record, index));
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
var formatLocation = (record) => {
  if (record.file === void 0) return void 0;
  return record.line === void 0 ? record.file : `${record.file}:${record.line}`;
};
var formatExample = (record) => {
  const location = formatLocation(record);
  const parts = [location === void 0 ? void 0 : `\`${location}\``, record.ts, record.message];
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
  for (const record of records) {
    counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
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
  const dir = join15(ensureJigDir(projectRoot).runs, "_loop", to.toISOString().slice(0, 10));
  mkdirSync9(dir, { recursive: true });
  const path = join15(dir, "candidates.md");
  writeFileSync5(path, formatCandidates(records, from, to, days));
  process.stdout.write(`${path}
`);
  return 0;
};

// src/slot/slot.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { cpSync, existsSync as existsSync6, mkdirSync as mkdirSync10, readdirSync as readdirSync5, readFileSync as readFileSync15, rmSync as rmSync4, writeFileSync as writeFileSync6 } from "node:fs";
import { basename as basename3, dirname as dirname7, isAbsolute as isAbsolute5, join as join16, relative as relative4, resolve as resolve7 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";
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
var print2 = (text2) => {
  process.stdout.write(`${text2}
`);
};
var escapeRegExp = (text2) => text2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var parseWorktreeList = (porcelain) => {
  const worktrees = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (pathLine === void 0) continue;
    const branchLine = lines.find((line) => line.startsWith("branch "));
    const worktree = {
      path: resolve7(pathLine.slice("worktree ".length)),
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
  const path = join16(dir, file);
  mkdirSync10(dirname7(path), { recursive: true });
  writeFileSync6(path, content);
  if (isTracked(dir, file)) {
    git(["update-index", "--skip-worktree", "--", file], dir);
  }
};
var insideDir = (dir, file) => {
  const path = resolve7(dir, file);
  const rel = relative4(dir, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute5(rel)) throw new Error(`path ${file} leaves the slot dir`);
  return path;
};
var copyFromMain = (mainRoot, dir, copyFiles) => {
  const rootEnvFiles = readdirSync5(mainRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && ENV_FILE.test(entry.name)).map((entry) => entry.name);
  for (const file of /* @__PURE__ */ new Set([...rootEnvFiles, ...copyFiles])) {
    const source = join16(mainRoot, file);
    if (!existsSync6(source)) {
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
    const text2 = existsSync6(path) ? readFileSync15(path, "utf8") : "";
    writeLocalFile(dir, port.target, setEnvValue(text2, key, String(port.base + slot * port.step)));
  }
};
var readJsonObject = (path) => {
  if (!existsSync6(path)) return {};
  const value = parseJsonc(readFileSync15(path, "utf8"));
  const isObject3 = typeof value === "object" && value !== null && !Array.isArray(value);
  return isObject3 ? value : {};
};
var writeAgentView = (mainRoot, dir, slots, cdpPort) => {
  const own = join16(dir, AGENT_VIEW_CONFIG2);
  const base = readJsonObject(existsSync6(own) ? own : join16(mainRoot, AGENT_VIEW_CONFIG2));
  writeLocalFile(dir, AGENT_VIEW_CONFIG2, `${JSON.stringify(agentViewConfig(base, slots, cdpPort), null, 2)}
`);
};
var branchExists = (cwd, branch) => git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd).ok;
var worktreeAddArgs = (cwd, dir, branch) => {
  if (branch === void 0) return ["worktree", "add", "--detach", dir];
  return branchExists(cwd, branch) ? ["worktree", "add", dir, branch] : ["worktree", "add", dir, "-b", branch];
};
var reserveSlot = async (context, slots, options) => {
  const lock = await acquireLock(join16(ensureJigDir(context.mainRoot).cache, SLOT_LOCK));
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
    const dir = resolve7(context.mainRoot, slots.worktreesDir, slotDirName(context.repo, slot, options.slug));
    const added = git(worktreeAddArgs(context.projectRoot, dir, options.branch), context.projectRoot);
    if (!added.ok) return fail3(`git worktree add failed: ${added.stderr.trim()}`, 2);
    return { slot, dir };
  } finally {
    lock.release();
  }
};
var runInstall = (install, dir) => spawnSync2(install, { cwd: dir, shell: true, windowsHide: true, stdio: ["ignore", 2, 2] }).status;
var slotNew = async (args) => {
  const { values } = parseArgs2({ args, options: { slug: { type: "string" }, branch: { type: "string" } }, strict: true });
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
  print2(`slot ${slot} ${toSlash(dir)} ports ${formatPorts(slotPorts(slots, slot))} cdp ${cdpPort ?? NO_VALUE}`);
  return 0;
};
var slotLs = (args) => {
  const { values } = parseArgs2({ args, options: { json: { type: "boolean" } }, strict: true });
  const context = loadContext();
  const rows = slotWorktrees(listWorktrees(context.projectRoot), context.repo).sort((left, right) => left.slot - right.slot).map((worktree) => ({
    slot: worktree.slot,
    path: toSlash(worktree.path),
    branch: worktree.branch ?? null,
    ports: context.slots === void 0 ? {} : slotPorts(context.slots, worktree.slot),
    cdp: context.slots === void 0 ? null : slotCdpPort(context.slots, worktree.slot) ?? null
  }));
  if (values.json === true) {
    print2(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const row of rows) {
    print2(`s${row.slot}  ${row.path}  ${row.branch ?? "(detached)"}  ports ${formatPorts(row.ports)}  cdp ${row.cdp ?? NO_VALUE}`);
  }
  return 0;
};
var slotRm = (args) => {
  const { values, positionals } = parseArgs2({
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
  print2(`removed ${toSlash(worktree.path)}`);
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
  const { values } = parseArgs2({ args, options: { json: { type: "boolean" } }, strict: true });
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
    print2(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const row of rows) {
    const slot = row.slot === null ? "" : `  slot ${row.slot}`;
    print2(`${row.bucket}  ${row.path}  ${row.branch ?? "(detached)"}${slot}`);
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
  ["hook", runHook],
  ["check", runCheck],
  ["build", runBuild],
  ["atom", runAtom],
  ["slot", runSlot],
  ["dash", runDash],
  ["loop", runLoop],
  ["allow-no-verify", runAllowNoVerify],
  ["doctor", runDoctor],
  ["tiers", runTiers],
  ["version", runVersion]
]);
var fail4 = (message) => {
  process.stderr.write(`jig: ${message}
`);
  return EXIT_FAILURE;
};
var run2 = async (argv) => {
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
process.exitCode = await run2(process.argv.slice(2));

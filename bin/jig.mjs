#!/usr/bin/env node

// package.json
var version = "0.1.0";

// src/cli/main.ts
var EXIT_FAILURE = 2;
var MIN_NODE_MAJOR = 20;
var runVersion = () => {
  process.stdout.write(`jig ${version}
`);
  return 0;
};
var commands = /* @__PURE__ */ new Map([
  ["version", runVersion]
]);
var fail = (message) => {
  process.stderr.write(`jig: ${message}
`);
  return EXIT_FAILURE;
};
var run = async (argv) => {
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  if (nodeMajor < MIN_NODE_MAJOR) {
    return fail(`Node >= ${MIN_NODE_MAJOR} required, found ${nodeVersion}`);
  }
  const [name, ...args] = argv;
  if (name === void 0) {
    return fail(`missing command, expected one of: ${[...commands.keys()].join(", ")}`);
  }
  const command = commands.get(name);
  if (command === void 0) {
    return fail(`unknown command ${name}`);
  }
  try {
    return await command(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  }
};
process.exitCode = await run(process.argv.slice(2));

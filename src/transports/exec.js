import { spawnSync } from "node:child_process";

export function buildCodexCommand(decision, options = {}) {
  const codexBin = options.codexBin ?? "codex";
  const prompt = requirePrompt(options.prompt);
  const args = [
    "exec",
    "-m",
    decision.model,
    "-c",
    `model_reasoning_effort="${decision.effort}"`
  ];

  if (options.cwd) {
    args.push("-C", options.cwd);
  }

  if (decision.readOnly && !hasSandboxOption(options.codexArgs)) {
    args.push("-s", "read-only");
  }

  if (Array.isArray(options.codexArgs)) {
    args.push(...options.codexArgs);
  }

  args.push(prompt);
  return { command: codexBin, args };
}

export function runCodex(decision, options = {}) {
  const { command, args } = buildCodexCommand(decision, options);
  return spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd ?? process.cwd(),
    env: process.env
  });
}

function requirePrompt(prompt) {
  const text = String(prompt ?? "").trim();
  if (!text) throw new Error("Missing prompt for exec transport.");
  return text;
}

function hasSandboxOption(args) {
  if (!Array.isArray(args)) return false;
  return args.some((arg) => arg === "-s" || arg === "--sandbox" || arg.startsWith("--sandbox="));
}

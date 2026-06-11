import { buildCodexCommand } from "../codex/index.js";
import {
  buildAppServerProxyCommand,
  buildTurnStartRequest
} from "../transports/app-server.js";

export const OMITTED_PROMPT = "[prompt omitted]";

export function buildTransportPreview(decision, parsed, transport) {
  const prompt = parsed.includePrompt ? parsed.prompt : OMITTED_PROMPT;
  if (transport === "app-server") {
    const options = buildAppServerOptions(parsed, prompt);
    return {
      proxy: buildAppServerProxyCommand(options),
      request: buildTurnStartRequest(decision, options)
    };
  }

  return {
    command: buildCodexCommand(decision, {
      codexBin: parsed.codexBin,
      cwd: parsed.cwd,
      codexArgs: parsed.codexArgs,
      prompt
    })
  };
}

export function buildAppServerOptions(parsed, prompt) {
  return {
    codexBin: parsed.codexBin,
    cwd: parsed.cwd,
    prompt,
    sock: parsed.sock,
    summary: parsed.summary,
    threadId: parsed.threadId
  };
}

export function printDecision(decision, usage, writer = console.log) {
  writer(`model: ${decision.model}`);
  writer(`effort: ${decision.effort}`);
  writer(`classification: ${decision.classification}`);
  writer(`confidence: ${decision.confidence}`);
  writer(`mode: ${decision.mode}`);
  writer(`read_only: ${decision.readOnly}`);
  writer(`reason: ${decision.reasons.join("; ")}`);
  if (usage?.secondaryUsedPercent !== null && usage?.secondaryUsedPercent !== undefined) {
    writer(`weekly_usage: ${usage.secondaryUsedPercent}%`);
  }
}

export function printPreview(preview, writer = console.log) {
  if (preview.command) {
    writer(`command: ${shellQuote([preview.command.command, ...preview.command.args])}`);
    return;
  }

  if (preview.proxy) {
    writer(`proxy: ${shellQuote([preview.proxy.command, ...preview.proxy.args])}`);
  }
  if (preview.request) {
    writer(`request: ${JSON.stringify(preview.request)}`);
  }
}

export function shellQuote(parts) {
  return parts
    .map((part) => {
      if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) return part;
      return `'${String(part).replaceAll("'", "'\\''")}'`;
    })
    .join(" ");
}

#!/usr/bin/env node
import { runMainCommand } from "./commands.js";

try {
  const status = await runMainCommand(process.argv.slice(2), {
    entrypoint: process.argv[1],
    env: process.env
  });
  process.exit(status ?? 0);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}

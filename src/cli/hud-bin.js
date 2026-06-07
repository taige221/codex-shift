#!/usr/bin/env node
import { runHudCli } from "../ui/hud.js";

try {
  const status = await runHudCli();
  process.exit(status);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}

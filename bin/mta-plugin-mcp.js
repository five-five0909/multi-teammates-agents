#!/usr/bin/env node

import { resolve } from "node:path";

import { main } from "../dist/cli/index.js";

const workspace = process.env.CODEX_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR;
process.exitCode = await main(workspace === undefined
  ? ["mcp", "serve"]
  : ["mcp", "serve", "--project", resolve(workspace)]);

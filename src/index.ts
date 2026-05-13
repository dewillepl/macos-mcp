#!/usr/bin/env node

/**
 * index.ts
 * Entry point for the macOS MCP server (stdio transport)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type FullServerConfig, loadConfig } from './config/index.js';
import { createServer } from './server/server.js';
import { contactResolver } from './utils/contactResolver.js';

async function main(): Promise<void> {
  const config: FullServerConfig = loadConfig();
  const server = createServer(config);

  // Warm contact cache before connecting transport.
  // Fire-and-forget: cache builds concurrently with stdio handshake.
  void contactResolver.warmCache();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv.includes('--check')) {
  import('./utils/preflight.js').then(
    async ({ runPreflight, formatResults }) => {
      const results = await runPreflight();
      process.stdout.write(`${formatResults(results)}\n`);
      const hasFailure = results.some((r) => r.status === 'FAIL');
      process.exit(hasFailure ? 1 : 0);
    },
  );
} else {
  main().catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), error: 'fatal', message: errorMessage })}\n`,
    );
    process.exit(1);
  });
}

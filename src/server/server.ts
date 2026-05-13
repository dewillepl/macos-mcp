/**
 * server/server.ts
 * MCP server factory
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerHandlers } from './handlers.js';

// Gracefully exit on EPIPE (broken pipe) when the MCP client disconnects.
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
});

interface CreateServerConfig {
  name: string;
  version: string;
}

export function createServer(config: CreateServerConfig): Server {
  const server = new Server(
    {
      name: config.name,
      version: config.version,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  registerHandlers(server);

  return server;
}

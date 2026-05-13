/**
 * @fileoverview Configuration schema for macos-mcp server
 * @module config/schema
 */

import { z } from 'zod/v3';

export const ServerConfigSchema = z.object({
  /** Server name (auto-populated from package.json) */
  name: z.string(),
  /** Server version (auto-populated from package.json) */
  version: z.string(),
});

export type FullServerConfig = z.infer<typeof ServerConfigSchema>;

/**
 * @fileoverview Configuration loader for macos-mcp server
 * @module config
 * @description Auto-injects name + version from package.json
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../utils/projectUtils.js';
import { type FullServerConfig, ServerConfigSchema } from './schema.js';

export function loadConfig(): FullServerConfig {
  const projectRoot = findProjectRoot();
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    name: string;
    version: string;
  };

  return ServerConfigSchema.parse({
    name: packageJson.name,
    version: packageJson.version,
  });
}

export type { FullServerConfig };
export { ServerConfigSchema } from './schema.js';

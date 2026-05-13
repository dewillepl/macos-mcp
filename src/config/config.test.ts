/**
 * config.test.ts
 * Tests for configuration schema and loader
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../utils/projectUtils.js';
import { loadConfig, ServerConfigSchema } from './index.js';

jest.mock('../utils/projectUtils.js', () => ({
  findProjectRoot: jest.fn(),
}));

const mockFindProjectRoot = findProjectRoot as jest.MockedFunction<
  typeof findProjectRoot
>;

describe('Configuration', () => {
  describe('ServerConfigSchema', () => {
    it('parses valid config', () => {
      const result = ServerConfigSchema.parse({
        name: 'test-server',
        version: '1.0.0',
      });
      expect(result.name).toBe('test-server');
      expect(result.version).toBe('1.0.0');
    });

    it('requires name field', () => {
      expect(() => ServerConfigSchema.parse({ version: '1.0.0' })).toThrow();
    });

    it('requires version field', () => {
      expect(() => ServerConfigSchema.parse({ name: 'test-server' })).toThrow();
    });
  });

  describe('loadConfig', () => {
    const testProjectRoot = '/tmp/macos-mcp-test';
    const packageJsonPath = join(testProjectRoot, 'package.json');

    beforeEach(() => {
      mockFindProjectRoot.mockReturnValue(testProjectRoot);
      const fs = require('node:fs');
      fs.mkdirSync(testProjectRoot, { recursive: true });
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify({ name: 'mcp-macos', version: '2.0.0' }),
      );
    });

    afterEach(() => {
      const fs = require('node:fs');
      if (existsSync(packageJsonPath)) {
        try {
          unlinkSync(packageJsonPath);
        } catch {}
      }
      try {
        fs.rmdirSync(testProjectRoot);
      } catch {}
    });

    it('auto-injects name and version from package.json', () => {
      const config = loadConfig();
      expect(config.name).toBe('mcp-macos');
      expect(config.version).toBe('2.0.0');
    });
  });
});

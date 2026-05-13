/**
 * index.test.ts
 * Tests for the stdio entry point
 */

jest.mock('./utils/projectUtils.js', () => ({
  findProjectRoot: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js');
jest.mock('./config/index.js');
jest.mock('./server/server.js');

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { FullServerConfig } from './config/index.js';
import { loadConfig } from './config/index.js';
import { createServer } from './server/server.js';

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockCreateServer = createServer as jest.MockedFunction<
  typeof createServer
>;
const mockStdioServerTransport = StdioServerTransport as jest.MockedClass<
  typeof StdioServerTransport
>;

const defaultConfig: FullServerConfig = {
  name: 'mcp-macos',
  version: '0.0.0',
};

describe('index', () => {
  let mockServerInstance: jest.Mocked<Server>;
  let mockTransportInstance: jest.Mocked<StdioServerTransport>;
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockServerInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Server>;

    mockTransportInstance = {} as jest.Mocked<StdioServerTransport>;

    mockLoadConfig.mockReturnValue(defaultConfig);
    mockCreateServer.mockReturnValue(mockServerInstance);
    mockStdioServerTransport.mockImplementation(() => mockTransportInstance);

    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
      // Prevent actual exit
    }) as () => never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  it('loads config and connects server to stdio transport', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('./index.js');
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockLoadConfig).toHaveBeenCalled();
    expect(mockCreateServer).toHaveBeenCalledWith(defaultConfig);
    expect(mockStdioServerTransport).toHaveBeenCalled();
    expect(mockServerInstance.connect).toHaveBeenCalledWith(
      mockTransportInstance,
    );
  });

  it('exits with code 1 on startup failure', async () => {
    mockServerInstance.connect.mockRejectedValue(new Error('boom'));

    await jest.isolateModulesAsync(async () => {
      await import('./index.js');
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

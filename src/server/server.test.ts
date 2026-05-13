import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ServerConfig } from '../types/index.js';
import { createServer } from './server.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('./handlers.js', () => ({
  registerHandlers: jest.fn(),
}));

const mockServer = Server as jest.MockedClass<typeof Server>;

const { registerHandlers } = jest.requireMock('./handlers.js') as {
  registerHandlers: jest.MockedFunction<(server: unknown) => void>;
};

describe('createServer', () => {
  let mockServerInstance: jest.Mocked<Server>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockServerInstance = {
      connect: jest.fn(),
    } as unknown as jest.Mocked<Server>;
    mockServer.mockImplementation(() => mockServerInstance);
  });

  it.each([
    [{ name: 'mcp-server', version: '2.1.0' }],
    [{ name: 'test', version: '0.0.1' }],
    [{ name: 'production-server', version: '10.5.3' }],
  ])('creates server with correct configuration and capabilities (%j)', (config: ServerConfig) => {
    const server = createServer(config);

    expect(mockServer).toHaveBeenCalledWith(
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
    expect(registerHandlers).toHaveBeenCalledWith(mockServerInstance);
    expect(server).toBe(mockServerInstance);
  });
});

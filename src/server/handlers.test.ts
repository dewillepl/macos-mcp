import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerHandlers } from './handlers.js';

interface MockServer {
  setRequestHandler: jest.MockedFunction<
    (schema: unknown, handler: unknown) => void
  >;
}

jest.mock('../tools/index.js', () => ({
  TOOLS: [],
  handleToolCall: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Mock result' }],
    isError: false,
  }),
}));

describe('Server Handlers', () => {
  let mockServer: MockServer;

  beforeEach(() => {
    // Create a mock server
    mockServer = {
      setRequestHandler: jest.fn(),
    };

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('registerHandlers', () => {
    test('should register tool handlers', () => {
      registerHandlers(
        mockServer as unknown as Parameters<typeof registerHandlers>[0],
      );

      expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('ListToolsRequestSchema handler', () => {
    let listToolsHandler: jest.MockedFunction<() => Promise<unknown>>;

    beforeEach(() => {
      const testServer = new Server(
        { name: 'test', version: '1.0.0' },
        { capabilities: { resources: {}, tools: {} } },
      );

      const originalSetRequestHandler = testServer.setRequestHandler;
      testServer.setRequestHandler = jest.fn(
        (schema: unknown, handler: unknown) => {
          const ListToolsRequestSchema = jest.requireActual(
            '@modelcontextprotocol/sdk/types.js',
          ).ListToolsRequestSchema;
          if (schema === (ListToolsRequestSchema as unknown)) {
            listToolsHandler = handler as jest.MockedFunction<
              () => Promise<unknown>
            >;
          }
          return originalSetRequestHandler.call(
            testServer,
            schema as unknown as Parameters<
              typeof originalSetRequestHandler
            >[0],
            handler as unknown as Parameters<
              typeof originalSetRequestHandler
            >[1],
          );
        },
      );

      registerHandlers(testServer);
    });

    it('should return list of tools', async () => {
      const result = await listToolsHandler();
      expect(result).toBeDefined();
      expect(result).toHaveProperty('tools');
    });
  });

  describe('CallToolRequestSchema handler', () => {
    let callToolHandler: jest.MockedFunction<
      (args: unknown) => Promise<unknown>
    >;

    beforeEach(() => {
      const testServer = new Server(
        { name: 'test', version: '1.0.0' },
        { capabilities: { resources: {}, tools: {} } },
      );

      const originalSetRequestHandler = testServer.setRequestHandler;
      testServer.setRequestHandler = jest.fn(
        (schema: unknown, handler: unknown) => {
          const CallToolRequestSchema = jest.requireActual(
            '@modelcontextprotocol/sdk/types.js',
          ).CallToolRequestSchema;
          if (schema === (CallToolRequestSchema as unknown)) {
            callToolHandler = handler as jest.MockedFunction<
              (args: unknown) => Promise<unknown>
            >;
          }
          return originalSetRequestHandler.call(
            testServer,
            schema as unknown as Parameters<
              typeof originalSetRequestHandler
            >[0],
            handler as unknown as Parameters<
              typeof originalSetRequestHandler
            >[1],
          );
        },
      );

      registerHandlers(testServer);
    });

    it('should handle null arguments', async () => {
      const request = {
        params: {
          name: 'reminders_tasks',
          arguments: null,
        },
      };

      const result = await callToolHandler(request);
      expect(result).toBeDefined();
    });
  });
});

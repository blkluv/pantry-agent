/**
 * Integration Tests
 *
 * These tests exercise the full flow from MCP client through the server,
 * service layer, and API client using mocked fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KrogerService } from './services/kroger.service.js';
import { createMcpServer } from './mcp/server.js';

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const callTool = (c: Client, params: Parameters<Client['callTool']>[0]) =>
  c.callTool(params) as Promise<ToolResult>;

// Mock global fetch for all tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock fs for auth service
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));

describe('Integration Tests', () => {
  let client: Client;
  let krogerService: KrogerService;

  beforeEach(async () => {
    vi.clearAllMocks();

    krogerService = new KrogerService({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      environment: 'certification',
    });

    const server = createMcpServer(krogerService);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  describe('Product Search Flow', () => {
    it('should search products through MCP tool to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'app-token-123',
            token_type: 'bearer',
            expires_in: 1800,
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                productId: '0001111041700',
                upc: '0001111041700',
                description: 'Kroger 2% Reduced Fat Milk',
                brand: 'Kroger',
                items: [
                  {
                    itemId: 'item-1',
                    price: { regular: 3.99 },
                    inventory: { stockLevel: 'HIGH' },
                  },
                ],
                aisleLocations: [{ description: 'Dairy' }],
              },
            ],
            meta: { pagination: { start: 0, limit: 10, total: 1 } },
          }),
      });

      const result = await callTool(client, {
        name: 'search_products',
        arguments: { term: 'milk', locationId: '01400943' },
      });

      // Verify token was fetched first
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/connect/oauth2/token'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );

      // Verify product search was called with token
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/products?filter.term=milk'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer app-token-123',
          }),
        })
      );

      // Verify result format
      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.count).toBe(1);
      expect(parsed.products).toHaveLength(1);
      expect(parsed.products[0].productId).toBe('0001111041700');
      expect(parsed.products[0].price).toBe(3.99);
      expect(parsed.products[0].inStock).toBe(true);
    });

    it('should cache app token for subsequent requests', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'app-token-123',
              token_type: 'bearer',
              expires_in: 1800,
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                {
                  productId: '001',
                  description: 'Product 1',
                  items: [{ price: { regular: 1.99 } }],
                },
              ],
              meta: { pagination: { start: 0, limit: 10, total: 1 } },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                {
                  productId: '002',
                  description: 'Product 2',
                  items: [{ price: { regular: 2.99 } }],
                },
              ],
              meta: { pagination: { start: 0, limit: 10, total: 1 } },
            }),
        });

      (await client.callTool({
        name: 'search_products',
        arguments: { term: 'test1', locationId: '01400943' },
      })) as ToolResult;

      (await client.callTool({
        name: 'search_products',
        arguments: { term: 'test2', locationId: '01400943' },
      })) as ToolResult;

      // Verify token was only fetched once
      const tokenCalls = mockFetch.mock.calls.filter((call) =>
        call[0].includes('/connect/oauth2/token')
      );
      expect(tokenCalls).toHaveLength(1);

      // Verify both product searches used the same token
      const productCalls = mockFetch.mock.calls.filter((call) => call[0].includes('/products'));
      expect(productCalls).toHaveLength(2);
      expect(productCalls[0][1]?.headers?.Authorization).toBe('Bearer app-token-123');
      expect(productCalls[1][1]?.headers?.Authorization).toBe('Bearer app-token-123');
    });
  });

  describe('Store Lookup Flow', () => {
    it('should find stores through MCP tool to API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'app-token-456',
            token_type: 'bearer',
            expires_in: 1800,
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                locationId: '01400943',
                name: 'Kroger',
                chain: 'KROGER',
                address: {
                  addressLine1: '123 Main St',
                  city: 'Cincinnati',
                  state: 'OH',
                  zipCode: '45202',
                },
                phone: '513-555-1234',
              },
            ],
            meta: { pagination: { start: 0, limit: 5, total: 1 } },
          }),
      });

      const result = await callTool(client, {
        name: 'find_stores',
        arguments: { zipCode: '45202' },
      });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/connect/oauth2/token'),
        expect.any(Object)
      );

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/locations'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer app-token-456',
          }),
        })
      );

      const parsed = JSON.parse((result.content[0] as any).text);
      expect(parsed.stores[0].locationId).toBe('01400943');
      expect(parsed.stores[0].address).toBe('123 Main St, Cincinnati, OH 45202');
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'app-token-123',
            token_type: 'bearer',
            expires_in: 1800,
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal Server Error' }),
      });

      const result = await callTool(client, {
        name: 'search_products',
        arguments: { term: 'milk', locationId: '01400943' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await callTool(client, {
        name: 'search_products',
        arguments: { term: 'milk', locationId: '01400943' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});

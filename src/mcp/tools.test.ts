/**
 * Tests for MCP Tools
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createTestClient, createMockKrogerService, type ToolResult } from './test-helpers.js';

describe('MCP Tools', () => {
  let client: Client;
  let callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<ToolResult>;
  let mockKroger: ReturnType<typeof createMockKrogerService>;

  beforeEach(async () => {
    const ctx = await createTestClient();
    client = ctx.client;
    callTool = ctx.callTool;
    mockKroger = ctx.mockKroger;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('Tool Registration', () => {
    it('should register all expected tools', async () => {
      const result = await client.listTools();
      const toolNames = result.tools.map((t) => t.name);

      expect(toolNames).toContain('search_products');
      expect(toolNames).toContain('get_product');
      expect(toolNames).toContain('find_stores');
      expect(toolNames).toContain('get_store');
      expect(toolNames).toContain('add_to_cart');
      expect(toolNames).toContain('get_profile');
      expect(toolNames).toContain('check_auth_status');
      expect(toolNames).toContain('preview_cart');
    });

    it('should have proper annotations for search_products', async () => {
      const result = await client.listTools();
      const searchTool = result.tools.find((t) => t.name === 'search_products');

      expect(searchTool).toBeDefined();
      expect(searchTool?.annotations?.readOnlyHint).toBe(true);
      expect(searchTool?.annotations?.idempotentHint).toBe(true);
    });

    it('should have proper annotations for add_to_cart', async () => {
      const result = await client.listTools();
      const cartTool = result.tools.find((t) => t.name === 'add_to_cart');

      expect(cartTool).toBeDefined();
      expect(cartTool?.annotations?.readOnlyHint).toBe(false);
      expect(cartTool?.annotations?.idempotentHint).toBe(false);
    });
  });

  describe('search_products', () => {
    it('should search products and return formatted results', async () => {
      const mockProducts = [
        {
          productId: '001',
          upc: '0001111041700',
          description: 'Kroger 2% Milk',
          brand: 'Kroger',
          items: [{ price: { regular: 3.99 }, inventory: { stockLevel: 'HIGH' } }],
          aisleLocations: [{ description: 'Dairy' }],
        },
        {
          productId: '002',
          upc: '0001111041701',
          description: 'Kroger Whole Milk',
          brand: 'Kroger',
          items: [{ price: { regular: 4.29 }, inventory: { stockLevel: 'LOW' } }],
        },
      ];

      mockKroger.searchProductsPage.mockResolvedValueOnce({
        data: mockProducts,
        meta: { pagination: { start: 0, limit: 10, total: 2 } },
      });

      const result = await callTool({
        name: 'search_products',
        arguments: { term: 'milk', locationId: '01400943' },
      });

      expect(mockKroger.searchProductsPage).toHaveBeenCalledWith(
        expect.objectContaining({
          term: 'milk',
          locationId: '01400943',
          limit: 10,
          start: 0,
        })
      );

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
      expect(parsed.has_more).toBe(false);
      expect(parsed.products).toHaveLength(2);
      expect(parsed.products[0].productId).toBe('001');
      expect(parsed.products[0].price).toBe(3.99);
      expect(parsed.products[0].inStock).toBe(true);
      expect(parsed.products[0].stockLevel).toBe('HIGH');
      expect(parsed.products[0].aisle).toBe('Dairy');
      expect(parsed.products[1].inStock).toBe(true);
      expect(parsed.products[1].stockLevel).toBe('LOW');
    });

    it('should return unknown stock when inventory level is missing', async () => {
      const mockProducts = [
        {
          productId: '003',
          upc: '0001111041702',
          description: 'Kroger Cola',
          brand: 'Kroger',
          items: [{ price: { regular: 2.49 } }],
        },
      ];

      mockKroger.searchProductsPage.mockResolvedValueOnce({
        data: mockProducts,
        meta: { pagination: { start: 0, limit: 10, total: 1 } },
      });

      const result = await callTool({
        name: 'search_products',
        arguments: { term: 'cola', locationId: '01400943' },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.products[0].inStock).toBeUndefined();
      expect(parsed.products[0].stockLevel).toBeUndefined();
      expect(parsed.products[0].availability).toBe('unknown');
    });

    it('should default to actionable mode (exclude explicitly out-of-stock)', async () => {
      const mockProducts = [
        {
          productId: 'oos-1',
          upc: '0001111041709',
          description: 'Out of Stock Soda',
          brand: 'BrandA',
          items: [
            { price: { regular: 1.99 }, inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } },
          ],
        },
        {
          productId: 'unk-1',
          upc: '0001111041710',
          description: 'Unknown Stock Soda',
          brand: 'BrandB',
          items: [{ price: { regular: 2.99 } }],
        },
      ];

      mockKroger.searchProductsPage.mockResolvedValueOnce({
        data: mockProducts,
        meta: { pagination: { start: 0, limit: 10, total: 2 } },
      });

      const result = await callTool({
        name: 'search_products',
        arguments: { term: 'soda', locationId: '01400943' },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.products[0].productId).toBe('unk-1');
    });

    it('should support in_stock_only mode', async () => {
      const mockProducts = [
        {
          productId: 'in-1',
          upc: '0001111041711',
          description: 'In Stock Soda',
          brand: 'BrandC',
          items: [{ price: { regular: 3.99 }, inventory: { stockLevel: 'LOW' } }],
        },
        {
          productId: 'unk-2',
          upc: '0001111041712',
          description: 'Unknown Soda',
          brand: 'BrandD',
          items: [{ price: { regular: 2.49 } }],
        },
      ];

      mockKroger.searchProductsPage.mockResolvedValueOnce({
        data: mockProducts,
        meta: { pagination: { start: 0, limit: 10, total: 2 } },
      });

      const result = await callTool({
        name: 'search_products',
        arguments: { term: 'soda', locationId: '01400943', availabilityMode: 'in_stock_only' },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.products[0].productId).toBe('in-1');
    });

    it('should scan additional pages when maxPages > 1', async () => {
      mockKroger.searchProductsPage
        .mockResolvedValueOnce({
          data: [
            {
              productId: 'p1',
              upc: '0001111041713',
              description: 'Page 1 Product',
              brand: 'BrandE',
              items: [
                { price: { regular: 1.99 }, inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } },
              ],
            },
          ],
          meta: { pagination: { start: 0, limit: 1, total: 2 } },
        })
        .mockResolvedValueOnce({
          data: [
            {
              productId: 'p2',
              upc: '0001111041714',
              description: 'Page 2 Product',
              brand: 'BrandF',
              items: [{ price: { regular: 2.99 }, inventory: { stockLevel: 'HIGH' } }],
            },
          ],
          meta: { pagination: { start: 1, limit: 1, total: 2 } },
        });

      const result = await callTool({
        name: 'search_products',
        arguments: {
          term: 'soda',
          locationId: '01400943',
          limit: 1,
          maxPages: 2,
          availabilityMode: 'all',
        },
      });

      expect(mockKroger.searchProductsPage).toHaveBeenCalledTimes(2);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
    });

    it('should return message when no products found', async () => {
      mockKroger.searchProductsPage.mockResolvedValueOnce({
        data: [],
        meta: { pagination: { start: 0, limit: 10, total: 0 } },
      });

      const result = await callTool({
        name: 'search_products',
        arguments: { term: 'nonexistent', locationId: '01400943' },
      });

      expect(result.content[0].text).toContain('No products found');
    });

    it('should use custom limit when provided', async () => {
      mockKroger.searchProductsPage.mockResolvedValueOnce({
        data: [],
        meta: { pagination: { start: 0, limit: 25, total: 0 } },
      });

      await callTool({
        name: 'search_products',
        arguments: { term: 'eggs', locationId: '01400943', limit: 25 },
      });

      expect(mockKroger.searchProductsPage).toHaveBeenCalledWith(
        expect.objectContaining({
          term: 'eggs',
          locationId: '01400943',
          limit: 25,
          start: 0,
        })
      );
    });
  });

  describe('get_product', () => {
    it('should get product and return formatted details', async () => {
      const mockProduct = {
        productId: '001',
        upc: '0001111041700',
        description: 'Kroger 2% Milk',
        brand: 'Kroger',
        categories: ['Dairy', 'Milk'],
        items: [
          {
            size: '1 gal',
            price: { regular: 3.99, promo: 2.99 },
            inventory: { stockLevel: 'HIGH' },
            fulfillment: { curbside: true, delivery: true, inStore: true, shipToHome: false },
          },
        ],
        aisleLocations: [{ description: 'Dairy', number: '12' }],
      };

      mockKroger.getProduct.mockResolvedValueOnce(mockProduct);

      const result = await callTool({
        name: 'get_product',
        arguments: { productId: '001', locationId: '01400943' },
      });

      expect(mockKroger.getProduct).toHaveBeenCalledWith('001', '01400943');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.productId).toBe('001');
      expect(parsed.size).toBe('1 gal');
      expect(parsed.price.regular).toBe(3.99);
      expect(parsed.price.promo).toBe(2.99);
      expect(parsed.fulfillment.curbside).toBe(true);
    });
  });

  describe('find_stores', () => {
    it('should find stores and return formatted results', async () => {
      const mockStores = [
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
        {
          locationId: '01400944',
          name: 'Kroger Marketplace',
          chain: 'KROGER',
          address: {
            addressLine1: '456 Oak Ave',
            city: 'Cincinnati',
            state: 'OH',
            zipCode: '45203',
          },
        },
      ];

      mockKroger.findStoresPage.mockResolvedValueOnce({
        data: mockStores,
        meta: { pagination: { start: 0, limit: 5, total: 2 } },
      });

      const result = await callTool({ name: 'find_stores', arguments: { zipCode: '45202' } });

      expect(mockKroger.findStoresPage).toHaveBeenCalledWith({ zipCode: '45202', limit: 5 });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(2);
      expect(parsed.has_more).toBe(false);
      expect(parsed.stores).toHaveLength(2);
      expect(parsed.stores[0].locationId).toBe('01400943');
      expect(parsed.stores[0].address).toBe('123 Main St, Cincinnati, OH 45202');
      expect(parsed.stores[0].phone).toBe('513-555-1234');
    });

    it('should return message when no stores found', async () => {
      mockKroger.findStoresPage.mockResolvedValueOnce({
        data: [],
        meta: { pagination: { start: 0, limit: 5, total: 0 } },
      });

      const result = await callTool({ name: 'find_stores', arguments: { zipCode: '99999' } });

      expect(result.content[0].text).toContain('No stores found');
    });
  });

  describe('get_store', () => {
    it('should get store and return formatted details', async () => {
      const mockStore = {
        locationId: '01400943',
        name: 'Kroger',
        chain: 'KROGER',
        address: { addressLine1: '123 Main St', city: 'Cincinnati', state: 'OH', zipCode: '45202' },
        phone: '513-555-1234',
        hours: {
          timezone: 'America/New_York',
          gmtOffset: '-05:00',
          open24: false,
          monday: { open: '06:00', close: '23:00', open24: false },
        },
        departments: [{ departmentId: 'bakery', name: 'Bakery' }],
      };

      mockKroger.getStore.mockResolvedValueOnce(mockStore);

      const result = await callTool({ name: 'get_store', arguments: { locationId: '01400943' } });

      expect(mockKroger.getStore).toHaveBeenCalledWith('01400943');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.locationId).toBe('01400943');
      expect(parsed.departments).toContain('Bakery');
    });
  });

  describe('add_to_cart', () => {
    it('should add items to cart and return success message', async () => {
      mockKroger.addToCart.mockResolvedValueOnce(undefined);

      const result = await callTool({
        name: 'add_to_cart',
        arguments: {
          items: [
            { upc: '0001111041700', quantity: 2 },
            { upc: '0001111041701', quantity: 1 },
          ],
        },
      });

      expect(mockKroger.addToCart).toHaveBeenCalledWith({
        items: [
          { upc: '0001111041700', quantity: 2 },
          { upc: '0001111041701', quantity: 1 },
        ],
      });

      expect(result.content[0].text).toContain('Successfully added 3 item(s)');
    });

    it('should return auth guidance when not authenticated', async () => {
      mockKroger.addToCart.mockRejectedValueOnce(
        new Error('AUTH_REQUIRED')
      );

      const result = await callTool({
        name: 'add_to_cart',
        arguments: { items: [{ upc: '0001111041700', quantity: 1 }] },
      });

      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain('authentication is required');
      expect(result.content[0].text).toContain('kroger_start_auth');
      expect(result.content[0].text).toContain('try your request again');
    });
  });

  describe('get_profile', () => {
    it('should get profile and return details', async () => {
      const mockProfile = { id: 'user-123-abc' };
      mockKroger.getProfile.mockResolvedValueOnce(mockProfile);

      const result = await callTool({ name: 'get_profile', arguments: {} });

      expect(mockKroger.getProfile).toHaveBeenCalled();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('user-123-abc');
    });

    it('should return auth guidance when not authenticated', async () => {
      mockKroger.getProfile.mockRejectedValueOnce(
        new Error('AUTH_REQUIRED')
      );

      const result = await callTool({ name: 'get_profile', arguments: {} });

      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain('authentication is required');
      expect(result.content[0].text).toContain('kroger_start_auth');
    });
  });

  describe('check_auth_status', () => {
    it('should return authenticated when user is logged in', async () => {
      mockKroger.isUserAuthenticated.mockResolvedValueOnce(true);

      const result = await callTool({ name: 'check_auth_status', arguments: {} });

      expect(mockKroger.isUserAuthenticated).toHaveBeenCalled();
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.authenticated).toBe(true);
      expect(parsed.message).toContain('authenticated');
    });

    it('should return not authenticated and guide to kroger_start_auth', async () => {
      mockKroger.isUserAuthenticated.mockResolvedValueOnce(false);

      const result = await callTool({ name: 'check_auth_status', arguments: {} });

      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.authenticated).toBe(false);
      expect(parsed.message).toContain('kroger_start_auth');
    });
  });

  describe('preview_cart', () => {
    it('should preview items with pricing and availability', async () => {
      const mockProduct = {
        productId: '001',
        upc: '0001111041700',
        description: 'Kroger 2% Milk',
        brand: 'Kroger',
        items: [
          {
            size: '1 gal',
            price: { regular: 3.99 },
            inventory: { stockLevel: 'HIGH' },
            fulfillment: { curbside: true, delivery: true, inStore: true, shipToHome: false },
          },
        ],
      };

      mockKroger.getProduct.mockResolvedValueOnce(mockProduct);

      const result = await callTool({
        name: 'preview_cart',
        arguments: {
          items: [{ upc: '0001111041700', quantity: 2 }],
          locationId: '01400943',
        },
      });

      expect(mockKroger.getProduct).toHaveBeenCalledWith('0001111041700', '01400943');
      expect(result.isError).not.toBe(true);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.itemCount).toBe(2);
      expect(parsed.estimatedTotal).toBe(7.98);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0].name).toBe('Kroger 2% Milk');
      expect(parsed.items[0].price).toBe(3.99);
      expect(parsed.items[0].lineTotal).toBe(7.98);
      expect(parsed.items[0].availability).toBe('in_stock');
      expect(parsed.items[0].fulfillment.curbside).toBe(true);
      expect(parsed.warnings).toHaveLength(0);
    });

    it('should include warnings for out-of-stock items', async () => {
      const mockProduct = {
        productId: '002',
        upc: '0001111041701',
        description: 'Kroger Cola',
        brand: 'Kroger',
        items: [{ price: { regular: 1.99 }, inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } }],
      };

      mockKroger.getProduct.mockResolvedValueOnce(mockProduct);

      const result = await callTool({
        name: 'preview_cart',
        arguments: {
          items: [{ upc: '0001111041701', quantity: 1 }],
          locationId: '01400943',
        },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.items[0].availability).toBe('out_of_stock');
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain('out of stock');
    });

    it('should include errors for items that cannot be found', async () => {
      mockKroger.getProduct.mockRejectedValueOnce(new Error('Product not found: 9999999999999'));

      const result = await callTool({
        name: 'preview_cart',
        arguments: {
          items: [{ upc: '9999999999999', quantity: 1 }],
          locationId: '01400943',
        },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.items[0].error).toContain('not found');
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.estimatedTotal).toBe(0);
    });

    it('should handle multiple items and sum estimated total', async () => {
      mockKroger.getProduct
        .mockResolvedValueOnce({
          productId: '001',
          upc: '0001111041700',
          description: 'Milk',
          items: [{ price: { regular: 3.99 }, inventory: { stockLevel: 'HIGH' } }],
        })
        .mockResolvedValueOnce({
          productId: '002',
          upc: '0001111041701',
          description: 'Eggs',
          items: [{ price: { regular: 2.49 }, inventory: { stockLevel: 'LOW' } }],
        });

      const result = await callTool({
        name: 'preview_cart',
        arguments: {
          items: [
            { upc: '0001111041700', quantity: 1 },
            { upc: '0001111041701', quantity: 2 },
          ],
          locationId: '01400943',
        },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.itemCount).toBe(3);
      expect(parsed.estimatedTotal).toBe(8.97); // 3.99 + 2*2.49
      expect(parsed.warnings).toHaveLength(0);
    });
  });

  describe('kroger_start_auth', () => {
    it('should register the tool', async () => {
      const result = await client.listTools();
      const authTool = result.tools.find((t) => t.name === 'kroger_start_auth');

      expect(authTool).toBeDefined();
      expect(authTool?.annotations?.readOnlyHint).toBe(false);
      expect(authTool?.annotations?.idempotentHint).toBe(true);
    });

    it('should return the authorization URL', async () => {
      const authUrl = 'https://api.kroger.com/v1/connect/oauth2/authorize?client_id=test&scope=cart.basic%3Awrite+profile.compact';
      mockKroger.startAuthFlow.mockResolvedValueOnce({ authUrl });

      const result = await callTool({ name: 'kroger_start_auth', arguments: {} });

      expect(mockKroger.startAuthFlow).toHaveBeenCalled();
      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toContain(authUrl);
      expect(result.content[0].text).toContain('browser');
    });

    it('should handle errors from startAuthFlow', async () => {
      mockKroger.startAuthFlow.mockRejectedValueOnce(new Error('Server unavailable'));

      const result = await callTool({ name: 'kroger_start_auth', arguments: {} });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: Server unavailable');
    });
  });

  describe('error handling', () => {
    it('should handle generic errors', async () => {
      mockKroger.searchProductsPage.mockRejectedValueOnce(new Error('Network error'));

      const result = await callTool({
        name: 'search_products',
        arguments: { term: 'milk', locationId: '01400943' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: Network error');
    });
  });
});

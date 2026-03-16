/**
 * Tests for MCP Resources
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createTestClient, createMockKrogerService } from './test-helpers.js';

describe('MCP Resources', () => {
  let client: Client;
  let mockKroger: ReturnType<typeof createMockKrogerService>;

  beforeEach(async () => {
    const ctx = await createTestClient();
    client = ctx.client;
    mockKroger = ctx.mockKroger;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('Resource Registration', () => {
    it('should register auth status resource', async () => {
      const result = await client.listResources();

      const authResource = result.resources.find((r) => r.uri === 'kroger://auth/status');
      expect(authResource).toBeDefined();
      expect(authResource?.name).toBe('Authentication Status');
      expect(authResource?.mimeType).toBe('application/json');
    });
  });

  describe('Resource Reading', () => {
    it('should return authenticated status when user is authenticated', async () => {
      mockKroger.isUserAuthenticated.mockResolvedValueOnce(true);

      const result = await client.readResource({ uri: 'kroger://auth/status' });

      expect(mockKroger.isUserAuthenticated).toHaveBeenCalled();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('kroger://auth/status');
      expect(result.contents[0].mimeType).toBe('application/json');

      const parsed = JSON.parse((result.contents[0] as { text: string }).text);
      expect(parsed.authenticated).toBe(true);
      expect(parsed.message).toContain('authenticated with Kroger');
    });

    it('should return not authenticated status when user is not authenticated', async () => {
      mockKroger.isUserAuthenticated.mockResolvedValueOnce(false);

      const result = await client.readResource({ uri: 'kroger://auth/status' });

      const parsed = JSON.parse((result.contents[0] as { text: string }).text);
      expect(parsed.authenticated).toBe(false);
      expect(parsed.message).toContain('Not authenticated');
      expect(parsed.message).toContain('pantry-agent auth');
    });
  });

  describe('Unknown Resource', () => {
    it('should throw error for unknown resource URI', async () => {
      await expect(client.readResource({ uri: 'kroger://unknown/resource' })).rejects.toThrow();
    });
  });
});

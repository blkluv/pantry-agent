/**
 * Tests for MCP Prompts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createTestClient } from './test-helpers.js';

describe('MCP Prompts', () => {
  let client: Client;

  beforeEach(async () => {
    const ctx = await createTestClient();
    client = ctx.client;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('Prompt Registration', () => {
    it('should register grocery-assistant prompt', async () => {
      const result = await client.listPrompts();

      const groceryPrompt = result.prompts.find((p) => p.name === 'grocery-assistant');
      expect(groceryPrompt).toBeDefined();
      expect(groceryPrompt?.description).toContain('grocery shopping');
    });

    it('should have proper arguments for grocery-assistant prompt', async () => {
      const result = await client.listPrompts();

      const groceryPrompt = result.prompts.find((p) => p.name === 'grocery-assistant');
      expect(groceryPrompt?.arguments).toBeDefined();

      const storeNameArg = groceryPrompt?.arguments?.find((a) => a.name === 'storeName');
      expect(storeNameArg).toBeDefined();
      expect(storeNameArg?.required).toBe(false);

      const locationIdArg = groceryPrompt?.arguments?.find((a) => a.name === 'locationId');
      expect(locationIdArg).toBeDefined();
      expect(locationIdArg?.required).toBe(false);
    });
  });

  describe('Prompt Execution', () => {
    it('should return prompt without context when no arguments provided', async () => {
      const result = await client.getPrompt({
        name: 'grocery-assistant',
        arguments: {},
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');

      const text = (result.messages[0].content as any).text;
      expect(text).toContain('grocery shopping assistant');
      expect(text).toContain('find_stores');
      expect(text).toContain('search_products');
      expect(text).toContain('add_to_cart');
      expect(text).toContain('kroger_start_auth');
      expect(text).not.toContain('shopping at');
    });

    it('should include store context when storeName and locationId provided', async () => {
      const result = await client.getPrompt({
        name: 'grocery-assistant',
        arguments: {
          storeName: 'Kroger on Main St',
          locationId: '01400943',
        },
      });

      const text = (result.messages[0].content as any).text;
      expect(text).toContain('shopping at Kroger on Main St');
      expect(text).toContain('location ID: 01400943');
    });

    it('should suggest finding store when only storeName provided', async () => {
      const result = await client.getPrompt({
        name: 'grocery-assistant',
        arguments: {
          storeName: 'Kroger',
        },
      });

      const text = (result.messages[0].content as any).text;
      expect(text).toContain('wants to shop at Kroger');
      expect(text).toContain('find_stores to get the location ID');
    });

    it('should handle empty arguments object', async () => {
      const result = await client.getPrompt({
        name: 'grocery-assistant',
        arguments: {},
      });

      const text = (result.messages[0].content as any).text;
      expect(text).toContain('grocery shopping assistant');
      expect(text).not.toContain('shopping at');
    });
  });

  describe('Unknown Prompt', () => {
    it('should throw error for unknown prompt name', async () => {
      await expect(client.getPrompt({ name: 'unknown-prompt' })).rejects.toThrow();
    });
  });

  describe('kroger-oauth prompt', () => {
    it('should register kroger-oauth prompt', async () => {
      const result = await client.listPrompts();
      const oauthPrompt = result.prompts.find((p) => p.name === 'kroger-oauth');

      expect(oauthPrompt).toBeDefined();
      expect(oauthPrompt?.description).toContain('OAuth');
    });

    it('should include kroger_start_auth tool guidance', async () => {
      const result = await client.getPrompt({
        name: 'kroger-oauth',
        arguments: {},
      });

      const text = (result.messages[0].content as any).text;
      expect(text).toContain('kroger_start_auth');
      expect(text).toContain('browser');
      expect(text).toContain('confirm');
    });

    it('should include returnAction in prompt when provided', async () => {
      const result = await client.getPrompt({
        name: 'kroger-oauth',
        arguments: { returnAction: 'add milk to cart' },
      });

      const text = (result.messages[0].content as any).text;
      expect(text).toContain('add milk to cart');
    });

    it('should use generic retry message when returnAction is not provided', async () => {
      const result = await client.getPrompt({
        name: 'kroger-oauth',
        arguments: {},
      });

      const text = (result.messages[0].content as any).text;
      expect(text).toContain('retry the original request');
    });
  });
});

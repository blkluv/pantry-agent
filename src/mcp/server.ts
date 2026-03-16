/**
 * MCP Server Setup
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { KrogerService } from '../services/kroger.service.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export function createMcpServer(kroger: KrogerService): McpServer {
  const server = new McpServer(
    {
      name: 'pantry-agent',
      version: '0.3.1',
    },
    {
      instructions: `Pantry Agent provides grocery shopping tools for all Kroger-owned stores (Kroger, Ralphs, Fred Meyer, King Soopers, Harris Teeter, Food 4 Less, Fry's, Smith's, QFC, and more).

Workflow:
1. Find the user's nearest store with find_stores (ask for ZIP code if needed). The response includes the chain name (Kroger, Ralphs, etc.).
2. Use the locationId from find_stores for all product searches.
3. search_products and get_product work without authentication.
4. add_to_cart and get_profile require Kroger login — if auth is needed, a browser window opens automatically. Tell the user to complete login and retry.
5. Always confirm with the user before adding items to their cart.
6. Show prices and stock availability when displaying products.
7. The cart is account-level, not store-specific. Items added via any store go to the user's single Kroger cart. The user picks their fulfillment store separately on kroger.com or the app.`,
    }
  );

  // Register tools
  registerTools(server, kroger);

  // Register resources
  registerResources(server, kroger);

  // Register prompts
  registerPrompts(server);

  return server;
}

export async function startMcpServer(kroger: KrogerService): Promise<void> {
  const server = createMcpServer(kroger);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('Pantry Agent MCP Server running on stdio');
}

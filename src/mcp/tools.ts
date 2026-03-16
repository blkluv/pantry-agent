/**
 * MCP Tools
 * Tool registration for the MCP server
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KrogerService } from '../services/kroger.service.js';
import type { Product, ProductItem } from '../api/types.js';

// Zod schemas for input validation
const SearchProductsInput = {
  term: z.string().min(1).describe('Search term (e.g., "milk", "organic bananas")'),
  locationId: z.string().min(1).describe('Store location ID (get from find_stores)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum results (default: 10, max: 50)'),
  availabilityMode: z
    .enum(['actionable', 'in_stock_only', 'all'])
    .default('actionable')
    .describe(
      'Product availability filter: actionable (exclude explicitly out-of-stock), in_stock_only (HIGH/LOW only), or all.'
    ),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(1)
    .describe('How many paginated result pages to scan (default: 1, max: 5).'),
  brand: z.string().min(1).optional().describe('Optional brand filter (e.g., "Pepsi")'),
};

const GetProductInput = {
  productId: z.string().min(1).describe('Product ID or UPC'),
  locationId: z.string().min(1).describe('Store location ID for pricing and stock info'),
};

const FindStoresInput = {
  zipCode: z
    .string()
    .regex(/^\d{5}$/, 'ZIP code must be 5 digits')
    .describe('5-digit ZIP code'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('Maximum results (default: 5, max: 20)'),
};

const GetStoreInput = {
  locationId: z.string().min(1).describe('Store location ID'),
};

const CartItemInput = z.object({
  upc: z
    .string()
    .regex(/^\d{13}$/, 'UPC must be 13 digits')
    .describe('Product UPC (13 digits)'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').describe('Quantity to add'),
  modality: z.enum(['PICKUP', 'DELIVERY']).optional().describe('Fulfillment method'),
});

const GetProfileInput = {};

const AddToCartInput = {
  items: z
    .array(CartItemInput)
    .min(1, 'At least one item is required')
    .describe('Items to add to cart'),
};

const PreviewCartInput = {
  items: z.array(CartItemInput).min(1, 'At least one item is required').describe('Items to preview'),
  locationId: z.string().min(1).describe('Store location ID for pricing and stock info'),
};

// Output schemas
const ProductSummary = z.object({
  productId: z.string(),
  upc: z.string().optional(),
  name: z.string().optional(),
  brand: z.string().optional(),
  price: z.number().optional(),
  inStock: z.boolean().optional(),
  stockLevel: z.string().optional(),
  availability: z.enum(['in_stock', 'out_of_stock', 'unknown']).optional(),
  aisle: z.string().optional(),
  size: z.string().optional(),
  categories: z.array(z.string()).optional(),
  fulfillment: z.object({
    curbside: z.boolean().optional(),
    delivery: z.boolean().optional(),
    inStore: z.boolean().optional(),
    shipToHome: z.boolean().optional(),
  }).optional(),
});

const SearchProductsOutput = {
  count: z.number(),
  has_more: z.boolean(),
  products: z.array(ProductSummary),
};

const ProductDetailOutput = {
  productId: z.string(),
  upc: z.string().optional(),
  name: z.string().optional(),
  brand: z.string().optional(),
  categories: z.array(z.string()).optional(),
  price: z.object({ regular: z.number().optional(), promo: z.number().optional() }).optional(),
  size: z.string().optional(),
  inStock: z.string().optional(),
  fulfillment: z
    .object({
      curbside: z.boolean().optional(),
      delivery: z.boolean().optional(),
      inStore: z.boolean().optional(),
      shipToHome: z.boolean().optional(),
    })
    .optional(),
  aisle: z.object({ description: z.string().optional(), number: z.string().optional() }).optional(),
};

const StoreSummary = z.object({
  locationId: z.string(),
  name: z.string().optional(),
  chain: z.string().optional(),
  address: z.string(),
  phone: z.string().optional(),
});

const FindStoresOutput = {
  count: z.number(),
  has_more: z.boolean(),
  stores: z.array(StoreSummary),
};

const StoreDetailOutput = {
  locationId: z.string(),
  name: z.string().optional(),
  chain: z.string().optional(),
  address: z.any().optional(),
  phone: z.string().optional(),
  hours: z.any().optional(),
  departments: z.array(z.string()).optional(),
};

const AddToCartOutput = {
  success: z.boolean(),
  itemCount: z.number(),
  message: z.string(),
};

const ProfileOutput = {
  id: z.string(),
};

function isInStockLevel(stockLevel: string | undefined): boolean {
  return stockLevel === 'HIGH' || stockLevel === 'LOW';
}

function stockLevelToInStock(stockLevel: string | undefined): boolean | undefined {
  if (stockLevel === 'HIGH' || stockLevel === 'LOW') return true;
  if (stockLevel === 'TEMPORARILY_OUT_OF_STOCK') return false;
  return undefined;
}

function stockLevelToAvailability(
  stockLevel: string | undefined
): 'in_stock' | 'out_of_stock' | 'unknown' {
  if (stockLevel === 'HIGH' || stockLevel === 'LOW') return 'in_stock';
  if (stockLevel === 'TEMPORARILY_OUT_OF_STOCK') return 'out_of_stock';
  return 'unknown';
}

function pickPreferredItem(product: Product): ProductItem | undefined {
  const items = product.items ?? [];
  if (items.length === 0) return undefined;

  return (
    items.find((item) => isInStockLevel(item.inventory?.stockLevel)) ??
    items.find((item) => item.inventory?.stockLevel !== undefined) ??
    items[0]
  );
}

function hasMoreFromPagination(
  pagination: { start: number; limit: number; total: number } | undefined
): boolean {
  if (!pagination) return false;
  return pagination.start + pagination.limit < pagination.total;
}

export function registerTools(server: McpServer, kroger: KrogerService): void {
  // Register search_products tool
  server.registerTool(
    'search_products',
    {
      description:
        "Search for products at a Kroger-owned store by name, brand, or description. Works with Kroger, Ralphs, Fred Meyer, King Soopers, Harris Teeter, Food 4 Less, Fry's, Smith's, and other Kroger banners.",
      inputSchema: SearchProductsInput,
      // outputSchema omitted: empty results and errors return plain text
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ term, locationId, limit, availabilityMode, maxPages, brand }) => {
      try {
        const seen = new Set<string>();
        const merged: Product[] = [];
        let hasMore = false;

        for (let page = 0; page < maxPages; page++) {
          const start = page * limit;
          const response = await kroger.searchProductsPage({
            term,
            locationId,
            limit,
            start,
            brand,
          });

          for (const product of response.data) {
            if (seen.has(product.productId)) continue;
            seen.add(product.productId);
            merged.push(product);
          }

          hasMore = hasMoreFromPagination(response.meta?.pagination);
          if (!hasMore) break;
        }

        if (merged.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: `No products found for "${term}" at this store.` },
            ],
          };
        }

        const formattedAll = merged.map((p) => {
          const selectedItem = pickPreferredItem(p);
          const stockLevel = selectedItem?.inventory?.stockLevel;
          const availability = stockLevelToAvailability(stockLevel);
          return {
            productId: p.productId,
            upc: p.upc,
            name: p.description,
            brand: p.brand,
            price: selectedItem?.price?.regular,
            inStock: stockLevelToInStock(stockLevel),
            stockLevel,
            availability,
            aisle: p.aisleLocations?.[0]?.description,
            size: selectedItem?.size,
            categories: p.categories,
            fulfillment: selectedItem?.fulfillment,
          };
        });

        const filtered = formattedAll.filter((p) => {
          if (availabilityMode === 'all') return true;
          if (availabilityMode === 'in_stock_only') return p.availability === 'in_stock';
          return p.availability !== 'out_of_stock'; // actionable
        });

        const result = {
          count: filtered.length,
          has_more: hasMore,
          products: filtered.slice(0, limit),
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register get_product tool
  server.registerTool(
    'get_product',
    {
      description:
        'Get detailed information about a specific product including price, stock, and nutrition',
      inputSchema: GetProductInput,
      // outputSchema omitted: errors return plain text
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ productId, locationId }) => {
      try {
        const product = await kroger.getProduct(productId, locationId);
        const selectedItem = pickPreferredItem(product);

        const formatted = {
          productId: product.productId,
          upc: product.upc,
          name: product.description,
          brand: product.brand,
          categories: product.categories,
          price: selectedItem?.price,
          size: selectedItem?.size,
          inStock: selectedItem?.inventory?.stockLevel,
          fulfillment: selectedItem?.fulfillment,
          aisle: product.aisleLocations?.[0],
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
          structuredContent: formatted,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register find_stores tool
  server.registerTool(
    'find_stores',
    {
      description:
        "Find Kroger-owned stores near a ZIP code. Returns Kroger, Ralphs, Fred Meyer, King Soopers, Harris Teeter, Food 4 Less, Fry's, Smith's, and other Kroger banners.",
      inputSchema: FindStoresInput,
      // outputSchema omitted: empty results and errors return plain text
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ zipCode, limit }) => {
      try {
        const response = await kroger.findStoresPage({ zipCode, limit });
        const stores = response.data;

        if (stores.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No stores found near ZIP code ${zipCode}.` }],
          };
        }

        const formatted = stores.map((s) => ({
          locationId: s.locationId,
          name: s.name,
          chain: s.chain,
          address: `${s.address.addressLine1}, ${s.address.city}, ${s.address.state} ${s.address.zipCode}`,
          phone: s.phone,
        }));

        const result = {
          count: formatted.length,
          has_more: hasMoreFromPagination(response.meta?.pagination),
          stores: formatted,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register get_store tool
  server.registerTool(
    'get_store',
    {
      description:
        'Get detailed information about a specific store including hours and departments',
      inputSchema: GetStoreInput,
      // outputSchema omitted: errors return plain text
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ locationId }) => {
      try {
        const store = await kroger.getStore(locationId);

        const formatted = {
          locationId: store.locationId,
          name: store.name,
          chain: store.chain,
          address: store.address,
          phone: store.phone,
          hours: store.hours,
          departments: store.departments?.map((d) => d.name),
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
          structuredContent: formatted,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register add_to_cart tool
  server.registerTool(
    'add_to_cart',
    {
      description:
        "Add items to the user's Kroger cart. Requires user authentication. Note: the cart is account-level, not store-specific — items go to the user's single cart regardless of which store was searched.",
      inputSchema: AddToCartInput,
      // outputSchema omitted: auth errors return plain text
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ items }) => {
      try {
        await kroger.addToCart({ items });

        const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
        const result = {
          success: true,
          itemCount,
          message: `Successfully added ${itemCount} item(s) to your Kroger cart.`,
        };
        return {
          content: [{ type: 'text' as const, text: result.message }],
          structuredContent: result,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register get_profile tool
  server.registerTool(
    'get_profile',
    {
      description: "Get the authenticated user's profile. Requires user authentication.",
      inputSchema: GetProfileInput,
      // outputSchema omitted: auth errors return plain text
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const profile = await kroger.getProfile();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }],
          structuredContent: { ...profile } as Record<string, unknown>,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register check_auth_status tool
  server.registerTool(
    'check_auth_status',
    {
      description:
        'Check whether the user is currently authenticated with Kroger without triggering an OAuth flow. ' +
        'Use this before attempting cart or profile operations to decide whether to call kroger_start_auth first.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const authenticated = await kroger.isUserAuthenticated();
        const result = {
          authenticated,
          message: authenticated
            ? 'User is authenticated with Kroger.'
            : 'User is not authenticated. Call kroger_start_auth to begin the login flow.',
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register preview_cart tool
  server.registerTool(
    'preview_cart',
    {
      description:
        'Preview items before adding to cart. Looks up current pricing, stock, and fulfillment options for each item. ' +
        'Use this to validate item availability and show an estimated total before calling add_to_cart. ' +
        'Does not require authentication.',
      inputSchema: PreviewCartInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ items, locationId }) => {
      try {
        type ResolvedItem = {
          upc: string;
          quantity: number;
          modality?: 'PICKUP' | 'DELIVERY';
          name?: string;
          brand?: string;
          price?: number;
          lineTotal?: number;
          inStock?: boolean;
          stockLevel?: string;
          availability?: 'in_stock' | 'out_of_stock' | 'unknown';
          fulfillment?: { curbside: boolean; delivery: boolean; inStore: boolean; shipToHome: boolean };
          error?: string;
        };

        const resolved: ResolvedItem[] = await Promise.all(
          items.map(async (item): Promise<ResolvedItem> => {
            try {
              const product = await kroger.getProduct(item.upc, locationId);
              const selectedItem = pickPreferredItem(product);
              const stockLevel = selectedItem?.inventory?.stockLevel;
              const price = selectedItem?.price?.regular;
              return {
                upc: item.upc,
                quantity: item.quantity,
                modality: item.modality,
                name: product.description,
                brand: product.brand,
                price,
                lineTotal:
                  price !== undefined
                    ? Math.round(price * item.quantity * 100) / 100
                    : undefined,
                inStock: stockLevelToInStock(stockLevel),
                stockLevel,
                availability: stockLevelToAvailability(stockLevel),
                fulfillment: selectedItem?.fulfillment,
              };
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Not found';
              return { upc: item.upc, quantity: item.quantity, error: msg };
            }
          })
        );

        const estimatedTotal = resolved.reduce((sum, item) => {
          if (item.error !== undefined || item.lineTotal === undefined) return sum;
          return sum + item.lineTotal;
        }, 0);

        const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

        const warnings: string[] = [];
        for (const item of resolved) {
          if (item.error !== undefined) {
            warnings.push(`UPC ${item.upc}: ${item.error}`);
          } else if (item.availability === 'out_of_stock') {
            warnings.push(`${item.name ?? item.upc} is currently out of stock`);
          } else if (item.availability === 'unknown') {
            warnings.push(`${item.name ?? item.upc} has unknown stock status`);
          }
        }

        const result = {
          items: resolved,
          estimatedTotal: Math.round(estimatedTotal * 100) / 100,
          itemCount,
          warnings,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );

  // Register kroger_start_auth tool
  server.registerTool(
    'kroger_start_auth',
    {
      description:
        'Start the Kroger OAuth login flow. Returns the authorization URL for the user to open in their browser. ' +
        'Call this when the user needs to authenticate with Kroger before using cart or profile features. ' +
        'After calling this tool, present the URL to the user, wait for them to confirm login is complete, ' +
        'then retry the original operation.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const { authUrl } = await kroger.startAuthFlow();
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Kroger authentication started. Please open the following URL in your browser to log in:\n\n' +
                `${authUrl}\n\n` +
                'After completing login, let me know and I will retry your request.',
            },
          ],
        };
      } catch (error) {
        return handleToolError(error);
      }
    }
  );
}

const AUTH_REQUIRED_PREFIX = 'AUTH_REQUIRED:';
const AUTH_REQUIRED_EXACT = 'AUTH_REQUIRED';

function handleToolError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (message.startsWith(AUTH_REQUIRED_PREFIX) || message === AUTH_REQUIRED_EXACT) {
    // Auth is required — extract URL if embedded (legacy), otherwise guide agent to kroger_start_auth
    const authUrl = message.startsWith(AUTH_REQUIRED_PREFIX)
      ? message.slice(AUTH_REQUIRED_PREFIX.length).trim()
      : '';
    const urlLine = authUrl ? `\n\nOpen this URL in your browser to log in:\n${authUrl}\n` : '';
    const startAuthNote = authUrl
      ? ''
      : '\n\nCall the kroger_start_auth tool to get the authorization URL and begin the login flow.';
    return {
      content: [
        {
          type: 'text' as const,
          text:
            'Kroger authentication is required.' +
            startAuthNote +
            urlLine +
            '\nAfter completing login, please try your request again.',
        },
      ],
    };
  }
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

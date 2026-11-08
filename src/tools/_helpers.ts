import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatError, type MealieClient } from '../client.js';
import type { QueryParams } from '../types.js';

export type ToolShape = Record<string, z.ZodType>;
export type ToolArgs<Shape extends ToolShape> = z.infer<z.ZodObject<Shape>>;

type ToolConfig<Shape extends ToolShape> = {
  title?: string;
  description?: string;
  inputSchema?: Shape;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

/**
 * Zod objects drop unknown keys by default, so a typo like `query` for `search` turned into a call with no
 * filter and no error. Rejecting them makes the mistake visible, and naming the valid keys lets the model
 * correct itself in one retry.
 */
export function strictInput(shape: ToolShape): z.ZodObject<ToolShape, z.core.$strict> {
  return z.strictObject(shape, {
    error: (issue) => {
      if (issue.code !== 'unrecognized_keys') return undefined;
      const unknown = issue.keys.map((key) => `"${key}"`).join(', ');
      const valid = Object.keys(shape).join(', ') || 'none';
      return `Unknown parameter ${unknown}. Valid parameters: ${valid}.`;
    },
  });
}

// The generic overload infers handler args from inputSchema; the implementation signature widens the
// config so the SDK's conditional ToolCallback type resolves to a concrete function type.
export function defineTool<Shape extends ToolShape>(
  server: McpServer,
  name: string,
  config: ToolConfig<Shape>,
  fetch: (args: ToolArgs<Shape>) => Promise<unknown>,
): void;
export function defineTool(
  server: McpServer,
  name: string,
  config: ToolConfig<ToolShape>,
  fetch: (args: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(name, { ...config, inputSchema: strictInput(config.inputSchema ?? {}) }, async (args) => {
    try {
      const result = await fetch(args);
      return {
        content: [
          {
            type: 'text' as const,
            // Compact: indentation adds roughly a third more tokens to every result for no gain to the model.
            text: typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true };
    }
  });
}

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

/** Rejects anything that could change which resource a path addresses; MealieClient refuses those paths too. */
export const slugSchema = z
  .string()
  .regex(/^[^/\\?#%\s]+$/, 'Must be a recipe slug')
  .refine((s) => s !== '.' && s !== '..', 'Must be a recipe slug')
  .describe('Recipe slug, from search_recipes or get_recipe');

export const idSchema = z.uuid();

export const paginationShape = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
  per_page: z.number().int().min(1).max(200).optional().describe('Items per page, 50 by default'),
};

export function paginationQuery(params: { page?: number; per_page?: number }): QueryParams {
  return { page: params.page ?? 1, perPage: params.per_page ?? 50 };
}

export interface Paginated<T = Record<string, unknown>> {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  items: T[];
}

/** Mealie's paginated envelope includes next/previous URLs nobody needs; keep the counters and items. */
export function shapePage<T = Record<string, unknown>, R = T>(
  response: Paginated<T>,
  map: (item: T) => R = (item) => item as unknown as R,
): Paginated<R> {
  return {
    page: response.page,
    per_page: response.per_page,
    total: response.total,
    total_pages: response.total_pages,
    items: response.items.map(map),
  };
}

/** Drops undefined fields so a partial update never overwrites a value the caller didn't mention. */
export function defined(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/**
 * Many Mealie PUT routes require the whole object, including read-only ids. Fetching and overlaying
 * the changes lets a tool expose a partial update without the model having to echo the full record.
 */
export async function mergePut(client: MealieClient, path: string, changes: Record<string, unknown>): Promise<unknown> {
  const current = await client.get<Record<string, unknown>>(path);
  return client.put(path, { ...current, ...defined(changes) });
}

/** Decodes base64 strictly: Buffer.from would silently skip invalid characters and upload garbage. */
export function decodeBase64(value: string, field: string): Uint8Array<ArrayBuffer> {
  const compact = value.replace(/\s+/g, '');
  if (compact === '' || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error(`${field} is not valid base64.`);
  }
  return new Uint8Array(Buffer.from(compact, 'base64'));
}

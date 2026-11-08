import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MealieClient } from '../client.js';
import { registerIngredientTools } from './ingredients.js';
import { registerMealplanTools } from './mealplans.js';
import { registerOrganizerTools } from './organizers.js';
import { registerRecipeAssetTools } from './recipe-assets.js';
import { registerRecipeTools } from './recipes.js';
import { registerShoppingTools } from './shopping.js';

export const TOOL_GROUPS = ['recipes', 'recipe-assets', 'ingredients', 'organizers', 'shopping', 'mealplans'] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const PRESETS = {
  minimal: ['recipes'],
  default: ['recipes', 'shopping', 'mealplans'],
  full: [...TOOL_GROUPS],
} satisfies Record<string, ToolGroup[]>;

export type PresetName = keyof typeof PRESETS;

export interface ToolFilterOptions {
  preset?: PresetName;
  groups?: ToolGroup[];
  readOnly?: boolean;
}

function isReadOnlyTool(config: unknown): boolean {
  return (config as { annotations?: { readOnlyHint?: boolean } } | undefined)?.annotations?.readOnlyHint === true;
}

export function makeReadOnlyProxy(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, prop) {
      if (prop === 'registerTool') {
        return (name: string, config: unknown, handler: unknown) => {
          if (isReadOnlyTool(config)) {
            (target.registerTool as (n: string, c: unknown, h: unknown) => void)(name, config, handler);
          }
        };
      }
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(target) : v;
    },
  });
}

const REGISTRARS: Record<ToolGroup, (server: McpServer, client: MealieClient) => void> = {
  recipes: registerRecipeTools,
  'recipe-assets': registerRecipeAssetTools,
  ingredients: registerIngredientTools,
  organizers: registerOrganizerTools,
  shopping: registerShoppingTools,
  mealplans: registerMealplanTools,
};

export function registerAllTools(server: McpServer, client: MealieClient, options: ToolFilterOptions = {}): void {
  const { preset, groups, readOnly = false } = options;
  // Own keys only: a name inherited from Object.prototype (toString, __proto__) is not a preset.
  if (preset !== undefined && !Object.hasOwn(PRESETS, preset)) throw new Error(`Unknown preset "${preset}"`);
  if (groups !== undefined && groups.length === 0) throw new Error('No tool groups selected');

  const active = new Set<ToolGroup>(preset ? PRESETS[preset] : (groups ?? TOOL_GROUPS));
  const target = readOnly ? makeReadOnlyProxy(server) : server;
  for (const group of TOOL_GROUPS) {
    if (active.has(group)) REGISTRARS[group](target, client);
  }
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MealieClient } from '../client.js';
import { DELETE_ANNOTATIONS, READ_ANNOTATIONS, UPDATE_ANNOTATIONS, WRITE_ANNOTATIONS } from './_annotations.js';
import {
  defined,
  defineTool,
  idSchema,
  mergePut,
  type Paginated,
  paginationQuery,
  paginationShape,
  shapePage,
} from './_helpers.js';

const LISTS = '/households/shopping/lists';
const ITEMS = '/households/shopping/items';

const itemFields = {
  note: z.string().optional().describe('Free text, e.g. "2 ripe avocados"'),
  quantity: z.number().optional(),
  food_id: idSchema.optional().describe('From list_foods'),
  unit_id: idSchema.optional().describe('From list_units'),
  label_id: idSchema.optional(),
  checked: z.boolean().optional(),
};

function toItem(args: {
  note?: string;
  quantity?: number;
  food_id?: string;
  unit_id?: string;
  label_id?: string;
  checked?: boolean;
}): Record<string, unknown> {
  return defined({
    note: args.note,
    quantity: args.quantity,
    foodId: args.food_id,
    unitId: args.unit_id,
    labelId: args.label_id,
    checked: args.checked,
  });
}

export function registerShoppingTools(server: McpServer, client: MealieClient): void {
  defineTool(
    server,
    'list_shopping_lists',
    {
      title: 'List shopping lists',
      description: "Lists the household's shopping lists. Use get_shopping_list for the items.",
      inputSchema: paginationShape,
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      shapePage(await client.get<Paginated>(LISTS, paginationQuery(args)), (list) => ({
        id: list.id,
        name: list.name,
        updated_at: list.updatedAt,
      })),
  );

  defineTool(
    server,
    'get_shopping_list',
    {
      title: 'Get shopping list',
      description: 'Gets a shopping list with all its items.',
      inputSchema: { id: idSchema },
      annotations: READ_ANNOTATIONS,
    },
    ({ id }) => client.get(`${LISTS}/${id}`),
  );

  defineTool(
    server,
    'create_shopping_list',
    {
      title: 'Create shopping list',
      description: 'Creates an empty shopping list.',
      inputSchema: { name: z.string().min(1) },
      annotations: WRITE_ANNOTATIONS,
    },
    ({ name }) => client.post(LISTS, { name }),
  );

  defineTool(
    server,
    'rename_shopping_list',
    {
      title: 'Rename shopping list',
      description: 'Renames a shopping list.',
      inputSchema: { id: idSchema, name: z.string().min(1) },
      annotations: UPDATE_ANNOTATIONS,
    },
    ({ id, name }) => mergePut(client, `${LISTS}/${id}`, { name }),
  );

  defineTool(
    server,
    'delete_shopping_list',
    {
      title: 'Delete shopping list',
      description: 'Permanently deletes a shopping list and its items.',
      inputSchema: { id: idSchema },
      annotations: DELETE_ANNOTATIONS,
    },
    async ({ id }) => {
      await client.delete(`${LISTS}/${id}`);
      return { deleted: true, id };
    },
  );

  defineTool(
    server,
    'add_shopping_items',
    {
      title: 'Add shopping items',
      description: 'Adds one or more items to a shopping list.',
      inputSchema: { list_id: idSchema, items: z.array(z.object(itemFields)).min(1) },
      annotations: WRITE_ANNOTATIONS,
    },
    ({ list_id, items }) =>
      client.post(
        `${ITEMS}/create-bulk`,
        items.map((item) => ({ shoppingListId: list_id, ...toItem(item) })),
      ),
  );

  defineTool(
    server,
    'update_shopping_item',
    {
      title: 'Update shopping item',
      description: 'Changes the given fields of a shopping item, including ticking it off.',
      inputSchema: { id: idSchema, ...itemFields },
      annotations: UPDATE_ANNOTATIONS,
    },
    ({ id, ...fields }) => mergePut(client, `${ITEMS}/${id}`, toItem(fields)),
  );

  defineTool(
    server,
    'delete_shopping_item',
    {
      title: 'Delete shopping item',
      description: 'Removes an item from its shopping list.',
      inputSchema: { id: idSchema },
      annotations: DELETE_ANNOTATIONS,
    },
    async ({ id }) => {
      await client.delete(`${ITEMS}/${id}`);
      return { deleted: true, id };
    },
  );

  defineTool(
    server,
    'add_recipe_to_shopping_list',
    {
      title: 'Add recipe to shopping list',
      description: "Adds a recipe's ingredients to a shopping list, scaled by a multiplier.",
      inputSchema: {
        list_id: idSchema,
        recipe_id: idSchema.describe('The recipe id, not its slug'),
        scale: z.number().positive().optional().describe('Recipe multiplier, 1 by default'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    ({ list_id, recipe_id, scale }) =>
      client.post(`${LISTS}/${list_id}/recipe`, [{ recipeId: recipe_id, recipeIncrementQuantity: scale ?? 1 }]),
  );
}

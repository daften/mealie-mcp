import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MealieClient } from '../client.js';
import { DELETE_ANNOTATIONS, READ_ANNOTATIONS, UPDATE_ANNOTATIONS, WRITE_ANNOTATIONS } from './_annotations.js';
import {
  dateSchema,
  defined,
  defineTool,
  idSchema,
  mergePut,
  type Paginated,
  paginationQuery,
  paginationShape,
  shapePage,
} from './_helpers.js';

const PLANS = '/households/mealplans';
const entryType = z.enum(['breakfast', 'lunch', 'dinner', 'side', 'snack', 'drink', 'dessert']);
const entryId = z.number().int().positive();

export function registerMealplanTools(server: McpServer, client: MealieClient): void {
  defineTool(
    server,
    'get_mealplans',
    {
      title: 'Get meal plans',
      description: 'Lists meal plan entries for the household, optionally within a date range.',
      inputSchema: { start_date: dateSchema.optional(), end_date: dateSchema.optional(), ...paginationShape },
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      shapePage(
        await client.get<Paginated>(PLANS, {
          ...paginationQuery(args),
          start_date: args.start_date,
          end_date: args.end_date,
        }),
      ),
  );

  defineTool(
    server,
    'get_todays_meals',
    {
      title: "Get today's meals",
      description: "Gets today's meal plan entries.",
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    () => client.get(`${PLANS}/today`),
  );

  defineTool(
    server,
    'create_mealplan_entry',
    {
      title: 'Create meal plan entry',
      description: 'Adds a meal to the plan: either a recipe, or a title and note for something without one.',
      inputSchema: {
        date: dateSchema,
        entry_type: entryType.optional().describe('dinner by default'),
        recipe_id: idSchema.optional().describe('The recipe id, not its slug'),
        title: z.string().optional(),
        text: z.string().optional(),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    (args) =>
      client.post(
        PLANS,
        defined({
          date: args.date,
          entryType: args.entry_type ?? 'dinner',
          recipeId: args.recipe_id,
          title: args.title,
          text: args.text,
        }),
      ),
  );

  defineTool(
    server,
    'create_random_mealplan_entry',
    {
      title: 'Create random meal plan entry',
      description: "Lets Mealie pick a recipe for a date, following the household's meal plan rules.",
      inputSchema: { date: dateSchema, entry_type: entryType.optional().describe('dinner by default') },
      annotations: WRITE_ANNOTATIONS,
    },
    ({ date, entry_type }) => client.post(`${PLANS}/random`, { date, entryType: entry_type ?? 'dinner' }),
  );

  defineTool(
    server,
    'update_mealplan_entry',
    {
      title: 'Update meal plan entry',
      description: 'Changes the given fields of a meal plan entry.',
      inputSchema: {
        id: entryId,
        date: dateSchema.optional(),
        entry_type: entryType.optional(),
        recipe_id: idSchema.optional(),
        title: z.string().optional(),
        text: z.string().optional(),
      },
      annotations: UPDATE_ANNOTATIONS,
    },
    ({ id, entry_type, recipe_id, ...rest }) =>
      mergePut(client, `${PLANS}/${id}`, { ...rest, entryType: entry_type, recipeId: recipe_id }),
  );

  defineTool(
    server,
    'delete_mealplan_entry',
    {
      title: 'Delete meal plan entry',
      description: 'Removes an entry from the meal plan.',
      inputSchema: { id: entryId },
      annotations: DELETE_ANNOTATIONS,
    },
    async ({ id }) => {
      await client.delete(`${PLANS}/${id}`);
      return { deleted: true, id };
    },
  );
}

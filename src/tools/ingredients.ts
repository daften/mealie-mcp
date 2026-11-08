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

export function registerIngredientTools(server: McpServer, client: MealieClient): void {
  defineTool(
    server,
    'parse_ingredients',
    {
      title: 'Parse ingredients',
      description:
        "Uses Mealie's parser to split free-text ingredient lines into quantity, unit and food. It only reads: nothing is created, so a food or unit Mealie does not know may come back without an id. Create it with create_food / create_unit before using it in create_recipe.",
      inputSchema: {
        ingredients: z.array(z.string().min(1)).min(1),
        parser: z.enum(['nlp', 'brute', 'openai']).optional().describe('nlp by default'),
      },
      annotations: { ...READ_ANNOTATIONS, idempotentHint: true },
    },
    ({ ingredients, parser }) => client.post('/parser/ingredients', { ingredients, parser: parser ?? 'nlp' }),
  );

  for (const kind of [
    { singular: 'food', plural: 'foods', path: '/foods' },
    { singular: 'unit', plural: 'units', path: '/units' },
  ]) {
    defineTool(
      server,
      `list_${kind.plural}`,
      {
        title: `List ${kind.plural}`,
        description: `Lists or searches ${kind.plural} in Mealie's shared vocabulary.`,
        inputSchema: { search: z.string().optional(), ...paginationShape },
        annotations: READ_ANNOTATIONS,
      },
      async (args) =>
        shapePage(await client.get<Paginated>(kind.path, { ...paginationQuery(args), search: args.search })),
    );

    defineTool(
      server,
      `create_${kind.singular}`,
      {
        title: `Create ${kind.singular}`,
        description: `Adds a ${kind.singular} to Mealie's shared vocabulary.`,
        inputSchema: {
          name: z.string().min(1),
          plural_name: z.string().optional(),
          description: z.string().optional(),
          ...(kind.singular === 'unit' ? { abbreviation: z.string().optional() } : {}),
        },
        annotations: WRITE_ANNOTATIONS,
      },
      (args) =>
        client.post(
          kind.path,
          defined({
            name: args.name,
            pluralName: args.plural_name,
            description: args.description,
            abbreviation: (args as { abbreviation?: string }).abbreviation,
          }),
        ),
    );

    defineTool(
      server,
      `update_${kind.singular}`,
      {
        title: `Update ${kind.singular}`,
        description: `Changes the given fields of a ${kind.singular}.`,
        inputSchema: {
          id: idSchema,
          name: z.string().min(1).optional(),
          plural_name: z.string().optional(),
          description: z.string().optional(),
          ...(kind.singular === 'unit' ? { abbreviation: z.string().optional() } : {}),
        },
        annotations: UPDATE_ANNOTATIONS,
      },
      ({ id, ...args }) =>
        mergePut(client, `${kind.path}/${id}`, {
          name: args.name,
          pluralName: args.plural_name,
          description: args.description,
          abbreviation: (args as { abbreviation?: string }).abbreviation,
        }),
    );

    defineTool(
      server,
      `delete_${kind.singular}`,
      {
        title: `Delete ${kind.singular}`,
        description: `Permanently deletes a ${kind.singular}. Ingredients using it lose the link.`,
        inputSchema: { id: idSchema },
        annotations: DELETE_ANNOTATIONS,
      },
      async ({ id }) => {
        await client.delete(`${kind.path}/${id}`);
        return { deleted: true, id };
      },
    );
  }
}

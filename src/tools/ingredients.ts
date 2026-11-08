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
  type ToolShape,
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

  const aliasesSchema = z
    .array(z.string().min(1))
    .optional()
    .describe('Other names that should resolve to this one when parsing ingredients. Replaces the whole alias list.');

  for (const kind of [
    { singular: 'food', plural: 'foods', path: '/foods' },
    { singular: 'unit', plural: 'units', path: '/units' },
  ]) {
    const isUnit = kind.singular === 'unit';
    // Only units have these; foods ignore them in Mealie, so they stay out of the food tools' schemas.
    const unitShape: ToolShape = isUnit
      ? {
          abbreviation: z.string().optional().describe('Short form, such as "kg"'),
          plural_abbreviation: z.string().optional().describe('Short form for quantities above one'),
          use_abbreviation: z
            .boolean()
            .optional()
            .describe('Show the short form in recipes ("1 kg") instead of the full name ("1 kilogram")'),
          fraction: z
            .boolean()
            .optional()
            .describe(
              'Show quantities as fractions. Mealie defaults to true, so 1.8 kg reads "1 4/5"; false keeps 1.8',
            ),
        }
      : {};
    const fieldsOf = (args: Record<string, unknown>) => ({
      name: args.name,
      pluralName: args.plural_name,
      description: args.description,
      aliases: (args.aliases as string[] | undefined)?.map((name) => ({ name })),
      abbreviation: args.abbreviation,
      pluralAbbreviation: args.plural_abbreviation,
      useAbbreviation: args.use_abbreviation,
      fraction: args.fraction,
    });

    defineTool(
      server,
      `list_${kind.plural}`,
      {
        title: `List ${kind.plural}`,
        description: `Lists or searches ${kind.plural} in Mealie's shared vocabulary. Each item has its id${
          isUnit ? ', abbreviations, fraction and use_abbreviation settings' : ''
        } and aliases. \`search\` is free text handled by Mealie; it is certain to look at the name, and whether it also matches plural names and aliases is up to Mealie, so try the plural or the alias too before concluding something is missing.`,
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
        description: `Adds a ${kind.singular} to Mealie's shared vocabulary. Recipes reference it by id, so create it here before using it in an ingredient.`,
        inputSchema: {
          name: z.string().min(1),
          plural_name: z.string().optional(),
          description: z.string().optional(),
          aliases: aliasesSchema,
          ...unitShape,
        },
        annotations: WRITE_ANNOTATIONS,
      },
      (args) => client.post(kind.path, defined(fieldsOf(args))),
    );

    defineTool(
      server,
      `update_${kind.singular}`,
      {
        title: `Update ${kind.singular}`,
        description: `Changes the given fields of a ${kind.singular} and leaves the others alone.`,
        inputSchema: {
          id: idSchema,
          name: z.string().min(1).optional(),
          plural_name: z.string().optional(),
          description: z.string().optional(),
          aliases: aliasesSchema,
          ...unitShape,
        },
        annotations: UPDATE_ANNOTATIONS,
      },
      ({ id, ...args }) => mergePut(client, `${kind.path}/${id}`, fieldsOf(args)),
    );

    defineTool(
      server,
      `merge_${kind.plural}`,
      {
        title: `Merge ${kind.plural}`,
        description: `Merges one ${kind.singular} into another. from_id disappears and every ingredient that used it moves to to_id, so recipes keep their links. Use this for near-duplicates instead of delete_${kind.singular}, which unlinks the ingredients. Cannot be undone.`,
        inputSchema: {
          from_id: idSchema.describe(`The ${kind.singular} to remove`),
          to_id: idSchema.describe(`The ${kind.singular} to keep`),
        },
        annotations: DELETE_ANNOTATIONS,
      },
      async ({ from_id, to_id }) => {
        if (from_id === to_id) throw new Error('from_id and to_id are the same; there is nothing to merge.');
        const body = isUnit ? { fromUnit: from_id, toUnit: to_id } : { fromFood: from_id, toFood: to_id };
        await client.put(`${kind.path}/merge`, body);
        return { merged: true, from_id, to_id };
      },
    );

    defineTool(
      server,
      `delete_${kind.singular}`,
      {
        title: `Delete ${kind.singular}`,
        description: `Permanently deletes a ${kind.singular}. Ingredients using it lose the link; to keep them, use merge_${kind.plural} instead.`,
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

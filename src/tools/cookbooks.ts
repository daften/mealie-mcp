import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MealieClient } from '../client.js';
import { DELETE_ANNOTATIONS, READ_ANNOTATIONS, UPDATE_ANNOTATIONS, WRITE_ANNOTATIONS } from './_annotations.js';
import {
  defineTool,
  idSchema,
  mergePut,
  type Paginated,
  paginationQuery,
  paginationShape,
  shapePage,
} from './_helpers.js';

const COOKBOOK_PATH = '/households/cookbooks';

// The field names Mealie's own cookbook editor writes into a filter.
const FILTER_FIELDS = {
  categories: 'recipe_category.id',
  tags: 'tags.id',
  tools: 'tools.id',
  foods: 'recipe_ingredient.food.id',
} as const;

const idList = (what: string, source: string) =>
  z.array(idSchema).min(1).optional().describe(`${what} IDs, from ${source}`);

const filterShape = {
  categories: idList('Category', 'list_categories'),
  tags: idList('Tag', 'list_tags'),
  tools: idList('Recipe tool', 'list_recipe_tools'),
  foods: idList('Food', 'list_foods'),
  match: z
    .enum(['any', 'all'])
    .optional()
    .describe('Per filter: a recipe needs any one of the given IDs (default) or every one of them'),
  query_filter_string: z
    .string()
    .optional()
    .describe(
      'Raw Mealie query filter, for anything the fields above cannot say. Cannot be combined with them. An empty string removes the filter.',
    ),
};

type FilterArgs = {
  categories?: string[];
  tags?: string[];
  tools?: string[];
  foods?: string[];
  match?: 'any' | 'all';
  query_filter_string?: string;
};

/** Builds Mealie's `queryFilterString` from the structured fields; undefined when the caller gave no filter. */
export function buildQueryFilter(args: FilterArgs): string | undefined {
  const clauses = (Object.keys(FILTER_FIELDS) as Array<keyof typeof FILTER_FIELDS>).flatMap((key) => {
    const ids = args[key];
    if (!ids?.length) return [];
    const operator = args.match === 'all' ? 'CONTAINS ALL' : 'IN';
    return [`${FILTER_FIELDS[key]} ${operator} ${JSON.stringify(ids)}`];
  });
  if (args.query_filter_string !== undefined) {
    if (clauses.length > 0) {
      throw new Error('Give either query_filter_string or categories/tags/tools/foods, not both.');
    }
    return args.query_filter_string;
  }
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

export function registerCookbookTools(server: McpServer, client: MealieClient): void {
  defineTool(
    server,
    'list_cookbooks',
    {
      title: 'List cookbooks',
      description:
        'Lists the household’s cookbooks. A cookbook is a saved recipe filter, so each one shows its query_filter_string.',
      inputSchema: { ...paginationShape },
      annotations: READ_ANNOTATIONS,
    },
    async (args) => shapePage(await client.get<Paginated>(COOKBOOK_PATH, paginationQuery(args))),
  );

  defineTool(
    server,
    'get_cookbook',
    {
      title: 'Get cookbook',
      description: 'Gets one cookbook, including its recipe filter.',
      inputSchema: { id: idSchema },
      annotations: READ_ANNOTATIONS,
    },
    ({ id }) => client.get(`${COOKBOOK_PATH}/${id}`),
  );

  defineTool(
    server,
    'create_cookbook',
    {
      title: 'Create cookbook',
      description:
        'Creates a cookbook: a named, saved recipe filter. For a "Freezer menu" of everything tagged freezer, create or find the tag, then pass its ID in tags. Recipes are matched by the filter and never added by hand.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        public: z.boolean().optional().describe('Visible without signing in, when the household allows it'),
        position: z.number().int().min(1).optional().describe('Order among cookbooks, starting at 1'),
        ...filterShape,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    ({ name, description, public: isPublic, position, ...filter }) =>
      client.post(COOKBOOK_PATH, {
        name,
        description: description ?? '',
        public: isPublic ?? false,
        position: position ?? 1,
        queryFilterString: buildQueryFilter(filter) ?? '',
      }),
  );

  defineTool(
    server,
    'update_cookbook',
    {
      title: 'Update cookbook',
      description:
        'Changes the given fields of a cookbook and leaves the others alone. Giving any filter field replaces the whole existing filter.',
      inputSchema: {
        id: idSchema,
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        public: z.boolean().optional(),
        position: z.number().int().min(1).optional(),
        ...filterShape,
      },
      annotations: UPDATE_ANNOTATIONS,
    },
    ({ id, name, description, public: isPublic, position, ...filter }) =>
      mergePut(client, `${COOKBOOK_PATH}/${id}`, {
        name,
        description,
        public: isPublic,
        position,
        queryFilterString: buildQueryFilter(filter),
      }),
  );

  defineTool(
    server,
    'delete_cookbook',
    {
      title: 'Delete cookbook',
      description: 'Permanently deletes a cookbook. The recipes it showed are not touched.',
      inputSchema: { id: idSchema },
      annotations: DELETE_ANNOTATIONS,
    },
    async ({ id }) => {
      await client.delete(`${COOKBOOK_PATH}/${id}`);
      return { deleted: true, id };
    },
  );
}

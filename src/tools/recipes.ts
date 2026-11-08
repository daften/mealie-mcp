import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MealieClient } from '../client.js';
import { DELETE_ANNOTATIONS, READ_ANNOTATIONS, UPDATE_ANNOTATIONS, WRITE_ANNOTATIONS } from './_annotations.js';
import {
  defined,
  defineTool,
  type Paginated,
  paginationQuery,
  paginationShape,
  shapePage,
  slugSchema,
} from './_helpers.js';

type RecipeSummary = Record<string, unknown> & {
  tags?: Array<{ name: string }> | null;
  recipeCategory?: Array<{ name: string }> | null;
  tools?: Array<{ name: string }> | null;
};

/** Search results carry whole summaries; these are the fields worth the tokens when choosing a recipe. */
export function summarizeRecipe(recipe: RecipeSummary) {
  return {
    id: recipe.id,
    slug: recipe.slug,
    name: recipe.name,
    description: recipe.description,
    rating: recipe.rating,
    servings: recipe.recipeServings,
    total_time: recipe.totalTime,
    last_made: recipe.lastMade,
    categories: recipe.recipeCategory?.map((c) => c.name) ?? [],
    tags: recipe.tags?.map((t) => t.name) ?? [],
    tools: recipe.tools?.map((t) => t.name) ?? [],
  };
}

type WrittenRecipe = Record<string, unknown> & {
  tags?: Array<{ name: string }> | null;
  recipeIngredient?: unknown[] | null;
};

/**
 * Mealie answers a create or update with the whole recipe, every food and unit object included: hundreds of
 * lines for one dish. The caller only needs to know it worked and which recipe it touched; get_recipe has the rest.
 */
export function summarizeWrittenRecipe(recipe: WrittenRecipe) {
  return {
    id: recipe.id,
    slug: recipe.slug,
    name: recipe.name,
    servings: recipe.recipeServings,
    total_time: recipe.totalTime,
    tags: recipe.tags?.map((t) => t.name) ?? [],
    ingredient_count: recipe.recipeIngredient?.length ?? 0,
    rating: recipe.rating,
    has_image: Boolean(recipe.image),
  };
}

const organizerRef = z.looseObject({ id: z.uuid(), name: z.string(), slug: z.string() });

const ingredient = z.looseObject({
  note: z
    .string()
    .optional()
    .describe(
      'Free text. An ingredient with no unit, food or quantity goes here alone, for example "salt to taste" or "two leeks". With a food it adds detail, for example "finely chopped"',
    ),
  quantity: z
    .number()
    .optional()
    .describe('A decimal number: write 0.5 or 1.5, never "1/2". Leave it out when the ingredient has no amount'),
  unit: z
    .looseObject({ id: z.uuid(), name: z.string() })
    .nullable()
    .optional()
    .describe('Needs both id and name, taken from list_units. Create a missing unit with create_unit first'),
  food: z
    .looseObject({ id: z.uuid(), name: z.string() })
    .nullable()
    .optional()
    .describe('Needs both id and name, taken from list_foods. Create a missing food with create_food first'),
  title: z.string().nullable().optional().describe('Section heading shown above this ingredient'),
  originalText: z.string().nullable().optional(),
});

const step = z.looseObject({ title: z.string().optional(), text: z.string() });

const recipeFields = {
  description: z.string().optional(),
  recipe_servings: z
    .number()
    .optional()
    .describe('How many portions the ingredient quantities are written for, a number such as 4. Mealie scales from it'),
  recipe_yield: z
    .string()
    .optional()
    .describe('What the recipe makes, as free text shown as is, e.g. "2 loaves". Separate from recipe_servings'),
  total_time: z
    .string()
    .optional()
    .describe(
      'Free text, e.g. "1 hour 30 minutes". Never derived: Mealie does not add prep_time and cook_time, so set it yourself or it stays empty',
    ),
  prep_time: z.string().optional().describe('Free text, e.g. "20 minutes"'),
  cook_time: z.string().optional().describe('Free text, e.g. "45 minutes"'),
  org_url: z.url().optional().describe('Original source URL'),
  ingredients: z.array(ingredient).optional().describe('Replaces the whole ingredient list'),
  instructions: z.array(step).optional().describe('Replaces all instruction steps'),
  notes: z
    .array(z.object({ title: z.string(), text: z.string() }))
    .optional()
    .describe('Replaces all notes'),
  nutrition: z
    .record(z.string(), z.string().nullable())
    .optional()
    .describe('e.g. {"calories": "250", "proteinContent": "12"}'),
  categories: z.array(organizerRef).optional().describe('Full objects from list_categories. Replaces all categories'),
  tags: z.array(organizerRef).optional().describe('Full objects from list_tags. Replaces all tags'),
  tools: z.array(organizerRef).optional().describe('Full objects from list_recipe_tools. Replaces all tools'),
  settings: z
    .looseObject({
      public: z.boolean().optional(),
      showNutrition: z.boolean().optional(),
      showAssets: z.boolean().optional(),
    })
    .optional(),
};

type RecipeFieldArgs = {
  [K in keyof typeof recipeFields]?: z.infer<(typeof recipeFields)[K]>;
};

export function toRecipePatch(args: RecipeFieldArgs & { name?: string }): Record<string, unknown> {
  return defined({
    name: args.name,
    description: args.description,
    recipeServings: args.recipe_servings,
    recipeYield: args.recipe_yield,
    totalTime: args.total_time,
    prepTime: args.prep_time,
    cookTime: args.cook_time,
    orgURL: args.org_url,
    recipeIngredient: args.ingredients,
    recipeInstructions: args.instructions,
    notes: args.notes,
    nutrition: args.nutrition,
    recipeCategory: args.categories,
    tags: args.tags,
    tools: args.tools,
    settings: args.settings,
  });
}

export function registerRecipeTools(server: McpServer, client: MealieClient): void {
  defineTool(
    server,
    'get_current_user',
    {
      title: 'Get current user',
      description: 'Shows which Mealie account this connection acts as, with its group and household.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async () => {
      const user = await client.get<Record<string, unknown>>('/users/self');
      return {
        id: user.id,
        username: user.username,
        full_name: user.fullName,
        email: user.email,
        admin: user.admin,
        group: user.group,
        household: user.household,
      };
    },
  );

  defineTool(
    server,
    'search_recipes',
    {
      title: 'Search recipes',
      description:
        'Searches recipes by free text (`search`) and by `categories`, `tags`, `tools` and `foods`. Each filter takes IDs or slugs. Several values in one filter mean any of them, unless require_all is true. Returns summaries; use get_recipe for full details.',
      inputSchema: {
        search: z.string().optional().describe('Free text search'),
        categories: z.array(z.string()).optional().describe('Category IDs or slugs'),
        tags: z.array(z.string()).optional().describe('Tag IDs or slugs'),
        tools: z.array(z.string()).optional().describe('Tool IDs or slugs'),
        foods: z.array(z.string()).optional().describe('Food IDs or slugs'),
        require_all: z
          .boolean()
          .optional()
          .describe('Require every given value in each filter (a recipe needs all the tags) instead of any one'),
        order_by: z.string().optional().describe('Field such as name, rating, created_at or last_made'),
        order_direction: z.enum(['asc', 'desc']).optional(),
        ...paginationShape,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (args) => {
      const response = await client.get<Paginated<RecipeSummary>>('/recipes', {
        ...paginationQuery(args),
        search: args.search,
        categories: args.categories,
        tags: args.tags,
        tools: args.tools,
        foods: args.foods,
        requireAllCategories: args.require_all,
        requireAllTags: args.require_all,
        requireAllTools: args.require_all,
        requireAllFoods: args.require_all,
        orderBy: args.order_by,
        orderDirection: args.order_direction,
      });
      return shapePage(response, summarizeRecipe);
    },
  );

  defineTool(
    server,
    'get_recipe',
    {
      title: 'Get recipe',
      description: 'Gets one recipe in full, including ingredients, instructions and nutrition.',
      inputSchema: { slug: slugSchema },
      annotations: READ_ANNOTATIONS,
    },
    ({ slug }) => client.get(`/recipes/${slug}`),
  );

  defineTool(
    server,
    'create_recipe',
    {
      title: 'Create recipe',
      description:
        'Creates a recipe from structured data. Ingredients with a food or unit need its id and name from list_foods / list_units; create missing ones first with create_food / create_unit. Quantities are decimals, and an ingredient that is not split into food and unit goes in note. To import from a web page, use import_recipe_from_url. Returns a short summary (id, slug, name, servings, tags, ingredient count, rating, image present); get_recipe has the full recipe.',
      inputSchema: { name: z.string().min(1), ...recipeFields },
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) => {
      const slug = await client.post<string>('/recipes', { name: args.name });
      const { name: _name, ...fields } = toRecipePatch(args);
      if (Object.keys(fields).length === 0) return { slug, name: args.name };
      return summarizeWrittenRecipe(await client.patch<WrittenRecipe>(`/recipes/${slug}`, fields));
    },
  );

  defineTool(
    server,
    'import_recipe_from_url',
    {
      title: 'Import recipe from URL',
      description:
        'Has Mealie scrape a recipe web page and create a recipe from it. Returns the new slug; use get_recipe to review what was imported. Some sites block the scraper (ah.be answers 403): the call then fails with an error, and the recipe has to be added with create_recipe instead. Mealie returns no import warnings, so check the result.',
      inputSchema: {
        url: z.url(),
        include_tags: z.boolean().optional().describe('Also import tags found on the page'),
        include_categories: z.boolean().optional().describe('Also import categories found on the page'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) => ({
      slug: await client.post<string>(
        '/recipes/create/url',
        defined({ url: args.url, includeTags: args.include_tags, includeCategories: args.include_categories }),
      ),
    }),
  );

  defineTool(
    server,
    'update_recipe',
    {
      title: 'Update recipe',
      description:
        'Changes the given fields of a recipe and leaves the rest alone. List fields (ingredients, instructions, notes, categories, tags, tools) are replaced as a whole, so send the complete list. Ingredient rules are the same as in create_recipe: food and unit need id and name from list_foods / list_units, quantities are decimals, unparsed text goes in note. Returns a short summary; get_recipe has the full recipe.',
      inputSchema: { slug: slugSchema, name: z.string().min(1).optional(), ...recipeFields },
      annotations: UPDATE_ANNOTATIONS,
    },
    async ({ slug, ...fields }) =>
      summarizeWrittenRecipe(await client.patch<WrittenRecipe>(`/recipes/${slug}`, toRecipePatch(fields))),
  );

  defineTool(
    server,
    'duplicate_recipe',
    {
      title: 'Duplicate recipe',
      description: 'Copies a recipe, optionally under a new name.',
      inputSchema: { slug: slugSchema, name: z.string().optional() },
      annotations: WRITE_ANNOTATIONS,
    },
    ({ slug, name }) => client.post(`/recipes/${slug}/duplicate`, defined({ name })),
  );

  defineTool(
    server,
    'mark_recipe_made',
    {
      title: 'Mark recipe made',
      description: 'Records that a recipe was made, today by default.',
      inputSchema: { slug: slugSchema, timestamp: z.iso.datetime({ offset: true }).optional() },
      annotations: UPDATE_ANNOTATIONS,
    },
    ({ slug, timestamp }) =>
      client.patch(`/recipes/${slug}/last-made`, { timestamp: timestamp ?? new Date().toISOString() }),
  );

  defineTool(
    server,
    'rate_recipe',
    {
      title: 'Rate recipe',
      description:
        "Sets the rating (0 to 5) or favorite flag of the account this connection acts as, and replaces that account's earlier rating. Ratings are per user: there is no way to read or set another user's rating.",
      inputSchema: {
        slug: slugSchema,
        rating: z.number().min(0).max(5).optional(),
        is_favorite: z.boolean().optional(),
      },
      annotations: UPDATE_ANNOTATIONS,
    },
    // Ratings are per user: a `rating` sent with the recipe itself is silently ignored.
    async ({ slug, rating, is_favorite }) => {
      const user = await client.get<{ id: string }>('/users/self');
      await client.post(`/users/${user.id}/ratings/${slug}`, defined({ rating, isFavorite: is_favorite }));
      return { updated: true, slug, rating, is_favorite };
    },
  );

  defineTool(
    server,
    'delete_recipe',
    {
      title: 'Delete recipe',
      description: 'Permanently deletes a recipe.',
      inputSchema: { slug: slugSchema },
      annotations: DELETE_ANNOTATIONS,
    },
    async ({ slug }) => {
      await client.delete(`/recipes/${slug}`);
      return { deleted: true, slug };
    },
  );
}

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

const KINDS = [
  { singular: 'category', plural: 'categories', path: '/organizers/categories' },
  { singular: 'tag', plural: 'tags', path: '/organizers/tags' },
  // "tool" alone would read as an MCP tool in a tool list.
  { singular: 'recipe_tool', plural: 'recipe_tools', path: '/organizers/tools' },
];

export function registerOrganizerTools(server: McpServer, client: MealieClient): void {
  for (const kind of KINDS) {
    const label = kind.plural.replace('_', ' ');
    const one = kind.singular.replace('_', ' ');

    defineTool(
      server,
      `list_${kind.plural}`,
      {
        title: `List ${label}`,
        description: `Lists or searches ${label}.`,
        inputSchema: { search: z.string().optional(), ...paginationShape },
        annotations: READ_ANNOTATIONS,
      },
      async (args) =>
        shapePage(await client.get<Paginated>(kind.path, { ...paginationQuery(args), search: args.search })),
    );

    defineTool(
      server,
      `list_unused_${kind.plural}`,
      {
        title: `List unused ${label}`,
        description: `Lists ${label} that no recipe uses.`,
        inputSchema: {},
        annotations: READ_ANNOTATIONS,
      },
      () => client.get(`${kind.path}/empty`),
    );

    defineTool(
      server,
      `create_${kind.singular}`,
      {
        title: `Create ${one}`,
        description: `Creates a ${one}.`,
        inputSchema: { name: z.string().min(1) },
        annotations: WRITE_ANNOTATIONS,
      },
      ({ name }) => client.post(kind.path, { name }),
    );

    defineTool(
      server,
      `rename_${kind.singular}`,
      {
        title: `Rename ${one}`,
        description: `Renames a ${one}.`,
        inputSchema: { id: idSchema, name: z.string().min(1) },
        annotations: UPDATE_ANNOTATIONS,
      },
      ({ id, name }) => mergePut(client, `${kind.path}/${id}`, { name }),
    );

    defineTool(
      server,
      `delete_${kind.singular}`,
      {
        title: `Delete ${one}`,
        description: `Permanently deletes a ${one} and removes it from every recipe.`,
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

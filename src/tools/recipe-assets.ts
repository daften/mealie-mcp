import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MealieClient } from '../client.js';
import { DELETE_ANNOTATIONS, WRITE_ANNOTATIONS } from './_annotations.js';
import { decodeBase64, defineTool, slugSchema } from './_helpers.js';

const extension = z.string().regex(/^[A-Za-z0-9]{1,10}$/, 'File extension without the dot, e.g. jpg');

export function registerRecipeAssetTools(server: McpServer, client: MealieClient): void {
  defineTool(
    server,
    'set_recipe_image_from_url',
    {
      title: 'Set recipe image from URL',
      description: 'Has Mealie download an image and use it as the recipe image.',
      inputSchema: { slug: slugSchema, url: z.url() },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ slug, url }) => {
      await client.post(`/recipes/${slug}/image`, { url });
      return { updated: true, slug };
    },
  );

  defineTool(
    server,
    'upload_recipe_image',
    {
      title: 'Upload recipe image',
      description: 'Replaces the recipe image with an uploaded file, up to about 12 MB.',
      inputSchema: { slug: slugSchema, image_base64: z.string().min(1), extension },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ slug, image_base64, extension: ext }) => {
      const form = new FormData();
      form.set('image', new Blob([decodeBase64(image_base64, 'image_base64')]), `image.${ext}`);
      form.set('extension', ext);
      return client.sendForm('PUT', `/recipes/${slug}/image`, form);
    },
  );

  defineTool(
    server,
    'delete_recipe_image',
    {
      title: 'Delete recipe image',
      description: 'Removes the image from a recipe.',
      inputSchema: { slug: slugSchema },
      annotations: DELETE_ANNOTATIONS,
    },
    async ({ slug }) => {
      await client.delete(`/recipes/${slug}/image`);
      return { deleted: true, slug };
    },
  );

  defineTool(
    server,
    'upload_recipe_asset',
    {
      title: 'Upload recipe asset',
      description: 'Attaches a file, such as a PDF of the original recipe, up to about 12 MB.',
      inputSchema: {
        slug: slugSchema,
        name: z.string().min(1).describe('Display name'),
        icon: z.string().optional().describe('Material Design icon name, mdi-file by default'),
        extension,
        file_base64: z.string().min(1),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ slug, name, icon, extension: ext, file_base64 }) => {
      const form = new FormData();
      form.set('name', name);
      form.set('icon', icon ?? 'mdi-file');
      form.set('extension', ext);
      form.set('file', new Blob([decodeBase64(file_base64, 'file_base64')]), `${name}.${ext}`);
      return client.sendForm('POST', `/recipes/${slug}/assets`, form);
    },
  );
}

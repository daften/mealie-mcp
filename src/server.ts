import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MealieClient } from './client.js';
import { registerAllTools, type ToolFilterOptions } from './tools/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export function createServer(client: MealieClient, filterOptions: ToolFilterOptions = {}): McpServer {
  const server = new McpServer({ name: 'mealie-mcp', version: pkg.version });
  registerAllTools(server, client, filterOptions);
  return server;
}

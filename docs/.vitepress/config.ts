import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Mealie MCP',
  description: 'MCP server for the Mealie recipe manager',
  themeConfig: {
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'stdio', link: '/guide/stdio' },
          { text: 'Docker and API keys', link: '/guide/docker' },
          { text: 'Login form', link: '/guide/login-form' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Environment variables', link: '/reference/env-vars' },
          { text: 'Tools', link: '/reference/tools' },
        ],
      },
    ],
  },
});

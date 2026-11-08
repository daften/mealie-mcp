import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'mealie-mcp',
  description: 'Connect any MCP-compatible AI assistant to your Mealie recipe manager.',
  base: '/mealie-mcp/',
  srcExclude: ['superpowers/**'],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Reference', link: '/reference/tools' },
      { text: 'Contributing', link: '/contributing/' },
      { text: 'GitHub', link: 'https://github.com/daften/mealie-mcp' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Overview', link: '/guide/' },
            { text: 'npm + stdio', link: '/guide/stdio' },
            { text: 'Docker and API keys', link: '/guide/docker' },
            { text: 'Login form', link: '/guide/login-form' },
            { text: 'Git checkout', link: '/guide/git-checkout' },
            { text: 'Claude Desktop', link: '/guide/claude-desktop' },
            { text: 'Nightly builds', link: '/guide/nightly' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Available tools', link: '/reference/tools' },
            { text: 'Tool filtering', link: '/reference/filtering' },
            { text: 'Environment variables', link: '/reference/env-vars' },
          ],
        },
      ],
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Development setup', link: '/contributing/' },
            { text: 'Adding a new tool', link: '/contributing/new-tool' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/daften/mealie-mcp' }],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/daften/mealie-mcp/edit/main/docs/:path',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Dieter Blomme',
    },
  },
})

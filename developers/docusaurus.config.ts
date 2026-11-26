import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

// The developer site for ZwoSocial bots (#330). Internal engineering notes
// stay in docs/; this is what someone building a bot reads.
const config: Config = {
  title: 'ZwoSocial Developers',
  tagline: 'Build bots for an end-to-end encrypted messenger',
  favicon: 'img/favicon.svg',
  // GitHub Pages by default; set both to serve it from another host.
  url: process.env.DEVELOPERS_URL ?? 'https://creadorlanda.github.io',
  baseUrl: process.env.DEVELOPERS_BASE_URL ?? '/yo/',
  organizationName: 'CreadorLanda',
  projectName: 'yo',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  // .md is plain CommonMark (JSON braces in examples stay text); .mdx is MDX.
  markdown: { format: 'detect', hooks: { onBrokenMarkdownLinks: 'throw' } },

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'pt'],
    localeConfigs: {
      en: { label: 'English', htmlLang: 'en' },
      pt: { label: 'Português', htmlLang: 'pt-PT' },
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/CreadorLanda/yo/edit/dev/developers/',
          // The Bot API is v1; a v2 would be cut with `docusaurus docs:version`.
          lastVersion: 'current',
          versions: { current: { label: 'v1', path: '' } },
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      { hashed: true, language: ['en', 'pt'], docsRouteBasePath: '/', indexBlog: false },
    ],
  ],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'ZwoSocial Developers',
      logo: { alt: 'ZwoSocial', src: 'img/favicon.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { to: '/api/reference', label: 'API', position: 'left' },
        { type: 'docsVersionDropdown', position: 'right' },
        { type: 'localeDropdown', position: 'right' },
        { href: 'https://github.com/CreadorLanda/yo/tree/dev/sdk', label: 'SDKs', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        { label: 'llms.txt', href: 'pathname:///llms.txt' },
        { label: 'GitHub', href: 'https://github.com/CreadorLanda/yo' },
      ],
    },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula, additionalLanguages: ['bash', 'json', 'go'] },
  } satisfies Preset.ThemeConfig,
};

export default config;

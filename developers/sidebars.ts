import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    { type: 'category', label: 'Concepts', collapsed: false, items: ['concepts/encryption', 'concepts/privacy-mode'] },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['guides/commands', 'guides/interactive-messages', 'guides/events', 'guides/integrations', 'guides/build-with-an-llm'],
    },
    { type: 'category', label: 'SDKs', items: ['sdks/typescript', 'sdks/go'] },
    { type: 'category', label: 'API', items: ['api/overview', 'api/reference'] },
    'safety',
    'changelog',
  ],
};

export default sidebars;

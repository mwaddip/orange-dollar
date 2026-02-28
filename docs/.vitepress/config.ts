import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Orange Dollar',
  description: 'Bitcoin-native algorithmic stablecoin powered by Minimal Djed on OPNet.',
  srcExclude: ['plans/**'],
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap', rel: 'stylesheet' }],
  ],
  themeConfig: {
    logo: '/od-logo.svg',
    nav: [
      { text: 'App', link: 'https://app.orangedollar.xyz' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is Orange Dollar?', link: '/introduction/what-is-od' },
          { text: 'How It Works', link: '/introduction/how-it-works' },
          { text: 'Contract Addresses', link: '/introduction/addresses' },
        ],
      },
      {
        text: 'Using OD',
        items: [
          { text: 'Getting Started', link: '/using-od/getting-started' },
          { text: 'Minting OD', link: '/using-od/minting' },
          { text: 'Burning OD', link: '/using-od/burning' },
        ],
      },
      {
        text: 'Using ORC',
        items: [
          { text: 'Why ORC?', link: '/using-orc/why-orc' },
          { text: 'Minting ORC', link: '/using-orc/minting' },
          { text: 'Burning ORC', link: '/using-orc/burning' },
        ],
      },
      {
        text: 'Protocol',
        items: [
          { text: 'Reserve Ratio', link: '/protocol/reserve-ratio' },
          { text: 'TWAP Oracle', link: '/protocol/twap' },
          { text: 'Fees', link: '/protocol/fees' },
          { text: 'Bootstrap Phases', link: '/protocol/bootstrap-phases' },
          { text: 'Bootstrap Guide', link: '/protocol/bootstrap-guide' },
          { text: 'Admin Functions', link: '/protocol/admin' },
        ],
      },
      {
        text: 'Security & Governance',
        items: [
          { text: 'Djed Formalism', link: '/security/djed' },
          { text: 'PERMAFROST Multisig', link: '/security/permafrost' },
          { text: 'Risk Factors', link: '/security/risks' },
        ],
      },
      {
        text: 'FAQ',
        items: [
          { text: 'Frequently Asked Questions', link: '/faq' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mwaddip/orange-dollar' },
    ],
    search: {
      provider: 'local',
    },
  },
});

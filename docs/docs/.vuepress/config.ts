import { ThemeConfig } from "vuepress-theme-vt";
import { defineConfig4CustomTheme } from "vuepress/config";

export default defineConfig4CustomTheme<ThemeConfig>((ctx) => ({
  theme: "vt",
  title: "VT",
  themeConfig: {
    enableDarkMode: true,
    repo: "https://github.com/saltyAom/kingworld",
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "API", link: "/api/" },
    ],
    sidebar: {
      "/guide/": [
        {
          title: "Introduction",
          collapsable: false,
          children: ["/guide/"],
        },
        {
          title: "Guide",
          collapsable: true,
          children: [
            "/guide/handler",
            "/guide/lifecycle",
            "/guide/plugins",
            "/guide/routing",
            "/guide/store",
            "/guide/testing"
          ],
        },
        {
          title: "Reference",
          collapsable: false,
          children: [
            ['https://vuepress.vuejs.org/theme/default-theme-config.html', 'Default Theme Config'],
          ],
        },
      ],
      "/api/": [
        {
          title: "Config",
          path: "/api/",
          collapsable: false,
          children: [
            "/api/config-theme",
            "/api/config-frontmatter",
            "/api/config-home",
          ],
        },
      ],
    },
    codeSwitcher: {
      groups: {
        default: { ts: 'TypeScript', js: 'JavaScript' },
        'plugin-usage': { tuple: 'Tuple', object: 'Object' },
      }
    },
    
  },
  plugins: [
    [
      'vuepress-plugin-typedoc', 
      {
        out: 'api',
        skipErrorChecking: true,
        tsconfig: '../tsconfig.json',
        entryPoints: ['../src/index.ts'],
        exclude: ['**/*.spec.ts'],
      }
    ]
  ]
}));

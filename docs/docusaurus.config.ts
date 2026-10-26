import type { UserThemeConfig } from "@docusaurus/theme-common";
import type { Config } from "@docusaurus/types";

const config: Config = {
  title: "Workspace",
  tagline:
    "An open, self-hosted analytics workspace for financial institutions to connect data, tools, and AI agents.",
  favicon: "img/logo.svg",
  url: "http://localhost:3000",
  baseUrl: "/",
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      {
        path: "content",
        routeBasePath: "/",
        sidebarPath: "./sidebars.ts",
      },
    ],
  ],
  themes: [
    ["@docusaurus/theme-classic", { customCss: "./src/css/custom.css" }],
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        docsDir: "content",
        docsRouteBasePath: "/",
        indexBlog: false,
        language: "en",
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],
  themeConfig: {
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
    navbar: {
      logo: {
        alt: "Workspace",
        src: "img/logo-horizontal-color.svg",
        srcDark: "img/logo-horizontal-white.svg",
        height: 26,
      },
      items: [
        { type: "docSidebar", sidebarId: "tutorials", label: "Tutorials", position: "left" },
        { type: "docSidebar", sidebarId: "howTo", label: "How-to guides", position: "left" },
        { type: "docSidebar", sidebarId: "reference", label: "Reference", position: "left" },
        { type: "docSidebar", sidebarId: "explanation", label: "Explanation", position: "left" },
      ],
    },
    footer: {
      copyright: "Licensed under the Apache License 2.0.",
    },
    prism: {
      additionalLanguages: ["bash", "json", "yaml", "docker"],
    },
  } satisfies UserThemeConfig,
};

export default config;

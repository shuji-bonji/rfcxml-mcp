import { defineConfig } from 'vitepress';

const REPO = 'https://github.com/shuji-bonji/rfcxml-mcp';

export default defineConfig({
  base: '/rfcxml-mcp/',
  title: 'rfcxml-mcp',
  description: 'MCP server for structured understanding of RFC documents via RFCXML',
  lastUpdated: false,
  cleanUrls: false,

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/install' },
          { text: 'Reference', link: '/reference/tools' },
          { text: 'Changelog', link: `${REPO}/blob/main/CHANGELOG.md` },
          { text: 'npm', link: 'https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp' },
        ],
        sidebar: [
          {
            text: 'Guide',
            items: [
              { text: 'Overview', link: '/' },
              { text: 'Install', link: '/guide/install' },
              { text: 'Accuracy and limits', link: '/guide/accuracy' },
            ],
          },
          {
            text: 'Reference',
            items: [
              { text: 'Tools', link: '/reference/tools' },
              { text: 'Server instructions', link: '/reference/instructions' },
              { text: 'Output examples', link: '/reference/examples' },
            ],
          },
        ],
        editLink: {
          pattern: `${REPO}/edit/main/docs/:path`,
          text: 'Edit this page on GitHub',
        },
        outline: { level: [2, 3] },
      },
    },
    ja: {
      label: '日本語',
      lang: 'ja',
      link: '/ja/',
      themeConfig: {
        nav: [
          { text: 'ガイド', link: '/ja/guide/install' },
          { text: 'リファレンス', link: '/ja/reference/tools' },
          { text: '変更履歴', link: `${REPO}/blob/main/CHANGELOG.md` },
          { text: 'npm', link: 'https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp' },
        ],
        sidebar: [
          {
            text: 'ガイド',
            items: [
              { text: '概要', link: '/ja/' },
              { text: '導入', link: '/ja/guide/install' },
              { text: '精度と制約', link: '/ja/guide/accuracy' },
            ],
          },
          {
            text: 'リファレンス',
            items: [
              { text: 'ツール', link: '/ja/reference/tools' },
              { text: 'サーバの instructions', link: '/ja/reference/instructions' },
              { text: '出力例', link: '/ja/reference/examples' },
            ],
          },
        ],
        editLink: {
          pattern: `${REPO}/edit/main/docs/:path`,
          text: 'GitHub でこのページを編集',
        },
        outline: { level: [2, 3], label: 'このページの内容' },
        docFooter: { prev: '前のページ', next: '次のページ' },
        returnToTopLabel: 'ページの先頭へ',
        sidebarMenuLabel: 'メニュー',
        darkModeSwitchLabel: '表示',
        langMenuLabel: '言語',
      },
    },
  },

  themeConfig: {
    socialLinks: [{ icon: 'github', link: REPO }],
    search: {
      provider: 'local',
      options: {
        locales: {
          ja: {
            translations: {
              button: { buttonText: '検索', buttonAriaLabel: '検索' },
              modal: {
                noResultsText: '該当なし',
                resetButtonTitle: '検索条件を消す',
                footer: { selectText: '選択', navigateText: '移動', closeText: '閉じる' },
              },
            },
          },
        },
      },
    },
  },
});

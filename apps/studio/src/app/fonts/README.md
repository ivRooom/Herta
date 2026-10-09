# fonts

トップページ(`page.tsx`)で使うフォント。ビルド時に外部へ接続しなくて済むよう、リポジトリに含めている。

| ファイル                | フォント                                 | 入手元       |
| ----------------------- | ---------------------------------------- | ------------ |
| `Geist-latin.woff2`     | Geist (可変ウェイト 100–900, latin)      | Google Fonts |
| `GeistMono-latin.woff2` | Geist Mono (可変ウェイト 100–900, latin) | Google Fonts |

どちらも SIL Open Font License 1.1 (https://openfontlicense.org) で配布されており、再配布できる。
日本語は含まれないため、CSSのフォールバック(Hiragino Sans / Noto Sans JP など)で表示される。

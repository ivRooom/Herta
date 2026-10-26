# MBTI share image fonts

共有リンクのOG画像(`route.tsx`)で使う日本語フォント。実行時に外部へ取得しないよう、描画し得る文字だけを収録したsubsetを同梱している。

| ファイル                          | フォント                  | 入手元       |
| --------------------------------- | ------------------------- | ------------ |
| `NotoSansJP-Regular-subset.ttf`   | Noto Sans JP 400 (subset) | Google Fonts |
| `NotoSansJP-ExtraBold-subset.ttf` | Noto Sans JP 800 (subset) | Google Fonts |

Noto Sans JP は SIL Open Font License 1.1 (https://openfontlicense.org) で配布されており、再配布できる。

## 再生成

タイプ名・軸ラベル・画像内の固定文言を変えると、`src/lib/mbti-share-preview.test.ts` が不足文字を報告する。
その場合は `mbtiShareImageRequiredCharacters()` の文字列を Google Fonts の `text=` パラメータへ渡し、
`https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400&text=...`(800も同様)が返すTTFで置き換える。

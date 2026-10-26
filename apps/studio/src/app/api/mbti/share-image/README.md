# MBTI share image fonts

共有リンクのOG画像(`route.tsx`)で使う日本語フォント。実行時に外部へ取得しないよう、描画し得る文字だけを収録したsubsetを同梱している。

| ファイル                          | フォント                  | 入手元       |
| --------------------------------- | ------------------------- | ------------ |
| `NotoSansJP-Regular-subset.ttf`   | Noto Sans JP 400 (subset) | Google Fonts |
| `NotoSansJP-ExtraBold-subset.ttf` | Noto Sans JP 800 (subset) | Google Fonts |

Noto Sans JP は SIL Open Font License 1.1 (https://openfontlicense.org) で配布されており、再配布できる。

## 再生成

タイプ名・軸ラベル・画像内の固定文言を変えると、`src/lib/mbti-share-preview.test.ts` が不足文字を報告する。
その場合は次の手順で両ウェイトを置き換える。

1. `mbtiShareImageRequiredCharacters()` の文字列をURLエンコードし、`text=` に渡して
   `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400&text=...`(800も同様)を取得する。
   これはフォント本体ではなくCSSを返す。
2. CSS内の `src: url(...) format('truetype')` のURLからフォント本体をダウンロードする。
   ブラウザのUser-Agentで取得するとwoff2が返ることがあるため、`curl` 等の既定UAで取得し、
   `format('truetype')` であることを確認する(`next/og` はwoff2を読めない)。
3. ダウンロードしたTTFで同梱ファイルを置き換え、テストが通ることを確認する。

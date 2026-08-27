# AI Tool & Artifact Runtime — Phase 1

Issue #345 の Phase 1 として、Herta AIが生成したコード/テキスト成果物をproviderやDiscordから独立したArtifactとして検証し、Discord attachmentとして返す基盤を定義する。

## Scope

Phase 1で実動作させるintentは次の2つ。

- `code_artifact`
- `file_artifact`

型として次も定義するが、Phase 1では実行しない。

- `code_execution`
- `image_generation`

通常会話/詳細回答のrouteもartifact runtime側では保持するが、既存会話surfaceを奪わない。

- `chat`
- `detailed_answer`

## Request flow

```text
Discord @mention
  -> Guild AI Plugin enabled + config.enabled=true
  -> server-side intent resolution
  -> existing AiFoundation / runtime snapshot
  -> responseMode=artifact
  -> server-authored artifact capability instructions
  -> strict artifact envelope parse
  -> Artifact validation
  -> Discord attachment delivery
```

provider/model/reasoning、rate limit、Guild quota、per-request cost guard、concurrency、timeoutは既存AiFoundation経路を利用する。Artifact生成のためにproviderを直接呼び出す経路は追加しない。

## Artifact domain

Artifact modelはprovider/Discord型に依存しない。

- `filename`
- `mimeType`
- `bytes`
- `size`
- `kind`
- optional safe metadata

任意filesystem pathは持たない。`size`はdeclared metadataではなく実bytesから計算する。

## Allowlist

Phase 1では次の組み合わせのみ許可する。

| Extension | MIME |
| --- | --- |
| `.py` | `text/x-python` |
| `.md` | `text/markdown` |
| `.txt` | `text/plain` |
| `.json` | `application/json` |
| `.yaml` | `application/yaml` |
| `.yml` | `application/yaml` |
| `.csv` | `text/csv` |

filenameはNFKC正規化後にbasenameとして検証し、`/`、`\\`、`..`、control characters、NUL、Windows reserved characters/names、encoded separatorを拒否する。

## Bounded configuration

既定値:

- max artifact bytes: `524288` (512 KiB)
- max artifact files: `3`

optional server-side overrides:

- `HERTA_AI_ARTIFACT_MAX_BYTES`
  - min: 1024
  - max: 8388608
- `HERTA_AI_ARTIFACT_MAX_FILES`
  - min: 1
  - max: 5

invalid overrideはdefaultへsilent fallbackせずfail closedする。Discordの契約上限そのものをHertaの安全上限としてhard-codeせず、Herta側で保守的なbounded limitを維持する。

## Python code artifact

`PythonでFizzBuzzのコードを書いて` は `code_artifact` へrouteする。

Phase 1のPython code artifactは次を満たす。

- `.py`
- `text/x-python`
- `kind=code`
- source全文をartifact bytesとして保持
- Discord本文へsource全文を重複しない
- attachmentを成果物の正本とする

Discord本文の成功文言はprovider responseから信用せず、validation済みArtifact metadataからのみ生成する。

例:

```text
作成しました。`fizzbuzz.py` を添付します。
```

## Execution contract

`code_artifact` と `code_execution` は別intent。

- `Pythonコードを書いて` → 生成のみ
- `Pythonコードを書いて。実行しないで` → 生成のみ
- `Pythonコードを実行して` → Phase 1では実行しない

`code_execution` ではprovider生成やhost shell executionを開始せず、実行していないことを明示する。

禁止:

- `child_process.exec` / arbitrary shell
- Lightsail host上での生成コード直接実行
- Docker socket mount
- host filesystem mount
- privileged container
- Runtime Secret/envのexecution環境への継承

将来のexecution runtimeはephemeral sandbox、CPU/RAM/wall-clock/process/disk/output quota、network default deny、secret/env非継承、host filesystem非公開、execution後destroyを前提に別Phaseで設計する。

## Discord delivery

Artifact validationとDiscord deliveryを分離する。

```text
Artifact draft
  -> validate
  -> validated Artifact bytes
  -> Discord attachment adapter
```

成功文言はvalidated Artifactがある場合だけ生成する。生成/parse/validation失敗時は「作成しました」と返さない。

Discord SDK delivery errorはattachment bytesを含む可能性があるため、AI Pluginのログへraw error objectを渡さずsafe error name/categoryだけを記録する。

## Logging / privacy

artifact telemetryへ出してよいもの:

- intent
- result category
- artifact count
- total bytes
- artifact kind
- MIME
- size
- safe error category

出さないもの:

- raw user prompt
- generated source/content
- provider raw response
- Runtime Secret / API key
- user/model derived filename

## Production impact

Phase 1では次を行わない。

- DB migration
- production deploy
- secret追加/変更
- `HERTA_AI_ENABLED=true` への変更
- AOP変更
- Discord slash command sync

Production defaultは引き続きAI OFFで、AI PluginのGuild opt-inも必要。

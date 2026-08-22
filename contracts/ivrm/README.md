# ivRooom Contract Snapshots

このdirectoryは`ivRooom/ivrm-contracts`で生成・検証されたportable contract bundleのProducer-side pinです。

## Herta IAM v1

Source of Truth:

```text
ivRooom/ivrm-contracts
  -> dist/herta-iam.v1.bundle.json
```

Pinned snapshot:

```text
contracts/ivrm/herta-iam.v1.bundle.json
```

HertaはPublic repository、`ivrm-contracts`はPrivate repositoryのため、GitHub Actionsへcross-repository PATや長期Tokenを配布しません。Producer CIはcommitted portable bundleに対してruntime behaviorを検証します。

Contract更新時は次の順で進めます。

1. `ivrm-contracts`でcanonical schema / OpenAPIを変更
2. `node scripts/build-portable-bundles.mjs`でbundleを再生成
3. Contract CIをGREENにする
4. このsnapshotを生成済みbundleと完全一致する内容へ更新
5. Herta producer conformance testをGREENにする
6. ivrm-web consumer snapshot / conformance testも同じbundleへ更新
7. Breaking changeの場合は新versionへ分離し、merge/deploy orderを明記

Secret、Token、実ユーザーデータをbundleへ含めないでください。

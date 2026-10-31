# VC Recap audio S3 Lifecycle — opt-in, not production enabled

Tracking: [#638](https://github.com/ivRooom/Herta/issues/638), [#584](https://github.com/ivRooom/Herta/issues/584), [#583](https://github.com/ivRooom/Herta/issues/583), [#617](https://github.com/ivRooom/Herta/issues/617).

## Confirmed state (read-only, 2026-10-31)

The Tokyo dedicated VC Recap bucket exists separately from the Herta backup bucket. It has S3 Versioning enabled, all four Public Access Block flags, SSE-S3 AES256, BucketOwnerEnforced, and TLS-only bucket policy. **No S3 Lifecycle configuration is currently installed.** Read-only `ListObjectsV2` under `vc-recap/` returned **zero current objects**; this is not an inventory of historical versions or multipart uploads and is not proof that all data has been deleted. The ordinary Herta backup bucket has an unrelated 180-day expiration rule and is unsuitable for persistent VC audio.

## IaC behavior

The bucket template has the CloudFormation parameter `EnableAudioStandardIALifecycle`:

`false` (default): Does not install an audio lifecycle rule. Existing legacy VC retention stays unchanged.

`true` (explicit opt-in): Installs a **transition only**, on tagged audio objects at least 128 KiB, from S3 Standard to **STANDARD_IA after 30 days**.

Only objects with the **S3 object tag** `vc-recap-kind=audio` and size **> 131071 bytes** qualify. The rule does not match arbitrary `vc-recap/users/*` contents and does **not** expire objects, versions, delete markers, or transcript archives. Smaller audio chunks remain in Standard rather than incur disproportionate transition costs.

**The recorder/upload writer and tag propagation are not yet integrated.** The parameter must remain `false` until the integration and deletion/restore gates have passed. This change does **not** activate recording, transcription archive, retention extension, or S3 deletion.

## Preconditions for an authorized enablement

1. New, versioned, separately explicit consent for recording + long-term audio storage is in force; revocation stops capture, uploads, playback and exports. Existing 30-day consent or auto-consent roles do not count.
2. Audio is written to S3 Standard with the exact approved tag **atomically in the initial PutObject/CompleteMultipartUpload flow** (or a verified, fail-closed tagging workflow), scoped to the owner and Guild; consent and deletion barriers are checked on start/commit. A test proves transcript/manifest objects do not carry the tag.
3. S3 owner-index and user deletion operate end to end: current + noncurrent versions, delete markers, pending multipart, shared summaries, retries, audits, and **backup restore tombstones before data is served**. Prove an SDK-backed test on synthetic data before real rollout.
4. Compare real object sizes, request rates and retrieval rates across Standard, Standard-IA, Intelligent-Tiering and Glacier Instant Retrieval. IA bills at least 128 KiB per object and has a 30-day minimum billable duration **after transition**, even if the owner subsequently requests erasure. Review deleted/overwritten early charges and costs of retained noncurrent versions. The initial storage-only scenario model is in Draft Herta PR #599; it is not an AWS bill.
5. Confirm writer/erasure IAM minimum privilege, backup vs audio separation, CloudWatch metrics, budgets, accepted cost ceiling, rollback and policy/legal review. Obtain approval before any stack update or paid write operation.

## Validation, release, and rollback

- Offline: `python3 deploy/scripts/verify-vc-recap-s3-lifecycle-template.test.py`. This is wired into Herta CI and asserts default OFF, audio-only tag, minimum object size, exactly the reviewed 30-day IA transition, and no expiration.
- Independently check general S3 safety: `python3 deploy/scripts/verify-vc-recap-s3-safety.test.py` (offline) and `deploy/scripts/verify-vc-recap-s3-safety.py` (authorized AWS read-only access).
- Before enabling, inspect a CloudFormation **change set** and verify that it changes only the dedicated VC bucket LifecycleConfiguration; independently review any drift and all existing rules. Do not blindly run a stack deploy or overwrite an unrelated lifecycle configuration.
- When explicitly approved, update the existing dedicated bucket stack using reviewed parameter values. Then verify via **read-only** GetBucketLifecycleConfiguration, confirm no expiration or noncurrent-version expiration, and test transition eligibility on consented synthetic tagged chunks. Monitor transition requests and storage-class status before widening rollout.
- To stop future transitions, first disable new audio writes/recording, then return the parameter to `false` through another approved change set. **Already transitioned objects do not automatically return to Standard**. Do not delete live versions, remove the whole stack, or mistake CloudFormation `Retain` for a data cleanup strategy.
- Restore of a stale DB must keep Studio/Bot/export read paths blocked until an independently retained erasure ledger has been replayed and verified. Until this is implemented, **long-term recording remains disabled**.

AWS references: [Lifecycle constraints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html), [CloudFormation Rule fields](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-rule.html), [Storage pricing](https://aws.amazon.com/s3/pricing/).

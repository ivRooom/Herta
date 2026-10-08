import type {
  ChangeStudioAccessGroupMembersResult,
  ChangeStudioAccessPolicyAttachmentsResult,
  DeleteStudioAccessGroupResult,
  StudioAccessPrincipalRef,
} from '@herta/db';
import { RequestBodyTooLargeError, readRequestBodyBytes } from './bounded-request-body.ts';
import type { IvrmIntegrationAuthorization } from './ivrm-integration-auth.ts';
import {
  IVRM_IAM_BATCH_BODY_MAX_BYTES,
  IVRM_IAM_BODY_MAX_BYTES,
  checkAttachPrincipals,
  findMissingGuildMembers,
  parseAttachmentBatch,
  parseDiscordId,
  parseGroupDeleteOptions,
  parseGroupUpdateBody,
  parseMemberBatch,
  parsePrincipal,
  parseUuid,
  principalKey,
  type BatchItemError,
  type IamPrincipal,
  type PrincipalExistencePorts,
  type RateLimitDecision,
} from './ivrm-iam-management.ts';

/**
 * herta-iam v1.1.0 の管理操作の HTTP ハンドラ。DB・bot・監査への依存は `IvrmIamDeps` として
 * 注入するので、実 DB なしでふるまい(ステータス・本文・監査の有無)をテストできる。
 * 実際の依存は `ivrm-iam-runtime.ts` が組み立てる。
 */

export type IamGroup = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
};

export type IvrmIamAuditEntry = {
  guildId: string;
  actorId: string;
  event: string;
  targetType: 'studio_access_group' | 'studio_access_policy';
  targetId: string;
  changes: object;
};

export interface IvrmIamDeps {
  authorize(request: Request): IvrmIntegrationAuthorization;
  rateLimiter: { take(): RateLimitDecision };
  listGroups(guildId: string): Promise<IamGroup[]>;
  findPolicy(guildId: string, policyId: string): Promise<{ id: string; name: string } | null>;
  updateGroupIfCurrent(input: {
    guildId: string;
    groupId: string;
    name: string;
    description: string | null;
    actorId: string;
    expectedUpdatedAt: Date;
  }): Promise<IamGroup | null>;
  deleteGroupIfCurrent(input: {
    guildId: string;
    groupId: string;
    expectedUpdatedAt: Date;
    cascade: boolean;
    membersLimit: number;
  }): Promise<DeleteStudioAccessGroupResult>;
  changeMembers(input: {
    guildId: string;
    groupId: string;
    add: string[];
    remove: string[];
    actorId: string;
  }): Promise<ChangeStudioAccessGroupMembersResult>;
  changeAttachments(input: {
    guildId: string;
    policyId: string;
    attach: StudioAccessPrincipalRef[];
    detach: StudioAccessPrincipalRef[];
    actorId: string;
  }): Promise<ChangeStudioAccessPolicyAttachmentsResult>;
  getRoleIds(guildId: string): Promise<ReadonlySet<string> | null>;
  hasGuildMember(guildId: string, userId: string): Promise<boolean>;
  audit(entry: IvrmIamAuditEntry): Promise<void>;
  isUniqueViolation(error: unknown): boolean;
}

/** 監査ログの `changes` に入れる要素数の上限(巨大な一括でも監査行を肥大させない)。 */
const AUDIT_ITEMS_LIMIT = 100;

function reply(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  const headers = new Headers(extraHeaders);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(body, { status, headers });
}

function serializeGroup(group: IamGroup) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    updatedAt: group.updatedAt.toISOString(),
  };
}

type Begun = { ok: true; guildId: string; actorId: string } | { ok: false; response: Response };

export function createIvrmIamHandlers(deps: IvrmIamDeps) {
  function begin(request: Request, guildIdParam: string): Begun {
    const authorization = deps.authorize(request);
    if (authorization.status === 'unconfigured') {
      return {
        ok: false,
        response: reply({ error: 'ivRooom integration is not configured' }, 503),
      };
    }
    if (authorization.status === 'unauthorized') {
      return {
        ok: false,
        response: reply({ error: 'Unauthorized' }, 401, {
          'WWW-Authenticate': 'Bearer realm="ivrm-integration"',
        }),
      };
    }
    if (guildIdParam !== authorization.config.guildId) {
      return { ok: false, response: reply({ error: 'Not found' }, 404) };
    }

    const actorId = parseDiscordId(request.headers.get('x-ivrm-actor-id') ?? '');
    if (!actorId) {
      return { ok: false, response: reply({ error: 'Invalid mutation context' }, 400) };
    }

    const decision = deps.rateLimiter.take();
    if (!decision.allowed) {
      return {
        ok: false,
        response: reply({ error: 'Rate limit exceeded' }, 429, {
          'Retry-After': String(decision.retryAfterSeconds),
        }),
      };
    }
    return { ok: true, guildId: authorization.config.guildId, actorId };
  }

  async function readJson(
    request: Request,
    maxBytes: number = IVRM_IAM_BODY_MAX_BYTES,
  ): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return {
        ok: false,
        response: reply({ error: 'Content-Type must be application/json' }, 400),
      };
    }
    try {
      const bytes = await readRequestBodyBytes(request, maxBytes);
      return { ok: true, value: JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown };
    } catch (error) {
      const tooLarge = error instanceof RequestBodyTooLargeError;
      return {
        ok: false,
        response: reply(
          { error: tooLarge ? 'Request body is too large' : 'Invalid JSON' },
          tooLarge ? 413 : 400,
        ),
      };
    }
  }

  async function findGroup(guildId: string, groupId: string) {
    const groups = await deps.listGroups(guildId);
    return { groups, group: groups.find((candidate) => candidate.id === groupId) ?? null };
  }

  async function auditSafely(entry: IvrmIamAuditEntry) {
    try {
      await deps.audit(entry);
    } catch (error) {
      console.error('Failed to record ivRooom IAM audit log', {
        event: entry.event,
        targetId: entry.targetId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  function principalPorts(guildId: string): PrincipalExistencePorts {
    return {
      getRoleIds: () => deps.getRoleIds(guildId),
      hasGuildMember: (userId) => deps.hasGuildMember(guildId, userId),
      groupIds: async () => new Set((await deps.listGroups(guildId)).map((group) => group.id)),
    };
  }

  function batchValidationFailure(itemErrors: BatchItemError[]) {
    return reply({ error: 'Batch validation failed', itemErrors }, 400);
  }

  const ATTACH_ERROR_RESPONSES = {
    root_role_not_allowed: () =>
      reply({ error: 'The OWNER root role cannot have policies attached' }, 400),
    role_not_found: () => reply({ error: 'The Discord role does not exist in this guild' }, 404),
    group_not_found: () => reply({ error: 'The group does not exist in this guild' }, 404),
    not_a_guild_member: () => reply({ error: 'The guild member could not be confirmed' }, 404),
    invalid_id: () => reply({ error: 'Invalid principal' }, 400),
    duplicate_in_both_lists: () => reply({ error: 'Invalid principal' }, 400),
  } as const;

  return {
    async updateGroup(request: Request, params: { guildId: string; groupId: string }) {
      const begun = begin(request, params.guildId);
      if (!begun.ok) return begun.response;
      const groupId = parseUuid(params.groupId);
      if (!groupId) return reply({ error: 'Invalid group id' }, 400);

      const body = await readJson(request);
      if (!body.ok) return body.response;
      const parsed = parseGroupUpdateBody(body.value);
      if (!parsed.ok) return reply({ error: parsed.message }, 400);

      const { groups, group } = await findGroup(begun.guildId, groupId);
      if (!group) return reply({ error: 'Group not found' }, 404);
      const duplicate = groups.some(
        (candidate) =>
          candidate.id !== groupId &&
          candidate.name.toLocaleLowerCase() === parsed.value.name.toLocaleLowerCase(),
      );
      if (duplicate) return reply({ error: 'A group with the same name already exists' }, 409);

      let updated: IamGroup | null;
      try {
        updated = await deps.updateGroupIfCurrent({
          guildId: begun.guildId,
          groupId,
          name: parsed.value.name,
          description: parsed.value.description,
          actorId: begun.actorId,
          expectedUpdatedAt: parsed.value.expectedUpdatedAt,
        });
      } catch (error) {
        if (deps.isUniqueViolation(error)) {
          return reply({ error: 'A group with the same name already exists' }, 409);
        }
        console.error('Failed to update ivRooom IAM access group', {
          guildId: begun.guildId,
          groupId,
          actorId: begun.actorId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return reply({ error: 'Access group could not be updated' }, 500);
      }
      if (!updated) return reply({ error: 'stale_group' }, 409);

      await auditSafely({
        guildId: begun.guildId,
        actorId: begun.actorId,
        event: 'studio_access_group.updated',
        targetType: 'studio_access_group',
        targetId: groupId,
        changes: { name: updated.name },
      });
      return reply({ status: 'ok', group: serializeGroup(updated) });
    },

    async deleteGroup(request: Request, params: { guildId: string; groupId: string }) {
      const begun = begin(request, params.guildId);
      if (!begun.ok) return begun.response;
      const groupId = parseUuid(params.groupId);
      if (!groupId) return reply({ error: 'Invalid group id' }, 400);
      const options = parseGroupDeleteOptions(new URL(request.url).searchParams);
      if (!options.ok) return reply({ error: options.message }, 400);

      const { group } = await findGroup(begun.guildId, groupId);
      if (!group) return reply({ error: 'Group not found' }, 404);

      let result: DeleteStudioAccessGroupResult;
      try {
        result = await deps.deleteGroupIfCurrent({
          guildId: begun.guildId,
          groupId,
          expectedUpdatedAt: options.value.expectedUpdatedAt,
          cascade: options.value.cascade,
          membersLimit: options.value.membersLimit,
        });
      } catch (error) {
        console.error('Failed to delete ivRooom IAM access group', {
          guildId: begun.guildId,
          groupId,
          actorId: begun.actorId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return reply({ error: 'Access group could not be deleted' }, 500);
      }

      if (result.status === 'not_found') return reply({ error: 'Group not found' }, 404);
      if (result.status === 'stale') return reply({ error: 'stale_group' }, 409);
      if (result.status === 'has_dependencies') {
        return reply({ error: 'group_has_dependencies', dependencies: result.dependencies }, 409);
      }

      await auditSafely({
        guildId: begun.guildId,
        actorId: begun.actorId,
        event: 'studio_access_group.deleted',
        targetType: 'studio_access_group',
        targetId: groupId,
        changes: { name: group.name, removed: result.removed },
      });
      return reply({ status: 'ok', deleted: true, groupId, removed: result.removed });
    },

    async changeMember(
      request: Request,
      params: { guildId: string; groupId: string; userId: string },
      operation: 'add' | 'remove',
    ) {
      const begun = begin(request, params.guildId);
      if (!begun.ok) return begun.response;
      const groupId = parseUuid(params.groupId);
      if (!groupId) return reply({ error: 'Invalid group id' }, 400);
      const userId = parseDiscordId(params.userId);
      if (!userId) return reply({ error: 'Invalid user id' }, 400);

      const { group } = await findGroup(begun.guildId, groupId);
      if (!group) return reply({ error: 'Group not found' }, 404);
      if (operation === 'add' && !(await deps.hasGuildMember(begun.guildId, userId))) {
        return reply({ error: 'The guild member could not be confirmed' }, 404);
      }

      const result = await deps.changeMembers({
        guildId: begun.guildId,
        groupId,
        add: operation === 'add' ? [userId] : [],
        remove: operation === 'remove' ? [userId] : [],
        actorId: begun.actorId,
      });
      if (result.status === 'not_found') return reply({ error: 'Group not found' }, 404);

      const changed = operation === 'add' ? result.added.has(userId) : result.removed.has(userId);
      if (changed) {
        await auditSafely({
          guildId: begun.guildId,
          actorId: begun.actorId,
          event: `studio_access_group.member_${operation === 'add' ? 'added' : 'removed'}`,
          targetType: 'studio_access_group',
          targetId: groupId,
          changes: { groupName: group.name, userId },
        });
      }
      return reply({ status: 'ok', changed });
    },

    async changeMembersBatch(request: Request, params: { guildId: string; groupId: string }) {
      const begun = begin(request, params.guildId);
      if (!begun.ok) return begun.response;
      const groupId = parseUuid(params.groupId);
      if (!groupId) return reply({ error: 'Invalid group id' }, 400);

      const body = await readJson(request, IVRM_IAM_BATCH_BODY_MAX_BYTES);
      if (!body.ok) return body.response;
      const parsed = parseMemberBatch(body.value);
      if (!parsed.ok) {
        return parsed.kind === 'items'
          ? batchValidationFailure(parsed.itemErrors)
          : reply({ error: parsed.message }, 400);
      }

      const { group } = await findGroup(begun.guildId, groupId);
      if (!group) return reply({ error: 'Group not found' }, 404);

      // 追加対象だけを、ギルドメンバーか確認する(削除は stale なメンバーも消せるよう確認しない)。
      const missing = await findMissingGuildMembers(parsed.value.add, (userId) =>
        deps.hasGuildMember(begun.guildId, userId),
      );
      if (missing.length > 0) {
        return batchValidationFailure(
          missing.map((position) => ({
            list: 'add' as const,
            index: parsed.value.addIndexes[position] ?? position,
            code: 'not_a_guild_member' as const,
          })),
        );
      }

      const result = await deps.changeMembers({
        guildId: begun.guildId,
        groupId,
        add: parsed.value.add,
        remove: parsed.value.remove,
        actorId: begun.actorId,
      });
      if (result.status === 'not_found') return reply({ error: 'Group not found' }, 404);

      for (const [event, changedIds] of [
        ['studio_access_group.member_added', [...result.added]],
        ['studio_access_group.member_removed', [...result.removed]],
      ] as const) {
        if (changedIds.length === 0) continue;
        await auditSafely({
          guildId: begun.guildId,
          actorId: begun.actorId,
          event,
          targetType: 'studio_access_group',
          targetId: groupId,
          changes: {
            groupName: group.name,
            count: changedIds.length,
            userIds: changedIds.slice(0, AUDIT_ITEMS_LIMIT),
            batch: true,
          },
        });
      }

      return reply({
        status: 'ok',
        results: [
          ...parsed.value.add.map((userId) => ({
            userId,
            action: 'add',
            changed: result.added.has(userId),
          })),
          ...parsed.value.remove.map((userId) => ({
            userId,
            action: 'remove',
            changed: result.removed.has(userId),
          })),
        ],
      });
    },

    async changeAttachment(
      request: Request,
      params: { guildId: string; policyId: string; principalType: string; principalId: string },
      operation: 'attach' | 'detach',
    ) {
      const begun = begin(request, params.guildId);
      if (!begun.ok) return begun.response;
      const policyId = parseUuid(params.policyId);
      if (!policyId) return reply({ error: 'Invalid policy id' }, 400);
      const principal = parsePrincipal(params.principalType, params.principalId);
      if (!principal) return reply({ error: 'Invalid principal' }, 400);

      const policy = await deps.findPolicy(begun.guildId, policyId);
      if (!policy) return reply({ error: 'Policy not found' }, 404);

      if (operation === 'attach') {
        const check = await checkAttachPrincipals([principal], principalPorts(begun.guildId));
        if (check.status === 'unavailable') {
          return reply({ error: 'The Discord role list is unavailable' }, 503);
        }
        if (check.status === 'invalid') {
          return ATTACH_ERROR_RESPONSES[check.errors[0]!.code]();
        }
      }

      const result = await deps.changeAttachments({
        guildId: begun.guildId,
        policyId,
        attach: operation === 'attach' ? [principal] : [],
        detach: operation === 'detach' ? [principal] : [],
        actorId: begun.actorId,
      });
      if (result.status === 'not_found') return reply({ error: 'Policy not found' }, 404);

      const key = principalKey(principal);
      const changed = operation === 'attach' ? result.attached.has(key) : result.detached.has(key);
      if (changed) {
        await auditSafely({
          guildId: begun.guildId,
          actorId: begun.actorId,
          event: `studio_access_policy.${operation === 'attach' ? 'attached' : 'detached'}`,
          targetType: 'studio_access_policy',
          targetId: policyId,
          changes: {
            policyName: policy.name,
            principalType: principal.type,
            principalId: principal.id,
          },
        });
      }
      return reply({ status: 'ok', changed });
    },

    async changeAttachmentsBatch(request: Request, params: { guildId: string; policyId: string }) {
      const begun = begin(request, params.guildId);
      if (!begun.ok) return begun.response;
      const policyId = parseUuid(params.policyId);
      if (!policyId) return reply({ error: 'Invalid policy id' }, 400);

      const body = await readJson(request, IVRM_IAM_BATCH_BODY_MAX_BYTES);
      if (!body.ok) return body.response;
      const parsed = parseAttachmentBatch(body.value);
      if (!parsed.ok) {
        return parsed.kind === 'items'
          ? batchValidationFailure(parsed.itemErrors)
          : reply({ error: parsed.message }, 400);
      }

      const policy = await deps.findPolicy(begun.guildId, policyId);
      if (!policy) return reply({ error: 'Policy not found' }, 404);

      const check = await checkAttachPrincipals(parsed.value.attach, principalPorts(begun.guildId));
      if (check.status === 'unavailable') {
        return reply({ error: 'The Discord role list is unavailable' }, 503);
      }
      if (check.status === 'invalid') {
        return batchValidationFailure(
          check.errors.map(({ index, code }) => ({
            list: 'attach' as const,
            index: parsed.value.attachIndexes[index] ?? index,
            code,
          })),
        );
      }

      const result = await deps.changeAttachments({
        guildId: begun.guildId,
        policyId,
        attach: parsed.value.attach,
        detach: parsed.value.detach,
        actorId: begun.actorId,
      });
      if (result.status === 'not_found') return reply({ error: 'Policy not found' }, 404);

      const toRef = (principals: IamPrincipal[], changed: Set<string>) =>
        principals.filter((principal) => changed.has(principalKey(principal)));
      for (const [event, changedPrincipals] of [
        ['studio_access_policy.attached', toRef(parsed.value.attach, result.attached)],
        ['studio_access_policy.detached', toRef(parsed.value.detach, result.detached)],
      ] as const) {
        if (changedPrincipals.length === 0) continue;
        await auditSafely({
          guildId: begun.guildId,
          actorId: begun.actorId,
          event,
          targetType: 'studio_access_policy',
          targetId: policyId,
          changes: {
            policyName: policy.name,
            count: changedPrincipals.length,
            principals: changedPrincipals.slice(0, AUDIT_ITEMS_LIMIT),
            batch: true,
          },
        });
      }

      const describe = (
        principals: IamPrincipal[],
        action: 'attach' | 'detach',
        changed: Set<string>,
      ) =>
        principals.map((principal) => ({
          principalType: principal.type,
          principalId: principal.id,
          action,
          changed: changed.has(principalKey(principal)),
        }));
      return reply({
        status: 'ok',
        results: [
          ...describe(parsed.value.attach, 'attach', result.attached),
          ...describe(parsed.value.detach, 'detach', result.detached),
        ],
      });
    },
  };
}

export type IvrmIamHandlers = ReturnType<typeof createIvrmIamHandlers>;

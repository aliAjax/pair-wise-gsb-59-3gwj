import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import {
  createAudit,
  createClarificationId,
  createOpinionId,
  createVersionId,
  reviewDataStore,
} from "./data";
import { typeDefs } from "./schema";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  Clause,
  ConfirmOpinionInput,
  DashboardStats,
  FinalizeVersionInput,
  ResponseRevisionInput,
  ReviewDatabase,
  ReviewRole,
  SupplierResponse,
} from "./types";

/**
 * 所见版本与服务端当前版本不一致时抛出。
 * 该拒绝会写入操作日志：同一操作标识的重试只会得到同样的拒绝，
 * 不会在响应更新后静默落到新版本。
 */
class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionConflictError";
  }
}

const getDashboard = (database: ReviewDatabase): DashboardStats => {
  const opinionsByResponse = database.responses.map((response) => {
    const decisions = new Set(
      response.reviews
        .filter((review) => review.decision !== "clarification")
        .map((review) => review.decision),
    );
    return decisions.size > 1;
  });
  const proofCounts = database.responses.reduce<Record<string, number>>(
    (counts, response) => {
      if (response.proofFingerprint) {
        counts[response.proofFingerprint] =
          (counts[response.proofFingerprint] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const activeVersion =
    database.versions.find((version) => version.status === "draft") ??
    database.versions[0];

  return {
    totalClauses: database.clauses.length,
    mandatoryCount: database.clauses.filter(
      (clause) => clause.type === "mandatory",
    ).length,
    pendingReviews: database.responses.filter(
      (response) => response.reviews.length < 2,
    ).length,
    differences: opinionsByResponse.filter(Boolean).length,
    overdueClarifications: database.responses.reduce(
      (count, response) =>
        count +
        response.clarifications.filter(
          (clarification) => clarification.status === "overdue",
        ).length,
      0,
    ),
    reusedProofs: Object.values(proofCounts).filter((count) => count > 1)
      .length,
    staleOpinions: database.responses.reduce(
      (count, response) =>
        count +
        response.reviews.filter((review) => review.status === "stale").length,
      0,
    ),
    activeVersion: activeVersion
      ? `${activeVersion.version} ${activeVersion.label}`
      : "未建立版本",
  };
};

const requireRole = (role: ReviewRole, allowed: ReviewRole[]): void => {
  if (!allowed.includes(role)) {
    throw new Error("当前角色无权执行此操作。");
  }
};

const requireCurrentVersion = (
  response: SupplierResponse,
  baseVersion: number,
): void => {
  if (baseVersion !== response.responseVersion) {
    throw new VersionConflictError(
      `响应已更新至 V${response.responseVersion}，基于 V${baseVersion} 的写入未被接纳，请核对最新内容后重新提交。`,
    );
  }
};

/**
 * 登记一次响应补交：版本号递增、保留修订历史，
 * 该响应上所有未重新确认的旧意见随即作废（stale）。
 * 返回本次作废的意见数量。
 */
const applyResponseRevision = (
  response: SupplierResponse,
  revision: {
    responseText?: string;
    attachmentName?: string;
    proofFingerprint?: string;
    claimedScore?: number;
    submittedBy: string;
    reason: string;
  },
): number => {
  if (revision.responseText !== undefined) {
    response.responseText = revision.responseText;
  }
  if (revision.attachmentName !== undefined) {
    response.attachmentName = revision.attachmentName;
  }
  if (revision.proofFingerprint !== undefined) {
    response.proofFingerprint = revision.proofFingerprint;
  }
  if (revision.claimedScore !== undefined) {
    response.claimedScore = revision.claimedScore;
  }
  response.submittedBy = revision.submittedBy;
  response.submittedAt = new Date().toISOString();
  response.responseVersion += 1;
  response.revisions.push({
    version: response.responseVersion,
    responseText: response.responseText,
    attachmentName: response.attachmentName,
    proofFingerprint: response.proofFingerprint,
    claimedScore: response.claimedScore,
    submittedBy: revision.submittedBy,
    submittedAt: response.submittedAt,
    reason: revision.reason,
  });
  let staled = 0;
  response.reviews.forEach((review) => {
    if (review.status === "active") {
      review.status = "stale";
      staled += 1;
    }
  });
  return staled;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "operationId")
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const hashPayload = (mutation: string, input: object): string =>
  stableStringify({ mutation, input });

const hashContent = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

interface OperationExecution<T> {
  mutation: string;
  input: { operationId: string };
  apply: (database: ReviewDatabase) => { entityId: string; result: T };
  replay: (database: ReviewDatabase, entityId: string) => T;
}

/**
 * 幂等执行写操作：
 * - 同一操作标识 + 同一内容：直接返回首次结果，不重复写入；
 * - 同一操作标识 + 不同内容：拒绝（防止重试携带新内容混入）；
 * - 版本冲突的拒绝同样入日志，重试只会得到相同拒绝，不会落到新版本。
 */
const executeOperation = <T>(execution: OperationExecution<T>): T =>
  reviewDataStore.mutate((database) => {
    const operationId = execution.input.operationId?.trim();
    if (!operationId) {
      throw new Error("缺少操作标识，无法保证写入幂等。");
    }
    const payloadHash = hashPayload(execution.mutation, execution.input);
    const existing = database.operations.find(
      (operation) => operation.operationId === operationId,
    );
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new Error(
          "操作标识已被其他内容占用，本次写入未被接纳，请刷新后重新发起。",
        );
      }
      if (existing.outcome === "rejected") {
        throw new Error(
          existing.error ?? "该操作此前已被拒绝，重试不会写入新版本。",
        );
      }
      return execution.replay(database, existing.entityId ?? "");
    }
    try {
      const { entityId, result } = execution.apply(database);
      database.operations.unshift({
        operationId,
        mutation: execution.mutation,
        payloadHash,
        outcome: "applied",
        entityId,
        at: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      if (error instanceof VersionConflictError) {
        database.operations.unshift({
          operationId,
          mutation: execution.mutation,
          payloadHash,
          outcome: "rejected",
          error: error.message,
          at: new Date().toISOString(),
        });
        reviewDataStore.persist();
      }
      throw error;
    }
  });

const findResponse = (
  database: ReviewDatabase,
  responseId: string,
): SupplierResponse => {
  const response = database.responses.find((item) => item.id === responseId);
  if (!response) {
    throw new Error("供应商响应不存在。");
  }
  return response;
};

const resolvers = {
  Query: {
    workspace: () => {
      const database = reviewDataStore.snapshot();
      return {
        ...database,
        dashboard: getDashboard(database),
      };
    },
    dashboard: () => getDashboard(reviewDataStore.snapshot()),
  },
  Clause: {
    responses: (clause: Clause, _args: unknown, context: { database: ReviewDatabase }) =>
      context.database.responses.filter(
        (response) => response.clauseId === clause.id,
      ),
  },
  Mutation: {
    submitAssessment: (
      _parent: unknown,
      { input }: { input: AssessmentInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      if (input.comment.trim().length < 6) {
        throw new Error("评审意见至少需要 6 个字符。");
      }
      return executeOperation<ReviewerOpinionView>({
        mutation: "submitAssessment",
        input,
        apply: (database) => {
          const response = findResponse(database, input.responseId);
          const clause = database.clauses.find(
            (item) => item.id === response.clauseId,
          );
          if (!clause) {
            throw new Error("对应技术条款不存在。");
          }
          if (input.score < 0 || input.score > clause.weight) {
            throw new Error(`评分必须在 0 至 ${clause.weight} 之间。`);
          }
          if (
            clause.type === "scoring" &&
            input.decision === "compliant" &&
            input.score === 0
          ) {
            throw new Error("评分项判定为符合时必须填写评分。");
          }
          requireCurrentVersion(response, input.baseVersion);
          const opinion = {
            id: createOpinionId(),
            responseId: response.id,
            reviewer: input.reviewer.trim(),
            role: input.role,
            decision: input.decision,
            score: input.score,
            comment: input.comment.trim(),
            createdAt: new Date().toISOString(),
            baseVersion: response.responseVersion,
            confirmedVersion: response.responseVersion,
            status: "active" as const,
          };
          response.reviews.push(opinion);
          response.status = input.decision;
          response.reviewRound = Math.max(response.reviewRound, 1);
          createAudit(
            database,
            opinion.reviewer,
            "提交独立意见",
            response.id,
            `${clause.code} ${clause.title} 基于响应 V${response.responseVersion} 判定为 ${input.decision}，评分 ${input.score}。`,
          );
          return { entityId: opinion.id, result: opinion };
        },
        replay: (database, entityId) => {
          const opinion = database.responses
            .flatMap((response) => response.reviews)
            .find((review) => review.id === entityId);
          if (!opinion) {
            throw new Error("操作已接纳，但评审意见记录缺失。");
          }
          return opinion;
        },
      });
    },
    confirmOpinion: (
      _parent: unknown,
      { input }: { input: ConfirmOpinionInput },
    ) =>
      executeOperation<ReviewerOpinionView>({
        mutation: "confirmOpinion",
        input,
        apply: (database) => {
          const response = database.responses.find((item) =>
            item.reviews.some((review) => review.id === input.opinionId),
          );
          const opinion = response?.reviews.find(
            (review) => review.id === input.opinionId,
          );
          if (!response || !opinion) {
            throw new Error("评审意见不存在。");
          }
          if (opinion.status === "active") {
            throw new Error("该意见已基于当前响应版本确认，无需重复确认。");
          }
          if (opinion.reviewer !== input.actor && input.role !== "chair") {
            throw new Error("只能重新确认本人提交的评审意见。");
          }
          requireCurrentVersion(response, input.baseVersion);
          opinion.status = "active";
          opinion.confirmedVersion = response.responseVersion;
          createAudit(
            database,
            input.actor,
            "重新确认意见",
            opinion.id,
            `${opinion.reviewer} 已基于响应 V${response.responseVersion} 重新确认 ${response.id} 的评审意见。`,
          );
          return { entityId: opinion.id, result: opinion };
        },
        replay: (database, entityId) => {
          const opinion = database.responses
            .flatMap((response) => response.reviews)
            .find((review) => review.id === entityId);
          if (!opinion) {
            throw new Error("操作已接纳，但评审意见记录缺失。");
          }
          return opinion;
        },
      }),
    submitResponseRevision: (
      _parent: unknown,
      { input }: { input: ResponseRevisionInput },
    ) => {
      requireRole(input.role, ["procurement", "chair"]);
      if (input.responseText.trim().length < 6) {
        throw new Error("补交响应内容至少需要 6 个字符。");
      }
      if (!input.attachmentName.trim() || !input.proofFingerprint.trim()) {
        throw new Error("补交必须包含证明文件名称和证明指纹。");
      }
      if (input.reason.trim().length < 4) {
        throw new Error("补交说明至少需要 4 个字符。");
      }
      return executeOperation<SupplierResponse>({
        mutation: "submitResponseRevision",
        input,
        apply: (database) => {
          const response = findResponse(database, input.responseId);
          requireCurrentVersion(response, input.baseVersion);
          const staled = applyResponseRevision(response, {
            responseText: input.responseText.trim(),
            attachmentName: input.attachmentName.trim(),
            proofFingerprint: input.proofFingerprint.trim(),
            claimedScore: input.claimedScore,
            submittedBy: input.actor,
            reason: input.reason.trim(),
          });
          response.status = "pending";
          createAudit(
            database,
            input.actor,
            "登记补交",
            response.id,
            `${response.supplierName} 响应更新至 V${response.responseVersion}，${staled} 条独立意见待重新确认。`,
          );
          return { entityId: response.id, result: response };
        },
        replay: (database, entityId) => findResponse(database, entityId),
      });
    },
    requestClarification: (
      _parent: unknown,
      { input }: { input: ClarificationInput },
    ) =>
      executeOperation<ClarificationView>({
        mutation: "requestClarification",
        input,
        apply: (database) => {
          const response = findResponse(database, input.responseId);
          if (input.requestText.trim().length < 6) {
            throw new Error("澄清要求至少需要 6 个字符。");
          }
          const requestedAt = new Date();
          const dueAt = new Date(input.dueAt);
          if (Number.isNaN(dueAt.getTime()) || dueAt <= requestedAt) {
            throw new Error("澄清截止时间必须晚于当前时间。");
          }
          const maximumDueAt = new Date(requestedAt);
          maximumDueAt.setDate(maximumDueAt.getDate() + 7);
          if (dueAt > maximumDueAt) {
            throw new Error("澄清期限不得超过 7 个自然日。");
          }
          requireCurrentVersion(response, input.baseVersion);
          const round =
            Math.max(
              0,
              ...response.clarifications.map((item) => item.round),
            ) + 1;
          const clarification = {
            id: createClarificationId(),
            responseId: response.id,
            clauseId: response.clauseId,
            round,
            requestText: input.requestText.trim(),
            requestedAt: requestedAt.toISOString(),
            dueAt: dueAt.toISOString(),
            status: "open" as const,
            baseVersion: response.responseVersion,
          };
          response.clarifications.push(clarification);
          response.status = "clarification";
          createAudit(
            database,
            input.actor,
            "发起澄清",
            clarification.id,
            `${response.supplierName} ${response.clauseId} 第 ${round} 轮澄清已发起（基于响应 V${response.responseVersion}）。`,
          );
          return { entityId: clarification.id, result: clarification };
        },
        replay: (database, entityId) => {
          const clarification = database.responses
            .flatMap((response) => response.clarifications)
            .find((item) => item.id === entityId);
          if (!clarification) {
            throw new Error("操作已接纳，但澄清记录缺失。");
          }
          return clarification;
        },
      }),
    respondClarification: (
      _parent: unknown,
      { input }: { input: ClarificationResponseInput },
    ) =>
      executeOperation<ClarificationView>({
        mutation: "respondClarification",
        input,
        apply: (database) => {
          const response = database.responses.find((item) =>
            item.clarifications.some(
              (clarification) => clarification.id === input.clarificationId,
            ),
          );
          const clarification = response?.clarifications.find(
            (item) => item.id === input.clarificationId,
          );
          if (!response || !clarification) {
            throw new Error("澄清记录不存在。");
          }
          if (input.responseText.trim().length < 6) {
            throw new Error("澄清回复至少需要 6 个字符。");
          }
          requireCurrentVersion(response, input.baseVersion);
          clarification.supplierResponse = input.responseText.trim();
          clarification.respondedAt = new Date().toISOString();
          clarification.status = "responded";
          const staled = applyResponseRevision(response, {
            submittedBy: input.actor,
            reason: `第 ${clarification.round} 轮澄清回复`,
          });
          response.status = "pending";
          createAudit(
            database,
            input.actor,
            "回复澄清",
            clarification.id,
            `第 ${clarification.round} 轮澄清已回复，响应更新至 V${response.responseVersion}，${staled} 条独立意见待重新确认。`,
          );
          return { entityId: clarification.id, result: clarification };
        },
        replay: (database, entityId) => {
          const clarification = database.responses
            .flatMap((response) => response.clarifications)
            .find((item) => item.id === entityId);
          if (!clarification) {
            throw new Error("操作已接纳，但澄清记录缺失。");
          }
          return clarification;
        },
      }),
    finalizeVersion: (
      _parent: unknown,
      { input }: { input: FinalizeVersionInput },
    ) => {
      requireRole(input.role, ["chair"]);
      if (input.label.trim().length < 4) {
        throw new Error("版本名称至少需要 4 个字符。");
      }
      return executeOperation<ReviewVersionView>({
        mutation: "finalizeVersion",
        input,
        apply: (database) => {
          const blockingClarifications = database.responses
            .flatMap((response) => response.clarifications)
            .filter(
              (clarification) =>
                clarification.status === "open" ||
                clarification.status === "overdue",
            );
          if (blockingClarifications.length > 0) {
            throw new Error(
              `仍有 ${blockingClarifications.length} 项未完成澄清，不能定稿。`,
            );
          }
          const staleOpinions = database.responses.flatMap((response) =>
            response.reviews.filter((review) => review.status === "stale"),
          );
          if (staleOpinions.length > 0) {
            throw new Error(
              `仍有 ${staleOpinions.length} 条评审意见待按当前响应版本重新确认，不能定稿。`,
            );
          }
          const maxVersion =
            database.versions.reduce((maximum, version) => {
              const numeric = Number(version.version.replace(/\D/g, ""));
              return Number.isFinite(numeric)
                ? Math.max(maximum, numeric)
                : maximum;
            }, 0) + 1;
          const basis = database.responses.map((response) => ({
            responseId: response.id,
            version: response.responseVersion,
            opinionIds: response.reviews
              .filter(
                (review) =>
                  review.status === "active" &&
                  review.confirmedVersion === response.responseVersion,
              )
              .map((review) => review.id),
          }));
          database.versions.forEach((version) => {
            version.status = "finalized";
          });
          const version = {
            id: createVersionId(),
            version: `V${maxVersion}`,
            label: input.label.trim(),
            status: "finalized" as const,
            createdAt: new Date().toISOString(),
            createdBy: input.actor,
            signedBy: [input.actor],
            clauseCount: database.clauses.length,
            responseCount: database.responses.length,
            contentHash: hashContent(stableStringify(basis)),
            basis,
          };
          database.versions.unshift(version);
          createAudit(
            database,
            input.actor,
            "汇总签字定稿",
            version.id,
            `${version.version} ${version.label} 已锁定，仅收录当前响应版本已重新确认的意见，签署人 ${input.actor}。`,
          );
          return { entityId: version.id, result: version };
        },
        replay: (database, entityId) => {
          const version = database.versions.find(
            (item) => item.id === entityId,
          );
          if (!version) {
            throw new Error("操作已接纳，但评审版本记录缺失。");
          }
          return version;
        },
      });
    },
    resetReviewData: () => {
      reviewDataStore.reset();
      return true;
    },
  },
};

type ReviewerOpinionView =
  ReviewDatabase["responses"][number]["reviews"][number];
type ClarificationView =
  ReviewDatabase["responses"][number]["clarifications"][number];
type ReviewVersionView = ReviewDatabase["versions"][number];

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

async function startServer(): Promise<void> {
  const { url } = await startStandaloneServer(server, {
    listen: { port: 18462, host: "0.0.0.0" },
    context: async () => ({
      database: reviewDataStore.snapshot(),
    }),
  });
  console.log(`GraphQL mock server ready at ${url}`);
}

void startServer();

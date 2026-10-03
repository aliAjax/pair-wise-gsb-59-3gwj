import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import {
  createAudit,
  createClarificationId,
  createOpinionId,
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
  ReviewerOpinion,
  ReviewRole,
  SupplierResponse,
} from "./types";

/** 装配查询结果：意见版本落后于当前响应版本即为已作废、待重新确认。 */
const decorateResponse = (response: SupplierResponse): SupplierResponse => ({
  ...response,
  reviews: response.reviews.map((review) => ({
    ...review,
    stale: review.responseVersion < response.responseVersion,
  })),
});

const currentOpinions = (response: SupplierResponse): ReviewerOpinion[] =>
  response.reviews.filter(
    (review) => review.responseVersion === response.responseVersion,
  );

const staleOpinions = (response: SupplierResponse): ReviewerOpinion[] =>
  response.reviews.filter(
    (review) => review.responseVersion < response.responseVersion,
  );

const hashContent = (content: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const buildContentHash = (database: ReviewDatabase): string => {
  const content = database.responses
    .map((response) => {
      const opinions = response.reviews
        .map(
          (review) =>
            `${review.reviewer}:${review.decision}:${review.score}@${review.responseVersion}`,
        )
        .sort()
        .join(",");
      return `${response.id}@${response.responseVersion}:${response.status}:${response.claimedScore}[${opinions}]`;
    })
    .sort()
    .join("|");
  return hashContent(content);
};

const getDashboard = (database: ReviewDatabase): DashboardStats => {
  const opinionsByResponse = database.responses.map((response) => {
    const decisions = new Set(
      currentOpinions(response)
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
      (response) => currentOpinions(response).length < 2,
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
      (count, response) => count + staleOpinions(response).length,
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
    throw new Error(
      `该响应已补交至第 ${response.responseVersion} 版，基于第 ${baseVersion} 版的写入不能接纳，请核对最新内容后重新提交。`,
    );
  }
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
      context.database.responses
        .filter((response) => response.clauseId === clause.id)
        .map(decorateResponse),
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
      return reviewDataStore.mutate((database) => {
        const response = database.responses.find(
          (item) => item.id === input.responseId,
        );
        if (!response) {
          throw new Error("供应商响应不存在。");
        }
        const replay = response.reviews.find(
          (review) => review.operationId === input.operationId,
        );
        if (replay) {
          return {
            ...replay,
            stale: replay.responseVersion < response.responseVersion,
          };
        }
        requireCurrentVersion(response, input.baseVersion);
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
        const now = new Date().toISOString();
        const opinion = {
          id: createOpinionId(),
          responseId: response.id,
          reviewer: input.reviewer.trim(),
          role: input.role,
          decision: input.decision,
          score: input.score,
          comment: input.comment.trim(),
          createdAt: now,
          responseVersion: response.responseVersion,
          operationId: input.operationId,
          confirmedAt: now,
          confirmedBy: input.reviewer.trim(),
        };
        response.reviews.push(opinion);
        response.status = input.decision;
        response.reviewRound = Math.max(response.reviewRound, 1);
        createAudit(
          database,
          opinion.reviewer,
          "提交独立意见",
          response.id,
          `${clause.code} ${clause.title} 第 ${response.responseVersion} 版响应判定为 ${input.decision}，评分 ${input.score}。`,
        );
        return { ...opinion, stale: false };
      });
    },
    confirmOpinion: (
      _parent: unknown,
      { input }: { input: ConfirmOpinionInput },
    ) => {
      requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
      return reviewDataStore.mutate((database) => {
        const response = database.responses.find((item) =>
          item.reviews.some((review) => review.id === input.opinionId),
        );
        if (!response) {
          throw new Error("评审意见不存在。");
        }
        const opinion = response.reviews.find(
          (review) => review.id === input.opinionId,
        );
        if (!opinion) {
          throw new Error("评审意见不存在。");
        }
        if (opinion.responseVersion === response.responseVersion) {
          return { ...opinion, stale: false };
        }
        if (opinion.reviewer !== input.actor && input.role !== "chair") {
          throw new Error("只能由意见本人或评审组长重新确认。");
        }
        requireCurrentVersion(response, input.baseVersion);
        opinion.responseVersion = response.responseVersion;
        opinion.confirmedAt = new Date().toISOString();
        opinion.confirmedBy = input.actor;
        createAudit(
          database,
          input.actor,
          "重新确认意见",
          opinion.id,
          `${opinion.reviewer} 对 ${response.id} 的意见已按第 ${response.responseVersion} 版响应重新确认。`,
        );
        return { ...opinion, stale: false };
      });
    },
    submitResponseRevision: (
      _parent: unknown,
      { input }: { input: ResponseRevisionInput },
    ) => {
      requireRole(input.role, ["procurement", "chair"]);
      if (input.responseText.trim().length < 6) {
        throw new Error("补交响应内容至少需要 6 个字符。");
      }
      if (input.note.trim().length < 4) {
        throw new Error("补交说明至少需要 4 个字符。");
      }
      return reviewDataStore.mutate((database) => {
        const response = database.responses.find(
          (item) => item.id === input.responseId,
        );
        if (!response) {
          throw new Error("供应商响应不存在。");
        }
        const replay = response.revisions.find(
          (revision) => revision.operationId === input.operationId,
        );
        if (replay) {
          return decorateResponse(structuredClone(response));
        }
        requireCurrentVersion(response, input.baseVersion);
        const outdatedCount = currentOpinions(response).length;
        const submittedAt = new Date().toISOString();
        response.responseVersion += 1;
        response.responseText = input.responseText.trim();
        response.attachmentName =
          input.attachmentName.trim() || response.attachmentName;
        response.proofFingerprint =
          input.proofFingerprint.trim() || response.proofFingerprint;
        response.submittedBy = input.actor;
        response.submittedAt = submittedAt;
        response.status = "pending";
        response.revisions.push({
          version: response.responseVersion,
          operationId: input.operationId,
          responseText: response.responseText,
          attachmentName: response.attachmentName,
          proofFingerprint: response.proofFingerprint,
          note: input.note.trim(),
          submittedBy: input.actor,
          submittedAt,
        });
        createAudit(
          database,
          input.actor,
          "响应补交",
          response.id,
          `${response.supplierName} ${response.clauseId} 补交登记为第 ${response.responseVersion} 版，${outdatedCount} 条评审意见待重新确认。`,
        );
        return decorateResponse(structuredClone(response));
      });
    },
    requestClarification: (
      _parent: unknown,
      { input }: { input: ClarificationInput },
    ) =>
      reviewDataStore.mutate((database) => {
        const response = database.responses.find(
          (item) => item.id === input.responseId,
        );
        if (!response) {
          throw new Error("供应商响应不存在。");
        }
        const replay = response.clarifications.find(
          (clarification) => clarification.operationId === input.operationId,
        );
        if (replay) {
          return replay;
        }
        requireCurrentVersion(response, input.baseVersion);
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
          responseVersion: response.responseVersion,
          operationId: input.operationId,
        };
        response.clarifications.push(clarification);
        response.status = "clarification";
        createAudit(
          database,
          input.actor,
          "发起澄清",
          clarification.id,
          `${response.supplierName} ${response.clauseId} 第 ${round} 轮澄清已发起（依据第 ${response.responseVersion} 版响应）。`,
        );
        return clarification;
      }),
    respondClarification: (
      _parent: unknown,
      { input }: { input: ClarificationResponseInput },
    ) =>
      reviewDataStore.mutate((database) => {
        const clarification = database.responses
          .flatMap((response) => response.clarifications)
          .find((item) => item.id === input.clarificationId);
        if (!clarification) {
          throw new Error("澄清记录不存在。");
        }
        if (clarification.status === "responded") {
          if (clarification.responseOperationId === input.operationId) {
            return clarification;
          }
          throw new Error("该澄清已登记回复，不能重复写入。");
        }
        if (input.responseText.trim().length < 6) {
          throw new Error("澄清回复至少需要 6 个字符。");
        }
        clarification.supplierResponse = input.responseText.trim();
        clarification.respondedAt = new Date().toISOString();
        clarification.status = "responded";
        clarification.responseOperationId = input.operationId;
        const response = database.responses.find(
          (item) => item.id === clarification.responseId,
        );
        if (response) {
          const outdatedCount = currentOpinions(response).length;
          response.responseVersion += 1;
          response.submittedAt = clarification.respondedAt;
          response.status = "pending";
          response.revisions.push({
            version: response.responseVersion,
            operationId: input.operationId,
            responseText: response.responseText,
            attachmentName: response.attachmentName,
            proofFingerprint: response.proofFingerprint,
            note: `第 ${clarification.round} 轮澄清回复：${input.responseText.trim()}`,
            submittedBy: input.actor,
            submittedAt: clarification.respondedAt,
          });
          clarification.respondedVersion = response.responseVersion;
          createAudit(
            database,
            input.actor,
            "回复澄清",
            clarification.id,
            `第 ${clarification.round} 轮澄清已回复，响应更新为第 ${response.responseVersion} 版，${outdatedCount} 条评审意见待重新确认。`,
          );
        }
        return clarification;
      }),
    finalizeVersion: (
      _parent: unknown,
      { input }: { input: FinalizeVersionInput },
    ) =>
      reviewDataStore.mutate((database) => {
        requireRole(input.role, ["chair"]);
        if (input.label.trim().length < 4) {
          throw new Error("版本名称至少需要 4 个字符。");
        }
        const replay = database.versions.find(
          (version) => version.operationId === input.operationId,
        );
        if (replay) {
          return replay;
        }
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
        const outdatedOpinions = database.responses.flatMap((response) =>
          staleOpinions(response),
        );
        if (outdatedOpinions.length > 0) {
          throw new Error(
            `仍有 ${outdatedOpinions.length} 条评审意见待重新确认（响应已补交新版本），不能定稿。`,
          );
        }
        const maxVersion =
          database.versions.reduce((maximum, version) => {
            const numeric = Number(version.version.replace(/\D/g, ""));
            return Number.isFinite(numeric)
              ? Math.max(maximum, numeric)
              : maximum;
          }, 0) + 1;
        database.versions.forEach((version) => {
          version.status = "finalized";
        });
        const version = {
          id: `VER-${Date.now()}`,
          version: `V${maxVersion}`,
          label: input.label.trim(),
          status: "finalized" as const,
          createdAt: new Date().toISOString(),
          createdBy: input.actor,
          signedBy: [input.actor],
          clauseCount: database.clauses.length,
          responseCount: database.responses.length,
          contentHash: buildContentHash(database),
          operationId: input.operationId,
          confirmedOpinions: database.responses.reduce(
            (count, response) => count + currentOpinions(response).length,
            0,
          ),
          responseSnapshots: database.responses.map((response) => ({
            responseId: response.id,
            responseVersion: response.responseVersion,
          })),
        };
        database.versions.unshift(version);
        createAudit(
          database,
          input.actor,
          "汇总签字定稿",
          version.id,
          `${version.version} ${version.label} 已锁定，采纳 ${version.confirmedOpinions} 条当前版本已确认意见，签署人 ${input.actor}。`,
        );
        return version;
      }),
    resetReviewData: () => {
      reviewDataStore.reset();
      return true;
    },
  },
};

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

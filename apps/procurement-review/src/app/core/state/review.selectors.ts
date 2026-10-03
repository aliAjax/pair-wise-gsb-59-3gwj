import { createFeatureSelector, createSelector } from "@ngrx/store";
import type {
  Clause,
  ClauseTreeNode,
  ComplianceStatus,
  ReviewState,
  ReviewerOpinion,
  SupplierResponse,
} from "../models/review.models";

export const selectReviewState =
  createFeatureSelector<ReviewState>("review");

export const selectClauses = createSelector(
  selectReviewState,
  (state) => state.clauses,
);

export const selectVersions = createSelector(
  selectReviewState,
  (state) => state.versions,
);

export const selectAuditLogs = createSelector(
  selectReviewState,
  (state) => state.auditLogs,
);

export const selectDashboard = createSelector(
  selectReviewState,
  (state) => state.dashboard,
);

export const selectSuppliers = createSelector(
  selectReviewState,
  (state) => state.suppliers,
);

export const selectFilters = createSelector(
  selectReviewState,
  (state) => state.filters,
);

export const selectRole = createSelector(
  selectReviewState,
  (state) => state.role,
);

export const selectSelectedSupplierIds = createSelector(
  selectReviewState,
  (state) => state.selectedSupplierIds,
);

export const selectLoading = createSelector(
  selectReviewState,
  (state) => state.loading,
);

export const selectSaving = createSelector(
  selectReviewState,
  (state) => state.saving,
);

export const selectError = createSelector(
  selectReviewState,
  (state) => state.error,
);

export const selectToast = createSelector(
  selectReviewState,
  (state) => state.toast,
);

/** 当前响应版本上仍有效的意见（补交后未重新确认的旧版意见不计入）。 */
export const currentOpinions = (
  response: SupplierResponse,
): ReviewerOpinion[] => response.reviews.filter((review) => !review.stale);

/** 响应补交后已作废、待重新确认的旧版意见。 */
export const outdatedOpinions = (
  response: SupplierResponse,
): ReviewerOpinion[] => response.reviews.filter((review) => review.stale);

export const hasReviewDifference = (response: SupplierResponse): boolean => {
  const decisions = new Set(
    currentOpinions(response)
      .filter((review) => review.decision !== "clarification")
      .map((review) => review.decision),
  );
  return decisions.size > 1;
};

export const findResponse = (
  clause: Clause,
  supplierId: string,
): SupplierResponse | undefined =>
  clause.responses.find((response) => response.supplierId === supplierId);

const filteredClauses = createSelector(
  selectClauses,
  selectFilters,
  (clauses, filters) => {
    const keyword = filters.keyword.trim().toLowerCase();
    return clauses.filter((clause) => {
      const matchesKeyword =
        !keyword ||
        [
          clause.code,
          clause.title,
          clause.category,
          clause.requirement,
          ...clause.responses.map((response) => response.supplierName),
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const matchesCategory =
        !filters.category || clause.category === filters.category;
      const matchesType =
        filters.type === "all" || clause.type === filters.type;
      const matchesDifference =
        !filters.differencesOnly ||
        clause.responses.some(hasReviewDifference);
      return (
        matchesKeyword &&
        matchesCategory &&
        matchesType &&
        matchesDifference
      );
    });
  },
);

export const selectFilteredClauses = filteredClauses;

export const selectClauseTree = createSelector(
  selectClauses,
  filteredClauses,
  (allClauses, matchingClauses): ClauseTreeNode[] => {
    if (matchingClauses.length === 0) {
      return [];
    }
    const includedIds = new Set<string>();
    const byId = new Map(allClauses.map((clause) => [clause.id, clause]));
    matchingClauses.forEach((clause) => {
      includedIds.add(clause.id);
      let parentId = clause.parentId;
      while (parentId && !includedIds.has(parentId)) {
        includedIds.add(parentId);
        parentId = byId.get(parentId)?.parentId;
      }
    });
    const selected = allClauses
      .filter((clause) => includedIds.has(clause.id))
      .sort((a, b) => a.order - b.order);
    const nodeMap = new Map<string, ClauseTreeNode>();
    selected.forEach((clause) => {
      nodeMap.set(clause.id, { ...clause, children: [] });
    });
    const roots: ClauseTreeNode[] = [];
    selected.forEach((clause) => {
      const node = nodeMap.get(clause.id);
      if (!node) {
        return;
      }
      if (clause.parentId && nodeMap.has(clause.parentId)) {
        nodeMap.get(clause.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  },
);

export const selectDifferences = createSelector(
  selectClauses,
  (clauses) =>
    clauses.flatMap((clause) =>
      clause.responses
        .filter(hasReviewDifference)
        .map((response) => ({ clause, response })),
    ),
);

export const selectPendingClarifications = createSelector(
  selectClauses,
  (clauses) =>
    clauses.flatMap((clause) =>
      clause.responses.flatMap((response) =>
        response.clarifications
          .filter(
            (clarification) =>
              clarification.status === "open" ||
              clarification.status === "overdue",
          )
          .map((clarification) => ({
            clause,
            response,
            clarification,
          })),
      ),
    ),
);

export const selectReusedProofs = createSelector(
  selectClauses,
  (clauses) => {
    const counts = new Map<
      string,
      Array<{ clause: Clause; response: SupplierResponse }>
    >();
    clauses.forEach((clause) => {
      clause.responses.forEach((response) => {
        const current = counts.get(response.proofFingerprint) ?? [];
        current.push({ clause, response });
        counts.set(response.proofFingerprint, current);
      });
    });
    return Array.from(counts.entries())
      .filter(([, entries]) => entries.length > 1)
      .map(([fingerprint, entries]) => ({ fingerprint, entries }));
  },
);

export interface OpinionVersionItem {
  clause: Clause;
  response: SupplierResponse;
  opinion: ReviewerOpinion;
}

/** 全部评审意见及其版本状态，用于小组复核和审计导出。 */
export const selectOpinionVersionItems = createSelector(
  selectClauses,
  (clauses): OpinionVersionItem[] =>
    clauses.flatMap((clause) =>
      clause.responses.flatMap((response) =>
        response.reviews.map((opinion) => ({ clause, response, opinion })),
      ),
    ),
);

/** 已作废、待重新确认的旧版意见。 */
export const selectStaleOpinionItems = createSelector(
  selectOpinionVersionItems,
  (items) => items.filter((item) => item.opinion.stale),
);

export const responseDecisionSummary = (
  response: SupplierResponse,
): ComplianceStatus[] =>
  Array.from(new Set(response.reviews.map((review) => review.decision)));

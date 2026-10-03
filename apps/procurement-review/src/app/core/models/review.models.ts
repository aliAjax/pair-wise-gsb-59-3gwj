export type ClauseType = "mandatory" | "scoring" | "evidence";
export type ComplianceStatus =
  | "compliant"
  | "deviation"
  | "clarification"
  | "pending";
export type ReviewRole =
  | "procurement"
  | "reviewer_a"
  | "reviewer_b"
  | "chair";
export type ClarificationStatus = "open" | "responded" | "overdue";
export type VersionStatus = "draft" | "finalized";

export interface ReviewerOpinion {
  id: string;
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
  /** 意见所依据的响应版本（所见版本）。 */
  responseVersion: number;
  /** 幂等操作标识。 */
  operationId: string;
  confirmedAt?: string;
  confirmedBy?: string;
  /** 响应补交后旧版意见作废，待重新确认。 */
  stale: boolean;
}

export interface Clarification {
  id: string;
  responseId: string;
  clauseId: string;
  round: number;
  requestText: string;
  supplierResponse?: string;
  requestedAt: string;
  dueAt: string;
  respondedAt?: string;
  status: ClarificationStatus;
  /** 发起澄清时的响应版本。 */
  responseVersion: number;
  /** 登记回复后生成的响应版本。 */
  respondedVersion?: number;
}

export interface ResponseRevision {
  version: number;
  operationId: string;
  responseText: string;
  attachmentName: string;
  proofFingerprint: string;
  note: string;
  submittedBy: string;
  submittedAt: string;
}

export interface SupplierResponse {
  id: string;
  clauseId: string;
  supplierId: string;
  supplierName: string;
  status: ComplianceStatus;
  responseText: string;
  claimedScore: number;
  attachmentName: string;
  proofFingerprint: string;
  submittedBy: string;
  submittedAt: string;
  reviewRound: number;
  /** 当前响应版本，每次补交递增。 */
  responseVersion: number;
  revisions: ResponseRevision[];
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
}

export interface Clause {
  id: string;
  code: string;
  title: string;
  category: string;
  requirement: string;
  type: ClauseType;
  weight: number;
  parentId?: string;
  evidenceRequired: boolean;
  order: number;
  responses: SupplierResponse[];
  children?: ClauseTreeNode[];
}

export interface ClauseTreeNode extends Clause {
  children: ClauseTreeNode[];
}

export interface ResponseVersionSnapshot {
  responseId: string;
  responseVersion: number;
}

export interface ReviewVersion {
  id: string;
  version: string;
  label: string;
  status: VersionStatus;
  createdAt: string;
  createdBy: string;
  signedBy: string[];
  clauseCount: number;
  responseCount: number;
  contentHash: string;
  operationId: string;
  /** 定稿时基于当前响应版本已确认的意见数量。 */
  confirmedOpinions: number;
  /** 定稿时各响应所处的版本快照。 */
  responseSnapshots: ResponseVersionSnapshot[];
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
}

export interface DashboardStats {
  totalClauses: number;
  mandatoryCount: number;
  pendingReviews: number;
  differences: number;
  overdueClarifications: number;
  reusedProofs: number;
  staleOpinions: number;
  activeVersion: string;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface ClauseFilters {
  keyword: string;
  category: string;
  type: ClauseType | "all";
  differencesOnly: boolean;
}

export interface ReviewState {
  clauses: Clause[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  dashboard?: DashboardStats;
  suppliers: Supplier[];
  filters: ClauseFilters;
  role: ReviewRole;
  selectedSupplierIds: string[];
  loading: boolean;
  saving: boolean;
  error?: string;
  toast?: string;
}

export interface WorkspaceQueryResult {
  workspace: {
    clauses: Clause[];
    versions: ReviewVersion[];
    auditLogs: AuditLog[];
    dashboard: DashboardStats;
    suppliers: Supplier[];
  };
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
  /** 提交时所见的响应版本。 */
  baseVersion: number;
  /** 幂等操作标识，重复或迟到写入只接纳一次。 */
  operationId: string;
}

export interface ConfirmOpinionInput {
  opinionId: string;
  /** 确认人所见的当前响应版本。 */
  baseVersion: number;
  actor: string;
  role: ReviewRole;
}

export interface ResponseRevisionInput {
  responseId: string;
  baseVersion: number;
  operationId: string;
  responseText: string;
  attachmentName: string;
  proofFingerprint: string;
  note: string;
  actor: string;
  role: ReviewRole;
}

export interface ClarificationInput {
  responseId: string;
  requestText: string;
  dueAt: string;
  actor: string;
  baseVersion: number;
  operationId: string;
}

export interface ClarificationResponseInput {
  clarificationId: string;
  responseText: string;
  actor: string;
  operationId: string;
}

export interface FinalizeVersionInput {
  label: string;
  actor: string;
  role: ReviewRole;
  operationId: string;
}

export const roleProfiles: Record<ReviewRole, { name: string; label: string }> = {
  procurement: { name: "采购专员", label: "采购人员" },
  reviewer_a: { name: "陈评审", label: "技术评审员 A" },
  reviewer_b: { name: "李评审", label: "技术评审员 B" },
  chair: { name: "赵主任", label: "评审组长" },
};

export const complianceLabels: Record<ComplianceStatus, string> = {
  compliant: "符合",
  deviation: "偏离",
  clarification: "待澄清",
  pending: "待评审",
};

export const clauseTypeLabels: Record<ClauseType, string> = {
  mandatory: "否决项",
  scoring: "评分项",
  evidence: "证明项",
};

export const statusSeverity: Record<ComplianceStatus, string> = {
  compliant: "success",
  deviation: "danger",
  clarification: "warn",
  pending: "secondary",
};

export const createOperationId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `OP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

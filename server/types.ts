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
}

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
  /** 幂等操作标识，重复写入只接纳一次。 */
  operationId: string;
  confirmedAt?: string;
  confirmedBy?: string;
  /** 查询时装配：意见版本落后于当前响应版本即为已作废、待重新确认。 */
  stale?: boolean;
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
  /** 发起操作的幂等标识。 */
  operationId?: string;
  /** 登记回复的幂等标识。 */
  responseOperationId?: string;
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
  /** 每次补交形成的响应版本记录。 */
  revisions: ResponseRevision[];
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
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
  /** 定稿操作的幂等标识。 */
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

export interface ReviewDatabase {
  clauses: Clause[];
  responses: SupplierResponse[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  suppliers: Array<{ id: string; name: string }>;
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
  /** 评审员提交时所见的响应版本。 */
  baseVersion: number;
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
  /** 补交登记所基于的响应版本。 */
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
  /** 发起澄清时所见的响应版本。 */
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

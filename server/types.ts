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
export type OpinionStatus = "active" | "stale";

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
  baseVersion: number;
  confirmedVersion: number;
  status: OpinionStatus;
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
  baseVersion: number;
}

export interface ResponseRevision {
  version: number;
  responseText: string;
  attachmentName: string;
  proofFingerprint: string;
  claimedScore: number;
  submittedBy: string;
  submittedAt: string;
  reason: string;
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
  responseVersion: number;
  revisions: ResponseRevision[];
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
}

export interface ResponseVersionBasis {
  responseId: string;
  version: number;
  opinionIds: string[];
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
  basis: ResponseVersionBasis[];
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
}

export interface AppliedOperation {
  operationId: string;
  mutation: string;
  payloadHash: string;
  outcome: "applied" | "rejected";
  entityId?: string;
  error?: string;
  at: string;
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
  operations: AppliedOperation[];
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
  baseVersion: number;
  operationId: string;
}

export interface ConfirmOpinionInput {
  opinionId: string;
  actor: string;
  role: ReviewRole;
  baseVersion: number;
  operationId: string;
}

export interface ResponseRevisionInput {
  responseId: string;
  responseText: string;
  attachmentName: string;
  proofFingerprint: string;
  claimedScore: number;
  reason: string;
  actor: string;
  role: ReviewRole;
  baseVersion: number;
  operationId: string;
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
  baseVersion: number;
  operationId: string;
}

export interface FinalizeVersionInput {
  label: string;
  actor: string;
  role: ReviewRole;
  operationId: string;
}

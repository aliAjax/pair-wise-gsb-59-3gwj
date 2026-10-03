import { parse } from "graphql";

export const typeDefs = parse(`
  enum ClauseType {
    mandatory
    scoring
    evidence
  }

  enum ComplianceStatus {
    compliant
    deviation
    clarification
    pending
  }

  enum ReviewRole {
    procurement
    reviewer_a
    reviewer_b
    chair
  }

  enum ClarificationStatus {
    open
    responded
    overdue
  }

  enum VersionStatus {
    draft
    finalized
  }

  type Clause {
    id: ID!
    code: String!
    title: String!
    category: String!
    requirement: String!
    type: ClauseType!
    weight: Int!
    parentId: String
    evidenceRequired: Boolean!
    order: Int!
    responses: [SupplierResponse!]!
  }

  type ReviewerOpinion {
    id: ID!
    responseId: String!
    reviewer: String!
    role: ReviewRole!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    createdAt: String!
    responseVersion: Int!
    operationId: String!
    confirmedAt: String
    confirmedBy: String
    stale: Boolean!
  }

  type Clarification {
    id: ID!
    responseId: String!
    clauseId: String!
    round: Int!
    requestText: String!
    supplierResponse: String
    requestedAt: String!
    dueAt: String!
    respondedAt: String
    status: ClarificationStatus!
    responseVersion: Int!
    respondedVersion: Int
  }

  type ResponseRevision {
    version: Int!
    operationId: String!
    responseText: String!
    attachmentName: String!
    proofFingerprint: String!
    note: String!
    submittedBy: String!
    submittedAt: String!
  }

  type SupplierResponse {
    id: ID!
    clauseId: String!
    supplierId: String!
    supplierName: String!
    status: ComplianceStatus!
    responseText: String!
    claimedScore: Int!
    attachmentName: String!
    proofFingerprint: String!
    submittedBy: String!
    submittedAt: String!
    reviewRound: Int!
    responseVersion: Int!
    revisions: [ResponseRevision!]!
    reviews: [ReviewerOpinion!]!
    clarifications: [Clarification!]!
  }

  type ResponseVersionSnapshot {
    responseId: String!
    responseVersion: Int!
  }

  type ReviewVersion {
    id: ID!
    version: String!
    label: String!
    status: VersionStatus!
    createdAt: String!
    createdBy: String!
    signedBy: [String!]!
    clauseCount: Int!
    responseCount: Int!
    contentHash: String!
    operationId: String!
    confirmedOpinions: Int!
    responseSnapshots: [ResponseVersionSnapshot!]!
  }

  type AuditLog {
    id: ID!
    at: String!
    actor: String!
    action: String!
    entity: String!
    detail: String!
  }

  type DashboardStats {
    totalClauses: Int!
    mandatoryCount: Int!
    pendingReviews: Int!
    differences: Int!
    overdueClarifications: Int!
    reusedProofs: Int!
    staleOpinions: Int!
    activeVersion: String!
  }

  type Supplier {
    id: ID!
    name: String!
  }

  type WorkspaceData {
    clauses: [Clause!]!
    versions: [ReviewVersion!]!
    auditLogs: [AuditLog!]!
    dashboard: DashboardStats!
    suppliers: [Supplier!]!
  }

  input AssessmentInput {
    responseId: ID!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    reviewer: String!
    role: ReviewRole!
    baseVersion: Int!
    operationId: String!
  }

  input ConfirmOpinionInput {
    opinionId: ID!
    baseVersion: Int!
    actor: String!
    role: ReviewRole!
  }

  input ResponseRevisionInput {
    responseId: ID!
    baseVersion: Int!
    operationId: String!
    responseText: String!
    attachmentName: String!
    proofFingerprint: String!
    note: String!
    actor: String!
    role: ReviewRole!
  }

  input ClarificationInput {
    responseId: ID!
    requestText: String!
    dueAt: String!
    actor: String!
    baseVersion: Int!
    operationId: String!
  }

  input ClarificationResponseInput {
    clarificationId: ID!
    responseText: String!
    actor: String!
    operationId: String!
  }

  input FinalizeVersionInput {
    label: String!
    actor: String!
    role: ReviewRole!
    operationId: String!
  }

  type Query {
    workspace: WorkspaceData!
    dashboard: DashboardStats!
  }

  type Mutation {
    submitAssessment(input: AssessmentInput!): ReviewerOpinion!
    confirmOpinion(input: ConfirmOpinionInput!): ReviewerOpinion!
    submitResponseRevision(input: ResponseRevisionInput!): SupplierResponse!
    requestClarification(input: ClarificationInput!): Clarification!
    respondClarification(input: ClarificationResponseInput!): Clarification!
    finalizeVersion(input: FinalizeVersionInput!): ReviewVersion!
    resetReviewData: Boolean!
  }
`);

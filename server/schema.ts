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

  enum OpinionStatus {
    active
    stale
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
    baseVersion: Int!
    confirmedVersion: Int!
    status: OpinionStatus!
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
    baseVersion: Int!
  }

  type ResponseRevision {
    version: Int!
    responseText: String!
    attachmentName: String!
    proofFingerprint: String!
    claimedScore: Int!
    submittedBy: String!
    submittedAt: String!
    reason: String!
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

  type ResponseVersionBasis {
    responseId: String!
    version: Int!
    opinionIds: [String!]!
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
    basis: [ResponseVersionBasis!]!
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
    operationId: ID!
  }

  input ConfirmOpinionInput {
    opinionId: ID!
    actor: String!
    role: ReviewRole!
    baseVersion: Int!
    operationId: ID!
  }

  input ResponseRevisionInput {
    responseId: ID!
    responseText: String!
    attachmentName: String!
    proofFingerprint: String!
    claimedScore: Int!
    reason: String!
    actor: String!
    role: ReviewRole!
    baseVersion: Int!
    operationId: ID!
  }

  input ClarificationInput {
    responseId: ID!
    requestText: String!
    dueAt: String!
    actor: String!
    baseVersion: Int!
    operationId: ID!
  }

  input ClarificationResponseInput {
    clarificationId: ID!
    responseText: String!
    actor: String!
    baseVersion: Int!
    operationId: ID!
  }

  input FinalizeVersionInput {
    label: String!
    actor: String!
    role: ReviewRole!
    operationId: ID!
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

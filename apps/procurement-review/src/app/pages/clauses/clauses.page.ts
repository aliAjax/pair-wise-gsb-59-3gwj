import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";
import { RouterLink } from "@angular/router";
import { Actions, ofType } from "@ngrx/effects";
import { Store } from "@ngrx/store";
import type { TreeNode } from "primeng/api";
import { AccordionModule } from "primeng/accordion";
import { ButtonModule } from "primeng/button";
import { DatePickerModule } from "primeng/datepicker";
import { DialogModule } from "primeng/dialog";
import { InputNumberModule } from "primeng/inputnumber";
import { InputTextModule } from "primeng/inputtext";
import { SelectModule } from "primeng/select";
import { TagModule } from "primeng/tag";
import { TextareaModule } from "primeng/textarea";
import { TreeModule } from "primeng/tree";
import {
  complianceLabels,
  createOperationId,
  roleProfiles,
  type Clause,
  type ComplianceStatus,
  type ReviewerOpinion,
  type SupplierResponse,
} from "../../core/models/review.models";
import { ReviewActions } from "../../core/state/review.actions";
import {
  hasReviewDifference,
  outdatedOpinions,
  selectClauseTree,
  selectRole,
} from "../../core/state/review.selectors";
import {
  ClarificationTagComponent,
  ClauseTypeTagComponent,
  StatusTagComponent,
} from "../../shared/status-tag.component";

@Component({
  selector: "app-clauses-page",
  imports: [
    DatePipe,
    RouterLink,
    FormsModule,
    ReactiveFormsModule,
    AccordionModule,
    ButtonModule,
    DatePickerModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    TagModule,
    TextareaModule,
    TreeModule,
    StatusTagComponent,
    ClauseTypeTagComponent,
    ClarificationTagComponent,
  ],
  templateUrl: "./clauses.page.html",
  styleUrl: "./clauses.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClausesPage {
  private readonly store = inject(Store);
  private readonly actions$ = inject(Actions);

  readonly clauseTree = toSignal(this.store.select(selectClauseTree), {
    initialValue: [],
  });
  readonly treeNodes = computed(() => this.toTreeNodes(this.clauseTree()));
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly selectedTreeKey = signal<string | null>(null);
  readonly selectedSupplierId = signal<string | null>(null);
  readonly clarificationVisible = signal(false);
  readonly revisionVisible = signal(false);
  readonly selectedClause = computed(() => {
    const key = this.selectedTreeKey();
    if (!key) {
      return this.clauseTree()[0] ?? null;
    }
    return this.findClause(this.treeNodes(), key) ?? null;
  });
  readonly selectedResponse = computed(() => {
    const clause = this.selectedClause();
    if (!clause) {
      return null;
    }
    return (
      clause.responses.find(
        (response) => response.supplierId === this.selectedSupplierId(),
      ) ??
      clause.responses[0] ??
      null
    );
  });
  readonly canReview = computed(() => this.role() !== "procurement");
  readonly canRevise = computed(() =>
    ["procurement", "chair"].includes(this.role()),
  );
  readonly clauseRisks = computed(() => {
    const clause = this.selectedClause();
    if (!clause) {
      return [];
    }
    const risks: string[] = [];
    if (
      clause.type === "mandatory" &&
      clause.responses.some((response) => response.status === "pending")
    ) {
      risks.push("存在尚未明确结论的否决项");
    }
    if (clause.responses.some(hasReviewDifference)) {
      risks.push("不同评审员意见存在分歧，必须保留并进入小组复核");
    }
    const staleCount = clause.responses.reduce(
      (count, response) => count + outdatedOpinions(response).length,
      0,
    );
    if (staleCount > 0) {
      risks.push(
        `供应商响应已补交新版本，${staleCount} 条旧版意见已作废，待重新确认`,
      );
    }
    if (
      clause.responses.some((response) =>
        response.clarifications.some(
          (clarification) => clarification.status === "overdue",
        ),
      )
    ) {
      risks.push("存在逾期澄清，不得直接形成最终结论");
    }
    const duplicatedProof = new Set<string>();
    clause.responses.forEach((response) => {
      if (
        clause.responses.filter(
          (candidate) =>
            candidate.proofFingerprint === response.proofFingerprint,
        ).length > 1
      ) {
        duplicatedProof.add(response.proofFingerprint);
      }
    });
    if (duplicatedProof.size > 0) {
      risks.push("同一证明文件在多个响应中重复使用，需要确认适用范围");
    }
    return risks;
  });

  readonly decisionOptions = (
    Object.entries(complianceLabels) as Array<
      [ComplianceStatus, string]
    >
  ).map(([value, label]) => ({ value, label }));

  readonly assessmentForm = new FormGroup({
    decision: new FormControl<ComplianceStatus>("compliant", {
      nonNullable: true,
      validators: [Validators.required],
    }),
    score: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.min(0)],
    }),
    comment: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
  });

  readonly clarificationForm = new FormGroup({
    requestText: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
    dueAt: new FormControl(
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      { nonNullable: true },
    ),
  });

  readonly revisionForm = new FormGroup({
    responseText: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
    attachmentName: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required],
    }),
    proofFingerprint: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required],
    }),
    note: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(4)],
    }),
  });

  readonly minimumClarificationDate = new Date();

  /** 每次提交携带的幂等操作标识；成功后重新生成，失败重试沿用。 */
  private assessmentOperationId = createOperationId();
  private clarificationOperationId = createOperationId();
  private revisionOperationId = createOperationId();

  constructor() {
    this.actions$
      .pipe(ofType(ReviewActions.loadReviewDataSuccess), takeUntilDestroyed())
      .subscribe(() => {
        this.assessmentOperationId = createOperationId();
        this.clarificationOperationId = createOperationId();
        this.revisionOperationId = createOperationId();
      });
  }

  nodeTemplateData(node: TreeNode): Clause {
    return node.data as Clause;
  }

  selectNode(node: TreeNode): void {
    const clause = node.data as Clause;
    this.selectedTreeKey.set(clause.id);
    this.selectedSupplierId.set(clause.responses[0]?.supplierId ?? null);
    this.resetAssessmentForm(clause.responses[0]);
  }

  selectResponse(response: SupplierResponse): void {
    this.selectedSupplierId.set(response.supplierId);
    this.resetAssessmentForm(response);
  }

  staleCount(response: SupplierResponse): number {
    return outdatedOpinions(response).length;
  }

  submitAssessment(): void {
    const response = this.selectedResponse();
    const clause = this.selectedClause();
    if (!response || !clause || this.assessmentForm.invalid) {
      this.assessmentForm.markAllAsTouched();
      return;
    }
    if (!this.canReview()) {
      return;
    }
    const value = this.assessmentForm.getRawValue();
    this.store.dispatch(
      ReviewActions.submitAssessment({
        input: {
          responseId: response.id,
          decision: value.decision,
          score: clause.type === "scoring" ? value.score : 0,
          comment: value.comment,
          reviewer: roleProfiles[this.role()].name,
          role: this.role(),
          baseVersion: response.responseVersion,
          operationId: this.assessmentOperationId,
        },
      }),
    );
  }

  confirmOpinion(review: ReviewerOpinion, response: SupplierResponse): void {
    if (!this.canReview() || !review.stale) {
      return;
    }
    this.store.dispatch(
      ReviewActions.confirmOpinion({
        input: {
          opinionId: review.id,
          baseVersion: response.responseVersion,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
        },
      }),
    );
  }

  openClarificationDialog(): void {
    this.clarificationForm.reset({
      requestText: "",
      dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    this.clarificationVisible.set(true);
  }

  submitClarification(): void {
    const response = this.selectedResponse();
    if (!response || this.clarificationForm.invalid) {
      this.clarificationForm.markAllAsTouched();
      return;
    }
    const value = this.clarificationForm.getRawValue();
    this.store.dispatch(
      ReviewActions.requestClarification({
        input: {
          responseId: response.id,
          requestText: value.requestText,
          dueAt: value.dueAt.toISOString(),
          actor: roleProfiles[this.role()].name,
          baseVersion: response.responseVersion,
          operationId: this.clarificationOperationId,
        },
      }),
    );
    this.clarificationVisible.set(false);
  }

  openRevisionDialog(): void {
    const response = this.selectedResponse();
    if (!response) {
      return;
    }
    this.revisionForm.reset({
      responseText: response.responseText,
      attachmentName: response.attachmentName,
      proofFingerprint: response.proofFingerprint,
      note: "",
    });
    this.revisionVisible.set(true);
  }

  submitRevision(): void {
    const response = this.selectedResponse();
    if (!response || this.revisionForm.invalid) {
      this.revisionForm.markAllAsTouched();
      return;
    }
    const value = this.revisionForm.getRawValue();
    this.store.dispatch(
      ReviewActions.submitResponseRevision({
        input: {
          responseId: response.id,
          baseVersion: response.responseVersion,
          operationId: this.revisionOperationId,
          responseText: value.responseText,
          attachmentName: value.attachmentName,
          proofFingerprint: value.proofFingerprint,
          note: value.note,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
        },
      }),
    );
    this.revisionVisible.set(false);
  }

  latestOpinion(
    response: SupplierResponse,
    reviewer: string,
  ): string | undefined {
    return response.reviews.find((review) => review.reviewer === reviewer)
      ?.comment;
  }

  private findClause(
    nodes: readonly TreeNode<Clause>[],
    clauseId: string,
  ): Clause | undefined {
    for (const node of nodes) {
      if (node.data?.id === clauseId) {
        return node.data;
      }
      const child = this.findClause(node.children ?? [], clauseId);
      if (child) {
        return child;
      }
    }
    return undefined;
  }

  private toTreeNodes(nodes: readonly Clause[]): TreeNode<Clause>[] {
    return nodes.map((clause) => ({
      key: clause.id,
      label: `${clause.code} ${clause.title}`,
      data: clause,
      children: this.toTreeNodes(clause.children ?? []),
    }));
  }

  private resetAssessmentForm(response: SupplierResponse | undefined): void {
    if (!response) {
      return;
    }
    const latest = [...response.reviews].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )[0];
    this.assessmentForm.reset({
      decision: latest?.decision ?? response.status,
      score: latest?.score ?? response.claimedScore,
      comment: "",
    });
  }
}

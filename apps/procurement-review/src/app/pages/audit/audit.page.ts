import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { Store } from "@ngrx/store";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";
import { SelectModule } from "primeng/select";
import { TableModule } from "primeng/table";
import { TagModule } from "primeng/tag";
import { ReviewActions } from "../../core/state/review.actions";
import {
  selectAuditLogs,
  selectOpinionVersionItems,
  selectRole,
  selectStaleOpinionItems,
  selectVersions,
  type OpinionVersionItem,
} from "../../core/state/review.selectors";
import {
  complianceLabels,
  roleProfiles,
} from "../../core/models/review.models";
import { StatusTagComponent } from "../../shared/status-tag.component";

@Component({
  selector: "app-audit-page",
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TableModule,
    TagModule,
    StatusTagComponent,
  ],
  templateUrl: "./audit.page.html",
  styleUrl: "./audit.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditPage {
  private readonly store = inject(Store);

  readonly roleProfiles = roleProfiles;
  readonly logs = toSignal(this.store.select(selectAuditLogs), {
    initialValue: [],
  });
  readonly versions = toSignal(this.store.select(selectVersions), {
    initialValue: [],
  });
  readonly opinionItems = toSignal(this.store.select(selectOpinionVersionItems), {
    initialValue: [] as OpinionVersionItem[],
  });
  readonly staleItems = toSignal(this.store.select(selectStaleOpinionItems), {
    initialValue: [] as OpinionVersionItem[],
  });
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly keyword = signal("");
  readonly action = signal("all");
  readonly actionOptions = computed(() => [
    { label: "全部动作", value: "all" },
    ...Array.from(new Set(this.logs().map((log) => log.action))).map(
      (item) => ({ label: item, value: item }),
    ),
  ]);
  readonly filteredLogs = computed(() => {
    const keyword = this.keyword().trim().toLowerCase();
    const action = this.action();
    return this.logs().filter((log) => {
      const matchesAction = action === "all" || log.action === action;
      const matchesKeyword =
        !keyword ||
        [log.actor, log.action, log.entity, log.detail]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      return matchesAction && matchesKeyword;
    });
  });
  readonly finalVersion = computed(
    () => this.versions().find((version) => version.status === "finalized"),
  );
  readonly finalizedCount = computed(
    () => this.versions().filter((version) => version.status === "finalized").length,
  );

  decisionLabel(item: OpinionVersionItem): string {
    return complianceLabels[item.opinion.decision];
  }

  exportJson(): void {
    const payload = {
      generatedAt: new Date().toISOString(),
      auditLogs: this.filteredLogs(),
      opinionVersionStatus: this.opinionItems().map((item) => ({
        clause: `${item.clause.code} ${item.clause.title}`,
        responseId: item.response.id,
        supplier: item.response.supplierName,
        opinionId: item.opinion.id,
        reviewer: item.opinion.reviewer,
        decision: this.decisionLabel(item),
        score: item.opinion.score,
        opinionVersion: item.opinion.responseVersion,
        currentResponseVersion: item.response.responseVersion,
        status: item.opinion.stale ? "待重新确认" : "已确认",
      })),
    };
    this.download(
      "procurement-review-audit.json",
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
  }

  exportCsv(): void {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const auditHeader = ["时间", "操作人", "动作", "对象", "详情"];
    const auditRows = this.filteredLogs().map((log) => [
      log.at,
      log.actor,
      log.action,
      log.entity,
      log.detail,
    ]);
    const opinionHeader = [
      "条款",
      "供应商",
      "评审员",
      "结论",
      "评分",
      "意见版本",
      "当前响应版本",
      "状态",
    ];
    const opinionRows = this.opinionItems().map((item) => [
      `${item.clause.code} ${item.clause.title}`,
      item.response.supplierName,
      item.opinion.reviewer,
      this.decisionLabel(item),
      String(item.opinion.score),
      `第 ${item.opinion.responseVersion} 版`,
      `第 ${item.response.responseVersion} 版`,
      item.opinion.stale ? "待重新确认" : "已确认",
    ]);
    const csv = [
      auditHeader,
      ...auditRows,
      [],
      opinionHeader,
      ...opinionRows,
    ]
      .map((row) => row.map((value) => quote(value)).join(","))
      .join("\n");
    this.download(
      "procurement-review-audit.csv",
      csv,
      "text/csv;charset=utf-8",
    );
  }

  resetReviewData(): void {
    this.store.dispatch(ReviewActions.resetReviewData());
  }

  private download(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

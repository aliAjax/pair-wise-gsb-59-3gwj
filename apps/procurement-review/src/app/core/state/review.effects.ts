import { Injectable, inject } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { catchError, concat, delay, map, of, switchMap } from "rxjs";
import { ReviewGraphqlService } from "../services/graphql.service";
import { ReviewActions } from "./review.actions";

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "GraphQL 请求失败，请检查本地 mock server。";
};

/**
 * 版本冲突类失败（响应已补交新版）后重新拉取工作区，
 * 让页面展示最新响应版本，避免用户在过期内容上反复重试。
 */
const failureThenResync = (error: unknown) =>
  concat(
    of(ReviewActions.loadReviewDataFailure({ error: errorMessage(error) })),
    of(ReviewActions.loadReviewData()).pipe(delay(600)),
  );

@Injectable()
export class ReviewEffects {
  private readonly actions$ = inject(Actions);
  private readonly graphql = inject(ReviewGraphqlService);

  loadReviewData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.loadReviewData),
      switchMap(() =>
        this.graphql.loadWorkspace().pipe(
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({ workspace }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  submitAssessment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.submitAssessment),
      switchMap(({ input }) =>
        this.graphql.submitAssessment(input).pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: `评审意见已按第 ${input.baseVersion} 版响应提交，其他评审员意见保持不变。`,
            }),
          ),
          catchError((error: unknown) => failureThenResync(error)),
        ),
      ),
    ),
  );

  confirmOpinion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.confirmOpinion),
      switchMap(({ input }) =>
        this.graphql.confirmOpinion(input).pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: `意见已按第 ${input.baseVersion} 版响应重新确认。`,
            }),
          ),
          catchError((error: unknown) => failureThenResync(error)),
        ),
      ),
    ),
  );

  submitResponseRevision$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.submitResponseRevision),
      switchMap(({ input }) =>
        this.graphql.submitResponseRevision(input).pipe(
          switchMap((response) =>
            this.graphql.loadWorkspace().pipe(
              map(({ workspace }) =>
                ReviewActions.loadReviewDataSuccess({
                  workspace,
                  toast: `补交已登记为第 ${response.responseVersion} 版响应，旧版意见待重新确认。`,
                }),
              ),
            ),
          ),
          catchError((error: unknown) => failureThenResync(error)),
        ),
      ),
    ),
  );

  requestClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.requestClarification),
      switchMap(({ input }) =>
        this.graphql.requestClarification(input).pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: "澄清要求已发出，并写入审计日志。",
            }),
          ),
          catchError((error: unknown) => failureThenResync(error)),
        ),
      ),
    ),
  );

  respondClarification$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.respondClarification),
      switchMap(({ input }) =>
        this.graphql.respondClarification(input).pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: "澄清回复已登记为新响应版本，相关意见待重新确认。",
            }),
          ),
          catchError((error: unknown) => failureThenResync(error)),
        ),
      ),
    ),
  );

  finalizeVersion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.finalizeVersion),
      switchMap(({ input }) =>
        this.graphql.finalizeVersion(input).pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: "评审版本已汇总签字并锁定，仅采纳当前版本已确认意见。",
            }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  resetReviewData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ReviewActions.resetReviewData),
      switchMap(() =>
        this.graphql.resetReviewData().pipe(
          switchMap(() => this.graphql.loadWorkspace()),
          map(({ workspace }) =>
            ReviewActions.loadReviewDataSuccess({
              workspace,
              toast: "评审演示数据已恢复。",
            }),
          ),
          catchError((error: unknown) =>
            of(
              ReviewActions.loadReviewDataFailure({
                error: errorMessage(error),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

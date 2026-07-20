import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizeQuestionScopes,
  questionMatchesScopes,
} from "@/lib/question-scope";
import {
  questionMatchesModule,
  questionMatchesPool,
  StudyPlanTaskError,
  type ProgramStudyPlanTask,
  type TaskQuestion,
} from "@/lib/study-plan-task";

export type AcceptanceGap = {
  code: string;
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
};

export type ProgramEvidenceEvaluation = {
  evidenceId: string;
  evidenceType: "TRAINING_REPORT" | "ESSAY_SUBMISSION";
  evidenceKey: string;
  completedAt: string;
  criteria: Record<string, unknown>;
  actual: Record<string, unknown>;
  gaps: AcceptanceGap[];
};

function stringArray(value: Prisma.JsonValue) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string") ||
    new Set(value).size !== value.length
  )
    return null;
  return value as string[];
}

function roundAccuracy(correct: number, answered: number) {
  return answered ? Math.round((correct / answered) * 1_000) / 10 : 0;
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function addGap(
  gaps: AcceptanceGap[],
  code: string,
  field: string,
  expected: unknown,
  actual: unknown,
  message: string,
) {
  gaps.push({ code, field, expected, actual, message });
}

async function completeMaterialGroups(questions: TaskQuestion[]) {
  const answeredByMaterial = new Map<string, Set<string>>();
  for (const question of questions) {
    if (!question.materialId) continue;
    const ids = answeredByMaterial.get(question.materialId) || new Set<string>();
    ids.add(question.id);
    answeredByMaterial.set(question.materialId, ids);
  }
  const materialIds = Array.from(answeredByMaterial.keys());
  if (!materialIds.length) return 0;
  const materialQuestions = await prisma.question.findMany({
    where: { materialId: { in: materialIds }, status: "PUBLISHED" },
    select: { id: true, materialId: true },
  });
  const bankGroups = new Map<string, Set<string>>();
  for (const question of materialQuestions) {
    if (!question.materialId) continue;
    const ids = bankGroups.get(question.materialId) || new Set<string>();
    ids.add(question.id);
    bankGroups.set(question.materialId, ids);
  }
  return materialIds.filter((materialId) => {
    const bankIds = bankGroups.get(materialId);
    const answeredIds = answeredByMaterial.get(materialId)!;
    return (
      bankIds?.size === 5 &&
      answeredIds.size === 5 &&
      Array.from(bankIds).every((id) => answeredIds.has(id))
    );
  }).length;
}

async function evaluateTrainingReport(
  task: ProgramStudyPlanTask,
  userId: string,
  evidenceId: string,
): Promise<ProgramEvidenceEvaluation> {
  if (task.completionSpec.kind === "ESSAY")
    throw new Error("ESSAY_SPEC_CANNOT_USE_TRAINING_REPORT");
  const spec = task.completionSpec;
  const report = await prisma.trainingReport.findFirst({
    where: { id: evidenceId, userId },
  });
  if (!report)
    throw new StudyPlanTaskError(
      404,
      "EVIDENCE_NOT_FOUND",
      "未找到训练验收证据",
    );
  const boundToTask =
    report.studyPlanId === task.planId &&
    report.studyPlanTaskKey === task.taskKey;
  const unboundTraining = !report.studyPlanId && !report.studyPlanTaskKey;
  if (!boundToTask && !unboundTraining)
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_NOT_BOUND",
      "该训练结果已绑定到其他规划任务",
    );
  const expectedMode = spec.evidence.mode;
  if (report.mode !== expectedMode)
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_MODE_MISMATCH",
      "训练结果模式与规划任务不匹配",
    );
  if (
    report.startedAt.getTime() < task.generatedAt.getTime() ||
    report.completedAt.getTime() < report.startedAt.getTime() ||
    (!unboundTraining &&
      (report.startedAt.getTime() > task.expiresAt.getTime() ||
        report.completedAt.getTime() > task.expiresAt.getTime()))
  )
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_TIME_INVALID",
      "训练结果不在计划任务的有效时间范围内",
    );

  const attemptIds = stringArray(report.attemptIds);
  const reportQuestionIds = stringArray(report.questionIds);
  if (!attemptIds || !reportQuestionIds)
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_INVALID",
      "训练结果的证据链不完整",
    );
  let trustedElapsedSeconds = Math.max(
    0,
    Math.floor(
      (report.completedAt.getTime() - report.startedAt.getTime()) / 1_000,
    ),
  );
  if (report.mode === "PRACTICE") {
    if (!report.practiceSessionId || report.examSessionId)
      throw new StudyPlanTaskError(
        409,
        "EVIDENCE_INVALID",
        "专项训练总结缺少原始会话",
      );
    const source = await prisma.practiceSession.findFirst({
      where: {
        id: report.practiceSessionId,
        userId,
        status: "SUBMITTED",
      },
      select: {
        questionIds: true,
        startedAt: true,
        completedAt: true,
        studyPlanId: true,
        studyPlanTaskKey: true,
      },
    });
    const sourceBoundToTask =
      source?.studyPlanId === task.planId &&
      source?.studyPlanTaskKey === task.taskKey;
    const sourceUnbound = !source?.studyPlanId && !source?.studyPlanTaskKey;
    const sourceQuestionIds = source ? stringArray(source.questionIds) : null;
    if (
      !source ||
      (!sourceBoundToTask && !sourceUnbound) ||
      (unboundTraining !== sourceUnbound) ||
      !sourceQuestionIds ||
      !sameStrings(sourceQuestionIds, reportQuestionIds) ||
      source.startedAt.getTime() !== report.startedAt.getTime() ||
      source.completedAt?.getTime() !== report.completedAt.getTime()
    )
      throw new StudyPlanTaskError(
        409,
        "EVIDENCE_INVALID",
        "专项训练总结与原始会话不一致",
      );
  } else {
    if (!report.examSessionId || report.practiceSessionId)
      throw new StudyPlanTaskError(
        409,
        "EVIDENCE_INVALID",
        "模拟考试总结缺少原始会话",
      );
    const source = await prisma.examSession.findFirst({
      where: {
        id: report.examSessionId,
        userId,
        status: "SUBMITTED",
      },
      select: {
        questionIds: true,
        config: true,
        startedAt: true,
        submittedAt: true,
        durationMinutes: true,
        studyPlanId: true,
        studyPlanTaskKey: true,
      },
    });
    const sourceBoundToTask =
      source?.studyPlanId === task.planId &&
      source?.studyPlanTaskKey === task.taskKey;
    const sourceUnbound = !source?.studyPlanId && !source?.studyPlanTaskKey;
    const sourceQuestionIds = source ? stringArray(source.questionIds) : null;
    const config =
      source?.config &&
      typeof source.config === "object" &&
      !Array.isArray(source.config)
        ? (source.config as Record<string, unknown>)
        : {};
    if (
      !source ||
      (!sourceBoundToTask && !sourceUnbound) ||
      (unboundTraining !== sourceUnbound) ||
      !sourceQuestionIds ||
      !sameStrings(sourceQuestionIds, reportQuestionIds) ||
      source.startedAt.getTime() !== report.startedAt.getTime() ||
      source.submittedAt?.getTime() !== report.completedAt.getTime() ||
      config.templateId !== report.templateId
    )
      throw new StudyPlanTaskError(
        409,
        "EVIDENCE_INVALID",
        "模拟考试总结与原始会话不一致",
      );
    trustedElapsedSeconds = Math.min(
      source.durationMinutes * 60,
      trustedElapsedSeconds,
    );
    if (report.durationSeconds !== trustedElapsedSeconds)
      throw new StudyPlanTaskError(
        409,
        "EVIDENCE_INVALID",
        "模拟考试总结的服务端用时不一致",
      );
  }
  const attempts = attemptIds.length
    ? await prisma.attempt.findMany({
        where: { id: { in: attemptIds }, userId },
        select: {
          id: true,
          questionId: true,
          correct: true,
          mode: true,
          practiceSessionId: true,
        },
      })
    : [];
  const reportQuestionSet = new Set(reportQuestionIds);
  if (
    report.total !== reportQuestionIds.length ||
    attempts.length !== attemptIds.length ||
    attempts.some(
      (attempt) =>
        !reportQuestionSet.has(attempt.questionId) ||
        attempt.mode !== report.mode ||
        (report.mode === "PRACTICE" &&
          attempt.practiceSessionId !== report.practiceSessionId),
    )
  )
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_INVALID",
      "训练结果关联的作答记录不完整",
    );
  const answeredQuestionIds = Array.from(
    new Set(attempts.map((attempt) => attempt.questionId)),
  );
  if (answeredQuestionIds.length !== attempts.length)
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_INVALID",
      "训练结果包含重复作答证据",
    );
  const questions = answeredQuestionIds.length
    ? await prisma.question.findMany({
        where: { id: { in: answeredQuestionIds } },
        select: {
          id: true,
          type: true,
          stem: true,
          difficultyScore: true,
          materialId: true,
          category: { select: { name: true } },
        },
      })
    : [];
  if (questions.length !== answeredQuestionIds.length)
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_INVALID",
      "训练结果关联的题目不存在",
    );
  const answered = attempts.length;
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const accuracy = roundAccuracy(correct, answered);
  if (
    report.answered !== answered ||
    report.correct !== correct ||
    Math.abs(report.accuracy - accuracy) > 0.01
  )
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_INVALID",
      "训练总结与原始作答记录不一致",
    );

  const launch = spec.launch;
  const launchRecord = launch as unknown as Record<string, unknown>;
  const requiredCategory =
    typeof launchRecord.category === "string" ? launchRecord.category : null;
  const requiredScopes = normalizeQuestionScopes(launchRecord.scopes);
  const requiredModuleSatisfied = spec.requiredModule
    ? questions.length > 0 &&
      questions.every((question) =>
        questionMatchesModule(question, spec.requiredModule!),
      )
    : true;
  const requiredQuestionPool =
    launch.kind === "PRACTICE" ? launch.questionPool : null;
  const questionPoolSatisfied = requiredQuestionPool
    ? questions.length > 0 &&
      questions.every((question) =>
        questionMatchesPool(question, requiredQuestionPool),
      )
    : true;
  const categorySatisfied = requiredCategory
    ? questions.length > 0 &&
      questions.every((question) => question.category.name === requiredCategory)
    : true;
  const scopesSatisfied = requiredScopes.length
    ? questions.length > 0 &&
      questions.every((question) => questionMatchesScopes(question, requiredScopes))
    : true;
  const difficultyScores = questions.map((question) => question.difficultyScore);
  const actualDifficultyRange = difficultyScores.length
    ? { min: Math.min(...difficultyScores), max: Math.max(...difficultyScores) }
    : null;
  const difficultyRangeSatisfied = spec.difficultyRange
    ? questions.length > 0 &&
      difficultyScores.every(
        (score) =>
          score >= spec.difficultyRange!.min &&
          score <= spec.difficultyRange!.max,
      )
    : true;
  const materialGroups = await completeMaterialGroups(questions);
  const criteria = {
    evidence: spec.evidence,
    minAnswered: spec.minAnswered,
    minAccuracy: spec.minAccuracy,
    maxElapsedSeconds: spec.maxElapsedSeconds,
    requiredModule: spec.requiredModule,
    requiredCategory,
    requiredScopes,
    difficultyRange: spec.difficultyRange,
    minCompleteMaterialGroups: spec.minCompleteMaterialGroups,
    requiredTemplateId: spec.requiredTemplateId,
    questionPool: requiredQuestionPool,
  };
  const actual = {
    mode: report.mode,
    answered,
    correct,
    accuracy,
    elapsedSeconds: trustedElapsedSeconds,
    activeDurationSeconds: report.durationSeconds,
    requiredModuleSatisfied,
    categorySatisfied,
    scopesSatisfied,
    questionPoolSatisfied,
    difficultyRange: actualDifficultyRange,
    difficultyRangeSatisfied,
    completeMaterialGroups: materialGroups,
    templateId: report.templateId,
    startedAt: report.startedAt.toISOString(),
    completedAt: report.completedAt.toISOString(),
  };
  const gaps: AcceptanceGap[] = [];
  if (answered < spec.minAnswered)
    addGap(
      gaps,
      "MIN_ANSWERED",
      "answered",
      spec.minAnswered,
      answered,
      `还需完成 ${spec.minAnswered - answered} 题`,
    );
  if (spec.minAccuracy !== null && accuracy < spec.minAccuracy)
    addGap(
      gaps,
      "MIN_ACCURACY",
      "accuracy",
      spec.minAccuracy,
      accuracy,
      `正确率还需提高 ${Math.round((spec.minAccuracy - accuracy) * 10) / 10} 个百分点`,
    );
  if (
    spec.maxElapsedSeconds !== null &&
    trustedElapsedSeconds > spec.maxElapsedSeconds
  )
    addGap(
      gaps,
      "MAX_ELAPSED_SECONDS",
      "elapsedSeconds",
      spec.maxElapsedSeconds,
      trustedElapsedSeconds,
      `用时超出 ${trustedElapsedSeconds - spec.maxElapsedSeconds} 秒`,
    );
  if (!requiredModuleSatisfied || !categorySatisfied || !scopesSatisfied || !questionPoolSatisfied)
    addGap(
      gaps,
      "REQUIRED_MODULE",
      "requiredModule",
      requiredScopes.length ? requiredScopes : requiredCategory || spec.requiredModule,
      false,
      "作答题目不完全属于计划指定板块或细分题型",
    );
  if (!difficultyRangeSatisfied)
    addGap(
      gaps,
      "DIFFICULTY_RANGE",
      "difficultyRange",
      spec.difficultyRange,
      actualDifficultyRange,
      "存在超出计划难度范围的题目",
    );
  if (materialGroups < spec.minCompleteMaterialGroups)
    addGap(
      gaps,
      "COMPLETE_MATERIAL_GROUPS",
      "completeMaterialGroups",
      spec.minCompleteMaterialGroups,
      materialGroups,
      `还需完整作答 ${spec.minCompleteMaterialGroups - materialGroups} 组五题材料`,
    );
  if (
    spec.requiredTemplateId !== null &&
    report.templateId !== spec.requiredTemplateId
  )
    addGap(
      gaps,
      "REQUIRED_TEMPLATE",
      "templateId",
      spec.requiredTemplateId,
      report.templateId,
      "提交的模拟卷型与计划不一致",
    );
  return {
    evidenceId,
    evidenceType: "TRAINING_REPORT",
    evidenceKey: `TRAINING_REPORT:${evidenceId}`,
    completedAt: report.completedAt.toISOString(),
    criteria,
    actual,
    gaps,
  };
}

async function evaluateEssaySubmission(
  task: ProgramStudyPlanTask,
  userId: string,
  evidenceId: string,
): Promise<ProgramEvidenceEvaluation> {
  if (task.completionSpec.kind !== "ESSAY")
    throw new Error("TRAINING_SPEC_CANNOT_USE_ESSAY_SUBMISSION");
  const spec = task.completionSpec;
  const submission = await prisma.essaySubmission.findFirst({
    where: { id: evidenceId, userId },
    include: { question: { select: { wordLimit: true } } },
  });
  if (!submission)
    throw new StudyPlanTaskError(
      404,
      "EVIDENCE_NOT_FOUND",
      "未找到申论验收证据",
    );
  if (
    submission.studyPlanId !== task.planId ||
    submission.studyPlanTaskKey !== task.taskKey
  )
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_NOT_BOUND",
      "该申论作答未绑定到当前规划任务",
    );
  if (
    submission.createdAt.getTime() < task.generatedAt.getTime() ||
    submission.createdAt.getTime() > task.expiresAt.getTime()
  )
    throw new StudyPlanTaskError(
      409,
      "EVIDENCE_TIME_INVALID",
      "申论作答不在计划任务的有效时间范围内",
    );
  const withinWordLimit = submission.wordCount <= submission.question.wordLimit;
  const criteria = {
    evidence: spec.evidence,
    minWordCount: spec.minWordCount,
    minScore: spec.minScore,
    withinWordLimit: spec.withinWordLimit,
  };
  const actual = {
    wordCount: submission.wordCount,
    score: submission.score,
    wordLimit: submission.question.wordLimit,
    withinWordLimit,
    createdAt: submission.createdAt.toISOString(),
  };
  const gaps: AcceptanceGap[] = [];
  if (submission.wordCount < spec.minWordCount)
    addGap(
      gaps,
      "MIN_WORD_COUNT",
      "wordCount",
      spec.minWordCount,
      submission.wordCount,
      `还需补充 ${spec.minWordCount - submission.wordCount} 字`,
    );
  if (submission.score < spec.minScore)
    addGap(
      gaps,
      "MIN_SCORE",
      "score",
      spec.minScore,
      submission.score,
      `得分还需提高 ${spec.minScore - submission.score} 分`,
    );
  if (spec.withinWordLimit && !withinWordLimit)
    addGap(
      gaps,
      "WORD_LIMIT",
      "wordCount",
      submission.question.wordLimit,
      submission.wordCount,
      `超出题目限字 ${submission.wordCount - submission.question.wordLimit} 字`,
    );
  return {
    evidenceId,
    evidenceType: "ESSAY_SUBMISSION",
    evidenceKey: `ESSAY_SUBMISSION:${evidenceId}`,
    completedAt: submission.createdAt.toISOString(),
    criteria,
    actual,
    gaps,
  };
}

export function evaluateProgramEvidence(
  task: ProgramStudyPlanTask,
  userId: string,
  evidenceId: string,
) {
  return task.completionSpec.kind === "ESSAY"
    ? evaluateEssaySubmission(task, userId, evidenceId)
    : evaluateTrainingReport(task, userId, evidenceId);
}

export async function currentProgramCheckIn(task: ProgramStudyPlanTask) {
  return prisma.studyPlanCheckIn.findFirst({
    where: {
      planId: task.planId,
      taskKey: task.taskKey,
      taskIndex: task.taskIndex,
      acceptanceMethod: "PROGRAM_VERIFIED",
      specHash: task.specHash,
      taskTitle: task.taskTitle,
      targetSnapshot: task.targetSnapshot,
      checkpointSnapshot: task.checkpointSnapshot,
    },
  });
}

export async function findLatestProgramEvidence(
  task: ProgramStudyPlanTask,
  userId: string,
) {
  const essay = task.completionSpec.kind === "ESSAY";
  const evidenceType = essay ? "ESSAY_SUBMISSION" : "TRAINING_REPORT";
  const rows = essay
    ? await prisma.essaySubmission.findMany({
          where: {
            userId,
            studyPlanId: task.planId,
            studyPlanTaskKey: task.taskKey,
            createdAt: { gte: task.generatedAt, lte: task.expiresAt },
          },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
    : await prisma.trainingReport.findMany({
          where: {
            userId,
            OR: [
              {
                studyPlanId: task.planId,
                studyPlanTaskKey: task.taskKey,
              },
              {
                studyPlanId: null,
                studyPlanTaskKey: null,
              },
            ],
            mode:
              task.completionSpec.kind === "ESSAY"
                ? undefined
                : task.completionSpec.evidence.mode,
            startedAt: { gte: task.generatedAt },
          },
          select: { id: true },
          orderBy: { completedAt: "desc" },
          take: 20,
        });
  if (!rows.length) return null;
  const keys = rows.map((row) => `${evidenceType}:${row.id}`);
  const claims = await prisma.studyPlanEvidenceClaim.findMany({
    where: { evidenceKey: { in: keys } },
    select: { evidenceKey: true },
  });
  const claimed = new Set(claims.map((claim) => claim.evidenceKey));
  let latestUnmet: ProgramEvidenceEvaluation | null = null;
  for (const row of rows) {
    if (claimed.has(`${evidenceType}:${row.id}`)) continue;
    try {
      const evaluation = await evaluateProgramEvidence(task, userId, row.id);
      if (!evaluation.gaps.length) return evaluation;
      latestUnmet ||= evaluation;
    } catch (reason) {
      if (reason instanceof StudyPlanTaskError) continue;
      throw reason;
    }
  }
  return latestUnmet;
}

export async function persistProgramCheckIn(
  task: ProgramStudyPlanTask,
  evaluation: ProgramEvidenceEvaluation,
) {
  const existing = await currentProgramCheckIn(task);
  if (existing) return existing;
  const createData = {
    planId: task.planId,
    taskKey: task.taskKey,
    taskIndex: task.taskIndex,
    taskTitle: task.taskTitle,
    targetSnapshot: task.targetSnapshot,
    checkpointSnapshot: task.checkpointSnapshot,
    acceptanceMethod: "PROGRAM_VERIFIED",
    evidenceType: evaluation.evidenceType,
    evidenceId: evaluation.evidenceId,
    evidenceKey: evaluation.evidenceKey,
    criteriaSnapshot: evaluation.criteria as Prisma.InputJsonValue,
    actualSnapshot: evaluation.actual as Prisma.InputJsonValue,
    specHash: task.specHash,
  } as const;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const raced = await tx.studyPlanCheckIn.findFirst({
          where: {
            planId: task.planId,
            taskKey: task.taskKey,
            taskIndex: task.taskIndex,
            acceptanceMethod: "PROGRAM_VERIFIED",
            specHash: task.specHash,
            taskTitle: task.taskTitle,
            targetSnapshot: task.targetSnapshot,
            checkpointSnapshot: task.checkpointSnapshot,
          },
        });
        if (raced) return raced;
        const claim = await tx.studyPlanEvidenceClaim.findUnique({
          where: { evidenceKey: evaluation.evidenceKey },
        });
        if (claim)
          throw new StudyPlanTaskError(
            409,
            "EVIDENCE_ALREADY_USED",
            "该证据已经用于其他验收任务",
          );
        await tx.studyPlanEvidenceClaim.create({
          data: {
            planId: task.planId,
            taskKey: task.taskKey,
            taskIndex: task.taskIndex,
            evidenceType: evaluation.evidenceType,
            evidenceId: evaluation.evidenceId,
            evidenceKey: evaluation.evidenceKey,
            specHash: task.specHash,
          },
        });
        await tx.studyPlanCheckIn.deleteMany({
          where: {
            planId: task.planId,
            OR: [{ taskKey: task.taskKey }, { taskIndex: task.taskIndex }],
          },
        });
        return tx.studyPlanCheckIn.create({ data: createData });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (reason) {
    if (reason instanceof StudyPlanTaskError) throw reason;
    if (
      reason instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(reason.code)
    ) {
      const raced = await currentProgramCheckIn(task);
      if (raced) return raced;
      const claim = await prisma.studyPlanEvidenceClaim.findUnique({
        where: { evidenceKey: evaluation.evidenceKey },
      });
      if (claim)
        throw new StudyPlanTaskError(
          409,
          "EVIDENCE_ALREADY_USED",
          "该证据已经用于其他验收任务",
        );
      throw new StudyPlanTaskError(
        409,
        "ACCEPTANCE_CONFLICT",
        "验收状态刚刚发生变化，请重试",
      );
    }
    throw reason;
  }
}

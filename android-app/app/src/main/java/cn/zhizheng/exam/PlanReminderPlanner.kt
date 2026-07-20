package cn.zhizheng.exam

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class PlannedStudyReminder(
    val scheduledDate: LocalDate,
    val triggerAtMillis: Long,
    val day: SmartPlanDay
)

object PlanReminderPlanner {
    fun plan(
        studyPlan: SyncedStudyPlan,
        nowMillis: Long,
        zoneId: ZoneId,
        hour: Int,
        minute: Int,
        deliveredEpochDays: Set<Long>,
        includeMissedToday: Boolean = true
    ): List<PlannedStudyReminder> {
        val now = Instant.ofEpochMilli(nowMillis)
        if (!studyPlan.expiresAt.isAfter(now)) return emptyList()
        return studyPlan.days.mapNotNull { day ->
            if (day.tasks.none { it.type != "REST" } ||
                day.scheduledDate.toEpochDay() in deliveredEpochDays
            ) return@mapNotNull null
            val triggerAt = SmartPlanTimeCalculator.effectiveTriggerAt(
                day.scheduledDate,
                nowMillis,
                hour,
                minute,
                zoneId,
                includeMissedToday
            ) ?: return@mapNotNull null
            if (!Instant.ofEpochMilli(triggerAt).isBefore(studyPlan.expiresAt)) {
                return@mapNotNull null
            }
            PlannedStudyReminder(day.scheduledDate, triggerAt, day)
        }.sortedBy { it.scheduledDate }
    }
}

data class PlanReminderCopy(
    val title: String,
    val body: String,
    val lines: List<String>
)

object PlanReminderSummary {
    fun compose(day: SmartPlanDay): PlanReminderCopy {
        val activeTasks = day.tasks.filter { it.type != "REST" }
        val totalMinutes = activeTasks.sumOf { it.minutes }
        val lines = activeTasks.take(6).map { task ->
            val module = task.module?.let { " [$it]" }.orEmpty()
            "${task.title}$module · ${task.minutes} 分钟".take(120)
        }
        val body = when (activeTasks.size) {
            0 -> "今天没有需要提醒的训练任务"
            1 -> "今日 1 项任务，共 $totalMinutes 分钟：${activeTasks.first().title}"
            else -> "今日 ${activeTasks.size} 项任务，共 $totalMinutes 分钟，按计划逐项完成并及时复盘。"
        }.take(240)
        return PlanReminderCopy(
            title = "第 ${day.day} 天学习安排",
            body = body,
            lines = lines
        )
    }
}

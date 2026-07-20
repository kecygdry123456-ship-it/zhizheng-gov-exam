package cn.zhizheng.exam

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

object SmartPlanTimeCalculator {
    fun triggerAt(
        date: LocalDate,
        hour: Int,
        minute: Int,
        zoneId: ZoneId
    ): Long {
        require(hour in 0..23)
        require(minute in 0..59)
        return date.atTime(LocalTime.of(hour, minute)).atZone(zoneId).toInstant().toEpochMilli()
    }

    fun pendingDays(
        plan: SyncedStudyPlan,
        nowMillis: Long,
        zoneId: ZoneId,
        hour: Int,
        minute: Int,
        deliveredDates: Set<LocalDate>,
        includeMissedToday: Boolean = false
    ): List<SmartPlanDay> {
        val now = Instant.ofEpochMilli(nowMillis)
        if (!plan.expiresAt.isAfter(now)) return emptyList()
        return plan.days.filter { day ->
            day.tasks.any { it.type != "REST" } &&
                day.scheduledDate !in deliveredDates &&
                effectiveTriggerAt(
                    day.scheduledDate,
                    nowMillis,
                    hour,
                    minute,
                    zoneId,
                    includeMissedToday
                )?.let { Instant.ofEpochMilli(it) < plan.expiresAt } == true
        }
    }

    fun effectiveTriggerAt(
        date: LocalDate,
        nowMillis: Long,
        hour: Int,
        minute: Int,
        zoneId: ZoneId,
        includeMissedToday: Boolean = false
    ): Long? {
        val configured = triggerAt(date, hour, minute, zoneId)
        if (configured > nowMillis) return configured
        val today = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDate()
        return if (includeMissedToday && date == today) nowMillis + 60_000 else null
    }
}

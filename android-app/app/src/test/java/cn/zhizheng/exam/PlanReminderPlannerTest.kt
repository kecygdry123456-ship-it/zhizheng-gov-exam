package cn.zhizheng.exam

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanReminderPlannerTest {
    private val zone = ZoneId.of("Asia/Shanghai")

    @Test
    fun schedulesTodayAtConfiguredTimeWhenTimeIsStillAhead() {
        val now = ZonedDateTime.of(2026, 7, 15, 19, 0, 0, 0, zone)
        val expected = ZonedDateTime.of(2026, 7, 15, 20, 30, 0, 0, zone)

        val reminders = PlanReminderPlanner.plan(
            parsedPlan(),
            now.toInstant().toEpochMilli(),
            zone,
            20,
            30,
            emptySet()
        )

        assertEquals(1, reminders.size)
        assertEquals(LocalDate.of(2026, 7, 15), reminders.single().scheduledDate)
        assertEquals(expected.toInstant().toEpochMilli(), reminders.single().triggerAtMillis)
    }

    @Test
    fun usesShortDelayForTodaysPlanWhenConfiguredTimeHasPassed() {
        val now = ZonedDateTime.of(2026, 7, 15, 20, 5, 0, 0, zone)
        val reminders = PlanReminderPlanner.plan(
            parsedPlan(),
            now.toInstant().toEpochMilli(),
            zone,
            20,
            0,
            emptySet()
        )

        assertEquals(1, reminders.size)
        val triggerAt = reminders.single().triggerAtMillis
        assertEquals(now.plusSeconds(60).toInstant().toEpochMilli(), triggerAt)
    }

    @Test
    fun filtersPastExpiredRestAndAlreadyDeliveredDays() {
        val plan = parsedPlan()
        val date = LocalDate.of(2026, 7, 15)
        val beforeReminder = ZonedDateTime.of(2026, 7, 15, 9, 0, 0, 0, zone)

        assertTrue(
            PlanReminderPlanner.plan(
                plan,
                beforeReminder.toInstant().toEpochMilli(),
                zone,
                20,
                0,
                setOf(date.toEpochDay())
            ).isEmpty()
        )

        val afterAllDays = ZonedDateTime.of(2026, 7, 22, 9, 0, 0, 0, zone)
        assertTrue(
            PlanReminderPlanner.plan(
                plan,
                afterAllDays.toInstant().toEpochMilli(),
                zone,
                20,
                0,
                emptySet()
            ).isEmpty()
        )
    }

    @Test
    fun keepsScheduledDateAcrossYearBoundary() {
        val raw = StudyPlanReminderFixtures.syncEnvelope(
            generatedAt = "2026-12-30T08:00:00+08:00",
            expiresAt = "2027-01-05T23:59:59+08:00",
            daysJson = StudyPlanReminderFixtures.singleDayJson("2027-01-01", day = 3)
        )
        val now = ZonedDateTime.of(2026, 12, 31, 23, 30, 0, 0, zone)
        val expected = ZonedDateTime.of(2027, 1, 1, 7, 45, 0, 0, zone)

        val reminders = PlanReminderPlanner.plan(
            parsedPlan(raw),
            now.toInstant().toEpochMilli(),
            zone,
            7,
            45,
            emptySet()
        )

        assertEquals(1, reminders.size)
        assertEquals(LocalDate.of(2027, 1, 1), reminders.single().scheduledDate)
        assertEquals(expected.toInstant().toEpochMilli(), reminders.single().triggerAtMillis)
    }

    @Test
    fun aggregatesSameDayTasksIntoOneBoundedSummary() {
        val day = parsedPlan().days.first()
        val copy = PlanReminderSummary.compose(day)

        assertTrue(copy.title.isNotBlank())
        assertEquals(2, copy.lines.size)
        assertTrue(copy.body.contains("55"))
        assertTrue(copy.lines.any { it.contains("数量关系限时训练") })
        assertTrue(copy.lines.any { it.contains("错题复盘") })
        assertTrue("系统通知正文必须受限", copy.body.length <= 240)
        assertTrue(copy.lines.all { it.length <= 120 })
    }

    private fun parsedPlan(raw: String = StudyPlanReminderFixtures.syncEnvelope()) =
        (requireNotNull(StudyPlanReminderProtocol.parse(raw)) as StudyPlanReminderCommand.Sync).plan
}

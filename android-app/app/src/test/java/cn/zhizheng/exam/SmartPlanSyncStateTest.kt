package cn.zhizheng.exam

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class SmartPlanSyncStateTest {
    private val zone = ZoneId.of("Asia/Shanghai")

    @Test
    fun sameAccountAndPlanPreserveDeliveredDatesAsSnapshot() {
        val stored = linkedSetOf("2026-07-15", "2026-07-16")

        val delivered = SmartPlanSyncState.deliveredDatesForUpdate(
            storedAccountKey = "account-key",
            storedPlanId = "plan-1",
            incomingAccountKey = "account-key",
            incomingPlanId = "plan-1",
            storedDeliveredDates = stored
        )

        assertEquals(stored, delivered)
        assertNotSame("不能继续持有 SharedPreferences 返回的可变集合", stored, delivered)
    }

    @Test
    fun anotherAccountOrPlanStartsWithNoDeliveredDates() {
        val stored = setOf("2026-07-15")

        assertTrue(
            SmartPlanSyncState.deliveredDatesForUpdate(
                "account-key",
                "plan-1",
                "account-key",
                "plan-2",
                stored
            ).isEmpty()
        )
        assertTrue(
            SmartPlanSyncState.deliveredDatesForUpdate(
                "account-key",
                "plan-1",
                "another-account-key",
                "plan-1",
                stored
            ).isEmpty()
        )
    }

    @Test
    fun incompleteStoredIdentityCannotReuseDeliveredDates() {
        val stored = setOf("2026-07-15")

        assertTrue(
            SmartPlanSyncState.deliveredDatesForUpdate(
                storedAccountKey = null,
                storedPlanId = "plan-1",
                incomingAccountKey = "account-key",
                incomingPlanId = "plan-1",
                storedDeliveredDates = stored
            ).isEmpty()
        )
        assertTrue(
            SmartPlanSyncState.deliveredDatesForUpdate(
                storedAccountKey = "account-key",
                storedPlanId = null,
                incomingAccountKey = "account-key",
                incomingPlanId = "plan-1",
                storedDeliveredDates = stored
            ).isEmpty()
        )
    }

    @Test
    fun preservedDeliveryPreventsSameDayCatchUpAfterPlanContentUpdate() {
        val date = LocalDate.of(2026, 7, 15)
        val now = ZonedDateTime.of(2026, 7, 15, 20, 5, 0, 0, zone)
        val updatedPlan = parsedPlan(
            StudyPlanReminderFixtures.syncEnvelope(
                daysJson = StudyPlanReminderFixtures.singleDayJson(
                    date = date.toString(),
                    title = "更新后的剩余任务"
                )
            )
        )
        val preserved = SmartPlanSyncState.deliveredDatesForUpdate(
            storedAccountKey = "account-key",
            storedPlanId = "plan-1",
            incomingAccountKey = "account-key",
            incomingPlanId = "plan-1",
            storedDeliveredDates = setOf(date.toString())
        )

        val samePlanReminders = PlanReminderPlanner.plan(
            updatedPlan,
            now.toInstant().toEpochMilli(),
            zone,
            20,
            0,
            preserved.mapTo(mutableSetOf()) { LocalDate.parse(it).toEpochDay() },
            includeMissedToday = true
        )
        assertTrue("同一计划已送达的当天不能再次补发", samePlanReminders.isEmpty())

        val reset = SmartPlanSyncState.deliveredDatesForUpdate(
            storedAccountKey = "account-key",
            storedPlanId = "plan-1",
            incomingAccountKey = "account-key",
            incomingPlanId = "plan-2",
            storedDeliveredDates = preserved
        )
        val newPlan = parsedPlan(
            StudyPlanReminderFixtures.syncEnvelope(
                planId = "plan-2",
                daysJson = StudyPlanReminderFixtures.singleDayJson(
                    date = date.toString(),
                    title = "新计划首日任务"
                )
            )
        )
        val newPlanReminders = PlanReminderPlanner.plan(
            newPlan,
            now.toInstant().toEpochMilli(),
            zone,
            20,
            0,
            reset.mapTo(mutableSetOf()) { LocalDate.parse(it).toEpochDay() },
            includeMissedToday = true
        )
        assertEquals(1, newPlanReminders.size)
        assertEquals(now.plusSeconds(60).toInstant().toEpochMilli(), newPlanReminders.single().triggerAtMillis)
    }

    private fun parsedPlan(raw: String): SyncedStudyPlan =
        (requireNotNull(StudyPlanReminderProtocol.parse(raw, zone)) as StudyPlanReminderCommand.Sync).plan
}

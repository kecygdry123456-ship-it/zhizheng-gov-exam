package cn.zhizheng.exam

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StudyPlanReminderProtocolTest {
    @Test
    fun parsesVersionOneSyncEnvelope() {
        val command = StudyPlanReminderProtocol.parse(StudyPlanReminderFixtures.syncEnvelope())

        assertTrue(command is StudyPlanReminderCommand.Sync)
        val plan = (command as StudyPlanReminderCommand.Sync).plan
        assertEquals("account-1", plan.accountId)
        assertEquals("plan-1", plan.planId)
        assertEquals(2, plan.days.size)
        assertEquals("2026-07-15", plan.days.first().scheduledDate.toString())
        assertEquals(2, plan.days.first().tasks.size)
        assertEquals("数量关系限时训练", plan.days.first().tasks.first().title)
        assertEquals(35, plan.days.first().tasks.first().minutes)
    }

    @Test
    fun parsesVersionOneClearEnvelope() {
        val command = StudyPlanReminderProtocol.parse(StudyPlanReminderFixtures.clearEnvelope())

        assertEquals(StudyPlanReminderCommand.Clear("account-1"), command)
    }

    @Test
    fun parsesAccountActivationAndSessionResetEnvelopes() {
        assertEquals(
            StudyPlanReminderCommand.ActivateAccount("account-1"),
            StudyPlanReminderProtocol.parse(StudyPlanReminderFixtures.activateEnvelope())
        )
        assertEquals(
            StudyPlanReminderCommand.Reset,
            StudyPlanReminderProtocol.parse(StudyPlanReminderFixtures.resetEnvelope())
        )
    }

    @Test
    fun acceptsSevenDaysAndTwentyOneTasks() {
        val command = StudyPlanReminderProtocol.parse(
            StudyPlanReminderFixtures.syncEnvelope(
                daysJson = StudyPlanReminderFixtures.generatedDaysJson(List(7) { 3 })
            )
        ) as? StudyPlanReminderCommand.Sync

        assertNotNull(command)
        assertEquals(7, command?.plan?.days?.size)
        assertEquals(21, command?.plan?.days?.sumOf { it.tasks.size })
    }

    @Test
    fun rejectsMalformedUnknownOrIncompleteEnvelopesWithoutThrowing() {
        val invalid = listOf(
            "",
            "not-json",
            "{}",
            """{"type":"SYNC_STUDY_PLAN","version":2}""",
            """{"type":"UNKNOWN","version":1}""",
            StudyPlanReminderFixtures.syncEnvelope(accountId = ""),
            StudyPlanReminderFixtures.syncEnvelope(planId = ""),
            StudyPlanReminderFixtures.clearEnvelope(accountId = "")
        )

        invalid.forEach { raw -> assertNull("应静默拒绝：$raw", StudyPlanReminderProtocol.parse(raw)) }
    }

    @Test
    fun rejectsInvalidDatesAndInvalidValidityWindow() {
        assertNull(
            StudyPlanReminderProtocol.parse(
                StudyPlanReminderFixtures.syncEnvelope(
                    daysJson = StudyPlanReminderFixtures.singleDayJson("2026-02-30")
                )
            )
        )
        assertNull(
            StudyPlanReminderProtocol.parse(
                StudyPlanReminderFixtures.syncEnvelope(
                    generatedAt = "2026-07-21T08:00:00+08:00",
                    expiresAt = "2026-07-15T23:59:59+08:00"
                )
            )
        )
        assertNull(
            StudyPlanReminderProtocol.parse(
                StudyPlanReminderFixtures.syncEnvelope(generatedAt = "yesterday")
            )
        )
        assertNull(
            StudyPlanReminderProtocol.parse(
                StudyPlanReminderFixtures.syncEnvelope(
                    daysJson = StudyPlanReminderFixtures.singleDayJson(
                        date = "2026-07-16",
                        day = 1
                    )
                )
            )
        )
    }

    @Test
    fun rejectsMoreThanTwentyOneTasksAcrossValidDays() {
        assertNull(
            StudyPlanReminderProtocol.parse(
                StudyPlanReminderFixtures.syncEnvelope(
                    daysJson = StudyPlanReminderFixtures.generatedDaysJson(
                        listOf(4, 3, 3, 3, 3, 3, 3)
                    )
                )
            )
        )
    }

    @Test
    fun rejectsMoreThanSevenDays() {
        assertNull(
            StudyPlanReminderProtocol.parse(
                StudyPlanReminderFixtures.syncEnvelope(
                    expiresAt = "2026-07-23T23:59:59+08:00",
                    daysJson = StudyPlanReminderFixtures.generatedDaysJson(List(8) { 1 })
                )
            )
        )
    }

    @Test
    fun rejectsUnsafeAndOversizedNotificationFields() {
        val oversized = "计".repeat(10_000)
        val unsafeValues = listOf(
            "<script>alert(1)</script>",
            "训练\u0000伪造通知",
            "训练\u001B[31m红色",
            oversized
        )

        unsafeValues.forEach { title ->
            val raw = StudyPlanReminderFixtures.syncEnvelope(
                daysJson = StudyPlanReminderFixtures.singleDayJson(
                    date = "2026-07-15",
                    title = title
                )
            )
            assertNull("危险或超限字段必须被拒绝", StudyPlanReminderProtocol.parse(raw))
        }
    }

    @Test
    fun rejectsInvalidTaskNumbersAndEnums() {
        val invalidDays = listOf(
            StudyPlanReminderFixtures.singleDayJson("2026-07-15", minutes = 0),
            StudyPlanReminderFixtures.singleDayJson("2026-07-15", minutes = 241),
            StudyPlanReminderFixtures.singleDayJson("2026-07-15", priority = "URGENT"),
            StudyPlanReminderFixtures.singleDayJson("2026-07-15", type = "SCRIPT")
        )

        invalidDays.forEach { days ->
            assertNull(
                StudyPlanReminderProtocol.parse(
                    StudyPlanReminderFixtures.syncEnvelope(daysJson = days)
                )
            )
        }
    }

    @Test
    fun acceptsOnlyTheSupportedTaskTypeWhitelist() {
        val supported = listOf(
            "ASSESSMENT",
            "KNOWLEDGE",
            "PRACTICE",
            "TIMED_PRACTICE",
            "WRONG",
            "EXAM",
            "ESSAY",
            "REVIEW",
            "REST"
        )

        supported.forEach { type ->
            assertNotNull(
                "应接受任务类型 $type",
                StudyPlanReminderProtocol.parse(
                    StudyPlanReminderFixtures.syncEnvelope(
                        daysJson = StudyPlanReminderFixtures.singleDayJson(
                            date = "2026-07-15",
                            type = type,
                            minutes = if (type == "REST") 1 else 30
                        )
                    )
                )
            )
        }
    }
}

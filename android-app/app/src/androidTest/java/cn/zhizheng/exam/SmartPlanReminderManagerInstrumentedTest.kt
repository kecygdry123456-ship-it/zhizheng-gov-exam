package cn.zhizheng.exam

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SmartPlanReminderManagerInstrumentedTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        SmartPlanReminderManager.deactivateCurrent(context)
    }

    @After
    fun tearDown() {
        SmartPlanReminderManager.deactivateCurrent(context)
    }

    @Test
    fun samePlanIdIsIdempotentOnlyWhenContentIsUnchanged() {
        val firstMessage = syncEnvelope(title = "数量关系限时训练")
        val first = requireNotNull(
            SmartPlanReminderManager.handleWebMessage(context, ORIGIN, firstMessage)
        )
        assertFalse(first.unchanged)

        val duplicate = requireNotNull(
            SmartPlanReminderManager.handleWebMessage(context, ORIGIN, firstMessage)
        )
        assertTrue(duplicate.unchanged)

        val changed = requireNotNull(
            SmartPlanReminderManager.handleWebMessage(
                context,
                ORIGIN,
                syncEnvelope(title = "数量关系强化与订正")
            )
        )
        assertFalse("同 planId 但内容变化时必须取消旧闹钟并重新安排", changed.unchanged)
    }

    @Test
    fun samePlanUpdateKeepsDeliveredDateButNewPlanClearsIt() {
        val today = LocalDate.now(ZoneId.systemDefault())
        val historicalDate = today.minusDays(1)
        SmartPlanReminderManager.handleWebMessage(
            context,
            ORIGIN,
            syncEnvelope(title = "首次发送的两项任务")
        )
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(
                KEY_DELIVERED_DATES,
                setOf(historicalDate.toString(), today.toString())
            )
            .commit()

        SmartPlanReminderManager.handleWebMessage(
            context,
            ORIGIN,
            syncEnvelope(title = "完成一项后的剩余任务")
        )
        assertTrue(
            "同一计划内容更新必须完整保留历史送达快照",
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getStringSet(KEY_DELIVERED_DATES, emptySet())
                .orEmpty()
                .containsAll(setOf(historicalDate.toString(), today.toString()))
        )
        assertFalse(
            "同一计划更新不得把已送达的当天重新加入待提醒日期",
            requireNotNull(SmartPlanReminderManager.status(context)).pendingDates.contains(today)
        )

        SmartPlanReminderManager.handleWebMessage(
            context,
            ORIGIN,
            syncEnvelope(title = "新计划首日任务", planId = "replacement-plan-id")
        )
        assertTrue(
            "新 planId 必须清空旧送达记录并正常安排当天提醒",
            requireNotNull(SmartPlanReminderManager.status(context)).pendingDates.contains(today)
        )
        assertTrue(
            "新计划不得继承上一计划的送达记录",
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getStringSet(KEY_DELIVERED_DATES, emptySet())
                .orEmpty()
                .isEmpty()
        )
    }

    @Test
    fun accountScopedClearCannotDeleteAnotherAccountButActivationCanSwitch() {
        val firstMessage = syncEnvelope(title = "旧账号学习任务")
        SmartPlanReminderManager.handleWebMessage(context, ORIGIN, firstMessage)

        val wrongAccountClear = requireNotNull(
            SmartPlanReminderManager.handleWebMessage(
                context,
                ORIGIN,
                """{"type":"CLEAR_STUDY_PLAN","version":1,"accountId":"new-account-without-plan"}"""
            )
        )
        assertTrue(wrongAccountClear.unchanged)

        val stillStored = requireNotNull(
            SmartPlanReminderManager.handleWebMessage(context, ORIGIN, firstMessage)
        )
        assertTrue("其他账号的定向 CLEAR 不能删除当前计划", stillStored.unchanged)

        val activation = requireNotNull(
            SmartPlanReminderManager.handleWebMessage(
                context,
                ORIGIN,
                """{"type":"ACTIVATE_STUDY_PLAN_ACCOUNT","version":1,"accountId":"new-account-without-plan"}"""
            )
        )
        assertFalse(activation.unchanged)

        val syncedAgain = requireNotNull(
            SmartPlanReminderManager.handleWebMessage(context, ORIGIN, firstMessage)
        )
        assertFalse("账号切换应清理旧计划，重新同步不能被视为重复", syncedAgain.unchanged)
    }

    private fun syncEnvelope(title: String, planId: String = "stable-plan-id"): String {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val generatedAt = today.atStartOfDay(zone)
        val expiresAt = ZonedDateTime.of(today.plusDays(7), java.time.LocalTime.MAX, zone)
        return """
            {
              "type":"SYNC_STUDY_PLAN",
              "version":1,
              "accountId":"instrumented-account",
              "planId":"$planId",
              "generatedAt":"${generatedAt.toInstant()}",
              "expiresAt":"${expiresAt.toInstant()}",
              "days":[{
                "day":1,
                "scheduledDate":"$today",
                "tasks":[{
                  "id":"$planId:1:1",
                  "title":"$title",
                  "type":"PRACTICE",
                  "target":"完成训练",
                  "minutes":30,
                  "priority":"HIGH",
                  "checkpoint":"完成订正",
                  "module":"数量关系"
                }]
              }]
            }
        """.trimIndent()
    }

    companion object {
        private const val ORIGIN = "https://exam.example.com"
        private const val PREFS = "smart_plan_reminders"
        private const val KEY_DELIVERED_DATES = "delivered_dates"
    }
}

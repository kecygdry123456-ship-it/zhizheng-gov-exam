package cn.zhizheng.exam

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

class ReminderTimeCalculatorTest {
    private val zone = ZoneId.of("Asia/Shanghai")

    @Test fun usesTodayWhenReminderIsStillAhead() {
        val now = ZonedDateTime.of(2026, 7, 12, 9, 30, 0, 0, zone)
        val expected = ZonedDateTime.of(2026, 7, 12, 20, 0, 0, 0, zone)
        assertEquals(expected.toInstant().toEpochMilli(), ReminderTimeCalculator.nextEpochMillis(now.toInstant().toEpochMilli(), zone, 20, 0))
    }

    @Test fun movesToTomorrowWhenTimeHasPassed() {
        val now = ZonedDateTime.of(2026, 7, 12, 20, 0, 0, 0, zone)
        val expected = ZonedDateTime.of(2026, 7, 13, 20, 0, 0, 0, zone)
        assertEquals(expected.toInstant().toEpochMilli(), ReminderTimeCalculator.nextEpochMillis(now.toInstant().toEpochMilli(), zone, 20, 0))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsInvalidHour() {
        ReminderTimeCalculator.nextEpochMillis(0, zone, 24, 0)
    }
}

package cn.zhizheng.exam

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

object ReminderTimeCalculator {
    fun nextEpochMillis(
        nowMillis: Long,
        zoneId: ZoneId,
        hour: Int,
        minute: Int
    ): Long {
        require(hour in 0..23)
        require(minute in 0..59)
        val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)
        var next = now.toLocalDate().atTime(LocalTime.of(hour, minute)).atZone(zoneId)
        if (!next.isAfter(now)) next = next.plusDays(1)
        return next.toInstant().toEpochMilli()
    }
}

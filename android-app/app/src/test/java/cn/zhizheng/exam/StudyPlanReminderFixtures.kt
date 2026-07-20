package cn.zhizheng.exam

import java.time.LocalDate

internal object StudyPlanReminderFixtures {
    fun syncEnvelope(
        accountId: String = "account-1",
        planId: String = "plan-1",
        generatedAt: String = "2026-07-15T08:00:00+08:00",
        expiresAt: String = "2026-07-21T23:59:59+08:00",
        daysJson: String = validDaysJson()
    ): String =
        """
        {
          "type": "SYNC_STUDY_PLAN",
          "version": 1,
          "accountId": ${quoted(accountId)},
          "planId": ${quoted(planId)},
          "generatedAt": ${quoted(generatedAt)},
          "expiresAt": ${quoted(expiresAt)},
          "days": $daysJson
        }
        """.trimIndent()

    fun clearEnvelope(accountId: String = "account-1"): String =
        """
        {
          "type": "CLEAR_STUDY_PLAN",
          "version": 1,
          "accountId": ${quoted(accountId)}
        }
        """.trimIndent()

    fun activateEnvelope(accountId: String = "account-1"): String =
        """{"type":"ACTIVATE_STUDY_PLAN_ACCOUNT","version":1,"accountId":${quoted(accountId)}}"""

    fun resetEnvelope(): String =
        """{"type":"RESET_STUDY_PLAN_REMINDERS","version":1}"""

    fun validDaysJson(): String =
        """
        [
          {
            "day": 1,
            "scheduledDate": "2026-07-15",
            "tasks": [
              {
                "id": "plan-1:1:1",
                "title": "数量关系限时训练",
                "type": "TIMED_PRACTICE",
                "target": "完成 15 题并订正",
                "minutes": 35,
                "priority": "HIGH",
                "checkpoint": "正确率达到 70%",
                "module": "数量关系"
              },
              {
                "id": "plan-1:1:2",
                "title": "错题复盘",
                "type": "WRONG",
                "target": "复盘本周错题",
                "minutes": 20,
                "priority": "MEDIUM",
                "checkpoint": "说明每道错题原因",
                "module": "判断推理"
              }
            ]
          },
          {
            "day": 2,
            "scheduledDate": "2026-07-16",
            "tasks": [
              {
                "id": "plan-1:2:1",
                "title": "主动恢复",
                "type": "REST",
                "target": "休息",
                "minutes": 10,
                "priority": "LOW",
                "checkpoint": "保持睡眠",
                "module": null
              }
            ]
          }
        ]
        """.trimIndent()

    fun singleDayJson(
        date: String,
        type: String = "PRACTICE",
        title: String = "言语理解专项",
        target: String = "完成训练",
        minutes: Int = 30,
        priority: String = "HIGH",
        checkpoint: String = "完成订正",
        module: String? = "言语理解",
        day: Int = 1
    ): String =
        """
        [
          {
            "day": $day,
            "scheduledDate": ${quoted(date)},
            "tasks": [
              {
                "id": "plan-1:$day:1",
                "title": ${quoted(title)},
                "type": ${quoted(type)},
                "target": ${quoted(target)},
                "minutes": $minutes,
                "priority": ${quoted(priority)},
                "checkpoint": ${quoted(checkpoint)},
                "module": ${module?.let(::quoted) ?: "null"}
              }
            ]
          }
        ]
        """.trimIndent()

    fun generatedDaysJson(taskCounts: List<Int>): String {
        val baseDate = LocalDate.of(2026, 7, 15)
        return taskCounts.mapIndexed { dayIndex, count ->
            val day = dayIndex + 1
            val tasks = List(count) { taskIndex ->
                """
                {
                  "id":"plan-1:$day:${taskIndex + 1}",
                  "title":"第 $day 天任务 ${taskIndex + 1}",
                  "type":"PRACTICE",
                  "target":"完成训练",
                  "minutes":20,
                  "priority":"MEDIUM",
                  "checkpoint":"完成订正",
                  "module":"判断推理"
                }
                """.trimIndent()
            }.joinToString(",")
            """
            {
              "day":$day,
              "scheduledDate":"${baseDate.plusDays(dayIndex.toLong())}",
              "tasks":[$tasks]
            }
            """.trimIndent()
        }.joinToString(prefix = "[", postfix = "]", separator = ",")
    }

    private fun quoted(value: String): String = buildString {
        append('"')
        value.forEach { character ->
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                in '\u0000'..'\u001f' -> {
                    append("\\u")
                    append(character.code.toString(16).padStart(4, '0'))
                }
                else -> append(character)
            }
        }
        append('"')
    }
}

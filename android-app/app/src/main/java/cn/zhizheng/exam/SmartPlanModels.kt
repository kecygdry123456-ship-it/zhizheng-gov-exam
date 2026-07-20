package cn.zhizheng.exam

import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class SmartPlanTask(
    val id: String,
    val title: String,
    val type: String,
    val target: String,
    val minutes: Int,
    val priority: String,
    val module: String?,
    val checkpoint: String?
)

data class SmartPlanDay(
    val day: Int,
    val scheduledDate: LocalDate,
    val tasks: List<SmartPlanTask>
)

data class SyncedStudyPlan(
    val accountId: String,
    val planId: String,
    val generatedAt: Instant,
    val expiresAt: Instant,
    val days: List<SmartPlanDay>
)

sealed interface StudyPlanReminderCommand {
    data class Sync(val plan: SyncedStudyPlan) : StudyPlanReminderCommand
    data class Clear(val accountId: String) : StudyPlanReminderCommand
    data class ActivateAccount(val accountId: String) : StudyPlanReminderCommand
    data object Reset : StudyPlanReminderCommand
}

object StudyPlanReminderProtocol {
    fun parse(raw: String): StudyPlanReminderCommand? =
        parse(raw, ZoneId.systemDefault())

    fun parse(raw: String, zoneId: ZoneId): StudyPlanReminderCommand? =
        runCatching { StrictStudyPlanParser.parse(raw, zoneId) }.getOrNull()
}

private object StrictStudyPlanParser {
    const val MAX_MESSAGE_LENGTH = 24_000
    const val MAX_DAYS = 7
    const val MAX_TASKS = 21
    const val MAX_TASKS_PER_DAY = 6

    fun parse(message: String, zoneId: ZoneId): StudyPlanReminderCommand {
        require(message.length in 2..MAX_MESSAGE_LENGTH) { "消息长度不正确" }
        val root = StrictJsonParser(message).parse().asObject("消息")
        require(root.int("version") == 1) { "不支持的消息版本" }
        return when (root.string("type")) {
            "SYNC_STUDY_PLAN" -> parseSync(root, zoneId)
            "CLEAR_STUDY_PLAN" -> StudyPlanReminderCommand.Clear(root.safeId("accountId"))
            "ACTIVATE_STUDY_PLAN_ACCOUNT" ->
                StudyPlanReminderCommand.ActivateAccount(root.safeId("accountId"))
            "RESET_STUDY_PLAN_REMINDERS" -> StudyPlanReminderCommand.Reset
            else -> throw IllegalArgumentException("不支持的消息类型")
        }
    }

    private fun parseSync(root: JsonObject, zoneId: ZoneId): StudyPlanReminderCommand.Sync {
        val accountId = root.safeId("accountId")
        val planId = root.safeId("planId")
        val generatedAt = root.instant("generatedAt")
        val expiresAt = root.instant("expiresAt")
        require(expiresAt.isAfter(generatedAt)) { "计划有效期不正确" }
        val firstDate = generatedAt.atZone(zoneId).toLocalDate()
        val lastDate = expiresAt.atZone(zoneId).toLocalDate()
        val rawDays = root.array("days")
        require(rawDays.size <= MAX_DAYS) { "计划日期过多" }
        var taskCount = 0
        val seenDates = mutableSetOf<LocalDate>()
        val seenDays = mutableSetOf<Int>()
        val days = rawDays.map { rawDay ->
            val day = rawDay.asObject("计划日期")
            val dayNumber = day.int("day")
            require(dayNumber in 1..MAX_DAYS) { "计划日序号不正确" }
            require(seenDays.add(dayNumber)) { "计划日序号重复" }
            val scheduledDate = day.localDate("scheduledDate")
            require(scheduledDate in firstDate..lastDate) { "计划日期超出有效期" }
            require(scheduledDate == firstDate.plusDays((dayNumber - 1).toLong())) {
                "计划日期与日序号不一致"
            }
            require(seenDates.add(scheduledDate)) { "计划日期重复" }
            val rawTasks = day.array("tasks")
            require(rawTasks.size <= MAX_TASKS_PER_DAY) { "单日任务过多" }
            taskCount += rawTasks.size
            require(taskCount <= MAX_TASKS) { "计划任务过多" }
            SmartPlanDay(
                day = dayNumber,
                scheduledDate = scheduledDate,
                tasks = rawTasks.map { parseTask(it.asObject("计划任务")) }
            )
        }.sortedBy { it.scheduledDate }
        return StudyPlanReminderCommand.Sync(
            SyncedStudyPlan(accountId, planId, generatedAt, expiresAt, days)
        )
    }

    private fun parseTask(task: JsonObject) = SmartPlanTask(
        id = task.safeId("id"),
        title = task.safeText("title", 80, required = true)!!,
        type = task.safeText("type", 32, required = true)!!.also {
            require(it in TASK_TYPES) { "任务类型不正确" }
        },
        target = task.safeText("target", 200, required = false).orEmpty(),
        minutes = task.int("minutes").also { require(it in 1..240) { "任务时长不正确" } },
        priority = task.safeText("priority", 12, required = true)!!.also {
            require(it in setOf("HIGH", "MEDIUM", "LOW")) { "任务优先级不正确" }
        },
        module = task.safeText("module", 48, required = false),
        checkpoint = task.safeText("checkpoint", 160, required = false)
    )

    private fun Any?.asObject(field: String): JsonObject =
        this as? JsonObject ?: throw IllegalArgumentException("$field 格式不正确")

    private fun JsonObject.string(key: String): String =
        values[key] as? String ?: throw IllegalArgumentException("$key 格式不正确")

    private fun JsonObject.int(key: String): Int {
        val value = values[key] as? JsonNumber
            ?: throw IllegalArgumentException("$key 格式不正确")
        require(value.raw.matches(Regex("-?(0|[1-9]\\d*)"))) { "$key 必须为整数" }
        return value.raw.toIntOrNull() ?: throw IllegalArgumentException("$key 超出范围")
    }

    private fun JsonObject.array(key: String): JsonArray =
        values[key] as? JsonArray ?: throw IllegalArgumentException("$key 格式不正确")

    private fun JsonObject.instant(key: String): Instant = try {
        Instant.parse(string(key))
    } catch (_: Exception) {
        throw IllegalArgumentException("$key 格式不正确")
    }

    private fun JsonObject.localDate(key: String): LocalDate = try {
        LocalDate.parse(string(key))
    } catch (_: Exception) {
        throw IllegalArgumentException("$key 格式不正确")
    }

    private fun JsonObject.safeId(key: String): String {
        val value = safeText(key, 128, required = true)!!
        require(value.matches(Regex("[A-Za-z0-9._:@-]{1,128}"))) { "$key 包含不允许的字符" }
        return value
    }

    private fun JsonObject.safeText(key: String, maxLength: Int, required: Boolean): String? {
        val raw = values[key]
        if (raw == null) {
            require(!required) { "$key 不能为空" }
            return null
        }
        require(raw is String) { "$key 格式不正确" }
        val cleaned = cleanVisibleText(raw)
        require(cleaned.length <= maxLength) { "$key 内容过长" }
        require(!required || cleaned.isNotBlank()) { "$key 不能为空" }
        return cleaned.ifBlank { null }
    }

    private fun cleanVisibleText(value: String): String {
        val normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
        require(normalized.none(::isUnsafeCharacter)) { "文本包含不允许的字符" }
        val builder = StringBuilder(normalized.length)
        var previousSpace = false
        for (character in normalized) {
            val output = if (character.isWhitespace()) ' ' else character
            if (output == ' ') {
                if (!previousSpace) builder.append(output)
                previousSpace = true
            } else {
                builder.append(output)
                previousSpace = false
            }
        }
        return builder.toString().trim()
    }

    private fun isUnsafeCharacter(character: Char): Boolean =
        character.code in 0x0000..0x001f ||
            character.code in 0x007f..0x009f ||
            character.code in 0x200b..0x200f ||
            character.code in 0x202a..0x202e ||
            character.code in 0x2060..0x206f ||
            character == '<' || character == '>'

    private val TASK_TYPES = setOf(
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
}

private data class JsonObject(val values: Map<String, Any?>)
private class JsonArray(values: List<Any?>) : ArrayList<Any?>(values)
private data class JsonNumber(val raw: String)

/** Small strict JSON reader so payload validation stays testable without Android runtime classes. */
private class StrictJsonParser(private val input: String) {
    private var index = 0

    fun parse(): Any? {
        val value = value(0)
        whitespace()
        require(index == input.length) { "消息包含多余内容" }
        return value
    }

    private fun value(depth: Int): Any? {
        require(depth <= 12) { "消息嵌套过深" }
        whitespace()
        require(index < input.length) { "消息不完整" }
        return when (input[index]) {
            '{' -> objectValue(depth + 1)
            '[' -> arrayValue(depth + 1)
            '"' -> stringValue()
            't' -> literal("true", true)
            'f' -> literal("false", false)
            'n' -> literal("null", null)
            '-', in '0'..'9' -> numberValue()
            else -> throw IllegalArgumentException("消息不是有效 JSON")
        }
    }

    private fun objectValue(depth: Int): JsonObject {
        expect('{')
        whitespace()
        val result = linkedMapOf<String, Any?>()
        if (consume('}')) return JsonObject(result)
        while (true) {
            whitespace()
            require(index < input.length && input[index] == '"') { "对象键格式不正确" }
            val key = stringValue()
            require(!result.containsKey(key)) { "对象键重复" }
            whitespace()
            expect(':')
            result[key] = value(depth)
            whitespace()
            if (consume('}')) return JsonObject(result)
            expect(',')
        }
    }

    private fun arrayValue(depth: Int): JsonArray {
        expect('[')
        whitespace()
        val result = mutableListOf<Any?>()
        if (consume(']')) return JsonArray(result)
        while (true) {
            result += value(depth)
            whitespace()
            if (consume(']')) return JsonArray(result)
            expect(',')
        }
    }

    private fun stringValue(): String {
        expect('"')
        val result = StringBuilder()
        while (index < input.length) {
            val character = input[index++]
            when {
                character == '"' -> return result.toString()
                character == '\\' -> {
                    require(index < input.length) { "字符串转义不完整" }
                    when (val escaped = input[index++]) {
                        '"', '\\', '/' -> result.append(escaped)
                        'b' -> result.append('\b')
                        'f' -> result.append('\u000c')
                        'n' -> result.append('\n')
                        'r' -> result.append('\r')
                        't' -> result.append('\t')
                        'u' -> result.append(unicodeEscape())
                        else -> throw IllegalArgumentException("字符串转义不正确")
                    }
                }
                character.code < 0x20 -> throw IllegalArgumentException("字符串包含控制字符")
                else -> result.append(character)
            }
        }
        throw IllegalArgumentException("字符串未闭合")
    }

    private fun unicodeEscape(): Char {
        require(index + 4 <= input.length) { "Unicode 转义不完整" }
        val hex = input.substring(index, index + 4)
        index += 4
        return hex.toIntOrNull(16)?.toChar()
            ?: throw IllegalArgumentException("Unicode 转义不正确")
    }

    private fun numberValue(): JsonNumber {
        val start = index
        if (input[index] == '-') index++
        require(index < input.length) { "数字不完整" }
        if (input[index] == '0') {
            index++
        } else {
            require(input[index] in '1'..'9') { "数字格式不正确" }
            while (index < input.length && input[index].isDigit()) index++
        }
        if (index < input.length && input[index] == '.') {
            index++
            require(index < input.length && input[index].isDigit()) { "数字格式不正确" }
            while (index < input.length && input[index].isDigit()) index++
        }
        if (index < input.length && input[index].lowercaseChar() == 'e') {
            index++
            if (index < input.length && input[index] in setOf('+', '-')) index++
            require(index < input.length && input[index].isDigit()) { "数字格式不正确" }
            while (index < input.length && input[index].isDigit()) index++
        }
        return JsonNumber(input.substring(start, index))
    }

    private fun literal(text: String, value: Any?): Any? {
        require(input.regionMatches(index, text, 0, text.length)) { "JSON 字面量不正确" }
        index += text.length
        return value
    }

    private fun whitespace() {
        while (index < input.length && input[index] in setOf(' ', '\t', '\n', '\r')) index++
    }

    private fun expect(character: Char) {
        require(index < input.length && input[index] == character) { "JSON 格式不正确" }
        index++
    }

    private fun consume(character: Char): Boolean {
        if (index >= input.length || input[index] != character) return false
        index++
        return true
    }
}

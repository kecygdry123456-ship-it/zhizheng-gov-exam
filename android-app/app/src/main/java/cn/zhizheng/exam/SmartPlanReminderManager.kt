package cn.zhizheng.exam

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object SmartPlanReminderManager {
    const val ACTION_REMIND = "cn.zhizheng.exam.action.SMART_PLAN_REMINDER"
    const val ACTION_OPEN_PLAN = "cn.zhizheng.exam.action.OPEN_STUDY_PLAN"

    private const val PREFS = "smart_plan_reminders"
    private const val KEY_RAW_MESSAGE = "raw_message"
    private const val KEY_SOURCE_ORIGIN = "source_origin"
    private const val KEY_ACCOUNT_KEY = "account_key"
    private const val KEY_ACCOUNT_ID = "account_id"
    private const val KEY_PLAN_ID = "plan_id"
    private const val KEY_FINGERPRINT = "fingerprint"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_SYNC_ZONE = "sync_zone"
    private const val KEY_SCHEDULED_DATES = "scheduled_dates"
    private const val KEY_DELIVERED_DATES = "delivered_dates"

    data class Result(
        val action: String,
        val scheduledDays: Int = 0,
        val unchanged: Boolean = false
    )

    data class Status(
        val enabled: Boolean,
        val pendingDates: List<LocalDate>,
        val expiresAt: Instant
    )

    @Synchronized
    fun handleWebMessage(context: Context, sourceOrigin: String, raw: String): Result? {
        return when (val command = StudyPlanReminderProtocol.parse(raw)) {
            is StudyPlanReminderCommand.Sync -> sync(context, sourceOrigin, raw, command.plan)
            is StudyPlanReminderCommand.Clear -> clear(context, sourceOrigin, command.accountId)
            is StudyPlanReminderCommand.ActivateAccount ->
                activateAccount(context, sourceOrigin, command.accountId)
            StudyPlanReminderCommand.Reset -> reset(context, sourceOrigin)
            null -> null
        }
    }

    @Synchronized
    fun reschedule(context: Context, includeMissedToday: Boolean = false): Int {
        val stored = storedPlan(context) ?: return 0
        cancelStoredAlarms(context)
        if (!isEnabled(context)) return 0
        return schedulePending(context, stored, includeMissedToday)
    }

    @Synchronized
    fun setEnabled(context: Context, enabled: Boolean): Int {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!preferences.contains(KEY_RAW_MESSAGE)) return 0
        cancelStoredAlarms(context)
        preferences.edit().putBoolean(KEY_ENABLED, enabled).commit()
        val stored = storedPlan(context) ?: return 0
        return if (enabled) {
            schedulePending(context, stored, includeMissedToday = true)
        } else {
            0
        }
    }

    fun status(context: Context, now: Instant = Instant.now()): Status? {
        val stored = storedPlan(context) ?: return null
        if (!stored.plan.expiresAt.isAfter(now)) return null
        val today = now.atZone(ZoneId.systemDefault()).toLocalDate()
        val delivered = deliveredDates(context)
        val dates = stored.plan.days.asSequence()
            .filter { !it.scheduledDate.isBefore(today) }
            .filter { it.scheduledDate !in delivered }
            .filter { day -> day.tasks.any { it.type != "REST" } }
            .map { it.scheduledDate }
            .toList()
        return Status(isEnabled(context), dates, stored.plan.expiresAt)
    }

    @Synchronized
    fun deactivateCurrent(context: Context) {
        cancelStoredAlarms(context)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
    }

    fun hasActivePlan(context: Context, now: Instant = Instant.now()): Boolean {
        if (!isEnabled(context)) return false
        val plan = storedPlan(context)?.plan ?: return false
        val today = now.atZone(ZoneId.systemDefault()).toLocalDate()
        return plan.expiresAt.isAfter(now) && plan.days.any { day ->
            !day.scheduledDate.isBefore(today) && day.tasks.any { it.type != "REST" }
        }
    }

    fun hasPlanForToday(context: Context, now: Instant = Instant.now()): Boolean {
        if (!isEnabled(context)) return false
        val plan = storedPlan(context)?.plan ?: return false
        if (!plan.expiresAt.isAfter(now)) return false
        val today = now.atZone(ZoneId.systemDefault()).toLocalDate()
        return plan.days.any { it.scheduledDate == today && it.tasks.isNotEmpty() }
    }

    @Synchronized
    fun handleAlarm(context: Context, intent: Intent) {
        if (intent.action != ACTION_REMIND) return
        if (!isEnabled(context)) return
        val stored = storedPlan(context) ?: return
        val accountKey = intent.getStringExtra(EXTRA_ACCOUNT_KEY) ?: return
        val planId = intent.getStringExtra(EXTRA_PLAN_ID) ?: return
        val date = intent.getStringExtra(EXTRA_DATE)?.let { value ->
            runCatching { LocalDate.parse(value) }.getOrNull()
        }
            ?: return
        if (accountKey != stored.accountKey || planId != stored.plan.planId) return
        val delivered = deliveredDates(context)
        if (date in delivered) return
        val day = stored.plan.days.firstOrNull { it.scheduledDate == date && it.tasks.isNotEmpty() }
            ?: return
        if (day.tasks.none { it.type != "REST" }) {
            markDelivered(context, date)
            return
        }
        if (!stored.plan.expiresAt.isAfter(Instant.now())) return
        if (date != LocalDate.now(ZoneId.systemDefault())) {
            markDelivered(context, date)
            return
        }
        if (showNotification(context, stored, day)) markDelivered(context, date)
    }

    private fun sync(
        context: Context,
        sourceOrigin: String,
        raw: String,
        plan: SyncedStudyPlan
    ): Result {
        val origin = canonicalOrigin(sourceOrigin)
            ?: throw IllegalArgumentException("消息来源不正确")
        val accountKey = accountKey(origin, plan.accountId)
        val fingerprint = fingerprint(raw)
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val storedAccountKey = preferences.getString(KEY_ACCOUNT_KEY, null)
        val storedPlanId = preferences.getString(KEY_PLAN_ID, null)
        if (storedAccountKey == accountKey &&
            storedPlanId == plan.planId &&
            preferences.getString(KEY_FINGERPRINT, null) == fingerprint
        ) {
            return Result("SYNC_STUDY_PLAN", pendingCount(context, plan), unchanged = true)
        }

        val reminderEnabled = if (storedAccountKey == accountKey) {
            preferences.getBoolean(KEY_ENABLED, true)
        } else {
            true
        }
        val deliveredDates = SmartPlanSyncState.deliveredDatesForUpdate(
            storedAccountKey = storedAccountKey,
            storedPlanId = storedPlanId,
            incomingAccountKey = accountKey,
            incomingPlanId = plan.planId,
            storedDeliveredDates = preferences
                .getStringSet(KEY_DELIVERED_DATES, emptySet())
                .orEmpty()
        )
        cancelStoredAlarms(context)
        val dates = plan.days.mapTo(linkedSetOf()) { it.scheduledDate.toString() }
        preferences.edit()
            .clear()
            .putString(KEY_RAW_MESSAGE, raw)
            .putString(KEY_SOURCE_ORIGIN, origin)
            .putString(KEY_ACCOUNT_KEY, accountKey)
            .putString(KEY_ACCOUNT_ID, plan.accountId)
            .putString(KEY_PLAN_ID, plan.planId)
            .putString(KEY_FINGERPRINT, fingerprint)
            .putBoolean(KEY_ENABLED, reminderEnabled)
            .putString(KEY_SYNC_ZONE, ZoneId.systemDefault().id)
            .putStringSet(KEY_SCHEDULED_DATES, dates)
            .putStringSet(KEY_DELIVERED_DATES, deliveredDates)
            .commit()
        val scheduled = if (reminderEnabled) {
            schedulePending(
                context,
                StoredPlan(plan, accountKey),
                includeMissedToday = true
            )
        } else {
            0
        }
        return Result("SYNC_STUDY_PLAN", scheduled)
    }

    private fun clear(context: Context, sourceOrigin: String, accountId: String): Result {
        val origin = canonicalOrigin(sourceOrigin) ?: return Result("CLEAR_STUDY_PLAN")
        val expectedKey = accountKey(origin, accountId)
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (preferences.getString(KEY_ACCOUNT_KEY, null) != expectedKey) {
            return Result("CLEAR_STUDY_PLAN", unchanged = true)
        }
        deactivateCurrent(context)
        StudyReminderManager.scheduleNext(context)
        return Result("CLEAR_STUDY_PLAN")
    }

    private fun activateAccount(
        context: Context,
        sourceOrigin: String,
        accountId: String
    ): Result {
        val origin = canonicalOrigin(sourceOrigin)
            ?: return Result("ACTIVATE_STUDY_PLAN_ACCOUNT", unchanged = true)
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val storedOrigin = preferences.getString(KEY_SOURCE_ORIGIN, null)
            ?: return Result("ACTIVATE_STUDY_PLAN_ACCOUNT", unchanged = true)
        if (storedOrigin != origin) {
            return Result("ACTIVATE_STUDY_PLAN_ACCOUNT", unchanged = true)
        }
        if (preferences.getString(KEY_ACCOUNT_KEY, null) == accountKey(origin, accountId)) {
            return Result("ACTIVATE_STUDY_PLAN_ACCOUNT", unchanged = true)
        }
        deactivateCurrent(context)
        StudyReminderManager.scheduleNext(context)
        return Result("ACTIVATE_STUDY_PLAN_ACCOUNT")
    }

    private fun reset(context: Context, sourceOrigin: String): Result {
        val origin = canonicalOrigin(sourceOrigin)
            ?: return Result("RESET_STUDY_PLAN_REMINDERS", unchanged = true)
        val storedOrigin = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SOURCE_ORIGIN, null)
            ?: return Result("RESET_STUDY_PLAN_REMINDERS", unchanged = true)
        if (storedOrigin != origin) {
            return Result("RESET_STUDY_PLAN_REMINDERS", unchanged = true)
        }
        deactivateCurrent(context)
        StudyReminderManager.scheduleNext(context)
        return Result("RESET_STUDY_PLAN_REMINDERS")
    }

    private fun pendingCount(context: Context, plan: SyncedStudyPlan): Int {
        if (!isEnabled(context)) return 0
        val settings = StudyReminderManager.settings(context)
        return PlanReminderPlanner.plan(
            plan,
            System.currentTimeMillis(),
            ZoneId.systemDefault(),
            settings.hour,
            settings.minute,
            deliveredDates(context).mapTo(mutableSetOf()) { it.toEpochDay() },
            includeMissedToday = false
        ).size
    }

    private fun schedulePending(
        context: Context,
        stored: StoredPlan,
        includeMissedToday: Boolean
    ): Int {
        val settings = StudyReminderManager.settings(context)
        val zone = ZoneId.systemDefault()
        val nowMillis = System.currentTimeMillis()
        val pending = PlanReminderPlanner.plan(
            stored.plan,
            nowMillis,
            zone,
            settings.hour,
            settings.minute,
            deliveredDates(context).mapTo(mutableSetOf()) { it.toEpochDay() },
            includeMissedToday
        )
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        for (reminder in pending) {
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                reminder.triggerAtMillis,
                alarmIntent(
                    context,
                    stored.accountKey,
                    stored.plan.planId,
                    reminder.scheduledDate
                )
            )
        }
        return pending.size
    }

    private fun storedPlan(context: Context): StoredPlan? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = preferences.getString(KEY_RAW_MESSAGE, null) ?: return null
        val zone = preferences.getString(KEY_SYNC_ZONE, null)
            ?.let { value -> runCatching { ZoneId.of(value) }.getOrNull() }
            ?: ZoneId.systemDefault()
        val command = StudyPlanReminderProtocol.parse(raw, zone) as? StudyPlanReminderCommand.Sync
            ?: return null
        val accountKey = preferences.getString(KEY_ACCOUNT_KEY, null) ?: return null
        val origin = preferences.getString(KEY_SOURCE_ORIGIN, null) ?: return null
        if (accountKey != accountKey(origin, command.plan.accountId)) return null
        if (preferences.getString(KEY_PLAN_ID, null) != command.plan.planId) return null
        if (preferences.getString(KEY_FINGERPRINT, null) != fingerprint(raw)) return null
        return StoredPlan(command.plan, accountKey)
    }

    private fun cancelStoredAlarms(context: Context) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val accountKey = preferences.getString(KEY_ACCOUNT_KEY, null) ?: return
        val planId = preferences.getString(KEY_PLAN_ID, null) ?: return
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        for (rawDate in preferences.getStringSet(KEY_SCHEDULED_DATES, emptySet()).orEmpty()) {
            val date = runCatching { LocalDate.parse(rawDate) }.getOrNull() ?: continue
            alarmManager.cancel(alarmIntent(context, accountKey, planId, date))
            NotificationManagerCompat.from(context).cancel(notificationId(accountKey, planId, date))
        }
    }

    private fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)

    @SuppressLint("MissingPermission")
    private fun showNotification(
        context: Context,
        stored: StoredPlan,
        day: SmartPlanDay
    ): Boolean {
        if (!StudyReminderManager.hasNotificationPermission(context)) return false
        StudyReminderManager.createChannel(context)
        val openApp = PendingIntent.getActivity(
            context,
            openRequestCode(stored.accountKey, stored.plan.planId, day.scheduledDate),
            Intent(context, MainActivity::class.java)
                .setAction(ACTION_OPEN_PLAN)
                .setData(notificationUri(stored.accountKey, stored.plan.planId, day.scheduledDate))
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val copy = PlanReminderSummary.compose(day)
        val style = NotificationCompat.InboxStyle().setBigContentTitle(copy.title)
        copy.lines.forEach(style::addLine)
        val notification = NotificationCompat.Builder(context, StudyReminderManager.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("知政公考 · 今日任务")
            .setContentText(copy.body)
            .setStyle(style.setSummaryText("点击查看完整计划"))
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()
        return try {
            NotificationManagerCompat.from(context).notify(
                notificationId(stored.accountKey, stored.plan.planId, day.scheduledDate),
                notification
            )
            true
        } catch (_: SecurityException) {
            false
        }
    }

    private fun markDelivered(context: Context, date: LocalDate) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val delivered = preferences.getStringSet(KEY_DELIVERED_DATES, emptySet()).orEmpty().toMutableSet()
        delivered += date.toString()
        preferences.edit().putStringSet(KEY_DELIVERED_DATES, delivered).commit()
    }

    private fun deliveredDates(context: Context): Set<LocalDate> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet(KEY_DELIVERED_DATES, emptySet())
            .orEmpty()
            .mapNotNullTo(mutableSetOf()) { value ->
                runCatching { LocalDate.parse(value) }.getOrNull()
            }

    private fun alarmIntent(
        context: Context,
        accountKey: String,
        planId: String,
        date: LocalDate
    ) = PendingIntent.getBroadcast(
        context,
        alarmRequestCode(accountKey, planId, date),
        Intent(context, StudyReminderReceiver::class.java)
            .setAction(ACTION_REMIND)
            .setData(alarmUri(accountKey, planId, date))
            .putExtra(EXTRA_ACCOUNT_KEY, accountKey)
            .putExtra(EXTRA_PLAN_ID, planId)
            .putExtra(EXTRA_DATE, date.toString()),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun alarmUri(accountKey: String, planId: String, date: LocalDate) =
        Uri.Builder().scheme("zhizheng").authority("smart-plan-alarm")
            .appendPath(accountKey).appendPath(planId).appendPath(date.toString()).build()

    private fun notificationUri(accountKey: String, planId: String, date: LocalDate) =
        Uri.Builder().scheme("zhizheng").authority("smart-plan-open")
            .appendPath(accountKey).appendPath(planId).appendPath(date.toString()).build()

    private fun alarmRequestCode(accountKey: String, planId: String, date: LocalDate) =
        positiveHash("alarm:$accountKey:$planId:$date")

    private fun openRequestCode(accountKey: String, planId: String, date: LocalDate) =
        positiveHash("open:$accountKey:$planId:$date")

    private fun notificationId(accountKey: String, planId: String, date: LocalDate) =
        positiveHash("notification:$accountKey:$planId:$date")

    private fun positiveHash(value: String) = value.hashCode() and 0x7fffffff

    private fun accountKey(origin: String, accountId: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$origin\n$accountId".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }.take(32)
    }

    private fun fingerprint(raw: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun canonicalOrigin(value: String): String? {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (scheme !in setOf("http", "https")) return null
        val port = when {
            uri.port != -1 -> uri.port
            scheme == "https" -> 443
            else -> 80
        }
        return "$scheme://$host:$port"
    }

    private data class StoredPlan(val plan: SyncedStudyPlan, val accountKey: String)

    private const val EXTRA_ACCOUNT_KEY = "smart_plan_account_key"
    private const val EXTRA_PLAN_ID = "smart_plan_id"
    private const val EXTRA_DATE = "smart_plan_date"
}

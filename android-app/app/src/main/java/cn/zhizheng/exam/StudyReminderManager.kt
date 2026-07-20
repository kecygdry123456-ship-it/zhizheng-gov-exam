package cn.zhizheng.exam

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.time.ZoneId

object StudyReminderManager {
    const val ACTION_REMIND = "cn.zhizheng.exam.action.STUDY_REMINDER"
    const val CHANNEL_ID = "study_reminder"
    private const val PREFS = "study_reminder_settings"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_HOUR = "hour"
    private const val KEY_MINUTE = "minute"
    private const val KEY_MESSAGE = "message"
    private const val REQUEST_ALARM = 1201
    private const val REQUEST_OPEN_APP = 1202
    private const val NOTIFICATION_ID = 1201
    const val DEFAULT_HOUR = 20
    const val DEFAULT_MINUTE = 0
    const val DEFAULT_MESSAGE = "今天也要稳步前进，完成一组专项练习吧。"

    data class Settings(val enabled: Boolean, val hour: Int, val minute: Int, val message: String)

    fun settings(context: Context): Settings {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Settings(
            prefs.getBoolean(KEY_ENABLED, false),
            prefs.getInt(KEY_HOUR, DEFAULT_HOUR).coerceIn(0, 23),
            prefs.getInt(KEY_MINUTE, DEFAULT_MINUTE).coerceIn(0, 59),
            prefs.getString(KEY_MESSAGE, DEFAULT_MESSAGE).orEmpty().ifBlank { DEFAULT_MESSAGE }
        )
    }

    fun save(context: Context, settings: Settings) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ENABLED, settings.enabled)
            .putInt(KEY_HOUR, settings.hour)
            .putInt(KEY_MINUTE, settings.minute)
            .putString(KEY_MESSAGE, settings.message.trim().ifBlank { DEFAULT_MESSAGE })
            .apply()
        if (settings.enabled) scheduleNext(context) else cancel(context)
    }

    fun scheduleNext(context: Context) {
        val settings = settings(context)
        if (!settings.enabled) return
        val triggerAt = ReminderTimeCalculator.nextEpochMillis(
            System.currentTimeMillis(), ZoneId.systemDefault(), settings.hour, settings.minute
        )
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, alarmIntent(context))
    }

    fun cancel(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(alarmIntent(context))
    }

    @SuppressLint("MissingPermission")
    fun showNotification(context: Context) {
        val settings = settings(context)
        if (!settings.enabled || !hasNotificationPermission(context)) return
        createChannel(context)
        val openApp = PendingIntent.getActivity(
            context,
            REQUEST_OPEN_APP,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("知政公考 · 今日备考提醒")
            .setContentText(settings.message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(settings.message))
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // 用户可能在权限检查后立刻撤销通知权限；下次打开应用时会提示恢复。
        }
    }

    fun createChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL_ID, "备考与智能规划提醒", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "按设置时间发送固定备考提醒或当天智能规划任务"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun hasNotificationPermission(context: Context): Boolean =
        hasRuntimeNotificationPermission(context) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            context.getSystemService(NotificationManager::class.java)
                .getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE

    fun hasRuntimeNotificationPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

    private fun alarmIntent(context: Context) = PendingIntent.getBroadcast(
        context,
        REQUEST_ALARM,
        Intent(context, StudyReminderReceiver::class.java).setAction(ACTION_REMIND),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}

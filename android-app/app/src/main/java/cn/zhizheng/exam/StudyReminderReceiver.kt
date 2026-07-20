package cn.zhizheng.exam

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class StudyReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            SmartPlanReminderManager.ACTION_REMIND -> {
                SmartPlanReminderManager.handleAlarm(context, intent)
            }
            StudyReminderManager.ACTION_REMIND -> {
                if (!SmartPlanReminderManager.hasPlanForToday(context)) {
                    StudyReminderManager.showNotification(context)
                }
                StudyReminderManager.scheduleNext(context)
            }
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> {
                StudyReminderManager.scheduleNext(context)
                SmartPlanReminderManager.reschedule(context, includeMissedToday = true)
            }
        }
    }
}

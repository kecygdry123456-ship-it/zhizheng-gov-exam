package cn.zhizheng.exam

internal object SmartPlanSyncState {
    fun deliveredDatesForUpdate(
        storedAccountKey: String?,
        storedPlanId: String?,
        incomingAccountKey: String,
        incomingPlanId: String,
        storedDeliveredDates: Set<String>
    ): Set<String> =
        if (storedAccountKey == incomingAccountKey && storedPlanId == incomingPlanId) {
            storedDeliveredDates.toSet()
        } else {
            emptySet()
        }
}

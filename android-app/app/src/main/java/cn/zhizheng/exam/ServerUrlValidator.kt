package cn.zhizheng.exam

import java.net.URI

object ServerUrlValidator {
    fun normalize(value: String, allowHttp: Boolean): String? {
        val trimmed = value.trim().trimEnd('/')
        if (trimmed.isBlank()) return null
        return try {
            val uri = URI(trimmed)
            val scheme = uri.scheme?.lowercase()
            val host = uri.host
            val allowedScheme = scheme == "https" || (scheme == "http" && allowHttp)
            if (!allowedScheme || host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null) null
            else trimmed
        } catch (_: Exception) {
            null
        }
    }

    fun healthUrl(baseUrl: String): String = "${baseUrl.trimEnd('/')}/api/health"
}

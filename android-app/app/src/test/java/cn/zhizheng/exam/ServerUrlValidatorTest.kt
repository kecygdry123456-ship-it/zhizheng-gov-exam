package cn.zhizheng.exam

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerUrlValidatorTest {
    @Test fun acceptsAndNormalizesHttps() {
        assertEquals("https://exam.example.com", ServerUrlValidator.normalize(" https://exam.example.com/ ", false))
    }

    @Test fun releaseRejectsEveryHttpHost() {
        assertNull(ServerUrlValidator.normalize("http://192.168.1.8:3000", false))
        assertNull(ServerUrlValidator.normalize("http://8.163.38.217/", false))
    }

    @Test fun acceptsHttpForDebug() {
        assertEquals("http://192.168.1.8:3000", ServerUrlValidator.normalize("http://192.168.1.8:3000/", true))
    }

    @Test fun rejectsCredentialsAndInvalidValues() {
        assertNull(ServerUrlValidator.normalize("https://user:pass@example.com", false))
        assertNull(ServerUrlValidator.normalize("https://example.com/#section", false))
        assertNull(ServerUrlValidator.normalize("example.com", true))
        assertNull(ServerUrlValidator.normalize("", true))
    }

    @Test fun createsHealthCheckUrl() {
        assertEquals("https://exam.example.com/api/health", ServerUrlValidator.healthUrl("https://exam.example.com/"))
    }
}

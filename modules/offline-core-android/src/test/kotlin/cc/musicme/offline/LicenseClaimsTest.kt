package cc.musicme.offline

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.nio.charset.StandardCharsets
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
class LicenseClaimsTest {
    @Test
    fun decodesValidJwt() {
        val jwt = sampleJwt()
        val claims = LicenseClaims.decode(jwt)
        assertEquals("100:0:5", claims.trackId)
        assertEquals(12345L, claims.mid)
        assertEquals("d1", claims.deviceId)
        assertEquals("user-1", claims.userId)
        assertEquals("offline-v1", claims.v)
        assertEquals(32, claims.key.size)
        assertEquals(16, claims.iv.size)
        assertEquals(2_592_000L, claims.exp - claims.iat)
    }

    @Test
    fun rejectsMalformed() {
        try {
            LicenseClaims.decode("not.a.jwt")
            fail("should throw")
        } catch (e: OfflineError) {
            assertEquals(OfflineError.MalformedLicense, e)
        }
        try {
            LicenseClaims.decode("abc")
            fail("should throw")
        } catch (e: OfflineError) {
            // expected
        }
    }

    @Test
    fun rejectsUnsupportedVersion() {
        val body = JSONObject().apply {
            put("trackId", "x")
            put("mid", 1)
            put("deviceId", "d")
            put("userId", "u")
            put("key", Base64.getEncoder().encodeToString(ByteArray(32)))
            put("iv", Base64.getEncoder().encodeToString(ByteArray(16)))
            put("exp", 2)
            put("iat", 1)
            put("v", "future-v")
        }
        val header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        val bodyB64 = base64Url(body.toString().toByteArray(StandardCharsets.UTF_8))
        val jwt = "$header.$bodyB64.XXXX"
        try {
            LicenseClaims.decode(jwt)
            fail("should throw")
        } catch (e: OfflineError) {
            assertEquals(OfflineError.UnsupportedLicenseVersion, e)
        }
    }

    @Test
    fun decodesBase64UrlKeyAndIv() {
        // Bytes chosen so the standard-alphabet encoding contains '+' and '/';
        // re-encoded url-safe unpadded. The decoder must accept both alphabets.
        val keyBytes = ByteArray(32) { 0xFB.toByte() }
        val ivBytes = ByteArray(16) { 0xFE.toByte() }
        val body = JSONObject().apply {
            put("trackId", "100:0:5")
            put("mid", 12345)
            put("deviceId", "d1")
            put("userId", "user-1")
            put("key", base64Url(keyBytes))
            put("iv", base64Url(ivBytes))
            put("exp", 2)
            put("iat", 1)
            put("v", "offline-v1")
        }
        val header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        val jwt = "$header.${base64Url(body.toString().toByteArray(StandardCharsets.UTF_8))}.sig"
        val claims = LicenseClaims.decode(jwt)
        assertArrayEquals(keyBytes, claims.key)
        assertArrayEquals(ivBytes, claims.iv)
    }

    @Test
    fun rejectsInvalidBase64Key() {
        val body = JSONObject().apply {
            put("trackId", "x")
            put("mid", 1)
            put("deviceId", "d")
            put("userId", "u")
            put("key", "!!!not-base64!!!")
            put("iv", Base64.getEncoder().encodeToString(ByteArray(16)))
            put("exp", 2)
            put("iat", 1)
            put("v", "offline-v1")
        }
        val header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        val jwt = "$header.${base64Url(body.toString().toByteArray(StandardCharsets.UTF_8))}.sig"
        try {
            LicenseClaims.decode(jwt)
            fail("should throw")
        } catch (e: OfflineError) {
            assertEquals(OfflineError.MalformedLicense, e)
        }
    }

    private fun sampleJwt(): String {
        val iat = 1_777_000_000L
        val exp = iat + 2_592_000L
        val body = JSONObject().apply {
            put("trackId", "100:0:5")
            put("mid", 12345)
            put("deviceId", "d1")
            put("userId", "user-1")
            put("key", Base64.getEncoder().encodeToString(ByteArray(32) { 0x01 }))
            put("iv",  Base64.getEncoder().encodeToString(ByteArray(16) { 0x02 }))
            put("exp", exp)
            put("iat", iat)
            put("v", "offline-v1")
        }
        val header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        val bodyB64 = base64Url(body.toString().toByteArray(StandardCharsets.UTF_8))
        return "$header.$bodyB64.fake-sig"
    }

    private fun base64Url(bytes: ByteArray): String =
        Base64.getEncoder().encodeToString(bytes)
            .replace('+', '-')
            .replace('/', '_')
            .trimEnd('=')
}

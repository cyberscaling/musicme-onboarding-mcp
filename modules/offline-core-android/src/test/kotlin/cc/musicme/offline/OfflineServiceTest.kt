package cc.musicme.offline

import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
class OfflineServiceTest {
    private lateinit var rootDir: File

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        rootDir = File(ctx.cacheDir, UUID.randomUUID().toString())
    }

    @After
    fun tearDown() {
        rootDir.deleteRecursively()
    }

    @Test
    fun endToEndIngestAndList() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val svc = OfflineService(ctx, rootDirectory = rootDir, keyVault = InMemoryKeyVault())

        val key = ByteArray(32) { 0x77 }
        val iv = ByteArray(16) { 0x88.toByte() }
        val plaintext = ByteArray(100) { 0xAB.toByte() }
        val ciphertext = AESCTRDecryptor.decrypt(plaintext, key, iv, 0)
        val license = makeLicense("1:0:1", 1, "d", key, iv)
        val tmp = File(System.getProperty("java.io.tmpdir"), UUID.randomUUID().toString())
        tmp.writeBytes(ciphertext)

        svc.ingestDownload(tmp, license, sizeBytes = 100L, metaJson = "{}")

        val list = svc.listTracks()
        assertEquals(1, list.size)
        assertEquals("1:0:1", list.first().trackId)
        assertTrue(svc.hasTrack("1:0:1"))
        assertFalse(svc.hasTrack("absent"))
    }

    @Test
    fun wipeAllRemovesAll() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val svc = OfflineService(ctx, rootDirectory = rootDir, keyVault = InMemoryKeyVault())
        val key = ByteArray(32) { 1 }
        val iv = ByteArray(16) { 2 }
        val plaintext = byteArrayOf(1, 2, 3)
        val ciphertext = AESCTRDecryptor.decrypt(plaintext, key, iv, 0)
        val license = makeLicense("x", 1, "d", key, iv)
        val tmp = File(System.getProperty("java.io.tmpdir"), UUID.randomUUID().toString())
        tmp.writeBytes(ciphertext)
        svc.ingestDownload(tmp, license, sizeBytes = 3L, metaJson = null)

        svc.wipeAll()
        assertEquals(0, svc.listTracks().size)
        assertFalse(svc.hasTrack("x"))
    }

    private fun makeLicense(trackId: String, mid: Long, deviceId: String, key: ByteArray, iv: ByteArray): String {
        val iat = 1_777_000_000L
        val exp = iat + 2_592_000L
        val body = JSONObject().apply {
            put("trackId", trackId); put("mid", mid); put("deviceId", deviceId); put("userId", "u")
            put("key", Base64.getEncoder().encodeToString(key))
            put("iv",  Base64.getEncoder().encodeToString(iv))
            put("exp", exp); put("iat", iat); put("v", "offline-v1")
        }
        val header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        val b64 = Base64.getEncoder().encodeToString(body.toString().toByteArray(StandardCharsets.UTF_8))
            .replace('+', '-').replace('/', '_').trimEnd('=')
        return "$header.$b64.fakeSig"
    }
}

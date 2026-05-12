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
class OfflineDownloaderTest {
    private lateinit var rootDir: File
    private lateinit var dbFile: File
    private lateinit var catalog: OfflineCatalog
    private lateinit var blobStore: BlobStore
    private lateinit var vault: KeyVault

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val base = File(ctx.cacheDir, UUID.randomUUID().toString())
        rootDir = File(base, "blobs").also { it.mkdirs() }
        dbFile = File(base, "catalog.sqlite")
        catalog = OfflineCatalog(ctx, dbFile.absolutePath)
        blobStore = BlobStore(rootDir)
        vault = InMemoryKeyVault()
    }

    @After
    fun tearDown() {
        catalog.close()
        rootDir.parentFile?.deleteRecursively()
    }

    @Test
    fun ingestPersistsRowAndBlob() {
        val key = ByteArray(32) { 0x55 }
        val iv = ByteArray(16) { 0x66 }
        val plaintext = ByteArray(256) { it.toByte() }
        val ciphertext = AESCTRDecryptor.decrypt(plaintext, key, iv, 0)

        val jwt = makeLicense("100:0:5", 12345, "d1", key, iv)
        val tmp = File(System.getProperty("java.io.tmpdir"), UUID.randomUUID().toString())
        tmp.writeBytes(ciphertext)

        val downloader = OfflineDownloader(catalog, blobStore, vault)
        downloader.ingestCompletedDownload(
            tmpFile = tmp, license = jwt,
            sizeBytes = ciphertext.size.toLong(), metaJson = "{\"title\":\"Track\"}"
        )

        val row = catalog.get("100:0:5")!!
        assertEquals("d1", row.deviceId)
        assertEquals(256L, row.sizeBytes)
        assertArrayEquals(iv, row.trackIv)
        assertTrue(File(row.blobPath).exists())

        val unwrapped = vault.unwrap(row.wrappedKey, row.wrapNonce)
        assertArrayEquals(key, unwrapped)
    }

    @Test
    fun ingestSizeMismatchRollsBack() {
        val key = ByteArray(32) { 1 }
        val iv = ByteArray(16) { 2 }
        val jwt = makeLicense("x", 1, "d", key, iv)
        val tmp = File(System.getProperty("java.io.tmpdir"), UUID.randomUUID().toString())
        tmp.writeBytes(byteArrayOf(1, 2, 3))

        val downloader = OfflineDownloader(catalog, blobStore, vault)
        try {
            downloader.ingestCompletedDownload(tmp, jwt, sizeBytes = 999L, metaJson = null)
            fail("should throw")
        } catch (e: OfflineError.IoError) {
            // expected
        }
        assertNull(catalog.get("x"))
        assertFalse(File(blobStore.blobPath("x")).exists())
    }

    private fun makeLicense(trackId: String, mid: Long, deviceId: String, key: ByteArray, iv: ByteArray): String {
        val iat = 1_777_000_000L
        val exp = iat + 2_592_000L
        val body = JSONObject().apply {
            put("trackId", trackId)
            put("mid", mid)
            put("deviceId", deviceId)
            put("userId", "u")
            put("key", Base64.getEncoder().encodeToString(key))
            put("iv",  Base64.getEncoder().encodeToString(iv))
            put("exp", exp)
            put("iat", iat)
            put("v", "offline-v1")
        }
        val header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        val b64 = Base64.getEncoder().encodeToString(body.toString().toByteArray(StandardCharsets.UTF_8))
            .replace('+', '-').replace('/', '_').trimEnd('=')
        return "$header.$b64.fakeSig"
    }
}

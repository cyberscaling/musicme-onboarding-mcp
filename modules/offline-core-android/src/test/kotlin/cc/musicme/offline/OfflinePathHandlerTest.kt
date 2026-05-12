package cc.musicme.offline

import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
class OfflinePathHandlerTest {
    private lateinit var rootDir: File
    private lateinit var dbFile: File
    private lateinit var catalog: OfflineCatalog
    private lateinit var blobStore: BlobStore
    private lateinit var vault: KeyVault

    private val deviceId = "device-current"
    private val trackId = "100:0:5"
    private val plaintext: ByteArray = ByteArray(1024) { (it and 0xFF).toByte() }

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

    private fun future() = System.currentTimeMillis() / 1000 + 30 * 86400

    private fun seed(key: ByteArray, iv: ByteArray, licenseExp: Long, deviceIdOverride: String? = null) {
        val ciphertext = AESCTRDecryptor.decrypt(plaintext, key, iv, 0)
        val tmp = File(System.getProperty("java.io.tmpdir"), UUID.randomUUID().toString())
        tmp.writeBytes(ciphertext)
        val path = blobStore.persist(trackId, tmp)
        val wrapped = vault.wrap(key)
        catalog.insert(OfflineTrackRow(
            trackId = trackId,
            deviceId = deviceIdOverride ?: deviceId,
            blobPath = path,
            sizeBytes = plaintext.size.toLong(),
            wrappedKey = wrapped.ciphertext,
            wrapNonce = wrapped.nonce,
            trackIv = iv,
            licenseExp = licenseExp,
            licenseIat = licenseExp - 86400,
            downloadedAt = System.currentTimeMillis() / 1000,
            metaJson = null,
            corrupted = false
        ))
    }

    private fun handler() = OfflinePathHandler(catalog, blobStore, vault, deviceIdProvider = { deviceId })

    @Test
    fun fullFileResponseDecryptsCorrectly() {
        val key = ByteArray(32) { 0x11 }
        val iv = ByteArray(16) { 0x22 }
        seed(key, iv, future())

        val response = handler().handle(trackId, rangeHeader = null)
        assertEquals(200, response.statusCode)
        val body = response.data!!.readBytes()
        assertArrayEquals(plaintext, body)
    }

    @Test
    fun rangeRequestReturns206WithAlignedBytes() {
        val key = ByteArray(32) { 0x33 }
        val iv = ByteArray(16) { 0x44 }
        seed(key, iv, future())

        val response = handler().handle(trackId, rangeHeader = "bytes=5-25")
        assertEquals(206, response.statusCode)
        val body = response.data!!.readBytes()
        assertEquals(21, body.size)
        assertArrayEquals(plaintext.copyOfRange(5, 26), body)
    }

    @Test
    fun expiredLicenseReturns410() {
        seed(ByteArray(32) { 1 }, ByteArray(16) { 2 },
             licenseExp = System.currentTimeMillis() / 1000 - 100)
        val response = handler().handle(trackId, rangeHeader = null)
        assertEquals(410, response.statusCode)
    }

    @Test
    fun deviceIdMismatchReturns403AndDeletesRow() {
        seed(ByteArray(32) { 1 }, ByteArray(16) { 2 },
             licenseExp = future(), deviceIdOverride = "other-device")
        val response = handler().handle(trackId, rangeHeader = null)
        assertEquals(403, response.statusCode)
        assertNull(catalog.get(trackId))
    }

    @Test
    fun missingTrackReturns404() {
        val response = handler().handle("absent", rangeHeader = null)
        assertEquals(404, response.statusCode)
    }
}

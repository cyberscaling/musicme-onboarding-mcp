package cc.musicme.offline

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class OfflineServiceRoutingTest {

    @Test fun openSource_returns_blobSource_when_in_catalog() = runTest {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val root = File(ctx.cacheDir, "rt-${System.nanoTime()}")
        val service = OfflineService(ctx, root, InMemoryKeyVault())

        val key = ByteArray(32) { 1 }
        val iv = ByteArray(16) { 2 }
        val plain = ByteArray(32) { 0xAA.toByte() }
        val cipher = AESCTRDecryptor.decrypt(plain, key, iv, 0)
        val wrap = service.keyVault.wrap(key)
        val path = service.blobStore.blobPath("10:0:1")
        File(path).also { it.parentFile?.mkdirs() }.writeBytes(cipher)

        service.catalog.insert(OfflineTrackRow(
            trackId = "10:0:1",
            deviceId = "d",
            blobPath = path,
            sizeBytes = 32L,
            wrappedKey = wrap.ciphertext,
            wrapNonce = wrap.nonce,
            trackIv = iv,
            licenseExp = Long.MAX_VALUE,
            licenseIat = 0,
            downloadedAt = 0,
            metaJson = null,
            corrupted = false))

        val s = service.openSource(TrackRef(10, 0, 1), "https://nope", { "tok" })
        assertTrue(s is BlobSource)
        assertEquals(32L, s.fileSize)
    }

    @Test fun openSource_returns_streamSource_when_absent() = runTest {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val root = File(ctx.cacheDir, "rt2-${System.nanoTime()}")
        val service = OfflineService(ctx, root, InMemoryKeyVault())
        val s = service.openSource(TrackRef(999, 0, 1), "https://nope", { "tok" })
        assertTrue(s is StreamSource)
    }
}

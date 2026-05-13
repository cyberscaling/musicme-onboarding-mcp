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
class ByteSourceTest {

    @Test fun blobSource_decrypts_range() = runTest {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val root = File(ctx.cacheDir, "bs-${System.nanoTime()}")
        root.mkdirs()
        val service = OfflineService(ctx, root, InMemoryKeyVault())
        val key = ByteArray(32) { 0x11.toByte() }
        val iv = ByteArray(16) { 0x22.toByte() }
        val plain = ByteArray(256) { it.toByte() }
        val cipher = AESCTRDecryptor.decrypt(plain, key, iv, 0)
        val wrap = service.keyVault.wrap(key)
        val path = service.blobStore.blobPath("1:0:1")
        File(path).also { it.parentFile?.mkdirs() }.writeBytes(cipher)

        service.catalog.insert(
            OfflineTrackRow(
                trackId = "1:0:1",
                deviceId = "dev",
                blobPath = path,
                sizeBytes = cipher.size.toLong(),
                wrappedKey = wrap.ciphertext,
                wrapNonce = wrap.nonce,
                trackIv = iv,
                licenseExp = Long.MAX_VALUE,
                licenseIat = 0,
                downloadedAt = 0,
                metaJson = null,
                corrupted = false
            )
        )
        val src = BlobSource("1:0:1", service.catalog, service.blobStore, service.keyVault)
        assertEquals(256L, src.fileSize)
        val slice = src.read(5L, 37L)
        assertArrayEquals(plain.copyOfRange(5, 37), slice)
    }
}

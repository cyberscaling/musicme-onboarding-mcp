package cc.musicme.offline

import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class OfflineCatalogTest {
    private lateinit var dbFile: File

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        dbFile = File(ctx.cacheDir, "offline-test-${System.nanoTime()}.db")
        if (dbFile.exists()) dbFile.delete()
    }

    private fun sampleRow(trackId: String) = OfflineTrackRow(
        trackId = trackId,
        deviceId = "d1",
        blobPath = "/tmp/blob-$trackId.bin",
        sizeBytes = 1024,
        wrappedKey = ByteArray(48) { 0x11 },
        wrapNonce = ByteArray(12) { 0x22 },
        trackIv = ByteArray(16) { 0x33 },
        licenseExp = 2_000_000_000L,
        licenseIat = 1_900_000_000L,
        downloadedAt = 1_900_000_500L,
        metaJson = "{\"title\":\"t\"}",
        corrupted = false
    )

    @Test
    fun schemaCreatedOnOpen() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use {
            assertTrue(dbFile.exists())
        }
    }

    @Test
    fun insertAndGet() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use { cat ->
            val row = sampleRow("1:0:1")
            cat.insert(row)
            assertEquals(row, cat.get("1:0:1"))
        }
    }

    @Test
    fun getMissingReturnsNull() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use { cat ->
            assertNull(cat.get("absent"))
        }
    }

    @Test
    fun list() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use { cat ->
            cat.insert(sampleRow("1:0:1"))
            cat.insert(sampleRow("1:0:2"))
            val all = cat.list()
            assertEquals(2, all.size)
            assertEquals(setOf("1:0:1", "1:0:2"), all.map { it.trackId }.toSet())
        }
    }

    @Test
    fun remove() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use { cat ->
            cat.insert(sampleRow("x"))
            cat.remove("x")
            assertNull(cat.get("x"))
        }
    }

    @Test
    fun wipeAll() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use { cat ->
            cat.insert(sampleRow("a"))
            cat.insert(sampleRow("b"))
            cat.wipeAll()
            assertEquals(0, cat.list().size)
        }
    }

    @Test
    fun markCorrupted() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use { cat ->
            cat.insert(sampleRow("x"))
            cat.markCorrupted("x")
            assertTrue(cat.get("x")!!.corrupted)
        }
    }

    @Test
    fun updateLicenseExp() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        OfflineCatalog(ctx, dbFile.absolutePath).use { cat ->
            cat.insert(sampleRow("x"))
            cat.updateLicenseExp("x", 9_999_999_999L, 9_000_000_000L)
            val row = cat.get("x")!!
            assertEquals(9_999_999_999L, row.licenseExp)
            assertEquals(9_000_000_000L, row.licenseIat)
        }
    }
}

package cc.musicme.offline

import android.content.Context
import java.io.Closeable
import java.io.File

class OfflineService(
    context: Context,
    rootDirectory: File,
    /**
     * Inject a [KeyVault] implementation. Production code passes
     * [AndroidKeyStoreKeyVault] (the default); tests pass [InMemoryKeyVault].
     */
    val keyVault: KeyVault = AndroidKeyStoreKeyVault()
) : Closeable {

    val rootDirectory: File = rootDirectory.also { it.mkdirs() }
    val catalog: OfflineCatalog =
        OfflineCatalog(context, File(rootDirectory, "catalog.sqlite").absolutePath)
    val blobStore: BlobStore = BlobStore(File(rootDirectory, "blobs"))
    val downloader: OfflineDownloader = OfflineDownloader(catalog, blobStore, keyVault)

    fun ingestDownload(tmpFile: File, license: String, sizeBytes: Long, metaJson: String?) {
        downloader.ingestCompletedDownload(tmpFile, license, sizeBytes, metaJson)
    }

    fun listTracks(): List<OfflineTrackRow> = catalog.list()

    fun hasTrack(trackId: String): Boolean = catalog.get(trackId) != null

    fun removeTrack(trackId: String) {
        catalog.remove(trackId)
        blobStore.delete(trackId)
    }

    fun wipeAll() {
        catalog.wipeAll()
        blobStore.wipeAll()
        keyVault.deleteMasterKey()
    }

    /**
     * Returns a configured [OfflinePathHandler] that Plan 4 registers on a
     * [androidx.webkit.WebViewAssetLoader] (and on a custom `WebViewClient`
     * to pass Range headers — see `OfflinePathHandler` docs).
     */
    fun makePathHandler(deviceIdProvider: () -> String): OfflinePathHandler =
        OfflinePathHandler(catalog, blobStore, keyVault, deviceIdProvider)

    override fun close() {
        catalog.close()
    }
}

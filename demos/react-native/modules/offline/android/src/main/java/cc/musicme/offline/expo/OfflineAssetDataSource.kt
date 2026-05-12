package cc.musicme.offline.expo

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import cc.musicme.offline.AESCTRDecryptor
import cc.musicme.offline.OfflineError
import cc.musicme.offline.OfflineService

/**
 * ExoPlayer DataSource that reads ciphertext from the offline BlobStore and
 * decrypts on the fly. URI format: `offline-asset://<trackId>/audio.m4a`.
 */
@OptIn(UnstableApi::class)
class OfflineAssetDataSource(
    private val service: OfflineService,
    private val deviceIdProvider: () -> String
) : BaseDataSource(/* isNetwork = */ false) {

    companion object {
        const val SCHEME = "offline-asset"
    }

    private var spec: DataSpec? = null
    private var blobPath: String = ""
    private var sizeBytes: Long = 0
    private var trackIv: ByteArray = ByteArray(0)
    private var trackKey: ByteArray = ByteArray(0)
    private var pos: Long = 0L
    private var bytesRemaining: Long = 0L

    override fun open(dataSpec: DataSpec): Long {
        // Zero any previous key before acquiring a new one — ExoPlayer may
        // reuse a DataSource instance across opens.
        trackKey.fill(0)

        transferInitializing(dataSpec)
        val uri = dataSpec.uri
        val tid = uri.host?.let { Uri.decode(it) }
            ?: throw OfflineError.IoError("missing trackId in uri")
        val row = service.catalog.get(tid) ?: throw OfflineError.TrackNotFound

        if (row.deviceId != deviceIdProvider()) {
            service.catalog.remove(tid)
            runCatching { service.blobStore.delete(tid) }
            throw OfflineError.DeviceIdMismatch
        }
        val now = System.currentTimeMillis() / 1000
        if (row.licenseExp < now) throw OfflineError.LicenseExpired

        this.spec = dataSpec
        this.blobPath = row.blobPath
        this.sizeBytes = row.sizeBytes
        this.trackIv = row.trackIv
        this.trackKey = try {
            service.keyVault.unwrap(row.wrappedKey, row.wrapNonce)
        } catch (e: Exception) {
            throw OfflineError.LicenseExpired
        }

        pos = dataSpec.position
        bytesRemaining = if (dataSpec.length == androidx.media3.common.C.LENGTH_UNSET.toLong())
            sizeBytes - pos
        else
            minOf(dataSpec.length, sizeBytes - pos)

        transferStarted(dataSpec)
        return bytesRemaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (bytesRemaining == 0L) return androidx.media3.common.C.RESULT_END_OF_INPUT
        val toRead = minOf(length.toLong(), bytesRemaining).toInt()

        val alignedStart = (pos / 16) * 16
        val skip = (pos - alignedStart).toInt()
        val wireLength = ((skip + toRead + 15) / 16) * 16
        val maxWire = (sizeBytes - alignedStart).toInt()
        val actualWireLength = minOf(wireLength, maxWire)
        val blockIndex = (alignedStart / 16).toInt()

        val ciphertext = service.blobStore.pread(blobPath, alignedStart, actualWireLength)
        if (ciphertext.size != actualWireLength) {
            throw OfflineError.IoError("pread short read: ${ciphertext.size}/$actualWireLength")
        }

        val plaintext = AESCTRDecryptor.decrypt(ciphertext, trackKey, trackIv, blockIndex)
        val end = minOf(skip + toRead, plaintext.size)
        val n = end - skip
        if (n <= 0) return androidx.media3.common.C.RESULT_END_OF_INPUT

        System.arraycopy(plaintext, skip, buffer, offset, n)

        pos += n
        bytesRemaining -= n
        bytesTransferred(n)
        return n
    }

    override fun getUri(): Uri? = spec?.uri

    override fun close() {
        if (spec != null) {
            trackKey.fill(0)
            transferEnded()
            spec = null
        }
    }

    @OptIn(UnstableApi::class)
    class Factory(
        private val service: OfflineService,
        private val deviceIdProvider: () -> String
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource =
            OfflineAssetDataSource(service, deviceIdProvider)
    }
}

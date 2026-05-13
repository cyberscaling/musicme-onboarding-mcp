package cc.musicme.offline.expo

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import cc.musicme.offline.ByteSource
import kotlinx.coroutines.runBlocking

/**
 * ExoPlayer DataSource that reads from a single ByteSource (BlobSource for
 * offline tracks, StreamSource for online streaming). URI scheme:
 * `sasplayer://<trackId>/audio.m4a` for both paths.
 */
@OptIn(UnstableApi::class)
class SasPlayerDataSource(
    private val source: ByteSource,
) : BaseDataSource(false) {

    companion object { const val SCHEME = "sasplayer" }

    private var spec: DataSpec? = null
    private var pos: Long = 0L
    private var remaining: Long = 0L

    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)
        this.spec = dataSpec
        if (source is cc.musicme.offline.StreamSource) {
            // Prepare on first open so fileSize is known. ExoPlayer drives
            // open() off the loader thread — blocking here is safe.
            runBlocking { source.prepare() }
        }
        pos = dataSpec.position
        remaining = if (dataSpec.length == androidx.media3.common.C.LENGTH_UNSET.toLong())
            source.fileSize - pos
        else
            minOf(dataSpec.length, source.fileSize - pos)
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (remaining == 0L) return androidx.media3.common.C.RESULT_END_OF_INPUT
        val toRead = minOf(length.toLong(), remaining)
        val chunk = runBlocking { source.read(pos, pos + toRead) }
        if (chunk.isEmpty()) return androidx.media3.common.C.RESULT_END_OF_INPUT
        System.arraycopy(chunk, 0, buffer, offset, chunk.size)
        pos += chunk.size
        remaining -= chunk.size
        bytesTransferred(chunk.size)
        return chunk.size
    }

    override fun getUri(): Uri? = spec?.uri
    override fun close() {
        if (spec != null) {
            source.close()
            transferEnded()
            spec = null
        }
    }

    @OptIn(UnstableApi::class)
    class Factory(private val sourceProvider: () -> ByteSource) : DataSource.Factory {
        override fun createDataSource(): DataSource = SasPlayerDataSource(sourceProvider())
    }
}

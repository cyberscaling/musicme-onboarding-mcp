package cc.musicme.offline

import java.io.File
import java.io.RandomAccessFile

class BlobStore(val rootDirectory: File) {

    init {
        if (!rootDirectory.exists()) rootDirectory.mkdirs()
    }

    fun blobPath(trackId: String): String {
        val safe = trackId.replace('/', '_').replace(':', '_')
        return File(rootDirectory, "$safe.bin").absolutePath
    }

    fun persist(trackId: String, tmpFile: File): String {
        val dest = File(blobPath(trackId))
        if (dest.exists()) dest.delete()
        if (!tmpFile.renameTo(dest)) {
            // Fallback when renameTo fails (e.g. crossing volumes).
            tmpFile.copyTo(dest, overwrite = true)
            tmpFile.delete()
        }
        return dest.absolutePath
    }

    fun delete(trackId: String) {
        File(blobPath(trackId)).delete()
    }

    fun wipeAll() {
        rootDirectory.listFiles()?.forEach { it.delete() }
    }

    /**
     * Positional read of `length` bytes from `offset`. Each call opens its own
     * RandomAccessFile — safe for concurrent calls from different threads.
     */
    fun pread(path: String, offset: Long, length: Int): ByteArray {
        val raf = RandomAccessFile(path, "r")
        try {
            raf.seek(offset)
            val out = ByteArray(length)
            var totalRead = 0
            while (totalRead < length) {
                val n = raf.read(out, totalRead, length - totalRead)
                if (n < 0) break // EOF
                totalRead += n
            }
            return if (totalRead < length) out.copyOf(totalRead) else out
        } finally {
            raf.close()
        }
    }
}

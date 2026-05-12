package cc.musicme.offline

import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

/**
 * AndroidX `WebViewAssetLoader.PathHandler` serving `offline://<trackId>/audio.m4a`
 * (mapped via the asset loader's domain + path prefix).
 *
 * Trust chain mirrors iOS `OfflineSchemeHandler`:
 * 1. Catalog lookup. Missing → 404.
 * 2. `device_id` must equal current `deviceIdProvider()`. Mismatch → 403 + DELETE row.
 * 3. `license_exp` not in the past. Expired → 410.
 * 4. Unwrap trackKey via KeyVault. Failure → 410.
 * 5. Parse `Range` header (`bytes=A-B` or `bytes=A-`). Out of bounds → 416.
 * 6. Block-align A → A_aligned = floor(A/16)*16. counter = aligned/16.
 * 7. Read blob[A_aligned..B]. AES-CTR decrypt. Slice from (A - A_aligned).
 * 8. Respond 200 (no Range) or 206 (Range) with Content-Length set to slice length.
 */
class OfflinePathHandler(
    private val catalog: OfflineCatalog,
    private val blobStore: BlobStore,
    private val keyVault: KeyVault,
    private val deviceIdProvider: () -> String
) : WebViewAssetLoader.PathHandler {

    companion object {
        const val BLOCK_SIZE = 16
        const val DOMAIN = "offline.musicme.local"
        const val PATH_PREFIX = "/offline/"
    }

    /**
     * WebViewAssetLoader contract — extracts trackId from the path, delegates
     * to `handle()`. The Range header is NOT available from `path` alone;
     * Plan 4 wires a custom `WebViewClient` that calls `handle(trackId, rangeHeader)`
     * directly with the actual Range header.
     */
    override fun handle(path: String): WebResourceResponse? {
        val trackId = path.substringBefore('/')
        return handle(trackId, rangeHeader = null)
    }

    fun handle(trackId: String, rangeHeader: String?): WebResourceResponse {
        try {
            return handleInternal(trackId, rangeHeader)
        } catch (e: OfflineError) {
            return responseFor(e)
        } catch (e: Exception) {
            return errorResponse(500)
        }
    }

    private fun handleInternal(trackId: String, rangeHeader: String?): WebResourceResponse {
        val row = catalog.get(trackId) ?: return errorResponse(404)

        if (row.deviceId != deviceIdProvider()) {
            catalog.remove(trackId)
            try { blobStore.delete(trackId) } catch (_: Exception) {}
            return errorResponse(403)
        }

        val now = System.currentTimeMillis() / 1000
        if (row.licenseExp < now) return errorResponse(410)

        val trackKey = try {
            keyVault.unwrap(row.wrappedKey, row.wrapNonce)
        } catch (e: Exception) {
            return errorResponse(410)
        }

        val (start, end, isRangeRequest) = try {
            parseRange(rangeHeader, row.sizeBytes)
        } catch (e: OfflineError) {
            zeroize(trackKey)
            return errorResponse(416)
        }

        val alignedStart = (start / BLOCK_SIZE) * BLOCK_SIZE
        val skip = (start - alignedStart).toInt()
        val wireLength = (end - alignedStart + 1).toInt()
        val blockIndex = (alignedStart / BLOCK_SIZE).toInt()

        val ciphertextSlice = try {
            blobStore.pread(row.blobPath, alignedStart, wireLength)
        } catch (e: Exception) {
            zeroize(trackKey)
            try { catalog.markCorrupted(trackId) } catch (_: Exception) {}
            return errorResponse(500)
        }
        if (ciphertextSlice.size != wireLength) {
            zeroize(trackKey)
            try { catalog.markCorrupted(trackId) } catch (_: Exception) {}
            return errorResponse(500)
        }

        val plaintextAligned = AESCTRDecryptor.decrypt(ciphertextSlice, trackKey, row.trackIv, blockIndex)
        zeroize(trackKey)
        val userPlaintext = plaintextAligned.copyOfRange(skip, plaintextAligned.size)

        val headers = mutableMapOf(
            "Content-Length" to userPlaintext.size.toString(),
            "Accept-Ranges" to "bytes",
            "Cache-Control" to "no-store, private"
        )
        if (isRangeRequest) {
            headers["Content-Range"] = "bytes $start-$end/${row.sizeBytes}"
        }

        return WebResourceResponse(
            "audio/mp4",
            "utf-8",
            if (isRangeRequest) 206 else 200,
            if (isRangeRequest) "Partial Content" else "OK",
            headers,
            ByteArrayInputStream(userPlaintext)
        )
    }

    private fun parseRange(header: String?, fileSize: Long): Triple<Long, Long, Boolean> {
        if (header == null) return Triple(0L, fileSize - 1, false)
        val trimmed = header.trim()
        if (!trimmed.startsWith("bytes=")) throw OfflineError.RangeOutOfBounds
        val rest = trimmed.removePrefix("bytes=")
        val dash = rest.indexOf('-')
        if (dash < 0) throw OfflineError.RangeOutOfBounds
        val startStr = rest.substring(0, dash)
        val endStr = rest.substring(dash + 1)
        val start = startStr.toLongOrNull() ?: throw OfflineError.RangeOutOfBounds
        val end = if (endStr.isEmpty()) fileSize - 1 else endStr.toLongOrNull() ?: throw OfflineError.RangeOutOfBounds
        if (start < 0 || end >= fileSize || start > end) throw OfflineError.RangeOutOfBounds
        return Triple(start, end, true)
    }

    private fun responseFor(err: OfflineError): WebResourceResponse = when (err) {
        is OfflineError.RangeOutOfBounds -> errorResponse(416)
        is OfflineError.TrackNotFound -> errorResponse(404)
        is OfflineError.DeviceIdMismatch -> errorResponse(403)
        is OfflineError.LicenseExpired, is OfflineError.KeyUnwrapFailed -> errorResponse(410)
        else -> errorResponse(500)
    }

    private fun errorResponse(status: Int): WebResourceResponse =
        WebResourceResponse(
            "application/octet-stream", "utf-8", status,
            statusReason(status), emptyMap(), ByteArrayInputStream(ByteArray(0))
        )

    private fun statusReason(status: Int): String = when (status) {
        200 -> "OK"
        206 -> "Partial Content"
        403 -> "Forbidden"
        404 -> "Not Found"
        410 -> "Gone"
        416 -> "Range Not Satisfiable"
        500 -> "Internal Server Error"
        else -> "Error"
    }

    private fun zeroize(buf: ByteArray) {
        for (i in buf.indices) buf[i] = 0
    }
}

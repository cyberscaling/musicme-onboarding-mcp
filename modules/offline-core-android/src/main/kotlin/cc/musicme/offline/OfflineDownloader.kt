package cc.musicme.offline

import java.io.File

class OfflineDownloader(
    private val catalog: OfflineCatalog,
    private val blobStore: BlobStore,
    private val keyVault: KeyVault
) {
    /**
     * Atomically commits a freshly-downloaded ciphertext file into the offline store.
     *
     * Throws OfflineError.MalformedLicense if JWT can't be decoded.
     * Throws OfflineError.IoError("size mismatch") if downloaded file size differs.
     * Rolls back the blob on post-persist failure.
     */
    fun ingestCompletedDownload(
        tmpFile: File,
        license: String,
        sizeBytes: Long,
        metaJson: String?
    ) {
        val claims = LicenseClaims.decode(license)

        val actualSize = tmpFile.length()
        if (actualSize != sizeBytes) {
            tmpFile.delete()
            throw OfflineError.IoError("size mismatch: expected $sizeBytes, got $actualSize")
        }

        val blobPath = blobStore.persist(claims.trackId, tmpFile)
        try {
            val wrapped = keyVault.wrap(claims.key)
            val row = OfflineTrackRow(
                trackId = claims.trackId,
                deviceId = claims.deviceId,
                blobPath = blobPath,
                sizeBytes = sizeBytes,
                wrappedKey = wrapped.ciphertext,
                wrapNonce = wrapped.nonce,
                trackIv = claims.iv,
                licenseExp = claims.exp,
                licenseIat = claims.iat,
                downloadedAt = System.currentTimeMillis() / 1000,
                metaJson = metaJson,
                corrupted = false
            )
            catalog.insert(row)
        } catch (e: Exception) {
            try { blobStore.delete(claims.trackId) } catch (_: Exception) {}
            throw e
        } finally {
            // Best-effort: zeroize the in-memory plaintext key now that it's wrapped (spec § 7.4).
            // iv is not zeroized: it's stored in plaintext in the SQLite row anyway.
            claims.key.fill(0)
        }
    }
}

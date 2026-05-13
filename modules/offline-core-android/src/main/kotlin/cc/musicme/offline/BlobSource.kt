package cc.musicme.offline

class BlobSource(
    trackId: String,
    catalog: OfflineCatalog,
    private val blobStore: BlobStore,
    keyVault: KeyVault,
) : ByteSource {

    private val row = catalog.get(trackId) ?: throw OfflineError.TrackNotFound
    override val fileSize: Long = row.sizeBytes
    override val contentType: String = "audio/mp4"
    private val trackKey: ByteArray = keyVault.unwrap(row.wrappedKey, row.wrapNonce)

    override suspend fun read(start: Long, endExclusive: Long): ByteArray {
        val aligned = (start / 16) * 16
        val skip = (start - aligned).toInt()
        val wireLen = (endExclusive - aligned).toInt()
        val blockIndex = (aligned / 16).toInt()
        val cipher = blobStore.pread(row.blobPath, aligned, wireLen)
        val plain = AESCTRDecryptor.decrypt(cipher, trackKey, row.trackIv, blockIndex)
        val wanted = (endExclusive - start).toInt()
        return plain.copyOfRange(skip, skip + wanted)
    }

    override fun close() { trackKey.fill(0) }
}

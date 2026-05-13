import Foundation

public final class BlobSource: ByteSource {
    public let fileSize: Int64
    public let contentType: String = "audio/mp4"

    private let trackKey: Data
    private let trackIv: Data
    private let blobPath: String
    private let blobStore: BlobStore

    public init(trackId: String, catalog: OfflineCatalog, blobStore: BlobStore, keyVault: KeyVault) throws {
        guard let row = try catalog.get(trackId: trackId) else { throw OfflineError.trackNotFound }
        self.fileSize = row.sizeBytes
        self.blobPath = row.blobPath
        self.blobStore = blobStore
        self.trackIv = row.trackIv
        self.trackKey = try keyVault.unwrap(ciphertext: row.wrappedKey, nonce: row.wrapNonce)
    }

    public func read(range: Range<Int64>) async throws -> Data {
        let aligned = (range.lowerBound / 16) * 16
        let skip = Int(range.lowerBound - aligned)
        let wireLen = Int(range.upperBound - aligned)
        let blockIndex = Int(aligned / 16)
        let cipher = try blobStore.pread(path: blobPath, offset: aligned, length: wireLen)
        let plain = try AESCTRDecryptor.decrypt(ciphertext: cipher, key: trackKey, baseIv: trackIv, blockIndex: blockIndex)
        let wanted = Int(range.upperBound - range.lowerBound)
        return plain.subdata(in: skip..<(skip + wanted))
    }

    public func close() {
        // No explicit teardown needed; ARC releases trackKey at deinit.
    }
}

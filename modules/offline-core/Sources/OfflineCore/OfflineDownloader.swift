import Foundation

public final class OfflineDownloader {
    private let catalog: OfflineCatalog
    private let blobStore: BlobStore
    private let keyVault: KeyVault

    public init(catalog: OfflineCatalog, blobStore: BlobStore, keyVault: KeyVault) {
        self.catalog = catalog
        self.blobStore = blobStore
        self.keyVault = keyVault
    }

    /// Atomically commits a freshly-downloaded ciphertext file into the offline store.
    ///
    /// - Parameters:
    ///   - tmpFileURL: file path of the completed download (e.g. from URLSessionDownloadTask).
    ///                Moved (not copied) into the blob store on success.
    ///   - license: HS256 JWT received from the worker.
    ///   - sizeBytes: expected ciphertext size (from worker `/offline/license` response).
    ///   - metaJSON: optional opaque metadata blob (title, cover URL, etc.) — stored verbatim.
    ///
    /// Throws `OfflineError.malformedLicense` if the JWT can't be decoded.
    /// Throws `OfflineError.ioError("size mismatch")` if the downloaded file size != sizeBytes.
    /// On any throw, no row is inserted and no blob is persisted (rollback).
    public func ingestCompletedDownload(
        tmpFileURL: URL,
        license: String,
        sizeBytes: Int64,
        metaJSON: String?
    ) throws {
        let claims = try LicenseClaims.decode(jwt: license)

        let actualSize = try fileSize(at: tmpFileURL)
        guard actualSize == sizeBytes else {
            try? FileManager.default.removeItem(at: tmpFileURL)
            throw OfflineError.ioError("size mismatch: expected \(sizeBytes), got \(actualSize)")
        }

        let blobPath = try blobStore.persist(trackId: claims.trackId, from: tmpFileURL)
        do {
            let wrapped = try keyVault.wrap(key: claims.key)
            let row = OfflineTrackRow(
                trackId: claims.trackId,
                deviceId: claims.deviceId,
                blobPath: blobPath,
                sizeBytes: sizeBytes,
                wrappedKey: wrapped.ciphertext,
                wrapNonce: wrapped.nonce,
                trackIv: claims.iv,
                licenseExp: claims.exp,
                licenseIat: claims.iat,
                downloadedAt: Int64(Date().timeIntervalSince1970),
                metaJSON: metaJSON,
                corrupted: false
            )
            try catalog.insert(row)
        } catch {
            // Roll back the blob.
            try? blobStore.delete(trackId: claims.trackId)
            throw error
        }
    }

    private func fileSize(at url: URL) throws -> Int64 {
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attrs[.size] as? NSNumber else {
            throw OfflineError.ioError("size unknown")
        }
        return size.int64Value
    }
}

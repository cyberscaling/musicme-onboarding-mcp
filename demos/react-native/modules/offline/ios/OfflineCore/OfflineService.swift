import Foundation

/// Top-level facade. One instance per app — owns the catalog DB, blob root, and KeyVault.
/// Plan 4's Expo module will instantiate one of these and route JS calls into it.
public final class OfflineService {
    public let catalog: OfflineCatalog
    public let blobStore: BlobStore
    public let keyVault: KeyVault
    public let downloader: OfflineDownloader
    public let rootDirectory: URL

    /// - Parameter rootDirectory: typically `<app sandbox>/Library/offline`.
    /// - Parameter keyVaultServiceTag: Keychain service identifier. Defaults to project default.
    public init(rootDirectory: URL,
                keyVaultServiceTag: String = "cc.musicme.offline.master.v1") throws {
        try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
        let dbURL = rootDirectory.appendingPathComponent("catalog.sqlite")
        let blobsURL = rootDirectory.appendingPathComponent("blobs")

        self.rootDirectory = rootDirectory
        self.catalog = try OfflineCatalog(databaseURL: dbURL)
        self.blobStore = try BlobStore(rootDirectory: blobsURL)
        self.keyVault = KeyVault(serviceTag: keyVaultServiceTag)
        self.downloader = OfflineDownloader(catalog: catalog, blobStore: blobStore, keyVault: keyVault)
    }

    public func ingestDownload(tmpFileURL: URL, license: String, sizeBytes: Int64, metaJSON: String?) throws {
        try downloader.ingestCompletedDownload(
            tmpFileURL: tmpFileURL, license: license, sizeBytes: sizeBytes, metaJSON: metaJSON
        )
    }

    public func listTracks() throws -> [OfflineTrackRow] {
        return try catalog.list()
    }

    public func hasTrack(trackId: String) throws -> Bool {
        return try catalog.get(trackId: trackId) != nil
    }

    public func removeTrack(trackId: String) throws {
        try catalog.remove(trackId: trackId)
        try blobStore.delete(trackId: trackId)
    }

    public func wipeAll() throws {
        try catalog.wipeAll()
        try blobStore.wipeAll()
        try keyVault.deleteMasterKey()
    }

    /// Returns a configured `OfflineSchemeHandler` to be registered on a WKWebView by Plan 4.
    ///
    /// `@MainActor` is required because `OfflineSchemeHandler` conforms to
    /// `WKURLSchemeHandler`, which is MainActor-isolated under Swift 6 strict
    /// concurrency. The rest of `OfflineService` stays unisolated since
    /// catalog/blob/keyvault operations don't touch UI.
    @MainActor
    public func makeSchemeHandler(deviceIdProvider: @escaping () -> String) -> OfflineSchemeHandler {
        return OfflineSchemeHandler(
            catalog: catalog, blobStore: blobStore, keyVault: keyVault,
            deviceIdProvider: deviceIdProvider
        )
    }
}

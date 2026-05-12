import XCTest
@testable import OfflineCore

final class OfflineDownloaderTests: XCTestCase {
    var rootURL: URL!
    var dbURL: URL!
    var catalog: OfflineCatalog!
    var blobStore: BlobStore!
    var vault: KeyVault!
    let serviceTag = "OfflineDownloaderTests.\(UUID().uuidString)"

    override func setUp() {
        super.setUp()
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        rootURL = base.appendingPathComponent("blobs")
        dbURL = base.appendingPathComponent("catalog.sqlite")
        try! FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        catalog = try! OfflineCatalog(databaseURL: dbURL)
        blobStore = try! BlobStore(rootDirectory: rootURL)
        vault = KeyVault(serviceTag: serviceTag)
    }

    override func tearDown() {
        try? vault.deleteMasterKey()
        super.tearDown()
    }

    func testIngestPersistsRowAndBlob() throws {
        let key = Data(repeating: 0x55, count: 32)
        let iv = Data(repeating: 0x66, count: 16)
        let plaintext = Data((0..<256).map { UInt8($0) })
        let ciphertext = try AESCTRDecryptor.decrypt(ciphertext: plaintext, key: key, baseIv: iv, blockIndex: 0)

        let jwt = makeLicense(trackId: "100:0:5", mid: 12345, deviceId: "d1", key: key, iv: iv)

        let tmpDownload = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try ciphertext.write(to: tmpDownload)

        let downloader = OfflineDownloader(catalog: catalog, blobStore: blobStore, keyVault: vault)
        try downloader.ingestCompletedDownload(
            tmpFileURL: tmpDownload,
            license: jwt,
            sizeBytes: Int64(ciphertext.count),
            metaJSON: "{\"title\":\"Track\"}"
        )

        let row = try XCTUnwrap(catalog.get(trackId: "100:0:5"))
        XCTAssertEqual(row.deviceId, "d1")
        XCTAssertEqual(row.sizeBytes, 256)
        XCTAssertEqual(row.trackIv, iv)
        XCTAssertTrue(FileManager.default.fileExists(atPath: row.blobPath))

        let unwrapped = try vault.unwrap(ciphertext: row.wrappedKey, nonce: row.wrapNonce)
        XCTAssertEqual(unwrapped, key)
    }

    func testIngestSizeMismatchRollsBack() throws {
        let key = Data(repeating: 1, count: 32)
        let iv = Data(repeating: 2, count: 16)
        let jwt = makeLicense(trackId: "x", mid: 1, deviceId: "d", key: key, iv: iv)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data([1, 2, 3]).write(to: tmp)

        let downloader = OfflineDownloader(catalog: catalog, blobStore: blobStore, keyVault: vault)
        XCTAssertThrowsError(try downloader.ingestCompletedDownload(
            tmpFileURL: tmp, license: jwt, sizeBytes: 999, metaJSON: nil
        ))
        XCTAssertNil(try catalog.get(trackId: "x"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: blobStore.blobPath(for: "x")))
    }

    private func makeLicense(trackId: String, mid: Int64, deviceId: String, key: Data, iv: Data) -> String {
        let iat = 1_777_000_000
        let exp = iat + 2_592_000
        let body: [String: Any] = [
            "trackId": trackId,
            "mid": mid,
            "deviceId": deviceId,
            "userId": "u",
            "key": key.base64EncodedString(),
            "iv":  iv.base64EncodedString(),
            "exp": exp,
            "iat": iat,
            "v": "offline-v1",
        ]
        let header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        let bodyData = try! JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        return "\(header).\(b64url(bodyData)).fakeSig"
    }
    private func b64url(_ d: Data) -> String {
        return d.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

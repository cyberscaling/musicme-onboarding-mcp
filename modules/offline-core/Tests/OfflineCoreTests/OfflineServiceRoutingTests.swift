import XCTest
@testable import OfflineCore

final class OfflineServiceRoutingTests: XCTestCase {

    func testOpenSource_returnsBlobSource_whenTrackInCatalog() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = try OfflineService(rootDirectory: root, keyVaultServiceTag: "rt.\(UUID().uuidString)")
        defer { try? service.wipeAll() }

        let key = Data(repeating: 1, count: 32)
        let iv = Data(repeating: 2, count: 16)
        let plain = Data(repeating: 0xAA, count: 32)
        let cipher = try AESCTRDecryptor.decrypt(ciphertext: plain, key: key, baseIv: iv, blockIndex: 0)
        let wrap = try service.keyVault.wrap(key: key)
        let path = service.blobStore.blobPath(for: "10:0:1")
        try cipher.write(to: URL(fileURLWithPath: path))
        try service.catalog.insert(.init(
            trackId: "10:0:1",
            deviceId: "d",
            blobPath: path,
            sizeBytes: 32,
            wrappedKey: wrap.ciphertext,
            wrapNonce: wrap.nonce,
            trackIv: iv,
            licenseExp: Int64.max,
            licenseIat: 0,
            downloadedAt: 0,
            metaJSON: nil,
            corrupted: false))

        let source = try service.openSource(
            ref: .init(cb: 10, disc: 0, track: 1),
            workerUrl: URL(string: "https://nope")!,
            tokenProvider: { "tok" })

        XCTAssertTrue(source is BlobSource)
        XCTAssertEqual(source.fileSize, 32)
    }

    func testOpenSource_returnsStreamSource_whenTrackAbsent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = try OfflineService(rootDirectory: root, keyVaultServiceTag: "rt.\(UUID().uuidString)")
        defer { try? service.wipeAll() }
        let source = try service.openSource(
            ref: .init(cb: 999, disc: 0, track: 1),
            workerUrl: URL(string: "https://nope")!,
            tokenProvider: { "tok" })
        XCTAssertTrue(source is StreamSource)
    }
}

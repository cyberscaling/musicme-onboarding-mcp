import XCTest
@testable import OfflineCore

final class ByteSourceTests: XCTestCase {

    func testBlobSourceDecryptsRangeFromBlob() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let catalog = try OfflineCatalog(databaseURL: dir.appendingPathComponent("c.sqlite"))
        let blobStore = try BlobStore(rootDirectory: dir.appendingPathComponent("b"))
        let vault = KeyVault(serviceTag: "tests.ByteSource.\(UUID().uuidString)")
        defer { try? vault.deleteMasterKey() }

        let key = Data(repeating: 0x11, count: 32)
        let iv = Data(repeating: 0x22, count: 16)
        let plaintext = Data((0..<256).map { UInt8($0) })
        let cipher = try AESCTRDecryptor.decrypt(ciphertext: plaintext, key: key, baseIv: iv, blockIndex: 0)
        let wrap = try vault.wrap(key: key)
        let path = blobStore.blobPath(for: "1:0:1")
        try cipher.write(to: URL(fileURLWithPath: path))

        let row = OfflineTrackRow(
            trackId: "1:0:1",
            deviceId: "dev",
            blobPath: path,
            sizeBytes: Int64(cipher.count),
            wrappedKey: wrap.ciphertext,
            wrapNonce: wrap.nonce,
            trackIv: iv,
            licenseExp: Int64.max,
            licenseIat: 0,
            downloadedAt: 0,
            metaJSON: nil,
            corrupted: false
        )
        try catalog.insert(row)

        let source = try BlobSource(trackId: "1:0:1", catalog: catalog, blobStore: blobStore, keyVault: vault)
        XCTAssertEqual(source.fileSize, 256)
        let slice = try await source.read(range: 5..<37)
        XCTAssertEqual(slice, plaintext.subdata(in: 5..<37))
    }
}

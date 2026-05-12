import XCTest
@testable import OfflineCore

final class OfflineServiceTests: XCTestCase {
    var serviceURL: URL!
    let serviceTag = "OfflineServiceTests.\(UUID().uuidString)"

    override func setUp() {
        super.setUp()
        serviceURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDown() {
        try? KeyVault(serviceTag: serviceTag).deleteMasterKey()
        super.tearDown()
    }

    func testEndToEndIngestAndList() throws {
        let svc = try OfflineService(rootDirectory: serviceURL, keyVaultServiceTag: serviceTag)

        let key = Data(repeating: 0x77, count: 32)
        let iv = Data(repeating: 0x88, count: 16)
        let plaintext = Data(repeating: 0xAB, count: 100)
        let ciphertext = try AESCTRDecryptor.decrypt(ciphertext: plaintext, key: key, baseIv: iv, blockIndex: 0)

        let license = makeLicense(trackId: "1:0:1", mid: 1, deviceId: "d", key: key, iv: iv)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try ciphertext.write(to: tmp)

        try svc.ingestDownload(tmpFileURL: tmp, license: license, sizeBytes: 100, metaJSON: "{}")

        let list = try svc.listTracks()
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list.first?.trackId, "1:0:1")
        XCTAssertTrue(try svc.hasTrack(trackId: "1:0:1"))
        XCTAssertFalse(try svc.hasTrack(trackId: "absent"))
    }

    func testWipeAllRemovesAll() throws {
        let svc = try OfflineService(rootDirectory: serviceURL, keyVaultServiceTag: serviceTag)
        let key = Data(repeating: 1, count: 32)
        let iv = Data(repeating: 2, count: 16)
        let plaintext = Data([1, 2, 3])
        let ciphertext = try AESCTRDecryptor.decrypt(ciphertext: plaintext, key: key, baseIv: iv, blockIndex: 0)
        let license = makeLicense(trackId: "x", mid: 1, deviceId: "d", key: key, iv: iv)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try ciphertext.write(to: tmp)
        try svc.ingestDownload(tmpFileURL: tmp, license: license, sizeBytes: 3, metaJSON: nil)

        try svc.wipeAll()
        XCTAssertEqual(try svc.listTracks().count, 0)
        XCTAssertFalse(try svc.hasTrack(trackId: "x"))
    }

    private func makeLicense(trackId: String, mid: Int64, deviceId: String, key: Data, iv: Data) -> String {
        let iat = 1_777_000_000
        let exp = iat + 2_592_000
        let body: [String: Any] = [
            "trackId": trackId, "mid": mid, "deviceId": deviceId, "userId": "u",
            "key": key.base64EncodedString(), "iv": iv.base64EncodedString(),
            "exp": exp, "iat": iat, "v": "offline-v1",
        ]
        let header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        let bodyData = try! JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        let b64 = bodyData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "\(header).\(b64).fakeSig"
    }
}

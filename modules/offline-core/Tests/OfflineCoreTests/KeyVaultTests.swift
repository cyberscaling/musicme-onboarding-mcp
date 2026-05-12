import XCTest
@testable import OfflineCore

final class KeyVaultTests: XCTestCase {
    let serviceTag = "OfflineCoreTests.\(UUID().uuidString)"

    override func tearDown() {
        try? KeyVault(serviceTag: serviceTag).deleteMasterKey()
        super.tearDown()
    }

    func testWrapUnwrapRoundTrip() throws {
        let vault = KeyVault(serviceTag: serviceTag)
        let trackKey = Data(repeating: 0xAB, count: 32)
        let wrapped = try vault.wrap(key: trackKey)
        XCTAssertNotEqual(wrapped.ciphertext, trackKey)
        XCTAssertEqual(wrapped.nonce.count, 12)
        let unwrapped = try vault.unwrap(ciphertext: wrapped.ciphertext, nonce: wrapped.nonce)
        XCTAssertEqual(unwrapped, trackKey)
    }

    func testWrappingTwiceProducesDifferentCiphertext() throws {
        let vault = KeyVault(serviceTag: serviceTag)
        let trackKey = Data(repeating: 0xCC, count: 32)
        let a = try vault.wrap(key: trackKey)
        let b = try vault.wrap(key: trackKey)
        XCTAssertNotEqual(a.nonce, b.nonce)
        XCTAssertNotEqual(a.ciphertext, b.ciphertext)
    }

    func testMasterKeyPersistsAcrossInstances() throws {
        let v1 = KeyVault(serviceTag: serviceTag)
        let trackKey = Data(repeating: 0xDD, count: 32)
        let wrapped = try v1.wrap(key: trackKey)

        let v2 = KeyVault(serviceTag: serviceTag)
        let unwrapped = try v2.unwrap(ciphertext: wrapped.ciphertext, nonce: wrapped.nonce)
        XCTAssertEqual(unwrapped, trackKey)
    }

    func testDeleteMasterKeyMakesFutureUnwrapFail() throws {
        let vault = KeyVault(serviceTag: serviceTag)
        let trackKey = Data(repeating: 0xEE, count: 32)
        let wrapped = try vault.wrap(key: trackKey)
        try vault.deleteMasterKey()
        XCTAssertThrowsError(try vault.unwrap(ciphertext: wrapped.ciphertext, nonce: wrapped.nonce))
    }
}

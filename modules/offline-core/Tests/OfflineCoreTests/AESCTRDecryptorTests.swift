import XCTest
import CryptoKit
@testable import OfflineCore

final class AESCTRDecryptorTests: XCTestCase {
    func testCounterForBlockBigEndianCarry() {
        // IV with all 0xFF in last byte should carry into next byte.
        var iv = Data(repeating: 0, count: 16)
        iv[15] = 0xFF
        let c = AESCTRDecryptor.counterForBlock(baseIv: iv, blockIndex: 1)
        XCTAssertEqual(c[15], 0x00)
        XCTAssertEqual(c[14], 0x01)
    }

    func testCounterForBlockSimple() {
        let iv = Data(repeating: 0, count: 16)
        let c = AESCTRDecryptor.counterForBlock(baseIv: iv, blockIndex: 5)
        XCTAssertEqual(c[15], 0x05)
        for i in 0..<15 { XCTAssertEqual(c[i], 0x00) }
    }

    func testDecryptRoundTripAlignedAtZero() throws {
        let key = Data(repeating: 0x11, count: 32)
        let iv = Data(repeating: 0x22, count: 16)
        let plaintext = (0..<1024).map { UInt8($0 & 0xFF) }
        let ciphertext = try encryptForFixture(key: key, iv: iv, blockIndex: 0, plaintext: Data(plaintext))

        let decrypted = try AESCTRDecryptor.decrypt(
            ciphertext: ciphertext, key: key, baseIv: iv, blockIndex: 0
        )
        XCTAssertEqual(decrypted, Data(plaintext))
    }

    func testDecryptUnalignedRange() throws {
        // Plaintext 64 bytes, request bytes 5..25 (worker aligns to block 0, wire is 26 bytes).
        let key = Data(repeating: 0x33, count: 32)
        let iv = Data(repeating: 0x44, count: 16)
        let plaintext = Data((0..<64).map { UInt8($0) })
        // Wire = AES-CTR(plaintext[0..<26], counter=0)
        let wire = try encryptForFixture(key: key, iv: iv, blockIndex: 0, plaintext: plaintext.prefix(26))
        // Decrypt wire, slice from skipBytes=5 → expect plaintext[5..<26]
        let plain = try AESCTRDecryptor.decrypt(ciphertext: wire, key: key, baseIv: iv, blockIndex: 0)
        let userSlice = plain.subdata(in: 5..<26)
        XCTAssertEqual(userSlice, plaintext.subdata(in: 5..<26))
    }

    /// AES-CTR is symmetric — encrypt and decrypt are the same operation.
    /// We reuse our decryptor to produce a fixture ciphertext.
    private func encryptForFixture(key: Data, iv: Data, blockIndex: Int, plaintext: Data) throws -> Data {
        return try AESCTRDecryptor.decrypt(ciphertext: plaintext, key: key, baseIv: iv, blockIndex: blockIndex)
    }
}

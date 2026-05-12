import XCTest
import OfflineCore
@testable import SASCore

final class OfflineCoreLinkTests: XCTestCase {
    func test_AESCTRDecryptor_isReachable_andSymmetric() throws {
        let key = Data((0..<32).map { UInt8($0) })
        let iv  = Data((0..<16).map { UInt8($0) })
        let plain = Data("Hello, secure world!".utf8)
        let cipher = try AESCTRDecryptor.decrypt(
            ciphertext: plain, key: key, baseIv: iv, blockIndex: 0
        )
        let back = try AESCTRDecryptor.decrypt(
            ciphertext: cipher, key: key, baseIv: iv, blockIndex: 0
        )
        XCTAssertEqual(back, plain)
    }

    func test_counterForBlock_carryAcrossByteBoundary() {
        var iv = Data(repeating: 0, count: 14)
        iv.append(contentsOf: [0xFF, 0xFF])
        let c = AESCTRDecryptor.counterForBlock(baseIv: iv, blockIndex: 1)
        XCTAssertEqual(c[15], 0)
        XCTAssertEqual(c[14], 0)
        XCTAssertEqual(c[13], 1)
    }
}

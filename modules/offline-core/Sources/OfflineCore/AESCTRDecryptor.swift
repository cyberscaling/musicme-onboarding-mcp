import Foundation
import CommonCrypto

public enum AESCTRDecryptor {
    public static let blockSize = 16

    /// Big-endian counter = baseIv (interpreted as 128-bit BE integer) + blockIndex.
    /// Mirrors `counterForBlock` in `worker/src/lib/crypto.ts`.
    public static func counterForBlock(baseIv: Data, blockIndex: Int) -> Data {
        precondition(baseIv.count == blockSize, "baseIv must be 16 bytes")
        var out = Array(baseIv)
        var carry = blockIndex
        var i = blockSize - 1
        while i >= 0 && carry > 0 {
            let sum = Int(out[i]) + (carry & 0xff)
            out[i] = UInt8(sum & 0xff)
            carry = (carry >> 8) + (sum >> 8)
            i -= 1
        }
        return Data(out)
    }

    /// AES-CTR symmetric encrypt/decrypt. `blockIndex` indicates the counter offset
    /// for the first byte of `ciphertext`. The output has the same length as input.
    public static func decrypt(
        ciphertext: Data, key: Data, baseIv: Data, blockIndex: Int
    ) throws -> Data {
        precondition(key.count == 32, "key must be 32 bytes (AES-256)")
        precondition(baseIv.count == blockSize, "baseIv must be 16 bytes")

        let counter = counterForBlock(baseIv: baseIv, blockIndex: blockIndex)
        var out = Data(count: ciphertext.count)
        var cryptor: CCCryptorRef?

        let status = key.withUnsafeBytes { keyPtr in
            counter.withUnsafeBytes { ivPtr in
                CCCryptorCreateWithMode(
                    CCOperation(kCCEncrypt),                  // CTR is symmetric — use encrypt for both
                    CCMode(kCCModeCTR),
                    CCAlgorithm(kCCAlgorithmAES),
                    CCPadding(ccNoPadding),
                    ivPtr.baseAddress,
                    keyPtr.baseAddress, key.count,
                    nil, 0, 0,
                    CCModeOptions(kCCModeOptionCTR_BE),
                    &cryptor
                )
            }
        }
        guard status == kCCSuccess, let c = cryptor else {
            throw OfflineError.ioError("CCCryptorCreate failed: \(status)")
        }
        defer { CCCryptorRelease(c) }

        var moved = 0
        let updateStatus = ciphertext.withUnsafeBytes { ctPtr in
            out.withUnsafeMutableBytes { outPtr in
                CCCryptorUpdate(
                    c,
                    ctPtr.baseAddress, ciphertext.count,
                    outPtr.baseAddress, ciphertext.count,
                    &moved
                )
            }
        }
        guard updateStatus == kCCSuccess else {
            throw OfflineError.ioError("CCCryptorUpdate failed: \(updateStatus)")
        }
        return out.prefix(moved)
    }
}

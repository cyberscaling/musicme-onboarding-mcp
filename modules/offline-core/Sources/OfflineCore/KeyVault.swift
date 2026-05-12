import Foundation
import CryptoKit
import Security

public struct WrappedKey {
    public let ciphertext: Data    // AES-GCM ciphertext + tag combined
    public let nonce: Data         // 12 bytes
}

public final class KeyVault {
    /// Keychain service identifier — defaults to `cc.musicme.offline.master.v1`.
    /// Tests override to isolate state per test run.
    private let serviceTag: String

    public init(serviceTag: String = "cc.musicme.offline.master.v1") {
        self.serviceTag = serviceTag
    }

    public func wrap(key trackKey: Data) throws -> WrappedKey {
        let masterKey = try loadOrCreateMasterKey()
        let sealed = try AES.GCM.seal(trackKey, using: masterKey)
        guard let combined = sealed.combined else {
            throw OfflineError.keyUnwrapFailed
        }
        // `combined` = nonce || ciphertext || tag. Split nonce out for storage clarity.
        let nonceData = Data(sealed.nonce)
        let ctAndTag = combined.suffix(combined.count - 12)
        return WrappedKey(ciphertext: ctAndTag, nonce: nonceData)
    }

    public func unwrap(ciphertext: Data, nonce: Data) throws -> Data {
        let masterKey = try loadOrCreateMasterKey()
        let gcmNonce = try AES.GCM.Nonce(data: nonce)
        // Split ciphertext+tag — AES-GCM tag is the last 16 bytes.
        guard ciphertext.count >= 16 else { throw OfflineError.keyUnwrapFailed }
        let tag = ciphertext.suffix(16)
        let body = ciphertext.prefix(ciphertext.count - 16)
        let sealed = try AES.GCM.SealedBox(nonce: gcmNonce, ciphertext: body, tag: tag)
        return try AES.GCM.open(sealed, using: masterKey)
    }

    public func deleteMasterKey() throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: serviceTag,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw OfflineError.keyVaultUnavailable
        }
    }

    // MARK: - Internal

    private func loadOrCreateMasterKey() throws -> SymmetricKey {
        if let existing = try loadMasterKey() {
            return existing
        }
        let new = SymmetricKey(size: .bits256)
        try saveMasterKey(new)
        return new
    }

    private func loadMasterKey() throws -> SymmetricKey? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: serviceTag,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw OfflineError.keyVaultUnavailable
        }
        return SymmetricKey(data: data)
    }

    private func saveMasterKey(_ key: SymmetricKey) throws {
        let data = key.withUnsafeBytes { Data($0) }
        let attrs: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: serviceTag,
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw OfflineError.keyVaultUnavailable
        }
    }
}

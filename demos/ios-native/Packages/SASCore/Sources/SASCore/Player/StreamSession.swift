import Foundation

/// Streaming session metadata. The key and IV are decoded once at construction
/// time so the hot decrypt path stays on Data (matches OfflineCore's API).
public struct StreamSession: Sendable, Equatable {
    public let sessionId: String
    public let fileSize: Int
    public let key: Data   // 32 bytes (AES-256)
    public let baseIv: Data  // 16 bytes

    public enum DecodeError: Error, Equatable {
        case invalidKey
        case invalidIV
    }

    public init(sessionId: String, fileSize: Int, key: Data, baseIv: Data) throws {
        guard key.count == 32 else { throw DecodeError.invalidKey }
        guard baseIv.count == 16 else { throw DecodeError.invalidIV }
        self.sessionId = sessionId
        self.fileSize = fileSize
        self.key = key
        self.baseIv = baseIv
    }

    public init(sessionId: String, fileSize: Int, keyB64: String, ivB64: String) throws {
        guard let k = Data(base64Encoded: keyB64) else { throw DecodeError.invalidKey }
        guard let iv = Data(base64Encoded: ivB64) else { throw DecodeError.invalidIV }
        try self.init(sessionId: sessionId, fileSize: fileSize, key: k, baseIv: iv)
    }
}

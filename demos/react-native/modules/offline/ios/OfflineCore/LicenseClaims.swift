import Foundation

public struct LicenseClaims: Equatable {
    public let trackId: String
    public let mid: Int64
    public let deviceId: String
    public let userId: String
    public let key: Data    // 32 bytes (AES-256)
    public let iv: Data     // 16 bytes (AES-CTR base IV)
    public let exp: Int64   // unix seconds
    public let iat: Int64
    public let v: String

    public static let supportedVersion = "offline-v1"

    public static func decode(jwt: String) throws -> LicenseClaims {
        let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { throw OfflineError.malformedLicense }

        let body = String(parts[1])
        guard let bodyData = base64URLDecode(body),
              let json = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        else { throw OfflineError.malformedLicense }

        guard
            let trackId = json["trackId"] as? String,
            let mid = (json["mid"] as? Int).map(Int64.init) ?? (json["mid"] as? Int64),
            let deviceId = json["deviceId"] as? String,
            let userId = json["userId"] as? String,
            let keyB64 = json["key"] as? String,
            let ivB64 = json["iv"] as? String,
            let exp = (json["exp"] as? Int).map(Int64.init) ?? (json["exp"] as? Int64),
            let iat = (json["iat"] as? Int).map(Int64.init) ?? (json["iat"] as? Int64),
            let v = json["v"] as? String,
            let key = Data(base64Encoded: keyB64),
            let iv = Data(base64Encoded: ivB64)
        else { throw OfflineError.malformedLicense }

        guard key.count == 32 else { throw OfflineError.malformedLicense }
        guard iv.count == 16 else { throw OfflineError.malformedLicense }
        guard v == supportedVersion else { throw OfflineError.unsupportedLicenseVersion }

        return LicenseClaims(
            trackId: trackId, mid: mid, deviceId: deviceId, userId: userId,
            key: key, iv: iv, exp: exp, iat: iat, v: v
        )
    }
}

func base64URLDecode(_ input: String) -> Data? {
    var s = input
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let pad = (4 - s.count % 4) % 4
    s.append(String(repeating: "=", count: pad))
    return Data(base64Encoded: s)
}

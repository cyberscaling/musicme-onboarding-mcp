import Foundation

public enum OfflineError: Error, Equatable {
    case malformedLicense
    case unsupportedLicenseVersion
    case licenseExpired
    case deviceIdMismatch
    case trackNotFound
    case keyVaultUnavailable
    case keyUnwrapFailed
    case blobCorrupted
    case rangeOutOfBounds
    case downloadFailed(status: Int)
    case sqliteError(String)
    case ioError(String)

    // Streaming-specific.
    case sessionUnauthorized
    case sessionFingerprintMismatch
    case sessionInitFailed(status: Int)
    case streamRangeFailed(status: Int)
    case streamMalformedResponse(String)
    case streamNetworkExhausted(String)
}

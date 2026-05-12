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
}

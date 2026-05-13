package cc.musicme.offline

sealed class OfflineError : RuntimeException() {
    object MalformedLicense : OfflineError()
    object UnsupportedLicenseVersion : OfflineError()
    object LicenseExpired : OfflineError()
    object DeviceIdMismatch : OfflineError()
    object TrackNotFound : OfflineError()
    object KeyVaultUnavailable : OfflineError()
    object KeyUnwrapFailed : OfflineError()
    object BlobCorrupted : OfflineError()
    object RangeOutOfBounds : OfflineError()
    data class DownloadFailed(val status: Int) : OfflineError()
    data class SqliteError(val msg: String) : OfflineError()
    data class IoError(val msg: String) : OfflineError()

    // Streaming-specific.
    object SessionUnauthorized : OfflineError()
    object SessionFingerprintMismatch : OfflineError()
    data class SessionInitFailed(val status: Int) : OfflineError()
    data class StreamRangeFailed(val status: Int) : OfflineError()
    data class StreamMalformedResponse(val where: String) : OfflineError()
    data class StreamNetworkExhausted(val detail: String) : OfflineError()
}

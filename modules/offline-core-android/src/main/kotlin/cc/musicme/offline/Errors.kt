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
}

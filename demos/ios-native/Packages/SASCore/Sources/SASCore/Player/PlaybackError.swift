import Foundation

public enum PlaybackError: Error, Equatable, Sendable {
    case sessionExpired
    case streamUnavailable(httpStatus: Int)
    case streamFetch(message: String)
    case decrypt(message: String)
    case playbackFailed(message: String)
    case jwtUnavailable
}

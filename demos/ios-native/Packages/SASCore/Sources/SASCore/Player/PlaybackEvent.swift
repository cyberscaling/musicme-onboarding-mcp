import Foundation

public enum PlaybackEvent: Sendable {
    case loading
    case canplay(duration: TimeInterval)
    case timeUpdate(elapsed: TimeInterval, duration: TimeInterval)
    case ended
    case error(PlaybackError)
}

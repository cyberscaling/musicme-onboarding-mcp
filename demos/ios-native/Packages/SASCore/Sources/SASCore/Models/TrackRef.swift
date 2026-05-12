import Foundation

public struct TrackRef: Codable, Hashable, Sendable {
    public let cb: String
    public let disc: Int
    public let track: Int

    public init(cb: String, disc: Int, track: Int) {
        self.cb = cb
        self.disc = disc
        self.track = track
    }
}

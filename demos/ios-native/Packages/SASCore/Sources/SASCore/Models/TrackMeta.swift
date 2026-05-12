import Foundation

public struct TrackMeta: Codable, Hashable, Sendable {
    public let title: String
    public let artist: String
    public let coverURL: URL?
    public let durationMs: Int?

    public init(title: String, artist: String, coverURL: URL?, durationMs: Int?) {
        self.title = title
        self.artist = artist
        self.coverURL = coverURL
        self.durationMs = durationMs
    }
}

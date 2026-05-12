import Foundation

public protocol OfflineStore: Sendable {
    /// Returns a local file URL if the track has been cached offline, nil otherwise.
    func localURL(for track: TrackRef) async -> URL?
}

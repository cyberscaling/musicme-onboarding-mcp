import Foundation

public struct NoopOfflineStore: OfflineStore {
    public init() {}
    public func localURL(for track: TrackRef) async -> URL? { nil }
}

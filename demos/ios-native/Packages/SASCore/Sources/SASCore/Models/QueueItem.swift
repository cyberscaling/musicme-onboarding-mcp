import Foundation

public struct QueueItem: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let ref: TrackRef
    public let meta: TrackMeta

    public init(id: UUID = UUID(), ref: TrackRef, meta: TrackMeta) {
        self.id = id
        self.ref = ref
        self.meta = meta
    }
}

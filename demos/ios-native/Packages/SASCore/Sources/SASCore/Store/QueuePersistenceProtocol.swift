import Foundation

public protocol QueuePersistence: Sendable {
    func load() async -> [QueueItem]
    func save(_ items: [QueueItem]) async
    func clear() async
}

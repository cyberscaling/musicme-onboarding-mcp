import Foundation
@testable import SASCore

actor FakeQueuePersistence: QueuePersistence {
    private(set) var items: [QueueItem] = []
    private(set) var saveCalls = 0

    func load() async -> [QueueItem] { items }
    func save(_ items: [QueueItem]) async {
        self.items = items
        saveCalls += 1
    }
    func clear() async {
        items = []
    }

    func preload(_ items: [QueueItem]) async {
        self.items = items
    }
}

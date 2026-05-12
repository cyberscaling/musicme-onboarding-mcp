import Foundation
import SASCore
import os

public actor UserDefaultsQueuePersistence: QueuePersistence {
    public static let key = "cc.musicme.sasdemo.ios.queue.v1"

    private let defaults: UserDefaults
    private let log = Logger(subsystem: "cc.musicme.sasdemo.ios", category: "persistence")

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() async -> [QueueItem] {
        guard let data = defaults.data(forKey: Self.key) else { return [] }
        do {
            return try JSONDecoder().decode([QueueItem].self, from: data)
        } catch {
            log.error("corrupted queue JSON: \(error.localizedDescription, privacy: .public). Resetting.")
            defaults.removeObject(forKey: Self.key)
            return []
        }
    }

    public func save(_ items: [QueueItem]) async {
        guard let data = try? JSONEncoder().encode(items) else { return }
        defaults.set(data, forKey: Self.key)
    }

    public func clear() async {
        defaults.removeObject(forKey: Self.key)
    }
}

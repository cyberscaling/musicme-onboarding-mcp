import Foundation

public struct RemoteHandlers: Sendable {
    public let play: @Sendable () -> Void
    public let pause: @Sendable () -> Void
    public let toggle: @Sendable () -> Void
    public let next: @Sendable () -> Void
    public let prev: @Sendable () -> Void
    public let seek: @Sendable (TimeInterval) -> Void

    public init(
        play: @escaping @Sendable () -> Void,
        pause: @escaping @Sendable () -> Void,
        toggle: @escaping @Sendable () -> Void,
        next: @escaping @Sendable () -> Void,
        prev: @escaping @Sendable () -> Void,
        seek: @escaping @Sendable (TimeInterval) -> Void
    ) {
        self.play = play
        self.pause = pause
        self.toggle = toggle
        self.next = next
        self.prev = prev
        self.seek = seek
    }
}

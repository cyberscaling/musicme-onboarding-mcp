import SwiftUI

public struct MiniBar: View {
    let title: String
    let artist: String
    let coverURL: URL?
    let playing: Bool
    let onTogglePlay: () -> Void
    let onPrev: () -> Void
    let onNext: () -> Void
    let onOpenPlayer: () -> Void
    let onOpenQueue: () -> Void

    public init(
        title: String, artist: String, coverURL: URL?,
        playing: Bool,
        onTogglePlay: @escaping () -> Void,
        onPrev: @escaping () -> Void,
        onNext: @escaping () -> Void,
        onOpenPlayer: @escaping () -> Void,
        onOpenQueue: @escaping () -> Void
    ) {
        self.title = title; self.artist = artist; self.coverURL = coverURL
        self.playing = playing
        self.onTogglePlay = onTogglePlay; self.onPrev = onPrev; self.onNext = onNext
        self.onOpenPlayer = onOpenPlayer; self.onOpenQueue = onOpenQueue
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Cover(url: coverURL, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline).lineLimit(1)
                    Text(artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture(perform: onOpenPlayer)
                Button(action: onOpenQueue) { Image(systemName: "list.bullet") }
                    .buttonStyle(.borderless)
            }
            HStack(spacing: 24) {
                Button(action: onPrev) { Image(systemName: "backward.fill") }
                Button(action: onTogglePlay) {
                    Image(systemName: playing ? "pause.fill" : "play.fill").font(.title3)
                }
                Button(action: onNext) { Image(systemName: "forward.fill") }
            }
            .buttonStyle(.borderless)
            .padding(.bottom, 4)
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .background(.bar)
    }
}

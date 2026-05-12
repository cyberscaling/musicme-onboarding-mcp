import SwiftUI

public struct TrackRow: View {
    let number: Int
    let title: String
    let artist: String
    let durationMs: Int?
    let isPlaying: Bool
    let onTap: () -> Void
    let onEnqueue: () -> Void

    public init(
        number: Int, title: String, artist: String, durationMs: Int?,
        isPlaying: Bool, onTap: @escaping () -> Void, onEnqueue: @escaping () -> Void
    ) {
        self.number = number; self.title = title; self.artist = artist
        self.durationMs = durationMs; self.isPlaying = isPlaying
        self.onTap = onTap; self.onEnqueue = onEnqueue
    }

    public var body: some View {
        HStack(spacing: 12) {
            if isPlaying {
                Image(systemName: "waveform").foregroundStyle(.tint).frame(width: 24)
            } else {
                Text("\(number)").frame(width: 24).foregroundStyle(.secondary).font(.callout)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).lineLimit(1)
                Text(artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if let ms = durationMs {
                Text(formatMs(ms)).foregroundStyle(.secondary).font(.caption.monospacedDigit())
            }
            Button(action: onEnqueue) {
                Image(systemName: "plus.circle")
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }

    private func formatMs(_ ms: Int) -> String {
        let s = ms / 1000
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

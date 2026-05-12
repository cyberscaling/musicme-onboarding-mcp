import SwiftUI

/// Pure presentational atom — no inner Button. Wrap in NavigationLink or
/// Button at the call site so taps aren't swallowed by nested controls.
public struct AlbumCard: View {
    let title: String
    let artist: String
    let coverURL: URL?

    public init(title: String, artist: String, coverURL: URL?, onTap: @escaping () -> Void = {}) {
        self.title = title; self.artist = artist
        self.coverURL = coverURL
        _ = onTap   // kept for source compatibility; unused
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Cover(url: coverURL, size: 140)
            Text(title).font(.subheadline).lineLimit(1)
            Text(artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(width: 140)
    }
}

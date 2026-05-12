import SwiftUI

public struct Cover: View {
    let url: URL?
    let size: CGFloat

    public init(url: URL?, size: CGFloat = 64) {
        self.url = url
        self.size = size
    }

    public var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().aspectRatio(contentMode: .fill)
            default:
                Rectangle().fill(Color.gray.opacity(0.2))
                    .overlay(Image(systemName: "music.note").foregroundStyle(.secondary))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

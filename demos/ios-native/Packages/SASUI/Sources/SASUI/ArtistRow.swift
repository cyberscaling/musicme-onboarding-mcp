import SwiftUI

public struct ArtistRow: View {
    let name: String

    public init(name: String, onTap: @escaping () -> Void = {}) {
        self.name = name
        _ = onTap
    }

    public var body: some View {
        HStack {
            Image(systemName: "person.crop.circle").font(.title2).foregroundStyle(.secondary)
            Text(name)
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .padding(.vertical, 8)
    }
}

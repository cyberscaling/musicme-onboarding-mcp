import SwiftUI

public struct StyleChip: View {
    let name: String

    public init(name: String, onTap: @escaping () -> Void = {}) {
        self.name = name
        _ = onTap
    }

    public var body: some View {
        Text(name)
            .font(.subheadline)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.accentColor.opacity(0.15), in: Capsule())
    }
}

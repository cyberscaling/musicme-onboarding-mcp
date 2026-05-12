import SwiftUI

public struct TopNav: View {
    let title: String
    let onBack: (() -> Void)?
    let onLogout: (() -> Void)?

    public init(title: String, onBack: (() -> Void)? = nil, onLogout: (() -> Void)? = nil) {
        self.title = title; self.onBack = onBack; self.onLogout = onLogout
    }

    public var body: some View {
        HStack {
            if let onBack {
                Button(action: onBack) { Image(systemName: "chevron.left") }
            }
            Spacer()
            Text(title).font(.headline)
            Spacer()
            if let onLogout {
                Button(action: onLogout) { Image(systemName: "person.crop.circle") }
            }
        }
        .padding(.horizontal)
        .frame(height: 44)
    }
}

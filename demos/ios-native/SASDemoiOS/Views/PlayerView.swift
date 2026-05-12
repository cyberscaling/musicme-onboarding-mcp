import SwiftUI
import AVKit
import SASCore
import SASUI

struct PlayerView: View {
    let store: PlayerStore
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Button(action: dismiss) {
                    Image(systemName: "chevron.down").font(.title3)
                }
                Spacer()
                AirPlayButton().frame(width: 32, height: 32)
            }
            .padding()

            Cover(url: store.track?.coverURL, size: 280)
                .shadow(radius: 12)
                .padding(.horizontal, 32)

            VStack(spacing: 6) {
                Text(store.track?.title ?? "").font(.title2.bold()).lineLimit(2).multilineTextAlignment(.center)
                Text(store.track?.artist ?? "").foregroundStyle(.secondary)
            }

            VStack {
                Slider(
                    value: Binding(
                        get: { store.currentTime },
                        set: { store.seek($0) }
                    ),
                    in: 0...max(1, store.duration)
                )
                HStack {
                    Text(timeString(store.currentTime)).font(.caption.monospacedDigit())
                    Spacer()
                    Text(timeString(store.duration)).font(.caption.monospacedDigit())
                }
            }
            .padding(.horizontal)

            HStack(spacing: 40) {
                Button { store.prev() } label: { Image(systemName: "backward.fill").font(.title) }
                Button { store.togglePlayback() } label: {
                    Image(systemName: store.playing ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 64))
                }
                Button { store.next() } label: { Image(systemName: "forward.fill").font(.title) }
            }

            Spacer()
        }
        .padding(.vertical)
    }

    private func timeString(_ t: TimeInterval) -> String {
        guard t.isFinite, t >= 0 else { return "0:00" }
        let s = Int(t)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.activeTintColor = .systemBlue
        v.tintColor = .label
        return v
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

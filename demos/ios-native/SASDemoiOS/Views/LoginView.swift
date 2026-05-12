import SwiftUI
import SASCore

struct LoginView: View {
    @Environment(\.appContainer) private var container
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    let onSuccess: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("SAS Demo").font(.largeTitle).bold()
            Text("Connectez-vous pour commencer").foregroundStyle(.secondary)
            TextField("Identifiant", text: $username)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            SecureField("Mot de passe", text: $password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
            if let error {
                Text(error).foregroundStyle(.red).font(.callout)
            }
            Button {
                Task { await login() }
            } label: {
                if busy { ProgressView() }
                else { Text("Se connecter").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || username.isEmpty || password.isEmpty)
        }
        .padding(24)
    }

    private func login() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await container.api.auth.login(username: username, password: password)
            onSuccess()
        } catch APIError.unauthorized {
            self.error = "Identifiants invalides"
        } catch {
            self.error = "Erreur réseau"
        }
    }
}

import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { api, ApiError } from '@/lib/api'

export default function Login() {
  const [username, setUsername] = useState('alice')
  const [password, setPassword] = useState('wonderland')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.login(username.trim(), password.trim())
      router.replace('/search')
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network_error'
      setError(code)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Demo login</Text>
      <Text style={styles.muted}>Cookie-based session against webapp.</Text>

      <Text style={styles.label}>username</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />

      <Text style={styles.label}>password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        editable={!busy}
      />

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.btn, (busy || pressed) && styles.btnPressed]}
        onPress={submit}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.btnText}>sign in</Text>}
      </Pressable>

      {error ? <Text style={styles.err}>error: {error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, backgroundColor: '#000' },
  title: { color: '#eee', fontSize: 22, fontWeight: '600', marginBottom: 4 },
  muted: { color: '#777', fontSize: 12, marginBottom: 24 },
  label: { color: '#aaa', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    color: '#eee',
    padding: 12,
    borderRadius: 6,
    fontSize: 16,
  },
  btn: {
    marginTop: 24,
    backgroundColor: '#eee',
    padding: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.7 },
  btnText: { color: '#000', fontWeight: '600' },
  err: { color: '#ff6666', marginTop: 16, fontFamily: 'Menlo' },
})

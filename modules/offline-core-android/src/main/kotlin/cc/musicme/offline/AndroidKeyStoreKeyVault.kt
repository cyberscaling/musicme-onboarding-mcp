package cc.musicme.offline

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Production [KeyVault] backed by AndroidKeyStore. Hardware-backed on devices
 * with Secure Enclave or StrongBox.
 *
 * NOT exercised by Robolectric unit tests — the AndroidKeyStore provider is
 * unavailable on the JVM. Plan 4 will add instrumented tests that run on an
 * emulator/device to exercise this path.
 */
class AndroidKeyStoreKeyVault(
    private val alias: String = "cc.musicme.offline.master.v1"
) : KeyVault {

    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    override fun wrap(trackKey: ByteArray): WrappedKey {
        val master = loadOrCreateMasterKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, master)
        val ciphertext = cipher.doFinal(trackKey)
        val nonce = cipher.iv
        return WrappedKey(ciphertext = ciphertext, nonce = nonce)
    }

    override fun unwrap(ciphertext: ByteArray, nonce: ByteArray): ByteArray {
        val master = loadOrCreateMasterKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, master, GCMParameterSpec(128, nonce))
        return cipher.doFinal(ciphertext)
    }

    override fun deleteMasterKey() {
        if (keyStore.containsAlias(alias)) {
            keyStore.deleteEntry(alias)
        }
    }

    private fun loadOrCreateMasterKey(): SecretKey {
        keyStore.getKey(alias, null)?.let { return it as SecretKey }
        return generateMasterKey()
    }

    private fun generateMasterKey(): SecretKey {
        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false)
            .build()
        kg.init(spec)
        return kg.generateKey()
    }
}

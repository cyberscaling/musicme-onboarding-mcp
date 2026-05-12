package cc.musicme.offline

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Process-local [KeyVault] for unit tests. The master key lives in memory
 * for the lifetime of this instance; `deleteMasterKey()` rotates the master
 * (making any previously-wrapped data unrecoverable, matching the contract).
 *
 * Production code should always use [AndroidKeyStoreKeyVault].
 */
class InMemoryKeyVault : KeyVault {

    @Volatile
    private var masterKey: SecretKey = generateMaster()

    override fun wrap(trackKey: ByteArray): WrappedKey {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        // Generate a fresh 12-byte nonce; can't rely on Cipher to allocate one
        // because BouncyCastle/JCE provider behavior varies.
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        cipher.init(Cipher.ENCRYPT_MODE, masterKey, GCMParameterSpec(128, nonce))
        val ciphertext = cipher.doFinal(trackKey)
        return WrappedKey(ciphertext = ciphertext, nonce = nonce)
    }

    override fun unwrap(ciphertext: ByteArray, nonce: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, masterKey, GCMParameterSpec(128, nonce))
        return cipher.doFinal(ciphertext)
    }

    override fun deleteMasterKey() {
        masterKey = generateMaster()
    }

    private fun generateMaster(): SecretKey {
        val kg = KeyGenerator.getInstance("AES")
        kg.init(256)
        return kg.generateKey()
    }
}

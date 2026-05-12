package cc.musicme.offline

import org.junit.Assert.*
import org.junit.Test

/**
 * Exercises the [KeyVault] contract using the [InMemoryKeyVault] fake.
 * AndroidKeyStoreKeyVault is verified by instrumented tests (Plan 4).
 */
class KeyVaultTest {

    @Test
    fun wrapUnwrapRoundTrip() {
        val vault = InMemoryKeyVault()
        val trackKey = ByteArray(32) { 0xAB.toByte() }
        val wrapped = vault.wrap(trackKey)
        assertFalse(wrapped.ciphertext.contentEquals(trackKey))
        assertEquals(12, wrapped.nonce.size)
        val unwrapped = vault.unwrap(wrapped.ciphertext, wrapped.nonce)
        assertArrayEquals(trackKey, unwrapped)
    }

    @Test
    fun wrappingTwiceProducesDifferentCiphertext() {
        val vault = InMemoryKeyVault()
        val trackKey = ByteArray(32) { 0xCC.toByte() }
        val a = vault.wrap(trackKey)
        val b = vault.wrap(trackKey)
        assertFalse(a.nonce.contentEquals(b.nonce))
        assertFalse(a.ciphertext.contentEquals(b.ciphertext))
    }

    @Test
    fun masterKeyPersistsWithinInstance() {
        // Same instance — wrap then unwrap works.
        val vault = InMemoryKeyVault()
        val trackKey = ByteArray(32) { 0xDD.toByte() }
        val wrapped = vault.wrap(trackKey)
        val unwrapped = vault.unwrap(wrapped.ciphertext, wrapped.nonce)
        assertArrayEquals(trackKey, unwrapped)
    }

    @Test
    fun deleteMasterKeyMakesFutureUnwrapFail() {
        val vault = InMemoryKeyVault()
        val trackKey = ByteArray(32) { 0xEE.toByte() }
        val wrapped = vault.wrap(trackKey)
        vault.deleteMasterKey()
        try {
            vault.unwrap(wrapped.ciphertext, wrapped.nonce)
            fail("should throw — old wrapped data must not decrypt under a fresh master")
        } catch (e: Exception) {
            // expected: GCM tag verification fails under the new master
        }
    }
}

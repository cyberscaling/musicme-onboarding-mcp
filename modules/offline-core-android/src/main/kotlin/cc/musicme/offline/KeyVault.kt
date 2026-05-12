package cc.musicme.offline

data class WrappedKey(
    val ciphertext: ByteArray,
    val nonce: ByteArray
) {
    // Default data-class equals/hashCode would compare array refs — override.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is WrappedKey) return false
        return ciphertext.contentEquals(other.ciphertext) && nonce.contentEquals(other.nonce)
    }
    override fun hashCode(): Int = 31 * ciphertext.contentHashCode() + nonce.contentHashCode()
}

interface KeyVault {
    fun wrap(trackKey: ByteArray): WrappedKey
    fun unwrap(ciphertext: ByteArray, nonce: ByteArray): ByteArray
    fun deleteMasterKey()
}

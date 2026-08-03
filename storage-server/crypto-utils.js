import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const SECRET_PASSPHRASE = process.env.ENCRYPTION_SECRET || 'practical-umodoc-secret-key-2026'

// Derive a secure 32-byte (256-bit) key using scrypt
const ENCRYPTION_KEY = crypto.scryptSync(SECRET_PASSPHRASE, 'practical-umodoc-salt', 32)

/**
 * Encrypts an object payload using AES-256-GCM
 * @param {object} payload - Data object to encrypt
 * @returns {string} Encrypted JSON envelope containing iv, encryptedData, and authTag
 */
export function encryptPayload(payload) {
  const text = JSON.stringify(payload)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
  
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')

  return JSON.stringify({
    iv: iv.toString('hex'),
    encryptedData: encrypted,
    authTag,
    encryptedAt: new Date().toISOString(),
  })
}

/**
 * Decrypts an encrypted JSON envelope back into the original object payload
 * @param {string} encryptedEnvelopeJson - Encrypted envelope string
 * @returns {object} Decrypted object payload
 */
export function decryptPayload(encryptedEnvelopeJson) {
  const envelope = typeof encryptedEnvelopeJson === 'string' 
    ? JSON.parse(encryptedEnvelopeJson) 
    : encryptedEnvelopeJson

  const { iv, encryptedData, authTag } = envelope
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return JSON.parse(decrypted)
}

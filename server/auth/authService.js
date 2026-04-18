import jwt from 'jsonwebtoken'
import bcryptjs from 'bcryptjs'
import { randomUUID, createHash } from 'node:crypto'

const JWT_SECRET = String(process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production').trim()
const JWT_REFRESH_SECRET = String(process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production').trim()
const JWT_EXPIRATION = String(process.env.JWT_EXPIRATION || '15m').trim() // 15 minutes
const REFRESH_TOKEN_EXPIRATION = String(process.env.REFRESH_TOKEN_EXPIRATION || '7d').trim() // 7 days
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10)

/**
 * Hash a password using bcryptjs
 */
export const hashPassword = async (password) => {
  try {
    return await bcryptjs.hash(password, BCRYPT_ROUNDS)
  } catch (error) {
    throw new Error(`Failed to hash password: ${error.message}`)
  }
}

/**
 * Compare a plain password with its hash
 */
export const comparePassword = async (password, hash) => {
  try {
    return await bcryptjs.compare(password, hash)
  } catch (error) {
    throw new Error(`Failed to compare password: ${error.message}`)
  }
}

/**
 * Generate a JWT access token
 */
export const generateAccessToken = (userId, email) => {
  try {
    return jwt.sign(
      {
        sub: userId,
        email: email,
        type: 'access',
      },
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRATION,
        issuer: 'dc-editor',
        audience: 'dc-editor-client',
      }
    )
  } catch (error) {
    throw new Error(`Failed to generate access token: ${error.message}`)
  }
}

/**
 * Generate a JWT refresh token
 */
export const generateRefreshToken = (userId) => {
  try {
    return jwt.sign(
      {
        sub: userId,
        type: 'refresh',
        jti: randomUUID(),
      },
      JWT_REFRESH_SECRET,
      {
        expiresIn: REFRESH_TOKEN_EXPIRATION,
        issuer: 'dc-editor',
        audience: 'dc-editor-client',
      }
    )
  } catch (error) {
    throw new Error(`Failed to generate refresh token: ${error.message}`)
  }
}

/**
 * Verify an access token
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'dc-editor',
      audience: 'dc-editor-client',
    })
  } catch (error) {
    throw new Error(`Invalid access token: ${error.message}`)
  }
}

/**
 * Verify a refresh token
 */
export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET, {
      issuer: 'dc-editor',
      audience: 'dc-editor-client',
    })
  } catch (error) {
    throw new Error(`Invalid refresh token: ${error.message}`)
  }
}

/**
 * Hash a refresh token for storage in database
 */
export const hashRefreshToken = (token) => {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Validate password strength
 */
export const validatePasswordStrength = (password) => {
  const errors = []
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number')
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Validate email format
 */
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export default {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashRefreshToken,
  validatePasswordStrength,
  validateEmail,
}

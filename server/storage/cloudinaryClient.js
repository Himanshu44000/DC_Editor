import { v2 as cloudinary } from 'cloudinary';

/**
 * Cloudinary client singleton
 * Configured via environment variables:
 * - CLOUDINARY_CLOUD_NAME
 * - CLOUDINARY_API_KEY
 * - CLOUDINARY_API_SECRET
 */

let isConfigured = false;

function normalizeEnvSecret(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function configureCloudinary() {
  if (isConfigured) return;

  const CLOUDINARY_CLOUD_NAME = normalizeEnvSecret(process.env.CLOUDINARY_CLOUD_NAME);
  const CLOUDINARY_API_KEY = normalizeEnvSecret(process.env.CLOUDINARY_API_KEY);
  const CLOUDINARY_API_SECRET = normalizeEnvSecret(process.env.CLOUDINARY_API_SECRET);

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    console.warn('⚠️  Cloudinary not configured - file storage will use in-memory fallback');
    console.warn('   Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env');
    return;
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });

  isConfigured = true;
  console.log('✅ Cloudinary configured:', CLOUDINARY_CLOUD_NAME);
}

export function getCloudinary() {
  return cloudinary;
}

export function isCloudinaryConfigured() {
  return isConfigured;
}

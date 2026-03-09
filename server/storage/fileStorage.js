import { getCloudinary, isCloudinaryConfigured } from './cloudinaryClient.js';
import crypto from 'crypto';
import path from 'path';

function getCloudinaryErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message.trim()) return error.message;
  if (typeof error.error?.message === 'string' && error.error.message.trim()) return error.error.message;
  if (typeof error.http_code === 'number') return `Cloudinary API error (HTTP ${error.http_code})`;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function isCloudinaryNotFoundError(error) {
  const message = getCloudinaryErrorMessage(error).toLowerCase();
  const httpCode = Number(error?.http_code || error?.error?.http_code || 0);
  return httpCode === 404 || message.includes('not found') || message.includes('does not exist');
}

function isCloudinaryAuthMismatchError(error) {
  const message = getCloudinaryErrorMessage(error).toLowerCase();
  const httpCode = Number(error?.http_code || error?.error?.http_code || 0);
  return httpCode === 401 || message.includes('api_secret mismatch') || message.includes('invalid signature');
}

/**
 * Storage abstraction for project files
 * Uploads file content to Cloudinary as raw text files
 * Returns Cloudinary secure_url for storage in PostgreSQL
 */

/**
 * Upload file content to Cloudinary
 * @param {string} projectId - Project ID for folder organization
 * @param {string} filePath - Relative file path within project (e.g., "src/App.js")
 * @param {string} content - File content as string
 * @param {string} userId - User ID for tracking ownership
 * @returns {Promise<{url: string, publicId: string, version: number}>}
 */
export async function uploadFile(projectId, filePath, content, userId) {
  if (!isCloudinaryConfigured()) {
    // Fallback: return data URI for in-memory storage (dev mode)
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    return {
      url: `data:text/plain;base64,${base64Content}`,
      publicId: `fallback_${Date.now()}`,
      version: 1
    };
  }

  const cloudinary = getCloudinary();
  
  // Generate unique public_id: projects/{projectId}/{hash}_{filename}
  const fileHash = crypto.createHash('md5').update(filePath + Date.now()).digest('hex').slice(0, 8);
  const fileName = filePath.split('/').pop() || 'file';
  const fileBaseName = path.parse(fileName).name || 'file';
  const safeBaseName = fileBaseName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const publicId = `projects/${projectId}/${fileHash}_${safeBaseName}`;

  // Upload as raw text file
  const result = await cloudinary.uploader.upload(`data:text/plain;base64,${Buffer.from(content, 'utf-8').toString('base64')}`, {
    public_id: publicId,
    resource_type: 'raw',
    folder: `projects/${projectId}`,
    context: {
      user_id: userId,
      file_path: filePath,
      project_id: projectId
    },
    tags: ['project-file', projectId]
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    version: result.version
  };
}

/**
 * Upload image asset to Cloudinary (or fallback to data URL in dev mode)
 * @param {string} projectId - Project ID for folder organization
 * @param {string} filePath - Relative file path within project
 * @param {string} dataUrl - Full image data URL (e.g., data:image/png;base64,...)
 * @param {string} userId - User ID for tracking ownership
 * @returns {Promise<{url: string, publicId: string, version: number}>}
 */
export async function uploadAsset(projectId, filePath, dataUrl, userId) {
  if (!isCloudinaryConfigured()) {
    return {
      url: dataUrl,
      publicId: `fallback_${Date.now()}`,
      version: 1
    };
  }

  const cloudinary = getCloudinary();

  const fileHash = crypto.createHash('md5').update(filePath + Date.now()).digest('hex').slice(0, 8);
  const fileName = filePath.split('/').pop() || 'asset';
  const publicId = `projects/${projectId}/${fileHash}_${fileName}`;

  const result = await cloudinary.uploader.upload(dataUrl, {
    public_id: publicId,
    resource_type: 'image',
    folder: `projects/${projectId}`,
    context: {
      user_id: userId,
      file_path: filePath,
      project_id: projectId
    },
    tags: ['project-asset', projectId]
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    version: result.version
  };
}

/**
 * Download file content from Cloudinary
 * @param {string} url - Cloudinary secure_url or data URI
 * @returns {Promise<string>} File content
 */
export async function downloadFile(url) {
  // Handle fallback data URIs
  if (url.startsWith('data:text/plain;base64,')) {
    const base64Content = url.split(',')[1];
    return Buffer.from(base64Content, 'base64').toString('utf-8');
  }

  if (url.startsWith('data:image/')) {
    return '';
  }

  // Fetch from Cloudinary
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file from Cloudinary: ${response.statusText}`);
  }
  return response.text();
}

/**
 * Update existing file (creates new version in Cloudinary)
 * @param {string} publicId - Cloudinary public_id from previous upload
 * @param {string} content - New file content
 * @returns {Promise<{url: string, publicId: string, version: number}>}
 */
export async function updateFile(publicId, content) {
  if (!isCloudinaryConfigured()) {
    // Fallback for dev mode
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    return {
      url: `data:text/plain;base64,${base64Content}`,
      publicId: publicId || `fallback_${Date.now()}`,
      version: 1
    };
  }

  const cloudinary = getCloudinary();

  // Re-upload with same public_id (Cloudinary auto-versions)
  const result = await cloudinary.uploader.upload(`data:text/plain;base64,${Buffer.from(content, 'utf-8').toString('base64')}`, {
    public_id: publicId,
    resource_type: 'raw',
    invalidate: true, // Clear CDN cache
    overwrite: true   // Replace existing file
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    version: result.version
  };
}

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public_id
 * @returns {Promise<void>}
 */
export async function deleteFile(publicId) {
  if (!isCloudinaryConfigured() || publicId.startsWith('fallback_')) {
    // No-op for fallback mode
    return;
  }

  const cloudinary = getCloudinary();
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
}

/**
 * Delete all files in a project folder
 * @param {string} projectId - Project ID
 * @returns {Promise<void>}
 */
export async function deleteProjectFolder(projectId) {
  if (!isCloudinaryConfigured()) {
    return;
  }

  const cloudinary = getCloudinary();

  // Delete all files with project tag (raw + image)
  try {
    await cloudinary.api.delete_resources_by_tag(projectId, { resource_type: 'raw' });
    await cloudinary.api.delete_resources_by_tag(projectId, { resource_type: 'image' });
    // Also try to delete the folder (will only work if empty or if all resources deleted)
    await cloudinary.api.delete_folder(`projects/${projectId}`);
  } catch (error) {
    if (isCloudinaryAuthMismatchError(error)) {
      // Non-fatal for app behavior; skip noisy cleanup warning.
      return;
    }

    if (!isCloudinaryNotFoundError(error)) {
      console.warn(
        `Warning: Could not fully delete project folder ${projectId}: ${getCloudinaryErrorMessage(error)}`
      );
    }
    // Non-fatal - files might have been deleted already
  }
}

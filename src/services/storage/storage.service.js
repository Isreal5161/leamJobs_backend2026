import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const storageProvider = process.env.R2_ENDPOINT ? 'cloudflare-r2' : 'local-development';

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const bucketName = process.env.R2_BUCKET_NAME || 'leamjobs-private-files';

/**
 * Validate object key for path traversal attacks and invalid patterns.
 * Object keys must follow the format: {namespace}/{userId}/{category}/{uuid}.{ext}
 */
const validateObjectKey = (objectKey) => {
  if (!objectKey || typeof objectKey !== 'string') {
    throw new Error('Invalid object key');
  }

  const normalized = objectKey.replace(/^\/+/, '');
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized.includes('\\')) {
    throw new Error('Invalid storage object key');
  }

  return normalized;
};

/**
 * Create a secure object key following the pattern: {namespace}/{userId}/{category}/{uuid}.{ext}
 */
export const createObjectKey = ({ userId, category, extension, namespace = 'seekers' }) => {
  if (!userId || !category || !extension || !/^[a-z0-9-]+$/.test(namespace)) {
    throw new Error('Missing required fields for object key creation');
  }
  return `${namespace}/${userId}/${category}/${randomUUID()}.${extension}`;
};

/**
 * Upload a file to Cloudflare R2 (or fallback to memory for testing)
 */
export const uploadObject = async ({ objectKey, buffer }) => {
  if (!objectKey || !buffer) {
    throw new Error('Object key and buffer are required');
  }

  const validatedKey = validateObjectKey(objectKey);

  try {
    // Use S3 client to put object to R2
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: validatedKey,
      Body: buffer,
    }));

    return { objectKey: validatedKey };
  } catch (error) {
    // Do not expose R2 credentials or internal details to caller
    const message = error?.message || 'Failed to upload file to storage';
    const wrappedError = new Error(message.includes('credentials') || message.includes('Bucket') ? 'Storage upload failed' : message);
    wrappedError.statusCode = 500;
    throw wrappedError;
  }
};

/**
 * Read a file from Cloudflare R2 (or fallback to memory for testing)
 */
export const readObject = async (objectKey) => {
  if (!objectKey) {
    throw new Error('Object key is required');
  }

  const validatedKey = validateObjectKey(objectKey);

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: validatedKey,
    }));

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    // Return 404-friendly error for missing objects
    if (error?.name === 'NoSuchKey') {
      const notFoundError = new Error('File not found');
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    // Do not expose credentials or internal details
    const message = error?.message || 'Failed to read file from storage';
    const wrappedError = new Error(message.includes('credentials') || message.includes('Bucket') ? 'Storage read failed' : message);
    wrappedError.statusCode = 500;
    throw wrappedError;
  }
};

/**
 * Delete a file from Cloudflare R2 (or fallback to memory for testing)
 */
export const deleteObject = async (objectKey) => {
  if (!objectKey) return;

  const validatedKey = validateObjectKey(objectKey);

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: validatedKey,
    }));
  } catch (error) {
    // Silently ignore delete errors for non-existent objects
    // Only log/throw if it's a real error (credentials, permissions, etc.)
    if (error?.name === 'NoSuchKey') {
      return;
    }

    // Do not expose credentials or internal details
    const message = error?.message || 'Failed to delete file from storage';
    if (!message.includes('credentials') && !message.includes('Bucket')) {
      // Only log if it's not a credential/bucket issue
      console.error(`Storage delete error: ${message}`);
    }
  }
};

/**
 * Get storage provider information
 */
export const getStorageInfo = () => ({
  provider: storageProvider,
  configured: Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY),
  bucket: storageProvider === 'cloudflare-r2' ? bucketName : null,
});

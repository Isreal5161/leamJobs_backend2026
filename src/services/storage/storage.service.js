import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const storageRoot = process.env.STORAGE_ROOT || path.join(os.tmpdir(), 'leamjobs-uploads');

const resolveKey = (objectKey) => {
  const normalized = path.posix.normalize(objectKey).replace(/^\/+/, '');
  if (normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error('Invalid storage object key');
  }
  return path.join(storageRoot, ...normalized.split('/'));
};

export const storageProvider = 'local-development';

export const createObjectKey = ({ userId, category, extension }) =>
  `seekers/${userId}/${category}/${randomUUID()}.${extension}`;

export const uploadObject = async ({ objectKey, buffer }) => {
  const filePath = resolveKey(objectKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer, { flag: 'wx' });
  return { objectKey };
};

export const deleteObject = async (objectKey) => {
  if (!objectKey) return;

  try {
    await fs.unlink(resolveKey(objectKey));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

export const readObject = async (objectKey) => fs.readFile(resolveKey(objectKey));

export const getStorageInfo = () => ({ provider: storageProvider, configured: false, root: storageRoot });

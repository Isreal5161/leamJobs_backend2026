import { createObjectKey, readObject, uploadObject } from './storage/storage.service.js';

const imageTypes = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const imageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|png|webp)$/i;

export const uploadAboutTeamImage = async ({ file, extension }) => {
  const objectKey = createObjectKey({
    userId: 'about',
    namespace: 'site-content',
    category: 'team',
    extension,
  });
  await uploadObject({ objectKey, buffer: file.buffer });
  const imageId = objectKey.split('/').pop();
  return { imageUrl: `/api/content/about/team-images/${imageId}` };
};

export const readAboutTeamImage = async (imageId) => {
  if (!imageIdPattern.test(imageId)) {
    throw Object.assign(new Error('Team image not found'), { status: 404 });
  }

  const extension = imageId.split('.').pop().toLowerCase();
  const objectKey = `site-content/about/team/${imageId}`;
  return { buffer: await readObject(objectKey), contentType: imageTypes[extension] };
};

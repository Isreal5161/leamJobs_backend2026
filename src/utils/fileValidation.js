const imageSignatures = {
  jpeg: (buffer) => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  png: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (buffer) => buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP',
};

const resumeSignatures = {
  pdf: (buffer) => buffer.subarray(0, 5).toString() === '%PDF-',
  doc: (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
  docx: (buffer) => buffer.subarray(0, 2).equals(Buffer.from([0x50, 0x4b])),
};

const extensionOf = (filename) => filename.toLowerCase().split('.').pop();

export const validateUploadedImage = (file) => {
  if (!file) throw Object.assign(new Error('An image file is required'), { status: 400 });

  const extension = extensionOf(file.originalname);
  const allowed = new Set(['jpeg', 'jpg', 'png', 'webp']);
  const normalizedExtension = extension === 'jpg' ? 'jpeg' : extension;
  const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  if (!allowed.has(extension) || !allowedMimeTypes.has(file.mimetype) || !imageSignatures[normalizedExtension]?.(file.buffer)) {
    throw Object.assign(new Error('Only valid JPEG, PNG, and WebP images are supported'), { status: 400 });
  }

  return { extension: normalizedExtension };
};

export const validateUploadedResume = (file) => {
  if (!file) throw Object.assign(new Error('A resume file is required'), { status: 400 });

  const extension = extensionOf(file.originalname);
  const allowedMimeTypes = {
    pdf: new Set(['application/pdf']),
    doc: new Set(['application/msword', 'application/octet-stream']),
    docx: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream']),
  };
  const isDocxPackage = extension === 'docx' && file.buffer.includes(Buffer.from('[Content_Types].xml'));
  const validSignature = resumeSignatures[extension]?.(file.buffer) && (extension !== 'docx' || isDocxPackage);

  if (!allowedMimeTypes[extension]?.has(file.mimetype) || !validSignature) {
    throw Object.assign(new Error('Only valid PDF, DOC, and DOCX files are supported'), { status: 400 });
  }

  return { extension };
};

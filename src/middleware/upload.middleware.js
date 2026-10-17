import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

export const singleUpload = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'File exceeds the 10 MB limit' });
    }

    return res.status(400).json({ message: 'Invalid file upload' });
  });
};

export const multipleUpload = (fieldName, maxFiles = 5) => (req, res, next) => {
  upload.array(fieldName, maxFiles)(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Each file must be 10 MB or smaller' });
    }
    if (error instanceof multer.MulterError && ['LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT'].includes(error.code)) {
      return res.status(400).json({ message: `You can upload up to ${maxFiles} files` });
    }
    return res.status(400).json({ message: 'Invalid file upload' });
  });
};

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
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

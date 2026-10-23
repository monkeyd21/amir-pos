import multer from 'multer';
import type { RequestHandler } from 'express';
import { AppError } from './errorHandler';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Memory-storage multer instance for processing uploads in-memory
 * (no temp files on disk). Good for Excel/CSV parsing where we
 * just need the buffer.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
      'application/csv',
    ];
    if (allowed.includes(file.mimetype) || /\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new AppError('Only Excel (.xlsx, .xls) and CSV files are accepted', 400) as any);
    }
  },
});

/**
 * One photo in the `file` field, held in memory. What the file really is gets
 * decided from its bytes later (products/image-meta.ts), not from its name.
 * Multer's own errors (too large, wrong field) come back as a plain 400.
 */
const imageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

export const singleImageUpload: RequestHandler = (req, res, next) => {
  imageMulter.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large (8 MB at most)' : 'Send one photo in the "file" field';
      return next(new AppError(message, 400));
    }
    if (err) return next(err);
    if (!req.file) return next(new AppError('No photo was attached', 400));
    next();
  });
};

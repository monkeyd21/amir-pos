import multer from 'multer';
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

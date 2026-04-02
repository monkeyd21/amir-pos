import { Request, Response } from 'express';

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${_req.method} ${_req.originalUrl}`,
  });
};

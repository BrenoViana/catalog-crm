import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../utils/auth.js';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não informado.' });
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }

  req.user = payload;
  next();
};

import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const signToken = (payload: { sub: string; username: string; role: string }) =>
  jwt.sign(payload, config.jwtSecret, { expiresIn: '8h' });

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, config.jwtSecret) as { sub: string; username: string; role: string };
  } catch {
    return null;
  }
};

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const authenticate = (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization || !/^Bearer\s+\S+$/.test(authorization)) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }

  const token = authorization.replace(/^Bearer\s+/, '');

  try {
    req.user = jwt.verify(token, env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};
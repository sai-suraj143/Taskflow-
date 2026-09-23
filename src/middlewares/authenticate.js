import { verifyToken } from '../utils/jwt.js';

export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const error = new Error('Authorization header missing or malformed');
    error.status = 401;
    return next(error);
  }

  const token = authHeader.slice('Bearer '.length).trim();

  try {
    const decoded = verifyToken(token);
    req.user = { id: decoded.id, role: decoded.role };
    return next();
  } catch (error) {
    const authError = new Error('Invalid or expired token');
    authError.status = 401;
    return next(authError);
  }
};

export default authenticate;
import { registerUser, loginUser } from '../services/auth.service.js';

const createValidationError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

export const register = async (req, res, next) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return next(createValidationError('name, email and password are required'));
  }
  if (!email.includes('@')) {
    return next(createValidationError('A valid email address is required'));
  }
  if (password.length < 8) {
    return next(createValidationError('Password must be at least 8 characters long'));
  }

  try {
    const user = await registerUser({ name, email, password });
    return res.status(201).json({ user });
  } catch (error) {
    return next(error);
  }
};

export const login = async (req, res, next) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return next(createValidationError('email and password are required'));
  }

  try {
    const { token, user } = await loginUser({ email, password });
    return res.status(200).json({ token, user });
  } catch (error) {
    return next(error);
  }
};
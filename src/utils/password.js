import bcrypt from 'bcrypt';
import config from '../config/env.js';

export const hashPassword = (plainPassword) => {
  return bcrypt.hash(plainPassword, config.bcryptSaltRounds);
};

export const comparePassword = (plainPassword, hash) => {
  return bcrypt.compare(plainPassword, hash);
};
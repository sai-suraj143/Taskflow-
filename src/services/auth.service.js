import prisma from '../lib/prisma.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';

const createAuthError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const stripPassword = (user) => {
  const { password, ...publicUser } = user;
  return publicUser;
};

export const registerUser = async ({ name, email, password }) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw createAuthError('User with this email already exists', 409);
  }

  const hashedPassword = await hashPassword(password);

  const createdUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
    },
  });

  return stripPassword(createdUser);
};

export const loginUser = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await comparePassword(password, user.password))) {
    throw createAuthError('Invalid email or password', 401);
  }

  const token = signToken({ id: user.id, role: user.role });

  return { token, user: stripPassword(user) };
};
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      const error = new Error('You do not have permission to perform this action');
      error.status = 403;
      return next(error);
    }
    return next();
  };
};

export default authorize;
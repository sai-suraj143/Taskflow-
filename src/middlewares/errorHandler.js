export const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route Not Found - ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  return res.status(status).json({
    error: {
      message,
      status,
    },
  });
};

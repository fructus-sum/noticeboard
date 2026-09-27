// server/middleware/asyncRoute.js — async route handlers without the try/catch in each one
//
// Provides
//   route(handler)   wraps an async (req, res, next) handler: if it rejects, the error goes to
//                    next(err), i.e. errorHandler (a 500, or err.status). Replaces the
//                    try { … } catch (err) { next(err) } repeated in the routes (Old D36)
//
// Used by
//   routes/api/* (converted as each route file is reworked)
function route(handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}

module.exports = { route };

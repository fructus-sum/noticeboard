// server/middleware/asyncRoute.js — async route handlers without the try/catch in each one
//
// Provides
//   route(handler)       wraps an async (req, res, next) handler: if it rejects, the error goes
//                        to next(err), i.e. errorHandler (a 500, or err.status). Replaces the
//                        try { … } catch (err) { next(err) } repeated in the routes (Old D36)
//   jsonRoute(handler)   for handlers that return the answer: sends `await handler(req)` with
//                        res.json. An error marked `expose` (e.g. from services/updates) is the
//                        admin's message: status err.status and { error: err.message }; any
//                        other error goes to next(err)
//
// Used by
//   routes/api/auth.js, routes/api/slideshows.js, routes/api/slides.js, routes/api/settings/*
function route(handler) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}

function jsonRoute(handler) {
  return async (req, res, next) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      if (err.expose) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

module.exports = { route, jsonRoute };

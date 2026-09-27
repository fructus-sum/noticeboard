// client/admin/src/composables/useApi.js — every call the admin panel makes to the server
//
// Responsibilities
//   One request function for JSON and uploads: sends the login cookie, turns an error answer into
//   an Error with the server's message, and sends the browser to the login page when a request
//   isn't logged in (401). The server answers a wrong password inside the panel with 403, not
//   401, so that only a real logout leads to the login page.
//
// Provides
//   api.get(path, options) / post(path, body, options) / put(path, body, options) /
//   patch(path, body, options) / del(path, options)
//   api.upload(path, formData, options)   multipart (the browser sets the boundary)
//     path is under /api. options.redirectOn401 = false: a 401 is thrown as an error instead of
//     leaving the page (the login page and the router's login check use that).
//     Errors: Error(message) with .status, and .serverMessage (the server's own error text, if any)
//
// Used by
//   every admin component and view, router/index.js (the login check), LoginView
const BASE = '/api';

// Not logged in (or the session expired): go to the login page, unless already there, so a
// request made from the login page can never reload it over and over
function toLogin() {
  if (!window.location.pathname.startsWith('/admin/login')) window.location.href = '/admin/login';
}

async function request(method, path, { body, form, redirectOn401 = true } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  if (form) {
    opts.body = form;   // no Content-Type: the browser sets it with the multipart boundary
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, opts);

  if (res.status === 401 && redirectOn401) {
    toLogin();
    return undefined;
  }
  // Without the redirect, a 401 is an error like any other (e.g. a wrong password at login)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const fallback = `${form ? 'Upload' : 'Request'} failed (${res.status})`;
    throw Object.assign(new Error(data.error || fallback), { status: res.status, serverMessage: data.error });
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  del: (path, options) => request('DELETE', path, options),
  upload: (path, form, options) => request('POST', path, { ...options, form }),
};

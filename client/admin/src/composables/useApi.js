const BASE = '/api';

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, opts);

  if (res.status === 401) {
    window.location.href = '/admin/login';
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

async function upload(path, formData) {
  // No Content-Type header — browser sets it with the multipart boundary
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (res.status === 401) {
    window.location.href = '/admin/login';
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Upload failed (${res.status})`), { status: res.status });
  }
  return res.json();
}

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  put:    (path, body)  => request('PUT',    path, body),
  del:    (path)        => request('DELETE', path),
  upload: (path, form)  => upload(path, form),
};

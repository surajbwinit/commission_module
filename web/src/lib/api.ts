import axios, { AxiosError } from 'axios';

const baseURL = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000/api';

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Auto-snake_case outgoing JSON bodies ──────────────────────
// The .NET API uses SnakeCaseLower naming policy on input — so it
// expects { plan_id, created_by, … } not { planId, createdBy, … }.
// Keep React code idiomatic (camelCase) and convert at the wire.

const camelToSnake = (s: string): string =>
  s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()).replace(/^_/, '');

const transformKeys = (value: any): any => {
  if (Array.isArray(value)) return value.map(transformKeys);
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[camelToSnake(key)] = transformKeys(value[key]);
    }
    return out;
  }
  return value;
};

api.interceptors.request.use((config) => {
  if (config.data && typeof config.data === 'object') {
    config.data = transformKeys(config.data);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err: AxiosError<{ error?: string }>) => {
    const message =
      (err.response?.data && err.response.data.error) ||
      err.message ||
      'Request failed';
    return Promise.reject(new Error(message));
  }
);

export default api;

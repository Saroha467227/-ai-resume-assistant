import axios from 'axios';

export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, ''),
  withCredentials: true,
  timeout: 25_000
});

export function messageFrom(error) {
  return error.response?.data?.message || (error.code === 'ECONNABORTED'
    ? 'The request took too long. Try again.'
    : 'The server could not be reached. Try again in a moment.');
}

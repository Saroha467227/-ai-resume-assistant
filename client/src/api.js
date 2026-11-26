import axios from 'axios';

export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, ''),
  withCredentials: true,
  timeout: 25_000
});

export function messageFrom(error) {
  if (error.response?.status === 413 && typeof error.response.data !== 'object') {
    return 'The upload was too large. Choose a smaller file.';
  }
  return error.response?.data?.message || (error.code === 'ECONNABORTED'
    ? 'The request took too long. Try again.'
    : 'The server could not be reached. Try again in a moment.');
}

const isDevelopment = import.meta.env.MODE === 'development';

export const API_URL = isDevelopment
  ? 'http://localhost:3001/api'
  : 'https://connect-4-production-c9c5.up.railway.app/api';

export const SOCKET_URL = isDevelopment
  ? 'http://localhost:3001'
  : 'https://connect-4-production-c9c5.up.railway.app';
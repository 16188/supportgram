import dotenv from 'dotenv';

dotenv.config();

export const config = {
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL || 'file:data/local.db',
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN || '',
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
  SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL || '',
};

export default config;

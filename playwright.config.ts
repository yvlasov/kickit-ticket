import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://app:3000',
  },
  reporter: 'list',
});

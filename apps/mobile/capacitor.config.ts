import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'hu.buyflow.app',
  appName: 'BuyFlow',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_OFFLINE_STORE?: string;
  readonly VITE_OPS_DAY_UNLOCK_PIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

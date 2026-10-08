/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

interface ImportMetaEnv {
  readonly SHOPIFY_API_KEY: string;
  readonly SHOPIFY_API_SECRET: string;
  readonly SCOPES: string;
  readonly SHOPIFY_APP_URL: string;
  readonly DATABASE_URL: string;
  readonly REDIS_URL?: string;
  readonly SHOP_CUSTOM_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

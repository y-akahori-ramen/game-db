/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** 'false' switches search to the real API service; anything else uses the mock. */
    readonly VITE_USE_MOCK?: string;
}

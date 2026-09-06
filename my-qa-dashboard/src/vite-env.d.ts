/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** 'false' switches search to the real API service; anything else uses the mock. */
    readonly VITE_USE_MOCK?: string;
    readonly VITE_COGNITO_DOMAIN?: string;
    readonly VITE_COGNITO_CLIENT_ID?: string;
    readonly VITE_COGNITO_REDIRECT_URI?: string;
    readonly VITE_COGNITO_LOGOUT_URI?: string;
}

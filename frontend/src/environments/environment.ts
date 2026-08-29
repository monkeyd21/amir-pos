import { resolveApiUrl } from './api-url';

/** Dev/default environment. The production build swaps this file for
 *  environment.prod.ts (angular.json → fileReplacements). */
export const environment = {
  production: false,
  apiUrl: resolveApiUrl(),
};

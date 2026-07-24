export class ProviderNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(`${providerName} is not configured -- no credentials present.`);
    this.name = 'ProviderNotConfiguredError';
  }
}

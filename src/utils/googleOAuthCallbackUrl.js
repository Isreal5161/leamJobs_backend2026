const invalidCallbackRequest = () => Object.assign(
  new Error('Malformed Google OAuth callback request.'),
  {
    status: 400,
    publicMessage: 'Google sign-in could not be completed. Please try again.',
  },
);

export const buildGoogleCallbackUrl = (requestTarget, configuredRedirectUri) => {
  let configuredUrl;
  try {
    configuredUrl = new URL(configuredRedirectUri);
  } catch {
    throw Object.assign(new Error('Google OAuth redirect URI is not configured correctly.'), {
      status: 500,
      publicMessage: 'Google sign-in is not configured for this environment.',
    });
  }

  if (
    typeof requestTarget !== 'string'
    || !requestTarget.startsWith('/')
    || requestTarget.startsWith('//')
    || requestTarget.includes('#')
    || /%(?![0-9a-f]{2})/i.test(requestTarget)
    || configuredUrl.hash
  ) {
    throw invalidCallbackRequest();
  }

  const queryStart = requestTarget.indexOf('?');
  if (queryStart !== -1) {
    try {
      for (const component of requestTarget.slice(queryStart + 1).split('&')) {
        const separator = component.indexOf('=');
        const name = separator === -1 ? component : component.slice(0, separator);
        const value = separator === -1 ? '' : component.slice(separator + 1);
        decodeURIComponent(name.replace(/\+/g, ' '));
        decodeURIComponent(value.replace(/\+/g, ' '));
      }
    } catch {
      throw invalidCallbackRequest();
    }
  }

  let requestUrl;
  try {
    requestUrl = new URL(requestTarget, 'https://google-callback.invalid');
  } catch {
    throw invalidCallbackRequest();
  }

  if (
    requestUrl.origin !== 'https://google-callback.invalid'
    || requestUrl.pathname !== configuredUrl.pathname
  ) {
    throw invalidCallbackRequest();
  }

  const requestParams = [...requestUrl.searchParams.entries()];
  const seenParams = new Set();
  for (const [name] of requestParams) {
    if (seenParams.has(name)) throw invalidCallbackRequest();
    seenParams.add(name);
  }

  for (const [name, value] of configuredUrl.searchParams) {
    if (requestUrl.searchParams.getAll(name).filter((entry) => entry === value).length !== 1) {
      throw invalidCallbackRequest();
    }
  }

  const callbackUrl = new URL(configuredUrl.origin + configuredUrl.pathname);
  callbackUrl.search = requestUrl.search;
  return callbackUrl;
};

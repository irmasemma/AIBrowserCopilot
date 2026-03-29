export const DEFAULT_BLOCKED_DOMAINS = [
  // Banking
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'usbank.com',
  'capitalone.com', 'discover.com', 'ally.com', 'schwab.com', 'fidelity.com',
  'vanguard.com', 'tdameritrade.com', 'etrade.com', 'robinhood.com',
  // Email
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com',
  'protonmail.com', 'mail.proton.me',
  // Auth
  'accounts.google.com', 'login.microsoftonline.com', 'auth0.com',
  'id.apple.com', 'account.live.com',
  // Payment
  'paypal.com', 'venmo.com', 'stripe.com',
];

export const isBlockedDomain = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname;
    return DEFAULT_BLOCKED_DOMAINS.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
    );
  } catch {
    return false;
  }
};

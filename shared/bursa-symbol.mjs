const BURSA_SYMBOL_PATTERN = /^[A-Z0-9.&-]{1,20}$/;

export function normalizeBursaSymbol(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isValidBursaSymbol(value) {
  return BURSA_SYMBOL_PATTERN.test(normalizeBursaSymbol(value));
}

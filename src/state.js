// Session-only application state. BOE documents are never written to localStorage.
export const state = {
  latest: null,
  items: [],
  filteredItems: [],
  page: 1,
  pageSize: 25,
  sortKey: null,
  sortDirection: 1,
  ewayRates: {},
  ewayRateConfirmations: {},
};

// Shared app state + tiny event bus.
export const S = {
  year: new Date().getFullYear(),
  meetings: [],
  meeting: null,
  sessions: [],
  session: null,
  kind: null,
  state: 'upcoming',
  raw: {},
  M: null,
  sel: new Set(), // selected driver numbers (shared across tabs)
  selTouched: false,
  tab: 'dashboard',
  auto: true,
  loading: new Set(),
  failed: new Set(),
  champ: {},
};

const handlers = {};
export const on = (evt, fn) => { (handlers[evt] ||= []).push(fn); };
export const emit = (evt, arg) => { (handlers[evt] || []).forEach(fn => fn(arg)); };

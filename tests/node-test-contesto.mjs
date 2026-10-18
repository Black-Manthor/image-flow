// Compatibility import path: every export is the native object.
// Console attribution reads the native context; no test function is wrapped.
export * from 'node:test';
export { default } from 'node:test';

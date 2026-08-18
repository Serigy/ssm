/**
 * The async boundary Module Federation requires.
 *
 * The shared-module scope has to be initialised before any application code
 * runs, and that initialisation is asynchronous. So the entry point may do
 * exactly one thing: dynamically import the real entry. Everything that
 * touches React, the router or a shared library lives in bootstrap.tsx, on the
 * far side of this await.
 *
 * Declaring it explicitly matters. Left to itself, @module-federation/vite
 * infers where the boundary belongs and rewrites that module into an async
 * bootstrap — and when it picks a module that has named exports, those exports
 * vanish, producing "does not provide an export named 'App'" at runtime.
 * One line here removes the guesswork.
 */
void import('./bootstrap.js');

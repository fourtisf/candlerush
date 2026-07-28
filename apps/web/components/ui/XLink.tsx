/**
 * The account, on the front page.
 *
 * A real anchor rather than a button with a handler: it wants to be middle-clickable,
 * copyable and openable in a new tab like any other link. `noopener` because the target
 * gets `window.opener` otherwise, and `noreferrer` because there is nothing here worth
 * telling them about the page it came from.
 */
export const X_URL = 'https://x.com/Playcandlerush';
const HANDLE = '@PLAYCANDLERUSH';

export function XLink() {
  return (
    <a className="xl" href={X_URL} target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.59l5.24 6.93ZM17.61 20.64h2.04L6.49 3.24H4.3Z" />
      </svg>
      <b>{HANDLE}</b>
    </a>
  );
}

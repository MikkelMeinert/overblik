// Since 22 Nov the app shows one page at a time behind a tab bar. The older suites test features, not pages, so they
// call this once per browser context: every page is shown, as before the tabs. test_pages.js tests the tabs themselves.
module.exports = ctx => ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('style'); s.textContent = '.page[hidden]{display:grid!important}'; document.head.appendChild(s);
}));

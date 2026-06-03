// KrogerBuddy front-end configuration.
//
// apiBase = where the Kroger API proxy lives.
//   • Local dev (npm start): leave it "" — the Node server serves the API on
//     the same origin.
//   • GitHub Pages: set it to your deployed Cloudflare Worker URL, e.g.
//       apiBase: "https://krogerbuddy-api.YOUR-SUBDOMAIN.workers.dev"
//
// Tip: you can also override this at runtime without editing the file by
// visiting the site once with ?api=<worker-url> — it'll be remembered.
window.KROGERBUDDY_CONFIG = {
  apiBase: '',
};

// Service worker de "Gestion de boutique" : garde l'appli en réserve pour qu'elle s'ouvre sans internet.
// Les données de la boutique sont déjà stockées sur l'appareil, elles ne passent pas par ici.
//
// Si tu changes les bibliothèques de index.html (autre version), mets à jour la liste LIBS ci-dessous
// et augmente VERSION pour que les téléphones renouvellent leur réserve.

const VERSION = "v1";
const SHELL = "gb-appli-" + VERSION;   // la page, le manifeste, les icônes
const LIBS_CACHE = "gb-libs-" + VERSION; // les bibliothèques externes

const SHELL_FILES = ["./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

// Doit correspondre exactement aux <script src> de index.html
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.25.6/babel.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/prop-types/15.8.1/prop-types.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/recharts/2.12.7/Recharts.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.tailwindcss.com",
];
const LIB_HOSTS = ["cdnjs.cloudflare.com", "cdn.tailwindcss.com"];

// Installation : on met tout en réserve. Un fichier qui échoue n'empêche pas les autres.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map((f) => shell.add(f).catch(() => {})));
    const libs = await caches.open(LIBS_CACHE);
    await Promise.all(LIBS.map(async (url) => {
      try {
        const sameCors = url.includes("cdnjs.cloudflare.com"); // cdnjs autorise le mode CORS, pas Tailwind
        const res = await fetch(url, { mode: sameCors ? "cors" : "no-cors" });
        if (res && (res.ok || res.type === "opaque")) await libs.put(url, res);
      } catch (e) { /* on réessaiera à la première utilisation */ }
    }));
    await self.skipWaiting();
  })());
});

// Activation : on supprime les anciennes réserves
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, LIBS_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// La page de l'appli : réseau d'abord, pour que les mises à jour arrivent dès qu'il y a internet.
// Sans internet (ou connexion trop lente), on ouvre la version gardée en réserve.
async function pageStrategy(req) {
  const cache = await caches.open(SHELL);
  const fromCache = async () =>
    (await cache.match("./index.html", { ignoreSearch: true })) ||
    (await cache.match(req, { ignoreSearch: true }));
  try {
    const res = await fetchWithTimeout(req, 4000);
    if (res.type === "opaqueredirect") return res; // ex. adresse sans "/" final : on laisse le navigateur suivre
    if (res.ok) {
      cache.put("./index.html", res.clone());
      return res;
    }
    return (await fromCache()) || res;
  } catch (e) {
    const cached = await fromCache();
    if (cached) return cached;
    throw e;
  }
}

// Le reste (bibliothèques, icônes) : la réserve d'abord, le réseau seulement si absent
async function assetStrategy(req) {
  const cached = await caches.match(req, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      const isLib = LIB_HOSTS.includes(new URL(req.url).hostname);
      const cache = await caches.open(isLib ? LIBS_CACHE : SHELL);
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const again = await caches.match(req, { ignoreVary: true });
    if (again) return again;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !LIB_HOSTS.includes(url.hostname)) return; // on ne touche à rien d'autre

  const isPage = req.mode === "navigate" ||
    (sameOrigin && (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")));
  event.respondWith(isPage ? pageStrategy(req) : assetStrategy(req));
});

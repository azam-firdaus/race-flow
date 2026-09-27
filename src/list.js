const listEl = document.getElementById("marathon-list");

let marathons;
try {
  marathons = await fetch("/marathons/index.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
} catch (err) {
  listEl.innerHTML = `<p class="error">Couldn't load the marathon list (${err.message}). Have you run <code>npm run preprocess -- &lt;folder-name&gt;</code> yet?</p>`;
  throw err;
}

if (marathons.length === 0) {
  listEl.innerHTML = `<p class="empty">No marathons yet. Add a folder under <code>marathons/</code> and run <code>npm run preprocess -- &lt;folder-name&gt;</code>.</p>`;
} else {
  listEl.innerHTML = marathons
    .map((m) => {
      const dateLabel = m.date || (m.raceStartTimeMs ? new Date(m.raceStartTimeMs).toLocaleDateString() : "");
      return `
        <a class="marathon-card" href="/race.html?marathon=${encodeURIComponent(m.id)}">
          <div class="marathon-name">${escapeHtml(m.name)}</div>
          <div class="marathon-meta">
            ${dateLabel ? `<span>${escapeHtml(dateLabel)}</span>` : ""}
            ${m.location ? `<span>${escapeHtml(m.location)}</span>` : ""}
          </div>
        </a>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

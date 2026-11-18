// The productive application intentionally remains locked until a secure API is configured.
// After deploying the Cloudflare Worker, set your HTTPS workers.dev URL here.
window.TAXIPRO_API_URL = '';

// Upgrade gate for ALREADY INSTALLED dispatch.html and driver.html PWAs.
// Keep false until Cloudflare API, staff login and data migration pass QA.
window.TAXIPRO_ENABLE_UPGRADED_ENTRIES = false;

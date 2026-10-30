# Einrichtung von TaxiPro Dispatch 2.0

## Schritt 1 – Vorschau separat veröffentlichen

1. Öffne `Sero91ak/taxipro-dispatch` in GitHub.
2. Erstelle zunächst einen neuen Branch, z. B. `feature/taxipro-v2`.
3. Übernimm ausschließlich den kompletten Ordner `v2/` aus diesem Paket in das Repository. Bestehende Dateien im Repo-Root bleiben unverändert.
4. Rufe danach `https://sero91ak.github.io/taxipro-dispatch/v2/` auf. GitHub Pages muss bereits aktiviert sein. Der erste Aufruf kann verzögert erfolgen.
5. Prüfe Desktop, iPhone und Android. Alle Demodaten sind erfunden und bleiben im lokalen Browser.

## Schritt 2 – Sichere zentrale API (noch nicht automatisch ausgeführt)

Benötigt: ein eigenes kostenloses Cloudflare-Konto und einen dafür freigeschalteten Workers/D1-Bereich. Es entstehen keine automatischen Gebühren, solange ausschließlich freie Ressourcen genutzt werden. Verbindliche Limits bitte im Cloudflare-Dashboard prüfen.

```bash
cd backend
npm exec wrangler -- d1 create taxipro-dispatch-v2
# Datenbank-ID aus Ausgabe in wrangler.toml übernehmen.
cp wrangler.toml.example wrangler.toml
npm exec wrangler -- d1 execute taxipro-dispatch-v2 --remote --file=./schema.sql
npm exec wrangler -- secret put BOOTSTRAP_SECRET
npm exec wrangler -- deploy
```

Ein **mindestens 32 Zeichen langes zufälliges Bootstrap-Geheimnis** angeben und sicher verwahren. Niemals in GitHub, URL, QR-Code, Screenshots oder `config.js` eintragen.

Setze in `v2/config.js` die reale `https://...workers.dev` URL. Keine Schlüssel oder Passwörter dort eintragen. `APP_ORIGIN` in `wrangler.toml` muss exakt zur GitHub-Pages-Origin passen.

Zur einmaligen Admin-Kontoerstellung den API-Endpunkt `POST /api/bootstrap` mit JSON `{"setupSecret":"…","username":"…","displayName":"…","password":"…"}` aus einer **sicheren lokalen Umgebung** ansprechen. Das Konto wird nur erstellt, wenn die Nutzer-Datenbank noch leer ist. Die dazu verwendeten Passwörter dürfen nicht in Shell-History, GitHub oder Konfigurationsdateien geraten. Vor Produktivbetrieb ist ein nutzerfreundlicher lokaler Einrichtungsdialog vorzusehen.

**Wichtiger Hinweis:** Die API ist eine Implementierungsgrundlage, die vor produktiver Nutzung mit Echtdaten noch Ende-zu-Ende getestet, gegen Missbrauch gehärtet und datenschutzrechtlich abgenommen werden muss. Besonders Patientendaten, Gesundheitsdokumente, Unterschriften und Abrechnungsunterlagen werden bewusst nicht als Dateiupload angeboten.

## Schritt 3 – Freigabe

Zuerst nur synthetische Nutzer/Kunden anlegen und Login, Rollenrechte, den Datenabgleich zwischen zwei echten Geräten sowie GPS und Statuswechsel testen. Erst danach Kundenstamm migrieren. Die bisherige App bleibt bis zu diesem Zeitpunkt unverändert.

## Grenzen

- Keine ständige Hintergrund-GPS-Ortung auf iPhones bei reiner PWA; der zuletzt gemeldete Punkt muss als historisch bezeichnet werden.
- Browser-Push/Einzelbenachrichtigungen sind nicht eingebaut; Fahrer prüfen bei geöffneter PWA über regelmäßigen Abgleich.
- Google Kalender und vorhandene Fahrten müssen noch nach einem abgestimmten Migrationsplan angeschlossen werden.
- Signatur, KTS-Bilder, sichere Dokumentenspeicherung, Jahresauswertung, automatische Serienanlage und Pausen fehlen noch.

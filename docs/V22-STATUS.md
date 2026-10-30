# TaxiPro Dispatch 2.2 – Übergabe und Abnahme

Stand: 30. Oktober 2026. Bestehende Website: `https://sero91ak.github.io/taxipro-dispatch/`.

## Was implementiert ist

- Neues responsives Admin- und Fahrer-Portal (`v2/app.html`, `v2/app.js`, `v2/app.css`), mit rollenbasierter Navigation und Serverautorisierung.
- Fahrer-Anmeldung über per-Benutzername geheim gehashte Passwörter; Admin kann Zugänge sperren und Passwörter zurücksetzen.
- Fahrerzugangsrechte werden serverseitig überprüft, mit getrennten Aufträgen, Arbeitszeiten und persönlichen Nachrichten.
- Aufträge, Statuswechsel und exakte Server-Zeitstempel, Kundenstammsätze, Fahrtenjournal und Tageskontrolle (Hin-/Rückfahrt).
- Serienfahrten mit Wochentagen, Gültigkeitszeitraum, Fahrer, Hinfahrt und optionaler Rückfahrt. Termine über einen kontrollierten Zeitraum erzeugbar, idempotent gegen Doppelanlage.
- Schichtzeiten, bewusste und einzeln protokollierte Pausenbuchungen sowie Admin-Korrekturen mit historisierter Änderung.
- Optionaler GPS-Standort des Fahrers während aktiver Schicht im PWA-Vordergrund, zentraler letzter Standort mit Zeitstempel und Stale-Anzeige.
- Team- und private Nachrichten, 25-Sekunden-Abgleich bei sichtbarer App, externe Navigation, Wochen- und Monatsansichten als Druck/PDF-Grundlage.
- Verschlüsselter Datenexport AES-256-GCM + PBKDF2 im Browser, Kennwort wird nicht gespeichert.
- Backend für Cloudflare Workers + D1 Free. Keine App-Store-/Play-Store-Veröffentlichung.

## Nicht versprochen / offene Abnahme

- Noch kein aktives Cloudflare-Projekt eingerichtet; sichere echte Mehrgerätetransaktionen funktionieren erst nach dessen Einrichtung und Benutzeranlage.
- iPhone-/Android-PWA kann Standort nur bei aktiver Vordergrundausführung sicher aktualisieren; keine „immer“-Hintergrundortung.
- Keine produktive Dokumenten-/KTS-Speicherung, keine rechtsverbindliche elektronische Unterschrift, keine automatische Anerkennung von Krankenfahrtnachweisen.
- Google Kalender nicht auf den neuen Datenbestand migriert. Alt-App darf bis zur Export-/Importkontrolle erreichbar bleiben.
- Kein garantierter kostenloser unlimitierter Cloudbetrieb; Free-Tiers haben Limits und Bedingungen.
- AES-Backup ist ein **Export**; eine sichere Restore-Funktion wurde noch nicht freigegeben. Backup-Passwort aufbewahren und Auslesbarkeit prüfen, bevor Daten migriert werden.
- Automatische arbeitsrechtliche Bewertung der Pausen-/Nettoarbeitszeit fehlt. Berechnet werden Rohzeiten und dokumentierte Pausen.

## Migrations-/Sicherheitsregel

Das vorhandene Root-`index.html`, `home.html`, `dispatch.html`, `driver.html` und ihre Browser-lokalen Daten nicht ohne Export und Abnahmetests überschreiben. Neue Dateien zunächst auf Entwicklung-Branch veröffentlichen. Die bisherige Kalender-/Fahrer-Version dient bis zum geplanten Wechsel als Altbetrieb.

## Deployment

Cloudflare Workers + D1 Setup laut `docs/EINRICHTUNG.md` ausführen, Bootstrap-Secret als Worker-Secret setzen, Schema `backend/schema.sql` initial anwenden. Für spätere Versionen siehe `backend/migration-v2.2.sql`. Anschließend die Worker-HTTPS-Adresse in `v2/config.js` eintragen. Erst dann mit synthetischen Fahrerdaten Anmeldung/Schichten/Fahrten auf **zwei echten Smartphones** prüfen. Vor Echtdaten: Datenschutz- und Dokumentenfreigabe.

## Tests

`node --experimental-sqlite tests/api-integration.mjs` – 64 Assertions bestanden (30.10.2026, SQLite Testadapter). JavaScript-Syntax geprüft. Keine Produktions-Backend-/Geräte-End-to-End-Verifikation. Tests sind keine Sicherheitszertifizierung.

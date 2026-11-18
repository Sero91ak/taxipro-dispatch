# TaxiPro Dispatch – Umbau und Erweiterung der vorhandenen Web-App

Das vorhandene Rollenportal läuft unter `/v2/app.html`; die interaktive Demonstration mit erfundenen Kundendaten unter `/v2/index.html`.

- **Disponenten-Portal:** Aufträge, Kunden, Fahrer, Tageskontrolle, Serienfahrten, Schichtkorrekturen, GPS-Positionen (mit Zeitstempel), Messenger, verschlüsselter Export.
- **Fahrer-Portal:** eigene Aufträge, Annehmen/Abschließen, Schichtstart/-ende, echte Pausenerfassung, Navigation, Standortfreigabe und Nachrichten.
- **Datenspeicherung:** Die tatsächliche Rollenverwaltung und die Synchronisierung laufen ausschließlich über `backend/worker.js` + `backend/schema.sql`. Ein kostenloses Cloudflare-Workers-/D1-Projekt muss einmalig eingerichtet werden; ein eigener Mietserver ist nicht nötig.
- **Sicherheitsgrenze:** `v2/config.js` enthält absichtlich **keine** aktive API-Adresse. Ohne Konfiguration können sich Fahrer nicht anmelden. Keine echten Patienten-, Kunden-, KTS- oder GPS-Daten in der öffentlich verfügbaren Demo erfassen.
- **Migrationsgrenze:** Die bisherigen Root-Links `home.html`, `dispatch.html`, `driver.html` und der Altbestand bleiben benutzbar; es findet keine automatische Übernahme alter Daten statt.
- **Betriebssystemgrenze:** Eine PWA ist keine native Dauer-GPS-App, insbesondere nicht im gesperrten iPhone. Die letzte bestätigte Position wird deshalb zeitlich gekennzeichnet.

Aktueller Funktions- und Sicherheitsstatus: [docs/V22-STATUS.md](../docs/V22-STATUS.md). Cloudflare-Konfiguration: [Einrichtung](../docs/EINRICHTUNG.md).

Die Disponenten- und Fahrerbereiche benutzen die gemeinsame Cloudflare-API und dieselben Kunden- und Fahrer-IDs. Die bestehende PWA-Identität `./app.html` bleibt unverändert: keine zweite App-Installation. KTS-/RE-Status und einzelne Fahrten werden in einer einheitlichen Dispositionssicht zusammengeführt. Die Google-Quellenanbindung benötigt eigene sichere OAuth-Freigaben; die bestehende ChatGPT-Verbindung kann nicht als App-Schlüssel verwendet werden.

CI-Prüfung: `node --experimental-sqlite tests/api-integration.mjs` sowie die getrennten Community- und Masterdaten-Tests.

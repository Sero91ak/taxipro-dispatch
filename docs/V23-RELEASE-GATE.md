# TaxiPro 2.3 – Betriebs- und Freigabeprotokoll

**Status:** Entwicklungsbranch / Pull Request #9. Die bisherige GitHub-Pages-TaxiPro-App bleibt unverändert. **Keine Produktivfreigabe und keine Datenmigration mit Echtdaten.**

## 1. Verbindliche Architektur

| Komponente | Funktion | Aktueller Zustand |
|---|---|---|
| GitHub Pages /v2/app.html | Responsive Fahrer- und Disponenten-UI | Quellcode vorhanden, erfordert Backend |
| Cloudflare Workers + D1 | Authentifizierung, Schichten, Pausen, Fahrten, Chat, Verkehrsberichte, Fahrertausch | Code vorhanden, **nicht mit einer Live-API verbunden** |
| Cloudflare R2 (privat) | Geschützte PDF-/Foto-Dateien und Unterschriftenbilder | Optionale Integration programmiert, **kein Bucket eingerichtet** |
| Github Actions / traffic-feed.json | Öffentliche Autobahnmeldungen, ca. 15 Min. | Bestehender öffentlicher Datendienst |
| MapLibre / OpenFreeMap | Kartenkacheln und Ereignismarkierungen | Frontend-Integration; Internet benötigt |
| OneSignal | Echte Web-Push-Benachrichtigungen im Hintergrund | **TaxiPro-App nicht eingerichtet** (die verbundenen OneSignal-Apps gehören zu anderen Projekten) |
| Google Drive | Firmenarchiv für Originalbelege | In Drive vorhanden, aber **keine serverseitige App-OAuth-Freigabe** für TaxiPro |

**Keine** geheimen Schlüssel, persönlichen PINs oder Echtpersonen-/Gesundheitsdaten in GitHub speichern. Nicht veröffentlichte Dokumente gehören weder in GitHub Pages noch in öffentlich lesbare Google-Drive-Links.

## 2. Funktionsbereich und Freigabegrenzen

**Arbeitszeit:** Schichtstart, Schichtende und echte Pausen werden serverseitig mit Ereigniszeit gespeichert. Tages-, Monats- und Jahresreport in Europe/Berlin berücksichtigt Nachtschichten, Uhrzeitumstellungen und offene Schichten bis zum Serverzeitpunkt. Die Berechnung ist rein technisch (Brutto, Pause, Netto), ohne Zuschläge, arbeitsrechtliche Einzelfallauswertung oder Tarifentscheidung. Änderungen sind auditierbar. Die Anzeige aktualisiert sich bei synchronisierter App; der serverseitige Zeitraum läuft weiter, auch wenn das Gerät offline ist.

**GPS:** Freiwilliger Fahrer-Start während aktiver Schicht, nur solange das Betriebssystem die PWA tatsächlich im Vordergrund ausführt. Kein zuverlässig kontinuierliches iPhone-GPS bei geschlossener/gesperrter PWA. Positionspunkte werden bei Pause/Schichtende gelöscht; die Zentrale muss den letzten Meldezeitpunkt anzeigen. Die rechtliche Grundlage, Zweckbindung, Aufbewahrungsfristen, Mitarbeiterinformation und gegebenenfalls Mitbestimmung/Datenschutz-Folgenabschätzung sind vor Freigabe zu klären.

**Verkehr:** Nur amtliche offene Meldungen und interne Fahrerberichte zu Stau, Unfall, Baustelle, Sperrung, Gefahr. Jeder interne Bericht hat einen Standortpunkt, meldende Person, Zeit, Ablauf und Erledigtstatus. Manuelle Ortsauswahl auf der Karte oder einmalige GPS-Freigabe. Meldung wird automatisch im Teamchat angekündigt. Nach §23 Abs.1c StVO keine aktiven Radar-/Polizeikontrollwarnungen während der Fahrt, daher kein entsprechender Fahrermodus.

**Community:** Gruppennachrichten und private Fahrer-zu-Fahrer-/Fahrer-zu-Zentrale-Nachrichten, Fahrertausch nur nach Zustimmung des Ziel-Fahrers und Freigabe durch die Disposition. Private Chat-Inhalte sind nur für Sender und Empfänger sichtbar; Adminzugriff auf Teamnachrichten, nicht auf alle privaten Nachrichten ohne weitere Rechtsgrundlage.

**Dokumente:** PDF/JPEG/PNG/WebP bis 5MB, Upload als privates Objekt mit Autor, Empfänger, Datum, Bezeichnung und Betreff. Zugriff nur für Sender/Empfänger, persönliche Pins. Keine öffentliche PDF-URL, keine direkte Google-Drive-Freigabe. Vor Echtdaten sind Malware-Scan, Aufbewahrung/Löschung, DSGVO-Verarbeitung und Datensicherung zu klären; die Implementierung ist keine abschließende Sicherheitsabnahme.

**Unterschriften:** Ein handschriftliches PNG samt aufgeführter Fahrten und Unterzeichner für mehrere Fahrten desselben Kunden desselben Tages. Nur berechtigter Fahrer erfasst; Zentrale kann Nachweis lesen. Ein solches Bild ist **keine automatisch qualifizierte elektronische Signatur** und keine Garantie der Anerkennung durch Krankenkassen; Signaturkontext, Vertretung, Prüfbarkeit und Vertragsanforderungen separat abnehmen.

**Push:** Im aktuellen v2.3-Code nur In-App-Abgleich ca. alle 45 Sekunden im Vordergrund und optionale Vordergrund-Systembenachrichtigung. Echte Web-Push-Zustellung bei beendeter App ist noch nicht eingerichtet. Für iPhone benötigt sie geeignete iOS-Version, zum Home-Bildschirm installierte Web-App, ausdrückliche Erlaubnis und einen rechtssicher konfigurierten Push-Anbieter/Server. Die anderen OneSignal-Apps nicht verwenden.

## 3. Sichere Einrichtung

Nur nachdem ein **kostenloser, zulässiger** Cloudflare Worker/D1-Tarif für die geplante Nutzung geprüft wurde:

1. Im eigenen Cloudflare-Konto einen Worker, eine D1-Datenbank und optional einen **privaten** R2-Bucket bereitstellen. Keine öffentlichen R2-URLs. API-Bindung `DB`, Datei-Bindung `ATTACHMENTS`.
2. Bei neuer Datenbank `backend/schema.sql` installieren, bei bereits vorhandener Version 2.2 ausschließlich `backend/migration-v2.3.sql` ausführen. Vorher verschlüsseltes Backup und Transaktions-/Migrationsprüfung.
3. Worker mit `APP_ORIGIN=https://sero91ak.github.io` und sicherem `BOOTSTRAP_SECRET` deployen; Secrets nur in Cloudflare hinterlegen.
4. Einmalig Admin-Konto über gesicherten Einrichtungsprozess initialisieren. Keine geheimen Angaben in GitHub Issues, PRs, Chat oder Browser-URL.
5. Nach erfolgreichem Live-Backend-Test die öffentliche **HTTPS Worker-URL** (ohne Geheimnis) in `v2/config.js` eintragen; bisher ist sie absichtlich leer.
6. Mit synthetischen Fahrern auf **zwei unterschiedlichen echten Geräten** Login, Rollentrennung, Schicht/Pause, Zeitberechnung, Chat, GPS, Karte, Dokumente/Signatur und Verbindungsverlust testen.
7. Eine **eigene TaxiPro-Push-Anwendung** einrichten. Sender/Empfänger, Abmeldung, Opt-in und Web-Push-Server authentifizieren; kein Push der Patientendaten auf Sperrbildschirm.
8. Firmenarchiv: optional später serverseitigen Google Drive OAuth-Zugriff im Taxi-Meckenheim-Archiv mit restriktivem Scope einrichten. Ein bloßes verbundenes ChatGPT-Google-Drive-Konto ist keine Anwendungsberechtigung der Fahrer-PWA.
9. Benutzerrollen und personenbezogene Daten DSGVO-konform prüfen; Backups, Löschfristen, AV-Verträge und Zugriffprotokollierung festlegen.
10. Preisgrenzen der Gratisdienste kontrollieren. Die App darf keinen automatischen Wechsel auf kostenpflichtige APIs/Tarife auslösen; keine Garantie unbegrenzter kostenloser Nutzung.

## 4. Prüfungen

`node --experimental-sqlite --test tests/community-policy.test.mjs tests/time-summary.test.mjs`

`node --experimental-sqlite tests/api-integration.mjs`

**Freigabekriterium:** Beide CI-Workflows grün, Browser-End-to-End-Tests auf Desktop/iOS/Android erfolgreich, Cloudflare Backend+R2 real erreichbar, DSGVO- und Vertragsprüfung abgeschlossen. PR #9 nicht mergen, solange Kernregression fehlschlägt.

## 5. Offene Punkte

- Echtes Hintergrund-Web-Push einschließlich Benachrichtigungen bei geschlossener App.
- Cloudflare-Backend-Deployment und private R2-Konfiguration (nicht aus GitHub allein möglich).
- Drive-Archivierung mit individueller Berechtigung und Aktenstruktur, kein öffentliches Teilen.
- Digitaler unterschreibbarer PDF-Nachweis / verbindliches KTS-Vertragsformat.
- Unabhängige sicherheits- und datenschutzrechtliche Abnahme für Patientendaten.
- Belastungs- und mobile Praxistests, Fehlerprotokollierung, Backup/Restore.
- Eine echte kontinuierliche Hintergrundortung unter iOS erfordert andere technische Voraussetzungen als eine PWA.

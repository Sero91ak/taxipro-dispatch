# TaxiPro 2.4 – Ein Disponenten- und Fahrerzustand auf jedem Gerät

> Freigabe: ENTWICKLUNGSSTAND (auf PR #10, abhängig von PR #9). Keine Echtkundenmigration, kein Push zu `main`, keine Freigabe durch den Erfolg einzelner CI-Tests.

## 1. Tatsächlich geprüfte Google-Quellen

Die verbundenen ChatGPT-Konten zeigen **zwei verschiedene Google-Kalenderkonten**: ein privates Konto und ein Taxi-Meckenheim-Konto. Die Taxi-Kalender enthalten einen betrieblichen Hauptkalender und separate Kalender für Fahrer, Schultermine, Urlaub und Feiertage. **Diese Kalender dürfen nicht unterschiedslos als Kundenfahrten importiert werden**.

In Google Drive wurde eine laufende Tabellenmappe `MASTER – Kunden- & Fahrtenverwaltung 2026 – AKTUELL` identifiziert. Es gibt u. a. exakt benannte Register `Kundenstamm`, `Verordnungen`, `Genehmigungen`, `Dokumenten-Zuordnung`, `Streckenpreise 2026` und `Fahrten August 2026`.

Folgende Feldzuordnung wurde aus den **echten Spaltenköpfen** abgeleitet (keine produktiven Patientendatensätze in GitHub):

| Quelle | Feld | Gemeinsames Datenmodell | Zuordnungsregel |
|---|---|---|---|
| Kundenstamm | Kunden-ID | `customer_source_links.external_key` | Stabiles `K####`, bevorzugter Schlüssel |
| Kundenstamm | Nachname / Vorname | `customers.name` | Nur Namensergänzung, nicht allein eindeutige Identität |
| Kundenstamm | Telefon | `customer_case_status.phone` | Dispositionsberechtigte; kein öffentlicher Link |
| Kundenstamm | Stammziel / Einrichtung | `customer_routes` | Stammziel, Startadresse muss ggf. ergänzt werden |
| Kundenstamm | Zuzahlung/Befreiung | `customer_source_evidence` | **Quellhinweis**, keine automatisch gültige Befreiung |
| Genehmigungen | Genehmigung-ID / Kunden-ID / Prüfstatus / Gültig bis | `customer_source_evidence` | Status muss vom Disponenten geprüft werden |
| Verordnungen | Verordnung-ID / Kunden-ID / Gültig bis | `customer_source_evidence` | Kein Diagnosetext im Sync |
| Taxi-Kalender | Event-ID / Beginn / Titel / Status | `calendar_imports` | Eindeutig pro Kalender + Event-ID, Wiederholungen nicht verschmelzen |
| Google Kontakte | Name / Telefon | Manuelle On-demand-Suche | Nur eigenes `contacts.readonly`-OAuth; keine automatische Patientenidentifikation |
| Fahrtenjournal | Datum, Kunde, Strecke, Richtung | `journey_ledger` | Erst geplant → gemeldet → nach Prüfung bestätigt |

**WICHTIG:** Die Tabellenregister `Fahrten August 2026`, `Dokumenten-Zuordnung` und `Streckenpreise 2026` wurden in der Quellstruktur erfasst, aber die Version 2.4 importiert daraus **noch nicht automatisch alle historischen Fahrt-, Preis- oder Dokumentdetails**. Die Daten bleiben im Original erhalten, bis eine separate, geprüfte Migration programmiert und getestet wurde. Es dürfen niemals erfundene Preise oder Erstattungsstatus entstehen.

## 2. Ein einziges maßgebliches System

```
Google Kalender Taxi --OAuth readonly--> Quellenabgleich --+
                                                          |
Google Master-Sheets ---OAuth readonly--> Kunden/KTS/RE --+--> Cloudflare Worker (RBAC)
                                                          |          |
Google Kontakte -------OAuth readonly--> Suche bei Bedarf+          D1
                                                                     |
                                              +----------------------+
                                              |
                           TaxiPro Disposition (Desktop/Tablet)
                           TaxiPro Fahrer (iPhone/Android/PWA)
                           ------------------------------
                           Ein Nutzer-/Rechtesystem
                           Ein gemeinsamer Bearbeitungszustand
                           Ein identischer Datenstand nach Abgleich
```

**Verbindlich:** Der zentrale Geschäftszustand liegt in D1, nicht in `localStorage`, `sessionStorage` oder in einem Github-JSON. Arbeitszeiten, Fahrtfreigaben, KTS/RE-Bearbeitungsstatus, Zuordnungen, Chats und Signaturen haben serverseitige IDs. Sessions dürfen temporär nur für Authentifizierung gespeichert werden. Die App muss Datenquellen und letztes erfolgreiches Abrufdatum anzeigen. Eine grüne Onlineanzeige garantiert nicht, dass Google selbst aktuell synchronisiert wurde.

**Geräteansicht:** Dichte, Menübreite, letzte geöffnete Seite, Kundenakte und Datumsauswahl werden im Backend pro Disponent gespeichert. Optimistische Revisionen verhindern, dass ein älteres Smartphone unbemerkt den zuletzt von einem anderen Gerät gespeicherten Zustand überschreibt. Team- und Kundendaten sind unabhängig von der individuellen Darstellung für alle entsprechend berechtigten Personen identisch.

## 3. Verbindlicher Fahrtablauf

1. **Kalendereintrag:** Import nur als geplanter Termin, niemals automatisch „gefahren“.
2. **Kundenkennung:** `K####` darf bei eindeutigem Treffer automatisch zugeordnet werden. Ein Namensmatch ist lediglich ein Kandidat. Doppelter Name oder widersprüchlicher Kunde: Prüfliste.
3. **Strecke:** Pro Kunde beliebig viele Strecken (z. B. Marienhospital, Waldkrankenhaus), jeweils Start, Ziel, Richtung, KTS/RE-Klasse. Kein automatischer Transfer fremder Kundenfahrten.
4. **Fahrtjournal:** Eintrag separat als `planned`, `reported` oder `confirmed`; beim Nachtragen kann die Disposition Hin- und Rückfahrt einzeln hinzufügen.
5. **Genehmigung/Verordnung/Befreiung:** Unabhängige Prüfstatus; ein „Befreit“ im Master ist noch kein Nachweis gültiger Befreiung am Leistungsdatum.
6. **Abschluss:** Erst bestätigte oder als gefahren gemeldete und bezüglich Richtung eindeutige Journalfahrten gelangen auf den Unterschriftszettel.
7. **Unterschriftszettel:** Firmenkopf zentriert, kompakte Fahrtzeilen, **keine Preise oder Wartezeiten**, nur **eine Unterschrift für alle Fahrten**, als Druck/PDF aus geschützter Dispositionsoberfläche.
8. **Abrechnung:** KTS und RE bleiben getrennte Bearbeitungsklassen. Aus einer unterschriebenen Fahrt folgt nicht automatisch Krankenkassenanerkennung oder Bezahlung.

## 4. Dashboard-Design

**Desktop:** Ruhiges Nachtblau, mattes Gold, gedämpftes Türkis. Kompakter linker Navigationsbereich, 5 Kennzahlen nebeneinander, Fahrtenjournal, Quell- und Prüffehler, anschließende Kartenübersicht. Sichtbare Trennlinien, konsistente Statusmarkierungen, kurze Tabellenzeilen. Optional schmaler Menümodus (88 px). Keine dekorativen Popups über wichtigen Fahrtangaben.

**Tablet/Smartphone:** Responsiv 2-spaltige Kennzahlen, scrollbare Datenmatrix, formularfreundliche Eingabefelder, keine versteckten Status, Touch-geeignete Schaltflächen und A4-Drucklayout. Die Ansicht ist nicht dieselbe starre Desktopbreite, aber sie zeigt dieselben serverseitigen Daten.

**Statusfarben:** RE gelb, private Fahrten blau, FP grün in der vorhandenen Kalenderkonvention. UI-Verarbeitungsstatus sind *zusätzlich* eigenständig, nicht aus Kalenderfarben als Zahlungs- oder Genehmigungsbeweis abzuleiten.

## 5. OAuth- und Datenschutz-Einrichtung

Die derzeit mit ChatGPT verbundenen Google-Dienste verleihen **keine** Google-OAuth-Berechtigung für eine frei gehostete TaxiPro-Web-App. In Cloudflare müssen die nachfolgenden *privaten* Secrets, getrennt nach Quelle, hinterlegt werden:

```
GOOGLE_TAXI_CLIENT_ID
GOOGLE_TAXI_CLIENT_SECRET
GOOGLE_TAXI_REFRESH_TOKEN
GOOGLE_TAXI_CALENDAR_ID

GOOGLE_MASTER_CLIENT_ID
GOOGLE_MASTER_CLIENT_SECRET
GOOGLE_MASTER_REFRESH_TOKEN
GOOGLE_MASTER_SHEET_ID

GOOGLE_CONTACTS_CLIENT_ID
GOOGLE_CONTACTS_CLIENT_SECRET
GOOGLE_CONTACTS_REFRESH_TOKEN

ENABLE_GOOGLE_SYNC = "false"   # erst nach Sicherheitsprüfung aktivieren
```

Wichtige OAuth-Scopes: `https://www.googleapis.com/auth/calendar.readonly`, `https://www.googleapis.com/auth/spreadsheets.readonly`, optional `https://www.googleapis.com/auth/contacts.readonly`. Google-Zugriff ist **nur lesend**. Dateiarchivierung oder Kalendereinträge zurückschreiben erfordern eigene, noch nicht eingerichtete Schreibrechte und getrennte Prüfung. Keine Klartexttokens in GitHub, Screenshots, issue-Texten oder öffentlich ausgeliefertem JavaScript.

Cloudflare `DB`-D1-Bindung und optional `ATTACHMENTS`-privater R2-Speicher aus v2.3 bleiben erforderlich. Einmalige, getestete Migration: `backend/migration-v2.4.sql` nach Schema v2.3, mit Backup. Für Neuinstallationen ausschließlich `backend/schema.sql` verwenden. Keine alte Migration ein zweites Mal ausführen.

**Zeitplan:** Der Worker bietet einen optionalen, explizit aktivierbaren Cron-Abgleich; Kalenderintervalle und vollständiger Initial-/Historienimport müssen vor Freigabe anhand des tatsächlichen Datenvolumens erprobt werden. Die Google-Abfrage ist nicht „unendlich frei“: OAuth, API-Limits, Cloudflare-Quoten und R2-Speichergrenzen gelten. Es wird kein kostenpflichtiger Plan aktiviert.

## 6. Freigabesperre

Der Stand aus PR #10 baut auf PR #9 auf und bleibt vorerst im Entwicklungsbranch. Die produktive Website und bisherige Fahrer-App sind davon **nicht automatisch geändert**.

Vor Merge in `main`:
1. Beide PRs mit sämtlichen Regressionstests grün.
2. Cloudflare Worker/D1/R2 vorhanden, Datenbackup und OAuth-Secrets nur in Cloudflare.
3. Mindestens zwei getrennte reale Geräte mit Testkonten: dieselben Fahrten, derselbe Status und dieselben Einstellungen.
4. Live-Abgleich Taxi-Kalender und Master-Sheets: Quellstand, Namenskonflikte, Zeiträume, Vor-/Rückfahrt und Fallunterscheidung RE/KTS prüfen.
5. Datenschutz- und Sicherheitsprüfung für Patientendaten, Kassenbelege, GPS, Kontakte und Unterschriften; Berechtigungssystem testen.
6. Danach schrittweise Freigabe, ohne bestehende Kalender- und Drive-Originale zu überschreiben.

## 7. Noch nicht implementiert

Automatische sichere Google-Drive-Aktenarchivierung, vollständiger Import aller historischen Monatsblätter/KTS-/RE-Preisregeln, echte Offline-Änderungswarteschlange, sichere Konfliktauflösung für parallele Änderungen an Geschäftsdatensätzen, Hintergrund-Web-Push über OneSignal/VAPID, native Dauer-GPS-Funktion und verifizierte direkte Kassen-PDF-Formulare. Diese Funktionen dürfen in der Oberfläche nicht als bereits produktiv bezeichnet werden.

# TaxiPro 2.4 – echte Google-, OneSignal- und Claude-Anbindung
Stand: 18.11.2026 · ausschließlich bestehendes GitHub-Projekt `Sero91ak/taxipro-dispatch`

> **Status:** Code und Einrichtungsansichten implementiert; keine live geschalteten Zugangsdaten. Die ChatGPT-Connector-Berechtigungen können technisch **nicht** als Google-OAuth-Refresh-Token oder Anbieter-API-Key der separat betriebenen TaxiPro-App genutzt werden. Keine Zugangsdaten in GitHub, Chat, URLs oder Screenshots eintragen.

## Bereits geprüfte Google-Quellen

- Taxi-Kalender: Google-Konto der Taxi-Zentrale; nur festgelegte, echte Fahrtenkalender lesen, keine Mitarbeiterurlaube als Fahrten importieren.
- Google-Drive-Master: vorhandene Tabelle mit `Kundenstamm`, `Genehmigungen`, `Verordnungen`, `Dokumenten-Zuordnung`, `Streckenpreise 2026` und Monatsblättern.
- Google Kontakte: Name und Telefon ausschließlich über individuelle, disponentenberechtigte Suche; keine automatische Identitätsverknüpfung nur anhand eines Nachnamens.
- Belegzuordnung: Master-Register `Dokumenten-Zuordnung` Spalten `A:D`, `F:G`, `N`. Nur als **Eindeutig/Bestätigt** markierte Kunden-ID-Verknüpfungen erscheinen als Dokument-Metadaten. `Wahrscheinlich` bleibt zurückgestellt; keine PDF-Bytes, Diagnosen, Original-URLs oder Versichertennummern werden in die öffentlichen Quellen exportiert.
- Ein Kalenderereignis gilt zunächst nur als geplant. Die Fahrt muss gemeldet und anschließend ausdrücklich geprüft werden.

## Noch notwendige Einrichtung im Cloudflare-Konto

1. Im **vorhandenen** Cloudflare-Projekt den TaxiPro Worker und die private D1-Datenbank bereitstellen. Bei bestehender 2.3-Datenbank vor **einmaliger** `backend/migration-v2.4.sql`-Ausführung ein wiederherstellbares Backup erstellen.
2. In Google Cloud ein eigenes OAuth-Webclient-Projekt für **TaxiPro** konfigurieren, inklusive erlaubtem sicheren Callback und Consent Screen. Keine Google-Cloud-API-Anmeldung über ChatGPT-Token erzwingen.
3. Den Taxikonto-Zugriff ausdrücklich für `calendar.readonly` erteilen. Für das Konto, das die Kunden-Mastertabelle enthält, `spreadsheets.readonly` erteilen. Für Google Kontakte separat `contacts.readonly`. Falls alle drei Quellen demselben Konto gehören, lassen sich die Freigaben bei entsprechender Zweckbindung zusammenlegen; keine unnötigen Vollzugriff-Scopes anfordern.
4. Nur in **Cloudflare Secrets**, niemals im öffentlichen Repository, hinterlegen:

```text
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
```

5. Erst nach positiven synthetischen Importtests und Rechteprüfung `ENABLE_GOOGLE_SYNC="true"` setzen und kontrollierten Kalender-Cron aktivieren. Die Quellenstatus-Seite darf `Konfiguriert` nicht als `Live erfolgreich geprüft` darstellen. Die echten letzten Synchronisierungszeitpunkte liefert `/api/ops/sources`.

## OneSignal – neue TaxiPro-App, nicht DĀR AL TAWḤĪD

In dem verbundenen OneSignal-Konto existieren derzeit nur `DĀR AL TAWḤĪD APP` und `TAWḤĪD KIDS`. Es gibt keine TaxiPro-App. Die verfügbaren ChatGPT-OneSignal-Aktionen enthalten keine Funktion zum Erstellen einer weiteren OneSignal-App.

1. Im <https://dashboard.onesignal.com/> eine **eigene** App `TaxiPro Meckenheim` erstellen und **Web Push** für `https://sero91ak.github.io` konfigurieren, inklusive korrektem GitHub-Pages-Unterpfad `/taxipro-dispatch/v2/`. Mit OneSignal-SDK v16 testen.
2. Die neue **App-ID** als `TAXIPRO_ONESIGNAL_APP_ID`, den neuen **REST API Key** ausschließlich als Cloudflare Secret `TAXIPRO_ONESIGNAL_REST_API_KEY` einrichten.
3. Erst nach technischer Testzustellung `PUSH_ENABLED="true"` und ein kleines hartes `PUSH_DAILY_MAX_REQUESTS` setzen. Standard ohne diese Werte: **keine Push-Sends**. Der Code verwendet nur angefragte Geräte-Subscription-IDs, **keine** unbestätigten `external_id`-Identitäten.
4. OneSignal nutzt `v2/push/OneSignalSDKWorker.js` mit getrenntem Scope; die vorhandene Offline-PWA `v2/sw.js` wird nicht ersetzt. Auf iPhone ist für Web Push die Installation zum Home-Bildschirm plus systemseitige Erlaubnis erforderlich.
5. Push enthält bewusst nur „Neue Nachricht“ bzw. „Neue Verkehrsmeldung“, keine Personen, Patientendaten, Abholadressen oder Routen. Nur nach Nutzer-Opt-in senden. Ein Nachrichtenerfolg hängt **nicht** von OneSignal ab.

## Claude (Anthropic)

Eine ChatGPT-Plugin-Verbindung zu Anthropic/Claude wurde nicht gefunden. Claude API erfordert einen **eigenen** Konto-/API-Schlüssel und kann kostenpflichtig sein.

- `ANTHROPIC_API_KEY` und `ANTHROPIC_MODEL` ausschließlich serverseitig als Secret/Umgebungseinstellung hinterlegen.
- `CLAUDE_ENABLED="false"` und `CLAUDE_DAILY_MAX_REQUESTS="0"` sind die sicheren Defaults: **keine API-Anfragen, keine zusätzlichen Kosten**.
- Bei ausdrücklich gewünschter, kostenpflichtiger Nutzung `CLAUDE_ENABLED="true"` sowie eine kleine, harte tägliche Maximalzahl setzen. Jede versuchte Anfrage belastet einen D1-Tageszähler; Budget-Überschreitung unterbindet weitere Aufrufe.
- Der aktuelle Endpunkt `POST /api/integrations/claude-summary` sendet nur aggregierte Zahlen (zugewiesen, angenommen, abgeschlossen, storniert) ohne Namen, Diagnosen, Orte oder Dokumente. Er ist ausschließlich für Disponenten freigegeben. Es gibt noch **keinen** datenschutzgeprüften Claude-Zugriff auf Patientenakten oder private Chats.

## Unverändert bestehende TaxiPro-App

Die bereits installierten Zentrale-/Fahrer-Startadressen `dispatch.html` und `driver.html` bleiben dieselben. Die Umstellung auf das überarbeitete Portal erfordert später ein gültiges Worker-Backend sowie `TAXIPRO_ENABLE_UPGRADED_ENTRIES=true`. **Derzeit bleibt das Flag bewusst aus.**

## Abnahmeprotokoll

- [ ] Sichere Worker- und D1-Bindung samt Backup durch Betreiber eingerichtet
- [ ] Exakte Google OAuth-Scopes und die beiden Quellkonten autorisiert
- [ ] Echte Kalender-, Kunden-, Dokumenten- und Kontakte-Abfragen mit Testkonten erfolgreich
- [ ] Neue OneSignal-TaxiPro-App erstellt, eigene Berechtigung und Web-Push-Geräte getestet
- [ ] Claude nur nach tatsächlicher Kosten-/Datenschutzfreigabe aktiviert
- [ ] Komplette Regressionstests grün, Zwei-Geräte-Zustand identisch, keine PII in Push oder Claude
- [ ] Erst nach abschließender Abnahme PR #9 und #10 mergen, produktive App freischalten

**Hinweis zur Kostenkontrolle:** API-Limits mindern Risiken, ersetzen aber keine Anbieter-seitigen Rechnungssperren und Tarifprüfung. Ohne explizite Aktivierung bleibt die Zahl neuer Push-/Claude-Anfragen bei null.

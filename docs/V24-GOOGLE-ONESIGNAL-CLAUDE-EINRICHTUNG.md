# TaxiPro 2.4 – echte Google-, OneSignal- und Claude-Anbindung
Stand: 19.11.2026 · ausschließlich bestehendes GitHub-Projekt `Sero91ak/taxipro-dispatch`

> **Status:** Code und Einrichtungsansichten implementiert; keine live geschalteten Zugangsdaten. Die ChatGPT-Connector-Berechtigungen können technisch **nicht** als Google-OAuth-Refresh-Token oder Anbieter-API-Key der separat betriebenen TaxiPro-App genutzt werden. Keine Zugangsdaten in GitHub, Chat, URLs oder Screenshots eintragen.

## Verbindliche Hauptkonto-Entscheidung vom 19.11.2026

**Für künftige TaxiPro-Anbieter-OAuth-Logins verwenden: `sero91ak@gmail.com` (091), nicht `info@meckenheim-taxi.de`.** Die vorige Empfehlung, das Taxi-E-Mail-Konto zum primären Google-Account der App zu machen, ist korrigiert.

- Das **persönliche** Google-Konto sieht den geteilten Betriebskalender `info@meckenheim-taxi.de` bereits mit Besitzer-/Zugriffsrolle; zugleich liegt dort das Drive-Master-Sheet „MASTER – Kunden- & Fahrtenverwaltung 2026 – AKTUELL“. Kalendername und OAuth-Konto dürfen nicht verwechselt werden.
- `backend/google-sync.js` akzeptiert jetzt einen **gemeinsamen** geheimen OAuth-Credential-Satz (`GOOGLE_PRIMARY_*`) für den ausdrücklich ausgewählten Taxi-Kalender, das Master-Sheet und optional die persönlichen Kontakte. Es werden trotzdem nur die zwei vordefinierten, getrennt konfigurierten IDs für Kalender und Sheet gelesen. Vorhandene ältere `GOOGLE_TAXI_*`, `GOOGLE_MASTER_*` und `GOOGLE_CONTACTS_*` bleiben als **Fallback** kompatibel.
- Wenn die Hauptkonto-Credentials gesetzt sind, werden diese **bevorzugt**. Die Aktualisierung löscht oder verändert keine Termine, Tabellen oder Legacy-Secrets. Ein Hinterlegen der Credentials ersetzt keinen echten erfolgreichen Abgleich.

### Dokumente in beide Richtungen: bewusst separate Schreibfreigabe

**Aktuell implementiert:** Lesen der Master-Tabellen und Zuordnen geprüfter Dokument-Metadaten in TaxiPro. **Noch nicht implementiert:** Ein vollständiger Live-Upload/-Download aller Dokumente über Google Drive, Dateiänderungen am Original oder bidirektionale konfliktfreie Synchronisierung.

Für zukünftigen, ausdrücklich freigegebenen Dokumentenaustausch muss das TaxiPro-Backend separat ein begrenztes Drive-Schreibrecht wie `drive.file` erhalten. Mit diesem Scope kann die App von ihr angelegte oder durch den Benutzer gezielt geöffnete/freigegebene Dateien verwalten; **nicht** ungefragt den gesamten bestehenden Drive-Bestand. Der Disponent soll Dateien gezielt in einer dedizierten geschützten TaxiPro-Ablage auswählen; Backend prüft Kundenakte, berechtigte Rolle, Dateityp, erlaubte Dateigröße, Zuordnung, Version und Audit-Log. Kein Browser-/GitHub-Secret, kein unbeaufsichtigtes Überschreiben, keine Patientenakten ohne Datenschutz- und Berechtigungsprüfung.

## Bereits geprüfte Google-Quellen

- Taxi-Kalender: Google-Hauptkonto `sero91ak@gmail.com` kann den separat freigegebenen Kalender `info@meckenheim-taxi.de` bereits sehen. Nur diesen ausdrücklich ausgewählten Fahrtkalender lesen; keine persönlichen Kalender oder Mitarbeiterurlaube als Fahrten importieren.
- Google-Drive-Master: vorhandene Tabelle mit `Kundenstamm`, `Genehmigungen`, `Verordnungen`, `Dokumenten-Zuordnung`, `Streckenpreise 2026` und Monatsblättern.
- Google Kontakte: Name und Telefon ausschließlich über individuelle, disponentenberechtigte Suche; keine automatische Identitätsverknüpfung nur anhand eines Nachnamens.
- Belegzuordnung: Master-Register `Dokumenten-Zuordnung` Spalten `A:D`, `F:G`, `N`. Nur als **Eindeutig/Bestätigt** markierte Kunden-ID-Verknüpfungen erscheinen als Dokument-Metadaten. `Wahrscheinlich` bleibt zurückgestellt; keine PDF-Bytes, Diagnosen, Original-URLs oder Versichertennummern werden in die öffentlichen Quellen exportiert.
- Ein Kalenderereignis gilt zunächst nur als geplant. Die Fahrt muss gemeldet und anschließend ausdrücklich geprüft werden.

## Noch notwendige Einrichtung im Cloudflare-Konto

1. Im **vorhandenen** Cloudflare-Projekt den TaxiPro Worker und die private D1-Datenbank bereitstellen. Bei bestehender 2.3-Datenbank vor **einmaliger** `backend/migration-v2.4.sql`-Ausführung ein wiederherstellbares Backup erstellen.
2. In Google Cloud ein eigenes OAuth-Webclient-Projekt für **TaxiPro** konfigurieren, inklusive erlaubtem sicheren Callback und Consent Screen. Keine Google-Cloud-API-Anmeldung über ChatGPT-Token erzwingen.
3. Bei der TaxiPro-OAuth-Freigabe als **Google-Hauptkonto `sero91ak@gmail.com`** auswählen. Dafür gezielt `calendar.readonly` und `spreadsheets.readonly` freigeben; `contacts.readonly` nur bei ausdrücklicher Nutzung von Kontakten dieses Hauptkontos. Die freigegebenen Calendar-/Sheets-Ressourcen sind durch ihre getrennten IDs beschränkt. `info@meckenheim-taxi.de` bleibt der Name des geteilten Betriebskalenders, ist aber **nicht** das Standard-OAuth-Anmeldekonto. Vor Freischaltung prüfen, dass der Hauptkonto-Token den freigegebenen Taxi-Kalender und das Master-Sheet tatsächlich lesen kann.
4. Nur in **Cloudflare Secrets**, niemals im öffentlichen Repository, hinterlegen:

```text
GOOGLE_PRIMARY_CLIENT_ID
GOOGLE_PRIMARY_CLIENT_SECRET
GOOGLE_PRIMARY_REFRESH_TOKEN
GOOGLE_TAXI_CALENDAR_ID
GOOGLE_MASTER_SHEET_ID
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
- [ ] TaxiPro-OAuth für `sero91ak@gmail.com` mit benötigten Lesescopes autorisiert; Kalender-/Master-ID einzeln verifiziert
- [ ] Echte Kalender-, Kunden-, Dokumenten- und Kontakte-Abfragen mit Testkonten erfolgreich
- [ ] Neue OneSignal-TaxiPro-App erstellt, eigene Berechtigung und Web-Push-Geräte getestet
- [ ] Claude nur nach tatsächlicher Kosten-/Datenschutzfreigabe aktiviert
- [ ] Komplette Regressionstests grün, Zwei-Geräte-Zustand identisch, keine PII in Push oder Claude
- [ ] Erst nach abschließender Abnahme PR #9 und #10 mergen, produktive App freischalten

**Hinweis zur Kostenkontrolle:** API-Limits mindern Risiken, ersetzen aber keine Anbieter-seitigen Rechnungssperren und Tarifprüfung. Ohne explizite Aktivierung bleibt die Zahl neuer Push-/Claude-Anfragen bei null.

## Verifizierte Anbieter- und Quellenzuordnung (19.11.2026)

Diese Konten wurden mit den vorhandenen, ausschließlich für ChatGPT gültigen Zugängen **lesend geprüft**. Sie sind dadurch **nicht** automatisch als TaxiPro-Worker-OAuth autorisiert.

| Quelle | Bestätigtes Konto / Bestand | TaxiPro-Verhalten |
| --- | --- | --- |
| Google Kalender | **Hauptkonto `sero91ak@gmail.com`** sieht den separat freigegebenen Betriebskalender `info@meckenheim-taxi.de` | TaxiPro-OAuth künftig mit Hauptkonto; genau ein ausgewählter Fahrtkalender per `GOOGLE_TAXI_CALENDAR_ID`. Kein automatischer Import sämtlicher persönlicher Kalender. |
| Weitere Kalender | Fahrer, RSVG Schüler Termine, Urlaubsantrag, Schulferien und Feiertage sind im **separaten Taxi-Konto** vorhanden | Über das persönliche Hauptkonto ist deren Freigabe nicht belegt; nicht automatisch importieren. Urlaub/Feiertage sind keine Kundenfahrten. |
| Google Kontakte | Bisher über ChatGPT geprüftes Taxi-Kontakteprofil: `info@meckenheim-taxi.de`; persönliche Kontakte bisher nicht verifiziert | Bei einheitlichem Hauptkonto optional dessen `contacts.readonly`-Berechtigung separat einholen; keine falsche Behauptung, dass die Taxi-Kontakte dort ebenfalls freigegeben sind. |
| Google Drive / Master | Persönlich angebundenes Google-Drive-Konto `sero91ak@gmail.com`, Datei „MASTER – Kunden- & Fahrtenverwaltung 2026 – AKTUELL“ | Nur das exakt autorisierte Master-Sheet abfragen; nicht pauschal sämtliche Drive-Dateien oder Patientendokumente herunterladen. |
| OneSignal | Nur DĀR AL TAWḤĪD APP und TAWḤĪD KIDS vorhanden | Keine TaxiPro-App-ID vorhanden; **niemals** deren Schlüssel wiederverwenden. |
| Claude | Keine eigene Claude-API-Anwendungsberechtigung verifiziert | `CLAUDE_ENABLED=false`; mit dem gegenwärtigen Nullkosten-Ziel keine bezahlten Anfragen. |

**Quelle ist nicht gleich Integration:** Die bereits vorhandenen ChatGPT-OAuth-Zustimmungen lassen sich nicht auf einen fremden Cloudflare Worker übertragen. Kein Schreiben in die Google-Originalquellen, keine Datenübertragung an Claude, kein Push ohne eigenes TaxiPro-OneSignal-Projekt.

**Bessere Diagnose in der vorhandenen Integrationsansicht:** Die TaxiPro-Oberfläche zeigt jetzt für Disponenten getrennt den Konfigurationsstand und die tatsächlichen `sync_checkpoints` mit letztem erfolgreichen Kalender-/Master-Abgleich und aktuellem Fehlerstatus. Dabei werden keine externen Fehlermeldungen, Zugangsdaten oder Quelleninhalte an Fahrer ausgegeben.

**Nächster externer Einrichtungsschritt:** Cloudflare Worker und private D1 mit sicheren Secrets einrichten; dann Taxi-OAuth für Kalender/Kontakte und separates Master-OAuth für die oben identifizierte Tabelle im Google-Consent-Flow bestätigen. OneSignal muss im Anbieter-Dashboard als eigene TaxiPro-App angelegt werden. Bis zur erfolgreichen Testzustellung bleiben die Flags für Google-Cron, Push, Claude und die Produktivumschaltung aus.

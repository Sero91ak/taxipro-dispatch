# TaxiPro – Taxi Meckenheim GmbH

Professionelles Dispositions-System – **zwei getrennte Apps**, kostenlos, ohne API-Key.

**Startseite:** https://sero91ak.github.io/taxipro-dispatch/home.html

## Zwei Apps – getrennt installieren

| App | URL | Home-Bildschirm |
|-----|-----|-----------------|
| **Zentrale / Disponent** | `dispatch.html` | Name: **Zentrale** (Gold) |
| **Fahrer** | `driver.html` | Name: **Fahrer** (Teal) |

### Zentrale installieren (Disponent / Admin)
1. `dispatch.html` öffnen (nicht `index.html` direkt!)
2. **iPhone:** Safari → Teilen → Zum Home-Bildschirm → **Zentrale**
3. **Android:** „Zentrale-App installieren“ oder Menü → App installieren

### Fahrer-App installieren
1. Link von der Zentrale erhalten oder `driver.html` öffnen
2. **iPhone:** Safari → Teilen → Zum Home-Bildschirm → **Fahrer**
3. PIN eingeben oder Link mit Token öffnen

## Zentrale – Funktionen

- **Serienfahrten-System:** Dashboard, Serienauftrag, Prüfliste vor Freigabe, Monatslisten, Unterschriftszettel (KTS/RE getrennt), Listenimport
- Kalender (Plan / Woche / Monat), Heute-Ansicht, Kundenkatalog
- Kranken-, Rechnungs-, Privat- und Serienfahrten
- **Adresssuche kostenlos** (OpenStreetMap / Photon – 0 €)
- Google Kalender + Google Drive Sync
- Fahrer-Vermittlung: **📱 App** oder **📲 WhatsApp**
- Mobile PWA: Bottom-Nav, Schnellzugriff, Pull-to-Refresh

## Fahrer-App – Funktionen

- Nur zugewiesene Fahrten (kein Zugang zur Zentrale)
- Navigation (Google Maps Links), Anrufen, KTS / Eigenleistung
- Fahrschein-Unterschrift, Team-Chat, Schicht Start/Ende
- Push + Sync alle ~45 Sek.

## Integrierte Fahrer-Verkehrszentrale

Der Reiter **Verkehr** erscheint direkt innerhalb der bestehenden Fahrer-PWA (keine zweite App und kein App-Wechsel).

- **Karte:** MapLibre GL JS mit OpenFreeMap (kein API-Schlüssel, keine nutzungsabhängigen Gebühren durch die App).
- **Amtliche Ereignisse:** Gefahren, Straßensperrungen und Baustellen der Autobahn GmbH auf A61, A565, A555, A59, A4 und A3, gefiltert auf Meckenheim/Bonn/Rhein-Sieg/Köln.
- **Zentraler Abruf:** GitHub Actions liest planmäßig alle 15 Minuten die offiziellen Daten und aktualisiert `traffic-feed.json`. GitHub Actions kann verspätet starten; die Quelle und ihr Datenalter werden angezeigt.
- **Fahrer-Sync:** Bei geöffneter Verkehrsseite prüft die PWA alle fünf Minuten den gemeinsamen Datenstand, nicht die 18 externen Datenquellen je Fahrer.
- **Fallback:** Wenn der zentrale Datenstand nicht erreichbar oder älter als 45 Minuten ist, versucht die App die offiziellen Quellen direkt (maximal vier gleichzeitige Abfragen, keine kostenpflichtige API). Falls auch dies scheitert, zeigt sie einen klaren Hinweis. Cache-Daten bis zwei Stunden werden ausdrücklich als **veraltet** gekennzeichnet.
- **Kartenfunktionen:** zoomen, verschieben, Einträge auswählen, aktuellen Geräte-Standort einmalig mit Berechtigung anzeigen. Kein GPS-Tracking oder Versand des GPS an die Zentrale durch dieses Modul.
- **Filter:** Alle aktuellen Meldungen, Gefahren, Sperrungen, Baustellen, geplante Maßnahmen sowie einzelne Autobahnen.
- **Sicher:** Texte werden als Text dargestellt; kein HTML aus amtlichen Meldungen eingeschleust. Keine aktiven Blitzer-/Polizeikontrollwarnungen.
- **Datengrundlage:** Nur amtliche Vorfall- und Baustellenmeldungen. **Keine** flächendeckende grün/gelb/rote Live-Verkehrsfluss-Ebene, keine verkehrsabhängige In-App-Routenberechnung und keine Blitzer.de-PRO-Integration.

### Betriebs- und Kostenhinweise

Die App führt **keine** Pay-per-use-Abfragen aus und aktiviert **keine** kostenpflichtigen Tarife. GitHub Pages, GitHub Actions und die Kartendienste sind aber externe Gratisangebote mit Nutzungsregeln, möglichen Service-Limits und ohne garantierte unbegrenzte Verfügbarkeit. Die kostenlose Nutzung ist kein SLA.

**Monitoring:** GitHub → Actions → „TaxiPro – kostenlose Verkehrsdaten (Autobahn)“ kontrollieren. Falls der Workflow wegen fehlender Rechte oder Quellenausfall fehlschlägt, werden die Meldungen nicht als aktuell ausgegeben.

**Tests:** `node --test tests/traffic-feed.test.mjs tests/traffic-ui.test.mjs` und `node --check traffic-module.js`. Mit iOS Safari/Android Chrome sowie echter Netzwerkverbindung zusätzlich die Karte und Behördenquellen prüfen.

## Kosten

- App-Nutzung: **kostenlos**
- Adresssuche: **OpenStreetMap** (kein Google API-Key nötig)
- Google Maps Links zum Navigieren: kostenlos

## Google Kalender (OAuth)

In der [Google Cloud Console](https://console.cloud.google.com) Origin eintragen:

- `https://sero91ak.github.io`
- `http://localhost:8080`

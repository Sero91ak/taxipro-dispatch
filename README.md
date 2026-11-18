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

## Integrierte Fahrer-Verkehrszentrale (Entwicklung)

Der Fahrerbereich erhält einen vierten Reiter **Verkehr**. Die Karte läuft direkt innerhalb der Fahrer-PWA (kein App-Wechsel).

- MapLibre GL JS und OpenFreeMap: kostenfreie Kartengrundlage ohne API-Key.
- Amtliche Autobahn-GmbH-Daten: Gefahren, Sperrungen und Baustellen für A61, A565, A555, A59, A4 und A3, räumlich auf den Raum Meckenheim/Bonn/Köln gefiltert.
- 15-Minuten-Aktualisierung, 30-Minuten-Notcache, nur bei aktivem Fahrer-Reiter, kein kostenpflichtiger API-Fallback.
- Filter, Meldungsliste, manuelle Aktualisierung und optionaler eigener GPS-Punkt ohne zentrale Standortübertragung.
- **Wichtig:** Keine frei verfügbaren Blitzer.de-PRO-Daten, keine Radar- oder Polizeikontrollwarnungen und keine vollständige grün/gelb/rote Staufluss-Ebene. Amtliche Autobahnmeldungen sind nicht identisch mit vollständigem Echtzeit-Verkehrsfluss.
- Testen mit Fahrer-Anmeldung in `driver.html`. Karten und Meldungen benötigen Internet. Der PWA-Shell-Cache garantiert keine Offline-Karten.

## Kosten

- App-Nutzung: **kostenlos**
- Adresssuche: **OpenStreetMap** (kein Google API-Key nötig)
- Google Maps Links zum Navigieren: kostenlos

## Google Kalender (OAuth)

In der [Google Cloud Console](https://console.cloud.google.com) Origin eintragen:

- `https://sero91ak.github.io`
- `http://localhost:8080`

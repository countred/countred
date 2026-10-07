# CountRed

Ein Strategiespiel für zwei auf einem 4×4-Brett. Spielbar im Browser, ohne
Installation und ohne Anmeldung:

**→ [countred.com](https://countred.com)**

Das Spiel stammt von Walter Rehm und ist seit 1998 nachweisbar; die limitierte
Auflage als Brettspiel erschien unter dem Namen Gembel. Dieses Repository enthält
die ausgelieferten Dateien der digitalen Fassung.

> **Testversion.** Das Spiel ist offen zugänglich, aber noch nicht fertig. Regeln,
> Spielstärken und Oberfläche können sich ändern.

---

## Was es kann

- **Mit Max Michu** in drei Spielstärken: Einsteiger, Fortgeschritten, Meister
- **Zu zweit über einen Code** — eine Person erstellt einen Raum, die andere tritt
  mit dem Code bei
- **Interaktive Spielanleitung** — führt Schritt für Schritt durch die Regeln, mit
  Brett zum Mitspielen
- Läuft auf Telefon und Rechner, ohne App und ohne Konto

Die Regeln stehen in der Anleitung im Spiel, nicht hier — es soll nur **eine**
Regelquelle geben.

---

## Was hier liegt

| Datei | |
|---|---|
| `index.html` | Startseite, Brett, Oberfläche, Spiel zu zweit |
| `countred_rules.js` | Regelschicht |
| `countred_ai_core.js` | Suche und Bewertung von Max Michu |
| `countred_ai_worker.js` | führt die Suche im Hintergrund aus |
| `anleitung.html` | interaktive Spielanleitung |
| `firebase-app-10.12.0.js`, `firebase-database-10.12.0.js` | Firebase-Bibliothek (Google LLC, Apache-2.0, siehe `LICENSE-firebase.txt`) |
| Bilder, `CNAME`, `.nojekyll`, `robots.txt` | Bilder der Seite, Domain und Pages-Konfiguration |

---

## Rückmeldungen

Fehler, Ungereimtheiten und Eindrücke aus dem Spiel sind willkommen:
über das Impressum auf [countred.com](https://countred.com).

---

## Urheberrecht

© 1998–2026 Walter Rehm. Alle Rechte vorbehalten, soweit nicht anders angegeben.
Ausgenommen sind das Porträtfoto (Christian Alber) und die Firebase-Bibliothek
(Google LLC). Einzelheiten in [LICENSE](LICENSE).

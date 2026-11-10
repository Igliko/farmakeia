# Εφημερίες Φαρμακείων

Ποια φαρμακεία είναι ανοιχτά **τώρα** σε όλη την Ελλάδα, σε χάρτη: https://igliko.github.io/farmakeia/

## Τι υπάρχει εδώ

| Φάκελος / αρχείο | Τι κάνει |
|---|---|
| `index.html` | Όλο το σάιτ (χάρτης MapLibre + λίστα). Δεν έχει build, είναι ένα αρχείο. |
| `data/` | Τα δεδομένα. Γράφονται αυτόματα, μην τα αλλάζεις με το χέρι. |
| `scripts/update.mjs` | Εφημερίες Πάτρας από το vrisko.gr → `data/patra.json` (κάθε 15′). |
| `scripts/greece.mjs` | Εφημερίες υπόλοιπης Ελλάδας από το vrisko.gr → `data/greece.json`, `data/towns.json` (κάθε ~2 ώρες, 120 περιοχές τη φορά). |
| `scripts/osm.mjs`, `scripts/overture.py`, `scripts/merge.mjs` | Όλα τα φαρμακεία (και όσα δεν εφημερεύουν) από OpenStreetMap + Overture Maps → `data/all.json` (μία φορά την εβδομάδα). |
| `bot/` | Το Telegram bot (Cloudflare Worker). Διαβάζει τα `data/*.json` από το σάιτ. |

## Αυτόματες εργασίες (καρτέλα Actions)

- **Αυτόματη ενημέρωση (συνεχής)** (`loop.yml`): τρέχει ~5 ώρες και στο τέλος ξεκινάει την επόμενη. Κάνει όλες τις ενημερώσεις. Αν σταματήσει, πάτα **Run workflow**.
- **Όλα τα φαρμακεία (OpenStreetMap / Overture Maps)**: χειροκίνητη ανανέωση της μεγάλης λίστας.
- **Telegram bot**: ξαναστήνει το bot όταν αλλάζει κάτι στο `bot/`. Θέλει τα secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_TOKEN`.

## Πηγές

Εφημερίες: vrisko.gr (Φαρμακευτικοί Σύλλογοι) · Φαρμακεία: © OpenStreetMap contributors (ODbL), © Overture Maps Foundation (CDLA-Permissive-2.0) · Χάρτης: OpenFreeMap · Δορυφόρος: Esri World Imagery.

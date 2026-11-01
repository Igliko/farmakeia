# Εφημερίες Πάτρας

Ποια φαρμακεία είναι ανοιχτά **τώρα** στην Πάτρα, σε χάρτη.

- Τα δεδομένα έρχονται από το [vrisko.gr](https://www.vrisko.gr/efimeries-farmakeion/patra/) (εκεί τα στέλνει ο Φαρμακευτικός Σύλλογος Αχαΐας).
- Κάθε 30 λεπτά το GitHub Actions τρέχει το `scripts/update.mjs` και ενημερώνει το `data/patra.json`.
- Ο χάρτης είναι MapLibre με χάρτες OpenFreeMap / © OpenStreetMap.

Χειροκίνητη ενημέρωση: καρτέλα **Actions** → «Ενημέρωση εφημεριών» → **Run workflow**.

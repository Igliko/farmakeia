# Φαρμακεία της Ελλάδας από το Overture Maps (ανοιχτά δεδομένα, CDLA-Permissive-2.0) -> data/overture.json
# Τρέχει μία φορά την εβδομάδα μέσα στο GitHub Actions (εκεί υπάρχει πρόσβαση στο S3 του Overture).
# Μορφή: [lat, lng, όνομα, διεύθυνση, πόλη, τηλέφωνο, ""] — ίδια με το OpenStreetMap.
import json, os, re, subprocess, sys, datetime
import duckdb

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'overture.json')

try:
    old = json.load(open(OUT, encoding='utf8'))
    age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(old['updated'].replace('Z', '+00:00'))
    if age.days < 6.5 and not os.environ.get('FORCE'):
        print('Τα φαρμακεία Overture είναι φρέσκα.'); sys.exit(0)
except Exception:
    pass

# η τελευταία έκδοση (π.χ. 2026-10-22.0)
ls = subprocess.run(['aws', 's3', 'ls', '--no-sign-request', 's3://overturemaps-us-west-2/release/'], capture_output=True, text=True).stdout
rels = sorted(re.findall(r'PRE (\d{4}-\d{2}-\d{2}\.\d+)/', ls))
if not rels: raise SystemExit('Δεν βρέθηκε έκδοση Overture:\n' + ls)
rel = rels[-1]
print('Έκδοση Overture:', rel)
SRC = f"s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/*"

con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
cols = {r[0]: r[1] for r in con.sql(f"DESCRIBE SELECT * FROM read_parquet('{SRC}', hive_partitioning=1)").fetchall()}
print('Στήλες:', ', '.join(cols))

cat = []
if 'categories' in cols: cat.append("categories.primary")
if 'basic_category' in cols: cat.append("basic_category")
if 'taxonomy' in cols: cat.append("taxonomy.primary")
cat_sql = ' OR '.join(f"coalesce({c},'') IN ('pharmacy')" for c in cat) or 'false'
status_sql = "AND coalesce(operating_status,'open') = 'open'" if 'operating_status' in cols else ''
q = f"""
SELECT (bbox.ymin + bbox.ymax) / 2 AS lat, (bbox.xmin + bbox.xmax) / 2 AS lng,
       names.primary AS name,
       addresses[1].freeform AS street, addresses[1].locality AS town, addresses[1].country AS country,
       phones[1] AS phone, confidence
FROM read_parquet('{SRC}', hive_partitioning=1)
WHERE bbox.xmin BETWEEN 19.3 AND 29.7 AND bbox.ymin BETWEEN 34.7 AND 41.8
  AND (({cat_sql})
       OR (regexp_matches(lower(coalesce(names.primary,'')), 'φαρμακ[εέ]ι|pharmac|farmake')
           AND NOT regexp_matches(lower(coalesce(names.primary,'')), 'αποθ|apoth|warehouse')))
  AND coalesce(confidence, 1) >= 0.5 {status_sql}
"""
rows = con.sql(q).fetchall()
items = []
for lat, lng, name, street, town, country, phone, conf in rows:
    if country and country.upper() != 'GR': continue
    if not country and not re.search(r'[α-ωΑ-Ω]', name or ''): continue  # χωρίς χώρα: κράτα μόνο ελληνικά ονόματα (όχι Τουρκία/Αλβανία)
    ph = re.sub(r'[^\d+]', '', phone or '')
    ph = re.sub(r'^(\+30|0030)', '', ph)
    items.append([round(lat, 5), round(lng, 5), (name or 'Φαρμακείο').strip(), (street or '').strip(), (town or '').strip(), ph, ''])
items.sort(key=lambda r: (r[0], r[1]))
json.dump({'updated': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'), 'source': 'Overture Maps ' + rel, 'items': items},
          open(OUT, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print(f'OK: {len(items)} φαρμακεία από το Overture Maps.')

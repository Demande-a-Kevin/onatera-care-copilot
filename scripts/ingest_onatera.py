#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ingester Onatera -> data/kb.json  (ingestion OFFLINE, exécutée une fois)
------------------------------------------------------------------------
Parcourt la catégorie "Compléments alimentaires > Énergie & Vitalité"
(3 pages), récupère CHAQUE fiche produit, et construit la base de
connaissance locale lue par l'app. Ajoute aussi quelques pages support
(livraisons, conseils, aide) pour les catégories logistiques.

Principe : rien n'est scrapé pendant l'analyse d'un ticket. On fige ici,
une fois, une base LOCALE que le LLM consulte hors-ligne. C'est l'équivalent
"léger" de l'ingester Playwright utilisé ailleurs (chargemap) — à automatiser
plus tard (cf. roadmap). Les fiches curées (verifiées à la main, liées aux
tickets d'exemple) sont conservées depuis data/kb_curated.json.

Usage :
    python3 scripts/ingest_onatera.py
"""
import urllib.request, urllib.error, re, json, html as ihtml, time, sys, unicodedata, os

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36"
BASE = "https://www.onatera.com"
CAT = "/FR/fr/complements-alimentaires/vitalite"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")

SUPPORT_PAGES = [
    ("kb_support_livraisons", "livraison", "Livraisons & délais",
     BASE + "/FR/fr/info/livraisons"),
    ("kb_support_conseils", "conseil", "Conseils Onatera",
     BASE + "/FR/fr/conseils"),
    ("kb_support_aide", "support", "Centre d'aide Onatera",
     "https://support.onatera.com/hc/fr"),
]

# themes -> mots-clés d'usage, pour le retrieval lexical et la suggestion de catégorie
THEMES = {
    "fatigue": ["fatigue", "tonus", "energie", "énergie", "vitalite", "vitalité", "coup de barre"],
    "sommeil": ["sommeil", "dormir", "nuit", "endormissement", "melatonine"],
    "stress": ["stress", "nervosite", "anxiete", "detente", "relaxation", "serenite", "sérénité"],
    "immunite": ["immun", "defenses", "défenses", "hiver"],
    "fer": ["fer", "anemie", "anémie"],
    "magnesium": ["magnesium", "magnésium"],
    "vitamine_c": ["vitamine c", "acerola", "acérola", "camu", "ester-c"],
    "vitamine_d": ["vitamine d", "vitamine d3"],
    "vitamine_b": ["vitamine b", "biotine", "b12", "b9", "b8", "b5", "nadh"],
    "digestion": ["digestion", "transit", "intestin"],
    "concentration": ["concentration", "memoire", "mémoire", "cognit"],
    "sport": ["sport", "musculaire", "recuperation", "récupération", "performance"],
    "detox": ["detox", "détox", "draina", "chlorelle", "klamath"],
    "femme": ["menopause", "ménopause", "grossesse", "enceinte", "allaitement"],
    "homme": ["prostate", "libido", "bois bande", "muira"],
    "cheveux_peau": ["cheveux", "peau", "ongles"],
    "thyroide": ["thyroid", "iode"],
    "spiruline": ["spiruline", "chlorelle", "klamath", "phyco", "shilajit", "maca", "guarana",
                  "ginseng", "eleuther", "ashwagandha", "cordyceps", "chaga"],
}
STOP = {"bio", "ultra", "premium", "mg", "g", "ml", "gelules", "gélules", "comprimes",
        "comprimés", "capsules", "gommes", "ampoules", "onatera", "orfito", "poudre",
        "de", "d", "la", "le", "les", "en", "&", "-", "aux", "au", "avec", "sans"}


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
        except Exception as e:
            if i == tries - 1:
                print("  ! echec:", url, e, file=sys.stderr)
                return None
            time.sleep(1.2)


def strip_tags(s):
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub("<[^>]+>", " ", s or ""))).strip()


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return s[:48]


def product_urls():
    urls, seen = [], set()
    for p in range(1, 4):
        page = CAT if p == 1 else CAT + "?page=%d" % p
        html = fetch(BASE + page)
        if not html:
            continue
        for m in re.findall(r'href="(/FR/fr/produit-[a-z0-9\-]+)"', html):
            u = BASE + m
            if u not in seen:
                seen.add(u)
                urls.append(u)
        time.sleep(0.3)
    return urls


def parse_product(url):
    html = fetch(url)
    if not html:
        return None
    prod = None
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        if '"Product"' not in b:
            continue
        try:
            d = json.loads(b)
        except Exception:
            continue
        if isinstance(d, dict) and d.get("@type") == "Product":
            prod = d
            break
    if not prod:
        return None
    nom = strip_tags(prod.get("name", "")) or "Produit Onatera"
    sku = str(prod.get("sku", "") or "")
    brand = (prod.get("brand") or {}).get("name", "") if isinstance(prod.get("brand"), dict) else ""
    desc = strip_tags(prod.get("description", ""))

    # précautions / posologie depuis le HTML nettoyé (hors blocs script)
    no_script = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    prec = ""
    mp = re.search(r"Pr[ée]caution[s]? d['’]emploi(.{0,500}?)(?:<h|</section|Avis|Composition)", no_script, re.S)
    if mp:
        prec = strip_tags(mp.group(1))[:320]

    # mots-clés : thèmes détectés + tokens du nom
    hay = (nom + " " + desc).lower()
    kws = [t for t, terms in THEMES.items() if any(k in hay for k in terms)]
    for tok in re.split(r"[\s\-]+", nom.lower()):
        tok = re.sub(r"[^a-zà-ÿ0-9]", "", tok)
        if tok and tok not in STOP and not tok.isdigit() and len(tok) > 2:
            kws.append(tok)
    kws = list(dict.fromkeys(kws))[:12]

    # actifs : tokens signifiants du nom
    actifs = [t for t in kws if t not in THEMES][:4]

    contenu = ("Marque : %s. Reference : %s. Description et allegations AFFICHEES sur la fiche : %s"
               % (brand or "Onatera", sku or "n/a", desc[:1400]))
    if prec:
        contenu += " | Precautions affichees : " + prec
    contenu += " | (Contenu releve automatiquement sur la fiche produit, a revalider Qualite/Reglementaire avant usage.)"

    return {
        "id": "kb_prod_" + (slugify(nom) or sku),
        "type": "produit",
        "nom": nom,
        "reference": sku,
        "actifs": actifs,
        "mots_cles": kws,
        "contenu": contenu,
        "lacunes_identifiees": "Allegations et precautions relevees automatiquement ; verifier la conformite reglementaire (allegations de sante) et l'exhaustivite des mises en garde.",
        "source_url": url,
    }


def parse_support(id_, type_, nom, url):
    html = fetch(url)
    if not html:
        return None
    no_script = re.sub(r"<(script|style|nav|header|footer).*?</\1>", " ", html, flags=re.S)
    txt = strip_tags(no_script)
    # garder un extrait dense du corps
    txt = txt[:1600]
    return {
        "id": id_, "type": type_, "nom": nom, "reference": "",
        "actifs": [], "mots_cles": [type_, "livraison", "delai", "commande", "retour",
                                     "remboursement", "support", "aide", "conseil"],
        "contenu": "Page %s d'Onatera. Extrait : %s (Contenu releve automatiquement, a revalider.)" % (nom, txt),
        "lacunes_identifiees": "", "source_url": url,
    }


def main():
    curated = json.load(open(os.path.join(DATA, "kb_curated.json")))["entries"]
    print("Fiches curées conservées :", len(curated))

    urls = product_urls()
    print("Produits vitalité détectés :", len(urls))
    scraped = []
    for i, u in enumerate(urls, 1):
        e = parse_product(u)
        if e:
            scraped.append(e)
            print("  [%2d/%d] %s" % (i, len(urls), e["nom"][:60]))
        time.sleep(0.35)

    support = []
    for id_, type_, nom, url in SUPPORT_PAGES:
        s = parse_support(id_, type_, nom, url)
        if s:
            support.append(s)
            print("  support:", nom)
        time.sleep(0.3)

    # dédup scraped vs curated par référence (sku)
    cur_refs = {str(e.get("reference", "")).strip() for e in curated if e.get("reference")}
    scraped = [e for e in scraped if not (e["reference"] and e["reference"] in cur_refs)]

    entries = curated + scraped + support
    out = {
        "meta": {
            "avertissement": "Fiches curées (verifiées à la main) + fiches produit et pages support ingérées automatiquement depuis onatera.com. Les contenus 'relevés automatiquement' doivent être revalidés par les services Qualité/Juridique avant tout usage réel.",
            "version": "2.0",
            "date_releve": time.strftime("%Y-%m"),
            "sources": {"curées": len(curated), "produits_ingérés": len(scraped), "support": len(support)},
        },
        "entries": entries,
    }
    path = os.path.join(DATA, "kb.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\nEcrit %s : %d entrées (%d curées + %d produits + %d support)"
          % (path, len(entries), len(curated), len(scraped), len(support)))


if __name__ == "__main__":
    main()

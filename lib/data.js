'use strict';
// Donnees fixes du jeu (regles V4). Tout ce qui est equilibrage est ici : prix, quotas,
// cartes, roue... pour pouvoir ajuster sans toucher au moteur.

const PRODUCTS = [
  { id: 'lait', name: 'Lait', color: '#F4F8F5' },
  { id: 'oeuf', name: 'Œufs', color: '#F2B63D' },
  { id: 'viande', name: 'Viande', color: '#F29CB0' },
  { id: 'fl', name: 'Fruits et légumes', color: '#8FD36B' }
];

const SEASONS = [
  { id: 'printemps', name: 'Printemps', color: '#8FD36B', harvestSec: 90, quota: { lait: 3, oeuf: 3, viande: 1, fl: 3 } },
  { id: 'ete', name: 'Été', color: '#F2B63D', harvestSec: 90, quota: { lait: 2, oeuf: 2, viande: 2, fl: 3 } },
  { id: 'automne', name: 'Automne', color: '#F08A4B', harvestSec: 90, quota: { lait: 2, oeuf: 2, viande: 3, fl: 2 } },
  { id: 'hiver', name: 'Hiver', color: '#8EC5F0', harvestSec: 75, quota: { lait: 2, oeuf: 1, viande: 2, fl: 0 } }
];

// sec: null => duree de recolte de la saison
const STEPS = [
  { id: 'alea', name: 'Aléa', hint: 'Carte aléa et dé des activités', sec: 30 },
  { id: 'recolte', name: 'Récolte en relais', hint: 'Un coureur par type de produit', sec: null },
  { id: 'bourse', name: 'Transformation et bourse', hint: 'Recettes et échanges entre fermes', sec: 60 },
  { id: 'marche', name: 'Marché', hint: 'Roue de chaque équipe', sec: 60 },
  { id: 'achats', name: 'Achats et vacances', hint: 'Matériel, voyages, détente', sec: 30 }
];

// Prix d'une tuile de production : type deja possede / nouveau type
const TILE_PRICE = { owned: 35, new: 80 };

// Etoiles : cagnotte du village >= S3_MULT x capital de depart ; 1re etoile : aucune ferme au-dessus de PEAK_MAX boules
const S3_MULT = 2.3;
const PEAK_MAX = 5;

// Virements : motifs proposes (pas de saisie libre)
const TRANSFER_REASONS = {
  animateur: ['Taxe', 'Achat', 'Amende ou autre'],
  ferme: ['Vente de produits', 'Échange à la bourse', 'Remboursement']
};

// Marche : prix unitaires en EB. Supermarche = prix de base garanti ; vente directe = etal (frais fixes) au double du prix, soumise a la roue. Un plat vaut mult x le prix d'un produit brut.
const MARKET = { superPrice: 7, directPrice: 14, stallFee: 10, stallCap: 8, vanCap: 12, mult: { raw: 1, simple: 3, mixed: 4, composed: 5 }, gourmandBonus: 5 };

const SETUP_SEC = 600;
const REARRANGE_SEC = 300;
const START_BANK = 500;
const BOCAL_MAX = 10;
const BURNOUT_RESTART = 3;
const VACATION_COST = 30;

// Profils de depart : tuiles gratuites. Types de tuiles : lait, oeuf, viande, fl, atelier, activite.
const PROFILES = {
  bergers: { name: 'Les Bergers', tiles: { lait: 2, oeuf: 1 } },
  maraichers: { name: 'Les Maraîchers', tiles: { fl: 2, oeuf: 1 } },
  eleveurs: { name: 'Les Éleveurs', tiles: { viande: 2, lait: 1 } },
  gourmets: { name: 'Les Gourmets', tiles: { viande: 1, fl: 1, atelier: 1 } }
};

const TILE_NAMES = {
  lait: 'Chèvrerie', oeuf: 'Poulailler', viande: 'Porcherie', fl: 'Potager-verger',
  atelier: 'Atelier de transformation', activite: 'Activité complémentaire'
};

// Charges de cloture : par type de tuile { taxes, eau, nourriture, electricite }
const CHARGES = { taxes: 20, eau: 10, nourriture: 10, electricite: 10 };

// Catalogue de la boutique. kind: 'tile' | 'equipment'. Le prix des tuiles est calcule (voir engine.priceOf).
const CATALOGUE = [
  { id: 'tile_oeuf', kind: 'tile', tile: 'oeuf', name: 'Poulailler', effect: 'Tuile de production d’œufs' },
  { id: 'tile_lait', kind: 'tile', tile: 'lait', name: 'Chèvrerie', effect: 'Tuile de production de lait' },
  { id: 'tile_viande', kind: 'tile', tile: 'viande', name: 'Porcherie', effect: 'Tuile de production de viande' },
  { id: 'tile_fl', kind: 'tile', tile: 'fl', name: 'Potager-verger', effect: 'Tuile de fruits et légumes' },
  { id: 'tile_atelier', kind: 'tile', tile: 'atelier', name: 'Atelier de transformation', effect: '4 recettes par saison', price: 90 },
  { id: 'tile_activite', kind: 'tile', tile: 'activite', name: 'Activité complémentaire', effect: 'Pouvoir spécial activé par le dé', price: 120 },
  { id: 'brouette', kind: 'equipment', name: 'Brouette', price: 40, effect: 'Un type : son coureur ramène 2 jetons par voyage', multi: true },
  { id: 'charrette', kind: 'equipment', name: 'Charrette', price: 70, effect: '+1 coureur sur un type au choix', multi: true },
  { id: 'tracteur', kind: 'equipment', name: 'Tracteur', price: 150, effect: '+1 coureur sur chaque type' },
  { id: 'chien', kind: 'equipment', name: 'Chien de berger', price: 30, effect: 'Parade contre le renard au poulailler et le loup rôdeur' },
  { id: 'serre', kind: 'equipment', name: 'Serre', price: 30, effect: 'Parade contre le gel tardif et la grêle' },
  { id: 'arrosage', kind: 'equipment', name: 'Arrosage', price: 30, effect: 'Parade contre la canicule, la sécheresse et les canalisations gelées' },
  { id: 'lampe', kind: 'equipment', name: 'Lampe-tempête', price: 25, effect: 'Parade contre le brouillard et la tempête de neige' },
  { id: 'camionnette', kind: 'equipment', name: 'Camionnette', price: 80, effect: 'Parade contre la grève et les routes enneigées, une relance gratuite de la roue, étal de 12 produits' },
  { id: 'hamac', kind: 'equipment', name: 'Hamac', price: 80, effect: '−1 boule à la fin de chaque saison', multi: true }
];

// Cartes aleas par saison (index de saison). Une carte est tiree au hasard dans le paquet de la saison : le ratio
// negatif / positif du paquet fixe donc les chances (printemps et automne 50/50, ete 3 positives sur 5, hiver 4 negatives sur 6).
// parade = id de materiel ; plusieurs cartes peuvent partager la meme parade. mods : quota (par produit ou all), stopEarlySec, directBlocked.
const CARDS = [
  [
    { id: 'gel', title: 'Gel tardif', tone: 'neg', effect: 'Fruits et légumes : −2 jetons par tuile.', parade: 'serre', when: ['recolte'], mods: { quota: { fl: { add: -2 } } } },
    { id: 'naissances', title: 'Naissances', tone: 'pos', effect: 'Lait : +2 jetons par tuile.', parade: null, when: ['recolte'], mods: { quota: { lait: { add: 2 } } } },
    { id: 'grele', title: 'Grêle', tone: 'neg', effect: 'Œufs et fruits et légumes : −1 jeton par tuile.', parade: 'serre', when: ['recolte'], mods: { quota: { oeuf: { add: -1 }, fl: { add: -1 } } } },
    { id: 'printemps_doux', title: 'Printemps doux', tone: 'pos', effect: 'Fruits et légumes : +2 jetons par tuile.', parade: null, when: ['recolte'], mods: { quota: { fl: { add: 2 } } } }
  ],
  [
    { id: 'canicule', title: 'Canicule', tone: 'neg', effect: 'Récolte raccourcie de 30 secondes.', parade: 'arrosage', when: ['recolte'], mods: { stopEarlySec: 30 } },
    { id: 'touristes', title: 'Touristes', tone: 'pos', effect: 'La roue ne peut pas donner moins que « les trois quarts vendus ».', parade: null, when: ['marche'], mods: {} },
    { id: 'secheresse', title: 'Sécheresse', tone: 'neg', effect: 'Lait et fruits et légumes : −1 jeton par tuile.', parade: 'arrosage', when: ['recolte'], mods: { quota: { lait: { add: -1 }, fl: { add: -1 } } } },
    { id: 'paturages', title: 'Pâturages gras', tone: 'pos', effect: 'Lait et viande : +1 jeton par tuile.', parade: null, when: ['recolte'], mods: { quota: { lait: { add: 1 }, viande: { add: 1 } } } },
    { id: 'potager_genereux', title: 'Potager généreux', tone: 'pos', effect: 'Fruits et légumes : +2 jetons par tuile.', parade: null, when: ['recolte'], mods: { quota: { fl: { add: 2 } } } }
  ],
  [
    { id: 'renard', title: 'Renard au poulailler', tone: 'neg', effect: 'Plus aucun œuf à rapporter cette saison.', parade: 'chien', when: ['recolte'], mods: { quota: { oeuf: { zero: true } } } },
    { id: 'brouillard', title: 'Brouillard', tone: 'neg', effect: 'Les coureurs marchent : −1 jeton par tuile, sur tous les produits.', parade: 'lampe', when: ['recolte'], mods: { quota: { all: { add: -1 } } } },
    { id: 'loup', title: 'Loup rôdeur', tone: 'neg', effect: 'Viande : −2 jetons par tuile.', parade: 'chien', when: ['recolte'], mods: { quota: { viande: { add: -2 } } } },
    { id: 'vendanges', title: 'Belles vendanges', tone: 'pos', effect: 'Fruits et légumes : +2 jetons par tuile.', parade: null, when: ['recolte'], mods: { quota: { fl: { add: 2 } } } },
    { id: 'glands', title: 'Année des glands', tone: 'pos', effect: 'Viande : +2 jetons par tuile.', parade: null, when: ['recolte'], mods: { quota: { viande: { add: 2 } } } },
    { id: 'bonne_ponte', title: 'Bonne ponte', tone: 'pos', effect: 'Œufs : +2 jetons par tuile.', parade: null, when: ['recolte'], mods: { quota: { oeuf: { add: 2 } } } }
  ],
  [
    { id: 'greve', title: 'Grève des transporteurs', tone: 'neg', effect: 'Pas de vente directe cette saison.', parade: 'camionnette', when: ['marche'], mods: { directBlocked: true } },
    { id: 'hiver_gourmand', title: 'Hiver gourmand', tone: 'pos', effect: 'Les produits transformés valent +5 EB l’unité.', parade: null, when: ['bourse', 'marche'], mods: {} },
    { id: 'routes_enneigees', title: 'Routes enneigées', tone: 'neg', effect: 'Pas de vente directe cette saison.', parade: 'camionnette', when: ['marche'], mods: { directBlocked: true } },
    { id: 'tempete_neige', title: 'Tempête de neige', tone: 'neg', effect: 'Récolte raccourcie de 30 secondes.', parade: 'lampe', when: ['recolte'], mods: { stopEarlySec: 30 } },
    { id: 'canalisations', title: 'Canalisations gelées', tone: 'neg', effect: 'Lait et viande : −1 jeton par tuile.', parade: 'arrosage', when: ['recolte'], mods: { quota: { lait: { add: -1 }, viande: { add: -1 } } } },
    { id: 'hiver_doux', title: 'Hiver doux', tone: 'pos', effect: 'Lait et œufs : +1 jeton par tuile.', parade: null, when: ['recolte'], mods: { quota: { lait: { add: 1 }, oeuf: { add: 1 } } } }
  ]
];

// Roue du marche : 12 cases. mult utilise pour l'affichage et la regle "Touristes".
// Roue du marche : part de l'etal vendue en vente directe (frac). Le supermarche, lui, ne passe jamais par la roue.
const WHEEL = [
  { label: 'Tout est vendu', frac: 1 }, { label: 'Tout est vendu', frac: 1 }, { label: 'Tout est vendu', frac: 1 }, { label: 'Tout est vendu', frac: 1 }, { label: 'Tout est vendu', frac: 1 },
  { label: 'Les trois quarts vendus', frac: 0.75 }, { label: 'Les trois quarts vendus', frac: 0.75 }, { label: 'Les trois quarts vendus', frac: 0.75 },
  { label: 'La moitié vendue', frac: 0.5 }, { label: 'La moitié vendue', frac: 0.5 },
  { label: 'Rien ne se vend', frac: 0 },
  { label: 'Relance gratuite', frac: 1, free: true }
];

const DIE = [
  'Aucune activité',
  'Gîte à la ferme : les transformés se vendent tout de suite',
  'Magasin : une catégorie vendue d’office au prix direct ×1',
  'Ferme pédagogique : le quota d’un type est doublé',
  'Restaurant : les invendus frais sont vendus au prix direct ×1',
  'Toutes les activités se déclenchent'
];

// Plats de la Fete du Phoenix. tier 1 : recette simple ; 2 : recette mixte ; 3 : plat compose (utilise un produit deja transforme).
const DISHES = [
  { id: 'fromage', name: 'Fromage', needs: '2 laits', req: { lait: 2 }, tier: 1 },
  { id: 'confiture', name: 'Confiture', needs: '2 fruits et légumes', req: { fl: 2 }, tier: 1 },
  { id: 'saucisson', name: 'Saucisson', needs: '2 viandes', req: { viande: 2 }, tier: 1 },
  { id: 'cake', name: 'Cake aux fruits', needs: '1 œuf + 1 fruit ou légume', req: { oeuf: 1, fl: 1 }, tier: 2 },
  { id: 'lasagne', name: 'Lasagne', needs: '1 lait + 1 viande', req: { lait: 1, viande: 1 }, tier: 2 },
  { id: 'omelette', name: 'Omelette au lard', needs: '1 œuf + 1 viande', req: { oeuf: 1, viande: 1 }, tier: 2 },
  { id: 'quiche', name: 'Quiche au fromage', needs: '1 fromage + 1 œuf', req: { fromage: 1, oeuf: 1 }, tier: 3 },
  { id: 'gratin', name: 'Gratin de la ferme', needs: '1 fromage + 1 saucisson', req: { fromage: 1, saucisson: 1 }, tier: 3 },
  { id: 'tarte', name: 'Tarte à la confiture', needs: '1 confiture + 1 œuf', req: { confiture: 1, oeuf: 1 }, tier: 3 }
];

// Menu tire chaque annee : plats par ferme, selon la difficulte (niveau de chaque plat). Chaque ferme en assume le meme nombre.
const FETE = [
  { perFarm: 2, mixed: 0, tiers: [1, 1] },
  { perFarm: 3, mixed: 1, tiers: [1, 1, 2] },
  { perFarm: 3, mixed: 2, tiers: [1, 2, 3] }
];

module.exports = {
  PRODUCTS, SEASONS, STEPS, TILE_PRICE, MARKET, DISHES, S3_MULT, PEAK_MAX, TRANSFER_REASONS, SETUP_SEC, REARRANGE_SEC, START_BANK, BOCAL_MAX, BURNOUT_RESTART,
  VACATION_COST, PROFILES, TILE_NAMES, CHARGES, CATALOGUE, CARDS, WHEEL, DIE, FETE
};

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
  { id: 'printemps', name: 'Printemps', color: '#8FD36B', harvestSec: 90, quota: { lait: 1.25, oeuf: 1.25, viande: 0.5, fl: 1.25 } },
  { id: 'ete', name: 'Été', color: '#F2B63D', harvestSec: 90, quota: { lait: 0.75, oeuf: 0.75, viande: 0.75, fl: 1 } },
  { id: 'automne', name: 'Automne', color: '#F08A4B', harvestSec: 90, quota: { lait: 0.75, oeuf: 0.75, viande: 1.25, fl: 0.75 } },
  { id: 'hiver', name: 'Hiver', color: '#8EC5F0', harvestSec: 75, quota: { lait: 0.75, oeuf: 0.5, viande: 0.75, fl: 0 } }
];

// sec: null => duree de recolte de la saison
const STEPS = [
  { id: 'alea', name: 'Aléa', hint: 'Carte aléa et dé des activités', sec: 30 },
  { id: 'recolte', name: 'Récolte en relais', hint: 'Un coureur par tuile, un jeton par trajet', sec: null },
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
const MARKET = { superPrice: 7, directPrice: 14, stallFee: 10, stallCap: 8, tableCap: 10, vanCap: 12, mult: { raw: 1, simple: 3, mixed: 4, composed: 5 }, gourmandBonus: 5 };

// Produits vendables au marche : 4 produits bruts + 9 plats. Texte pour les phrases de retour de marche (nombre, genre).
const SELL_TEXT = {
  lait: { name: 'lait', pl: false, g: 'm' }, oeuf: { name: 'œufs', pl: true, g: 'm' }, viande: { name: 'viande', pl: false, g: 'f' }, fl: { name: 'fruits et légumes', pl: true, g: 'm' },
  fromage: { name: 'fromages', pl: true, g: 'm' }, confiture: { name: 'confitures', pl: true, g: 'f' }, saucisson: { name: 'saucissons', pl: true, g: 'm' },
  cake: { name: 'cakes aux fruits', pl: true, g: 'm' }, lasagne: { name: 'lasagnes', pl: true, g: 'f' }, omelette: { name: 'omelettes au lard', pl: true, g: 'f' },
  quiche: { name: 'quiches au fromage', pl: true, g: 'f' }, gratin: { name: 'gratins de la ferme', pl: true, g: 'm' }, tarte: { name: 'tartes à la confiture', pl: true, g: 'f' }
};

// Gout du moment : par saison, des produits recherches (+) et d'autres boudes (-). Cela decale la part vendue a l'etal
// (en plus de la roue) de +/- DEMAND_ADJ, produit par produit. Le supermarche, lui, reste garanti.
const DEMAND_ADJ = 0.25;
const DEMAND = [
  { hot: { ids: ['oeuf', 'fl', 'omelette'], why: 'les premiers beaux jours donnent envie de produits frais' }, cold: { ids: ['saucisson', 'gratin', 'lasagne'], why: 'avec le retour du soleil, personne ne veut de plats lourds' } },
  { hot: { ids: ['fl', 'confiture', 'cake', 'tarte', 'lait'], why: 'pique-niques et grandes tablées : on veut du frais et du sucré' }, cold: { ids: ['gratin', 'lasagne', 'quiche'], why: 'il faisait bien trop chaud pour des plats en sauce ou au four' } },
  { hot: { ids: ['viande', 'saucisson', 'omelette', 'lasagne', 'gratin'], why: 'les premiers froids donnent faim de plats copieux' }, cold: { ids: ['fl', 'confiture', 'cake'], why: 'les étals de fruits sont déjà bien garnis et la concurrence est rude' } },
  { hot: { ids: ['fromage', 'gratin', 'quiche', 'lasagne', 'viande'], why: 'par ce froid, tout le monde veut du fromage et du réconfort' }, cold: { ids: ['confiture', 'tarte', 'cake', 'fl'], why: 'il faisait trop froid pour s’attarder devant les étals sucrés' } }
];

// Recolte : une tuile = un coureur autorise sur ce type. Chaque coureur fait autant d'allers-retours que le chrono le permet,
// un jeton par trajet ; chaque jeton rapporte la valeur de la grille (quota : ressources par jeton, selon la saison, le produit
// et l'alea). Le coup de collier (+1 boule) et le tracteur ajoutent des secondes de course apres la fin du chrono.
// Rendement : la grille SEASONS[].quota donne les ressources qu'un jeton rapporte (fraction : 0,5 = 2 jetons pour 1 ressource). Elle est
// calibree (sim/) pour un aller-retour de REF_TRIP_SEC secondes ; l'animateur regle la duree reelle du parcours (TRIP_CHOICES) et la grille
// est mise a l'echelle (parcours plus court => un jeton rapporte moins).
const REF_TRIP_SEC = 30;
const TRIP_CHOICES = [10, 15, 20, 30, 40];
const COLLIER_SEC = 20;
const TRACTEUR_SEC = 15;
const MAX_TOKENS = 99; // garde-fou d'encodage

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
  { id: 'brouette', kind: 'equipment', name: 'Brouette', price: 40, effect: 'Un de vos coureurs ramène 2 jetons par trajet', multi: true },
  { id: 'tracteur', kind: 'equipment', name: 'Tracteur', price: 100, effect: 'Tous vos coureurs courent 15 secondes de plus à chaque récolte' },
  { id: 'chien', kind: 'equipment', name: 'Chien de berger', price: 30, effect: 'Parade contre le renard au poulailler et le loup rôdeur' },
  { id: 'serre', kind: 'equipment', name: 'Serre', price: 30, effect: 'Parade contre le gel tardif et la grêle' },
  { id: 'arrosage', kind: 'equipment', name: 'Arrosage', price: 30, effect: 'Parade contre la canicule, la sécheresse et les canalisations gelées' },
  { id: 'lampe', kind: 'equipment', name: 'Lampe-tempête', price: 25, effect: 'Parade contre le brouillard et la tempête de neige' },
  { id: 'camionnette', kind: 'equipment', name: 'Camionnette', price: 80, effect: 'Parade contre la grève et les routes enneigées, une relance gratuite de la roue, étal de 12 produits (14 avec la table de marché)' },
  { id: 'table', kind: 'equipment', name: 'Table de marché', price: 40, effect: 'Étal de 10 produits au lieu de 8 (14 avec la camionnette)' },
  { id: 'hamac', kind: 'equipment', name: 'Hamac', price: 80, effect: '−1 boule à la fin de chaque saison', multi: true }
];

// Cartes aleas par saison (index de saison). Une carte est tiree au hasard dans le paquet de la saison : le ratio
// negatif / positif du paquet fixe donc les chances (printemps et automne 50/50, ete 3 positives sur 5, hiver 4 negatives sur 6).
// parade = id de materiel ; plusieurs cartes peuvent partager la meme parade. mods : quota (par produit ou all, {mult}/{half}/{zero} sur le rendement d'un jeton), stopEarlySec, directBlocked.
const CARDS = [
  [
    { id: 'gel', weather: 'froid', title: 'Gel tardif', tone: 'neg', effect: 'Fruits et légumes : rendement divisé par quatre.', parade: 'serre', when: ['recolte'], mods: { quota: { fl: { mult: 0.25 } } } },
    { id: 'naissances', title: 'Naissances', tone: 'pos', effect: 'Lait : rendement doublé.', parade: null, when: ['recolte'], mods: { quota: { lait: { mult: 2 } } } },
    { id: 'grele', weather: 'orage', title: 'Grêle', tone: 'neg', effect: 'Œufs et fruits et légumes : rendement divisé par deux.', parade: 'serre', when: ['recolte'], mods: { quota: { oeuf: { mult: 0.5 }, fl: { mult: 0.5 } } } },
    { id: 'printemps_doux', weather: 'doux', title: 'Printemps doux', tone: 'pos', effect: 'Fruits et légumes : rendement doublé.', parade: null, when: ['recolte'], mods: { quota: { fl: { mult: 2 } } } }
  ],
  [
    { id: 'canicule', weather: 'chaud', title: 'Canicule', tone: 'neg', effect: 'Récolte raccourcie de 30 secondes.', parade: 'arrosage', when: ['recolte'], mods: { stopEarlySec: 30 } },
    { id: 'touristes', weather: 'doux', title: 'Touristes', tone: 'pos', effect: 'La roue ne peut pas donner moins que « les trois quarts vendus ».', parade: null, when: ['marche'], mods: {} },
    { id: 'secheresse', weather: 'chaud', title: 'Sécheresse', tone: 'neg', effect: 'Lait et fruits et légumes : rendement divisé par deux.', parade: 'arrosage', when: ['recolte'], mods: { quota: { lait: { mult: 0.5 }, fl: { mult: 0.5 } } } },
    { id: 'paturages', weather: 'doux', title: 'Pâturages gras', tone: 'pos', effect: 'Lait et viande : rendement augmenté de moitié.', parade: null, when: ['recolte'], mods: { quota: { lait: { mult: 1.5 }, viande: { mult: 1.5 } } } },
    { id: 'potager_genereux', weather: 'doux', title: 'Potager généreux', tone: 'pos', effect: 'Fruits et légumes : rendement doublé.', parade: null, when: ['recolte'], mods: { quota: { fl: { mult: 2 } } } }
  ],
  [
    { id: 'renard', title: 'Renard au poulailler', tone: 'neg', effect: 'Plus aucun œuf à rapporter cette saison.', parade: 'chien', when: ['recolte'], mods: { quota: { oeuf: { zero: true } } } },
    { id: 'brouillard', weather: 'brouillard', title: 'Brouillard', tone: 'neg', effect: 'Les coureurs marchent : rendement divisé par deux, sur tous les produits.', parade: 'lampe', when: ['recolte'], mods: { quota: { all: { mult: 0.5 } } } },
    { id: 'loup', title: 'Loup rôdeur', tone: 'neg', effect: 'Viande : rendement divisé par quatre.', parade: 'chien', when: ['recolte'], mods: { quota: { viande: { mult: 0.25 } } } },
    { id: 'vendanges', weather: 'doux', title: 'Belles vendanges', tone: 'pos', effect: 'Fruits et légumes : rendement doublé.', parade: null, when: ['recolte'], mods: { quota: { fl: { mult: 2 } } } },
    { id: 'glands', title: 'Année des glands', tone: 'pos', effect: 'Viande : rendement doublé.', parade: null, when: ['recolte'], mods: { quota: { viande: { mult: 2 } } } },
    { id: 'bonne_ponte', title: 'Bonne ponte', tone: 'pos', effect: 'Œufs : rendement doublé.', parade: null, when: ['recolte'], mods: { quota: { oeuf: { mult: 2 } } } }
  ],
  [
    { id: 'greve', title: 'Grève des transporteurs', tone: 'neg', effect: 'Pas de vente directe cette saison.', parade: 'camionnette', when: ['marche'], mods: { directBlocked: true } },
    { id: 'hiver_gourmand', title: 'Hiver gourmand', tone: 'pos', effect: 'Les produits transformés valent +5 EB l’unité.', parade: null, when: ['bourse', 'marche'], mods: {} },
    { id: 'routes_enneigees', weather: 'froid', title: 'Routes enneigées', tone: 'neg', effect: 'Pas de vente directe cette saison.', parade: 'camionnette', when: ['marche'], mods: { directBlocked: true } },
    { id: 'tempete_neige', weather: 'orage', title: 'Tempête de neige', tone: 'neg', effect: 'Récolte raccourcie de 30 secondes.', parade: 'lampe', when: ['recolte'], mods: { stopEarlySec: 30 } },
    { id: 'canalisations', weather: 'froid', title: 'Canalisations gelées', tone: 'neg', effect: 'Lait et viande : rendement divisé par deux.', parade: 'arrosage', when: ['recolte'], mods: { quota: { lait: { mult: 0.5 }, viande: { mult: 0.5 } } } },
    { id: 'hiver_doux', weather: 'doux', title: 'Hiver doux', tone: 'pos', effect: 'Lait et œufs : rendement augmenté de moitié.', parade: null, when: ['recolte'], mods: { quota: { lait: { mult: 1.5 }, oeuf: { mult: 1.5 } } } }
  ]
];

// Meteo : une prevision est annoncee avant chaque saison (pendant les achats). Elle est liee a la carte reellement tiree
// dans FORECAST_RELIABLE des cas ; sinon c'est une fausse alerte ou un ciel incertain. Les cartes sans tag meteo
// (renard, loup, greve, ...) ne sont jamais annoncees : les joueurs prennent un risque, sans pouvoir tout planifier.
const WEATHER = {
  froid: { icon: '❄️', name: 'Froid', text: 'Vague de froid annoncée' },
  chaud: { icon: '☀️', name: 'Chaleur', text: 'Forte chaleur annoncée' },
  orage: { icon: '⛈️', name: 'Orages', text: 'Orages annoncés' },
  brouillard: { icon: '🌫️', name: 'Brouillard', text: 'Brouillard annoncé' },
  doux: { icon: '🌤️', name: 'Temps doux', text: 'Beau temps annoncé' },
  incertain: { icon: '☁️', name: 'Ciel incertain', text: 'Prévisions incertaines' }
};
const FORECAST_RELIABLE = 0.7; // part des previsions fidees a la carte quand celle-ci a une meteo
const FORECAST_BLUFF = 0.5; // quand la carte n'a pas de meteo : part de fausses alertes (sinon : ciel incertain)

// Aleas collectifs : un tire par an (parmi toutes les saisons), il remplace la carte de sa saison. Pas de choix individuel :
// le village doit reunir ensemble un objectif (argent, plats transformes, jetons de produit, ou boules a absorber) avant
// l'echeance (fin de l'etape `due`). Objectif GLOBAL pour le village, dont la valeur depend du nombre de fermes (perFarm x fermes, arrondi au-dessus) : peu importe qui donne, une seule ferme peut suffire. Atteint : win ; sinon : lose.
// Seul le stress compte : reussite = -1 boule pour chaque ferme, echec = +1 boule pour chaque ferme.
const COLLECTIVE = [
  { id: 'inondation', season: 0, title: 'Inondation', story: 'La rivière déborde : il faut renforcer les digues avant la fin de la saison.', goal: { kind: 'eb', perFarm: 15 }, due: 'achats',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' },
  { id: 'semences', season: 0, title: 'Semences communes', story: 'Le village veut replanter ensemble : chaque ferme met des fruits et légumes en commun.', goal: { kind: 'raw', product: 'fl', perFarm: 2 }, due: 'bourse',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' },
  { id: 'incendie', season: 1, title: 'Feu de broussailles', story: 'Un feu menace les lisières. Des volontaires prennent le stress pour éteindre : la moitié des fermes doit absorber une boule.', goal: { kind: 'boule', perFarm: 0.5 }, due: 'bourse',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' },
  { id: 'fete_village', season: 1, title: 'Fête du village', story: 'On prépare le banquet : le village doit offrir des fromages.', goal: { kind: 'dish', dish: 'fromage', perFarm: 0.5 }, due: 'marche',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' },
  { id: 'epizootie', season: 2, title: 'Maladie du bétail', story: 'Une épidémie guette : le village finance une campagne de vaccination.', goal: { kind: 'eb', perFarm: 20 }, due: 'achats',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' },
  { id: 'soupe', season: 2, title: 'Soupe solidaire', story: 'Les fermes cuisinent ensemble pour les familles du village : il faut des œufs en commun.', goal: { kind: 'raw', product: 'oeuf', perFarm: 2 }, due: 'bourse',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' },
  { id: 'panne', season: 3, title: 'Panne d’électricité', story: 'Le village achète un groupe électrogène : chaque ferme met sa part.', goal: { kind: 'eb', perFarm: 20 }, due: 'achats',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' },
  { id: 'noel', season: 3, title: 'Marché de Noël', story: 'Le village tient un grand étal : il faut des confitures à vendre ensemble.', goal: { kind: 'dish', dish: 'confiture', perFarm: 0.75 }, due: 'marche',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 boule pour chaque ferme.', loseText: 'Le village trinque : +1 boule pour chaque ferme.' }
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
  REF_TRIP_SEC, TRIP_CHOICES, COLLIER_SEC, TRACTEUR_SEC, MAX_TOKENS,
  SELL_TEXT, DEMAND_ADJ, DEMAND,
  WEATHER, FORECAST_RELIABLE, FORECAST_BLUFF, COLLECTIVE,
  PRODUCTS, SEASONS, STEPS, TILE_PRICE, MARKET, DISHES, S3_MULT, PEAK_MAX, TRANSFER_REASONS, SETUP_SEC, REARRANGE_SEC, START_BANK, BOCAL_MAX, BURNOUT_RESTART,
  VACATION_COST, PROFILES, TILE_NAMES, CHARGES, CATALOGUE, CARDS, WHEEL, DIE, FETE
};

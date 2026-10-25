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
  { id: 'printemps', name: 'Printemps', of: 'de printemps', color: '#8FD36B', trips: { lait: 2.5, oeuf: 2.5, viande: 1, fl: 2 } },
  { id: 'ete', name: 'Été', of: 'd’été', color: '#F2B63D', trips: { lait: 2, oeuf: 2, viande: 2, fl: 2 } },
  { id: 'automne', name: 'Automne', of: 'd’automne', color: '#F08A4B', trips: { lait: 2, oeuf: 2, viande: 2.5, fl: 2 } },
  { id: 'hiver', name: 'Hiver', of: 'd’hiver', color: '#8EC5F0', trips: { lait: 2, oeuf: 1, viande: 2, fl: 0.75 } }
];

// sec: null => duree de recolte de la saison
const STEPS = [
  { id: 'alea', name: 'Aléa', hint: 'Carte aléa et dés des activités', sec: 30 },
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
  animateur: ['Taxe', 'Achat', 'Amende ou autre'], // vers le maire du village
  ferme: ['Vente de produits', 'Échange à la bourse', 'Remboursement'],
  village: ['Don au village']
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

// Recolte : une tuile = un coureur autorise sur ce type. Chaque coureur fait autant d'allers-retours que le chrono le permet,
// un jeton par trajet ; chaque jeton rapporte la valeur de la grille (quota : ressources par jeton, selon la saison, le produit
// et l'alea). Le coup de collier (+1 stress) et le tracteur ajoutent des secondes de course apres la fin du chrono.
// Recolte : un jeton par trajet = une ressource. Chaque produit a sa propre duree de course selon la saison (SEASONS[].trips : nombre d'allers-retours
// que ses coureurs peuvent faire, 0 = rien a recolter). L'animateur mesure un aller-retour (TRIP_CHOICES) ; le chrono de l'etape dure le produit le plus long.
// Coup de collier et tracteur ajoutent une fraction d'aller-retour.
const DEFAULT_TRIP_SEC = 30;
const TRIP_CHOICES = [10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 105, 120];
const COLLIER_TRIPS = 2 / 3;
const TRACTEUR_TRIPS = 1 / 2;
// En dessous de ce nombre d'allers-retours, la course d'un produit est impossible : il n'est pas recoltable (bonus de temps compris).
const MIN_RUN_TRIPS = 0.75;
// Serre : en hiver, les fruits et legumes sous serre courent WINTER_FL_SERRE_TRIPS allers-retours (SEASONS[3].trips.fl sans serre).
const WINTER_FL_SERRE_TRIPS = 1.25;
const MAX_TOKENS = 99; // garde-fou d'encodage

const SETUP_SEC = 600;
const REARRANGE_SEC = 300;
const START_BANK = 500;
const BOCAL_MAX = 10;
const BURNOUT_RESTART = 3;
const VACATION_COST = 30;
const VACATION_MAX = 8; // voyageurs par saison et par ferme
// Echec de la fete : stress pour toutes les fermes, puis pour chaque plat non livre (plafonne par ferme). Reussite : FETE_WIN.
const FETE_WIN = -2;
const FETE_FAIL = 2;
const FETE_MISSING = 1;
const FETE_MISSING_CAP = 3;

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

// Activites complementaires : chaque ferme achete celles qu'elle veut (une fois chacune, a l'installation ou au reamenagement).
// A chaque saison, elle lance un de par activite : 1 = l'activite ne fonctionne pas du tout, 2 a 6 = effet de plus en plus fort (n[de - 1]).
// Chaque activite agit sur un domaine different :
//   gite    : des EB de recette d'hebergement, payes au marche (n = EB)
//   magasin : n produits bruts poses a l'etal sont vendus d'office, sans passer par la roue
//   resto   : n plats transformes poses a l'etal sont vendus d'office, sans passer par la roue
//   pedago  : n jetons offerts a la recolte (sur le produit que la ferme cultive le plus)
const ACTIVITIES = [
  { id: 'gite', name: 'Gîte à la ferme', icon: '🛏️', price: 100, n: [0, 15, 20, 25, 35, 45], unit: 'EB', hook: 'marche',
    short: 'Des hôtes séjournent à la ferme et paient leur séjour.', how: 'Une recette en EB s’ajoute à vos ventes du marché, quoi que fasse la roue.', each: (n) => `+${n} EB de recette au marché` },
  { id: 'magasin', name: 'Magasin à la ferme', icon: '🥫', price: 100, n: [0, 2, 2, 3, 3, 4], unit: 'produit', hook: 'marche',
    short: 'Votre boutique vend des produits bruts à coup sûr.', how: 'Des produits bruts posés à l’étal sont vendus d’office, sans passer par la roue.', each: (n) => `${n} produits bruts de l’étal vendus d’office` },
  { id: 'resto', name: 'Restaurant à la ferme', icon: '🍽️', price: 100, n: [0, 1, 1, 2, 2, 3], unit: 'plat', hook: 'marche',
    short: 'Votre restaurant sert vos plats transformés à coup sûr.', how: 'Des plats transformés posés à l’étal sont vendus d’office, sans passer par la roue.', each: (n) => `${n} plat${n > 1 ? 's' : ''} transformé${n > 1 ? 's' : ''} de l’étal vendu${n > 1 ? 's' : ''} d’office` },
  { id: 'pedago', name: 'Ferme pédagogique', icon: '🐑', price: 100, n: [0, 2, 3, 4, 5, 6], unit: 'jeton', hook: 'recolte',
    short: 'Les visiteurs donnent un coup de main à la récolte.', how: 'Des jetons bonus s’ajoutent à votre récolte, sur le produit que vous cultivez le plus.', each: (n) => `${n} jetons bonus à la récolte` }
];

// Catalogue de la boutique. kind: 'tile' | 'activity' | 'equipment' | 'service'. Le prix des tuiles est calcule (voir engine.priceOf).
// multi : achetable plusieurs fois. Les textes d'effet qui parlent de secondes sont calcules par le moteur (voir engine.effectOf).
const CATALOGUE = [
  { id: 'tile_oeuf', kind: 'tile', tile: 'oeuf', name: 'Poulailler', effect: 'Tuile de production d’œufs : un coureur de plus' },
  { id: 'tile_lait', kind: 'tile', tile: 'lait', name: 'Chèvrerie', effect: 'Tuile de production de lait : un coureur de plus' },
  { id: 'tile_viande', kind: 'tile', tile: 'viande', name: 'Porcherie', effect: 'Tuile de production de viande : un coureur de plus' },
  { id: 'tile_fl', kind: 'tile', tile: 'fl', name: 'Potager-verger', effect: 'Tuile de fruits et légumes : un coureur de plus' },
  { id: 'tile_atelier', kind: 'tile', tile: 'atelier', name: 'Atelier de transformation', effect: '4 recettes de plus par saison', price: 90 },
].concat(ACTIVITIES.map((a) => ({ id: 'act_' + a.id, kind: 'activity', activity: a.id, name: a.name, price: a.price, effect: a.short + ' ' + a.how + ' Chaque saison, un dé : 1 = rien, 2 à 6 = effet de plus en plus fort.' })), [
  { id: 'panier', kind: 'equipment', name: 'Panier de récolte', price: 40, effect: 'Un de vos coureurs peut prendre 2 jetons au lieu d’1 à chaque trajet (un panier par coureur)', multi: true },
  { id: 'brouette', kind: 'equipment', name: 'Brouette', price: 120, effect: 'Tous vos coureurs peuvent prendre 2 jetons au lieu d’1 à chaque trajet' },
  { id: 'tracteur', kind: 'equipment', name: 'Tracteur', price: 100, effect: 'Vos coureurs peuvent courir quelques secondes de plus à chaque récolte' },
  { id: 'chien', kind: 'equipment', name: 'Chien de berger', price: 30, effect: 'Parade contre le renard au poulailler et le loup rôdeur' },
  { id: 'serre', kind: 'equipment', name: 'Serre', price: 30, effect: 'Parade contre le gel tardif et la grêle ; en hiver, vous pouvez courir plus longtemps pour les fruits et légumes' },
  { id: 'arrosage', kind: 'equipment', name: 'Arrosage', price: 30, effect: 'Parade contre la canicule, la sécheresse et les canalisations gelées' },
  { id: 'lampe', kind: 'equipment', name: 'Lampe-tempête', price: 25, effect: 'Parade contre le brouillard et la tempête de neige' },
  { id: 'camionnette', kind: 'equipment', name: 'Camionnette', price: 80, effect: 'Parade contre la grève et les routes enneigées, une relance gratuite de la roue, étal de 12 produits (14 avec la table de marché)' },
  { id: 'table', kind: 'equipment', name: 'Table de marché', price: 40, effect: 'Étal de 10 produits au lieu de 8 (14 avec la camionnette)' },
  { id: 'hamac', kind: 'equipment', name: 'Hamac', price: 100, effect: '−1 stress à la fin de chaque saison (un seul par ferme)' },
  { id: 'vacance', kind: 'service', name: 'Vacances', price: 30, multi: true, effect: 'Par voyageur : −1 stress tout de suite. Le voyageur ne court pas la saison suivante.' }
]);

// Cartes aleas par saison (index de saison). Une carte est tiree au hasard dans le paquet de la saison : le ratio
// negatif / positif du paquet fixe donc les chances (printemps et automne 50/50, ete 3 positives sur 5, hiver 4 negatives sur 6).
// parade = id de materiel ; plusieurs cartes peuvent partager la meme parade. mods : run (par produit ou all : {dur} multiplie la duree de course du produit, {zero} la supprime, {perTrip} jetons par trajet), stopEarlySec (en secondes pour une recolte de 90 s : proportionnel a la duree reelle), directBlocked.
const CARDS = [
  [
    { id: 'gel', weather: 'froid', title: 'Gel tardif', tone: 'neg', effect: 'Fruits et légumes : course trop courte, non récoltable cette saison.', parade: 'serre', when: ['recolte'], mods: { run: { fl: { dur: 0.25 } } } },
    { id: 'naissances', title: 'Naissances', tone: 'pos', effect: 'Lait : 2 jetons par trajet.', parade: null, when: ['recolte'], mods: { run: { lait: { perTrip: 2 } } } },
    { id: 'grele', weather: 'orage', title: 'Grêle', tone: 'neg', effect: 'Œufs et fruits et légumes : les coureurs ne courent que la moitié du temps.', parade: 'serre', when: ['recolte'], mods: { run: { oeuf: { dur: 0.5 }, fl: { dur: 0.5 } } } },
    { id: 'printemps_doux', weather: 'doux', title: 'Printemps doux', tone: 'pos', effect: 'Fruits et légumes : 2 jetons par trajet.', parade: null, when: ['recolte'], mods: { run: { fl: { perTrip: 2 } } } }
  ],
  [
    { id: 'canicule', weather: 'chaud', title: 'Canicule', tone: 'neg', effect: 'Récolte raccourcie d’un tiers.', parade: 'arrosage', when: ['recolte'], mods: { stopEarlySec: 30 } },
    { id: 'touristes', weather: 'doux', title: 'Touristes', tone: 'pos', effect: 'La roue ne peut pas donner moins que « les trois quarts vendus ».', parade: null, when: ['marche'], mods: {} },
    { id: 'secheresse', weather: 'chaud', title: 'Sécheresse', tone: 'neg', effect: 'Lait et fruits et légumes : les coureurs ne courent que la moitié du temps.', parade: 'arrosage', when: ['recolte'], mods: { run: { lait: { dur: 0.5 }, fl: { dur: 0.5 } } } },
    { id: 'paturages', weather: 'doux', title: 'Pâturages gras', tone: 'pos', effect: 'Lait et viande : course rallongée de moitié.', parade: null, when: ['recolte'], mods: { run: { lait: { dur: 1.5 }, viande: { dur: 1.5 } } } },
    { id: 'potager_genereux', weather: 'doux', title: 'Potager généreux', tone: 'pos', effect: 'Fruits et légumes : 2 jetons par trajet.', parade: null, when: ['recolte'], mods: { run: { fl: { perTrip: 2 } } } }
  ],
  [
    { id: 'renard', title: 'Renard au poulailler', tone: 'neg', effect: 'Plus aucun œuf à rapporter cette saison.', parade: 'chien', when: ['recolte'], mods: { run: { oeuf: { zero: true } } } },
    { id: 'brouillard', weather: 'brouillard', title: 'Brouillard', tone: 'neg', effect: 'Les coureurs marchent : moitié moins de temps de course, sur tous les produits.', parade: 'lampe', when: ['recolte'], mods: { run: { all: { dur: 0.5 } } } },
    { id: 'loup', title: 'Loup rôdeur', tone: 'neg', effect: 'Viande : course trop courte, non récoltable cette saison.', parade: 'chien', when: ['recolte'], mods: { run: { viande: { dur: 0.25 } } } },
    { id: 'vendanges', weather: 'doux', title: 'Belles vendanges', tone: 'pos', effect: 'Fruits et légumes : 2 jetons par trajet.', parade: null, when: ['recolte'], mods: { run: { fl: { perTrip: 2 } } } },
    { id: 'glands', title: 'Année des glands', tone: 'pos', effect: 'Viande : 2 jetons par trajet.', parade: null, when: ['recolte'], mods: { run: { viande: { perTrip: 2 } } } },
    { id: 'bonne_ponte', title: 'Bonne ponte', tone: 'pos', effect: 'Œufs : 2 jetons par trajet.', parade: null, when: ['recolte'], mods: { run: { oeuf: { perTrip: 2 } } } }
  ],
  [
    { id: 'greve', title: 'Grève des transporteurs', tone: 'neg', effect: 'Pas de vente directe cette saison.', parade: 'camionnette', when: ['marche'], mods: { directBlocked: true } },
    { id: 'hiver_gourmand', title: 'Hiver gourmand', tone: 'pos', effect: 'Les produits transformés valent +5 EB l’unité.', parade: null, when: ['bourse', 'marche'], mods: {} },
    { id: 'routes_enneigees', weather: 'froid', title: 'Routes enneigées', tone: 'neg', effect: 'Pas de vente directe cette saison.', parade: 'camionnette', when: ['marche'], mods: { directBlocked: true } },
    { id: 'tempete_neige', weather: 'orage', title: 'Tempête de neige', tone: 'neg', effect: 'Récolte raccourcie d’un tiers.', parade: 'lampe', when: ['recolte'], mods: { stopEarlySec: 30 } },
    { id: 'canalisations', weather: 'froid', title: 'Canalisations gelées', tone: 'neg', effect: 'Lait et viande : les coureurs ne courent que la moitié du temps.', parade: 'arrosage', when: ['recolte'], mods: { run: { lait: { dur: 0.5 }, viande: { dur: 0.5 } } } },
    { id: 'hiver_doux', weather: 'doux', title: 'Hiver doux', tone: 'pos', effect: 'Lait et œufs : course rallongée de moitié.', parade: null, when: ['recolte'], mods: { run: { lait: { dur: 1.5 }, oeuf: { dur: 1.5 } } } }
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
// Seul le stress compte : reussite = -1 boule pour chaque ferme, echec = +1 stress pour chaque ferme.
const COLLECTIVE = [
  { id: 'inondation', season: 0, title: 'Inondation', story: 'La rivière déborde : il faut renforcer les digues avant la fin de la saison.', goal: { kind: 'eb', perFarm: 15 }, due: 'achats',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' },
  { id: 'semences', season: 0, title: 'Semences communes', story: 'Le village veut replanter ensemble : chaque ferme met des fruits et légumes en commun.', goal: { kind: 'raw', product: 'fl', perFarm: 2 }, due: 'bourse',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' },
  { id: 'incendie', season: 1, title: 'Feu de broussailles', story: 'Un feu menace les lisières. Des volontaires prennent le stress pour éteindre : la moitié des fermes doit encaisser 1 point de stress.', goal: { kind: 'boule', perFarm: 0.5 }, due: 'bourse',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' },
  { id: 'fete_village', season: 1, title: 'Fête du village', story: 'On prépare le banquet : le village doit offrir des fromages.', goal: { kind: 'dish', dish: 'fromage', perFarm: 0.5 }, due: 'marche',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' },
  { id: 'epizootie', season: 2, title: 'Maladie du bétail', story: 'Une épidémie guette : le village finance une campagne de vaccination.', goal: { kind: 'eb', perFarm: 20 }, due: 'achats',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' },
  { id: 'soupe', season: 2, title: 'Soupe solidaire', story: 'Les fermes cuisinent ensemble pour les familles du village : il faut des œufs en commun.', goal: { kind: 'raw', product: 'oeuf', perFarm: 2 }, due: 'bourse',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' },
  { id: 'panne', season: 3, title: 'Panne d’électricité', story: 'Le village achète un groupe électrogène : chaque ferme met sa part.', goal: { kind: 'eb', perFarm: 20 }, due: 'achats',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' },
  { id: 'noel', season: 3, title: 'Marché de Noël', story: 'Le village tient un grand étal : il faut des confitures à vendre ensemble.', goal: { kind: 'dish', dish: 'confiture', perFarm: 0.75 }, due: 'marche',
    win: { bocalAll: -1 }, lose: { bocalAll: 1 }, winText: 'Le village s’en sort : −1 stress pour chaque ferme.', loseText: 'Le village trinque : +1 stress pour chaque ferme.' }
];

// Illustration (emoji) et ambiance animee de chaque carte, pour l'ecran projecteur (public/fx.js : rain storm hail snow blizzard frost heat dust
// fog steam night confetti leaves leaves-autumn petals sparkle sparkle-cold embers hearts).
const CARD_LOOK = {
  gel: ['🧊', 'frost'], naissances: ['🐐', 'hearts'], grele: ['🌨️', 'hail'], printemps_doux: ['🌸', 'petals'],
  canicule: ['🥵', 'heat'], touristes: ['🧳', 'confetti'], secheresse: ['🏜️', 'dust'], paturages: ['🐄', 'leaves'], potager_genereux: ['🥕', 'sparkle'],
  renard: ['🦊', 'night'], brouillard: ['🌫️', 'fog'], loup: ['🐺', 'night'], vendanges: ['🍇', 'leaves-autumn'], glands: ['🐗', 'leaves-autumn'], bonne_ponte: ['🥚', 'sparkle'],
  greve: ['🚧', 'snow'], hiver_gourmand: ['🍲', 'steam'], routes_enneigees: ['🛣️', 'snow'], tempete_neige: ['🌬️', 'blizzard'], canalisations: ['🚰', 'frost'], hiver_doux: ['🧣', 'sparkle-cold'],
  inondation: ['🌊', 'rain'], semences: ['🌱', 'leaves'], incendie: ['🔥', 'embers'], fete_village: ['🎉', 'confetti'],
  epizootie: ['🤒', 'fog'], soupe: ['🥣', 'steam'], panne: ['💡', 'storm'], noel: ['🎄', 'snow']
};
for (const c of CARDS.flat().concat(COLLECTIVE)) { const l = CARD_LOOK[c.id]; if (l) { c.icon = l[0]; c.fx = l[1]; } }

// Roue du marche : 12 cases. mult utilise pour l'affichage et la regle "Touristes".
// Roue du marche : part de l'etal vendue en vente directe (frac). Le supermarche, lui, ne passe jamais par la roue.
// 12 cases. Tout vendre (2 cases sur 12, jamais plus de 20 % des tirages) retire 1 stress ; ne rien vendre en ajoute 1 ; la relance gratuite permet de retourner la roue sans payer.
const WHEEL = [
  { label: 'Tout est vendu', frac: 1, stress: -1 }, { label: 'Tout est vendu', frac: 1, stress: -1 },
  { label: 'Les trois quarts vendus', frac: 0.75 }, { label: 'Les trois quarts vendus', frac: 0.75 }, { label: 'Les trois quarts vendus', frac: 0.75 }, { label: 'Les trois quarts vendus', frac: 0.75 }, { label: 'Les trois quarts vendus', frac: 0.75 },
  { label: 'La moitié vendue', frac: 0.5 }, { label: 'La moitié vendue', frac: 0.5 },
  { label: 'Rien ne se vend', frac: 0, stress: 1 },
  { label: 'Relance gratuite', frac: 0.5, free: true }, { label: 'Relance gratuite', frac: 0.5, free: true }
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

// ---------- Modes de partie ----------
// Taille des equipes (3 a 6 joueurs par ferme, reglage unique par partie ; 5 = valeurs de reference) : composition de depart et objectifs communs.
// Duree : 3 ans (reference) ou 2 ans (partie courte : 8 saisons, seuils d'etoiles et de stress resserres, finale de fete complete).
// Niveaux du bocal de stress. Le niveau est releve au debut de chaque saison et annonce sur le mobile et le projecteur.
// Effets (modifiables dans les reglages de l'application, pour toutes les parties : lib/config.js) :
//   runSec     : secondes de course en plus (ou en moins si negatif) pour tous les produits de la ferme, toute la saison
//   chargesPct : % ajoute (ou retire) aux charges de l'annee, selon le niveau de la derniere saison
// Dans les textes : {next} = stress restant avant le niveau suivant, {burn} = stress restant avant le burn-out.
const STRESS_LEVELS = {
  Zen: { icon: '😌', title: 'Ferme zen', effects: { runSec: 5, chargesPct: -10 },
    text: 'L’équipe garde la tête froide : les coureurs sont reposés et la comptabilité est sereine.' },
  Agité: { icon: '😬', title: 'Ferme agitée', effects: { runSec: 0, chargesPct: 0 },
    text: 'La tension monte : cette saison, l’équipe porte l’accessoire du niveau Agité (voir le maire du village). Encore {next} stress avant le niveau Stressé, {burn} avant le burn-out.' },
  Stressé: { icon: '🤯', title: 'Ferme stressée', effects: { runSec: -10, chargesPct: 10 },
    text: 'L’équipe est à bout de nerfs : elle porte l’accessoire du niveau Stressé, court moins longtemps et accumule les erreurs de gestion. Encore {burn} stress avant le burn-out.' }
};
const STRESS_DEFAULTS = JSON.parse(JSON.stringify(STRESS_LEVELS)); // valeurs d'origine (le bouton « Rétablir » des réglages)
const TEAM_SIZES = [3, 4, 5, 6];
const YEAR_CHOICES = [2, 3];
// challenge : defi de saison facultatif (zero perte) ; recap : bilan de saison au projecteur.
const MODE_DEFAULT = { size: 5, years: 3, challenge: false, recap: true };
const PROFILE_TILES = {
  bergers: { 3: { lait: 1, oeuf: 1 }, 4: { lait: 2, oeuf: 1 }, 5: { lait: 2, oeuf: 1 }, 6: { lait: 2, oeuf: 2 } },
  maraichers: { 3: { fl: 1, oeuf: 1 }, 4: { fl: 2, oeuf: 1 }, 5: { fl: 2, oeuf: 1 }, 6: { fl: 2, oeuf: 2 } },
  eleveurs: { 3: { viande: 1, lait: 1 }, 4: { viande: 2, lait: 1 }, 5: { viande: 2, lait: 1 }, 6: { viande: 2, lait: 2 } },
  gourmets: { 3: { viande: 1, fl: 1, atelier: 1 }, 4: { viande: 1, fl: 1, atelier: 1 }, 5: { viande: 1, fl: 1, atelier: 1 }, 6: { viande: 1, fl: 1, lait: 1, atelier: 1 } }
};
// Objectifs communs : valeur par ferme multipliee selon la taille des equipes.
const COLLECTIVE_SCALE = { 3: 0.9, 4: 0.95, 5: 1, 6: 1.1 };
// Regles selon la duree : cagnotte a atteindre (multiple du capital de depart, selon la taille des equipes), seuil d'etoile 1, bocal de stress
// (burn-out, niveaux), fetes jouees (index dans FETE). Valeurs calibrees par simulation (sim/).
const YEARS_RULES = {
  3: { s3Mult: { 3: 1.7, 4: 2.1, 5: S3_MULT, 6: 2.7 }, peakMax: PEAK_MAX, bocalMax: BOCAL_MAX, burnoutRestart: BURNOUT_RESTART, fete: [0, 1, 2] },
  2: { s3Mult: { 3: 1.3, 4: 1.5, 5: 1.6, 6: 1.8 }, peakMax: PEAK_MAX, bocalMax: 8, burnoutRestart: 2, fete: [0, 2] }
};

// Presentation projetee en salle d'attente (et pendant l'installation) : le maire du village la deroule diapo par diapo depuis sa console.
// Les chiffres (stress maximal, capital...) sont completes par le moteur (voir engine.tutoView).
const TUTO = [
  { icon: '🚜', title: 'Bienvenue au village du Phoenix', say: 'Accueillez les équipes : chaque équipe dirige une ferme, mais le village gagne ou perd ensemble.',
    points: ['Chaque équipe dirige une ferme pendant {years} ans', 'Quatre saisons par an, cinq étapes par saison', 'On gagne ensemble : jusqu’à 3 étoiles pour le village'] },
  { icon: '⭐', title: 'Les 3 étoiles du village', say: 'Insistez : aucune ferme ne gagne seule, il faut que tout le village tienne.',
    points: ['Étoile 1 : aucun burn-out et aucune ferme au-dessus de {peakMax} points de stress', 'Étoile 2 : toutes les Fêtes du Phoenix réussies ({fetes})', 'Étoile 3 : une caisse du village d’au moins {target} EB', 'Trophées : la ferme la plus riche et le Trophée du Sage (le moins de stress ajouté)'] },
  { icon: '🏡', title: 'Votre ferme', say: 'Montrez les tuiles et le plateau d’une ferme.',
    points: ['Une tuile de production = un coureur autorisé sur ce produit', 'Quatre produits : lait, œufs, viande, fruits et légumes', 'Capital de départ : {bank} EB, à dépenser à l’installation', 'Chaque joueur a un rôle qui change d’un cran chaque année'] },
  { icon: '🔁', title: 'Une saison en 5 étapes', say: 'Parcourez les cinq étapes avec le doigt sur l’écran.',
    points: ['1. Aléa : une carte tombe sur le village', '2. Récolte en relais : on court, un jeton par trajet', '3. Transformation et bourse : on fabrique des plats et on échange', '4. Marché : supermarché garanti ou étal risqué, la roue décide', '5. Achats et vacances : matériel, activités, détente'] },
  { icon: '🫙', title: 'Le bocal de stress', say: 'Chaque point de stress est un prix payé pour aller plus vite.',
    points: ['Coup de collier, éviter un aléa, relancer la roue : +1 stress', 'Zen, Agité, Stressé : le niveau se voit sur l’écran', 'À {bocalMax} points de stress : burn-out, la ferme s’arrête une saison', 'Les vacances et le hamac font redescendre le stress'] },
  { icon: '🎉', title: 'La Fête du Phoenix et les aléas collectifs', say: 'Expliquez la commande de la fête, répartie dès le début de l’année.',
    points: ['Chaque année, une commande de plats : les fermes se la répartissent', 'Fête réussie : −2 stress pour tous. Fête ratée : +2 pour tous, et +2 par plat manquant pour son responsable', 'Une fois par an, un aléa collectif : tout le village doit réunir un objectif ensemble', 'Aléa réussi : −1 stress pour chaque ferme. Manqué : +1'] },
  { icon: '📱', title: 'Sur votre mobile', say: 'Faites scanner le QR code : c’est l’outil de toutes les équipes.',
    points: ['Accueil : ce qu’il y a à faire maintenant, étape par étape', 'Ferme : votre stock, vos tuiles, vos objectifs et vos charges', 'Boutique : panier d’achats, vacances et activités', 'Banque : virements entre fermes et compte du village'] },
  { icon: '🚀', title: 'C’est parti !', say: 'Dernière question aux équipes, puis lancez l’installation.',
    points: ['Choisissez le nom de votre ferme sur votre mobile', 'Installation : répartissez la commande de la fête et achetez vos tuiles', 'Le maire du village est là pour répondre à vos questions'] }
];

module.exports = {
  TUTO, STRESS_LEVELS, STRESS_DEFAULTS,
  TEAM_SIZES, YEAR_CHOICES, MODE_DEFAULT, PROFILE_TILES, COLLECTIVE_SCALE, YEARS_RULES,
  DEFAULT_TRIP_SEC, TRIP_CHOICES, COLLIER_TRIPS, TRACTEUR_TRIPS, MIN_RUN_TRIPS, WINTER_FL_SERRE_TRIPS, MAX_TOKENS,
  SELL_TEXT,
  WEATHER, FORECAST_RELIABLE, FORECAST_BLUFF, COLLECTIVE,
  PRODUCTS, SEASONS, STEPS, TILE_PRICE, MARKET, DISHES, S3_MULT, PEAK_MAX, TRANSFER_REASONS, SETUP_SEC, REARRANGE_SEC, START_BANK, BOCAL_MAX, BURNOUT_RESTART,
  VACATION_COST, PROFILES, TILE_NAMES, CHARGES, CATALOGUE, CARDS, WHEEL, FETE, ACTIVITIES, VACATION_MAX, FETE_WIN, FETE_FAIL, FETE_MISSING, FETE_MISSING_CAP
};

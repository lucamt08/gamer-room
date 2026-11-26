// Aide à retrouver le nom "officiel" d'un jeu quand la recherche SteamGridDB ne trouve rien.
// Exemples de noms qui ne donnent rien tels quels :
//   "HorizonForbiddenWest_x64", "horizon forbiden west", "RE4", "Cyberpunk2077 GOTY Edition"...
//
// Ce fichier n'a aucune dépendance (pas d'Electron, pas de réseau) :
//  - nameVariants()     propose des orthographes "nettoyées" à essayer l'une après l'autre ;
//  - rankBySimilarity() trie les jeux trouvés du plus ressemblant au moins ressemblant ;
//  - isSameName()       dit si deux noms désignent le même jeu à la mise en forme près ;
//  - isGenericName()    repère les noms qui ne veulent rien dire ("launcher", "game", "start"...) ;
//  - fallbackNames()    propose d'autres noms possibles (carte d'identité du .exe, noms de dossiers).

import { basename, dirname } from 'node:path'

/** Nombre maximum d'orthographes de secours essayées (= nombre maximum d'appels à l'API). */
const MAX_VARIANTS = 8

/** Mots techniques qu'on trouve dans les noms de fichiers mais jamais dans le nom d'un jeu. */
const NOISE_WORDS = [
  'launcher', 'x64', 'x86', 'win64', 'win32', 'shipping', 'dx11', 'dx12', 'vulkan', 'client',
  'setup', 'bin', 'binaries', 'retail', 'exe', 'steam', 'epic', 'gog'
]

/** Mots d'édition : utiles sur la boîte, mais souvent absents du nom chez SteamGridDB. */
const EDITION_WORDS = [
  'edition', 'complete', 'definitive', 'deluxe', 'ultimate', 'goty', 'remastered', 'remaster',
  'enhanced', 'directors', 'director', 'cut', 'gold', 'premium', 'standard', 'anniversary', 'reloaded'
]

/** Petits mots qui ne suffisent pas, seuls, pour faire une recherche. */
const STOP_WORDS = ['the', 'a', 'an', 'of', 'le', 'la', 'les', 'de', 'des', 'du']

/** Abréviations courantes → nom complet. */
const ABBREVIATIONS: Record<string, string> = {
  ac: "assassin's creed",
  bg: "baldur's gate",
  botw: 'the legend of zelda breath of the wild',
  cod: 'call of duty',
  cs: 'counter-strike',
  csgo: 'counter-strike global offensive',
  dbd: 'dead by daylight',
  dl: 'dying light',
  er: 'elden ring',
  ff: 'final fantasy',
  fh: 'forza horizon',
  gta: 'grand theft auto',
  hfw: 'horizon forbidden west',
  hzd: 'horizon zero dawn',
  lol: 'league of legends',
  mgs: 'metal gear solid',
  mk: 'mortal kombat',
  nfs: 'need for speed',
  ow: 'overwatch',
  p5r: 'persona 5 royal',
  poe: 'path of exile',
  pubg: "playerunknown's battlegrounds",
  rdr: 'red dead redemption',
  re: 'resident evil',
  sf: 'street fighter',
  tlou: 'the last of us',
  totk: 'the legend of zelda tears of the kingdom',
  wow: 'world of warcraft'
}

/** Chiffres arabes ↔ chiffres romains (beaucoup de jeux s'écrivent "Final Fantasy VII", "GTA V"...). */
const ROMAN: Record<string, string> = {
  '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X'
}
const FROM_ROMAN: Record<string, string> = Object.fromEntries(
  Object.entries(ROMAN).map(([arabic, roman]) => [roman.toLowerCase(), arabic])
)

/**
 * Remet en forme un nom écrit "comme un fichier" :
 * "HorizonForbiddenWest_v1.2.3™" → "Horizon Forbidden West", "Cyberpunk2077" → "Cyberpunk 2077".
 */
export function normalizeName(text: string): string {
  return (
    text
      .replace(/[™®©]/g, '')
      // Numéros de version : "v1.2.3", "1.0.4"
      .replace(/\bv?\d+(\.\d+)+\b/gi, ' ')
      .replace(/[_.+]+/g, ' ')
      // Mots collés en "CamelCase" : "HorizonForbiddenWest" → "Horizon Forbidden West"
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      // Lettres collées à des chiffres (au moins 3 lettres, pour ne pas casser "F1" ou "CS2")
      .replace(/([a-zA-Z]{3,})(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z]{3,})/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Retire une liste de mots (sans tenir compte des majuscules). */
function removeWords(text: string, words: string[]): string {
  return text
    .split(' ')
    .filter((word) => !words.includes(word.toLowerCase()))
    .join(' ')
}

/** Retire les mentions d'édition : "Cyberpunk 2077 GOTY Edition" → "Cyberpunk 2077". */
function removeEditionWords(text: string): string {
  return removeWords(text.replace(/game of the year/gi, ' '), EDITION_WORDS).replace(/\s+/g, ' ').trim()
}

/** Remplace les abréviations : "RE4" → "resident evil 4", "gta 5" → "grand theft auto 5". */
function expandAbbreviations(text: string): string {
  return text
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase()
      if (ABBREVIATIONS[lower]) return ABBREVIATIONS[lower]
      // Abréviation collée à un numéro : "re4", "gta5", "rdr2"
      const glued = /^([a-z]+)(\d+)$/.exec(lower)
      if (glued && ABBREVIATIONS[glued[1]]) return `${ABBREVIATIONS[glued[1]]} ${glued[2]}`
      return word
    })
    .join(' ')
}

/**
 * Remplace le dernier numéro par un chiffre romain :
 * "grand theft auto 5" → "grand theft auto V", "final fantasy 7 remake" → "final fantasy VII remake".
 */
function toRomanNumbers(text: string): string {
  const words = text.split(' ')
  for (let i = words.length - 1; i >= 0; i--) {
    if (ROMAN[words[i]]) {
      words[i] = ROMAN[words[i]]
      break
    }
  }
  return words.join(' ')
}

/**
 * Orthographes de secours à essayer, de la plus précise à la plus large.
 * Le nom d'origine n'en fait pas partie (il a déjà été essayé).
 */
export function nameVariants(term: string): string[] {
  const variants: string[] = []
  const add = (candidate: string): void => {
    const clean = candidate.replace(/\s+/g, ' ').trim()
    if (clean.length < 2 || STOP_WORDS.includes(clean.toLowerCase())) return
    if (variants.some((v) => v.toLowerCase() === clean.toLowerCase())) return
    variants.push(clean)
  }

  // 1. Nom remis en forme, sans les mots techniques ni les mentions d'édition
  const cleaned = removeWords(normalizeName(term), NOISE_WORDS)
  add(cleaned)
  const base = removeEditionWords(cleaned)
  add(base)
  add(base.replace(/-/g, ' '))

  // 2. Abréviations développées, puis chiffres romains
  const expanded = expandAbbreviations(base)
  add(expanded)
  add(toRomanNumbers(expanded))

  // Un seul mot ne suffit que s'il est assez long et n'est pas un nombre ("west" ou "2077" seuls : trop vague)
  const isPrecise = (words: string[]): boolean => words.length >= 2 || (words[0].length >= 5 && !/^\d+$/.test(words[0]))

  // 3. On enlève des mots à la fin (utile en cas de faute de frappe : "horizon forbiden west" → "horizon")
  const words = expanded.split(' ').filter(Boolean)
  for (let count = words.length - 1; count >= 1; count--) {
    const part = words.slice(0, count)
    if (isPrecise(part)) add(part.join(' '))
  }

  // 4. On enlève des mots au début (faute de frappe sur le premier mot : "horzion forbidden west")
  for (let start = 1; start < words.length; start++) {
    const part = words.slice(start)
    if (isPrecise(part)) add(part.join(' '))
  }

  return variants.filter((v) => v.toLowerCase() !== term.trim().toLowerCase()).slice(0, MAX_VARIANTS)
}

/** Version "simplifiée" d'un nom pour les comparaisons : minuscules, sans accents ni ponctuation. */
function simplify(text: string): string[] {
  const withoutAccents = removeWords(normalizeName(text), NOISE_WORDS)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '') // "Baldur's" = "Baldurs"
  return expandAbbreviations(withoutAccents.replace(/[^a-z0-9 ]+/g, ' '))
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => FROM_ROMAN[word] ?? word)
}

/** Vrai si deux noms désignent le même jeu à la mise en forme près ("HorizonForbiddenWest" = "Horizon Forbidden West"). */
export function isSameName(a: string, b: string): boolean {
  return simplify(a).join(' ') === simplify(b).join(' ')
}

/** Nombre minimum de modifications de lettres pour passer d'un mot à l'autre (distance de Levenshtein). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    previous = current
  }
  return previous[b.length]
}

/** Ressemblance entre deux mots, de 0 (rien à voir) à 1 (identiques). */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const shortest = Math.min(a.length, b.length)
  if (shortest >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.8
  const allowedTypos = shortest >= 7 ? 2 : shortest >= 4 ? 1 : 0
  if (allowedTypos > 0 && editDistance(a, b) <= allowedTypos) return 0.75
  return 0
}

/** Ressemblance entre ce que l'utilisateur a tapé et le nom d'un jeu, de 0 à 1. */
export function nameSimilarity(typed: string, gameName: string): number {
  const typedWords = removeEditionWordsFromList(simplify(typed))
  const nameWords = removeEditionWordsFromList(simplify(gameName))
  if (typedWords.length === 0 || nameWords.length === 0) return 0
  if (typedWords.join(' ') === nameWords.join(' ')) return 1

  // Pour chaque mot tapé, on cherche le mot le plus ressemblant dans le nom du jeu
  const matched = typedWords.reduce(
    (total, word) => total + Math.max(...nameWords.map((other) => wordSimilarity(word, other))),
    0
  )
  // On favorise les noms qui contiennent tous les mots tapés, sans trop de mots en plus
  return 0.7 * (matched / typedWords.length) + 0.3 * (matched / nameWords.length)
}

function removeEditionWordsFromList(words: string[]): string[] {
  const kept = words.filter((word) => !EDITION_WORDS.includes(word))
  return kept.length > 0 ? kept : words
}

/** Mots qui, seuls, ne disent pas de quel jeu il s'agit ("launcher.exe", "game.exe", "start.exe"...). */
const GENERIC_WORDS = [
  'game', 'games', 'jeu', 'jeux', 'start', 'play', 'run', 'main', 'app', 'application', 'release',
  'build', 'content', 'common', 'steamapps', 'program', 'programs', 'files', 'local', 'appdata',
  'users', 'xboxgames', 'galaxy', 'engine', 'win'
]

/** Noms de produit qui ne sont pas des jeux : Windows lui-même, moteurs de jeu, lanceurs techniques. */
const NOT_A_GAME = /\b(microsoft|windows|operating system|unreal|unity|bootstrap|electron|java|python)\b/i

/** Vrai si un nom ne veut rien dire tout seul : "launcher", "Game_x64", "start"... */
export function isGenericName(name: string): boolean {
  const meaningful = normalizeName(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !NOISE_WORDS.includes(word) && !GENERIC_WORDS.includes(word))
  return meaningful.length === 0
}

/**
 * Autres noms possibles pour un jeu, du plus fiable au moins fiable :
 *  1. le nom du produit écrit dans le .exe par l'éditeur ("The Last of Us™ Part I") ;
 *  2. la description du .exe ;
 *  3. le nom du premier dossier parlant au-dessus du .exe
 *     (D:\jeux\The Last of Us - Part I\bin\x64\launcher.exe → "The Last of Us - Part I").
 * Les noms vides, génériques ou qui ne sont pas des jeux sont ignorés, ainsi que les doublons.
 */
export function fallbackNames(exePath: string, info: { productName: string | null; fileDescription: string | null }): string[] {
  const names: string[] = []
  const add = (candidate: string | null): void => {
    const clean = candidate ? normalizeName(candidate) : ''
    if (!clean || isGenericName(clean) || NOT_A_GAME.test(clean)) return
    if (names.some((name) => isSameName(name, clean))) return
    names.push(clean)
  }

  add(info.productName)
  add(info.fileDescription)

  // On remonte au maximum 4 dossiers, en sautant "bin", "x64", "Binaries", "Win64"...
  let folder = dirname(exePath)
  for (let level = 0; level < 4 && dirname(folder) !== folder; level++) {
    const folderName = basename(folder)
    if (!isGenericName(folderName)) {
      add(folderName)
      break
    }
    folder = dirname(folder)
  }
  return names
}

/** Trie des jeux trouvés du plus ressemblant au moins ressemblant à ce qui a été tapé. */
export function rankBySimilarity<T extends { name: string }>(typed: string, games: T[]): T[] {
  return games
    .map((game, index) => ({ game, index, score: nameSimilarity(typed, game.name) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.game)
}

// Lecteur du format « VDF binaire » de Valve (Steam), utilisé par plusieurs fichiers de Steam :
//  - appcache\appinfo.vdf (voir steamAppInfo.ts) ;
//  - appcache\stats\UserGameStatsSchema_<jeu>.bin et UserGameStats_<compte>_<jeu>.bin (succès, voir steamAchievements.ts).
//
// Le format : une suite de « clé → valeur ». Pour chaque entrée : un octet de type, la clé, puis la valeur.
// Types : 0 = bloc { … } (contient d'autres entrées), 1 = texte, 2 = entier 32 bits, 3 = décimal,
// 7 et 10 = entier 64 bits, 8 = fin du bloc.
// Les clés sont des textes terminés par un octet 0, sauf dans appinfo.vdf v29 où ce sont des numéros
// dans une table de textes (paramètre `strings`).

/** Un bloc lu : clé → texte, nombre ou sous-bloc. */
export type Kv = { [key: string]: string | number | Kv }

/** Lecteur de VDF binaire sur un buffer. */
export class VdfReader {
  pos = 0
  constructor(
    private buf: Buffer,
    private strings: string[] | null = null
  ) {}

  private cString(): string {
    const end = this.buf.indexOf(0, this.pos)
    const text = this.buf.toString('utf8', this.pos, end)
    this.pos = end + 1
    return text
  }

  private key(): string {
    if (!this.strings) return this.cString()
    const index = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return this.strings[index] ?? ''
  }

  /** Lit un bloc jusqu'à son octet de fin (8) ou la fin du fichier. */
  block(): Kv {
    const result: Kv = {}
    for (;;) {
      const type = this.buf[this.pos++]
      if (type === 0x08 || type === undefined) return result
      const key = this.key()
      switch (type) {
        case 0x00:
          result[key] = this.block()
          break
        case 0x01:
          result[key] = this.cString()
          break
        case 0x02:
          result[key] = this.buf.readInt32LE(this.pos)
          this.pos += 4
          break
        case 0x03:
          result[key] = this.buf.readFloatLE(this.pos)
          this.pos += 4
          break
        case 0x07:
        case 0x0a:
          result[key] = Number(this.buf.readBigUInt64LE(this.pos))
          this.pos += 8
          break
        default:
          throw new Error(`Type VDF inconnu (${type})`)
      }
    }
  }
}

/** Sous-bloc d'un bloc VDF, ou null. */
export function sub(kv: Kv | null | undefined, key: string): Kv | null {
  const value = kv?.[key]
  return value && typeof value === 'object' ? value : null
}

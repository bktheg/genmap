export class TaxierungSpec {
    constructor(public defaultValue:string|null, public overrides:Map<string,string>) {}
}

export function parseTaxierungSpec(str:string):TaxierungSpec {
    let defaultValue:string|null = null
    const overrides = new Map<string,string>()

    for( const rawPart of (str || '').split(';') ) {
        const part = rawPart.trim()
        if( part == '' ) {
            continue
        }

        const idx = part.indexOf('=')
        if( idx < 0 ) {
            if( defaultValue != null ) {
                throw new Error('Mehr als ein Standardwert für Taxierung: '+str)
            }
            defaultValue = part
            continue
        }

        const id = part.substring(0, idx).trim().toLowerCase()
        const value = part.substring(idx+1).trim()
        if( id == '' || value == '' ) {
            throw new Error('Ungültiger Taxierungs-Eintrag "'+part+'"')
        }
        if( overrides.has(id) ) {
            throw new Error('Taxierung für "'+id+'" doppelt vorhanden: '+str)
        }
        overrides.set(id, value)
    }

    return new TaxierungSpec(defaultValue, overrides)
}

/** ids must be ordered most specific first */
export function resolveTaxierungSpec(spec:TaxierungSpec, ids:string[]):string|null {
    for( const id of ids ) {
        const value = spec.overrides.get(id.toLowerCase())
        if( value != null ) {
            return value
        }
    }
    return spec.defaultValue
}

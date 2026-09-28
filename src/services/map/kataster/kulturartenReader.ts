import * as XLSX from 'xlsx/xlsx.js'
import * as XslxUtils from '#utils/xslxUtils'
import { AreaTyp } from '#kataster/parzellenReader'
import { MutterrolleTaxeKulturart } from '#kataster/mutterrolleNameListReader'
import { consola } from 'consola'
import * as gemeindeType from '#kataster/gemeindeType'
import { TaxierungSpec, parseTaxierungSpec, resolveTaxierungSpec } from '#kataster/taxierungSpec'
const katasterPath = process.env.KATASTER_PATH

class Kulturart {
    constructor(public kulturart:string, public kartendarstellung:AreaTyp, public taxiertAls:TaxierungSpec, public taxiertAlsRaw:string) {}
}

const KULTURARTEN = new Map<string,Kulturart>()
const DISPLAYLABELS = new Map<string,string>()

loadKulturarten()

export function lookupKartendarstellung(kulturart:string):AreaTyp|null {
    const kulturartObj = KULTURARTEN.get(kulturart.toLowerCase())
    if( !kulturartObj ) {
        return null
    }
    return kulturartObj.kartendarstellung;
}

export function lookupTaxierung(kulturart:string, gemeinde:gemeindeType.GemeindeId):MutterrolleTaxeKulturart|null {
    const kulturartObj = KULTURARTEN.get(kulturart.toLowerCase())
    if( !kulturartObj ) {
        return null
    }

    const buergermeisterei = gemeinde.getParent()
    const ids = [gemeinde.getId(), buergermeisterei.getId(), buergermeisterei.getKreis().getId()]
    const resolved = resolveTaxierungSpec(kulturartObj.taxiertAls, ids)
    if( resolved == null ) {
        if( kulturartObj.taxiertAlsRaw ) {
            consola.error(`Keine Taxierung für Kulturart ${kulturart} in Gemeinde ${gemeinde.getId()} (Bürgermeisterei ${buergermeisterei.getId()}, Kreis ${buergermeisterei.getKreis().getId()}) hinterlegt`)
        }
        return null
    }
    return mapTaxiertAls(resolved)
}

export function lookupDisplayLabel(kulturart:string):string {
    const label = DISPLAYLABELS.get(kulturart.trim().toLowerCase())

    return label || kulturart
}

function loadKulturarten():void {
    loadKulturartenFromFile(`${katasterPath}/kulturarten.xlsx`)

    consola.info(`${KULTURARTEN.size} Kulturarten geladen`);
}

function loadKulturartenFromFile(path:string):void {
    const workbook = XLSX.default.readFile(path);


    const sheet = new XslxUtils.TableLoader(workbook.Sheets[workbook.SheetNames[0]]);
    let i=1;
    while(true) {
        i++;
        const kulturart = sheet.readString("kulturart", i).trim()
        if( kulturart == '' ) {
            break;
        }
        
        const kartendarstellung = sheet.readString("kartendarstellung", i).trim()
        const taxiertAls = sheet.readString("taxiert als", i).trim()
        const label = sheet.readString("anzeigetext", i).trim()
       
        if( KULTURARTEN.has(kulturart) ) {
           throw Error("ERROR: Kulturart doppelt vorhanden: "+kulturart)
        }
        if( !kartendarstellung ) {
            throw Error("ERROR: Keine Kartendarstellung für Kulturart gesetzt: "+kulturart)
        }

        KULTURARTEN.set(kulturart, new Kulturart(kulturart, mapKartendarstellung(kartendarstellung), parseAndValidateTaxierung(kulturart, taxiertAls), taxiertAls))
        if( label ) {
            DISPLAYLABELS.set(kulturart, label)
        }
    }
}

function mapKartendarstellung(str:string):AreaTyp {
    switch(str.toLowerCase()) {
    case 'wasser':
        return AreaTyp.Wasser;
    case 'hofraum':
        return AreaTyp.Hofraum;
    case 'acker':
        return AreaTyp.Acker
    case 'weide':
        return AreaTyp.Weide;
    case 'wiese':
        return AreaTyp.Wiese;
    case 'garten':
        return AreaTyp.Garten;
    case 'friedhof':
        return AreaTyp.Friedhof;
    case 'holzung':
        return AreaTyp.Holzung;
    case 'grube':
        return AreaTyp.Grube;
    case 'unbekannt':
        return AreaTyp.Unbekannt
    case 'huetung':
        return AreaTyp.Huetung
    case 'bruecke':
        return AreaTyp.Bruecke
    case 'heide':
        return AreaTyp.Heide
    default:
        throw new Error('Kann Kulturart nicht laden. Unbekannte Kartendarstellung: '+str);
    }
}

function parseAndValidateTaxierung(kulturart:string, str:string):TaxierungSpec {
    try {
        const spec = parseTaxierungSpec(str)
        if( spec.defaultValue ) {
            mapTaxiertAls(spec.defaultValue)
        }
        spec.overrides.forEach(v => mapTaxiertAls(v))
        return spec
    }
    catch( e ) {
        throw new Error('Kulturart '+kulturart+': '+e.message)
    }
}

function mapTaxiertAls(str:string):MutterrolleTaxeKulturart|null {
    switch(str.trim().toLowerCase()) {
    case 'ackerland':
        return MutterrolleTaxeKulturart.Ackerland;
    case 'hofraum':
        return MutterrolleTaxeKulturart.Hofraum;
    case 'gemüsegarten':
        return MutterrolleTaxeKulturart.Gemuesegarten
    case 'weide':
        return MutterrolleTaxeKulturart.Weide;
    case 'wiese':
        return MutterrolleTaxeKulturart.Wiese;
    case 'obstgarten':
        return MutterrolleTaxeKulturart.Obstgarten;
    case 'hütung':
        return MutterrolleTaxeKulturart.Huetung;
    case 'holzung':
        return MutterrolleTaxeKulturart.Holzung;
    case 'steinbruch':
        return MutterrolleTaxeKulturart.Steinbruch;
    case 'teich':
        return MutterrolleTaxeKulturart.Teich;
    case 'heide':
        return MutterrolleTaxeKulturart.Heide;
    case 'öde':
        return MutterrolleTaxeKulturart.Oede;
    default:
        throw new Error('Kann Kulturart nicht laden. Unbekannte Taxierung: '+str);
    }
}
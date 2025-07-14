import * as XLSX from 'xlsx/xlsx.js'
import * as XslxUtils from '#utils/xslxUtils'
import { AreaTyp } from '#kataster/parzellenReader'
import { MutterrolleTaxeKulturart } from '#kataster/mutterrolleNameListReader'
import { consola } from 'consola'
const katasterPath = process.env.KATASTER_PATH

class Kulturart {
    constructor(public kulturart:string, public kartendarstellung:AreaTyp, public taxiertAls:MutterrolleTaxeKulturart|null) {}
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

export function lookupTaxierung(kulturart:string):MutterrolleTaxeKulturart|null {
    const kulturartObj = KULTURARTEN.get(kulturart.toLowerCase())
    if( !kulturartObj ) {
        return null
    }
    return kulturartObj.taxiertAls;
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

        KULTURARTEN.set(kulturart, new Kulturart(kulturart, mapKartendarstellung(kartendarstellung), mapTaxiertAls(taxiertAls)))
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
    default:
        throw new Error('Kann Kulturart nicht laden. Unbekannte Kartendarstellung: '+str);
    }
}

function mapTaxiertAls(str:string):MutterrolleTaxeKulturart|null {
    if( !str ) {
        return null
    }

    switch(str.toLowerCase()) {
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
    default:
        throw new Error('Kann Kulturart nicht laden. Unbekannte Taxierung: '+str);
    }
}
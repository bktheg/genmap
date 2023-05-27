import * as gemeindeType from '#kataster/gemeindeType'
import * as unitConversion from '#kataster/unitConversion'
import XLSX from 'xlsx'
import * as XslxUtils from '#utils/xslxUtils'
import { NumberRangeMatcher } from '#kataster/numberRangeMatcher'
import { consola } from 'consola'
const katasterPath = process.env.KATASTER_PATH

export enum MutterrolleTaxeKulturart {
    Ackerland,
    Wiese,
    Weide,
    Gemuesegarten,
    Obstgarten,
    Huetung,
    Hofraum,
    Holzung,
    Teich,
    Steinbruch
}

class MutterrolleTaxeEntry {
    constructor(public kulturart:MutterrolleTaxeKulturart, public fluren:NumberRangeMatcher|null, public taxen:unitConversion.Money[]) {}
}

export class MutterrolleTaxen {
    constructor(public gemeinde:gemeindeType.GemeindeId, public taxen:MutterrolleTaxeEntry[]) {}

    getTaxe(kulturart:MutterrolleTaxeKulturart, flur:number, klasse:number):unitConversion.Money {
        const entry = this.taxen.find(e => e.kulturart == kulturart && (!e.fluren || e.fluren.matches(`${flur}`)));
        const taxe = entry ? entry.taxen[klasse-1] : null
        return taxe ?? new unitConversion.Money(0,0,0);
    }
}

export class MutterrolleOwner {
    public paechter:string;
    public additionalNames:MutterrolleOwner[] = [];

    constructor(
        public gemeinde:gemeindeType.GemeindeId, 
        public artikel:string, 
        public name:string,
        public beruf:string, 
        public ort:string, 
        public area:unitConversion.Area, 
        public reinertrag:unitConversion.Money) {}

    getFullName():string {
        if( !this.name ) {
            return null;
        }
        
        const ownership = this.paechter != null || this.additionalNames.some(n => n.paechter != null)
        const separateOrte = this.additionalNames.length > 0 && this.additionalNames.find(n => n.ort.toLowerCase().trim() != this.ort.toLowerCase().trim());
        const parts = [];
        parts.push(separateOrte ? this.buildNameJobOwnership(ownership)+' '+this.getPrefixedOrt() : this.buildNameJobOwnership(ownership));
        for( const addName of this.additionalNames ) {
            parts.push(separateOrte ? addName.buildNameJobOwnership(ownership)+' '+addName.getPrefixedOrt() : addName.buildNameJobOwnership(ownership));
        }

        let result = parts[0];
        for( let i=1; i < parts.length; i++ ) {
            result += i < parts.length-1 ? ', ' : ' und ';
            result += parts[i];
        }
        return result + (separateOrte ? '' : ' '+this.getPrefixedOrt());
    }

    buildNameJobOwnership(ownership:boolean):string {
        let name = `${this.name.trim()}${this.beruf ? ', '+this.beruf.trim() : ''}`;
        if( ownership ) {
            if( this.paechter == null ) {
                name += ' (E)'
            }
            else if( this.paechter.toLowerCase() == 'x' ) {
                name += ' (P)';
            }
            else {
                name += ' ('+this.paechter+')';
            }
        }
        return name;
    }

    getPrefixedOrt():string {
        const prefixes = ['in', 'auf', 'auf\'m', 'aufm', 'zu', 'am', 'bei', 'zum', 'im', 'bey', 'an'];
        const includeOrtPrefix = this.ort && prefixes.every(e => !this.ort.startsWith(e+' '));

        return this.ort ? (includeOrtPrefix ? 'zu ' : '')+this.ort.trim() : '';
    }
}

let ARTIKEL:null|Map<string,MutterrolleOwner> = null

export function readAll():Map<string,MutterrolleOwner> {
    if( ARTIKEL ) {
        return ARTIKEL
    }

    const result = new Map<string,MutterrolleOwner>();
    XslxUtils.loadExcelsInPath(`${katasterPath}/mutterrollen_namen`, (path,file) => {
        let gemeinde = file.substring(0, file.indexOf("."));
        if( gemeinde.indexOf('-') ) {
            gemeinde = gemeinde.substring(gemeinde.indexOf('-')+1);
        }

        try {
            readOwnerMapFromExcelNameList(result, path+"/"+file, gemeindeType.forId(gemeinde));
        }
        catch( ex ) {
            consola.log("Konnte Namensliste", path+"/"+file, "nicht laden.", ex)
        }
    })

    ARTIKEL = result

    return result;
}

export function readGemeinde(gemeinde:gemeindeType.GemeindeId):Map<string,MutterrolleOwner> {
    const result = new Map<string,MutterrolleOwner>()
    for( const entry of readAll().values() ) {
        if( entry.gemeinde.getId() == gemeinde.getId() ) {
            result.set(entry.artikel, entry)
        }
    }
    return result
}


function readOwnerMapFromExcelNameList(result:Map<string,MutterrolleOwner>, path:string, gemeinde:gemeindeType.GemeindeId):void {
    const workbook = XLSX.readFile(path);

    const sheet = new XslxUtils.TableLoader(workbook.Sheets[workbook.SheetNames[0]]);
    if( !sheet.hasColumn("Jahr") ) {
        readOwnerMapOldFormat(result, gemeinde, sheet);
    }
    else {
        readOwnerMapNewFormat(result, gemeinde, sheet);
    }
}

function readOwnerMapOldFormat(result:Map<string,MutterrolleOwner>, gemeinde:gemeindeType.GemeindeId, sheet:XslxUtils.TableLoader):void {
    let i = 1;
    let skipped = 0;
    while(true) {
        i++;
        const artikel = sheet.readString('Artikel', i);
        const name = sheet.readString('Name',i);
        const ort = sheet.readString('Ort',i);
        const beruf = sheet.readString('Beruf',i);
        const flaeche = sheet.readString('Gesamtfläche',i);
        const reinertrag = sheet.readString('Reinertrag',i);
        if( artikel == '' ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }
        result.set(gemeinde.getId()+"-"+artikel, new MutterrolleOwner(gemeinde, artikel, name, beruf, ort, unitConversion.parseMorgenRutenFuss(flaeche), unitConversion.parseMoney(reinertrag)));
    }
}

function readOwnerMapNewFormat(result:Map<string,MutterrolleOwner>, gemeinde:gemeindeType.GemeindeId, sheet:XslxUtils.TableLoader):void {
    let i = 1;
    let skipped = 0;
    let currentArtikel = '';
    let lastOwner = null;
    let skipRestOfArtikel = false;
    while(true) {
        i++;
        const artikel = sheet.readString('Artikel', i);
        const name = sheet.readString('Name',i);
        const ort = sheet.readString('Ort',i);
        const beruf = sheet.readString('Beruf',i);
        const flaeche = sheet.readString('Gesamtfläche',i);
        const reinertrag = sheet.readString('Reinertrag',i);
        const jahr = sheet.readString('Jahr',i);
        const paechter = sheet.readString('Pächter',i);

        if( name == '' && flaeche == '' ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }

        const isAdditionalName = artikel && artikel.toLowerCase().trim() == 'u';

        if( artikel && !isAdditionalName ) {
            currentArtikel = artikel;
            skipRestOfArtikel = false;
        }
        else if ( !isAdditionalName || skipRestOfArtikel ) {
            skipRestOfArtikel = true
            // Ignore later name changes for now
            continue;
        }
        
        const owner = new MutterrolleOwner(gemeinde, currentArtikel, name, beruf, ort, unitConversion.parseMorgenRutenFuss(flaeche), unitConversion.parseMoney(reinertrag));
        owner.paechter = paechter != null && paechter.trim() != '' ? paechter : null;

        if( isAdditionalName ) {
            lastOwner.additionalNames.push(owner);
        }
        else {
            result.set(gemeinde.getId()+"-"+currentArtikel, owner);
            lastOwner = owner;
        }
    }
}

export function readTaxen(gemeinde:gemeindeType.GemeindeId):MutterrolleTaxen {
    const result = new Map<gemeindeType.GemeindeId,MutterrolleTaxen>();
    XslxUtils.loadExcelsInPath(`${katasterPath}/mutterrollen_namen`, (path,file) => {
        let gemeindeStr = file.substring(0, file.indexOf("."));
        if( gemeindeStr.indexOf('-') ) {
            gemeindeStr = gemeindeStr.substring(gemeindeStr.indexOf('-')+1);
        }

        if( gemeinde.getId() == gemeindeStr ) {
            try {
                readTaxenFromExcel(result, path+"/"+file, gemeinde);
            }
            catch( ex ) {
                consola.error("Fehler beim Lesen der Taxen in", path+"/"+file, ". Fehler: ", ex)
            }
        }
    })
    
    return result.get(gemeinde);
}


function readTaxenFromExcel(result:Map<gemeindeType.GemeindeId,MutterrolleTaxen>, path:string, gemeinde:gemeindeType.GemeindeId):void {
    const workbook = XLSX.readFile(path);

    if( !workbook.Sheets['Tarife pro Morgen'] ) {
        return;
    }

    const sheet = new XslxUtils.TableLoader(workbook.Sheets['Tarife pro Morgen']);

    const taxen = []
    let i = 1;
    let skipped = 0;
    while(true) {
        i++;
        const kulturart = sheet.readString('Kulturart', i);
        const fluren = sheet.readString('Fluren', i);
        const klasse1 = sheet.readString('1. Klasse',i);
        const klasse2 = sheet.readString('2. Klasse',i);
        const klasse3 = sheet.readString('3. Klasse',i);
        const klasse4 = sheet.readString('4. Klasse',i);
        const klasse5 = sheet.readString('5. Klasse',i);
        if( kulturart == '' ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }

        taxen.push(new MutterrolleTaxeEntry(mapKulturartTaxe(kulturart), 
            fluren ? new NumberRangeMatcher(fluren) : null,
            [
                unitConversion.parseMoney(klasse1),
                unitConversion.parseMoney(klasse2),
                unitConversion.parseMoney(klasse3),
                unitConversion.parseMoney(klasse4),
                unitConversion.parseMoney(klasse5)
            ])
        )
    }
    result.set(gemeinde, new MutterrolleTaxen(gemeinde, taxen));
}

function mapKulturartTaxe(kulturart:string):MutterrolleTaxeKulturart {
    switch(kulturart.toLowerCase()) {
    case 'ackerland':
    case 'acker':
    case 'äcker':
        return MutterrolleTaxeKulturart.Ackerland;
    case 'wiese':
    case 'wiesen':
        return MutterrolleTaxeKulturart.Wiese;
    case 'holz':
    case 'holzung':
    case 'holzungen':
        return MutterrolleTaxeKulturart.Holzung;
    case 'garten':
    case 'gärten':
    case 'gemüsegarten':
    case 'gemüsegärten':
        return MutterrolleTaxeKulturart.Gemuesegarten;
    case 'obstgarten':
    case 'obstgärten':
        return MutterrolleTaxeKulturart.Obstgarten;
    case 'binnen weiden':
    case 'weide':
    case 'weiden':
        return MutterrolleTaxeKulturart.Weide;
    case 'hütung':
    case 'hütungen':
        return MutterrolleTaxeKulturart.Huetung;
    case 'hofraum':
    case 'hofräume':
    case 'haus et hofräume':
        return MutterrolleTaxeKulturart.Hofraum;
    case 'teich':
    case 'teiche':
        return MutterrolleTaxeKulturart.Teich;
    case 'steinbruch':
    case 'steinbrüche':
        return MutterrolleTaxeKulturart.Steinbruch;
    }
    throw new Error('Unbekannter Kulturart Taxen-Typ '+kulturart);
}
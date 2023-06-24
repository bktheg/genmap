import XLSX from 'xlsx'
import * as fs from 'fs'
import { AreaTyp } from '#kataster/parzellenReader';
import * as gemeindeType from '#kataster/gemeindeType'
import * as unitConversion from '#kataster/unitConversion'
import { lookupKartendarstellung, lookupDisplayLabel } from '#kataster/kulturartenReader';
import { consola } from 'consola';
import * as XslxUtils from '#utils/xslxUtils'

export class Parzelle {
    public areaTaxable:unitConversion.Area = new unitConversion.Area(0,0,0);
    public areaNonTaxable:unitConversion.Area = new unitConversion.Area(0,0,0);
    public reinertrag:unitConversion.Money;
    public owner:string;
    public typPlain:string;
    public lage:string;
    public klasse:string;
    public subrows:Parzelle[] = []

    constructor(public mutterrolle:string, public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string, public typ:AreaTyp[]) {};

    id():string {
        return this.gemeinde.getId()+"-"+this.flur+"-"+this.nr;
    }
}

export class FlurSumme {
    constructor(public page:number, public start:string, public end:string, public area:unitConversion.Area, public areaFree:unitConversion.Area|null, public reinertrag:unitConversion.Money|null, public reinertragFree:unitConversion.Money|null) {}
}

export class Flur {
    public parzellen:Map<string,Parzelle> = new Map();
    public summen:FlurSumme[] = [];

    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number) {}

    public add(parzelle:Parzelle):void {
        this.parzellen.set(parzelle.nr, parzelle);
    }

    public get(parzelle:string):Parzelle {
        return this.parzellen.get(parzelle);
    }

    public addSumme(page:number, startParzelle:string, endParzelle:string, area:unitConversion.Area, areaFree:unitConversion.Area, reinertrag:unitConversion.Money, reinertragFree:unitConversion.Money|null):void {
        this.summen.push(new FlurSumme(page, startParzelle, endParzelle, area, areaFree, reinertrag, reinertragFree));
    }
}

const FLURBUCH_FILES:Map<string,string> = new Map();
const FLURBUCH:Map<string,Flur> = new Map();

searchForFiles();

export function searchForFiles():void {
    const katasterPath = process.env.KATASTER_PATH;

    FLURBUCH_FILES.clear();

    XslxUtils.loadExcelsInPath(`${katasterPath}/flurbücher`, (path,file) => {
        let name = file.substring(0, file.indexOf("."));
        let parts = name.split('-');

        try {
            const gemeinde = gemeindeType.forId(parts[parts.length-2]);
            const flur = parts[parts.length-1];

            FLURBUCH_FILES.set(`${gemeinde.getId()}-${flur}`, path+"/"+file);
        }
        catch( ex ) {
            consola.log("Konnte Flurbuch", path+"/"+file, "keiner Gemeinde zuordnen. Bitte Dateinamen überprüfen.", ex)
        }
    });

    consola.info(`${FLURBUCH_FILES.size} Flurbuch-Dateien gefunden`);
}

export function hasFlurbuch(gemeinde:gemeindeType.GemeindeId, flur:number):boolean {
    return FLURBUCH_FILES.has(`${gemeinde.getId()}-${flur}`)
}

export function loadAllEntries(gemeinde:gemeindeType.GemeindeId, flur:number):Flur {
    if( !FLURBUCH.has(gemeinde.getId()+"-"+flur) ) {
        try {
            const flurData = loadFile(gemeinde, flur);
            if( !flurData || flurData.parzellen.size == 0 ) {
                consola.error(`Kein Flurbuch für ${gemeinde.getId()}-${flur} gefunden`)
            }

            FLURBUCH.set(gemeinde.getId()+"-"+flur, flurData);
        }
        catch( ex ) {
            consola.log("Konnte Flurbuch für", gemeinde.getId()+"-"+flur, "nicht laden.", ex);
        }
    }
    return FLURBUCH.get(gemeinde.getId()+"-"+flur);
}

export function loadEntry(gemeinde:gemeindeType.GemeindeId, flur:number, nr:string):Parzelle {
    const parzellen = loadAllEntries(gemeinde, flur);
    if( parzellen == null ) {
        return null;
    }
    return parzellen.get(nr);
}

function loadFile(gemeinde:gemeindeType.GemeindeId, flur:number):Flur {
    const result = new Flur(gemeinde, flur);
    const path = FLURBUCH_FILES.get(`${gemeinde.getId()}-${flur}`);
    if( !path ) {
        return result;
    }
    
    if( !fs.existsSync(path) ) {
        consola.log("Konnte Flurbuch nicht finden: ", path);
        return result;
    }

    const workbook = XLSX.readFile(path);

    let sheet = workbook.Sheets['Blatt1'];
    if( !sheet ) {
        sheet = workbook.Sheets[workbook.SheetNames[0]];
    }
    let i = 3;
    let skipped = 0;
    let lastParzelle:Parzelle = null;
    while(true) {
        i++;
        const mutterrolle = readStringCell(sheet, 'B', i);
        if( mutterrolle == 'gestrichen' ) {
            continue;
        }
        const nr = readStringCell(sheet, 'C', i);
        const art = readStringCell(sheet, 'E', i);
        if( art == '' && nr == '' ) {
            if( skipped++ > 5 ) {
                break;
            }
            continue;
        }
        if( nr == '' ) {
            if( lastParzelle != null ) {
                const subrow = readParzelle(sheet, gemeinde, flur, i);
                if( lastParzelle.subrows.length == 0 ) {
                    lastParzelle.subrows.push({...lastParzelle} as Parzelle)
                }
                lastParzelle.subrows.push(subrow)

                lastParzelle.areaTaxable = lastParzelle.areaTaxable.add(subrow.areaTaxable);
                lastParzelle.areaNonTaxable = lastParzelle.areaNonTaxable.add(subrow.areaNonTaxable);
                if( subrow.reinertrag ) {
                    lastParzelle.reinertrag = lastParzelle.reinertrag != null ? lastParzelle.reinertrag.add(subrow.reinertrag) : subrow.reinertrag;
                }
                
                for( const type of mapType(gemeinde, flur, subrow.typPlain) ) {
                    if( !lastParzelle.typ.includes(type) ) {
                        lastParzelle.typ.push(type);
                    }
                }
                lastParzelle.typPlain += ", "+subrow.typPlain;
                lastParzelle.klasse = (lastParzelle.klasse || '')+ "; "+(subrow.klasse || '');
            }
            continue;
        }
        skipped = 0;

        lastParzelle = readParzelle(sheet, gemeinde, flur, i);

        result.add(lastParzelle);
    }

    if( !workbook.Sheets['Summen'] ) {
        throw new Error("Blatt 'Summen' fehlt für Flurbuch "+path);
    }
    
    const summenSheet = workbook.Sheets['Summen'];
    i = 1;
    while(true) {
        i++;
        const page = readNumberCell(summenSheet, 'A', i);
        if( !page ) {
            break;
        }
        const start = readStringCell(summenSheet, 'B', i);
        const ende = readStringCell(summenSheet, 'C', i);
        const m = readNumberCell(summenSheet, 'D', i);
        const r = readNumberCell(summenSheet, 'E', i);
        const f = readNumberCell(summenSheet, 'F', i);
        const mFree = readNumberCell(summenSheet, 'J', i);
        const rFree = readNumberCell(summenSheet, 'K', i);
        const fFree = readNumberCell(summenSheet, 'L', i);

        const reinertrag = readMoney(summenSheet, 'G', 'H', 'I', i);

        const rthlrFree = readNumberCell(summenSheet, 'M', i);
        const groschenFree = readNumberCell(summenSheet, 'N', i);
        const pfennigFree = readNumberCell(summenSheet, 'O', i);

        const free =  mFree||rFree||fFree;

        result.addSumme(page, start, ende, 
            new unitConversion.Area(m, r, f), 
            free ? new unitConversion.Area(mFree, rFree, fFree) : null,
            reinertrag,
            free ? new unitConversion.Money(rthlrFree, groschenFree, pfennigFree) : null
        );
    }

    return result;
}

function readParzelle(sheet:XLSX.WorkSheet, gemeinde:gemeindeType.GemeindeId, flur:number, i:number):Parzelle {
    const mutterrolle = readStringCell(sheet, 'B', i);
    const nr = readStringCell(sheet, 'C', i);
    const art = readStringCell(sheet, 'E', i);
    const klasse = readStringCell(sheet, 'O', i);
    
    const parzelle = new Parzelle(
        mutterrolle,
        gemeinde,
        flur,
        `${nr}`,
        mapType(gemeinde, flur, art)
    );

    parzelle.owner = readStringCell(sheet, 'D', i);
    parzelle.lage = readStringCell(sheet, 'A', i);
    parzelle.typPlain = lookupDisplayLabel(art)
    parzelle.klasse = klasse ? `${klasse}` : null;

    parzelle.areaTaxable = readArea(sheet, 'F', 'G', 'H', i);
    parzelle.areaNonTaxable = readArea(sheet, 'I', 'J', 'K', i);
    parzelle.reinertrag = readMoney(sheet, 'AT', 'AU', 'AV', i);

    return parzelle;
}

function readArea(sheet:XLSX.WorkSheet, rowM:string, rowR:string, rowF:string, col:number):unitConversion.Area {
    const valueM = readStringCell(sheet, rowM, col);
    const valueR = readStringCell(sheet, rowR, col);
    const valueF = readStringCell(sheet, rowF, col);

    if( !valueM && !valueR && !valueF && valueM != 0 && valueR != 0 && valueF != 0 ) {
        return null;
    }

    const area = new unitConversion.Area(
        valueM ? parseInt(valueM) : 0,
        valueR ? parseInt(valueR) : 0,
        valueF ? parseFloat(valueF) : 0
    )
    if( isNaN(area.getTotalFuss()) ) {
        consola.warn(`Ungültige Fläche: ${valueM}.${valueR}.${valueF}`)
    }
    return area;
}

function readMoney(sheet:XLSX.WorkSheet, rowM:string, rowR:string, rowF:string, col:number):unitConversion.Money {
    const valueT = readStringCell(sheet, rowM, col);
    const valueG = readStringCell(sheet, rowR, col);
    const valueP = readStringCell(sheet, rowF, col);

    if( !valueT && !valueG && !valueP && valueT != '0' && valueG != '0' && valueP != '0' ) {
        return null;
    }

    const money = new unitConversion.Money(
        valueT ? parseInt(valueT) : 0,
        valueG ? parseInt(valueG) : 0,
        valueP ? parseInt(valueP) : 0
    )
    if( isNaN(money.getTotalPfennig()) ) {
        consola.warn(`Ungültiger Reinertrag: ${valueT}.${valueG}.${valueP}`)
    }
    return money;
}

export function mapType(gemeinde:gemeindeType.GemeindeId, flur:number, art:string):AreaTyp[] {
    art = art.split(" und ").join(" u. ");
    const parts = art.toLowerCase().split(" u.");
    const result:Set<AreaTyp> = new Set();

    for( const part of parts ) {
        if( part.trim() == "" ) {
            continue;
        }
        const darstellung = lookupKartendarstellung(part.trim())
        if( darstellung != null ) {
            result.add(darstellung)
        }
        else if( part.indexOf('=') > -1 ) {
            mapType(gemeinde, flur, part.substring(0, part.indexOf('='))).forEach(item => result.add(item));
        }
        else {
            consola.warn(`Unbekannte Kulturart ${part} in ${gemeinde.getId()}-${flur}. Konnte keine Darstellung ermitteln.`);
        }
    }

    return Array.from(result.values());
}

function readStringCell(sheet:XLSX.WorkSheet, row:string, col:number) {
    const cell = sheet[row+col];
    return cell?.v?.toString() || '';
}

function readNumberCell(sheet:XLSX.WorkSheet, row:string, col:number):number {
    const cell = sheet[row+col];
    if( cell && cell.v != '' ) {
        if( typeof cell.v == "string" ) {
            return parseFloat(cell.v);
        }
        return cell.v;
    }
    return null;
}
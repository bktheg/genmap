import * as flurbuchReader from '#kataster/flurbuchReader'
import * as mapWriter from '#kataster/mapWriter'
import * as database from '#utils/database'
import * as utils from '#utils/utils'
import * as gemeindeType from '#kataster/gemeindeType'
import * as fs from 'fs'
import XLSX from 'xlsx'
import * as unitConversion from '#kataster/unitConversion'
import * as mutterrolleNameListReader from '#kataster/mutterrolleNameListReader'
import { consola } from 'consola'

const katasterPath = process.env.KATASTER_PATH

class DbArea {
    public size:unitConversion.Area;
    public reinertrag:unitConversion.Money;
    public mutterrolle:string;
    public owner:string;
    public typ:string;
    public lage:string;
    public klasse:string;

    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string) {}

    id():string {
        return this.gemeinde.getId()+"-"+this.flur+"-"+this.nr;
    }
}

async function readDbAreas(gemeinde:gemeindeType.GemeindeId):Promise<Map<string,DbArea>> {
    let areas;
    if( gemeinde == null ) {
        areas = await database.getClient().query({
            text: `SELECT a.gemeinde as gemeinde,a.flur as flur,a.nr as no FROM kataster_gen_areas a WHERE yearfrom<=1825 AND yeartill>=1825 AND typ=0`, 
            values: []
        })
    }
    else {
        areas = await database.getClient().query({
            text: `SELECT a.gemeinde as gemeinde,a.flur as flur,a.nr as no FROM kataster_gen_areas a WHERE yearfrom<=1825 AND yeartill>=1825 AND typ=0 AND gemeinde=$1`, 
            values: [gemeinde.getId()]
        })
    }

    const map = new Map<string,DbArea>();
    for( const r of areas.rows ) {
        const area = new DbArea(gemeindeType.forId(r.gemeinde), r.flur, r.no);
        map.set(area.id(), area);
    }
    consola.debug(areas.rows.length, "Parzellen aus PostGIS für Gemeinde", gemeinde?.getId(),"gelesen")
    return map;
}

async function writeAreasToDB(areas:Map<string,DbArea>) {
    await writeInfo([...areas.values()]);
}

async function writeInfo(areas:DbArea[]) {
    const MAX = 4096;
    if( areas.length > MAX ) {
        for( let i=0; i<areas.length; i+=MAX ) {
            await writeInfo(areas.slice(i, i+MAX));
        }
        return;
    }

    consola.debug("Schreibe", areas.length, "Parzellen nach kataster_urkataster_info")

    let query = "INSERT INTO kataster_urkataster_info (gemeinde,flur,nr,flaeche,reinertrag,mutterrolle,eigentuemer,typPlain,lage,klasse) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of areas ) {
        const part = "($"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+")";
        values.push(a.gemeinde.getId());
        values.push(a.flur);
        values.push(a.nr);
        if( a.size ) {
            values.push(a.size.toString());
        }
        else {
            values.push(null);
        }
        if( a.reinertrag ) {
            values.push(a.reinertrag.toString());
        }
        else {
            values.push(null);
        }
        values.push(a.mutterrolle);
        if( a.owner && a.owner.length > 128 ) {
            consola.warn("Eigentümer zu lang, maximal 128 Zeichen erlaubt. Der Name wird gekürzt. ", a.owner, "Artikelnummer", a.id());
            values.push(a.owner.substring(0,128));
        }
        else {
            values.push(a.owner);
        }
        values.push(a.typ);
        values.push(a.lage);
        values.push(a.klasse)
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

class MutterrolleEntryAlternative {
    public counter = 1;
    constructor(public name:string, public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string) {}

    public parzelleId() {
        return `${this.gemeinde.getId()}-${this.flur}-${this.nr}`
    }
}

class MutterrolleEntry {
    public alteratives:Map<string,MutterrolleEntryAlternative> = new Map();

    constructor(public gemeinde:gemeindeType.GemeindeId, public mutterrolle:string) {
    }

    addAlternativeFromFlurbuch(entry:flurbuchReader.Parzelle) {
        this.addAlternativeInternal(entry.owner, entry.flur, entry.nr);
    }

    private addAlternativeInternal(name:string, flur:number, parzelle:string) {
        if( !this.alteratives.has(name) ) {
            this.alteratives.set(name, new MutterrolleEntryAlternative(name, this.gemeinde, flur, parzelle));
        }
        else {
            this.alteratives.get(name).counter++;
        }
    }

    public hasAlternative(name:string):boolean {
        return this.alteratives.has(name);
    }

    public getBestName():MutterrolleEntryAlternative {
        let bestAlternative:MutterrolleEntryAlternative = null;
        for( const alt of this.alteratives.values() ) {
            if( bestAlternative == null ) {
                bestAlternative = alt;
            }
            else if( bestAlternative.counter < alt.counter || ((bestAlternative.counter == alt.counter) && bestAlternative.name.length < alt.name.length)) {
                bestAlternative = alt;
            }
        }

        return bestAlternative;
    }

    public getOtherNames():MutterrolleEntryAlternative[] {
        const bestName = this.getBestName();
        return [...this.alteratives.values()].filter(a => a.name != bestName.name);
    }
}

function createOwnerMap(gemeinde:gemeindeType.GemeindeId):Map<string,MutterrolleEntry> {
    const ownerMap = new Map<string,MutterrolleEntry>();
     
    for( const flur of gemeinde.getFlure() ) {
        if( !flurbuchReader.hasFlurbuch(gemeinde, flur.id) ) {
            continue;
        }
        for( const parzelle of flurbuchReader.loadAllEntries(gemeinde, flur.id).parzellen.values() ) {
            if( !parzelle.nr || parzelle.nr == "none" ) {
                continue;
            }
            
            if( parzelle.mutterrolle ) {
                const mutterrolleId = gemeinde.getId()+"-"+parzelle.mutterrolle;

                if( parzelle.owner ) {
                    if( ownerMap.has(mutterrolleId) ) {
                        const refOwner = ownerMap.get(mutterrolleId);
                        refOwner.addAlternativeFromFlurbuch(parzelle);
                    }
                    else {
                        const newOwner = new MutterrolleEntry(gemeinde, parzelle.mutterrolle)
                        newOwner.addAlternativeFromFlurbuch(parzelle);
                        ownerMap.set(mutterrolleId, newOwner);

                    }
                }
            }
        }
    }
    return ownerMap;
}

export async function generateUrkatasterInfo(gemeinde:gemeindeType.GemeindeId) {
    consola.start("Erzeuge Zusatzinformationen für Gemeinde", gemeinde?.getId() || "*")

    await mapWriter.cleanUpUrkatasterInfoForGemeinde(gemeinde);

    const currentAreas:Map<string,DbArea> = await readDbAreas(gemeinde);

    const masterOwner = readOwnerMapFromExcel(`${katasterPath}/mutterrollen-master.xlsx`);
    for( const entry of mutterrolleNameListReader.readAll()) {
        if( entry[1].getFullName() ) {
            masterOwner.set(entry[0], entry[1].getFullName());
        }
    }
    const ownerMap = createOwnerMap(gemeinde);
    const warnings = new Set<string>();

    consola.debug(ownerMap.size, "Eigentümer ermittelt")

    for( const area of currentAreas.values() ) {
        if( !area.nr || area.nr == "none" ) {
            continue;
        }
        const entry = flurbuchReader.loadEntry(area.gemeinde, area.flur, area.nr);
        if( !entry ) {
            continue;
        }
        if( gemeinde != null && entry.gemeinde.getId() != gemeinde.getId() ) {
            continue;
        }

        if( !entry.areaTaxable.isZero() || !entry.areaNonTaxable.isZero() ) {
            area.size = entry.areaNonTaxable.add(entry.areaTaxable);
        }

        area.reinertrag = entry.reinertrag;
        area.mutterrolle = entry.mutterrolle;
        area.typ = entry.typPlain;
        area.lage = entry.lage;
        area.klasse = entry.klasse
        if( entry.mutterrolle ) {
            const mutterrolleId = entry.gemeinde.getId()+"-"+entry.mutterrolle;

            if( masterOwner.has(mutterrolleId) ) {
                area.owner = masterOwner.get(mutterrolleId);
            }
            else if( ownerMap.has(mutterrolleId) ) {
                area.owner = ownerMap.get(mutterrolleId).getBestName()?.name;
            }
        }
        else {
            area.owner = entry.owner;
        }

        if( !area.lage ) {
            const warning = `${area.gemeinde.getId()}-${area.flur}-lage`;
            if( !warnings.has(warning) ) {
                consola.warn(`Fehlende Lageangaben: ${area.gemeinde.getId()}-${area.flur}: Parzelle ${area.nr}`)
                warnings.add(warning);
            }
        }
        if( !area.klasse ) {
            const warning = `${area.gemeinde.getId()}-${area.flur}-klasse`;
            if( !warnings.has(warning) ) {
                consola.warn(`Fehlende Klasse: ${area.gemeinde.getId()}-${area.flur}: Parzelle ${area.nr}`)
                warnings.add(warning);
            }
        }
    }

    await writeAreasToDB(currentAreas);
    await writeOwnerMap(masterOwner, ownerMap);
}

function isLogOwnerWarning(refOwner:string, owner:string):boolean {
    return !utils.compareTextWithAbbreviations(cleanupOwner(refOwner), cleanupOwner(owner));
}

function cleanupOwner(owner:string):string {
    owner = owner.replace("Wm.", "Wilhelm");
    owner = owner.replace("Wilh.", "Wilhelm");
    owner = owner.replace("Wwe.", "Wittwe");
    owner = owner.replace("Hnr.", "Heinrich");
    owner = owner.replace("Hr.", "Heinrich");
    owner = owner.replace("Ddr.", "Diedrich");
    owner = owner.split("ö").join("oe");
    owner = owner.split("Ö").join("Oe");
    owner = owner.split("ü").join("ue");
    owner = owner.split("ä").join("ae");
    owner = owner.split("ß").join("ss");
    owner = owner.split("th").join("t");
    owner = owner.split("ph").join("f");
    owner = owner.split(",").join("");
    owner = owner.split("-").join(" ");
    owner = owner.split(" zu ").join(" in ");
    owner = owner.split(" aufm ").join(" in ");
    owner = owner.split(" am ").join(" in ");

    return owner;
}

async function writeOwnerMap(masterOwnerMap:Map<string,string>,ownerMap:Map<string,MutterrolleEntry>) {   
    const values = new Array(...ownerMap.values());
    values.sort((a, b) => {
        let diff = a.gemeinde.getName().localeCompare(b.gemeinde.getName());
        if( diff != 0 ) {
            return diff;
        }
        diff = parseInt(a.mutterrolle)-parseInt(b.mutterrolle);
        if( diff != 0 ) {
            return diff;
        }
        const m1 = a.mutterrolle != null ? a.mutterrolle.toString() : "";
        const m2 = b.mutterrolle != null ? b.mutterrolle.toString() : "";
        return m1.localeCompare(m2);
    });

    let file = null;
    let lastGemeinde:gemeindeType.GemeindeId = null;
    let lastNr:number = 0;

    for( const value of values ) {
        if( lastGemeinde != null && lastGemeinde != value.gemeinde ) {
            writeOwnerCsv(lastGemeinde, file)
        }
        if( lastGemeinde == null || lastGemeinde != value.gemeinde ) {
            file = 'gemeinde;mutterrolle;name;anzahl;erste Parzelle\n';
            lastGemeinde = value.gemeinde;
            lastNr = 0;
        }
        for( let i=lastNr+1; i < parseInt(value.mutterrolle); i++ ) {
            file += `${lastGemeinde.getId()};${i};\n`;
        }
        lastNr = parseInt(value.mutterrolle);

        const mutterrolleId = value.gemeinde.getId()+"-"+value.mutterrolle;
        const masterName = masterOwnerMap.get(mutterrolleId);
        const bestName = value.getBestName();
        file += `${value.gemeinde.getId()};${value.mutterrolle};${bestName?.name};${masterName == bestName?.name ? 'master,' : ''}${bestName?.counter};${bestName?.parzelleId()};`
        
        if( masterName && !value.hasAlternative(masterName) && masterName != bestName?.name ) {
            file += "\n;;"+masterOwnerMap.get(mutterrolleId)+";master";
        }

        for( const alt of value.getOtherNames() ) {
            const isMaster = alt.name == masterName;
            if( isLogOwnerWarning(alt.name,bestName?.name) || isMaster ) {
                file += `\n;;${alt.name};${isMaster ? 'master,' : ''}${alt.counter};${alt.parzelleId()}`;
            }
        }
        file += '\n';
    }
    if( lastGemeinde != null ) {
        writeOwnerCsv(lastGemeinde, file)
    }
}

function writeOwnerCsv(gemeinde:gemeindeType.GemeindeId, content:string):void {
    const path = `${katasterPath}/out_mutterrollen/${gemeinde.getId()}.csv`
    consola.debug("Schreibe Eigentümer für", gemeinde.getId(), "nach", path)
    fs.writeFileSync(path, content, "ascii");
}

function readOwnerMapFromExcel(path:string):Map<string,string> {
    const result = new Map<string,string>();
    try {
        const workbook = XLSX.readFile(path);

        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        let i = 3;
        let skipped = 0;
        while(true) {
            i++;
            const gemeinde = readCell(sheet, 'A', i);
            const mutterrolle = readCell(sheet, 'B', i);
            const name = readCell(sheet, 'C', i);
            if( mutterrolle == '' && gemeinde == '' ) {
                if( skipped++ > 5 ) {
                    break;
                }
                continue;
            }
            result.set(gemeinde+"-"+mutterrolle, name);
        }
    }
    catch( error ) {
        consola.debug("Konnte Eigentümerliste nicht aus", path, "lesen:", error)
    }
    return result;
}

function readCell(sheet:XLSX.WorkSheet, row:string, col:number) {
    const cell = sheet[row+col];
    if( cell ) {
        return cell.v;
    }
    return '';
}
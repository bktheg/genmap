import XLSX from 'xlsx'
import * as XslxUtils from '#utils/xslxUtils'
import { consola } from 'consola';
import * as dotenv from 'dotenv'

dotenv.config()
const katasterPath = process.env.KATASTER_PATH
if( !katasterPath ) {
    consola.fatal("Pfad zu den Katasterunterlagen nicht gesetzt")
    throw new Error("Pfad zu den Katasterunterlagen nicht gesetzt")
}

export class CoordinateSystem {
    constructor(public origin:number[], public rotation:number) {}
}

export class Flur {
    constructor(
        public id:number, 
        public name:string, 
        public gemeinde:GemeindeId,
        public done:boolean, 
        public planned:boolean,
        public quelleKarte:string,
        public anmerkungen:string,
        public legal:Legal) {}
    
    getName():string {
        return this.name;
    }

    getId():number {
        return this.id;
    }

    getGemeinde():GemeindeId {
        return this.gemeinde;
    }

    isDone():boolean {
        return this.done;
    }

    isPlanned():boolean {
        return this.planned;
    }
    
    getQuelleKarte():string {
        return this.quelleKarte;
    }

    getAnmerkungen():string {
        return this.anmerkungen;
    }

    getLegalText():string {
        return this.legal?.text;
    }
}

export class Kreis {
    private buergermeistereien:Buergermeisterei[] = [];

    constructor(public id:string, public name:string, public origin:number[], public rotation:number, public vermessungsraster:number) {}

    getName(): string {
        return this.name;
    }

    getId(): string {
        return this.id;
    }

    getOrigin(): number[] {
        return this.origin;
    }

    getRotation(): number {
        return this.rotation;
    }

    addBuergermeisterei(buergermeisterei:Buergermeisterei):void {
        this.buergermeistereien.push(buergermeisterei);
    }

    isPartsDone():boolean {
        return this.buergermeistereien.some(b => b.isPartsDone());
    }

    getCoordinateSystem():CoordinateSystem {
        return new CoordinateSystem(this.origin, this.rotation)
    }
}

export class Buergermeisterei {
    private gemeinden:GemeindeId[] = [];
    private name:string;
    private origin:number[];
    private pointPerGemeinde:boolean;
    private kreis:Kreis;

    constructor(public id:string, kreis:Kreis, name:string, origin:number[], pointPerGemeinde:boolean, public vermessungsraster:number) {
        this.name = name;
        this.origin = origin;
        this.pointPerGemeinde = pointPerGemeinde;
        this.kreis = kreis;
    }

    getName(): string {
        return this.name;
    }

    getOrigin():number[] {
        return this.origin != null ? this.origin : this.kreis.origin;
    }

    isPointPerGemeinde():boolean {
        return this.pointPerGemeinde;
    }

    getId():string {
        return this.id;
    }

    getKreis():Kreis {
        return this.kreis;
    }

    addGemeinde(gemeinde:GemeindeId):void {
        this.gemeinden.push(gemeinde);
    }

    isPartsDone():boolean {
        return this.gemeinden.some(g => g.isPartsDone());
    }

    getCoordinateSystem():CoordinateSystem {
        return new CoordinateSystem(this.getOrigin(), this.kreis.rotation)
    }
}

export class GemeindeId {
    private flure = new Map<number,Flur>();
    private exportReinertrag:boolean;

    constructor(
        private id:string, 
        private name:string, 
        private parent:Buergermeisterei, 
        private quelleVermessung:string,
        private quelleFlurbuch:string, 
        private quelleMutterrollen:string, 
        private quelleGueterverzeichnis:string, 
        private alternateNames:string[]=[]) {
    }

    getName(): string {
        return this.name;
    }
    getId(): string {
        return this.id;
    }

    getParent():Buergermeisterei {
        return this.parent;
    }
    getAlternateNames(): string[] {
        return this.alternateNames;
    }
    hasName(name:string):boolean {
        if( this.name.toLowerCase() == name.toLowerCase() ) {
            return true;
        }
        for( const altName of this.alternateNames ) {
            if( altName.toLowerCase() == name.toLowerCase() ) {
                return true;
            }
        }
        return false;
    }

    isPartsDone():boolean {
        for( const f of this.flure.values() ) {
            if( f.isDone() ) {
                return true;
            }
        }
        return false;
    }

    isPartsPlanned():boolean {
        for( const f of this.flure.values() ) {
            if( f.isDone() || f.isPlanned() ) {
                return true
            }
        }
        return false
    }
    
    getFlur(nr:number) {
        return this.flure.get(nr);
    }

    addFlur(flur:Flur) {
        this.flure.set(flur.getId(),flur);
    }

    getFlure():Flur[] {
        return [...this.flure.values()];
    }

    getQuelleFlurbuch():string {
        return this.quelleFlurbuch;
    }

    getQuelleVermessung():string {
        return this.quelleVermessung;
    }

    getQuelleMutterrollen():string {
        return this.quelleMutterrollen;
    }

    getQuelleGueterverzeichnis(): string {
        return this.quelleGueterverzeichnis;
    }

    isExportReinertrag():boolean {
        return this.exportReinertrag;
    }

    setExportReinertrag(exportReinertrag:boolean):void {
        this.exportReinertrag = exportReinertrag;
    }
}

class Legal {
    constructor(public id:string,public text:string) {}
}

export const FLURE:Flur[] = []
export const GEMEINDEN:GemeindeId[] = []
export const BUERGERMEISTEREIEN:Buergermeisterei[] = []
export const KREISE:Kreis[] = []
export const LEGAL:Map<string,Legal> = new Map();

loadGemeinden();

export const DORTMUND = forId("dortmund");
export const LUETGENDORTMUND = forId("luetgendortmund");


export function forName(name:string):GemeindeId {
    if( !name ) {
        throw Error("Empty gemeinde name")
    }

    for( const g of GEMEINDEN ) {
        if( g.hasName(name) ) {
            return g;
        }
    }
    
    throw new Error("Unbekannter Gemeindename "+name);
}

export function forId(id:string):GemeindeId {
    if( !id ) {
        return DORTMUND;
    }

    for( const g of GEMEINDEN ) {
        if( g.getId() == id ) {
            return g;
        }
    }
    throw new Error("Unbekannte Gemeinde-ID "+id);
}

export function buergermeistereiById(id:string):Buergermeisterei {
    for( const bm of BUERGERMEISTEREIEN ) {
        if( bm.getId() == id ) {
            return bm;
        }
    }
    throw new Error("Unknown buergermeisterei id "+id);
}

export function kreisById(id:string):Kreis {
    for( const kreis of KREISE ) {
        if( kreis.id == id ) {
            return kreis;
        }
    }
    throw new Error("Unknown kreis id "+id);
}


function loadGemeinden():void {
    XslxUtils.loadExcelsInPath(`${katasterPath}/admin`, (path,file) => {
        try {
            loadGemeindenFromFile(`${path}/${file}`)
        }
        catch( ex ) {
            consola.log("Konnte Gemeindedatei", path+"/"+file, "nicht (vollständig) laden.", ex)
        }
    })

    consola.info(`${KREISE.length} Kreise ${BUERGERMEISTEREIEN.length} Buergermeistereien ${GEMEINDEN.length} Gemeinden ${FLURE.length} Fluren geladen`);
}

function loadGemeindenFromFile(file:string):void {
    const workbook = XLSX.readFile(file);
    
    loadKreiseSheet(workbook)
    loadBuergermeistereienSheet(workbook)
    loadGemeindenSheet(workbook)
    loadLegalSheet(workbook)
    loadFlurenSheet(workbook)

}

function loadKreiseSheet(workbook:XLSX.WorkBook):void {
    if( !workbook.Sheets['Kreise'] ) {
        return
    }

    const sheetKreise = new XslxUtils.TableLoader(workbook.Sheets['Kreise']);
    let i=1;
    while(true) {
        i++;
        const id = sheetKreise.readString("ID", i);
        if( id == '' ) {
            break;
        }
        validateId(id, "Kreis")

        const name = sheetKreise.readString("Name", i);
        const originX = sheetKreise.readNumber("NP X", i)
        const originY = sheetKreise.readNumber("NP Y", i)
        const rotation = sheetKreise.readNumber("Net Rotation", i)
        const raster = sheetKreise.readNumber("Vermessungsraster", i)

        if( KREISE.find(k => k.getId() == id) ) {
           throw Error("ERROR: Kreis-ID doppelt vergeben: "+id)
        }

        KREISE.push(new Kreis(id, name, [originX, originY], rotation, raster));
    }
}

function loadBuergermeistereienSheet(workbook:XLSX.WorkBook):void {
    if( !workbook.Sheets['Bürgermeistereien'] ) {
        return
    }
    const sheetBM = new XslxUtils.TableLoader(workbook.Sheets['Bürgermeistereien']);
    
    let i=1;
    while(true) {
        i++;
        const id = sheetBM.readString('ID',i);
        if( id == '' ) {
            break;
        }
        validateId(id, "Bürgermeisterei")

        const kreisId = sheetBM.readString('Kreis', i);
        const name = sheetBM.readString('Name', i)
        const originX = sheetBM.readNumber('NP X', i)
        const originY = sheetBM.readNumber('NP Y', i)
        const pointsPerGemeinde = sheetBM.readString('Punkte pro Gemeinde', i);
        const raster = sheetBM.readNumber('Vermessungsraster', i);

        if( BUERGERMEISTEREIEN.find(b => b.getId() == id) ) {
            throw Error("ERROR: Buergermeisterei-ID doppelt vergeben: "+id)
        }

        const kreis = kreisById(kreisId)
        if( !kreis ) {
            throw Error("ERROR: Buergermeisterei verweist auf ungueltigen Kreis: "+id)
        }
        const bgmstr = new Buergermeisterei(id, kreis, name, originX && originY ? [originX, originY] : null, pointsPerGemeinde == 'x', raster);
        kreis.addBuergermeisterei(bgmstr);
        BUERGERMEISTEREIEN.push(bgmstr);
    }
}

function loadGemeindenSheet(workbook:XLSX.WorkBook):void {
    if( !workbook.Sheets['Gemeinden'] ) {
        return
    }
    
    const sheetGemeinden = new XslxUtils.TableLoader(workbook.Sheets['Gemeinden']);
    let i=1;
    while(true) {
        i++;
        const id = sheetGemeinden.readString('ID',i);
        if( id == '' ) {
            break;
        }
        validateId(id, "Gemeinde")

        const bm = sheetGemeinden.readString('Bürgermeisterei',i);
        let name = sheetGemeinden.readString('Name',i);
        let altNames:string[] = []
        if( name.indexOf(',') ) {
            const split = name.split(',');
            name = split[0].trim();
            for( let i=1; i < split.length; i++ ) {
                altNames.push(split[i].trim());
            }
        }
        const quelleVermessung = sheetGemeinden.readString('Archiv Vermessung',i);
        const quelleFlurbuch = sheetGemeinden.readString('Archiv FB',i);
        const quelleMutterrollen = sheetGemeinden.readString('Archiv Mutterrollen',i);
        const quelleGueterverzeichnis = sheetGemeinden.readString('Archiv Güterverzeichnis',i);
        const exportReinertrag = sheetGemeinden.readString('Export Reinertrag',i).toLowerCase() == 'x';

        if( GEMEINDEN.find(g => g.getId() == id) ) {
            throw Error("ERROR: Gemeinde-ID doppelt vergeben: "+id)
        }

        const bgmstr = buergermeistereiById(bm)
        if( !bgmstr ) {
            throw Error("ERROR: Gemeinde verweist auf ungültige Buergermeisterei: "+id)
        }
        const gemeinde = new GemeindeId(id, name, bgmstr, quelleVermessung, quelleFlurbuch, quelleMutterrollen, quelleGueterverzeichnis, altNames);
        bgmstr.addGemeinde(gemeinde);
        gemeinde.setExportReinertrag(exportReinertrag);
        GEMEINDEN.push(gemeinde);
    }
}

function loadLegalSheet(workbook:XLSX.WorkBook):void {
    if( !workbook.Sheets['Legal'] ) {
        return
    }

    const sheetLegal = new XslxUtils.TableLoader(workbook.Sheets['Legal']);
    let i=1;
    while(true) {
        i++;
        const id = sheetLegal.readString('ID',i);
        const hinweis = sheetLegal.readString('Hinweise',i);
        const text = sheetLegal.readString('Text',i);
        if( !id ) {
            break;
        }
        validateId(id, "Legal")

        const legal = new Legal(id,text);
        if( LEGAL.has(legal.id) ) {
            throw Error("ERROR: Legal-ID doppelt vergeben: "+legal.id)
        }
        LEGAL.set(legal.id, legal);
    }
}

function loadFlurenSheet(workbook:XLSX.WorkBook):void {
    if( !workbook.Sheets['Fluren'] ) {
        return
    }

    const sheetFluren = new XslxUtils.TableLoader(workbook.Sheets['Fluren']);
    
    let i=1;
    while(true) {
        i++;
        const id = sheetFluren.readNumber('Nr',i);
        const gemeindeId = sheetFluren.readString('Gemeinde',i);
        if( gemeindeId == '' ) {
            break;
        }
        if( id == null ) {
            continue;
        }
        const name = sheetFluren.readString('Name',i);
        const planned = sheetFluren.readString('geplant',i);
        const done = sheetFluren.readString('erledigt',i);
        const quelleKarte = sheetFluren.readString('Archiv Karte',i);
        const anmerkungen = sheetFluren.readString('Anmerkung',i);
        const legalId = sheetFluren.readString('Legal',i);
        const gemeinde = forId(gemeindeId)

        if( !gemeinde ) {
            throw Error("ERROR: Flur verweist auf ungueltige Gemeinde: "+gemeindeId+'-'+id)
        }
     
        const flur = new Flur(id, name, gemeinde, done == "x", planned == "x", quelleKarte, anmerkungen, LEGAL.get(legalId));
        FLURE.push(flur);
        gemeinde.addFlur(flur);
    }
}

function validateId(id:string, label:string):void {
    if( !id?.trim() ) {
        throw new Error("ERROR: Ungültige ID für "+label+": ID ist leer!")
    }

    if( id != id.toLowerCase() ) {
        throw new Error("ERROR: Ungültige ID für "+label+": Bitte Kleinschreibung verwenden!")
    }

    if( id.includes('-') ) {
        throw new Error("ERROR: Ungültige ID für "+label+": Bitte keine Bindestriche verwenden!")
    }

    if( !id.match(/[a-z_]+/).length ) {
        throw new Error("ERROR: Ungültige ID für "+label+": Nur Kleinbuchstaben und Unterstriche sind erlaubt!")
    }
}
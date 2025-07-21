import * as fs from 'fs'
import {PointDescriptor, AbsolutePointDescriptor, AliasPointDescriptor, AveragePointDescriptor, RelativePointDescriptor, IntersectPointDescriptor, LengthUnit, PointType} from '#kataster/pointDescriptors'
import * as zeit from '#utils/zeit';
import * as gemeindeType from '#kataster/gemeindeType';
import * as flurbuchReader from '#kataster/flurbuchReader';

const katasterPath = process.env.KATASTER_PATH
const KATASTER_START_DATE = zeit.parse("31.12.1825");
const KATASTER_END_DATE = zeit.parse("08.05.1945");

export interface JsonBuilding {
    bezeichnung?:string;
    hnr?:string;
    points:any[];
    ref?:string;
}

export interface JsonArea {
    type:number;
    points:any[];
    rawtype:string;
}

export interface JsonParzelle {
    nr:string;
    area:JsonArea[];
    building:JsonBuilding[];
    help:any[];
    typ:AreaTyp;
}

export interface JsonChangeAdd {
    nr:string;
    area:JsonArea[];
    building:JsonBuilding[];
    typ:AreaTyp;
}

export interface JsonChange {
    flur:number;
    nr:string;
    remove:boolean;
    help:any[];
    add:JsonChangeAdd[]
}

export interface JsonChangeset {
    gemeinde:string,
    band:number,
    year:number|string,
    date:string,
    note:string,
    ohneAkt:boolean,
    change:JsonChange[]
}

export class Ring {
    points:PointDescriptor[] = [];
}

export class Area {
    rings:Ring[] = [];
    type:AreaTyp;
}

export class Gebaeude {
    points:PointDescriptor[] = [];
    bezeichnung:string;
    hnr:string;
}

export const enum AreaTyp {
    Default = 0,
    Garten,
    Gruenflaeche, // deprecated/unused
    Friedhof,
    Wiese,
    Wasser,
    Acker,
    Weide,
    Holzung,
    Hofraum,
    Grube,
    Unbekannt,
    Huetung,
    Bruecke = 13,
    Heide = 14
}

export class Parzelle {
    typ:AreaTyp = AreaTyp.Default;
    area:Area[] = [];
    gebaeude:Gebaeude[] = [];
    helper:PointDescriptor[] = [];
    validFrom:zeit.Zeit = KATASTER_START_DATE;
    validTill:zeit.Zeit = KATASTER_END_DATE;
    original:Parzelle[] = [];
    changeset:string

    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string) {}

    
    toPoints():Map<string,PointDescriptor> {
        const result:Map<string,PointDescriptor> = new Map();
        for( const a of this.area ) {
            for( const r of a.rings ) {
                for( const e of r.points ) {
                    result.set(e.id, e);
                }
            }
        }
        for( const a of this.gebaeude ) {
            for( const e of a.points ) {
                result.set(e.id, e);
            }
        }
        for( const e of this.helper ) {
            result.set(e.id, e);
        }

        return result;
    }

    id():string {
        return `${this.gemeinde.getId()}-${this.flur}-${this.nr}`;
    }
}


export class ParzellenRegistry {
    private parzellen:Map<String,Parzelle> = new Map();
    private parzellenOverride:Map<String,Parzelle> = new Map();
    private parzellenChangesets:Map<String,Parzelle> = new Map();

    put(parzelle:Parzelle) {
        this.parzellen.set(parzelle.id(), parzelle);
    }

    putOverride(parzelle:Parzelle) {
        this.parzellenOverride.set(parzelle.id(), parzelle);
    }

    putChangeset(parzelle:Parzelle) {
        this.parzellenChangesets.set(parzelle.id(), parzelle);
    }

    get(gemeinde:gemeindeType.GemeindeId, flur:number, parzelle:string):Parzelle {
        const id = `${gemeinde.getId()}-${flur}-${parzelle}`;
        if( this.parzellenChangesets.has(id) ) {
            return this.parzellenChangesets.get(id);
        }
        if( this.parzellenOverride.has(id) ) {
            return this.parzellenOverride.get(id);
        }
        return this.parzellen.get(id);
    }

    all():Array<Parzelle> {
        const result = [];
        for( const entry of this.parzellen ) {
            if( this.parzellenOverride.has(entry[0]) ) {
                result.push(this.parzellenOverride.get(entry[0]));
            }
            else {
                result.push(entry[1]);
            }
        }
        result.push(...this.parzellenChangesets.values());
        return result;
    }

    allPoints():Map<string,PointDescriptor> {
        const result:Map<string,PointDescriptor> = new Map();
        
        for( const p of this.parzellen.values() ) {
            for( const e of p.toPoints() ) {
                result.set(e[0], e[1]);
            }
        }

        for( const p of this.parzellenOverride.values() ) {
            for( const e of p.toPoints() ) {
                this.addToPointSet(e[1], result);
            }
        }

        for( const p of this.parzellenChangesets.values() ) {
            for( const e of p.toPoints() ) {
                this.addToPointSet(e[1], result);
            }
        }
    
        return result;
    }

    private addToPointSet(point:PointDescriptor, points:Map<string,PointDescriptor>) {
        if( point instanceof AliasPointDescriptor ) {
            // Stick to new alias relation
            points.set(point.id, point);
            return;
        }
        if( !(point instanceof RelativePointDescriptor) ) {
            // no special support yet
            points.set(point.id, point);
            return;
        }

        const rPoint = point as RelativePointDescriptor;
        for(const id of this.findMatchingAbsolutePoints(point.id, points) ) {
            points.set(id, new RelativePointDescriptor(point.type, id, point.gemeinde, rPoint.p1, rPoint.p2, rPoint.lengthP1P2, rPoint.unitP1P2, rPoint.angle, rPoint.length));
        }
    }

    private findMatchingAbsolutePoints(key:string, points:Map<string,PointDescriptor>):string[] {
        if( !points.has(key) ) {
            return [key];
        }
        const currentValue = points.get(key);
        if( !(currentValue instanceof AbsolutePointDescriptor) ) {
            return [key];
        }

        const result:string[] = [];

        const aPoint = currentValue as AbsolutePointDescriptor;
        for( const val of points.values() ) {
            if( !(val instanceof AbsolutePointDescriptor) ) {
                continue;
            }
            const aVal = val as AbsolutePointDescriptor;
            if( aVal.x == aPoint.x && aVal.y == aPoint.y ) {
                result.push(aVal.id);
            }
        }
        return result;
    }
}

async function addChangeset(registry:ParzellenRegistry, onlyGemeinde:gemeindeType.GemeindeId, name:string) {
    let rawdata = fs.readFileSync(`${katasterPath}/changesets/${name}`, 'utf-8');
    let descriptor = <JsonChangeset>JSON.parse(rawdata);

    let date = zeit.parse(descriptor.date);

    const gemeinde = gemeindeType.forId(descriptor.gemeinde);
    if( onlyGemeinde != null && gemeinde != onlyGemeinde ) {
        return;
    }

    for( const change of descriptor.change ) {
        const parzelle = registry.get(gemeinde, change.flur, change.nr);
        if( !parzelle ) {
            throw new Error('Parzelle '+change.flur+' '+change.nr+' missing');
        }
        if( change.remove ) {
            parzelle.validTill = date;
        }

        for( const add of change.add ) {
            const newParzelle = new Parzelle(gemeinde, change.flur, add.nr);
            newParzelle.validFrom = date;
            newParzelle.original.push(parzelle);
            newParzelle.typ = add.typ || parzelle.typ;
            newParzelle.changeset = name

            parseJsonHelp(newParzelle, change.help);
            parseJsonArea(newParzelle, add.area);
            parseJsonBuilding(newParzelle, add.building);

            registry.putChangeset(newParzelle);
        }
    }
}

function parseJsonArea(parzelle:Parzelle, area:JsonArea[]) {
    if( area != null ) {
        let idx = 1;
        for( const a of area ) {
            const area = new Area();
            area.type = a.type || AreaTyp.Default;
            if( a.rawtype ) {
                area.type = flurbuchReader.mapType(parzelle.gemeinde, parzelle.flur, a.rawtype)[0];
            }
            parzelle.area.push(area);

            if( typeof a.points[0][0] == "string" ) {
                // one ring only
                const areaRing = new Ring();
                area.rings.push(areaRing);
                for( const areaPoint of a.points ) {
                    const expandedPoints = descriptorPointToPoint(PointType.PROPERTY, parzelle, idx, areaPoint);
                    areaRing.points.push(...expandedPoints);
                    idx += expandedPoints.length;
                }
            }
            else {
                for( const ring of a.points ) {
                    const areaRing = new Ring();
                    area.rings.push(areaRing);
                    for( const areaPoint of ring ) {
                        const expandedPoints = descriptorPointToPoint(PointType.PROPERTY, parzelle, idx, areaPoint);
                        areaRing.points.push(...expandedPoints);
                        idx += expandedPoints.length;
                    }
                }
            }
        }
    }
}

function parseJsonBuilding(parzelle:Parzelle, building:JsonBuilding[]) {
    if( building != null ) {
        let idx = 1;
        for( const b of building ) {
            const gebaeude = new Gebaeude();
            parzelle.gebaeude.push(gebaeude);

            gebaeude.bezeichnung = b.bezeichnung;
            gebaeude.hnr = b.hnr;

            if( b.ref != null ) {
                if( parzelle.original == null ) {
                    throw new Error("Not a valid changeset - cannot reference building");
                }
                else if( !b.ref.startsWith("G") ) {
                    throw new Error("Unsupported building ref type: "+b.ref);
                }
                const buildingIdx = parseInt(b.ref.substr(1));
                const buildingRef = parzelle.original[0].gebaeude[buildingIdx-1];
                gebaeude.points.push(...buildingRef.points);
                gebaeude.bezeichnung = gebaeude.bezeichnung || buildingRef.bezeichnung;
                gebaeude.hnr = gebaeude.hnr || buildingRef.hnr;
                idx += buildingRef.points.length;
                continue;
            }
            // assume one ring
            for( const buildingPoint of (typeof b.points[0][0] == "string" ? b.points : b.points[0]) ) {
                const expandedPoints = descriptorPointToPoint(PointType.BUILDING, parzelle, idx, buildingPoint);
                gebaeude.points.push(...expandedPoints);
                idx += expandedPoints.length;
            }
        }
    }
}

function parseJsonHelp(parzelle:Parzelle, help:any[]) {
    if( help != null ) {
        let idx = 1;
        for( const h of help ) {
            parzelle.helper.push(...descriptorPointToPoint(PointType.HELPER, parzelle, idx, h));
            idx = parzelle.helper.length+1;
        }
    }
}

async function readParzelle(file:string,gemeinde:gemeindeType.GemeindeId, flur:string,parzelle:string):Promise<Parzelle> {
    let rawdata = fs.readFileSync(file, 'utf-8');
    let descriptor = <JsonParzelle>JSON.parse(rawdata);

    const result = new Parzelle(gemeinde, parseInt(flur), descriptor.nr || parzelle);
    result.typ = descriptor.typ || AreaTyp.Default;

    parseJsonHelp(result, descriptor.help);
    parseJsonArea(result, descriptor.area);
    parseJsonBuilding(result, descriptor.building);
    return result;
}

function descriptorPointToPoint(pointType:PointType, parzelle:Parzelle,idx:number,descr:Array<any>):PointDescriptor[] {
    const result:PointDescriptor[] = [];
    const type = descr[0].toString().toUpperCase();
    if( type == 'REL' ) {
        return descriptorPointRelToPoint(pointType, parzelle, idx, descr);
    }
    else if( type == 'REF' ) {
        return descriptorPointRefToPoint(pointType, parzelle, idx, descr);
    }
    else if( type == 'ABS' ) {
        const x = descr[1];
        const y = descr[2];
        result.push(new AbsolutePointDescriptor(pointType, generatePointId(parzelle, pointType, idx), parzelle.gemeinde , x, y));
    }
    else if( type == 'AVG' ) {
        const p1 = translatePointRef(parzelle,descr[1].toString())
        const p2 = translatePointRef(parzelle,descr[2].toString())
        result.push(new AveragePointDescriptor(pointType, generatePointId(parzelle, pointType, idx), parzelle.gemeinde, [p1, p2]));
    }
    else if( type == 'INTERSECT' ) {
        const p1 = translatePointRef(parzelle,descr[1].toString())
        const p2 = translatePointRef(parzelle,descr[2].toString())
        const p3 = translatePointRef(parzelle,descr[3].toString())
        const p4 = translatePointRef(parzelle,descr[4].toString())
        result.push(new IntersectPointDescriptor(pointType, generatePointId(parzelle, pointType, idx), parzelle.gemeinde, [p1, p2, p3, p4]));
    }

    return result;
}

function descriptorPointRefToPoint(type:PointType,parzelle:Parzelle,idx:number,descr:Array<any>):PointDescriptor[] {
    const result:PointDescriptor[] = [];

    const rangeMatcher = /([A-Za-z:]+)([0-9]+)=([0-9]+)/
    const refId = descr[1];
    if( refId instanceof Array ) {
        for( const r of refId ) {
            result.push(new AliasPointDescriptor(type, generatePointId(parzelle, type, idx), parzelle.gemeinde, translatePointRef(parzelle,r)));
            idx++;
        }
    }
    else if( refId.toString().startsWith('@C:A') ) {
        const areaIdx = parseInt(refId.toString().substr('#C:A'.length));

        for( const r of parzelle.area[areaIdx-1].rings ) {
            for( const p of r.points ) {
                result.push(new AliasPointDescriptor(type, generatePointId(parzelle, type, idx), parzelle.gemeinde, p.id))
                idx++;
            }
        }
    }
    else if( rangeMatcher.test(refId.toString()) ) {
        const matches = rangeMatcher.exec(refId.toString());
        const prefix = matches[1];
        const start = parseInt(matches[2]);
        const end = parseInt(matches[3]);
        for( let i=start; i <= end; i++ ) {
            result.push(new AliasPointDescriptor(type, generatePointId(parzelle, type, idx), parzelle.gemeinde, translatePointRef(parzelle,prefix+i)))
            idx++;
        }
    }
    else {
        result.push(new AliasPointDescriptor(type, generatePointId(parzelle, type, idx), parzelle.gemeinde, translatePointRef(parzelle,refId)));
    }

    return result;
}

function descriptorPointRelToPoint(type:PointType,parzelle:Parzelle,idx:number,descr:Array<any>):PointDescriptor[] {
    const result:PointDescriptor[] = [];
    const p1 = translatePointRef(parzelle,descr[1].toString());
    const p2 = translatePointRef(parzelle,descr[2].toString());
    let d1 = descr[3];
    let d1Unit = LengthUnit.FEET10;
    const a = descr[4];
    const d2 = descr[5];

    if( typeof d1 === 'string' ) {
        if( d1.endsWith('%') ) {
            d1Unit = LengthUnit.PERCENT;
        }
        else if( d1.endsWith('f') ) {
            d1Unit = LengthUnit.FEET12;
        }
        d1 = parseFloat(d1.substr(0,d1.length-1));
    }

    if( d2 instanceof Array ) {
        for( const d2Value of d2 ) {
            result.push(new RelativePointDescriptor(type, generatePointId(parzelle, type, idx), parzelle.gemeinde, p1, p2, d1, d1Unit, a, d2Value));
            idx++;
        }
    }
    else {
        result.push(new RelativePointDescriptor(type, generatePointId(parzelle, type, idx), parzelle.gemeinde, p1, p2, d1, d1Unit, a, d2));
    }
    return result;
}

function generatePointId(parzelle:Parzelle, type:PointType, idx:number) {
    let pointTypeStr = 'H';
    switch(type) {
        case PointType.BUILDING:
            pointTypeStr = 'G';
            break;
        case PointType.PROPERTY:
            pointTypeStr = 'F'
            break;
    }
    return `${pointTypeStr}-${parzelle.id()}-${idx}`;
}

function translatePointRef(parzelle:Parzelle, ref:string):string {
    if( ref.startsWith("C:") ) {
        ref = ref.substr(2);
    }
    else if( parzelle.original.length > 0 ) {
        return translatePointRef(parzelle.original[0], ref);
    }

    let prefix = "";
    if( ref.startsWith("F-") || ref.startsWith("H-") || ref.startsWith("G-") ) {
        prefix = ref.substr(0, 2);
        ref = ref.substr(2);
    }

    const parts = ref.split("-");
    
    if( parts.length > 3  ) {
        return prefix+ref;
    }
    else if( parts.length > 1 ) {
        return `${prefix}${parzelle.gemeinde.getId()}-${ref}`;
    }
    else if( ref.startsWith("A") ) {
        return `F-${parzelle.id()}-`+ref.substr(1);
    }
    else if( ref.startsWith("H") ) {
        return `H-${parzelle.id()}-`+ref.substr(1);
    }
    else if( ref.startsWith("G") ) {
        return `G-${parzelle.id()}-`+ref.substr(1);
    }
    else {
        throw new Error("Unknown point ref type in "+ref+" parzelle "+parzelle.id());
    }
}


export async function readParzellen(gemeinde:gemeindeType.GemeindeId):Promise<ParzellenRegistry> {
    const result = new ParzellenRegistry();

    const basePath = katasterPath;
    for( const gemeindeId of fs.readdirSync(`${basePath}/auto/`)) {
        if( !fs.statSync(`${basePath}/auto/${gemeindeId}`).isDirectory() ) {
            continue;
        }
        if( gemeinde != null && gemeindeId != gemeinde.getId() ) {
            continue;
        }
        for( const flur of fs.readdirSync(`${basePath}/auto/${gemeindeId}/`)) {
            if( !fs.statSync(`${basePath}/auto/${gemeindeId}/${flur}`).isDirectory() ) {
                continue;
            }

            for( const file of fs.readdirSync(`${basePath}/auto/${gemeindeId}/${flur}/`)) {
                if( file.endsWith('.json') ) {
                    let path = `${katasterPath}/auto/${gemeindeId}/${flur}/${file}`;
                    result.put(await readParzelle(path, gemeindeType.forId(gemeindeId), flur, file.substr(0, file.lastIndexOf('.'))));

                    if( fs.existsSync(`${katasterPath}/urkataster/${gemeindeId}/${flur}/${file}`) ) {
                        path = `${katasterPath}/urkataster/${gemeindeId}/${flur}/${file}`;
                        result.putOverride(await readParzelle(path, gemeindeType.forId(gemeindeId), flur, file.substr(0, file.lastIndexOf('.'))));
                    }
                }
            }
        }
    }
    
    for( const f of fs.readdirSync(`${basePath}/changesets/`) ) {
        if( f.endsWith('.json') ) {
            addChangeset(result, gemeinde, f);
        }
    }
    
    return result;
}
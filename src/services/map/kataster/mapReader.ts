import * as database from '#utils/database'
import {PointDescriptor} from '#kataster/pointDescriptors'
import {ParzellenRegistry} from '#kataster/parzellenReader'
import * as gemeindeType from '#kataster/gemeindeType';
import * as infoReader from '#kataster/infoReader';

/*async function readPointsFromUrkatasterNetz():Promise<Map<string,PointDescriptor>> {
    const points = await database.getClient().query({
        name: 'SELECT urkataster_netzt',
        text: `SELECT ST_X(ST_Transform(p.wkb_geometry,7416)) as x, ST_Y(ST_Transform(p.wkb_geometry,7416)) as y,p.Flur as flur,p.No as no FROM urkataster_netz p`, 
        values: []
    })

    const map = new Map<string,PointDescriptor>();
    for( const r of points.rows ) {
        const id = r.flur+'-'+r.no;
        map.set(id, new AbsolutePointDescriptor(id, r.x, r.y));
    }
    return map;
}*/

export function readPoints(registry:ParzellenRegistry, net:Map<string,PointDescriptor>):Map<string,PointDescriptor> {   
    //const urkataster = await readPointsFromUrkatasterNetz();
    const parzellen = registry.allPoints();
    return new Map([...net, ...parzellen]);
}

export class Bezeichnung {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public name:string, public type:number, public location:number[]) {}
}

export async function readBezeichnungen():Promise<Bezeichnung[]> {
    const points = await database.getClient().query({
        text: `SELECT ST_X(ST_Transform(the_geom,4326)) as x, ST_Y(ST_Transform(the_geom,4326)) as y,gemeinde as gemeinde,flur as flur,typ as type,name as name FROM "kataster_gen_bezeichnungen"`, 
        values: []
    })

    const result:Bezeichnung[] = [];
    for( const r of points.rows ) {

        result.push(new Bezeichnung(gemeindeType.forId(r.gemeinde), r.flur, r.name, r.type, [r.x, r.y]));
    }
    return result;
}

export class Strasse {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public name:string, public type:number, public location:number[]) {}
}

export class Building {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public nr:string, public bezeichnung:string, public location:number[]) {}
}

export async function readStrassen():Promise<Strasse[]> {
    const points = await database.getClient().query({
        text: `SELECT 
                    ST_X(ST_Transform(ST_ClosestPoint(the_geom,ST_LineInterpolatePoint(the_geom,0.5)),4326)) as x, 
                    ST_Y(ST_Transform(ST_ClosestPoint(the_geom,ST_LineInterpolatePoint(the_geom,0.5)),4326)) as y,
                    gemeinde as gemeinde,
                    flur as flur,
                    type as type,
                    name as name 
                FROM "kataster_gen_strassen"`, 
        values: []
    })

    const result = [];
    for( const r of points.rows ) {

        result.push(new Strasse(gemeindeType.forId(r.gemeinde), r.flur, r.name, r.type, [r.x, r.y]));
    }
    return result;
}

export async function readImportantBuildings():Promise<Building[]> {
    const points = await database.getClient().query({
        text: `SELECT ST_X(ST_Transform(ST_CENTROID(the_geom),4326)) as x, ST_Y(ST_Transform(ST_CENTROID(the_geom),4326)) as y,gemeinde as gemeinde,flur as flur,nr as parzelle,bezeichnung as bezeichnung 
            FROM "kataster_gen_buildings"
            WHERE bezeichnung IS NOT NULL and bezeichnung!=''`, 
        values: []
    })

    const result = [];
    for( const r of points.rows ) {

        result.push(new Building(gemeindeType.forId(r.gemeinde), r.flur, r.parzelle, r.bezeichnung, [r.x, r.y]));
    }
    return result;
}

export class Parzelle {
    private infoList:infoReader.Info[] = [];

    constructor(
        public gemeinde:gemeindeType.GemeindeId,
        public flur:number,
        public nr:string, 
        public flaeche:string,
        public reinertrag:string, 
        public mutterrolle:string, 
        public eigentuemer:string, 
        public lage:string, 
        public typ:string, 
        public klasse:string, 
        public location:number[], 
        public buildings:ParzelleBuilding[]|null) {}

    public addInfo(infos:Iterable<infoReader.Info>) {
        this.infoList.push(...infos);
    }

    public getInfo():infoReader.Info[] {
        return this.infoList;
    }
}

export class ParzelleBuilding {
    constructor(public bezeichnung:string, public hnr:string) {}
}

export async function readParzellen(gemeinde:gemeindeType.GemeindeId, flur:number):Promise<Parzelle[]> {
    const info = await infoReader.readAll();

    const buildingMap = new Map<string,ParzelleBuilding[]>();
    const buildings = await database.getClient().query({
        text: `SELECT nr as parzelle,bezeichnung,hnr 
            FROM "kataster_buildings_1826"
            WHERE gemeinde=$1 AND flur=$2`, 
        values: [gemeinde.getId(), flur]
    })

    for( const r of buildings.rows ) {
        if( !buildingMap.has(r.parzelle) ) {
            buildingMap.set(r.parzelle, [new ParzelleBuilding(r.bezeichnung, r.hnr)]);
        }
        else {
            buildingMap.get(r.parzelle).push(new ParzelleBuilding(r.bezeichnung, r.hnr));
        }
    }

    const points = await database.getClient().query({
        text: `SELECT ST_X(ST_Transform(ST_CENTROID(the_geom),4326)) as x, ST_Y(ST_Transform(ST_CENTROID(the_geom),4326)) as y,nr as parzelle,flaeche as flaeche,mutterrolle as mutterrolle,eigentuemer as eigentuemer,typPlain as typ,lage as lage,klasse as klasse,reinertrag as reinertrag 
            FROM "kataster_areas_1826"
            WHERE gemeinde=$1 AND flur=$2 AND typ=0`, 
        values: [gemeinde.getId(), flur]
    })

    const processed = new Set<number>()

    const result = [];
    for( const r of points.rows ) {
        if( processed.has(r.parzelle) ) {
            continue;
        }
        processed.add(r.parzelle)
        const parzelle = new Parzelle(
            gemeinde,
            flur,
            r.parzelle,
            r.flaeche,
            r.reinertrag,
            r.mutterrolle,
            r.eigentuemer,
            r.lage,
            r.typ,
            r.klasse,
            [r.x, r.y],
            buildingMap.get(r.parzelle));
        parzelle.addInfo(info.filter(i => i.matches(gemeinde.getParent().getKreis(), gemeinde.getParent(), gemeinde, flur, parzelle.nr)));
        result.push(parzelle);
    }

    return result;
}
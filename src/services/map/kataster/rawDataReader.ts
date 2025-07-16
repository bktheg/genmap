import * as database from '#utils/database'
import {JsonParzelle,JsonArea,JsonBuilding, AreaTyp} from '#kataster/parzellenReader';
import * as gemeindeType from '#kataster/gemeindeType';
import { consola } from 'consola';
import {Parzelle, ParzellenRegistry} from '#kataster/parzellenRegistry'
import sqlite from 'spatialite'
import * as fs from 'fs'


export type GeoJsonGeometry = {
    type:string,
    coordinates:number[][][]
};
export class Bezeichnung {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public name:string, public type:number, public geom:GeoJsonGeometry) {}
}
export class Strasse {
    constructor(public gemeinde:gemeindeType.GemeindeId, public flur:number, public name:string, public type:number, public anmerkung:string, public geom:GeoJsonGeometry) {}
}

interface RawDataReader {
    createDatabase():Promise<void>
    readKatasterParzellen(parzellen:ParzellenRegistry, gemeinde:gemeindeType.GemeindeId):Promise<void>
    readKatasterGebaeude(parzellen:ParzellenRegistry, gemeinde:gemeindeType.GemeindeId):Promise<void>
    readGemeindegrenzen():Promise<Map<gemeindeType.GemeindeId,GeoJsonGeometry>>
    readBezeichnungen(gemeinde:gemeindeType.GemeindeId):Promise<Bezeichnung[]>
    readStrassen(gemeinde:gemeindeType.GemeindeId):Promise<Strasse[]>
    close():Promise<void>
}

function convertPolyToPosArray(parzelle:Parzelle, geojson:GeoJsonGeometry, centrX:number, centrY:number):any[] {
    const result = new Array<any>();

    if(geojson == null) {
        return result
    } 

    for( const coords of geojson.coordinates ) {
        const ringResult = new Array<any>();
        const ring = coords.slice(0, -1);
        for( const coord of sortPolyRing(parzelle.id(), ring, centrX, centrY) ) {
            const alias = parzelle.generateCoordAlias(coord);
            if( alias != null ) {
                ringResult.push(alias);
            }
            else {
                ringResult.push(['ABS', coord[0], coord[1]]);
            }
        }
        result.push(ringResult);
    }

    return result;
}

function sortPolyRing(id:string, ring:number[][], centrX:number, centrY:number):number[][] {
    let startCandidates = ring
        .filter(c => c[0] > centrX && c[1] > centrY)
        .sort((a,b) => (a[0]-centrX)-(b[0]-centrY));

    if( startCandidates.length == 0 ) {
        startCandidates = ring
            .filter(c => c[0] > centrX)
            .sort((a,b) => (b[1]-a[1]));
    }
    if( startCandidates.length == 0 ) {
        consola.debug("couldn't sort ring: ", id);
        return ring;
    }
        
    let startIndex = ring.findIndex(c => c[0] == startCandidates[0][0] && c[1] == startCandidates[0][1]);
    if( startIndex == 0 ) {
        return ring;
    }
    let sortedRing = [...ring.slice(startIndex),...ring.slice(0,startIndex)];
    // Clock-wise vs counter clock wise detection
    if( isClockwise(sortedRing) ) {
        return sortedRing;
    }

    return [sortedRing[0], ...sortedRing.slice(1).reverse()];
}

function isClockwise(coords:number[][]):boolean {
    let sum = 0;
    for(let i=1; i < coords.length; i++ ) {
        sum += (coords[i][0]-coords[i-1][0])*(coords[i][1]+coords[i-1][1]);
    }

    return sum < 0;
}

class SpatialiteRawDataReader implements RawDataReader {
    private SRS = "7416";
    private db:sqlite.Database

    constructor(private file:String) {
        this.db = new sqlite.Database(file);
    }

    async createDatabase():Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.spatialite((err) => {
                if( err ) {
                    consola.error("Fehler beim Lesen aus SpatiaLite", this.file, ":", err)
                    reject(err)
                    return
                }

                this.db.exec(`
                    SELECT InitSpatialMetaData();

                    CREATE TABLE "1826_bezeichnungen"(pkuid integer primary key autoincrement,"name" text,"flur" integer, "gemeinde" TEXT, "typ" INTEGER);
                    SELECT AddGeometryColumn("1826_bezeichnungen", "geometry", 4326, "POINT", 2);
                    SELECT CreateSpatialIndex("1826_bezeichnungen", "geometry");
                    
                    CREATE TABLE "1826_gemeindegrenzen"(pkuid integer primary key autoincrement,"gemeinde" text, "buergermeisterei" TEXT, "kreis" TEXT, "gemeindeid" TEXT);
                    SELECT AddGeometryColumn("1826_gemeindegrenzen", "geometry", 4326, "POLYGON", 2);
                    SELECT CreateSpatialIndex("1826_gemeindegrenzen", "geometry");
                    
                    CREATE TABLE 'kataster_flurstuecke' ( "ogc_fid" INTEGER PRIMARY KEY AUTOINCREMENT, 'id' BIGINT, 'flur' BIGINT, 'zaehler' BIGINT, 'nenner' BIGINT, 'typ' INTEGER, 'nr' VARCHAR, 'gemeinde' VARCHAR(32), 'rawtype' VARCHAR(31), 'hinweis' VARCHAR(512));
                    SELECT AddGeometryColumn("kataster_flurstuecke", "geometry", 4326, "POLYGON", 2);
                    SELECT CreateSpatialIndex("kataster_flurstuecke", "geometry");

                    CREATE TABLE "kataster_gebaeude"("ogc_fid" INTEGER PRIMARY KEY,'flur' BIGINT, 'zaehler' BIGINT, 'nenner' BIGINT, 'hnr' VARCHAR, 'strasse' VARCHAR, 'nebengeb' INTEGER, 'rotlabel' INTEGER, 'bezeichnung' VARCHAR, 'gemeinde' VARCHAR, 'nr' VARCHAR(10), 'katasternr' VARCHAR(6));
                    SELECT AddGeometryColumn("kataster_gebaeude", "geometry", 4326, "POLYGON", 2);
                    SELECT CreateSpatialIndex("kataster_gebaeude", "geometry");

                    CREATE TABLE 'kataster_strassen' ( "ogc_fid" INTEGER PRIMARY KEY AUTOINCREMENT, 'id' BIGINT, 'name' VARCHAR(80), 'gemeinde' VARCHAR(32), 'flur' INTEGER, 'type' INTEGER, 'anmerkung' VARCHAR(512));
                    SELECT AddGeometryColumn("kataster_strassen", "geometry", 4326, "LINESTRING", 2);
                    SELECT CreateSpatialIndex("kataster_strassen", "geometry");
                `, (err) => {
                    if( err ) {
                        consola.error("Fehler beim Erstellen der SpatiaLite-Datenbank unter ", this.file, ":", err)
                        reject(err)
                        return
                    }
                    resolve()
                })
            })
        })
    }

    async prepareSrid() {
        return new Promise<void>((resolve, reject) => {
            this.db.spatialite((err) => {
                this.db.all(`SELECT * FROM spatial_ref_sys WHERE srid=7416`, (err, rows) => {
                    if( err ) {
                        consola.error("Fehler beim Lesen der Spatial Reference Systems in SpatiaLite", this.file, ":", err)
                        reject(err)
                        return
                    }


                    if( rows.length == 0 ) {
                        this.db.exec(`
                            INSERT INTO spatial_ref_sys 
                            (srid,auth_name,auth_srid,ref_sys_name,proj4text,srtext) 
                            VALUES 
                            (7416,'epsg',7416,'ETRS89 / UTM zone 32N','+proj=utm +zone=32 +ellps=GRS80 +units=m +vunits=m +no_defs +type=crs','COMPD_CS["ETRS89 / UTM zone 32N + DVR90 height",PROJCS["ETRS89 / UTM zone 32N",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6258"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4258"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",9],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","25832"]],VERT_CS["DVR90 height",VERT_DATUM["Dansk Vertikal Reference 1990 ensemble",2005,AUTHORITY["EPSG","1371"]],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Gravity-related height",UP],AUTHORITY["EPSG","5799"]],AUTHORITY["EPSG","7416"]]')
                        `, (err) => {
                                if( err ) {
                                    consola.error("Fehler beim Erstellen der SpatiaLite-Datenbank unter ", this.file, ":", err)
                                    reject(err)
                                    return
                                }
                                resolve()
                            })
                    }
                    else {
                        resolve()
                    }
                })
            })
        })
    }

    async readKatasterParzellen(parzellen:ParzellenRegistry, gemeinde:gemeindeType.GemeindeId):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.spatialite((err) => {
                if( err ) {
                    consola.error("Fehler beim Lesen aus SpatiaLite", this.file, ":", err)
                    reject(err)
                    return
                }
                const query = `SELECT gemeinde,flur,nr,typ,rawtype,
                    ST_X(ST_Transform(st_centroid(GEOMETRY),${this.SRS})) as x,
                    ST_Y(ST_Transform(st_centroid(GEOMETRY),${this.SRS})) as y,
                    AsGeoJSON(ST_Transform(GEOMETRY, ${this.SRS}),6) as geometry 
                FROM kataster_flurstuecke
                WHERE flur IS NOT NULL ${gemeinde ? 'AND gemeinde=$1' : ''}`
                
                this.db.all(query, gemeinde ? [gemeinde.getId()] : [], (err, rows) => {
                    if( err ) {
                        consola.error("Fehler beim Lesen der Daten aus SpatiaLite", this.file, ":", err)
                        reject(err)
                        return
                    }

                    for( const r of rows ) {
                        try {
                            const geojson = JSON.parse(r.geometry)
                            if( geojson == null ) {
                                consola.warn("Gebaeude ohne Geometrie: "+r.gemeinde+"-"+r.flur+"-"+r.nr);
                                continue;
                            }
                            const parzelle = parzellen.getOrCreate(gemeindeType.forId(r.gemeinde), r.flur, r.nr);
                            const area = {type:(r.typ || AreaTyp.Default) as number,points:convertPolyToPosArray(parzelle, geojson, r.x, r.y),rawtype:r.rawtype}
                            
                            parzelle.area.push(area)
                        }
                        catch( ex ) {
                            consola.error("Fehler beim Lesen der Parzelle Gemeinde", r.gemeinde, "Flur", r.flur, "Nr", r.nr, ex)
                        }
                    }
                    consola.debug(rows.length, "Parzellen aus SpatiaLite", this.file, "gelesen")
                    resolve()    
                })
            })
        })
    }

    async readKatasterGebaeude(parzellen:ParzellenRegistry, gemeinde:gemeindeType.GemeindeId):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.spatialite((err) => {
                if( err ) {
                    consola.error("Fehler beim Lesen aus SpatiaLite", this.file, ":", err)
                    reject(err)
                    return
                }

                const query = `SELECT gemeinde,flur,nr,bezeichnung,hnr,
                    ST_X(ST_Transform(st_centroid(GEOMETRY),${this.SRS})) as x,
                    ST_Y(ST_Transform(st_centroid(GEOMETRY),${this.SRS})) as y,
                    AsGeoJSON(ST_Transform(GEOMETRY, ${this.SRS}),6) as geometry 
                FROM kataster_gebaeude ${gemeinde ? 'WHERE gemeinde=$1' : ''}`
                
                this.db.all(query, gemeinde ? [gemeinde.getId()] : [], (err, rows) => {
                    if( err ) {
                        consola.error("Fehler beim Lesen der Daten aus SpatiaLite", this.file, ":", err)
                        reject(err)
                        return
                    }
                    for( const r of rows ) {
                        const geojson = r.geometry;
                        if( geojson == null ) {
                            consola.warn("Gebaeude ohne Geometrie: "+r.gemeinde+"-"+r.flur+"-"+r.nr);
                            continue;
                        }

                        try {
                            const nr = r.nr;
                            const parzelle = parzellen.getOrCreate(gemeindeType.forId(r.gemeinde), r.flur, nr);
                            const building = {
                                bezeichnung:r.bezeichnung || undefined,
                                hnr:r.hnr || undefined,
                                points:convertPolyToPosArray(parzelle, JSON.parse(geojson), r.x, r.y)
                            };
                            
                            parzelle.building.push(building);
                        }
                        catch( ex ) {
                            consola.error("Fehler beim Lesen des Gebäudes Gemeinde", r.gemeinde, "Flur", r.flur, "Parzelle", r.nr, ex)
                        }
                    }
                    consola.debug(rows.length, "Gebäude aus SpatiaLite", this.file, "gelesen")
                    resolve()    
                })
            })
        })
    }

    async readGemeindegrenzen(): Promise<Map<gemeindeType.GemeindeId, GeoJsonGeometry>> {
        return new Promise<Map<gemeindeType.GemeindeId,GeoJsonGeometry>>((resolve, reject) => {
            this.db.spatialite((err) => {
                if( err ) {
                    consola.error("Fehler beim Lesen aus SpatiaLite", this.file, ":", err)
                    reject(err)
                    return
                }

                const query = `SELECT gemeindeid,AsGeoJSON(ST_Transform(GEOMETRY, ${this.SRS}),6) as geometry FROM "1826_gemeindegrenzen"`
                
                this.db.all(query, (err, rows) => {
                    if( err ) {
                        consola.error("Fehler beim Lesen der Daten aus SpatiaLite", this.file, ":", err)
                        reject(err)
                        return
                    }
                    const result = new Map<gemeindeType.GemeindeId,GeoJsonGeometry>()

                    for( const r of rows ) {
                        const geojson = r.geometry;
                        if( !geojson ) {
                            consola.warn("Gemeindegrenze ohne Geometrie:", r.gemeindeid);
                            continue;
                        }
                        try {
                            const gemeinde = gemeindeType.forId(r.gemeindeid)
                            if( result.has(gemeinde) ) {
                                consola.warn("Mehrere Gemeindegrenzen für Gemeinde", r.gemeindeid, "gefunden. Es wird eine zufällige Grenze ausgewählt.")
                            }
                            result.set(gemeinde, JSON.parse(r.geometry))
                        }
                        catch( ex ) {
                            consola.error("Fehler beim Lesen der Gemeindegrenze von", r.gemeindeid, ex)
                        }
                    }
                    consola.debug(rows.length, "Gemeindegrenzen aus SpatiaLite", this.file, "gelesen")
                    resolve(result)    
                })
            })
        })
    }

    
    readBezeichnungen(gemeinde: gemeindeType.GemeindeId): Promise<Bezeichnung[]> {
        return new Promise<Bezeichnung[]>((resolve, reject) => {
            this.db.spatialite((err) => {
                if( err ) {
                    consola.error("Fehler beim Lesen aus SpatiaLite", this.file, ":", err)
                    reject(err)
                    return
                }

                const query = `SELECT gemeinde,flur,name,typ,AsGeoJSON(ST_Transform(GEOMETRY, ${this.SRS}),6) as geometry 
                    FROM "1826_bezeichnungen"
                    ${gemeinde ? 'WHERE gemeinde=$1' : ''}`
                
                this.db.all(query, gemeinde ? [gemeinde.getId()] : [], (err, rows) => {
                    if( err ) {
                        consola.error("Fehler beim Lesen der Daten aus SpatiaLite", this.file, ":", err)
                        reject(err)
                        return
                    }
                    const result = []

                    for( const r of rows ) {
                        const geojson = r.geometry;
                        if( !geojson ) {
                            consola.warn("Bezeichnung ohne Geometrie:", r.gemeinde, r.flur, r.name);
                            continue;
                        }

                        try {
                            result.push(new Bezeichnung( gemeindeType.forId(r.gemeinde), r.flur, r.name, r.typ, JSON.parse(geojson)))
                        }
                        catch( ex ) {
                            consola.error("Fehler beim Lesen der Bezeichnung Gemeinde", r.gemeinde, "Flur", r.flur, "Bezeichnung", r.name, ex)
                        }
                    }
                    consola.debug(rows.length, "Bezeichnungen aus SpatiaLite", this.file, 'für Gemeinde', gemeinde?.getId() || '*', "gelesen")
                    resolve(result)    
                })
            })
        })
    }
    readStrassen(gemeinde: gemeindeType.GemeindeId): Promise<Strasse[]> {
        return new Promise<Strasse[]>((resolve, reject) => {
            this.db.spatialite((err) => {
                if( err ) {
                    consola.error("Fehler beim Lesen aus SpatiaLite", this.file, ":", err)
                    reject(err)
                    return
                }

                const query = `SELECT gemeinde,flur,name,type,anmerkung,AsGeoJSON(ST_Transform(GEOMETRY, ${this.SRS}),6) as geometry 
                    FROM "kataster_strassen"
                    ${gemeinde ? 'WHERE gemeinde=$1' : ''}`
                
                this.db.all(query, gemeinde ? [gemeinde.getId()] : [], (err, rows) => {
                    if( err ) {
                        consola.error("Fehler beim Lesen der Daten aus SpatiaLite", this.file, ":", err)
                        reject(err)
                        return
                    }
                    const result = []

                    for( const r of rows ) {
                        const geojson = r.geometry;
                        if( !geojson ) {
                            consola.warn("Straße ohne Geometrie:", r.gemeinde, r.flur, r.name);
                            continue;
                        }

                        try {
                            result.push(new Strasse( gemeindeType.forId(r.gemeinde), r.flur, r.name, r.type, r.anmerkung, JSON.parse(geojson)))
                        }
                        catch( ex ) {
                            consola.error("Fehler beim Lesen der Straße Gemeinde", r.gemeinde, "Flur", r.flur, "Bezeichnung", r.name, ex)
                        }
                    }
                    consola.debug(rows.length, "Straßen aus SpatiaLite", this.file, 'für Gemeinde', gemeinde?.getId() || '*', "gelesen")
                    resolve(result)    
                })
            })
        })
    }

    async close(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.close((err) => {
                if( err ) {
                    consola.warn("Konnte SpatiaLite nicht schließen:", this.file)
                    reject(err)
                    return
                }
                resolve()
            })
        })
    }
}

export async function createRawDataReader() {
    if( !process.env.INPUT_SPATIALITE ) {
        consola.error("Keine SpatiaLite konfiguriert. Bitte INPUT_SPATIALITE setzen.")
        throw new Error("Keine SpatiaLite konfiguriert")
    }
    const file = process.env.INPUT_SPATIALITE
    if( !fs.existsSync(file) ) {
        consola.warn("Keine SpatiaLite-Datenbank unter", file, "gefunden. Erstelle neue SpatiaLite-Datenbank...")
        await new SpatialiteRawDataReader(file).createDatabase()
    }

    consola.debug("Lese Daten aus SpatiaLite", file)
    const db = new SpatialiteRawDataReader(file)
    await db.prepareSrid()
    return db
}